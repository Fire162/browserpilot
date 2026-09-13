import { WebSocket } from 'ws';
import { WebSocketHub } from '../src/websocket-hub.js';

async function runTest() {
  console.log('🧪 Starting BrowserPilot Bridge Integration Test...');

  const PORT = 9876;
  const SECRET = 'test-secret-123';

  // 1. Start Server Hub
  const hub = new WebSocketHub(PORT, SECRET);
  await hub.start();
  console.log('✅ Server hub started on port', PORT);

  // 2. Connect Mock Extension Client
  const ws = new WebSocket(`ws://localhost:${PORT}?token=${SECRET}`);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      console.log('✅ Mock Extension connected over WebSocket.');
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      console.log('📨 Mock Extension received command:', msg.action, 'id:', msg.id);

      if (msg.action === 'status') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            result: {
              activeTab: { id: 101, title: 'GitHub', url: 'https://github.com' },
              totalTabs: 3
            }
          })
        );
      } else if (msg.action === 'navigate') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            result: {
              tabId: 101,
              title: 'Navigated Page',
              url: msg.params.url
            }
          })
        );
      } else if (msg.action === 'read_page') {
        ws.send(
          JSON.stringify({
            id: msg.id,
            success: true,
            result: {
              title: 'Navigated Page',
              url: 'https://example.com',
              content: '# Example Heading\nThis is sample readable text.'
            }
          })
        );
      } else if (msg.type === 'auth_success') {
        resolve();
      }
    });

    ws.on('error', reject);
  });

  // 3. Test Dispatches from Hub
  console.log('⚡ Testing status dispatch...');
  const statusRes = await hub.dispatch('status', {});
  console.log('Result:', statusRes);
  if (statusRes.activeTab.title !== 'GitHub') throw new Error('Status test failed');

  console.log('⚡ Testing navigate dispatch...');
  const navRes = await hub.dispatch('navigate', { url: 'https://example.com' });
  console.log('Result:', navRes);
  if (navRes.url !== 'https://example.com') throw new Error('Navigate test failed');

  console.log('⚡ Testing read_page dispatch...');
  const readRes = await hub.dispatch('read_page', { format: 'markdown' });
  console.log('Result:', readRes);
  if (!readRes.content.includes('Example Heading')) throw new Error('Read page test failed');

  // 4. Teardown
  ws.close();
  await hub.stop();
  console.log('🎉 All Bridge Tests Passed Successfully!');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
