import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import { DaemonClient } from './daemon-client.js';
import { registerBrowserTools } from './tools.js';

dotenv.config();

async function main() {
  const client = new DaemonClient();
  const mcpServer = new McpServer({
    name: 'browserpilot-mcp',
    version: '1.4.0'
  });

  registerBrowserTools(mcpServer, client);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error('[BrowserPilot Stdio Bridge] Connected to AGY over stdio.');
}

main().catch((err) => {
  console.error('[BrowserPilot Stdio Bridge] Fatal error:', err);
  process.exit(1);
});
