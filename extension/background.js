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
      reasons: ['BLOBS', 'LOCAL_STORAGE', 'CLIPBOARD'],
      justification:
        'Maintain the outbound WebSocket bridge for VPS AI Agent automation and service clipboard read/write commands'
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

// In-flight network requests tracking per tab
const activeRequestsByTab = new Map();

function trackRequestStart(tabId, requestId) {
  if (!tabId || tabId < 0) return;
  if (!activeRequestsByTab.has(tabId)) {
    activeRequestsByTab.set(tabId, new Set());
  }
  activeRequestsByTab.get(tabId).add(requestId);
}

function trackRequestEnd(tabId, requestId) {
  if (!tabId || tabId < 0) return;
  const requests = activeRequestsByTab.get(tabId);
  if (requests) {
    requests.delete(requestId);
    if (requests.size === 0) {
      activeRequestsByTab.delete(tabId);
    }
  }
}

if (chrome.webRequest) {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      trackRequestStart(details.tabId, details.requestId);
    },
    { urls: ['<all_urls>'] }
  );

  chrome.webRequest.onBeforeRedirect.addListener(
    (details) => {
      trackRequestEnd(details.tabId, details.requestId);
    },
    { urls: ['<all_urls>'] }
  );

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      trackRequestEnd(details.tabId, details.requestId);
    },
    { urls: ['<all_urls>'] }
  );

  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      trackRequestEnd(details.tabId, details.requestId);
    },
    { urls: ['<all_urls>'] }
  );
}

// Reset active requests on tab navigation to prevent stale network idle hangs,
// and re-validate tab grants whenever the page's origin can change.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    activeRequestsByTab.delete(tabId);
  }

  const grant = getGrant(tabId);
  if (!grant) return;

  const currentUrl = changeInfo.url || tab?.url || '';
  const origin = normalizeOrigin(currentUrl);
  if (!origin) return; // opaque/transitional page — leave the grant alone

  if (grant.kind === 'agent') {
    // The agent owns this tab; follow it across origins.
    if (grant.origin !== origin) {
      grant.origin = origin;
      savePrivacyState();
    }
    return;
  }

  // A user grant is scoped to the exact origin that was approved.
  if (origin !== grant.origin) {
    console.warn(`[BrowserPilot Background] Revoked tab grant for #${tabId}: navigated to ${origin}`);
    revokeTabAccess(tabId);
  }
});

// --- Hybrid Privacy & Tab Permission Engine ---
let privacyMode = 'hybrid'; // 'hybrid' | 'full' | 'sandbox'
// Grants are keyed by tab id, but every lookup re-validates the tab's *current*
// origin. Tab ids are recycled across browser restarts, and an approved tab can
// navigate somewhere else, so an id-based approval on its own is not a
// permission boundary.
const tabGrants = new Map(); // tabId -> { origin: string, kind: 'agent' | 'user', grantedAt: number }
const pendingPermissionRequests = new Map();
let privacyStateReady = Promise.resolve();

