/**
 * BrowserPilot dialog hook — MUST run in the page's MAIN world.
 *
 * Content scripts live in an isolated world, so overriding `window.alert` there
 * only affected the content script itself; the page's own `alert()`/`confirm()`
 * still opened a native modal and froze the tab, which is what
 * `browser_handle_dialog` was supposed to prevent. This file is injected with
 * `chrome.scripting.executeScript({ world: 'MAIN' })` and therefore replaces the
 * real page functions.
 *
 * Native dialogs are synchronous, so a dialog can never wait for the agent to
 * answer it. Instead each dialog is resolved immediately from the configured
 * policy (dashboard "accept" or "dismiss"), recorded in
 * `window.__browserpilotDialogLog`, and reported back to the agent afterwards.
 * Default policy is `dismiss` (least privilege).
 *
 * The file must stay self-contained and defensive: it runs inside third-party
 * pages and must never throw into page code.
 */
(() => {
  'use strict';

  try {
    if (window.__browserpilotDialogHookInstalled) {
      return;
    }
    const HOOK_VERSION = 1;
    window.__browserpilotDialogHookInstalled = true;
    window.__browserpilotDialogHookVersion = HOOK_VERSION;

    const MAX_LOG = 20;
    const log = [];
    window.__browserpilotDialogLog = log;

    const readConfig = () => {
      const cfg = window.__browserpilotDialogConfig;
      const policy = cfg && (cfg.policy === 'accept' || cfg.policy === 'dismiss') ? cfg.policy : 'dismiss';
      return { policy, promptText: cfg && typeof cfg.promptText === 'string' ? cfg.promptText : '' };
    };

    const record = (type, message, policy, value) => {
      try {
        log.push({
          type,
          message: String(message === undefined ? '' : message),
          resolvedWith: policy,
          value: value === undefined ? null : value,
          timestamp: Date.now()
        });
        if (log.length > MAX_LOG) log.shift();
      } catch (err) {
        // never throw into page code
      }
    };

    const safe = (fn, fallback) => {
      try {
        return fn();
      } catch (err) {
        return fallback;
      }
    };

    window.alert = function browserpilotAlert(message) {
      safe(() => record('alert', message, readConfig().policy, undefined));
      // No return value, exactly like the native function.
    };

    window.confirm = function browserpilotConfirm(message) {
      const { policy } = readConfig();
      const accepted = policy === 'accept';
      safe(() => record('confirm', message, policy, accepted));
      return accepted;
    };

    window.prompt = function browserpilotPrompt(message, defaultValue) {
      const { policy, promptText } = readConfig();
      if (policy === 'accept') {
        const value = promptText || (typeof defaultValue === 'string' ? defaultValue : '');
        safe(() => record('prompt', message, policy, value));
        return value;
      }
      safe(() => record('prompt', message, policy, null));
      return null;
    };

    // Automation frequently navigates away; a native "Leave site?" prompt would
    // block the tab until a human clicked it. Suppress it only on tabs where the
    // extension is active (i.e. a config has been installed), and leave the
    // page's own handlers untouched so nothing else changes.
    window.addEventListener(
      'beforeunload',
      (event) => {
        if (!window.__browserpilotDialogConfig) return;
        try {
          event.returnValue = '';
          delete event.returnValue;
        } catch (err) {
          // ignore
        }
      },
      { capture: true }
    );

  } catch (err) {
    // Never propagate into the page.
  }
})();
