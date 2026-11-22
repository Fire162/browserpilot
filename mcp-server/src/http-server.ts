import http from 'http';
import { URL } from 'url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { WebSocketHub } from './websocket-hub.js';
import { DaemonConfig, SERVER_VERSION } from './config.js';
import { ActionPolicy, AuthRateLimiter, PolicyError, UnknownActionError, isOriginAllowed } from './policy.js';

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] || 0) > maxBytes) {
      reject(new HttpError(413, `Request body exceeds the ${maxBytes} byte limit.`));
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(new HttpError(413, `Request body exceeds the ${maxBytes} byte limit.`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

export interface HttpServerOptions {
  limiter?: AuthRateLimiter;
}

/**
 * Hardened HTTP/SSE surface for the daemon.
 *
 * Every branch is reachable from the public internet when the operator exposes
 * the port or a tunnel, so:
 * - untrusted browser origins are rejected before any work happens,
 * - CORS is never wildcarded,
 * - request bodies are capped,
 * - unknown actions and gated capabilities are refused,
 * - the async handler can never produce an unhandled rejection (the previous
 *   implementation could crash the whole daemon from /sse).
 */
export function createHttpServer(
  hub: WebSocketHub,
  config: DaemonConfig,
  createMcpServer: () => McpServer,
  options: HttpServerOptions = {}
): http.Server {
  const limiter =
    options.limiter ??
    new AuthRateLimiter(config.authMaxFailures, config.authWindowMs, config.authBlockMs);
  const sseTransports = new Map<string, SSEServerTransport>();
  const policy = hub.getPolicy() ?? new ActionPolicy({
    allowCodeExecution: config.allowCodeExecution,
    allowCookieAccess: config.allowCookieAccess
  });

  const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const originHeader = req.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;

    // ---- Origin gate (browser-based attacks, DNS rebinding) ----------------
    if (origin && !isOriginAllowed(origin, config.allowedOrigins)) {
      sendJson(res, 403, {
        success: false,
        error: 'Origin not allowed. Add it to BROWSERPILOT_ALLOWED_ORIGINS to permit browser access.'
      });
      return;
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-token');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const host = req.headers.host || `localhost:${config.port}`;
    const parsedUrl = new URL(req.url || '/', `http://${host}`);
    const remote = req.socket.remoteAddress || 'unknown';

    const requireAuth = (): boolean => {
      if (limiter.isBlocked(remote)) {
        sendJson(res, 429, {
          success: false,
          error: 'Too many failed authentication attempts. Try again shortly.'
        });
        return false;
      }
      if (!hub.authenticate(req)) {
        limiter.recordFailure(remote);
        sendJson(res, 401, {
          success: false,
          error: 'Unauthorized: invalid or missing secret token.'
        });
        return false;
      }
      limiter.reset(remote);
      return true;
    };

    // ---- Health & status (unauthenticated, no secrets) ---------------------
    if (parsedUrl.pathname === '/health' || parsedUrl.pathname === '/status') {
      sendJson(res, 200, {
        service: 'browserpilot',
        status: 'online',
        hub: hub.getStatus(),
        sseSessions: sseTransports.size,
        security: {
          originAllowList: ['chrome-extension://*', 'loopback', ...config.allowedOrigins],
          allowCodeExecution: policy.isEnabled('run_code'),
          allowCookieAccess: policy.isEnabled('get_cookies')
        }
      });
      return;
    }

    // ---- Direct RPC dispatch (stdio bridge / HTTP clients) -----------------
    if (parsedUrl.pathname === '/api/dispatch' && req.method === 'POST') {
      if (!requireAuth()) return;

      try {
        const body = await readBody(req, config.maxBodyBytes);
        const { action, params, timeoutMs } = JSON.parse(body || '{}');
        const validatedAction = policy.validateDispatchable(action);
        const result = await hub.dispatch(validatedAction, params || {}, timeoutMs || 35000);
        sendJson(res, 200, { success: true, result });
      } catch (err: any) {
        if (err instanceof HttpError) {
          sendJson(res, err.status, { success: false, error: err.message });
        } else if (err instanceof UnknownActionError) {
          sendJson(res, 400, { success: false, error: err.message, code: err.code });
        } else if (err instanceof PolicyError) {
          sendJson(res, 403, {
            success: false,
            error: err.message,
            code: err.code,
            envVar: err.envVar
          });
        } else if (err instanceof SyntaxError) {
          sendJson(res, 400, { success: false, error: 'Invalid JSON body.' });
        } else if (err?.message?.includes('not connected')) {
          sendJson(res, 503, { success: false, error: err.message });
        } else {
          sendJson(res, 400, { success: false, error: err?.message || String(err) });
        }
      }
      return;
    }

    // ---- MCP SSE connection ------------------------------------------------
    if (parsedUrl.pathname === '/sse') {
      if (!requireAuth()) return;

      const sseTransport = new SSEServerTransport('/message', res);
      sseTransports.set(sseTransport.sessionId, sseTransport);
      console.error(`[MCP SSE] Client connected (session ${sseTransport.sessionId}).`);

      try {
        const mcpServer = createMcpServer();
        await mcpServer.connect(sseTransport);
      } catch (err: any) {
        sseTransports.delete(sseTransport.sessionId);
        console.error('[MCP SSE] Failed to establish session:', err?.message || err);
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'Failed to establish SSE session.' });
        } else if (!res.writableEnded) {
          res.end();
        }
        return;
      }

      req.on('close', () => {
        console.error(`[MCP SSE] Session ${sseTransport.sessionId} closed.`);
        sseTransports.delete(sseTransport.sessionId);
      });
      return;
    }

    // ---- MCP POST message --------------------------------------------------
    if (parsedUrl.pathname === '/message' && req.method === 'POST') {
      if (!requireAuth()) return;

      const sessionId = parsedUrl.searchParams.get('sessionId');
      const transport = sessionId ? sseTransports.get(sessionId) : undefined;
      if (!sessionId || !transport) {
        sendJson(res, 404, { error: 'SSE session not found or expired' });
        return;
      }

      try {
        await transport.handlePostMessage(req, res);
      } catch (err: any) {
        console.error('[MCP SSE] Failed to handle message:', err?.message || err);
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'Failed to handle MCP message.' });
        }
      }
      return;
    }

    // ---- Default root ------------------------------------------------------
    sendJson(res, 200, {
      name: 'BrowserPilot MCP Server',
      version: SERVER_VERSION,
      wsEndpoint: 'ws://<your-vps-ip>:' + config.port,
      sseEndpoint: 'http://<your-vps-ip>:' + config.port + '/sse',
      status: hub.getStatus(),
      security: {
        allowCodeExecution: policy.isEnabled('run_code'),
        allowCookieAccess: policy.isEnabled('get_cookies')
      }
    });
  };

  return http.createServer((req, res) => {
    requestHandler(req, res).catch((err) => {
      console.error('[HTTP] Unhandled request error:', err?.message || err);
      if (!res.headersSent) {
        sendJson(res, 500, { success: false, error: 'Internal server error.' });
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  });
}