/** Origin used for grant comparison. Opaque schemes (chrome://, file://) get ''. */
function normalizeOrigin(url) {
  try {
    const parsed = new URL(url || '');
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

// Initialize privacy preferences & state
privacyStateReady = new Promise((resolve) => {
  chrome.storage.local.get(['privacyMode', 'tabGrants'], (data) => {
    if (data.privacyMode) {
      privacyMode = data.privacyMode;
    }
    if (Array.isArray(data.tabGrants)) {
      for (const entry of data.tabGrants) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [rawId, grant] = entry;
        const tabId = Number(rawId);
        if (!Number.isInteger(tabId) || !grant || typeof grant.origin !== 'string') continue;
        if (grant.kind !== 'agent' && grant.kind !== 'user') continue;
        tabGrants.set(tabId, {
          origin: grant.origin,
          kind: grant.kind,
          grantedAt: Number(grant.grantedAt) || Date.now()
        });
      }
    }
    resolve();
  });
});

function savePrivacyState() {
  chrome.storage.local.set({
    privacyMode,
    tabGrants: Array.from(tabGrants.entries())
  });
  // Legacy keys stored bare tab ids with no URL, so they could be inherited by
  // an unrelated tab after a restart. Drop them once migrated.
  chrome.storage.local.remove(['approvedUserTabs', 'agentOwnedTabs']);
}

function getGrant(tabId) {
  return tabGrants.get(tabId) || null;
}

/**
 * @param {{ id?: number, url?: string } | null} tab current tab snapshot
 */
function isTabApproved(tab) {
  if (privacyMode === 'full') return true;
  if (!tab || typeof tab.id !== 'number') return false;

  const grant = getGrant(tab.id);
  if (!grant) return false;
  if (grant.kind === 'agent') return true; // agent-spawned tab, any mode
  if (privacyMode === 'sandbox') return false;

  const origin = normalizeOrigin(tab.url);
  return Boolean(origin) && origin === grant.origin;
}

function isTabAgentOwned(tabId) {
  return getGrant(tabId)?.kind === 'agent';
}

function markTabAsAgentOwned(tabId, url) {
  tabGrants.set(tabId, {
    origin: normalizeOrigin(url),
    kind: 'agent',
    grantedAt: Date.now()
  });
  savePrivacyState();
}

async function approveTabAccess(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return false;
  const origin = normalizeOrigin(tab.url);
  if (!origin) return false; // opaque page (chrome://, file://) — not grantable

  tabGrants.set(tabId, {
    origin,
    kind: 'user',
    grantedAt: Date.now()
  });
  savePrivacyState();
  chrome.tabs.sendMessage(tabId, { type: 'CLEAR_PERMISSION_BANNER' }).catch(() => {});
  return true;
}

function revokeTabAccess(tabId) {
  if (!tabGrants.has(tabId)) return;
  tabGrants.delete(tabId);
  savePrivacyState();
}

// Cleanup on tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  revokeTabAccess(tabId);
  dialogHookInstalledFor.delete(tabId);
  if (pendingPermissionRequests.has(tabId)) {
    const cb = pendingPermissionRequests.get(tabId);
    pendingPermissionRequests.delete(tabId);
    cb(false);
  }
  activeRequestsByTab.delete(tabId);
});

async function requestTabAccessFromUser(tabId, reason) {
  try {
    await ensureContentScriptInjected(tabId);
    chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_PERMISSION_BANNER',
      reason: reason || 'AI Agent is requesting permission to view and interact with this tab.',
      timeoutMs: 25000
    }).catch(() => {});
  } catch (err) {
    console.warn('[BrowserPilot Background] Could not show permission banner:', err.message);
  }
}

async function handleRequestTabAccess({ tabId, reason, timeoutMs = 25000 } = {}) {
  const targetTab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : await getActiveTab().catch(() => null);
  if (!targetTab || !targetTab.id) {
    throw new Error('No target browser tab found to request access');
  }

  await privacyStateReady;

  const tid = targetTab.id;
  if (isTabApproved(targetTab)) {
    return {
      approved: true,
      tabId: tid,
      title: targetTab.title,
      isAgentOwned: isTabAgentOwned(tid),
      message: 'Tab is already approved for agent access'
    };
  }

  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        pendingPermissionRequests.delete(tid);
        chrome.tabs.sendMessage(tid, { type: 'CLEAR_PERMISSION_BANNER' }).catch(() => {});
        resolve({
          approved: false,
          timedOut: true,
          tabId: tid,
          title: targetTab.title,
          message: 'Permission request timed out waiting for user approval'
        });
      }
    }, timeoutMs);

    pendingPermissionRequests.set(tid, (approved) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        pendingPermissionRequests.delete(tid);
        resolve({
          approved,
          timedOut: false,
          tabId: tid,
          title: targetTab.title,
          message: approved ? 'User approved access to tab' : 'User denied access to tab'
        });
      }
    });

    requestTabAccessFromUser(tid, reason);
  });
}

