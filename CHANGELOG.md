# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
* **No more built-in shared secret.** `SECRET_TOKEN` is now required; when it is unset the daemon generates a 48-character token, persists it to `~/.browserpilot/.env` with `0600` permissions, and prints only a masked hint. The public placeholder `browserpilot-secret` is refused at startup (override only with `BROWSERPILOT_ALLOW_INSECURE_TOKEN=true`), and tokens are compared with `crypto.timingSafeEqual`.
* **Origin allow-list on every entry point.** HTTP requests and WebSocket handshakes with an untrusted `Origin` are refused (403) before authentication, and CORS is no longer `Access-Control-Allow-Origin: *`. This closes DNS-rebinding and localhost-probing attacks from arbitrary web pages. Extend the list with `BROWSERPILOT_ALLOWED_ORIGINS`.
* **Capability gate for dangerous tools.** `browser_run_code` and `browser_evaluate` require `ALLOW_CODE_EXECUTION=true`; `browser_get_cookies` requires `ALLOW_COOKIE_ACCESS=true`. Both are **off by default** and enforced at the single dispatch choke point, so HTTP, SSE, stdio and CLI callers cannot bypass them. `GET /status` reports the effective posture.
* **Action allow-list.** `/api/dispatch` rejects unknown actions (`400 UNKNOWN_ACTION`) instead of forwarding arbitrary strings to the extension.
* **Brute-force guard + body cap.** Failed authentication is limited to 10 attempts/minute per address (`429`), and request bodies are capped at 1 MB (`413`).
* **CLI hardening.** `bp start` validates `--port`, launches the daemon with `spawn()` + an env object instead of `sh -c` string interpolation (no shell injection, no token in `ps`), writes the token file and log/pid files as `0600`, passes the port and token to Fire PM via `--env`, and no longer pipes the Fire PM installer into `sudo` (it downloads the script, prints its SHA-256, and asks you to run it).
* **Tab permissions are origin-scoped.** Grants now store `{origin, kind}` and are re-validated against the tab's live origin on every command and on navigation, so recycled tab ids after a browser restart and cross-origin navigations can no longer inherit an old approval. `close_tab`/`close_tabs` are no longer exempt from the permission engine: protected user tabs must be approved before the agent can close them.

### Fixed
* **Clicks fired twice.** `content.js` sent one activation as `el.click()` *and* a synthetic `click` event, so handlers, form submits and "add to cart" buttons ran twice and checkboxes toggled straight back. Now exactly one activation is dispatched, with the synthetic event kept only as a fallback for elements without a callable `click`.
* **`read_page` returned duplicate elements.** The shadow-DOM walker queried every ancestor, so a match was listed once per level up to the root; reported indices therefore did not line up with anything. Traversal now lives in `extension/dom-utils.js`, dedupes results, and is covered by `test/test-dom-utils.ts`.
* **`bp read --interactive` never printed the table.** The CLI read `el.tagName` while the extension sent `tag`, so every row rendered as `elem` — and the handler only ran with `--interactive`, which the tool description never mentioned. Rows now show the tag and the reported index, and `read_page` returns both the legacy `content` string and a structured `elements` array.
* **`browser_click({ selector, index })` could hit the wrong element.** The index came from a list of *visible* elements but was resolved against all matches, so hidden duplicates shifted it. Resolution now filters to visible elements, exactly like the report.
* **`browser_type` silently typed into the wrong field.** A selector that matched nothing used to fall back to the focused element (or the first input on the page) and report success. An explicit selector must now resolve, otherwise the call fails and nothing is typed.
* **Dialog interception did nothing.** `alert`/`confirm`/`prompt` were overridden from the content script, which runs in an isolated world, so the page's own dialogs still opened and froze the tab. Overrides now run in the page's MAIN world (`extension/dialog-hook.js`, injected by the background worker), resolve immediately from a persisted policy (default `dismiss`), keep "Leave site?" prompts from blocking navigation, and are re-installed automatically after navigation.
* **Label badges drifted after scrolling.** Badges were drawn once at `position: fixed` coordinates and never moved, so `browser_click({ label })` targeted whatever slid under the stale position. They now reposition on scroll/resize via `requestAnimationFrame` and clean up when their element leaves the DOM.
* **Reconnect could kill a fresh command.** The `close` handler drained the *shared* pending-request map, so a reconnect (which closes the previous socket asynchronously) rejected commands already sent on the new connection. Pending requests are now scoped to the socket that carried them.
* **Half-open bridges looked connected.** A slept laptop or dropped NAT mapping left the socket `OPEN` while nothing answered, so every tool call burned its full timeout. The hub now records heartbeats and reports/dispatches a stale bridge after `BROWSERPILOT_STALE_AFTER_MS` (default 45s) with an actionable message.
* **`browser_take_screenshot` crashed with a `TypeError`** when the extension returned no image data (closed, minimised or restricted tab). It now returns a readable error and explanation.
* **Clipboard reported success while failing.** `offscreen.js` never requested the `CLIPBOARD` reason, so reads silently returned an empty string, and write failures were swallowed. Reads now report `denied` with the browser's reason, writes surface the error, and `browser_clipboard` returns them as errors. Command parameters are no longer logged (they can contain typed secrets).
* **`bp read` / `.env` resolution drifted between client and daemon.** Both now share `loadProjectEnvFiles()` (cwd → `mcp-server/.env` → repo root), plus `~/.browserpilot/.env` for tokens, so a `.env` picked up by one process is picked up by the other.
* **Daemon crash on bad requests.** The async HTTP handler is fully guarded; a failing `/sse` connect or `/message` post now returns `500` instead of becoming an unhandled rejection that terminated the process.
* **Policy rejections reject instead of throwing** (`WebSocketHub.dispatch` is `async`), so callers using `.catch()` cannot crash on a gated action.
* **Startup no longer prints the secret token** to the console/journal.

### Added
* `test/test-hub.ts` (7 checks: reconnect race, staleness, disconnect handling) and `test/test-dom-utils.ts` (9 checks: shadow-DOM deduplication, ordering, selector generation) — both run from `npm test`.
* `test/test-security.ts` — 28 regression checks covering the origin gate, token handling, rate limiting, action allow-list, capability gate, body caps, SSE crash-safety and the WebSocket handshake.
* `pnpm test` / `pnpm typecheck` scripts; the server version is read from `package.json` instead of a hardcoded literal.
* `BROWSERPILOT_BIND`, `BROWSERPILOT_ALLOWED_ORIGINS`, `BROWSERPILOT_ALLOW_INSECURE_TOKEN`, `BROWSERPILOT_MAX_BODY_BYTES`, `BROWSERPILOT_AUTH_*`, `ALLOW_CODE_EXECUTION` and `ALLOW_COOKIE_ACCESS` documented in `mcp-server/.env.example`.

### Changed
* `bp read --interactive` output gained the element index column; `browser_handle_dialog` now applies a persisted per-tab policy instead of pretending to handle a pending dialog (native dialogs are synchronous and cannot wait for an answer).
* Port examples in the README and popup helper text now consistently use `8770` (the code default) instead of a mix of `8765`/`8770`.

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
