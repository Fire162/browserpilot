/**
 * BrowserPilot Background Service Worker
 */

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

// 1. Ensure Offscreen Document is running
async function setupOffscreenDocument() {
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });

    if (existingContexts.length > 0) {
      return;
    }

    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['BLOBS', 'LOCAL_STORAGE'],
      justification: 'Maintain continuous outbound WebSocket bridge for VPS AI Agent automation'
    });
    console.log('[BrowserPilot Background] Offscreen document created.');
  } catch (err) {
    console.error('[BrowserPilot Background] Failed to setup offscreen document:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[BrowserPilot Background] Extension installed.');
  setupOffscreenDocument();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[BrowserPilot Background] Browser startup.');
  setupOffscreenDocument();
});

// Run setup immediately on service worker initialization
setupOffscreenDocument();

// Update extension badge on status change
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CONNECTION_STATUS_UPDATE') {
    if (msg.status === 'connected') {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' }); // Green
    } else if (msg.status === 'connecting') {
      chrome.action.setBadgeText({ text: '...' });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' }); // Orange
    } else {
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Red
    }
    return false;
  }

  if (msg.type === 'OFFSCREEN_DOCUMENT_READY') {
    chrome.storage.local.get(['wsUrl', 'secretToken', 'autoConnect'], (data) => {
      if (data.autoConnect !== false && data.wsUrl) {
        chrome.runtime.sendMessage({
          type: 'CONNECT_WEBSOCKET',
          wsUrl: data.wsUrl,
          secretToken: data.secretToken || ''
        }).catch(() => {});
      }
    });
    return false;
  }

  if (msg.type === 'GET_CONNECTION_CONFIG') {
    chrome.storage.local.get(['wsUrl', 'secretToken', 'autoConnect'], (data) => {
      sendResponse(data);
    });
    return true; // async sendResponse
  }
});

// 2. Command Execution Router (dispatched from offscreen.js)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== 'EXECUTE_COMMAND') return;

  const { command } = request;
  handleCommand(command.action, command.params)
    .then((result) => sendResponse({ success: true, result }))
    .catch((err) => {
      console.error('[BrowserPilot Background] Command error:', err);
      sendResponse({ success: false, error: err.message || String(err) });
    });

  return true; // Keep message channel open for async response
});

async function handleCommand(action, params = {}) {
  switch (action) {
    case 'status':
      return getStatusInfo();
    case 'list_tabs':
      return listTabs();
    case 'navigate':
      return navigateTab(params);
    case 'switch_tab':
      return switchTab(params);
    case 'close_tab':
      return closeTab(params);
    case 'reload_extension':
      setTimeout(() => chrome.runtime.reload(), 100);
      return { ok: true, message: 'Reloading extension...' };
    case 'screenshot':
      return captureScreenshot(params);
    case 'run_code':
      return runCodeInTab(params);
    case 'get_cookies':
      return getCookiesForTab(params);
    case 'evaluate':
      return evaluateWithScripting(params);
    case 'upload_file':
    case 'label_elements':
    case 'read_page':
    case 'click':
    case 'type':
    case 'press_key':
    case 'scroll':
      return executeInTab(action, params);
    default:
      throw new Error(`Unsupported action: ${action}`);
  }
}

// --- Action Implementations ---

async function getStatusInfo() {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const allTabs = await chrome.tabs.query({});
  return {
    activeTab: activeTab ? { id: activeTab.id, title: activeTab.title, url: activeTab.url } : null,
    totalTabs: allTabs.length
  };
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map((t) => ({
    id: t.id,
    title: t.title || '',
    url: t.url || '',
    active: t.active,
    windowId: t.windowId,
    favIconUrl: t.favIconUrl
  }));
}

async function navigateTab({ url, newTab = false, tabId }) {
  let targetTabId = tabId;

  if (newTab || !targetTabId) {
    if (newTab) {
      const created = await chrome.tabs.create({ url });
      targetTabId = created.id;
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab) {
        targetTabId = activeTab.id;
        await chrome.tabs.update(targetTabId, { url });
      } else {
        const created = await chrome.tabs.create({ url });
        targetTabId = created.id;
      }
    }
  } else {
    await chrome.tabs.update(targetTabId, { url });
  }

  // Wait for navigation to complete or timeout after 15s
  await waitForTabLoad(targetTabId, 15000);
  const updatedTab = await chrome.tabs.get(targetTabId);
  return {
    tabId: targetTabId,
    title: updatedTab.title,
    url: updatedTab.url
  };
}

