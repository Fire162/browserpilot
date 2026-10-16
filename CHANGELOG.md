# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.1] - 2026-10-16 21:10 IST

### Security
* Enforced `isInternalExtensionContext(sender)` verification in `background.js` and `offscreen.js` across all privileged message channels (`GET_CONNECTION_CONFIG`, `SET_PRIVACY_MODE`, `APPROVE_TAB`, `REVOKE_TAB`, `EXECUTE_COMMAND`, `OFFSCREEN_READ_CLIPBOARD`, `OFFSCREEN_WRITE_CLIPBOARD`), preventing untrusted content scripts or web pages from executing unauthorized commands or stealing secret tokens and clipboard contents.
* Bound `TAB_PERMISSION_RESPONSE` strictly to `sender.tab.id` to prevent cross-tab permission forgery.
* Added `e.isTrusted` verification on in-page permission banner action clicks in `content.js`, blocking synthetic click bypasses.

### Fixed
* Fixed coordinate-based clicking in `content.js`: preserved explicit `x` and `y` click coordinates on canvas, interactive maps, and complex viewports instead of overwriting with element center coordinates.
* Fixed SVG element click crash in `content.js`: safely handled `SVGAnimatedString` on `el.className` when generating action descriptions.
* Fixed premature return in `waitForTabLoad` (`background.js`): eliminated instant resolution caused by stale `'complete'` tab status before a newly triggered navigation had initiated.
* Fixed memory and request leaks in network tracking (`background.js`): added `chrome.webRequest.onBeforeRedirect` tracking and flushed tab requests on `changeInfo.status === 'loading'`, preventing `browser_wait_for_network_idle` from timing out on redirects.
* Fixed daemon shutdown hang: terminated active WebSocket clients on `hub.stop()` and force-closed HTTP connections, enabling instantaneous daemon restarts.

### Changed
* Optimized tab screenshots to use JPEG compression (quality 80) by default, reducing payload sizes by ~95% (from ~8MB down to ~500KB) and eliminating socket transfer latency and V8 heap churn.
* Handled minimized browser window states in `captureScreenshot`, restoring normal window state temporarily to avoid `captureVisibleTab` failures.

## [1.4.0] - 2026-10-16 20:20 IST

### Added
* Standalone `bp` CLI tool (`browserpilot`) built with Node.js standard library for fast terminal diagnostics, health checks, tab management, and automation.
* `bp doctor` diagnostic command that verifies Node.js runtime, daemon service state, listening ports, reverse-proxy tunnel health, extension WebSocket connection, and RPC roundtrip ping latency.
* `browser_close_tabs`: 22nd MCP tool supporting atomic batch closing of tabs by ID array or regex/string URL/title match.
* Zero-dependency `DaemonClient` with intelligent network sandbox fallback (probes local loopback, Fire PM tunnel descriptor `/tmp/fire-tunnels/8770.env`, and container gateways).

### Fixed
* Prevented `PERMISSION_REQUIRED` errors on routine tab cleanup commands (`close_tab`, `close_tabs`) in default Hybrid privacy mode.
* Resolved `ECONNREFUSED` connection failures inside WireGuard proxies and network namespace sandboxes.

### Security
* Hardened HTTP endpoints (`/api/dispatch`, `/sse`, `/message`) by enforcing mandatory `SECRET_TOKEN` validation, blocking unauthorized public tunnel access with `401 Unauthorized`.

## [1.3.0] - 2026-09-20 12:10 IST

### Added
* Hybrid Privacy & Tab Permission Engine:
  * Automatic approval for tabs spawned by the AI agent (`browser_navigate({ url, newTab: true })`), enabling seamless, zero-friction autonomous workflows.
  * Strong boundary protection for pre-existing user tabs (personal email, banking, sensitive accounts), preventing unauthorized DOM access, screenshots, and session inspection.
  * In-page floating permission banner in content scripts when an agent requests interaction with a protected user tab, featuring real-time **Allow Access** and **Deny** actions.
* `browser_request_tab_access`: Dedicated MCP tool enabling AI agents to explicitly request user permission on a protected tab with a clear explanation and configurable timeout.
* Privacy Shield & Tab Permissions Manager in extension popup:
  * Privacy Mode selector: `Hybrid (Default)`, `Full Access (Unrestricted)`, and `Strict Sandbox (Agent Tabs Only)`.
  * Live open tabs permissions list displaying active tabs with ownership chips (`Agent Tab`, `Protected`, `Allowed`) and interactive Allow/Revoke toggles.

### Changed
* Total MCP tools expanded from 20 to 21.
* `browser_list_tabs`: Enhanced tab listing output to report permission ownership status (`🟢 [AGENT-OWNED]`, `🛡️ [USER-APPROVED]`, `🔒 [PROTECTED - Permission Required]`).
* `browser_navigate`: Updated tool documentation to highlight auto-approval for new tabs under Hybrid Privacy mode.

## [1.2.0] - 2026-09-16 23:45 IST

### Added
* `browser_handle_dialog`: Intercepts and auto-resolves JavaScript native alerts, confirms, prompts, and beforeunload modals to prevent browser tabs from freezing during automated runs.
* `browser_wait_for_network_idle`: Monitors in-flight HTTP/XHR/fetch requests per tab using `chrome.webRequest` and settles on single-page applications before continuing.
* `browser_clipboard`: Read and write clipboard text from the desktop browser.
* `browser_downloads`: Inspect recent downloads and await file download completion (`browser_downloads({ action: 'wait', filenamePattern: '.pdf' })`).
* Anti-Detection Humanization Engine: Realistic Bezier curve mouse trajectories with micro-jitters and natural keystroke delays (40ms–140ms) integrated into `browser_click` and `browser_type`.

### Changed
* Bumped total registered MCP tools from 16 to 20.
* Updated Chrome Extension Manifest permissions with `downloads`, `clipboardRead`, `clipboardWrite`, and `webRequest`.

## [1.1.0] - 2026-09-14 01:20 IST

### Added
* `browser_run_code`: Agent code execution capability in the browser's context.
* `browser_get_cookies`: Live cookie and active session extraction for tab domains.
* `browser_upload_file`: Direct file upload automation to file inputs via base64 encoding.
* `browser_label_elements`: Visual OmniParser mode labeling interactive elements with numbered badges.
* `skills/browserpilot/SKILL.md`: Production AI agent skill with verification test prompt.
* `TROUBLESHOOTING.md`: Detailed troubleshooting runbook covering 8 real-world deployment challenges.
* Creator quote by Abhinav Maurya in `README.md`.

### Changed
* Updated `browser_click` to support direct clicks by numeric visual element `label`.

## [1.0.0] - 2026-09-13 23:46 IST

### Added
* Pure TypeScript Model Context Protocol (MCP) server for remote browser automation.
* Secure WebSocket hub with pre-shared Bearer token authentication and request-response correlation.
* 12 MCP browser control tools (`browser_status`, `browser_list_tabs`, `browser_navigate`, `browser_switch_tab`, `browser_close_tab`, `browser_read_page`, `browser_click`, `browser_type`, `browser_press_key`, `browser_scroll`, `browser_take_screenshot`, `browser_evaluate`).
* Manifest V3 Chrome Extension with an offscreen document WebSocket keep-alive engine.
* In-page content script DOM engine supporting simulated human clicks, typing, visual halos, and markdown/interactive elements extraction.
* Sleek extension popup UI with real-time connection status, VPS URL configuration, and test ping.
* Automated integration test suite (`test/test-bridge.ts`).
* Production-ready documentation in `README.md` and `AGENT.md`.
