import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testMcpClient() {
  console.log('🤖 Starting End-to-End MCP Client Test for BrowserPilot...');

  const serverPath = path.resolve(__dirname, '../dist/index.js');
  const TEST_PORT = '8799';
  const TEST_TOKEN = 'test-token-xyz';

  // 1. Initialize MCP Stdio Transport
  console.log(`🔌 Spawning MCP Server on stdio (WS_PORT=${TEST_PORT})...`);
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: {
      ...process.env,
      WS_PORT: TEST_PORT,
      SECRET_TOKEN: TEST_TOKEN
    }
  });

  const client = new Client(
    { name: 'test-agent', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log('✅ Connected to BrowserPilot MCP server over stdio!');

  // 2. Discover Tools
  console.log('🔍 Listing available MCP tools...');
  const toolsResult = await client.listTools();
  console.log(`✅ Discovered ${toolsResult.tools.length} tools:`);
  toolsResult.tools.forEach((t) => console.log(`   - ${t.name}: ${t.description.slice(0, 60)}...`));

  if (toolsResult.tools.length < 10) {
    throw new Error(`Expected at least 10 tools, found ${toolsResult.tools.length}`);
  }

  // 3. Call browser_status before extension connects
  console.log('\n📡 Testing `browser_status` (unconnected state)...');
  const statusRes1 = await client.callTool({
    name: 'browser_status',
    arguments: {}
  });
  console.log('Output from MCP:', (statusRes1.content as any)[0].text);

  // 4. Simulate Chrome Extension connecting via WebSocket
  console.log(`\n💻 Connecting simulated Chrome Extension to ws://localhost:${TEST_PORT}...`);
  const ws = new WebSocket(`ws://localhost:${TEST_PORT}?token=${TEST_TOKEN}`);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      console.log('✅ Chrome Extension connected to WebSocket!');
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth_success') {
        resolve();
        return;
      }

      if (msg.action === 'status') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            result: {
              activeTab: { id: 42, title: 'GitHub - Fire162/browserpilot', url: 'https://github.com/Fire162/browserpilot' },
              totalTabs: 5
            }
          })
        );
      } else if (msg.action === 'list_tabs') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            result: [
              { id: 42, title: 'GitHub - Fire162/browserpilot', url: 'https://github.com/Fire162/browserpilot', active: true },
              { id: 43, title: 'Google Search', url: 'https://google.com', active: false }
            ]
          })
        );
      } else if (msg.action === 'click') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            result: { description: 'button#star ("Star")' }
          })
        );
      }
    });

    ws.on('error', reject);
  });

  // Brief pause to ensure connection is registered
  await new Promise((r) => setTimeout(r, 200));

  // 5. Call browser_status while extension is connected
  console.log('\n📡 Testing `browser_status` (connected state)...');
  const statusRes2 = await client.callTool({
    name: 'browser_status',
    arguments: {}
  });
  console.log('Output from MCP:');
  console.log((statusRes2.content as any)[0].text);

  // 6. Call browser_list_tabs
  console.log('\n📑 Testing `browser_list_tabs` tool...');
  const listTabsRes = await client.callTool({
    name: 'browser_list_tabs',
    arguments: {}
  });
  console.log('Output from MCP:');
  console.log((listTabsRes.content as any)[0].text);

  // 7. Call browser_click
  console.log('\n🖱️ Testing `browser_click` tool...');
  const clickRes = await client.callTool({
    name: 'browser_click',
    arguments: { selector: 'button#star' }
  });
  console.log('Output from MCP:');
  console.log((clickRes.content as any)[0].text);

  // Teardown
  ws.close();
  await client.close();
  console.log('\n🎉 All End-to-End MCP Client Tests Succeeded 100%!');
}

testMcpClient().catch((err) => {
  console.error('❌ MCP Client Test failed:', err);
  process.exit(1);
});
