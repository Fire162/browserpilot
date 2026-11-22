import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const requireFromHere = createRequire(import.meta.url);

/** Single source of truth for the reported version (avoids doc/CHANGELOG drift). */
export const SERVER_VERSION: string = (() => {
  try {
    return requireFromHere('../package.json').version as string;
  } catch {
    return '0.0.0';
  }
})();

/**
 * Central daemon configuration.
 *
 * Security posture:
 * - There is no built-in shared secret. If `SECRET_TOKEN` is not supplied the
 *   daemon generates a strong token once and persists it (0600) so that the
 *   operator can paste it into the extension popup.
 * - Dangerous capabilities (arbitrary JS execution, cookie export) are opt-in.
 */

export const DEFAULT_PORT = 8770;

/** Token that shipped in older releases and is public knowledge. */
export const LEGACY_DEFAULT_TOKEN = 'browserpilot-secret';

export const BROWSERPILOT_HOME =
  process.env.BROWSERPILOT_HOME || path.join(process.env.HOME || os.homedir() || '/root', '.browserpilot');

export const USER_ENV_FILE = path.join(BROWSERPILOT_HOME, '.env');

export interface DaemonConfig {
  port: number;
  bindHost: string;
  secretToken: string;
  tokenSource: 'env' | 'user-env' | 'generated';
  /** True when the operator supplied the old public default token. */
  usesLegacyDefaultToken: boolean;
  allowedOrigins: string[];
  allowCodeExecution: boolean;
  allowCookieAccess: boolean;
  maxBodyBytes: number;
  authMaxFailures: number;
  authWindowMs: number;
  authBlockMs: number;
}

export function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function parsePort(value: string | number | undefined, fallback = DEFAULT_PORT): number {
  if (value === undefined || value === '') return fallback;
  const raw = String(value).trim();
  if (!/^\d{1,5}$/.test(raw)) {
    throw new Error(`Invalid port '${raw}': expected an integer between 1 and 65535.`);
  }
  const port = Number(raw);
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid port '${raw}': expected an integer between 1 and 65535.`);
  }
  return port;
}

function parseTokenFromEnvFile(file: string): string {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(/^\s*SECRET_TOKEN\s*=\s*(.+)$/m);
    if (!match) return '';
    const value = match[1].trim().replace(/^["']|["']$/g, '');
    return value;
  } catch {
    return '';
  }
}

/** Read a previously configured token without ever generating one (safe for clients). */
export function readConfiguredToken(): string {
  const fromEnv = (process.env.SECRET_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  return parseTokenFromEnvFile(USER_ENV_FILE);
}

function persistToken(token: string): void {
  try {
    fs.mkdirSync(BROWSERPILOT_HOME, { recursive: true, mode: 0o700 });
    let content = '';
    if (fs.existsSync(USER_ENV_FILE)) {
      content = fs.readFileSync(USER_ENV_FILE, 'utf8');
    }
    if (/^\s*SECRET_TOKEN\s*=/m.test(content)) {
      content = content.replace(/^\s*SECRET_TOKEN\s*=.*$/m, `SECRET_TOKEN=${token}`);
    } else {
      content = `${content.trimEnd()}${content.trim() ? '\n' : ''}SECRET_TOKEN=${token}\n`;
    }
    fs.writeFileSync(USER_ENV_FILE, content, { encoding: 'utf8', mode: 0o600 });
    // `mode` only applies on creation; enforce it on pre-existing files too.
    fs.chmodSync(USER_ENV_FILE, 0o600);
  } catch (err: any) {
    console.error(`[Config] Could not persist generated token to ${USER_ENV_FILE}: ${err.message}`);
  }
}

/** Persists a token to ~/.browserpilot/.env with 0600 permissions. */
export function saveSecretToken(token: string): string {
  persistToken(token);
  return USER_ENV_FILE;
}

export function generateToken(): string {
  return `bp_${crypto.randomBytes(24).toString('hex')}`;
}

export function resolveSecretToken(options: { generate?: boolean } = {}): {
  token: string;
  source: DaemonConfig['tokenSource'];
} {
  const fromEnv = (process.env.SECRET_TOKEN || '').trim();
  if (fromEnv) {
    // Honour an explicitly configured token (even the legacy default) so that
    // existing deployments keep working, but the caller warns loudly about it.
    return { token: fromEnv, source: 'env' };
  }

  const stored = parseTokenFromEnvFile(USER_ENV_FILE);
  if (stored) {
    return { token: stored, source: 'user-env' };
  }

  if (options.generate === false) {
    return { token: '', source: 'env' };
  }

  const token = generateToken();
  persistToken(token);
  return { token, source: 'generated' };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const port = parsePort(env.WS_PORT || env.PORT, DEFAULT_PORT);
  const { token, source } = resolveSecretToken();

  const allowedOrigins = (env.BROWSERPILOT_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    port,
    bindHost: (env.BROWSERPILOT_BIND || '0.0.0.0').trim(),
    secretToken: token,
    tokenSource: source,
    usesLegacyDefaultToken: token === LEGACY_DEFAULT_TOKEN,
    allowedOrigins,
    allowCodeExecution: parseBoolean(env.ALLOW_CODE_EXECUTION, false),
    allowCookieAccess: parseBoolean(env.ALLOW_COOKIE_ACCESS, false),
    maxBodyBytes: Number(env.BROWSERPILOT_MAX_BODY_BYTES || 1_048_576) || 1_048_576,
    authMaxFailures: Number(env.BROWSERPILOT_AUTH_MAX_FAILURES || 10) || 10,
    authWindowMs: Number(env.BROWSERPILOT_AUTH_WINDOW_MS || 60_000) || 60_000,
    authBlockMs: Number(env.BROWSERPILOT_AUTH_BLOCK_MS || 60_000) || 60_000
  };
}
