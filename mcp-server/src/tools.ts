import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrowserDispatcher } from './types.js';

export function registerBrowserTools(server: McpServer, hub: BrowserDispatcher) {
  // 1. browser_status
  server.tool(
    'browser_status',
    'Check if the BrowserPilot Chrome extension is currently connected from your local computer, along with connection latency and status.',
    {},
    async () => {
      const status = await hub.getStatus();
      if (!status.connected) {
        return {
          content: [
            {
              type: 'text',
              text: `⚠️ Local Browser Extension is NOT connected.\n\nTo connect:\n1. Ensure the BrowserPilot extension is installed in your local Chrome/Brave/Edge.\n2. In the extension popup, enter your VPS WebSocket URL (e.g., ws://<your-vps-ip>:${status.port}) and Secret Token.\n3. Click Connect.`
            }
          ]
        };
      }

      try {
        const pingStart = Date.now();
        const res = await hub.dispatch('status', {}, 5000);
        const latency = Date.now() - pingStart;
        return {
          content: [
            {
              type: 'text',
              text: `✅ Local Browser Extension is ONLINE!\n• Latency: ${latency}ms\n• Active Tab: "${res.activeTab?.title || 'Unknown'}" (${res.activeTab?.url || 'N/A'})\n• Total Open Tabs: ${res.totalTabs ?? 'N/A'}\n• Last Seen: ${status.lastSeen}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to ping connected browser: ${err.message}` }]
        };
      }
    }
  );

  // 2. browser_list_tabs
  server.tool(
    'browser_list_tabs',
    'List all open tabs in your local browser, including tab IDs, URLs, page titles, active tab status, and privacy permission state (Agent-Owned vs User-Protected).',
    {},
    async () => {
      try {
        const tabs = await hub.dispatch('list_tabs', {});
        if (!Array.isArray(tabs) || tabs.length === 0) {
          return { content: [{ type: 'text', text: 'No open browser tabs found.' }] };
        }

        const formatted = tabs
          .map((t: any) => {
            const statusTag = t.isAgentOwned
              ? '🟢 [AGENT-OWNED] '
              : t.isApproved
              ? '🛡️ [USER-APPROVED] '
              : '🔒 [PROTECTED - Permission Required] ';
            return `- [Tab #${t.id}] ${t.active ? '⭐ (ACTIVE) ' : ''}${statusTag}"${t.title}"\n  URL: ${t.url}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${tabs.length} open tab(s):\n\n${formatted}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error listing tabs: ${err.message}` }]
        };
      }
    }
  );

  // 3. browser_navigate
  server.tool(
    'browser_navigate',
    'Navigate the active browser tab (or open a new tab) to a specified URL. Under Hybrid Privacy mode, opening a new tab (newTab: true) automatically grants full agent access without user prompting.',
    {
      url: z.string().describe("The URL to navigate to (e.g. 'https://github.com' or 'https://google.com')"),
      newTab: z.boolean().optional().describe('If true, opens in a new tab (auto-approved under Hybrid Privacy mode)'),
      tabId: z.number().optional().describe('Target a specific tab ID instead of the active tab')
    },
    async ({ url, newTab, tabId }) => {
      try {
        let validUrl = url;
        if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://') && !validUrl.startsWith('chrome://')) {
          validUrl = 'https://' + validUrl;
        }

        const result = await hub.dispatch('navigate', { url: validUrl, newTab, tabId }, 45000);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully navigated to ${result.url || validUrl} (Tab #${result.tabId}). Title: "${result.title || 'Loading...'}"`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to navigate: ${err.message}` }]
        };
      }
    }
  );

  // 4. browser_switch_tab
  server.tool(
    'browser_switch_tab',
    'Switch focus and activate a specific browser tab by its tabId.',
    {
      tabId: z.number().describe('The ID of the tab to focus')
    },
    async ({ tabId }) => {
      try {
        const result = await hub.dispatch('switch_tab', { tabId });
        return {
          content: [
            {
              type: 'text',
              text: `Switched to Tab #${tabId}: "${result.title}" (${result.url})`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to switch tab: ${err.message}` }]
        };
      }
    }
  );

  // 5. browser_close_tab
  server.tool(
    'browser_close_tab',
    'Close a specific browser tab by tabId.',
    {
      tabId: z.number().describe('The ID of the tab to close')
    },
    async ({ tabId }) => {
      try {
        await hub.dispatch('close_tab', { tabId });
        return {
          content: [{ type: 'text', text: `Closed Tab #${tabId}` }]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to close tab: ${err.message}` }]
        };
      }
    }
  );

  // 6. browser_read_page
  server.tool(
    'browser_read_page',
    'Extract the readable text, markdown structure, or interactive elements (buttons, links, inputs) from the web page.',
    {
      format: z
        .enum(['markdown', 'text', 'interactive_elements', 'html'])
        .optional()
        .describe("Extraction format: 'markdown' (default readable text), 'interactive_elements' (list of interactable buttons/inputs with selectors), 'text' (plain text), 'html' (raw DOM)"),
      maxLength: z.number().optional().describe('Maximum characters to return (default 15,000)'),
      tabId: z.number().optional().describe('Target tab ID (defaults to active tab)')
    },
    async ({ format = 'markdown', maxLength = 15000, tabId }) => {
      try {
        const result = await hub.dispatch('read_page', { format, maxLength, tabId }, 25000);
        return {
          content: [
            {
              type: 'text',
              text: `Page Title: ${result.title}\nURL: ${result.url}\n\n${result.content}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to read page: ${err.message}` }]
        };
      }
    }
  );

  // 7. browser_click
  server.tool(
    'browser_click',
    'Click an element on the current page using a CSS selector, matching text label, coordinates, or OmniParser badge number.',
    {
      selector: z.string().optional().describe("CSS selector for the element (e.g. 'button.btn-primary', '#login-btn', 'a.nav-link')"),
      text: z.string().optional().describe("Text content inside the element to match and click (e.g. 'Log In', 'Submit', 'Next')"),
      x: z.number().optional().describe('X coordinate on the viewport to click'),
      y: z.number().optional().describe('Y coordinate on the viewport to click'),
      index: z.number().optional().describe('If selector matches multiple elements, which index to click (0-based, or -1 for last)'),
      label: z.number().optional().describe('Numeric badge label from browser_label_elements to click (e.g. 1, 2, 3)'),
      humanize: z.boolean().optional().describe('Simulate human Bezier curve mouse trajectory with jitter and natural dwell time to bypass bot detection (default false)'),
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ selector, text, x, y, index, label, humanize = false, tabId }) => {
      if (!selector && !text && typeof x !== 'number' && typeof label !== 'number') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Either `selector`, `text`, `label`, or `x`/`y` coordinates must be provided.' }]
        };
      }

      try {
        const result = await hub.dispatch('click', { selector, text, x, y, index, label, humanize, tabId }, 25000);
        return {
          content: [
            {
              type: 'text',
              text: `✅ Clicked element successfully! Target: ${result.description || selector || text}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to click element: ${err.message}` }]
        };
      }
    }
  );

  // 8. browser_type
  server.tool(
    'browser_type',
    'Type text into an input field, search box, or textarea on the page with realistic input events.',
    {
      selector: z.string().describe("CSS selector for the input element (e.g. 'input[name=q]', '#search-box', 'textarea')"),
      text: z.string().describe('The text string to type'),
      clear: z.boolean().optional().describe('Whether to clear existing text in the input field before typing (default false)'),
      pressEnter: z.boolean().optional().describe('Whether to trigger an Enter key press immediately after typing (default false)'),
      humanize: z.boolean().optional().describe('Simulate realistic human typing with variable keystroke delay (40ms-140ms) and keydown/keypress/input/keyup event dispatch (default false)'),
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ selector, text, clear = false, pressEnter = false, humanize = false, tabId }) => {
      try {
        const result = await hub.dispatch('type', { selector, text, clear, pressEnter, humanize, tabId }, 30000);
        return {
          content: [
            {
              type: 'text',
              text: `✅ Typed "${text}" into "${selector}"${pressEnter ? ' and pressed Enter' : ''}. Current value: "${result.value ?? text}"`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to type: ${err.message}` }]
        };
      }
    }
  );

  // 9. browser_press_key
  server.tool(
    'browser_press_key',
    'Send a keyboard key press event to the active element in the page (e.g. Enter, Escape, Tab, ArrowDown, Backspace).',
    {
      key: z.string().describe("The key name to press (e.g. 'Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'Backspace')"),
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ key, tabId }) => {
      try {
        await hub.dispatch('press_key', { key, tabId });
        return {
          content: [{ type: 'text', text: `Pressed key: '${key}'` }]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to press key: ${err.message}` }]
        };
      }
    }
  );

  // 10. browser_scroll
  server.tool(
    'browser_scroll',
    'Scroll the page up, down, to top/bottom, or scroll a specific element into view.',
    {
      direction: z.enum(['up', 'down', 'top', 'bottom']).optional().describe("Direction to scroll (default 'down')"),
      amount: z.number().optional().describe('Pixels to scroll if scrolling up/down (default 600)'),
      selector: z.string().optional().describe('Optional CSS selector of a specific element to scroll into view'),
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ direction = 'down', amount = 600, selector, tabId }) => {
      try {
        const result = await hub.dispatch('scroll', { direction, amount, selector, tabId });
        return {
          content: [
            {
              type: 'text',
              text: `Scrolled ${direction}${selector ? ` to element '${selector}'` : ` by ${amount}px`}. Current scrollY: ${result.scrollY}px`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to scroll: ${err.message}` }]
        };
      }
    }
  );

  // 11. browser_take_screenshot
  server.tool(
    'browser_take_screenshot',
    'Capture a visual screenshot of the current viewport in your local browser and return the image for visual verification.',
    {
      tabId: z.number().optional().describe('Target tab ID (defaults to active tab)')
    },
    async ({ tabId }) => {
      try {
        const result = await hub.dispatch('screenshot', { tabId }, 25000);
        let base64Data = result.dataUrl || result.image;
        if (base64Data.startsWith('data:image/jpeg;base64,')) {
          base64Data = base64Data.replace('data:image/jpeg;base64,', '');
          return {
            content: [
              {
                type: 'image',
                data: base64Data,
                mimeType: 'image/jpeg'
              },
              {
                type: 'text',
                text: `Screenshot of Tab #${result.tabId} (${result.title || 'Page'}) captured successfully.`
              }
            ]
          };
        } else if (base64Data.startsWith('data:image/png;base64,')) {
          base64Data = base64Data.replace('data:image/png;base64,', '');
          return {
            content: [
              {
                type: 'image',
                data: base64Data,
                mimeType: 'image/png'
              },
              {
                type: 'text',
                text: `Screenshot of Tab #${result.tabId} (${result.title || 'Page'}) captured successfully.`
              }
            ]
          };
        } else {
          return {
            content: [
              {
                type: 'image',
                data: base64Data,
                mimeType: 'image/png'
              }
            ]
          };
        }
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to capture screenshot: ${err.message}` }]
        };
      }
    }
  );

  // 12. browser_evaluate
  server.tool(
    'browser_evaluate',
    'Execute custom JavaScript in the context of the active web page and return the serialized result.',
    {
      script: z.string().describe("JavaScript code to evaluate (e.g. 'document.title' or 'window.location.href')"),
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ script, tabId }) => {
      try {
        const result = await hub.dispatch('evaluate', { script, tabId }, 25000);
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to evaluate script: ${err.message}` }]
        };
      }
    }
  );

  // 13. browser_run_code
  server.tool(
    'browser_run_code',
    'Execute arbitrary async JavaScript code inside the browser tab context with elevated permissions (immune to page CSP) and return the output.',
    {
      code: z.string().describe("JavaScript code to execute. Can use 'await', DOM APIs (document, window), and return values/objects directly."),
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ code, tabId }) => {
      try {
        const result = await hub.dispatch('run_code', { code, tabId }, 30000);
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result ?? 'undefined')
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to run code: ${err.message}` }]
        };
      }
    }
  );

  // 14. browser_get_cookies
  server.tool(
    'browser_get_cookies',
    'Extract active cookies and session credentials for the current tab URL / domain.',
    {
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ tabId }) => {
      try {
        const result = await hub.dispatch('get_cookies', { tabId }, 15000);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to get cookies: ${err.message}` }]
        };
      }
    }
  );

  // 15. browser_upload_file
  server.tool(
    'browser_upload_file',
    'Upload a file directly into a file input (<input type="file">) on the page using base64 encoded data.',
    {
      base64Data: z.string().describe('Base64 encoded file content'),
      filename: z.string().describe('File name including extension (e.g. resume.pdf, photo.jpg)'),
      mimeType: z.string().optional().describe("MIME type of the file (e.g. 'image/jpeg', 'application/pdf', default 'application/octet-stream')"),
      selector: z.string().optional().describe("CSS selector for the file input element (default 'input[type=\"file\"]')"),
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ base64Data, filename, mimeType = 'application/octet-stream', selector, tabId }) => {
      try {
        const result = await hub.dispatch('upload_file', { base64Data, filename, mimeType, selector, tabId }, 25000);
        return {
          content: [
            {
              type: 'text',
              text: `✅ File "${filename}" (${result.size} bytes) uploaded successfully into "${result.selector}".`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to upload file: ${err.message}` }]
        };
      }
    }
  );

  // 16. browser_label_elements
  server.tool(
    'browser_label_elements',
    'Add visual numbered badges to all interactive elements on the page (OmniParser mode) or remove them.',
    {
      remove: z.boolean().optional().describe('Set to true to remove all existing visual label badges from the page'),
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ remove = false, tabId }) => {
      try {
        const result = await hub.dispatch('label_elements', { remove, tabId }, 20000);
        if (remove) {
          return {
            content: [{ type: 'text', text: '✅ All visual element labels removed.' }]
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: `✅ Labeled ${result.count} interactive element(s) with visual badges [1] through [${result.count}]. Use browser_click({ label: number }) to click any of them directly.\n\nFirst elements:\n${JSON.stringify(result.labels.slice(0, 30), null, 2)}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to label elements: ${err.message}` }]
        };
      }
    }
  );

  // 17. browser_handle_dialog
  server.tool(
    'browser_handle_dialog',
    'Intercept, accept, or dismiss native JavaScript dialogs (alert, confirm, prompt, beforeunload) and configure auto-handling policies to prevent tab freezing.',
    {
      action: z.enum(['accept', 'dismiss']).optional().describe("Action to take on pending or future dialogs (default 'accept')"),
      promptText: z.string().optional().describe("Text value to submit into window.prompt dialogs (default '')"),
      setPolicy: z.boolean().optional().describe('If true, sets persistent policy for all future dialogs on the page (default false)'),
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ action = 'accept', promptText = '', setPolicy = false, tabId }) => {
      try {
        const result = await hub.dispatch('handle_dialog', { action, promptText, setPolicy, tabId }, 15000);
        return {
          content: [
            {
              type: 'text',
              text: result.policySet
                ? `✅ Dialog policy set to "${result.policySet}". Future alerts/confirms/prompts will be automatically handled.`
                : `✅ ${result.message || 'Dialog action processed successfully.'}`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to handle dialog: ${err.message}` }]
        };
      }
    }
  );

  // 18. browser_wait_for_network_idle
  server.tool(
    'browser_wait_for_network_idle',
    'Wait until all in-flight network requests (XHR, fetch, resources) have settled on single-page applications before continuing.',
    {
      idleTimeMs: z.number().optional().describe('Continuous duration with 0 active requests required to consider the page idle in milliseconds (default 500ms)'),
      timeoutMs: z.number().optional().describe('Maximum duration to wait before timing out in milliseconds (default 15000ms)'),
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ idleTimeMs = 500, timeoutMs = 15000, tabId }) => {
      try {
        const result = await hub.dispatch('wait_for_network_idle', { idleTimeMs, timeoutMs, tabId }, timeoutMs + 5000);
        return {
          content: [
            {
              type: 'text',
              text: result.idle
                ? `✅ Network idle achieved in ${result.durationMs}ms (0 in-flight requests).`
                : `⚠️ Network did not settle within timeout (${result.durationMs}ms). Remaining in-flight requests: ${result.inFlightRequests}.`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed waiting for network idle: ${err.message}` }]
        };
      }
    }
  );

  // 19. browser_clipboard
  server.tool(
    'browser_clipboard',
    'Read from or write text to the desktop browser clipboard.',
    {
      action: z.enum(['read', 'write']).describe("Action to perform: 'read' to get clipboard text, 'write' to set it"),
      text: z.string().optional().describe("The text to copy into the clipboard (required when action is 'write')")
    },
    async ({ action, text = '' }) => {
      try {
        if (action === 'read') {
          const result = await hub.dispatch('get_clipboard', {}, 15000);
          return {
            content: [
              {
                type: 'text',
                text: result.text ? `📋 Clipboard contents:\n${result.text}` : '(Clipboard is currently empty)'
              }
            ]
          };
        } else {
          await hub.dispatch('set_clipboard', { text }, 15000);
          return {
            content: [
              {
                type: 'text',
                text: `✅ Copied ${text.length} characters to clipboard successfully.`
              }
            ]
          };
        }
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Clipboard operation failed: ${err.message}` }]
        };
      }
    }
  );

  // 20. browser_downloads
  server.tool(
    'browser_downloads',
    'Inspect, list recent browser downloads, or wait for an active file download to complete.',
    {
      action: z.enum(['list', 'wait']).optional().describe("Action to perform: 'list' to show recent downloads, 'wait' to wait for completion (default 'list')"),
      filenamePattern: z.string().optional().describe("Substring of filename to match when waiting for a download (e.g. 'invoice', '.pdf', '.csv')"),
      downloadId: z.number().optional().describe('Specific download ID to wait for'),
      limit: z.number().optional().describe("Number of recent downloads to return when listing (default 10)"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds when waiting for a download (default 30000ms)")
    },
    async ({ action = 'list', filenamePattern, downloadId, limit = 10, timeoutMs = 30000 }) => {
      try {
        if (action === 'wait') {
          const result = await hub.dispatch('wait_for_download', { filenamePattern, downloadId, timeoutMs }, timeoutMs + 5000);
          return {
            content: [
              {
                type: 'text',
                text: `✅ Download completed successfully!\n- Filename: ${result.download?.filename}\n- Total Size: ${result.download?.totalBytes} bytes\n- MIME: ${result.download?.mime || 'unknown'}`
              }
            ]
          };
        } else {
          const items = await hub.dispatch('list_downloads', { limit }, 15000);
          return {
            content: [
              {
                type: 'text',
                text: items && items.length > 0
                  ? `📂 Recent Downloads (${items.length}):\n${JSON.stringify(items, null, 2)}`
                  : '📂 No recent downloads found.'
              }
            ]
          };
        }
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Downloads operation failed: ${err.message}` }]
        };
      }
    }
  );

  // 21. browser_request_tab_access
  server.tool(
    'browser_request_tab_access',
    'Request permission from the user to access a protected user tab. Displays an in-page banner and popup notification to the user.',
    {
      tabId: z.number().describe('The ID of the protected tab to request access to'),
      reason: z.string().optional().describe('Clear explanation of why you need access to this tab (e.g., "I need to inspect the invoice details on this page")'),
      timeoutSeconds: z.number().optional().describe('How many seconds to wait for user approval (default 25s, max 60s)')
    },
    async ({ tabId, reason, timeoutSeconds = 25 }) => {
      try {
        const timeoutMs = Math.min(Math.max(timeoutSeconds, 5), 60) * 1000;
        const result = await hub.dispatch(
          'request_tab_access',
          { tabId, reason, timeoutMs },
          timeoutMs + 5000
        );
        if (result.approved) {
          return {
            content: [
              {
                type: 'text',
                text: `✅ Permission GRANTED for Tab #${result.tabId} ("${result.title || 'Untitled'}"). You may now read, screenshot, and interact with this tab.`
              }
            ]
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: `❌ Permission ${result.timedOut ? 'TIMED OUT' : 'DENIED'} for Tab #${result.tabId} ("${result.title || 'Untitled'}"). Please operate in a new tab via browser_navigate({ url, newTab: true }).`
            }
          ]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to request tab access: ${err.message}` }]
        };
      }
    }
  );
}
