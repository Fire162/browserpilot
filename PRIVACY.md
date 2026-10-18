# Privacy Policy for BrowserPilot

**Last Updated:** October 18, 2026

BrowserPilot is an open-source browser automation bridge designed to connect your browser directly with Model Context Protocol (MCP) servers and local AI agents. Your privacy and data security are central to the architecture of BrowserPilot.

---

## 1. Information Collection and Storage

BrowserPilot does not collect, track, or store personal user data on external servers:

- **No Remote Telemetry:** The extension contains no analytics, tracking pixels, or third-party monitoring services.
- **Local Settings Storage:** User configuration (such as WebSocket URLs, user-approved tab permissions, and authentication secret tokens) is stored exclusively on your local device via standard browser storage (`chrome.storage.local`).
- **No Data Harvesting:** BrowserPilot does not sell, trade, rent, or transfer your browsing history, keystrokes, personal communications, or account credentials to third parties.

---

## 2. Data Transmission

All browser automation commands and responses are transmitted directly over a private WebSocket connection between:
1. Your local desktop browser extension, and
2. The user-configured MCP daemon or reverse proxy tunnel that you control.

Data never passes through intermediate servers owned or operated by the BrowserPilot developers.

---

## 3. Extension Permissions

BrowserPilot requests specific browser permissions solely to fulfill automation commands initiated by the user:

- **`tabs` & `activeTab`:** To open, inspect, navigate, and manage browser tabs as requested by your automation tasks.
- **`scripting`:** To read DOM elements, calculate rendered coordinates, and trigger clicks or inputs.
- **`offscreen`:** To maintain a persistent WebSocket client connection without service worker lifecycle interruptions.
- **`storage`:** To save your connection settings locally on your machine.
- **`cookies`:** To read session status only when explicitly requested by an automation workflow.
- **`downloads`:** To monitor the completion of files downloaded during automation tasks.
- **`clipboardRead` & `clipboardWrite`:** To read or set clipboard contents upon direct automation command.
- **`webRequest`:** To monitor network settlement and wait for web pages to finish loading.

---

## 4. Open Source and Auditability

The entire codebase of BrowserPilot is open source and available for independent audit:
- [GitHub Repository](https://github.com/Fire162/browserpilot)

---

## 5. Contact

If you have questions regarding this Privacy Policy, please open an issue on the [BrowserPilot GitHub Repository](https://github.com/Fire162/browserpilot/issues).
