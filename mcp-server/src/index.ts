import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import { WebSocketHub } from './websocket-hub.js';
import { registerBrowserTools } from './tools.js';
import { loadConfig, DaemonConfig, SERVER_VERSION, USER_ENV_FILE } from './config.js';
import { ActionPolicy, AuthRateLimiter } from './policy.js';
import { createHttpServer } from './http-server.js';

// Load environment variables
dotenv.config();

const RUN_STDIO = process.argv.includes('--stdio') || process.env.MCP_STDIO === 'true';

function createConfiguredMcpServer(hub: WebSocketHub): McpServer {
  const server = new McpServer({
    name: 'browserpilot-mcp',
    version: SERVER_VERSION
  });
  registerBrowserTools(server, hub, hub.getPolicy());
  return server;
}

function assertStartupSafety(config: DaemonConfig): void {
  if (!config.secretToken) {
    throw new Error(
      'Refusing to start without a SECRET_TOKEN. Set SECRET_TOKEN in the environment or in ' +
        `${USER_ENV_FILE}, then restart the daemon.`
    );
  }

  if (config.usesLegacyDefaultToken) {
    console.error('');
    console.error('⚠️  SECURITY: SECRET_TOKEN is set to the public default value, which is');
    console.error('   documented in this repository and known to everyone.');
    console.error('   Rotate it now:  delete the SECRET_TOKEN line from your environment/.env,');
    console.error('   restart the daemon (a strong token is generated automatically), and');
    console.error('   paste the new token into the extension popup.');
    console.error('');
  }

  if (config.bindHost !== '127.0.0.1' && config.bindHost !== 'localhost' && config.bindHost !== '::1') {
    console.error(
      `ℹ️  Listening on ${config.bindHost}. Use BROWSERPILOT_BIND=127.0.0.1 when a tunnel on this ` +
        'host is the only ingress.'
    );
  }
}

async function main() {
  const config = loadConfig();

  console.error('====================================================');
  console.error('🚀 Starting BrowserPilot Daemon & MCP Server...');
  console.error('====================================================');

  assertStartupSafety(config);

  const policy = new ActionPolicy({
    allowCodeExecution: config.allowCodeExecution,
    allowCookieAccess: config.allowCookieAccess
  });
  const rateLimiter = new AuthRateLimiter(config.authMaxFailures, config.authWindowMs, config.authBlockMs);

  // 1. Initialize WebSocket Hub
  const hub = new WebSocketHub(config.port, config.secretToken, {
    allowedOrigins: config.allowedOrigins,
    policy,
    rateLimiter
  });

  // 2. Create unified HTTP server (origin checks, auth, body caps, no crashes)
  const httpServer = createHttpServer(hub, config, () => createConfiguredMcpServer(hub), {
    limiter: rateLimiter
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
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.bindHost, () => {
      httpServer.removeListener('error', reject);
      console.error(`✅ BrowserPilot listening on http://${config.bindHost}:${config.port}`);
      console.error(`📡 WebSocket endpoint for Chrome Extension: ws://<your-vps-ip>:${config.port}`);
      console.error(`🔌 MCP SSE endpoint: http://<your-vps-ip>:${config.port}/sse`);
      console.error(
        `🔑 Secret Token: ${config.secretToken.slice(0, 6)}… (${config.tokenSource === 'generated' ? `generated, saved to ${USER_ENV_FILE}` : `source: ${config.tokenSource}`})`
      );
      console.error(`   Run 'bp status' or read ${USER_ENV_FILE} to view the full token.`);
      console.error(
        `🧰 Dangerous tools: code execution ${config.allowCodeExecution ? 'ENABLED' : 'disabled'}, ` +
          `cookie export ${config.allowCookieAccess ? 'ENABLED' : 'disabled'}`
      );
      console.error('====================================================');
      resolve();
    });
  });

  // Graceful shutdown handling
  const shutdown = async () => {
    console.error('\n🛑 Shutting down BrowserPilot...');
    const forceExitTimer = setTimeout(() => process.exit(0), 1500);
    forceExitTimer.unref();

    try {
      await hub.stop();
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections();
      }
      httpServer.close(() => {
        clearTimeout(forceExitTimer);
        process.exit(0);
      });
    } catch {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('❌ Fatal error in BrowserPilot:', err);
  process.exit(1);
});
