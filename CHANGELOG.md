# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
