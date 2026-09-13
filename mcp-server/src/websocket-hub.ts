import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server as HttpServer } from 'http';
import { URL } from 'url';
import { BrowserActionType, CommandRequest, CommandResponse, WebSocketInboundMessage } from './types.js';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
}

export class WebSocketHub {
  private wss: WebSocketServer | null = null;
  private activeClient: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private secretToken: string;
  private port: number;
  private lastSeen: number = 0;
  private requestCounter: number = 0;

  constructor(port: number = 8770, secretToken: string = 'browserpilot-secret') {
    this.port = port;
    this.secretToken = secretToken;
  }

  public attachToServer(server: HttpServer): void {
    this.wss = new WebSocketServer({
      server,
      verifyClient: (info, callback) => {
        const isAuthorized = this.authenticate(info.req);
        if (!isAuthorized) {
          console.error('[WebSocketHub] Unauthorized connection attempt rejected.');
          callback(false, 401, 'Unauthorized');
          return;
        }
        callback(true);
      }
    });

    this.setupSocketHandlers();
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.port,
          verifyClient: (info, callback) => {
            const isAuthorized = this.authenticate(info.req);
            if (!isAuthorized) {
              console.error('[WebSocketHub] Unauthorized connection attempt rejected.');
              callback(false, 401, 'Unauthorized');
              return;
            }
            callback(true);
          }
        });

        this.wss.on('listening', () => {
          console.error(`[WebSocketHub] Listening for Chrome Extension on ws://0.0.0.0:${this.port}`);
          resolve();
        });

        this.wss.on('error', (err) => {
          console.error('[WebSocketHub] Server error:', err);
          reject(err);
        });

        this.setupSocketHandlers();
      } catch (err) {
        reject(err);
      }
    });
  }

  private setupSocketHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      console.error('[WebSocketHub] Chrome Extension connected successfully!');
      
      if (this.activeClient && this.activeClient !== ws && this.activeClient.readyState === WebSocket.OPEN) {
        this.activeClient.close(1000, 'Replaced by new connection');
      }
      
      this.activeClient = ws;
      this.lastSeen = Date.now();

      ws.send(JSON.stringify({
        type: 'auth_success',
        server: 'browserpilot-mcp',
        timestamp: Date.now()
      }));

      ws.on('message', (data: Buffer | string) => {
        this.lastSeen = Date.now();
        try {
          const msg: WebSocketInboundMessage = JSON.parse(data.toString());
          this.handleInboundMessage(msg);
        } catch (e) {
          console.error('[WebSocketHub] Failed to parse incoming message:', e);
        }
      });

      ws.on('close', (code, reason) => {
        console.error(`[WebSocketHub] Extension disconnected (code: ${code}, reason: ${reason})`);
        if (this.activeClient === ws) {
          this.activeClient = null;
        }
        for (const [id, req] of this.pendingRequests.entries()) {
          clearTimeout(req.timer);
          req.reject(new Error('Extension disconnected before command response was received'));
          this.pendingRequests.delete(id);
        }
      });

      ws.on('error', (err) => {
        console.error('[WebSocketHub] Client socket error:', err);
      });
    });
  }


  private authenticate(req: IncomingMessage): boolean {
    if (!this.secretToken) return true;

    try {
      const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const tokenInQuery = parsedUrl.searchParams.get('token');
      if (tokenInQuery && tokenInQuery === this.secretToken) {
        return true;
      }
    } catch {
      // Fallback
    }

    const tokenHeader = req.headers['x-token'] || req.headers['authorization'];
    if (tokenHeader) {
      const headerStr = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
      const cleanToken = headerStr.startsWith('Bearer ') ? headerStr.slice(7).trim() : headerStr.trim();
      if (cleanToken === this.secretToken) {
        return true;
      }
    }

    return false;
  }

  private handleInboundMessage(msg: WebSocketInboundMessage) {
    if (msg.type === 'ping') {
      if (this.activeClient && this.activeClient.readyState === WebSocket.OPEN) {
        this.activeClient.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
      return;
    }

    if (msg.id && this.pendingRequests.has(msg.id)) {
      const req = this.pendingRequests.get(msg.id)!;
      clearTimeout(req.timer);
      this.pendingRequests.delete(msg.id);

      if (msg.success) {
        req.resolve(msg.result);
      } else {
        req.reject(new Error(msg.error || 'Unknown error occurred in browser extension'));
      }
    }
  }

  public isConnected(): boolean {
    return this.activeClient !== null && this.activeClient.readyState === WebSocket.OPEN;
  }

  public getStatus() {
    return {
      connected: this.isConnected(),
      lastSeen: this.lastSeen ? new Date(this.lastSeen).toISOString() : null,
      port: this.port
    };
  }

  public dispatch<T = any>(
    action: BrowserActionType,
    params: Record<string, any> = {},
    timeoutMs: number = 35000
  ): Promise<T> {
    if (!this.isConnected()) {
      return Promise.reject(
        new Error(
          'BrowserPilot Chrome Extension is not connected. Please open your local browser, verify the extension is loaded, and ensure it is connected to ws://<your-vps-ip>:' +
            this.port
        )
      );
    }

    const id = `cmd_${Date.now()}_${++this.requestCounter}`;
    const command: CommandRequest = { id, action, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Command '${action}' timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        this.activeClient!.send(JSON.stringify(command));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          this.wss = null;
          this.activeClient = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
