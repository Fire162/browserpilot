/**
 * Unit tests for extension/dialog-hook.js.
 *
 * Verifies that the dialog hook correctly overrides alert, confirm, and prompt
 * in the page's MAIN world context without throwing ReferenceErrors or leaking
 * into page code, and respects the configured policy.
 *
 * Run with:  npx tsx test/test-dialog-hook.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hookSource = fs.readFileSync(path.join(here, '..', '..', 'extension', 'dialog-hook.js'), 'utf8');

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    console.error(`  ❌ ${name}\n     ${err?.message || err}`);
    throw err;
  }
}

function createContext(): any {
  const listeners: Record<string, Function[]> = {};
  const fakeWindow: any = {
    addEventListener: (event: string, handler: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    removeEventListener: (event: string, handler: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    }
  };
  const ctx = { window: fakeWindow, globalThis: fakeWindow };
  fakeWindow.window = fakeWindow;
  vm.createContext(ctx);
  return ctx;
}

console.log('🧪 Dialog hook tests\n');

check('installs cleanly and overrides dialog functions without TDZ error', () => {
  const ctx = createContext();
  vm.runInContext(hookSource, ctx);

  assert.equal(ctx.window.__browserpilotDialogHookInstalled, true);
  assert.equal(ctx.window.__browserpilotDialogHookVersion, 1);
  assert.equal(Array.isArray(ctx.window.__browserpilotDialogLog), true);
  assert.equal(typeof ctx.window.alert, 'function');
  assert.equal(typeof ctx.window.confirm, 'function');
  assert.equal(typeof ctx.window.prompt, 'function');
});

check('default dismiss policy resolves alert, confirm and prompt safely', () => {
  const ctx = createContext();
  vm.runInContext(hookSource, ctx);

  const alertRes = ctx.window.alert('Important notice');
  assert.equal(alertRes, undefined);

  const confirmRes = ctx.window.confirm('Are you sure?');
  assert.equal(confirmRes, false);

  const promptRes = ctx.window.prompt('Enter PIN:', '1234');
  assert.equal(promptRes, null);

  const log = ctx.window.__browserpilotDialogLog;
  assert.equal(log.length, 3);
  assert.equal(log[0].type, 'alert');
  assert.equal(log[0].message, 'Important notice');
  assert.equal(log[0].resolvedWith, 'dismiss');
  assert.equal(log[0].value, null);

  assert.equal(log[1].type, 'confirm');
  assert.equal(log[1].message, 'Are you sure?');
  assert.equal(log[1].resolvedWith, 'dismiss');
  assert.equal(log[1].value, false);

  assert.equal(log[2].type, 'prompt');
  assert.equal(log[2].message, 'Enter PIN:');
  assert.equal(log[2].resolvedWith, 'dismiss');
  assert.equal(log[2].value, null);
});

check('accept policy returns true for confirm and configured promptText for prompt', () => {
  const ctx = createContext();
  ctx.window.__browserpilotDialogConfig = { policy: 'accept', promptText: 'AutoValue' };
  vm.runInContext(hookSource, ctx);

  const confirmRes = ctx.window.confirm('Proceed?');
  assert.equal(confirmRes, true);

  const promptRes = ctx.window.prompt('Your name?');
  assert.equal(promptRes, 'AutoValue');

  const log = ctx.window.__browserpilotDialogLog;
  assert.equal(log[0].resolvedWith, 'accept');
  assert.equal(log[0].value, true);
  assert.equal(log[1].resolvedWith, 'accept');
  assert.equal(log[1].value, 'AutoValue');
});

check('idempotent: re-executing does not reset logs or re-install', () => {
  const ctx = createContext();
  vm.runInContext(hookSource, ctx);
  ctx.window.alert('First message');
  assert.equal(ctx.window.__browserpilotDialogLog.length, 1);

  // Re-run script (simulating re-injection)
  vm.runInContext(hookSource, ctx);
  assert.equal(ctx.window.__browserpilotDialogLog.length, 1);
  assert.equal(ctx.window.__browserpilotDialogLog[0].message, 'First message');
});

console.log(`\n🎉 All ${passed} dialog hook checks passed.\n`);
