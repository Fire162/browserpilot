# AGENT.md - AI Coding Agent Guide for BrowserPilot

Welcome to **BrowserPilot**. This document serves as the persistent guide and architectural reference for AI coding agents (`agy`) working on this repository.

---

## 🧭 Project Purpose

BrowserPilot enables AI agents hosted on remote virtual private servers (VPS) to securely control a developer's real, everyday local desktop browser (Chrome, Brave, Edge) over a WebSocket connection via the **Model Context Protocol (MCP)**.

---

## 🏛️ Architecture Overview

```
[ Local Desktop Browser ]                              [ Remote VPS Server ]
+------------------------------------+                 +-----------------------------------+
| Chrome Extension (Manifest V3)     |                 | BrowserPilot MCP Server & Daemon  |
| - offscreen.html/js (Persistent WS)| ==============> | - websocket-hub.ts (Port 8770)    |
| - background.js (Tab & Perm Engine)| (Outbound TLS)  | - tools.ts (22 MCP Tools)         |
| - content.js (DOM engine & Banner) |                 | - cli.ts ('bp' binary CLI tool)   |
+------------------------------------+                 | - daemon-client.ts (Sandbox safe) |
                                                       | - index.ts (Stdio & SSE Transports|
                                                       +-----------------------------------+
                                                                         |
                                                                         v
                                                               [ AI Agent / LLM ]
```

### Core Components

1. **`mcp-server/`**:
   - Built with TypeScript and `@modelcontextprotocol/sdk`.
   - Listens on `stdio` for agent prompts and runs an internal WebSocket server on port `8770`.
   - Dispatches structured JSON commands to the connected extension and awaits responses with request timeouts.
   - **Authentication Guard**: Requires token validation (`SECRET_TOKEN`) on `/api/dispatch`, `/sse`, and `/message` to protect against unauthorized access over public reverse-proxy tunnels.
   - **`DaemonClient` (`daemon-client.ts`)**: Intelligent client with network sandbox fallback. Resolves endpoints in order: `BROWSERPILOT_DAEMON_URL` -> local loopback `127.0.0.1:8770` -> Fire PM tunnel (`/tmp/fire-tunnels/8770.env`) -> sandbox gateway (`10.200.0.1:8770`).
   - **`bp` CLI (`cli.ts`)**: Zero-dependency standalone CLI tool symlinked to `/usr/local/bin/bp` and `/usr/local/bin/browserpilot`. Commands: `bp doctor`, `bp status`, `bp tabs list`, `bp tabs close`, `bp nav`, `bp snap`, `bp tunnel`.
   - **MCP Tools (`tools.ts`)**: 22 registered tools including `browser_close_tabs`, `browser_request_tab_access`, `browser_run_code`, `browser_label_elements`, etc.

2. **`extension/`**:
   - Chrome Manifest V3 extension.
   - **`offscreen.html` & `offscreen.js`**: Critical for maintaining the WebSocket connection 24/7 without being terminated by the Manifest V3 service worker 30-second idle timer. Enforces internal sender authorization.
   - **`background.js`**: Manages tab lifecycle, screenshot capture (optimized to JPEG quality 80 to reduce memory and transmission overhead by ~95%), routes messages to content scripts, and enforces the **Hybrid Privacy & Tab Permission Engine** (auto-approves agent-spawned tabs while gating pre-existing user tabs). Verifies `isInternalExtensionContext(sender)` on all privileged commands.
   - **`content.js`**: In-page DOM execution engine. Dispatches realistic input and mouse events, displays floating permission approval banners with `e.isTrusted` checks, preserves explicit `x, y` click coordinates, and highlights targeted elements.

---

## 🛠️ Development & Service Commands

Always use `pnpm` as the package manager:

```bash
# Install dependencies
pnpm install

# Build MCP server TypeScript code to dist/
pnpm --filter browserpilot-mcp build

# Restart daemon service under Fire PM
fire restart browserpilot
# Or via systemctl:
systemctl restart fire-browserpilot.service

# Check service status & logs
fire info browserpilot
journalctl -u fire-browserpilot.service -n 50 --no-pager

# Run CLI diagnostics & health checks
bp doctor
bp status
```

---

## 💻 BrowserPilot CLI (`bp`)

The `bp` utility is installed at `/usr/local/bin/bp` and provides quick command-line diagnostics and browser automation:

```bash
# Verify environment, daemon, tunnel, and extension connectivity
bp doctor

# Show live connection state, active tunnel, and focused tab
bp status

# List open tabs across all browser windows
bp tabs list
bp tabs list --filter=github

# Batch close tabs by ID or regex match
bp tabs close 1488399560 1488399570
bp tabs close --match="youtube.com/@"

# Navigate active tab or spawn isolated tab
bp nav https://github.com --new-tab

# Save visible tab screenshot to disk
bp snap /tmp/screenshot.jpg

# Manage Fire PM reverse-proxy tunnel
bp tunnel url
```

---

## 🔒 Security & Privacy Rules

1. **IP & Host Confidentiality**:
   - **NEVER** write or commit real IP addresses into code, documentation, diagrams, or commit messages.
   - Always use `<your-vps-ip>` or RFC 5737 documentation addresses (`192.0.2.1`).
2. **Secrets & Tokens**:
   - Always load sensitive credentials from environment variables (`SECRET_TOKEN`).
   - Keep `.env` untracked.
3. **Local Memory Exclusions**:
   - Add `AGENT_HISTORY.md` to `.git/info/exclude` rather than public `.gitignore` files to avoid broadcasting AI agent artifacts in git history.
4. **Extension Message Security**:
   - Any message handling in `background.js` and `offscreen.js` must verify `!sender.tab && sender.id === chrome.runtime.id` for sensitive or privileged actions.

---

## 📝 Conventions for Future Agents

- **No Heavy Drivers**: Keep the VPS server lightweight, fast, and self-contained using pure Node.js and `@modelcontextprotocol/sdk`.
- **Extension Offscreen Architecture**: Never move the WebSocket handling directly into `background.js` without an offscreen document; Manifest V3 will terminate background workers during idle periods.
- **Visual Feedback**: Keep user awareness high by ensuring DOM interactions (click, type, scroll) visually highlight elements with outlines in `content.js`.
- **Fast Clean Shutdown**: In `mcp-server`, terminate active WebSocket clients on `stop()` to ensure systemd / Fire PM restarts happen instantaneously.