async function checkCommandPermission(action, params = {}) {
  await privacyStateReady;
  if (privacyMode === 'full') return;

  // Actions that never require tab authorization
  if ([
    'status',
    'list_tabs',
    'request_tab_access',
    'reload_extension',
    'get_clipboard',
    'set_clipboard',
    'list_downloads',
    'wait_for_download',
    'switch_tab'
  ].includes(action)) {
    return;
  }

  // Navigate with newTab: true always permitted (spawns an agent-owned tab)
  if (action === 'navigate' && params.newTab) {
    return;
  }

  // Batch close is authorised per target tab inside closeMultipleTabs(); the
  // generic path would wrongly gate on whichever tab happens to be active.
  if (action === 'close_tabs') {
    return;
  }

  // Determine target tab ID
  let targetTabId = params.tabId;
  if (!targetTabId) {
    const active = await getActiveTab().catch(() => null);
    if (!active || !active.id) {
      throw new Error('No active browser tab found');
    }
    targetTabId = active.id;
  }

  // Target tab is protected? Grants are always re-validated against the tab's
  // live origin so a recycled tab id or a cross-origin navigation cannot inherit
  // an old approval.
  const targetTab = await chrome.tabs.get(targetTabId).catch(() => null);
  if (isTabApproved(targetTab)) {
    return;
  }

  const tabTitle = targetTab?.title || 'Untitled';
  const tabUrl = targetTab?.url || '';

  // Trigger permission banner on target tab
  requestTabAccessFromUser(targetTabId, `AI Agent requested '${action}' access`).catch(() => {});

  if (privacyMode === 'sandbox') {
    throw new Error(
      `PERMISSION_REQUIRED: Tab #${targetTabId} ("${tabTitle}") was not opened by BrowserPilot. Strict Sandbox mode is active, which restricts AI actions exclusively to tabs spawned by the agent.`
    );
  }

  throw new Error(
    `PERMISSION_REQUIRED: Tab #${targetTabId} ("${tabTitle}") is a protected user tab. A permission request banner has been displayed on this tab and in the BrowserPilot extension popup. Please ask the user to grant access in their browser, or open a new tab via browser_navigate({ url: "${tabUrl || 'https://...'}", newTab: true }).`
  );
}

function isInternalExtensionContext(sender) {
  return Boolean(sender && !sender.tab && sender.id === chrome.runtime.id);
}

// Update extension badge on status change
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CONNECTION_STATUS_UPDATE') {
    if (!isInternalExtensionContext(sender)) {
      sendResponse({ error: 'Unauthorized' });
      return false;
    }
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
    if (!isInternalExtensionContext(sender)) {
      sendResponse({ error: 'Unauthorized' });
      return false;
    }
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
    if (!isInternalExtensionContext(sender)) {
      sendResponse({ error: 'Unauthorized' });
      return false;
    }
    chrome.storage.local.get(['wsUrl', 'secretToken', 'autoConnect'], (data) => {
      sendResponse(data);
    });
    return true; // async sendResponse
  }

  if (msg.type === 'GET_PRIVACY_STATE') {
    if (!isInternalExtensionContext(sender)) {
      sendResponse({ error: 'Unauthorized' });
      return false;
    }
    sendResponse({
      privacyMode,
      approvedUserTabs: Array.from(tabGrants.entries())
        .filter(([, grant]) => grant.kind === 'user')
        .map(([id]) => id),
      agentOwnedTabs: Array.from(tabGrants.entries())
        .filter(([, grant]) => grant.kind === 'agent')
        .map(([id]) => id)
    });
    return false;
  }

  if (msg.type === 'SET_PRIVACY_MODE') {
    if (!isInternalExtensionContext(sender)) {
      sendResponse({ ok: false, error: 'Unauthorized' });
      return false;
    }
    if (['hybrid', 'full', 'sandbox'].includes(msg.privacyMode)) {
      privacyMode = msg.privacyMode;
      savePrivacyState();
    }
    sendResponse({ ok: true, privacyMode });
    return false;
  }

  if (msg.type === 'APPROVE_TAB') {
    if (!isInternalExtensionContext(sender)) {
      sendResponse({ ok: false, error: 'Unauthorized' });
      return false;
    }
    approveTabAccess(msg.tabId)
      .then((granted) => {
        if (pendingPermissionRequests.has(msg.tabId)) {
          const cb = pendingPermissionRequests.get(msg.tabId);
          pendingPermissionRequests.delete(msg.tabId);
          cb(Boolean(granted));
        }
        sendResponse({ ok: Boolean(granted) });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'REVOKE_TAB') {
    if (!isInternalExtensionContext(sender)) {
      sendResponse({ ok: false, error: 'Unauthorized' });
      return false;
    }
    revokeTabAccess(msg.tabId);
    if (pendingPermissionRequests.has(msg.tabId)) {
      const cb = pendingPermissionRequests.get(msg.tabId);
      pendingPermissionRequests.delete(msg.tabId);
      cb(false);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'TAB_PERMISSION_RESPONSE') {
    const tabId = sender.tab ? sender.tab.id : null;
    if (!tabId || sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, error: 'Unauthorized: TAB_PERMISSION_RESPONSE must originate from sender.tab' });
      return false;
    }
    const settle = () => {
      if (pendingPermissionRequests.has(tabId)) {
        const cb = pendingPermissionRequests.get(tabId);
        pendingPermissionRequests.delete(tabId);
        cb(Boolean(msg.approved));
      }
    };

    if (msg.approved) {
      approveTabAccess(tabId).then((granted) => {
        settle();
        sendResponse({ ok: Boolean(granted) });
      }).catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    revokeTabAccess(tabId);
    settle();
    sendResponse({ ok: true });
    return false;
  }
});

