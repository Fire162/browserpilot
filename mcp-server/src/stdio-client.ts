import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import http from 'http';
import { BrowserActionType, BrowserDispatcher } from './types.js';
import { registerBrowserTools } from './tools.js';

dotenv.config();

const PORT = parseInt(process.env.WS_PORT || process.env.PORT || '8770', 10);
const HOST = 'localhost';

class HttpDaemonDispatcher implements BrowserDispatcher {
  public async getStatus(): Promise<{ connected: boolean; lastSeen: string | null; port?: number }> {
    try {
      const res = await this.httpGet('/status');
      return res.hub || { connected: false, lastSeen: null, port: PORT };
    } catch {
      return { connected: false, lastSeen: null, port: PORT };
    }
  }

  public async dispatch<T = any>(
    action: BrowserActionType,
    params: Record<string, any> = {},
    timeoutMs: number = 35000
  ): Promise<T> {
    try {
      const response = await this.httpPost('/api/dispatch', { action, params, timeoutMs });
      if (response.success) {
        return response.result;
      }
      throw new Error(response.error || 'Dispatch returned error');
    } catch (err: any) {
      if (err.code === 'ECONNREFUSED') {
        throw new Error(
          `BrowserPilot daemon is not running on port ${PORT}. Please ensure the service is running (e.g., 'fire start browserpilot').`
        );
      }
      throw err;
    }
  }

  private httpGet(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const req = http.get({ host: HOST, port: PORT, path }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
    });
  }

  private httpPost(path: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request(
        {
          host: HOST,
          port: PORT,
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}

async function main() {
  const dispatcher = new HttpDaemonDispatcher();
  const mcpServer = new McpServer({
    name: 'browserpilot-mcp',
    version: '1.0.0'
  });

  registerBrowserTools(mcpServer, dispatcher as any);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error('[BrowserPilot Stdio Bridge] Connected to AGY over stdio.');
}

main().catch((err) => {
  console.error('[BrowserPilot Stdio Bridge] Fatal error:', err);
  process.exit(1);
});
