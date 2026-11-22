/**
 * Security regression tests for the P0 hardening pass.
 *
 * Run with:  npx tsx test/test-security.ts
 *
 * Covers: origin gate, token requirement, rate limiting, unknown/gated actions,
 * body caps, SSE crash-safety and the WebSocket handshake origin check.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebSocketHub } from '../src/websocket-hub.js';
import { createHttpServer } from '../src/http-server.js';
import { ActionPolicy, AuthRateLimiter, isOriginAllowed } from '../src/policy.js';
import { DaemonConfig, assertSecureConfig, generateToken, resolveSecretToken } from '../src/config.js';

const TOKEN = 'test-token-0123456789';
let passed = 0;

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    console.error(`  ❌ ${name}\n     ${err?.message || err}`);
    throw err;
  }
}

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    port: 0,
    bindHost: '127.0.0.1',
    secretToken: TOKEN,
    tokenSource: 'env',
    usesLegacyDefaultToken: false,
    allowInsecureToken: false,
    allowedOrigins: [],
    allowCodeExecution: false,
    allowCookieAccess: false,
    maxBodyBytes: 1024,
    authMaxFailures: 10,
    authWindowMs: 60_000,
    authBlockMs: 60_000,
    ...overrides
  };
}

interface Harness {
  server: http.Server;
  hub: WebSocketHub;
  port: number;
  close: () => Promise<void>;
}

async function startHarness(config: DaemonConfig): Promise<Harness> {
  const policy = new ActionPolicy({
    allowCodeExecution: config.allowCodeExecution,
    allowCookieAccess: config.allowCookieAccess
  });
  const limiter = new AuthRateLimiter(config.authMaxFailures, config.authWindowMs, config.authBlockMs);
  const hub = new WebSocketHub(config.port, config.secretToken, {
    allowedOrigins: config.allowedOrigins,
    policy,
    rateLimiter: limiter
  });
  const server = createHttpServer(
    hub,
    config,
    () => new McpServer({ name: 'test', version: '0.0.0' }),
    { limiter }
  );

  hub.attachToServer(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    server,
    hub,
    port,
    close: async () => {
      await hub.stop();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

async function run() {
  console.log('🧪 BrowserPilot security regression tests\n');

  // ---------------------------------------------------------------------------
  console.log('Origin policy (unit)');
  await check('absent origin is allowed (native clients)', () => {
    assert.equal(isOriginAllowed(undefined), true);
  });
  await check('chrome-extension origin is allowed', () => {
    assert.equal(isOriginAllowed('chrome-extension://abcdefghijklmnop'), true);
  });
  await check('arbitrary website origin is rejected', () => {
    assert.equal(isOriginAllowed('https://evil.example'), false);
  });
  await check('extra allow-listed origin is honoured', () => {
    assert.equal(isOriginAllowed('https://dash.example', ['https://dash.example']), true);
  });
  await check('opaque "null" origin is rejected', () => {
    assert.equal(isOriginAllowed('null'), false);
  });

  // ---------------------------------------------------------------------------
  console.log('\nHTTP surface');
  const harness = await startHarness(makeConfig());

  await check('no token → 401', async () => {
    const res = await post(harness.port, '/api/dispatch', { action: 'status' });
    assert.equal(res.status, 401);
  });

  await check('legacy default token is rejected when a real one is configured', async () => {
    const res = await post(harness.port, '/api/dispatch', { action: 'status' }, { 'x-token': 'browserpilot-secret' });
    assert.equal(res.status, 401);
  });

  await check('untrusted browser origin → 403 before auth', async () => {
    const res = await post(
      harness.port,
      '/api/dispatch',
      { action: 'status' },
      { 'x-token': TOKEN, Origin: 'https://evil.example' }
    );
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null, 'wildcard/reflected CORS must not be sent');
  });

  await check('allowed extension origin gets an echoed CORS header', async () => {
    const origin = 'chrome-extension://abcdefghijklmnop';
    const res = await post(harness.port, '/api/dispatch', { action: 'status' }, { 'x-token': TOKEN, Origin: origin });
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.equal(res.headers.get('vary'), 'Origin');
  });

  await check('unknown action → 400', async () => {
    const res = await post(harness.port, '/api/dispatch', { action: 'rm_rf_everything' }, { 'x-token': TOKEN });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'UNKNOWN_ACTION');
  });

  await check('run_code is refused while code execution is disabled', async () => {
    const res = await post(harness.port, '/api/dispatch', { action: 'run_code', params: {} }, { 'x-token': TOKEN });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'POLICY_DISABLED');
    assert.match(body.error, /ALLOW_CODE_EXECUTION/);
  });

  await check('get_cookies is refused while cookie export is disabled', async () => {
    const res = await post(harness.port, '/api/dispatch', { action: 'get_cookies', params: {} }, { 'x-token': TOKEN });
    assert.equal(res.status, 403);
  });

  await check('oversized body → 413', async () => {
    const big = JSON.stringify({ action: 'status', params: { pad: 'x'.repeat(5000) } });
    const res = await post(harness.port, '/api/dispatch', big, { 'x-token': TOKEN });
    assert.equal(res.status, 413);
  });

  await check('malformed JSON → 400 (daemon stays alive)', async () => {
    const res = await post(harness.port, '/api/dispatch', '{not json', { 'x-token': TOKEN });
    assert.equal(res.status, 400);
  });

  await check('/status reports the capability posture without leaking the token', async () => {
    const res = await fetch(`http://127.0.0.1:${harness.port}/status`);
    const body = await res.json();
    assert.equal(body.security.allowCodeExecution, false);
    assert.equal(body.security.allowCookieAccess, false);
    assert.ok(!JSON.stringify(body).includes(TOKEN), 'status must not expose the secret');
  });

  await check('SSE without a token → 401 (no unhandled rejection)', async () => {
    const res = await fetch(`http://127.0.0.1:${harness.port}/sse`);
    assert.equal(res.status, 401);
  });

  await harness.close();

  // ---------------------------------------------------------------------------
  console.log('\nRate limiting');
  const limited = await startHarness(makeConfig({ authMaxFailures: 3 }));
  await check('repeated bad tokens → 429', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await post(limited.port, '/api/dispatch', { action: 'status' }, { 'x-token': 'wrong-token' });
      assert.equal(res.status, 401);
    }
    const res = await post(limited.port, '/api/dispatch', { action: 'status' }, { 'x-token': 'wrong-token' });
    assert.equal(res.status, 429);
  });
  await limited.close();

  // ---------------------------------------------------------------------------
  console.log('\nCapability gate enabled');
  const open = await startHarness(makeConfig({ allowCodeExecution: true }));
  await check('run_code passes the gate when ALLOW_CODE_EXECUTION=true', async () => {
    const res = await post(open.port, '/api/dispatch', { action: 'run_code', params: {} }, { 'x-token': TOKEN });
    // No extension attached → 503, which proves the action cleared the gate.
    assert.equal(res.status, 503);
  });
  await open.close();

  // ---------------------------------------------------------------------------
  console.log('\nWebSocket handshake');
  const wsHarness = await startHarness(makeConfig());

  await check('handshake with an untrusted browser origin is rejected', async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${wsHarness.port}?token=${TOKEN}`, {
        origin: 'https://evil.example'
      });
      socket.on('open', () => {
        socket.close();
        reject(new Error('handshake should have been rejected'));
      });
      socket.on('error', () => resolve());
    });
  });

  await check('handshake without a token is rejected', async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${wsHarness.port}`);
      socket.on('open', () => {
        socket.close();
        reject(new Error('handshake should have been rejected'));
      });
      socket.on('error', () => resolve());
    });
  });

  await check('valid handshake connects and dispatches', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${wsHarness.port}?token=${TOKEN}`);
    await new Promise<void>((resolve, reject) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'auth_success') return resolve();
        if (msg.action === 'status') {
          socket.send(JSON.stringify({ id: msg.id, success: true, result: { activeTab: null, totalTabs: 0 } }));
        }
      });
      socket.on('error', reject);
    });

    const result: any = await wsHarness.hub.dispatch('status', {});
    assert.equal(result.totalTabs, 0);
    socket.close();
  });

  await check('policy gate also applies to the WebSocket dispatch path', async () => {
    await assert.rejects(() => wsHarness.hub.dispatch('run_code', { code: '1' }), /ALLOW_CODE_EXECUTION/);
  });

  await wsHarness.close();

  // ---------------------------------------------------------------------------
  console.log('\nToken resolution');
  await check('generated tokens are long, random and never the public default', () => {
    const a = generateToken();
    const b = generateToken();
    assert.ok(a.length >= 32);
    assert.notEqual(a, b);
    assert.notEqual(a, 'browserpilot-secret');
  });

  await check('startup refuses an empty token (fail closed)', () => {
    assert.throws(() => assertSecureConfig(makeConfig({ secretToken: '' })), /Refusing to start without a SECRET_TOKEN/);
  });

  await check('startup refuses the public legacy token by default', () => {
    assert.throws(
      () => assertSecureConfig(makeConfig({ secretToken: 'browserpilot-secret', usesLegacyDefaultToken: true })),
      /public default SECRET_TOKEN/
    );
  });

  await check('legacy token requires an explicit insecure opt-out', () => {
    assert.doesNotThrow(() =>
      assertSecureConfig(
        makeConfig({
          secretToken: 'browserpilot-secret',
          usesLegacyDefaultToken: true,
          allowInsecureToken: true
        })
      )
    );
  });

  await check('a strong token passes startup validation', () => {
    assert.doesNotThrow(() => assertSecureConfig(makeConfig()));
  });

  await check('a configured token wins over generation', () => {
    const previous = process.env.SECRET_TOKEN;
    process.env.SECRET_TOKEN = 'explicit-token-123456';
    const resolved = resolveSecretToken();
    assert.equal(resolved.token, 'explicit-token-123456');
    assert.equal(resolved.source, 'env');
    if (previous === undefined) delete process.env.SECRET_TOKEN;
    else process.env.SECRET_TOKEN = previous;
  });

  console.log(`\n🎉 All ${passed} security checks passed.`);
}

run().catch((err) => {
  console.error('\n❌ Security tests failed:', err);
  process.exit(1);
});
