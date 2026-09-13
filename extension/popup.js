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
        btnToggleConnection.disabled = false;
        updateUIStatus('disconnected', 'Disconnected by user');
      });
    } else {
      // Connect
      btnToggleConnection.disabled = true;
      updateUIStatus('connecting', 'Connecting...');
      chrome.runtime.sendMessage({ type: 'CONNECT_WEBSOCKET', wsUrl, secretToken }, () => {
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
