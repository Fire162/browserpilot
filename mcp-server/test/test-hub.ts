/**
 * WebSocket hub behaviour tests.
 *
 * Regression coverage for two P1 bugs:
 *  - a reconnect used to reject commands that had just been dispatched on the
 *    *new* socket (the old socket's close handler drained the shared map),
 *  - a half-open socket was reported as connected forever, so every call burned
 *    its full timeout.
 *
 * Run with:  npx tsx test/test-hub.ts
 */
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { WebSocketHub } from '../src/websocket-hub.js';
import { ActionPolicy } from '../src/policy.js';

const TOKEN = 'hub-test-token-0123456789';
let passed = 0;

function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✅ ${name}`);
    })
    .catch((err: any) => {
      console.error(`  ❌ ${name}\n     ${err?.message || err}`);
      throw err;
    });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}?token=${TOKEN}`);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return socket;
}

/** Replies to commands with a configurable delay so races are reproducible. */
function autoResponder(socket: WebSocket, replyDelayMs = 0): void {
  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (!msg.action) return;
    setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          id: msg.id,
          success: true,
          result: { echoed: msg.action, tabs: 2, activeTab: { id: 1, title: 't', url: 'https://example.com' } }
        })
      );
    }, replyDelayMs);
  });
}

async function main() {
  console.log('🧪 WebSocket hub tests\n');

  // -------------------------------------------------------------------------
  // 1. A replaced socket must not kill commands sent on the new one.
  // -------------------------------------------------------------------------
  {
    const hub = new WebSocketHub(0, TOKEN, {
      policy: new ActionPolicy({ allowCodeExecution: false, allowCookieAccess: false }),
      staleAfterMs: 10_000
    });

    await hub.start();
    const port = hub.getPort();

    const first = await connect(port);
    first.on('error', () => {});

    // Freeze the old socket so the server's close handshake for it cannot
    // complete yet. This is what makes the race deterministic: the close event
    // for the *previous* socket lands while a command is in flight on the new
    // one, which is exactly when the old implementation rejected everything.
    const firstSocket = (first as any)._socket;
    firstSocket.pause();

    // Second connection replaces the first; the server starts closing it.
    const second = await connect(port);
    autoResponder(second, 200); // reply after the old socket has closed

    const pending = hub.dispatch('status', {}, 3000);
    await delay(20);

    // Let the old socket acknowledge the close frame now that a command is
    // already outstanding on the new connection.
    firstSocket.resume();

    await check('commands dispatched on the new socket survive the old socket close', async () => {
      const result: any = await pending;
      assert.equal(result.echoed, 'status');
    });

    await check('the old socket is actually closed', async () => {
      await delay(50);
      assert.equal(first.readyState, WebSocket.CLOSED);
    });

    first.terminate();
    second.close();
    await hub.stop();
  }

  // -------------------------------------------------------------------------
  // 2. Silence makes the bridge stale instead of "connected".
  // -------------------------------------------------------------------------
  {
    const hub = new WebSocketHub(0, TOKEN, {
      policy: new ActionPolicy({ allowCodeExecution: false, allowCookieAccess: false }),
      staleAfterMs: 120
    });
    await hub.start();
    const port = hub.getPort();
    const socket = await connect(port);

    await check('freshly connected bridge is online and not stale', () => {
      const status = hub.getStatus();
      assert.equal(status.connected, true);
      assert.equal(status.stale, false);
    });

    await check('a silent bridge is reported stale, not connected', async () => {
      await delay(200);
      const status = hub.getStatus();
      assert.equal(status.stale, true);
      assert.equal(status.connected, false);
      assert.ok((status.silentForMs ?? 0) >= 120);
    });

    await check('dispatch fails fast with an actionable message when stale', async () => {
      await assert.rejects(() => hub.dispatch('status', {}, 3000), /stopped responding/);
    });

    await check('a single heartbeat restores the connection', async () => {
      const pong = new Promise<void>((resolve) => socket.once('message', () => resolve()));
      socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      await pong;
      const status = hub.getStatus();
      assert.equal(status.connected, true);
      assert.equal(status.stale, false);
    });

    socket.close();
    await hub.stop();
  }

  // -------------------------------------------------------------------------
  // 3. Disconnects still fail the commands that were actually in flight.
  // -------------------------------------------------------------------------
  {
    const hub = new WebSocketHub(0, TOKEN, {
      policy: new ActionPolicy({ allowCodeExecution: false, allowCookieAccess: false }),
      staleAfterMs: 10_000
    });
    await hub.start();
    const socket = await connect(hub.getPort()); // never answers

    await check('a command in flight is rejected when its socket disconnects', async () => {
      const pending = hub.dispatch('status', {}, 5000);
      await delay(50);
      socket.close();
      await assert.rejects(() => pending, /disconnected/);
    });

    await hub.stop();
  }

  console.log(`\n🎉 All ${passed} hub checks passed.`);
}

main().catch((err) => {
  console.error('\n❌ Hub tests failed:', err);
  process.exit(1);
});
