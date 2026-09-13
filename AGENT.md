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
| Extension (Manifest V3)            |                 | BrowserPilot MCP Server           |
| - offscreen.html/js (Persistent WS)| ==============> | - websocket-hub.ts (Port 8765)    |
| - background.js (Tab router)       | (Outbound TLS)  | - tools.ts (12 MCP Tools)         |
| - content.js (DOM engine)          |                 | - index.ts (Stdio MCP Transport)  |
+------------------------------------+                 +-----------------------------------+
                                                                         |
                                                                         v
                                                               [ AI Agent / LLM ]
```

### Core Components

1. **`mcp-server/`**:
   - Built with TypeScript and `@modelcontextprotocol/sdk`.
   - Listens on `stdio` for agent prompts and runs an internal WebSocket server (default port `8765`).
   - Dispatches structured JSON commands to the connected extension and awaits responses with request timeouts.
   - Requires token-based authorization (`SECRET_TOKEN`).

2. **`extension/`**:
   - Chrome Manifest V3 extension.
   - **`offscreen.html` & `offscreen.js`**: Critical for maintaining the WebSocket connection 24/7 without being affected by Manifest V3 service worker 30-second idling.
   - **`background.js`**: Manages tab lifecycle, screenshot capture via `chrome.tabs.captureVisibleTab`, and routes messages to content scripts.
   - **`content.js`**: In-page DOM execution engine. Dispatches realistic input and mouse events, highlights targeted elements with visual colored halos, and extracts clean markdown/text or interactive element inventories.

---

## 🛠️ Development & Build Commands

Always use `pnpm` as the package manager:

```bash
# Install dependencies
pnpm install

# Build MCP server TypeScript code to dist/
pnpm build

# Start MCP server in development mode (hot reload)
pnpm dev

# Run integration tests
pnpm --filter browserpilot-mcp exec tsx test/test-bridge.ts
```

---

## 🔒 Security & Privacy Rules

1. **IP & Host Confidentiality**:
   - **NEVER** write or commit real IP addresses into code, documentation, diagrams, or commit messages.
   - Always use `<your-vps-ip>` or RFC 5737 documentation addresses (`192.0.2.1`).
2. **Secrets & Tokens**:
   - Always load sensitive credentials from environment variables (`SECRET_TOKEN`).
   - Keep `.env` and `AGENT_HISTORY.md` in `.gitignore`.

---

## 📝 Conventions for Future Agents

- **No Playwright / Heavy Drivers**: Keep the VPS server lightweight, fast, and self-contained using pure Node.js and `@modelcontextprotocol/sdk`.
- **Extension Offscreen Architecture**: Never move the WebSocket handling directly into `background.js` without an offscreen document; Manifest V3 will terminate background workers during idle periods.
- **Visual Feedback**: Keep user awareness high by ensuring DOM interactions (click, type, scroll) visually highlight elements with outlines in `content.js`.