// 2. Command Execution Router (dispatched exclusively from offscreen.js)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== 'EXECUTE_COMMAND') return;

  if (!isInternalExtensionContext(sender)) {
    console.warn('[BrowserPilot Background] Rejected unauthorized EXECUTE_COMMAND from non-internal sender:', sender);
    sendResponse({ success: false, error: 'Unauthorized: EXECUTE_COMMAND only permitted from internal extension context.' });
    return false;
  }

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
  await checkCommandPermission(action, params);

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
    case 'close_tabs':
      return closeMultipleTabs(params);
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
    case 'wait_for_network_idle':
      return waitForNetworkIdle(params);
    case 'get_clipboard':
      return getClipboardContent();
    case 'set_clipboard':
      return setClipboardContent(params);
    case 'list_downloads':
      return listRecentDownloads(params);
    case 'wait_for_download':
      return waitForDownloadComplete(params);
    case 'request_tab_access':
      return handleRequestTabAccess(params);
    case 'handle_dialog':
      return handleDialogCommand(params);
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
  await privacyStateReady;
  const tabs = await chrome.tabs.query({});
  return tabs.map((t) => ({
    id: t.id,
    title: t.title || '',
    url: t.url || '',
    active: t.active,
    windowId: t.windowId,
    favIconUrl: t.favIconUrl,
    isAgentOwned: isTabAgentOwned(t.id),
    isApproved: isTabApproved(t)
  }));
}

