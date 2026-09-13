# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