async function switchTab({ tabId }) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return {
    tabId,
    title: tab.title,
    url: tab.url
  };
}

async function closeTab({ tabId }) {
  const targetId = tabId || (await getActiveTab()).id;
  await chrome.tabs.remove(targetId);
  return { ok: true, closedTabId: targetId };
}

async function captureScreenshot({ tabId }) {
  const currentTab = await getActiveTab().catch(() => null);
  const targetTab = tabId ? await chrome.tabs.get(tabId) : currentTab;

  let switchedTab = false;
  if (tabId && currentTab && currentTab.id !== tabId) {
    await chrome.tabs.update(tabId, { active: true });
    switchedTab = true;
    await new Promise((r) => setTimeout(r, 150));
  }

  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId, {
      format: 'png'
    });
  } finally {
    if (switchedTab && currentTab && currentTab.id) {
      await chrome.tabs.update(currentTab.id, { active: true }).catch(() => {});
    }
  }

  return {
    tabId: targetTab.id,
    title: targetTab.title,
    dataUrl
  };
}

async function executeInTab(action, params = {}) {
  const targetTab = params.tabId ? await chrome.tabs.get(params.tabId) : await getActiveTab();

  if (!targetTab || !targetTab.id) {
    throw new Error('No active browser tab found');
  }

  // Ensure content script is present
  await ensureContentScriptInjected(targetTab.id);

  // Send message to content script
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      targetTab.id,
      { type: 'DOM_ACTION', action, params },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response) {
          return reject(new Error('No response from content script'));
        }
        if (response.success) {
          resolve(response.result);
        } else {
          reject(new Error(response.error || 'DOM Action failed'));
        }
      }
    );
  });
}

async function evaluateWithScripting(params = {}) {
  const targetTab = params.tabId ? await chrome.tabs.get(params.tabId) : await getActiveTab();
  if (!targetTab || !targetTab.id) {
    throw new Error('No target browser tab found');
  }

  const scriptCode = params.script;
  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    world: 'MAIN',
    func: (code) => {
      try {
        return window.eval(code);
      } catch (err) {
        return { __eval_error: err.message || String(err) };
      }
    },
    args: [scriptCode]
  });

  if (!results || !results[0]) {
    return null;
  }

  const res = results[0].result;
  if (res && res.__eval_error) {
    throw new Error(res.__eval_error);
  }
  return res;
}

async function runCodeInTab(params = {}) {
  const targetTab = params.tabId ? await chrome.tabs.get(params.tabId) : await getActiveTab();
  if (!targetTab || !targetTab.id) {
    throw new Error('No target browser tab found');
  }

  const userCode = params.code || '';
  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    world: 'ISOLATED', // Extension isolated world: full DOM access, immune to website CSP
    func: async (code) => {
      try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const fn = new AsyncFunction(code);
        const res = await fn();
        return { __success: true, value: res };
      } catch (err) {
        return { __success: false, error: err.message || String(err), stack: err.stack };
      }
    },
    args: [userCode]
  });

  if (!results || !results[0]) {
    return { ok: false, error: 'No execution result returned' };
  }

  const outcome = results[0].result;
  if (outcome && !outcome.__success) {
    throw new Error(`Script Execution Error: ${outcome.error}`);
  }
  return outcome ? outcome.value : null;
}

async function getCookiesForTab(params = {}) {
  const targetTab = params.tabId ? await chrome.tabs.get(params.tabId) : await getActiveTab();
  if (!targetTab || !targetTab.url) {
    throw new Error('No target browser tab or URL found');
  }

  const cookies = await chrome.cookies.getAll({ url: targetTab.url });

  return {
    url: targetTab.url,
    count: cookies.length,
    cookies: cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expirationDate: c.expirationDate
    }))
  };
}

// Helpers
async function getActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab) return activeTab;
  const [firstTab] = await chrome.tabs.query({ active: true });
  if (firstTab) return firstTab;
  throw new Error('No open browser tabs found');
}

async function ensureContentScriptInjected(tabId) {
  try {
    // Ping content script
    const pong = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (resp) => {
        if (chrome.runtime.lastError || !resp) resolve(false);
        else resolve(true);
      });
    });

    if (!pong) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      // Allow brief moment for content script to bind listeners
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch (err) {
    console.warn('[BrowserPilot Background] Script injection notice:', err.message);
  }
}

function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let timer = null;

    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      if (timer) clearTimeout(timer);
    };

    timer = setTimeout(() => {
      cleanup();
      resolve(); // Resolve anyway on timeout
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
  });
}