async function navigateTab({ url, newTab = false, tabId }) {
  let targetTabId = tabId;

  if (newTab || !targetTabId) {
    if (newTab) {
      const created = await chrome.tabs.create({ url });
      targetTabId = created.id;
      markTabAsAgentOwned(targetTabId, url);
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab) {
        targetTabId = activeTab.id;
        await chrome.tabs.update(targetTabId, { url });
      } else {
        const created = await chrome.tabs.create({ url });
        targetTabId = created.id;
        markTabAsAgentOwned(targetTabId, url);
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
    url: updatedTab.url,
    isAgentOwned: isTabAgentOwned(targetTabId),
    isApproved: isTabApproved(updatedTab)
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
  revokeTabAccess(targetId);
  return { ok: true, closedTabId: targetId };
}

async function closeMultipleTabs({ tabIds, match } = {}) {
  await privacyStateReady;
  const allTabs = await chrome.tabs.query({});
  const byId = new Map(allTabs.map((t) => [t.id, t]));

  let candidateIds = [];
  if (Array.isArray(tabIds) && tabIds.length > 0) {
    candidateIds = tabIds;
  } else if (match) {
    let regex;
    try {
      regex = new RegExp(match, 'i');
    } catch {
      regex = new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    candidateIds = allTabs
      .filter((t) => regex.test(t.url || '') || regex.test(t.title || ''))
      .map((t) => t.id);
  }

  const closable = [];
  const protectedIds = [];
  for (const id of candidateIds) {
    const tab = byId.get(id);
    if (!tab) continue;
    if (isTabApproved(tab)) {
      closable.push(id);
    } else {
      protectedIds.push(id);
    }
  }

  if (closable.length === 0 && protectedIds.length === 0) {
    return { ok: true, closedCount: 0, closedTabIds: [], message: 'No matching tabs found to close.' };
  }

  if (closable.length === 0) {
    throw new Error(
      `PERMISSION_REQUIRED: ${protectedIds.length} matching tab(s) are protected user tabs ` +
        `(#${protectedIds.join(', #')}). Ask the user for access with browser_request_tab_access before closing them.`
    );
  }

  await chrome.tabs.remove(closable);
  closable.forEach((id) => revokeTabAccess(id));

  const skipped = protectedIds.length
    ? ` Skipped ${protectedIds.length} protected tab(s) (#${protectedIds.join(', #')}).`
    : '';

  return {
    ok: true,
    closedCount: closable.length,
    closedTabIds: closable,
    skippedTabIds: protectedIds,
    message: `Successfully closed ${closable.length} tab(s).${skipped}`
  };
}

async function captureScreenshot({ tabId, format = 'jpeg', quality = 80 } = {}) {
  const currentTab = await getActiveTab().catch(() => null);
  const targetTab = tabId ? await chrome.tabs.get(tabId) : currentTab;

  if (!targetTab) {
    throw new Error('No target tab found for screenshot');
  }

  let switchedTab = false;
  if (tabId && currentTab && currentTab.id !== tabId) {
    await chrome.tabs.update(tabId, { active: true });
    switchedTab = true;
    await new Promise((r) => setTimeout(r, 150));
  }

  // Restore window if minimized to prevent captureVisibleTab errors
  const win = await chrome.windows.get(targetTab.windowId).catch(() => null);
  let wasMinimized = false;
  if (win && win.state === 'minimized') {
    wasMinimized = true;
    await chrome.windows.update(targetTab.windowId, { state: 'normal' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
  }

  let dataUrl;
  try {
    const captureOptions = {
      format: format === 'png' ? 'png' : 'jpeg'
    };
    if (captureOptions.format === 'jpeg') {
      captureOptions.quality = typeof quality === 'number' ? quality : 80;
    }
    dataUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId, captureOptions);
  } finally {
    if (wasMinimized) {
      chrome.windows.update(targetTab.windowId, { state: 'minimized' }).catch(() => {});
    }
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

const DIALOG_DEFAULTS = { policy: 'dismiss', promptText: '' };
// tabId -> URL the hook was installed for. A navigation replaces the document,
// so the hook has to be re-injected; without this bookkeeping every single
// command would pay for another world injection.
const dialogHookInstalledFor = new Map();

async function getDialogConfig() {
  try {
    const data = await chrome.storage.local.get(['dialogPolicy', 'dialogPromptText']);
    const policy = data.dialogPolicy === 'accept' ? 'accept' : 'dismiss';
    return { policy, promptText: typeof data.dialogPromptText === 'string' ? data.dialogPromptText : '' };
  } catch {
    return { ...DIALOG_DEFAULTS };
  }
}

/**
 * Installs (or reconfigures) the MAIN-world dialog hook.
 *
 * Native alert/confirm/prompt are synchronous, so they cannot wait for the
 * agent; the hook resolves them from this policy. Injecting into MAIN is the
 * only way to affect the page's own dialog functions.
 */
async function installDialogHook(tabId, config) {
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const url = tab?.url || '';
    if (dialogHookInstalledFor.get(tabId) !== url) {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: ['dialog-hook.js']
      });
      dialogHookInstalledFor.set(tabId, url);
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (cfg) => {
        window.__browserpilotDialogConfig = cfg;
      },
      args: [config]
    });
    return true;
  } catch (err) {
    // Restricted pages (chrome://, the Web Store, PDF viewer) refuse injection.
    // Expected, not alarming — the command itself will report the failure.
    dialogHookInstalledFor.delete(tabId);
    console.debug('[BrowserPilot Background] Could not install dialog hook:', err.message);
    return false;
  }
}

async function readLastDialog(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const log = window.__browserpilotDialogLog;
        return Array.isArray(log) && log.length > 0 ? log[log.length - 1] : null;
      }
    });
    return results?.[0]?.result || null;
  } catch {
    return null;
  }
}

