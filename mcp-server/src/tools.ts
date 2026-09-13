import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WebSocketHub } from './websocket-hub.js';

export function registerBrowserTools(server: McpServer, hub: WebSocketHub) {
  // 1. browser_status
  server.tool(
    'browser_status',
    'Check if the BrowserPilot Chrome extension is currently connected from your local computer, along with connection latency and status.',
    {},
    async () => {
      const status = hub.getStatus();
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
    'List all open tabs in your local browser, including tab IDs, URLs, page titles, and active tab status.',
    {},
    async () => {
      try {
        const tabs = await hub.dispatch('list_tabs', {});
        if (!Array.isArray(tabs) || tabs.length === 0) {
          return { content: [{ type: 'text', text: 'No open browser tabs found.' }] };
        }

        const formatted = tabs
          .map(
            (t: any) =>
              `- [Tab #${t.id}] ${t.active ? '⭐ (ACTIVE) ' : ''}"${t.title}"\n  URL: ${t.url}`
          )
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
    'Navigate the active browser tab (or open a new tab) to a specified URL.',
    {
      url: z.string().describe("The URL to navigate to (e.g. 'https://github.com' or 'https://google.com')"),
      newTab: z.boolean().optional().describe('If true, opens in a new tab instead of navigating the current tab'),
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
    'Click an element on the current page using a CSS selector or matching text label.',
    {
      selector: z.string().optional().describe("CSS selector for the element (e.g. 'button.btn-primary', '#login-btn', 'a.nav-link')"),
      text: z.string().optional().describe("Text content inside the element to match and click (e.g. 'Log In', 'Submit', 'Next')"),
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ selector, text, tabId }) => {
      if (!selector && !text) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Either `selector` or `text` must be provided to locate the element.' }]
        };
      }

      try {
        const result = await hub.dispatch('click', { selector, text, tabId }, 20000);
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
      tabId: z.number().optional().describe('Target tab ID')
    },
    async ({ selector, text, clear = false, pressEnter = false, tabId }) => {
      try {
        const result = await hub.dispatch('type', { selector, text, clear, pressEnter, tabId }, 20000);
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
}
