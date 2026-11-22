import crypto from 'crypto';
import { BrowserActionType, isBrowserAction } from './types.js';

/**
 * Security policy shared by the HTTP API and the WebSocket hub.
 *
 * Two independent layers:
 * 1. Origin allow-list — blocks browser-based attacks (DNS rebinding, a random
 *    page opening a WebSocket to 127.0.0.1) even if the token ever leaks.
 * 2. Action policy — dangerous capabilities are disabled unless explicitly
 *    enabled by the operator.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Actions that require an explicit opt-in flag. */
export const GATED_ACTIONS: Partial<Record<BrowserActionType, { envVar: string; reason: string }>> = {
  run_code: {
    envVar: 'ALLOW_CODE_EXECUTION',
    reason: 'executes arbitrary JavaScript inside your logged-in browser session'
  },
  evaluate: {
    envVar: 'ALLOW_CODE_EXECUTION',
    reason: 'executes arbitrary JavaScript inside your logged-in browser session'
  },
  get_cookies: {
    envVar: 'ALLOW_COOKIE_ACCESS',
    reason: 'exports session cookies (including httpOnly credentials) to the agent'
  }
};

export class PolicyError extends Error {
  public readonly code = 'POLICY_DISABLED';
  constructor(
    message: string,
    public readonly action: BrowserActionType,
    public readonly envVar: string
  ) {
    super(message);
    this.name = 'PolicyError';
  }
}

export class UnknownActionError extends Error {
  public readonly code = 'UNKNOWN_ACTION';
  constructor(action: unknown) {
    super(`Unknown browser action '${String(action)}'.`);
    this.name = 'UnknownActionError';
  }
}

export interface ActionPolicyOptions {
  allowCodeExecution: boolean;
  allowCookieAccess: boolean;
}

export class ActionPolicy {
  private readonly options: ActionPolicyOptions;

  constructor(options: ActionPolicyOptions) {
    this.options = options;
  }

  public static fromEnv(env: NodeJS.ProcessEnv = process.env): ActionPolicy {
    const flag = (value: string | undefined): boolean =>
      Boolean(value) && ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
    return new ActionPolicy({
      allowCodeExecution: flag(env.ALLOW_CODE_EXECUTION),
      allowCookieAccess: flag(env.ALLOW_COOKIE_ACCESS)
    });
  }

  public isEnabled(action: BrowserActionType): boolean {
    const gate = GATED_ACTIONS[action];
    if (!gate) return true;
    return gate.envVar === 'ALLOW_CODE_EXECUTION'
      ? this.options.allowCodeExecution
      : this.options.allowCookieAccess;
  }

  public denialMessage(action: BrowserActionType): string {
    const gate = GATED_ACTIONS[action];
    if (!gate) return '';
    return (
      `Action '${action}' is disabled because it ${gate.reason}. ` +
      `Restart the daemon with ${gate.envVar}=true if you intend to allow it.`
    );
  }

  public assertAllowed(action: BrowserActionType): void {
    if (!this.isEnabled(action)) {
      throw new PolicyError(this.denialMessage(action), action, GATED_ACTIONS[action]!.envVar);
    }
  }

  /** Validates the action name and the capability gate in one step. */
  public validateDispatchable(action: unknown): BrowserActionType {
    if (!isBrowserAction(action)) {
      throw new UnknownActionError(action);
    }
    this.assertAllowed(action);
    return action;
  }
}

/**
 * Browsers always send an `Origin` header for cross-origin `fetch` and for
 * WebSocket handshakes. Non-browser clients (the CLI, MCP stdio bridge, curl)
 * send none, which is why an absent Origin is allowed and the token is the
 * only gate for them.
 */
export function isOriginAllowed(origin: string | undefined | null, extraOrigins: string[] = []): boolean {
  if (!origin || origin === 'null') {
    // `Origin: null` comes from sandboxed/opaque documents — treat as untrusted.
    return !origin;
  }

  if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
    return true;
  }

  const normalized = origin.replace(/\/$/, '');
  if (extraOrigins.some((allowed) => allowed.replace(/\/$/, '') === normalized)) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Compare against itself so the failure path costs the same as a near miss.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

interface FailureRecord {
  count: number;
  firstFailureAt: number;
  blockedUntil: number;
}

/** Small in-memory brute-force guard for the shared secret. */
export class AuthRateLimiter {
  private readonly failures = new Map<string, FailureRecord>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 60_000,
    private readonly blockMs = 60_000
  ) {}

  public isBlocked(key: string, now = Date.now()): boolean {
    const record = this.failures.get(key);
    if (!record) return false;
    if (record.blockedUntil > now) return true;
    if (record.blockedUntil) {
      this.failures.delete(key);
    }
    return false;
  }

  public recordFailure(key: string, now = Date.now()): void {
    const record = this.failures.get(key);
    if (!record || now - record.firstFailureAt > this.windowMs) {
      this.failures.set(key, { count: 1, firstFailureAt: now, blockedUntil: 0 });
      return;
    }
    record.count += 1;
    if (record.count >= this.maxFailures) {
      record.blockedUntil = now + this.blockMs;
      record.count = 0;
      record.firstFailureAt = now;
    }
  }

  public reset(key: string): void {
    this.failures.delete(key);
  }

  public clear(): void {
    this.failures.clear();
  }
}