async function handleDialogCommand({ action = 'accept', promptText = '', tabId } = {}) {
  const targetTab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : await getActiveTab().catch(() => null);
  if (!targetTab || !targetTab.id) {
    throw new Error('No target browser tab found for dialog handling');
  }

  const policy = action === 'accept' ? 'accept' : 'dismiss';
  const config = { policy, promptText: typeof promptText === 'string' ? promptText : '' };
  await chrome.storage.local.set({ dialogPolicy: config.policy, dialogPromptText: config.promptText });

  const installed = await installDialogHook(targetTab.id, config);
  const lastDialog = installed ? await readLastDialog(targetTab.id) : null;

  return {
    ok: true,
    policySet: installed ? policy : null,
    handledDialog: lastDialog,
    message: installed
      ? `Dialog policy set to "${policy}". Future alert/confirm/prompt calls on Tab #${targetTab.id} are auto-resolved.`
      : `Could not install the dialog hook on Tab #${targetTab.id} (restricted page). Dialogs were not intercepted.`
  };
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
        files: ['dom-utils.js', 'content.js']
      });
      // Allow brief moment for content script to bind listeners
      await new Promise((r) => setTimeout(r, 100));
    }

    // Keep the MAIN-world dialog hook present with the current policy, so a
    // page cannot freeze the tab mid-automation even before the agent asks.
    await installDialogHook(tabId, await getDialogConfig());
  } catch (err) {
    console.warn('[BrowserPilot Background] Script injection notice:', err.message);
  }
}

async function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let timer = null;
    let checkFallbackTimer = null;
    let settled = false;

    const cleanup = () => {
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      if (timer) clearTimeout(timer);
      if (checkFallbackTimer) clearTimeout(checkFallbackTimer);
    };

    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    // Fallback check after 350ms in case tab was already complete and never transitioned through loading
    checkFallbackTimer = setTimeout(async () => {
      if (settled) return;
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab && tab.status === 'complete') {
        cleanup();
        resolve();
      }
    }, 350);

    timer = setTimeout(() => {
      cleanup();
      resolve(); // Resolve on timeout to avoid hanging indefinitely
    }, timeoutMs);
  });
}

// --- Network Idle, Clipboard & Download Implementations ---

async function waitForNetworkIdle({ tabId, idleTimeMs = 500, timeoutMs = 15000 }) {
  const targetTab = tabId ? await chrome.tabs.get(tabId) : await getActiveTab();
  if (!targetTab || !targetTab.id) {
    throw new Error('No target tab found to wait for network idle');
  }

  const tid = targetTab.id;
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    let idleTimer = null;
    let pollInterval = null;

    const cleanup = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (pollInterval) clearInterval(pollInterval);
    };

    const checkStatus = () => {
      if (Date.now() - startTime >= timeoutMs) {
        cleanup();
        const activeCount = activeRequestsByTab.get(tid)?.size || 0;
        resolve({
          idle: false,
          timedOut: true,
          inFlightRequests: activeCount,
          durationMs: Date.now() - startTime
        });
        return;
      }

      const activeCount = activeRequestsByTab.get(tid)?.size || 0;
      if (activeCount === 0) {
        if (!idleTimer) {
          idleTimer = setTimeout(() => {
            cleanup();
            resolve({
              idle: true,
              timedOut: false,
              inFlightRequests: 0,
              durationMs: Date.now() - startTime
            });
          }, idleTimeMs);
        }
      } else {
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      }
    };

    pollInterval = setInterval(checkStatus, 50);
    checkStatus();
  });
}

async function getClipboardContent() {
  const failures = [];

  // The clipboard API needs a focused document. Try the focused tab first, then
  // the offscreen document, and report *why* it failed instead of pretending
  // the clipboard is empty.
  const activeTab = await getActiveTab().catch(() => null);
  if (activeTab && activeTab.id) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: async () => {
          try {
            return { text: await navigator.clipboard.readText() };
          } catch (e) {
            return { error: e.message || String(e) };
          }
        }
      });
      const res = results?.[0]?.result;
      if (res && res.error) {
        failures.push(`tab: ${res.error}`);
      } else if (res && typeof res.text === 'string') {
        return { text: res.text };
      }
    } catch (e) {
      failures.push(`tab: ${e.message}`);
    }
  }

  const offscreen = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_READ_CLIPBOARD' }, (response) => resolve(response));
  });

  // `error` must be checked first: a failed read also carries `text: ''`, which
  // would otherwise be reported as a genuinely empty clipboard.
  if (offscreen && offscreen.error) {
    failures.push(`offscreen: ${offscreen.error}`);
  } else if (offscreen && typeof offscreen.text === 'string') {
    return { text: offscreen.text };
  }

  return {
    text: '',
    denied: true,
    note:
      'Clipboard read was blocked by the browser (it needs a focused window with clipboard permission). ' +
      'Focus the browser window and retry. ' +
      (failures.length ? `Details: ${failures.join('; ')}` : '')
  };
}

