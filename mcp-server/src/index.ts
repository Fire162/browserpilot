import http from 'http';
import { URL } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import dotenv from 'dotenv';
import { WebSocketHub } from './websocket-hub.js';
import { registerBrowserTools } from './tools.js';

// Load environment variables
dotenv.config();

const PORT = parseInt(process.env.WS_PORT || process.env.PORT || '8770', 10);
const SECRET_TOKEN = process.env.SECRET_TOKEN || 'browserpilot-secret';
const RUN_STDIO = process.argv.includes('--stdio') || process.env.MCP_STDIO === 'true';

// Active SSE transports mapped by sessionId
const sseTransports = new Map<string, SSEServerTransport>();

function createConfiguredMcpServer(hub: WebSocketHub): McpServer {
  const server = new McpServer({
    name: 'browserpilot-mcp',
    version: '1.0.0'
  });
  registerBrowserTools(server, hub);
  return server;
}

async function main() {
  console.error('====================================================');
  console.error('🚀 Starting BrowserPilot Daemon & MCP Server...');
  console.error('====================================================');

  // 1. Initialize WebSocket Hub
  const hub = new WebSocketHub(PORT, SECRET_TOKEN);

  // 2. Create unified HTTP server
  const httpServer = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-token');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const host = req.headers.host || `localhost:${PORT}`;
    const parsedUrl = new URL(req.url || '/', `http://${host}`);

    // Health & status endpoints
    if (parsedUrl.pathname === '/health' || parsedUrl.pathname === '/status') {
      const status = hub.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          {
            service: 'browserpilot',
            status: 'online',
            hub: status,
            sseSessions: sseTransports.size
          },
          null,
          2
        )
      );
      return;
    }

    // Direct RPC Dispatch endpoint for stdio-bridge or HTTP clients
    if (parsedUrl.pathname === '/api/dispatch' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const { action, params, timeoutMs } = JSON.parse(body || '{}');
          const result = await hub.dispatch(action, params || {}, timeoutMs || 35000);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, result }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }


    // MCP SSE connection endpoint
    if (parsedUrl.pathname === '/sse') {
      console.error('[MCP SSE] Client initiating SSE connection...');
      const sseTransport = new SSEServerTransport('/message', res);
      sseTransports.set(sseTransport.sessionId, sseTransport);

      const mcpServer = createConfiguredMcpServer(hub);
      await mcpServer.connect(sseTransport);

      req.on('close', () => {
        console.error(`[MCP SSE] Session ${sseTransport.sessionId} closed.`);
        sseTransports.delete(sseTransport.sessionId);
      });
      return;
    }

    // MCP POST message endpoint
    if (parsedUrl.pathname === '/message' && req.method === 'POST') {
      const sessionId = parsedUrl.searchParams.get('sessionId');
      if (!sessionId || !sseTransports.has(sessionId)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'SSE session not found or expired' }));
        return;
      }

      const transport = sseTransports.get(sessionId)!;
      await transport.handlePostMessage(req, res);
      return;
    }

    // Default root welcome
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        {
          name: 'BrowserPilot MCP Server',
          version: '1.0.0',
          wsEndpoint: `ws://<your-vps-ip>:${PORT}`,
          sseEndpoint: `http://<your-vps-ip>:${PORT}/sse`,
          status: hub.getStatus()
        },
        null,
        2
      )
    );
  });

  // Attach WebSocket Server to the same HTTP server
  hub.attachToServer(httpServer);

  // 3. Connect Stdio Transport if requested
  if (RUN_STDIO) {
    const stdioServer = createConfiguredMcpServer(hub);
    const stdioTransport = new StdioServerTransport();
    await stdioServer.connect(stdioTransport);
    console.error('✅ Stdio MCP transport connected and listening.');
  }

  // 4. Start HTTP & WebSocket Server
  await new Promise<void>((resolve) => {
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.error(`✅ BrowserPilot listening on http://0.0.0.0:${PORT}`);
      console.error(`📡 WebSocket endpoint for Chrome Extension: ws://<your-vps-ip>:${PORT}`);
      console.error(`🔌 MCP SSE endpoint: http://<your-vps-ip>:${PORT}/sse`);
      console.error(`🔑 Secret Token: ${SECRET_TOKEN}`);
      console.error('====================================================');
      resolve();
    });
  });

  // Graceful shutdown handling
  const shutdown = async () => {
    console.error('\n🛑 Shutting down BrowserPilot...');
    await hub.stop();
    httpServer.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('❌ Fatal error in BrowserPilot:', err);
  process.exit(1);
});
