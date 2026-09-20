document.addEventListener('DOMContentLoaded', async () => {
  const wsUrlInput = document.getElementById('ws-url');
  const secretTokenInput = document.getElementById('secret-token');
  const autoConnectCheckbox = document.getElementById('auto-connect');
  const toggleVisibilityBtn = document.getElementById('toggle-token-visibility');
  const btnToggleConnection = document.getElementById('btn-toggle-connection');
  const btnTestPing = document.getElementById('btn-test-ping');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const bridgeMessage = document.getElementById('bridge-message');
  const activeTabInfo = document.getElementById('active-tab-info');

  let currentStatus = 'disconnected';

  // 1. Load saved preferences
  chrome.storage.local.get(['wsUrl', 'secretToken', 'autoConnect'], (data) => {
    if (data.wsUrl) wsUrlInput.value = data.wsUrl;
    if (data.secretToken) secretTokenInput.value = data.secretToken;
    if (data.autoConnect !== undefined) autoConnectCheckbox.checked = data.autoConnect;
  });

  // 2. Fetch current active tab info
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      activeTabInfo.textContent = `[#${activeTab.id}] ${activeTab.title || activeTab.url || 'New Tab'}`;
      activeTabInfo.title = activeTab.url || '';
    } else {
      activeTabInfo.textContent = 'No tab focused';
    }
  } catch {
    activeTabInfo.textContent = 'Unable to read active tab';
  }

  // 3. Query current socket status
  chrome.runtime.sendMessage({ type: 'GET_SOCKET_STATUS' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      updateUIStatus('disconnected', 'Offscreen relay ready');
    } else {
      updateUIStatus(res.status, res.status === 'connected' ? 'Connected to VPS' : 'Disconnected');
    }
  });

  // 4. Listen for real-time status updates from offscreen document
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'CONNECTION_STATUS_UPDATE') {
      updateUIStatus(msg.status, msg.message);
    }
  });

  // 5. Connect / Disconnect Toggle
  btnToggleConnection.addEventListener('click', () => {
    const wsUrl = wsUrlInput.value.trim();
    const secretToken = secretTokenInput.value.trim();
    const autoConnect = autoConnectCheckbox.checked;

    if (!wsUrl) {
      alert('Please enter a valid WebSocket endpoint URL (e.g., ws://<your-vps-ip>:8765)');
      wsUrlInput.focus();
      return;
    }

    // Save preferences
    chrome.storage.local.set({ wsUrl, secretToken, autoConnect });

    if (currentStatus === 'connected' || currentStatus === 'connecting') {
      // Disconnect
      btnToggleConnection.disabled = true;
      chrome.runtime.sendMessage({ type: 'DISCONNECT_WEBSOCKET' }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
        btnToggleConnection.disabled = false;
        updateUIStatus('disconnected', 'Disconnected by user');
      });
    } else {
      // Connect
      btnToggleConnection.disabled = true;
      updateUIStatus('connecting', 'Connecting...');
      chrome.runtime.sendMessage({ type: 'CONNECT_WEBSOCKET', wsUrl, secretToken }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
        btnToggleConnection.disabled = false;
      });
    }
  });

  // 6. Test Ping Button
  btnTestPing.addEventListener('click', () => {
    btnTestPing.disabled = true;
    const startTime = Date.now();
    chrome.runtime.sendMessage(
      {
        type: 'EXECUTE_COMMAND',
        command: { id: 'ping_' + Date.now(), action: 'status', params: {} }
      },
      (response) => {
        btnTestPing.disabled = false;
        const latency = Date.now() - startTime;
        if (response && response.success) {
          bridgeMessage.textContent = `Ping OK (${latency}ms)`;
        } else {
          bridgeMessage.textContent = `Ping failed (${latency}ms)`;
        }
      }
    );
  });

  // 7. Toggle Password Visibility
  toggleVisibilityBtn.addEventListener('click', () => {
    if (secretTokenInput.type === 'password') {
      secretTokenInput.type = 'text';
      toggleVisibilityBtn.textContent = '🔒';
    } else {
      secretTokenInput.type = 'password';
      toggleVisibilityBtn.textContent = '👁️';
    }
  });

  // 8. Privacy Shield & Permissions Manager
  const privacyModeSelect = document.getElementById('privacy-mode-select');
  const privacyModeDesc = document.getElementById('privacy-mode-desc');
  const btnRefreshTabs = document.getElementById('btn-refresh-tabs');
  const tabsListContainer = document.getElementById('tabs-list-container');

  const modeDescriptions = {
    hybrid: 'Agent-created tabs are auto-approved. User tabs require your permission.',
    full: 'Unrestricted access: AI Agent can interact with all open tabs.',
    sandbox: 'Strict Sandbox: AI Agent can only see and interact with tabs it opened.'
  };

  privacyModeSelect.addEventListener('change', () => {
    const selectedMode = privacyModeSelect.value;
    if (modeDescriptions[selectedMode]) {
      privacyModeDesc.textContent = modeDescriptions[selectedMode];
    }
    chrome.runtime.sendMessage({ type: 'SET_PRIVACY_MODE', privacyMode: selectedMode }, () => {
      loadPrivacyStateAndTabs();
    });
  });

  if (btnRefreshTabs) {
    btnRefreshTabs.addEventListener('click', () => {
      loadPrivacyStateAndTabs();
    });
  }

  function loadPrivacyStateAndTabs() {
    chrome.runtime.sendMessage({ type: 'GET_PRIVACY_STATE' }, async (privacyState) => {
      if (chrome.runtime.lastError || !privacyState) return;

      if (privacyState.privacyMode) {
        privacyModeSelect.value = privacyState.privacyMode;
        if (modeDescriptions[privacyState.privacyMode]) {
          privacyModeDesc.textContent = modeDescriptions[privacyState.privacyMode];
        }
      }

      const agentOwnedTabs = new Set(privacyState.agentOwnedTabs || []);
      const approvedUserTabs = new Set(privacyState.approvedUserTabs || []);
      const mode = privacyState.privacyMode || 'hybrid';

      try {
        const tabs = await chrome.tabs.query({});
        tabsListContainer.innerHTML = '';

        if (!tabs || tabs.length === 0) {
          tabsListContainer.innerHTML = '<div class="tab-list-empty">No open tabs found.</div>';
          return;
        }

        tabs.forEach((tab) => {
          const item = document.createElement('div');
          item.className = 'tab-item';

          const info = document.createElement('div');
          info.className = 'tab-info';

          const title = document.createElement('div');
          title.className = 'tab-title';
          title.textContent = tab.title || 'Untitled Tab';
          title.title = tab.title || '';

          const domain = document.createElement('div');
          domain.className = 'tab-domain';
          try {
            const urlObj = new URL(tab.url || '');
            domain.textContent = urlObj.hostname || tab.url || 'Internal';
          } catch {
            domain.textContent = tab.url || 'Internal';
          }

          info.appendChild(title);
          info.appendChild(domain);

          const actions = document.createElement('div');
          actions.className = 'tab-actions';

          const isAgent = agentOwnedTabs.has(tab.id);
          const isApproved = approvedUserTabs.has(tab.id);

          if (isAgent) {
            const badge = document.createElement('span');
            badge.className = 'tab-badge agent';
            badge.textContent = 'Agent Tab';
            actions.appendChild(badge);
          } else if (mode === 'full') {
            const badge = document.createElement('span');
            badge.className = 'tab-badge approved';
            badge.textContent = 'Full Access';
            actions.appendChild(badge);
          } else if (isApproved) {
            const badge = document.createElement('span');
            badge.className = 'tab-badge approved';
            badge.textContent = 'Allowed';
            actions.appendChild(badge);

            const btnRevoke = document.createElement('button');
            btnRevoke.className = 'btn-pill btn-revoke';
            btnRevoke.textContent = 'Revoke';
            btnRevoke.title = 'Revoke agent access to this tab';
            btnRevoke.onclick = () => {
              chrome.runtime.sendMessage({ type: 'REVOKE_TAB', tabId: tab.id }, () => {
                loadPrivacyStateAndTabs();
              });
            };
            actions.appendChild(btnRevoke);
          } else {
            const badge = document.createElement('span');
            badge.className = 'tab-badge protected';
            badge.textContent = 'Protected';
            actions.appendChild(badge);

            const btnAllow = document.createElement('button');
            btnAllow.className = 'btn-pill btn-allow';
            btnAllow.textContent = 'Allow';
            btnAllow.title = 'Allow agent to access this tab';
            btnAllow.onclick = () => {
              chrome.runtime.sendMessage({ type: 'APPROVE_TAB', tabId: tab.id }, () => {
                loadPrivacyStateAndTabs();
              });
            };
            actions.appendChild(btnAllow);
          }

          item.appendChild(info);
          item.appendChild(actions);
          tabsListContainer.appendChild(item);
        });
      } catch (err) {
        tabsListContainer.innerHTML = '<div class="tab-list-empty">Unable to query tabs.</div>';
      }
    });
  }

  // Initial load of privacy state and tab list
  loadPrivacyStateAndTabs();

  // UI state manager
  function updateUIStatus(status, message) {
    currentStatus = status;
    statusBadge.className = `badge ${status}`;

    if (status === 'connected') {
      statusText.textContent = 'Connected';
      btnToggleConnection.textContent = 'Disconnect';
      btnToggleConnection.className = 'btn btn-danger';
      btnTestPing.disabled = false;
    } else if (status === 'connecting') {
      statusText.textContent = 'Connecting...';
      btnToggleConnection.textContent = 'Connecting...';
      btnToggleConnection.className = 'btn btn-primary';
      btnTestPing.disabled = true;
    } else {
      statusText.textContent = 'Disconnected';
      btnToggleConnection.textContent = 'Connect';
      btnToggleConnection.className = 'btn btn-primary';
      btnTestPing.disabled = true;
    }

    if (message) {
      bridgeMessage.textContent = message;
    }
  }
});
