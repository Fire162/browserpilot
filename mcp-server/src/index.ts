import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import { WebSocketHub } from './websocket-hub.js';
import { registerBrowserTools } from './tools.js';

// Load environment variables
dotenv.config();

const WS_PORT = parseInt(process.env.WS_PORT || process.env.PORT || '8765', 10);
const SECRET_TOKEN = process.env.SECRET_TOKEN || 'browserpilot-secret';

async function main() {
  console.error('====================================================');
  console.error('🚀 Starting BrowserPilot MCP Server...');
  console.error('====================================================');

  // 1. Initialize and start WebSocket Hub for Chrome Extension
  const hub = new WebSocketHub(WS_PORT, SECRET_TOKEN);
  await hub.start();

  // 2. Initialize MCP Server
  const mcpServer = new McpServer({
    name: 'browserpilot-mcp',
    version: '1.0.0'
  });

  // 3. Register Browser Automation Tools
  registerBrowserTools(mcpServer, hub);

  // 4. Connect MCP Server to Stdio Transport
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  console.error('✅ BrowserPilot MCP Server is running and listening on stdio.');
  console.error(`📡 WebSocket endpoint for Chrome Extension: ws://<your-vps-ip>:${WS_PORT}`);
  console.error(`🔑 Secret Token: ${SECRET_TOKEN}`);
  console.error('====================================================');

  // Graceful shutdown handling
  const shutdown = async () => {
    console.error('\n🛑 Shutting down BrowserPilot MCP Server...');
    await hub.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('❌ Fatal error in BrowserPilot MCP Server:', err);
  process.exit(1);
});
