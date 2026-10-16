import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { BrowserActionType, BrowserDispatcher } from './types.js';

dotenv.config();

const DEFAULT_PORT = parseInt(process.env.WS_PORT || process.env.PORT || '8770', 10);

export class DaemonClient implements BrowserDispatcher {
  private port: number;
  private secretToken: string;
  private cachedBaseUrl: string | null = null;

  constructor(
    port: number = DEFAULT_PORT,
    secretToken: string = process.env.SECRET_TOKEN || 'browserpilot-secret'
  ) {
    this.port = port;
    this.secretToken = secretToken;
  }

  /**
   * Intelligently resolves the reachable daemon URL:
   * 1. Explicit env var (BROWSERPILOT_DAEMON_URL or BROWSERPILOT_HOST)
   * 2. Local loopback (http://127.0.0.1:PORT)
   * 3. Active Fire PM tunnel (/tmp/fire-tunnels/PORT.env)
   * 4. Network namespace gateway (http://10.200.0.1:PORT)
   * 5. Fallback: http://localhost:PORT
   */
  public async resolveBaseUrl(forceRefresh = false): Promise<string> {
    if (this.cachedBaseUrl && !forceRefresh) {
      return this.cachedBaseUrl;
    }

    // 1. Explicit environment configuration
    if (process.env.BROWSERPILOT_DAEMON_URL) {
      this.cachedBaseUrl = process.env.BROWSERPILOT_DAEMON_URL.replace(/\/$/, '');
      return this.cachedBaseUrl;
    }

    if (process.env.BROWSERPILOT_HOST) {
      this.cachedBaseUrl = `http://${process.env.BROWSERPILOT_HOST}:${this.port}`;
      return this.cachedBaseUrl;
    }

    // Candidates to probe in order of priority
    const candidates: string[] = [`http://127.0.0.1:${this.port}`];

    // Check Fire PM tunnel descriptor
    try {
      const tunnelFile = `/tmp/fire-tunnels/${this.port}.env`;
      if (fs.existsSync(tunnelFile)) {
        const content = fs.readFileSync(tunnelFile, 'utf8');
        const match = content.match(/URL=(https?:\/\/[^\s]+)/);
        if (match && match[1]) {
          candidates.push(match[1].replace(/\/$/, ''));
        }
      }
    } catch {
      // Ignore filesystem errors
    }

    // Sandbox gateway candidate
    candidates.push(`http://10.200.0.1:${this.port}`);

    // Probe candidates
    for (const candidate of candidates) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(`${candidate}/status`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' }
        });
        clearTimeout(timeout);
        if (res.ok) {
          this.cachedBaseUrl = candidate;
          return this.cachedBaseUrl;
        }
      } catch {
        // Probe next candidate
      }
    }

    // Default fallback
    this.cachedBaseUrl = `http://localhost:${this.port}`;
    return this.cachedBaseUrl;
  }

  public async getStatus(): Promise<{ connected: boolean; lastSeen: string | null; port?: number; activeTab?: any; totalTabs?: number }> {
    try {
      const baseUrl = await this.resolveBaseUrl();
      const res = await fetch(`${baseUrl}/status`, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        return { connected: false, lastSeen: null, port: this.port };
      }
      const data: any = await res.json();
      return data.hub || { connected: false, lastSeen: null, port: this.port };
    } catch {
      return { connected: false, lastSeen: null, port: this.port };
    }
  }

  public async dispatch<T = any>(
    action: BrowserActionType,
    params: Record<string, any> = {},
    timeoutMs: number = 35000
  ): Promise<T> {
    const baseUrl = await this.resolveBaseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs + 2000);

    try {
      const res = await fetch(`${baseUrl}/api/dispatch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-token': this.secretToken,
          'Authorization': `Bearer ${this.secretToken}`
        },
        body: JSON.stringify({ action, params, timeoutMs }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let errMsg = `HTTP ${res.status}: ${res.statusText}`;
        try {
          const parsed = JSON.parse(text);
          if (parsed.error) errMsg = parsed.error;
        } catch {
          if (text) errMsg = text;
        }
        throw new Error(errMsg);
      }

      const response: any = await res.json();
      if (response.success) {
        return response.result;
      }
      throw new Error(response.error || 'Dispatch returned error');
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error(`Command '${action}' timed out after ${timeoutMs}ms waiting for browser response.`);
      }
      if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        // Invalidate cached URL and suggest remediation
        this.cachedBaseUrl = null;
        throw new Error(
          `BrowserPilot daemon is unreachable at ${baseUrl}. Ensure the service is active (e.g., 'fire start browserpilot' or check 'bp doctor').`
        );
      }
      throw err;
    }
  }

  public async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string; status?: any }> {
    const start = Date.now();
    try {
      const baseUrl = await this.resolveBaseUrl(true);
      const res = await fetch(`${baseUrl}/status`, { headers: { Accept: 'application/json' } });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        return { ok: true, latencyMs, status: data };
      }
      return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - start, error: err.message };
    }
  }
}
