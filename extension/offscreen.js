let socket = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let isExplicitlyDisconnected = false;

console.log('[BrowserPilot Offscreen] Offscreen document initialized.');

// Load initial config and auto-connect if enabled
chrome.storage.local.get(['wsUrl', 'secretToken', 'autoConnect'], (data) => {
  if (data.autoConnect !== false && data.wsUrl) {
    connect(data.wsUrl, data.secretToken || '');
  }
});

function connect(rawUrl, token) {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    console.log('[BrowserPilot Offscreen] Socket already open or connecting.');
    return;
  }

  isExplicitlyDisconnected = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  let fullUrl = rawUrl.trim();
  if (fullUrl.startsWith('http://')) {
    fullUrl = 'ws://' + fullUrl.slice(7);
  } else if (fullUrl.startsWith('https://')) {
    fullUrl = 'wss://' + fullUrl.slice(8);
  } else if (!fullUrl.startsWith('ws://') && !fullUrl.startsWith('wss://')) {
    fullUrl = 'ws://' + fullUrl;
  }

  try {
    const urlObj = new URL(fullUrl);
    if (token) {
      urlObj.searchParams.set('token', token);
    }
    fullUrl = urlObj.toString();
  } catch (e) {
    console.error('[BrowserPilot Offscreen] Invalid WebSocket URL:', e);
    notifyStatus('error', 'Invalid WebSocket URL: ' + e.message);
    return;
  }

  notifyStatus('connecting', 'Connecting to ' + fullUrl);
  console.log('[BrowserPilot Offscreen] Connecting to:', fullUrl);

  try {
    socket = new WebSocket(fullUrl);

    socket.onopen = () => {
      console.log('[BrowserPilot Offscreen] WebSocket connected!');
      notifyStatus('connected', 'Connected to VPS');

      // Start 15s heartbeat
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        }
      }, 15000);
    };

    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong' || msg.type === 'auth_success') {
          return;
        }

        if (msg.action) {
          console.log('[BrowserPilot Offscreen] Received action from VPS:', msg.action, msg.params);
          // Delegate command execution to background service worker
          chrome.runtime.sendMessage(
            { type: 'EXECUTE_COMMAND', command: msg },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error('[BrowserPilot Offscreen] Error dispatching to background:', chrome.runtime.lastError);
                sendResponse(msg.id, false, null, chrome.runtime.lastError.message);
                return;
              }

              if (!response) {
                sendResponse(msg.id, false, null, 'No response received from background script');
                return;
              }

              sendResponse(msg.id, response.success, response.result, response.error);
            }
          );
        }
      } catch (err) {
        console.error('[BrowserPilot Offscreen] Error processing message:', err);
      }
    };

    socket.onclose = (event) => {
      console.log(`[BrowserPilot Offscreen] WebSocket closed (code: ${event.code})`);
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      notifyStatus('disconnected', `Disconnected (code: ${event.code})`);

      if (!isExplicitlyDisconnected) {
        scheduleReconnect();
      }
    };

    socket.onerror = (err) => {
      console.error('[BrowserPilot Offscreen] WebSocket error:', err);
      notifyStatus('error', 'WebSocket connection failed');
    };
  } catch (err) {
    console.error('[BrowserPilot Offscreen] Socket creation exception:', err);
    notifyStatus('error', err.message);
    scheduleReconnect();
  }
}

function disconnect() {
  isExplicitlyDisconnected = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (socket) {
    socket.close(1000, 'User initiated disconnect');
    socket = null;
  }
  notifyStatus('disconnected', 'Disconnected');
}

function scheduleReconnect() {
  if (reconnectTimer || isExplicitlyDisconnected) return;
  console.log('[BrowserPilot Offscreen] Scheduling reconnect in 5 seconds...');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    chrome.storage.local.get(['wsUrl', 'secretToken', 'autoConnect'], (data) => {
      if (data.autoConnect !== false && data.wsUrl && !isExplicitlyDisconnected) {
        connect(data.wsUrl, data.secretToken || '');
      }
    });
  }, 5000);
}

function sendResponse(id, success, result, error) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error('[BrowserPilot Offscreen] Cannot send response: socket is closed.');
    return;
  }

  const payload = {
    id,
    success,
    result: result ?? null,
    error: error ?? null
  };

  socket.send(JSON.stringify(payload));
}

function notifyStatus(status, message) {
  chrome.runtime.sendMessage({
    type: 'CONNECTION_STATUS_UPDATE',
    status,
    message,
    timestamp: Date.now()
  }).catch(() => {});
}

// Listen for commands from Popup or Background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CONNECT_WEBSOCKET') {
    connect(request.wsUrl, request.secretToken);
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'DISCONNECT_WEBSOCKET') {
    disconnect();
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'GET_SOCKET_STATUS') {
    const isConnected = socket && socket.readyState === WebSocket.OPEN;
    const isConnecting = socket && socket.readyState === WebSocket.CONNECTING;
    sendResponse({
      status: isConnected ? 'connected' : (isConnecting ? 'connecting' : 'disconnected'),
      readyState: socket ? socket.readyState : -1
    });
    return true;
  }
});