async function setClipboardContent({ text = '' }) {
  const activeTab = await getActiveTab().catch(() => null);
  if (activeTab && activeTab.id) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: async (val) => {
          await navigator.clipboard.writeText(val);
        },
        args: [text]
      });
      return { ok: true, textLength: text.length };
    } catch (e) {
      console.warn('[BrowserPilot Background] Scripting clipboard write failed, falling back:', e.message);
    }
  }

  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_WRITE_CLIPBOARD', text }, (res) => resolve(res));
  });

  if (response && response.ok === false) {
    throw new Error(`Clipboard write was blocked by the browser: ${response.error || 'unknown error'}`);
  }
  return { ok: true, textLength: text.length };
}

async function listRecentDownloads({ limit = 10, state }) {
  if (!chrome.downloads) {
    throw new Error('Downloads API not available');
  }

  const query = { limit, orderBy: ['-startTime'] };
  if (state) {
    query.state = state; // 'in_progress', 'complete', or 'interrupted'
  }

  const items = await chrome.downloads.search(query);
  return items.map((item) => ({
    id: item.id,
    filename: item.filename,
    url: item.url,
    totalBytes: item.totalBytes,
    bytesReceived: item.bytesReceived,
    state: item.state,
    danger: item.danger,
    mime: item.mime,
    startTime: item.startTime,
    endTime: item.endTime,
    exists: item.exists
  }));
}

async function waitForDownloadComplete({ downloadId, filenamePattern, timeoutMs = 30000 }) {
  if (!chrome.downloads) {
    throw new Error('Downloads API not available');
  }

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    let timer = null;

    const checkExisting = async () => {
      let query = { orderBy: ['-startTime'], limit: 5 };
      if (downloadId) query.id = downloadId;

      const items = await chrome.downloads.search(query);
      for (const item of items) {
        const matchesName = !filenamePattern || item.filename.toLowerCase().includes(filenamePattern.toLowerCase());
        if (matchesName) {
          if (item.state === 'complete') {
            cleanup();
            resolve({
              completed: true,
              download: {
                id: item.id,
                filename: item.filename,
                totalBytes: item.totalBytes,
                mime: item.mime,
                url: item.url
              }
            });
            return true;
          } else if (item.state === 'interrupted') {
            cleanup();
            reject(new Error(`Download interrupted: ${item.error || 'Unknown error'}`));
            return true;
          }
        }
      }
      return false;
    };

    const changeListener = (delta) => {
      if (downloadId && delta.id !== downloadId) return;

      if (delta.state) {
        if (delta.state.current === 'complete') {
          chrome.downloads.search({ id: delta.id }).then(([item]) => {
            if (item) {
              const matchesName = !filenamePattern || item.filename.toLowerCase().includes(filenamePattern.toLowerCase());
              if (matchesName) {
                cleanup();
                resolve({
                  completed: true,
                  download: {
                    id: item.id,
                    filename: item.filename,
                    totalBytes: item.totalBytes,
                    mime: item.mime,
                    url: item.url
                  }
                });
              }
            }
          });
        } else if (delta.state.current === 'interrupted') {
          cleanup();
          reject(new Error(`Download interrupted (ID: ${delta.id})`));
        }
      }
    };

    const cleanup = () => {
      chrome.downloads.onChanged.removeListener(changeListener);
      if (timer) clearTimeout(timer);
    };

    chrome.downloads.onChanged.addListener(changeListener);

    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Download timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // Initial check in case it already completed
    checkExisting();
  });
}
