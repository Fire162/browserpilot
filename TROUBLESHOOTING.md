# 🛠️ TROUBLESHOOTING.md — Common Issues & Solutions

This guide documents the real-world hurdles, edge cases, and architectural constraints discovered during the development and setup of **BrowserPilot**, along with their proven fixes.

---

## Table of Contents

1. [Port Conflict on Startup (`EADDRINUSE`)](#1-port-conflict-on-startup-eaddrinuse)
2. [Chrome MV3 Offscreen Storage Restriction (`chrome.storage` is undefined)](#2-chrome-mv3-offscreen-storage-restriction)
3. [MCP SSE Client Hang / Indefinite Loading in Agent IDE](#3-mcp-sse-client-hang--indefinite-loading-in-agent-ide)
4. [Strict Content Security Policy (CSP) Violations on Sites like Instagram](#4-strict-content-security-policy-csp-violations)
5. [Typing Fails on `contenteditable` Composers (Instagram, Slack, Discord)](#5-typing-fails-on-contenteditable-composers)
6. [Screenshot Steals Tab Focus During Multitasking](#6-screenshot-steals-tab-focus-during-multitasking)
7. [WebSocket Bridge Disconnects After 30 Seconds](#7-websocket-bridge-disconnects-after-30-seconds)
8. [Firewall / ISP NAT Blocks Direct VPS Connection](#8-firewall--isp-nat-blocks-direct-vps-connection)

---

### 1. Port Conflict on Startup (`EADDRINUSE`)

#### 💥 Symptom
```text
Error: listen EADDRINUSE: address already in use :::8765
```

#### 🔍 Root Cause
Port `8765` is commonly utilized by background VPN installers, Python microservices, or previous daemon instances.

#### 💡 Solution
Change the port in your environment or launch command:
```bash
# In mcp-server/.env
WS_PORT=8770
```
Or start via Fire PM:
```bash
fire start /root/browserpilot/mcp-server/dist/index.js --name browserpilot --env WS_PORT=8770
```

---

### 2. Chrome MV3 Offscreen Storage Restriction

#### 💥 Symptom
```text
Uncaught TypeError: Cannot read properties of undefined (reading 'local')
    at offscreen.js:42:18
```

#### 🔍 Root Cause
In Chrome Manifest V3, the `offscreen` execution context does **not** have access to the `chrome.storage` API. Calling `chrome.storage.local` inside `offscreen.js` throws a fatal TypeError.

#### 💡 Solution
Keep all persistence inside `background.js` and `popup.js`. The offscreen document communicates purely through runtime messaging:
```javascript
// In offscreen.js - Request credentials from background worker
chrome.runtime.sendMessage({ type: 'GET_CONNECTION_CONFIG' }, (config) => {
  if (config && config.wsUrl) connect(config.wsUrl, config.secretToken);
});
```

---

### 3. MCP SSE Client Hang / Indefinite Loading in Agent IDE

#### 💥 Symptom
When configuring BrowserPilot as a remote HTTP/SSE endpoint (`http://localhost:8770/sse`), the AI agent IDE (such as Antigravity or Claude Desktop) hangs indefinitely or displays an endless spinner on `/mcp`.

#### 🔍 Root Cause
Certain Language Server MCP clients struggle with relative SSE redirect URLs, streaming chunk boundaries, or reverse-proxy buffering.

#### 💡 Solution
Use the **Stdio Bridge Client** (`mcp-server/dist/stdio-client.js`). It connects to the agent via standard input/output (stdio) with sub-10ms startup latency and proxies calls to the daemon via local HTTP POST:
```json
{
  "mcpServers": {
    "browserpilot": {
      "command": "node",
      "args": ["/root/browserpilot/mcp-server/dist/stdio-client.js"]
    }
  }
}
```

---

### 4. Strict Content Security Policy (CSP) Violations

#### 💥 Symptom
```text
EvalError: Evaluating a string as JavaScript violates the following Content Security Policy directive: 'unsafe-eval'
```

#### 🔍 Root Cause
Modern web applications (e.g., Instagram, GitHub, banking portals) serve strict CSP headers prohibiting `eval()` and `new Function()` in page context.

#### 💡 Solution
- **For Automation**: BrowserPilot's `browser_click`, `browser_type`, and `browser_press_key` interact natively with the DOM through synthetic mouse and keyboard event chains without calling `eval()`.
- **For Code Evaluation**: `background.js` uses `chrome.scripting.executeScript` in the extension context rather than running raw strings in the page world.

---

### 5. Typing Fails on `contenteditable` Composers

#### 💥 Symptom
Calling `browser_type` on message input fields (like Instagram Direct, Slack, WhatsApp Web, or Discord) fills the DOM node, but the website's send button remains disabled or the text disappears on submit.

#### 🔍 Root Cause
Modern single-page apps use `div[contenteditable="true"]` managed by React or Lexical state instead of native `<input>` or `<textarea>`. Modifying `.innerText` or `.textContent` directly does not trigger React's synthetic input pipeline.

#### 💡 Solution
BrowserPilot automatically detects `contenteditable` nodes and uses `document.execCommand('insertText', false, text)` followed by standard `input` and `change` events:
```javascript
if (el.isContentEditable) {
  el.focus();
  document.execCommand('insertText', false, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
```

---

### 6. Screenshot Steals Tab Focus During Multitasking

#### 💥 Symptom
While you are browsing in Tab A, an automated agent inspecting Tab B suddenly switches your window/tab to Tab B when capturing a screenshot.

#### 🔍 Root Cause
Chrome's native `chrome.tabs.captureVisibleTab()` API can only capture the currently visible tab in a window.

#### 💡 Solution
BrowserPilot (v1.0.1+) automatically tracks your active tab, performs an instantaneous switch, captures the screenshot frame, and **immediately restores your original active tab**:
```javascript
async function captureScreenshot({ tabId }) {
  const currentTab = await getActiveTab().catch(() => null);
  const targetTab = tabId ? await chrome.tabs.get(tabId) : currentTab;
  let switched = false;

  if (tabId && currentTab && currentTab.id !== tabId) {
    await chrome.tabs.update(tabId, { active: true });
    switched = true;
    await new Promise((r) => setTimeout(r, 150));
  }

  try {
    return await chrome.tabs.captureVisibleTab(targetTab.windowId, { format: 'png' });
  } finally {
    if (switched && currentTab) {
      await chrome.tabs.update(currentTab.id, { active: true }).catch(() => {});
    }
  }
}
```

---

### 7. WebSocket Bridge Disconnects After 30 Seconds

#### 💥 Symptom
The extension connects, but after ~30 seconds of inactivity, it disconnects with WebSocket code `1006` or `1005`.

#### 🔍 Root Cause
Chrome Manifest V3 background service workers automatically enter idle sleep after 30 seconds of inactivity, closing any open WebSockets.

#### 💡 Solution
BrowserPilot spawns a persistent Chrome **Offscreen Document** (`offscreen.html`) with an active 15-second heartbeat ping. Chrome keeps offscreen documents running continuously, maintaining an unbroken 24/7 WebSocket tunnel.

---

### 8. Firewall / ISP NAT Blocks Direct VPS Connection

#### 💥 Symptom
Extension displays `Disconnected (code: 1006)` and cannot reach `ws://<your-vps-ip>:8770`.

#### 🔍 Root Cause
Many cloud providers (AWS, GCP, Oracle Cloud, Hetzner) block non-standard incoming ports by default, and residential ISPs often drop raw WebSocket traffic on non-HTTP ports.

#### 💡 Solution
Expose BrowserPilot over a secure HTTPS/WSS tunnel using **Fire PM** or Cloudflare Tunnel:
```bash
# Using Fire PM
fire tunnel open 8770
# Connect extension to: wss://<generated-subdomain>.yourdomain.com
```
This provides automated SSL certificates, bypasses firewall barriers, and eliminates the need for open public ports.
