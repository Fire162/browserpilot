export interface BrowserTab {
  id: number;
  title: string;
  url: string;
  active: boolean;
  windowId: number;
  favIconUrl?: string;
  isAgentOwned?: boolean;
  isApproved?: boolean;
}

/**
 * Canonical list of actions the daemon will forward to the extension.
 * Keep this as the single source of truth: the HTTP dispatcher, the WebSocket
 * policy and the tool layer all validate against it.
 */
export const BROWSER_ACTIONS = [
  'status',
  'list_tabs',
  'navigate',
  'switch_tab',
  'close_tab',
  'close_tabs',
  'read_page',
  'click',
  'type',
  'press_key',
  'scroll',
  'screenshot',
  'evaluate',
  'run_code',
  'get_cookies',
  'upload_file',
  'label_elements',
  'handle_dialog',
  'wait_for_network_idle',
  'get_clipboard',
  'set_clipboard',
  'list_downloads',
  'wait_for_download',
  'request_tab_access',
  'reload_extension'
] as const;

export type BrowserActionType = (typeof BROWSER_ACTIONS)[number];

const BROWSER_ACTION_SET: ReadonlySet<string> = new Set(BROWSER_ACTIONS);

export function isBrowserAction(value: unknown): value is BrowserActionType {
  return typeof value === 'string' && BROWSER_ACTION_SET.has(value);
}

export interface CommandRequest {
  id: string;
  action: BrowserActionType;
  params: Record<string, any>;
}

export interface CommandResponse {
  id: string;
  success: boolean;
  result?: any;
  error?: string;
}

export interface WebSocketInboundMessage {
  type?: 'ping' | 'pong' | 'hello' | 'response';
  id?: string;
  timestamp?: number;
  success?: boolean;
  result?: any;
  error?: string;
  data?: any;
}

export interface BrowserDispatcher {
  getStatus(): { connected: boolean; lastSeen: string | null; port?: number } | Promise<{ connected: boolean; lastSeen: string | null; port?: number }>;
  dispatch<T = any>(action: BrowserActionType, params?: Record<string, any>, timeoutMs?: number): Promise<T>;
}

