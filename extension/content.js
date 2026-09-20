/**
 * BrowserPilot Content Script - DOM Engine
 */
(() => {
  // Prevent duplicate script injection
  if (window.__browserpilot_injected) return;
  window.__browserpilot_injected = true;

  console.log('[BrowserPilot Content] DOM Engine initialized on:', window.location.href);

  // Native Dialog Interception to prevent tab freeze
  let pendingDialog = null;
  let dialogActionPolicy = null; // null | 'accept' | 'dismiss'
  let dialogDefaultPrompt = '';

  const originalAlert = window.alert;
  const originalConfirm = window.confirm;
  const originalPrompt = window.prompt;

  window.alert = function (message) {
    console.log('[BrowserPilot] Intercepted alert:', message);
    pendingDialog = { type: 'alert', message: String(message), timestamp: Date.now() };
    if (dialogActionPolicy === 'dismiss' || dialogActionPolicy === 'accept') {
      const res = pendingDialog;
      pendingDialog = null;
      return;
    }
    // Auto-resolve to prevent tab freeze if no agent policy set
    pendingDialog.autoHandled = true;
  };

  window.confirm = function (message) {
    console.log('[BrowserPilot] Intercepted confirm:', message);
    pendingDialog = { type: 'confirm', message: String(message), timestamp: Date.now() };
    if (dialogActionPolicy === 'dismiss') {
      pendingDialog = null;
      return false;
    }
    if (dialogActionPolicy === 'accept') {
      pendingDialog = null;
      return true;
    }
    // Default to true so user workflows continue
    pendingDialog.autoHandled = true;
    return true;
  };

  window.prompt = function (message, defaultVal = '') {
    console.log('[BrowserPilot] Intercepted prompt:', message);
    pendingDialog = { type: 'prompt', message: String(message), defaultValue: defaultVal, timestamp: Date.now() };
    if (dialogActionPolicy === 'dismiss') {
      pendingDialog = null;
      return null;
    }
    if (dialogActionPolicy === 'accept') {
      const val = dialogDefaultPrompt || defaultVal;
      pendingDialog = null;
      return val;
    }
    return defaultVal;
  };

  // Prevent beforeunload prompts from blocking automation
  window.addEventListener('beforeunload', (e) => {
    if (dialogActionPolicy === 'accept' || dialogActionPolicy === 'dismiss') {
      delete e['returnValue'];
    }
  }, { capture: true });

  // --- Tab Permission Banner Engine ---
  let activePermissionBanner = null;

  function clearPermissionBanner() {
    if (activePermissionBanner) {
      activePermissionBanner.style.opacity = '0';
      activePermissionBanner.style.transform = 'translate(-50%, -20px)';
      setTimeout(() => {
        if (activePermissionBanner && activePermissionBanner.parentNode) {
          activePermissionBanner.parentNode.removeChild(activePermissionBanner);
        }
        activePermissionBanner = null;
      }, 250);
    }
  }

  function showPermissionBanner({ reason = 'AI Agent is requesting permission to access this tab.', timeoutMs = 25000 } = {}) {
    clearPermissionBanner();

    const banner = document.createElement('div');
    banner.id = 'browserpilot-permission-banner';
    banner.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translate(-50%, -20px);
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #f8fafc;
      border: 1px solid #3b82f6;
      border-radius: 12px;
      padding: 12px 18px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 15px rgba(59, 130, 246, 0.3);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      opacity: 0;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      max-width: 580px;
      pointer-events: auto;
    `;

    const icon = document.createElement('div');
    icon.style.cssText = `
      font-size: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(59, 130, 246, 0.15);
      border-radius: 8px;
      width: 38px;
      height: 38px;
      flex-shrink: 0;
    `;
    icon.textContent = '🤖';

    const textContainer = document.createElement('div');
    textContainer.style.cssText = 'display: flex; flex-direction: column; gap: 2px;';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight: 600; font-size: 13px; color: #ffffff; display: flex; align-items: center; gap: 6px;';
    title.innerHTML = '<span>BrowserPilot Permission Request</span> <span style="background: #3b82f6; color: white; font-size: 10px; padding: 1px 6px; border-radius: 9999px;">Privacy Shield</span>';

    const desc = document.createElement('div');
    desc.style.cssText = 'color: #94a3b8; font-size: 12px; line-height: 1.3;';
    desc.textContent = reason;

    textContainer.appendChild(title);
    textContainer.appendChild(desc);

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-left: 8px; flex-shrink: 0;';

    const btnAllow = document.createElement('button');
    btnAllow.textContent = 'Allow Access';
    btnAllow.style.cssText = `
      background: #10b981;
      color: #ffffff;
      border: none;
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    `;
    btnAllow.onmouseover = () => (btnAllow.style.background = '#059669');
    btnAllow.onmouseout = () => (btnAllow.style.background = '#10b981');

    const btnDeny = document.createElement('button');
    btnDeny.textContent = 'Deny';
    btnDeny.style.cssText = `
      background: #334155;
      color: #cbd5e1;
      border: none;
      padding: 7px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    `;
    btnDeny.onmouseover = () => (btnDeny.style.background = '#475569');
    btnDeny.onmouseout = () => (btnDeny.style.background = '#334155');

    btnAllow.onclick = () => {
      chrome.runtime.sendMessage({ type: 'TAB_PERMISSION_RESPONSE', approved: true }).catch(() => {});
      title.innerHTML = '<span style="color: #10b981;">✓ Permission Granted</span>';
      desc.textContent = 'AI Agent can now interact with this tab.';
      btnAllow.remove();
      btnDeny.remove();
      setTimeout(clearPermissionBanner, 1500);
    };

    btnDeny.onclick = () => {
      chrome.runtime.sendMessage({ type: 'TAB_PERMISSION_RESPONSE', approved: false }).catch(() => {});
      clearPermissionBanner();
    };

    btnContainer.appendChild(btnAllow);
    btnContainer.appendChild(btnDeny);

    banner.appendChild(icon);
    banner.appendChild(textContainer);
    banner.appendChild(btnContainer);

    document.body.appendChild(banner);
    activePermissionBanner = banner;

    requestAnimationFrame(() => {
      banner.style.opacity = '1';
      banner.style.transform = 'translate(-50%, 0)';
    });

    if (timeoutMs > 0) {
      setTimeout(() => {
        if (activePermissionBanner === banner) {
          clearPermissionBanner();
        }
      }, timeoutMs);
    }
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SHOW_PERMISSION_BANNER') {
      showPermissionBanner(request);
      sendResponse({ ok: true });
      return false;
    }

    if (request.type === 'CLEAR_PERMISSION_BANNER') {
      clearPermissionBanner();
      sendResponse({ ok: true });
      return false;
    }

    if (request.type !== 'DOM_ACTION') return;

    handleAction(request.action, request.params)
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message || String(error) }));

    return true; // Keep message channel open for async response
  });

  async function handleAction(action, params = {}) {
    switch (action) {
      case 'read_page':
        return extractPageContent(params);
      case 'click':
        return clickElement(params);
      case 'type':
        return typeIntoElement(params);
      case 'press_key':
        return pressKey(params);
      case 'scroll':
        return scrollPage(params);
      case 'upload_file':
        return uploadFileToInput(params);
      case 'label_elements':
        return labelInteractiveElements(params);
      case 'evaluate':
        return evaluateScript(params);
      case 'handle_dialog':
        return handleDialogAction(params);
      default:
        throw new Error(`Unknown DOM action: ${action}`);
    }
  }

  function handleDialogAction({ action = 'accept', promptText = '', setPolicy = false }) {
    if (setPolicy) {
      dialogActionPolicy = action; // 'accept' or 'dismiss'
      dialogDefaultPrompt = promptText;
      return { ok: true, policySet: action, promptText };
    }

    const current = pendingDialog;
    pendingDialog = null;

    return {
      ok: true,
      handledDialog: current || null,
      message: current ? `Handled ${current.type} dialog with action "${action}"` : 'No pending dialog was open'
    };
  }

  // --- 1. Read Page Content ---
  function extractPageContent({ format = 'markdown', maxLength = 15000 }) {
    const title = document.title || '';
    const url = window.location.href;

    if (format === 'html') {
      const html = document.documentElement.outerHTML;
      return {
        title,
        url,
        content: html.length > maxLength ? html.slice(0, maxLength) + '\n... [TRUNCATED]' : html
      };
    }

    if (format === 'text') {
      const text = document.body ? document.body.innerText : '';
      return {
        title,
        url,
        content: text.length > maxLength ? text.slice(0, maxLength) + '\n... [TRUNCATED]' : text
      };
    }

    if (format === 'interactive_elements') {
      const elements = [];
      const nodes = document.querySelectorAll(
        'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [tabindex]:not([tabindex="-1"])'
      );

      nodes.forEach((el, index) => {
        if (!isVisible(el)) return;
        const rect = el.getBoundingClientRect();
        const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '').trim();
        const selector = generateUniqueSelector(el);

        elements.push({
          index,
          tag: el.tagName.toLowerCase(),
          text: text.slice(0, 100),
          selector,
          type: el.getAttribute('type') || undefined,
          name: el.getAttribute('name') || undefined,
          id: el.id || undefined,
          disabled: el.disabled || false,
          bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        });
      });

      return {
        title,
        url,
        content: JSON.stringify(elements.slice(0, 200), null, 2)
      };
    }

    // Default: Clean Markdown Representation
    const markdown = convertDomToMarkdown(document.body, maxLength);
    return {
      title,
      url,
      content: markdown
    };
  }

  function convertDomToMarkdown(rootNode, maxLength) {
    if (!rootNode) return '';
    const lines = [];

    function traverse(node) {
      if (!node) return;
      if (lines.join('\n').length >= maxLength) return;

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim().replace(/\s+/g, ' ');
        if (text) lines.push(text);
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();
      // Skip non-content or invisible tags
      if (['script', 'style', 'noscript', 'svg', 'iframe', 'template'].includes(tag)) return;
      if (!isVisible(node)) return;

      if (/^h[1-6]$/.test(tag)) {
        const level = '#'.repeat(parseInt(tag[1]));
        const headingText = (node.innerText || '').trim();
        if (headingText) lines.push(`\n${level} ${headingText}\n`);
        return;
      }

      if (tag === 'p') {
        const pText = (node.innerText || '').trim();
        if (pText) lines.push(`\n${pText}\n`);
        return;
      }

      if (tag === 'a' && node.href) {
        const linkText = (node.innerText || '').trim() || node.title || node.href;
        lines.push(`[${linkText}](${node.href})`);
        return;
      }

      if (tag === 'button' || node.getAttribute('role') === 'button') {
        const btnText = (node.innerText || node.getAttribute('aria-label') || '').trim();
        if (btnText) lines.push(`[Button: "${btnText}"]`);
        return;
      }

      if (tag === 'input' || tag === 'textarea') {
        const placeholder = node.placeholder ? ` placeholder="${node.placeholder}"` : '';
        const name = node.name ? ` name="${node.name}"` : '';
        const val = node.value ? ` value="${node.value}"` : '';
        lines.push(`[Input: type="${node.type || 'text'}"${name}${placeholder}${val}]`);
        return;
      }

      if (tag === 'li') {
        const itemText = (node.innerText || '').trim();
        if (itemText) lines.push(`* ${itemText}`);
        return;
      }

      // Recurse into children
      for (const child of node.childNodes) {
        traverse(child);
      }
    }

    traverse(rootNode);
    let output = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (output.length > maxLength) {
      output = output.slice(0, maxLength) + '\n... [TRUNCATED]';
    }
    return output;
  }

  // --- 2. Click Element ---
  async function clickElement({ selector, text, x, y, index, label, humanize = false }) {
    let el = null;

    if (typeof label === 'number') {
      el = document.querySelector(`[data-browserpilot-label="${label}"]`);
    }

    if (!el && typeof x === 'number' && typeof y === 'number') {
      el = document.elementFromPoint(x, y);
    }

    if (!el && selector) {
      try {
        const matches = document.querySelectorAll(selector);
        if (matches.length > 0) {
          if (typeof index === 'number') {
            el = index < 0 ? matches[matches.length + index] : matches[index];
          } else {
            el = matches[0];
          }
        }
      } catch (e) {
        // Invalid selector syntax, fall through to text match
      }
    }

    if (!el && text) {
      el = findElementByText(text);
    }

    if (!el) {
      throw new Error(`Element not found for selector "${selector || ''}" or text "${text || ''}"`);
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightElement(el, '#10b981'); // Emerald green highlight

    // Wait a brief moment for scroll to settle
    await new Promise((r) => setTimeout(r, 150));

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    if (humanize) {
      await simulateHumanMouseTrajectory(clientX, clientY);
      // Human dwell time before click down
      await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 80)));
    }

    // Dispatch realistic sequence of pointer & mouse events
    const eventOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY
    };

    el.dispatchEvent(new MouseEvent('mouseenter', eventOpts));
    el.dispatchEvent(new MouseEvent('mouseover', eventOpts));
    el.dispatchEvent(new PointerEvent('pointerdown', eventOpts));
    el.dispatchEvent(new MouseEvent('mousedown', eventOpts));
    el.focus();
    if (humanize) {
      await new Promise((r) => setTimeout(r, 30 + Math.floor(Math.random() * 50)));
    }
    el.dispatchEvent(new PointerEvent('pointerup', eventOpts));
    el.dispatchEvent(new MouseEvent('mouseup', eventOpts));
    el.dispatchEvent(new MouseEvent('click', eventOpts));

    if (typeof el.click === 'function') {
      try {
        el.click();
      } catch (e) {}
    }

    // Wait 300ms for UI / menus / animations to open
    await new Promise((r) => setTimeout(r, 300));

    return {
      description: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ')[0] : ''} ("${(el.innerText || el.value || '').slice(0, 40)}")`
    };
  }

  // --- 3. Type Into Element ---
  async function typeIntoElement({ selector, text, clear = false, pressEnter = false, humanize = false }) {
    let el = selector ? document.querySelector(selector) : null;
    if (!el && document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      el = document.activeElement;
    }
    if (!el) {
      el = document.querySelector('div[contenteditable="true"], [role="textbox"], textarea, input[type="text"]');
    }
    if (!el) {
      throw new Error(`Input element not found for selector: "${selector || ''}"`);
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightElement(el, '#3b82f6'); // Blue highlight
    el.focus();

    if (clear) {
      if (el.isContentEditable) {
        el.innerText = '';
      } else {
        el.value = '';
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (humanize) {
      // Natural human variable keystroke simulation
      for (const char of text) {
        if (el.isContentEditable) {
          document.execCommand('insertText', false, char);
        } else {
          el.value = (el.value || '') + char;
        }
        dispatchKeyEvent(el, char);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        // Randomized delay between 40ms and 140ms
        await new Promise((r) => setTimeout(r, 40 + Math.floor(Math.random() * 100)));
      }
      if (!el.isContentEditable) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      if (el.isContentEditable) {
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        )?.set;

        if (el instanceof HTMLTextAreaElement && nativeTextareaValueSetter) {
          nativeTextareaValueSetter.call(el, (el.value || '') + text);
        } else if (el instanceof HTMLInputElement && nativeInputValueSetter) {
          nativeInputValueSetter.call(el, (el.value || '') + text);
        } else {
          el.value = (el.value || '') + text;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    if (pressEnter) {
      dispatchKeyEvent(el, 'Enter');
      if (el.form) {
        el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }

    return { value: el.isContentEditable ? el.innerText : el.value };
  }

  // --- 4. Press Key ---
  async function pressKey({ key }) {
    const target = document.activeElement || document.body;
    dispatchKeyEvent(target, key);
    return { ok: true, activeElement: target.tagName.toLowerCase() };
  }

  // --- 5. Scroll Page ---
  async function scrollPage({ direction = 'down', amount = 600, selector }) {
    if (selector) {
      const el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightElement(el, '#8b5cf6');
        return { scrollY: window.scrollY, selector };
      }
    }

    if (direction === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (direction === 'bottom') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } else if (direction === 'up') {
      window.scrollBy({ top: -amount, behavior: 'smooth' });
    } else {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }

    await new Promise((r) => setTimeout(r, 200));
    return { scrollY: window.scrollY };
  }

  // --- 6. Upload File To Input ---
  async function uploadFileToInput({ selector, filename = 'upload.dat', mimeType = 'application/octet-stream', base64Data }) {
    let el = selector ? document.querySelector(selector) : null;
    if (!el) {
      el = document.querySelector('input[type="file"]');
    }
    if (!el) {
      throw new Error(`File input element not found for selector: "${selector || 'input[type="file"]'}"`);
    }

    // Convert base64 to Blob/File
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const file = new File([bytes], filename, { type: mimeType });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    el.files = dataTransfer.files;

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      ok: true,
      filename,
      size: bytes.length,
      selector: generateUniqueSelector(el)
    };
  }

  // --- 7. Label Interactive Elements (OmniParser mode) ---
  async function labelInteractiveElements({ remove = false } = {}) {
    // Remove existing badges
    document.querySelectorAll('.browserpilot-label-badge').forEach((b) => b.remove());
    document.querySelectorAll('[data-browserpilot-label]').forEach((el) => {
      el.removeAttribute('data-browserpilot-label');
    });

    if (remove) {
      return { ok: true, message: 'Labels cleared', count: 0 };
    }

    const nodes = document.querySelectorAll(
      'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [tabindex]:not([tabindex="-1"])'
    );

    let count = 0;
    const labeledList = [];

    nodes.forEach((el) => {
      if (!isVisible(el)) return;
      count++;
      el.setAttribute('data-browserpilot-label', String(count));

      const rect = el.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.className = 'browserpilot-label-badge';
      badge.innerText = String(count);
      badge.style.position = 'fixed';
      badge.style.left = `${Math.max(0, rect.left)}px`;
      badge.style.top = `${Math.max(0, rect.top - 12)}px`;
      badge.style.backgroundColor = '#ec4899'; // Vibrant pink/magenta
      badge.style.color = '#ffffff';
      badge.style.fontSize = '11px';
      badge.style.fontWeight = 'bold';
      badge.style.padding = '1px 5px';
      badge.style.borderRadius = '4px';
      badge.style.zIndex = '2147483647';
      badge.style.pointerEvents = 'none';
      badge.style.boxShadow = '0 2px 5px rgba(0,0,0,0.4)';
      badge.style.fontFamily = 'monospace';
      document.body.appendChild(badge);

      const text = (el.innerText || el.getAttribute('aria-label') || el.value || '').trim().slice(0, 40);
      labeledList.push({
        label: count,
        tag: el.tagName.toLowerCase(),
        text,
        selector: generateUniqueSelector(el)
      });
    });

    return {
      count,
      labels: labeledList.slice(0, 150)
    };
  }

  // --- 8. Evaluate Script ---
  async function evaluateScript({ script }) {
    const fn = new Function(`return (${script});`);
    const res = fn();
    return res instanceof Promise ? await res : res;
  }

  // --- Utilities ---
  function findElementByText(text) {
    const clean = text.trim().toLowerCase();
    const candidates = Array.from(document.querySelectorAll(
      'button, a, input[type=submit], input[type=button], [role="button"], span, div, p, h1, h2, h3, h4, h5, h6'
    ));

    // First pass: exact match, preferring elements with fewer child nodes (leaf elements)
    const exactMatches = [];
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const content = (el.innerText || el.getAttribute('aria-label') || el.value || '').trim().toLowerCase();
      if (content === clean) {
        exactMatches.push(el);
      }
    }
    if (exactMatches.length > 0) {
      // Sort so elements with fewest children come first
      exactMatches.sort((a, b) => a.childElementCount - b.childElementCount);
      return exactMatches[0];
    }

    // Second pass: substring match
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const content = (el.innerText || el.getAttribute('aria-label') || el.value || '').trim().toLowerCase();
      if (content.includes(clean) && content.length < clean.length + 30) {
        return el;
      }
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function highlightElement(el, color = '#10b981') {
    const originalOutline = el.style.outline;
    const originalTransition = el.style.transition;
    const originalBoxShadow = el.style.boxShadow;

    el.style.transition = 'all 0.2s ease-in-out';
    el.style.outline = `3px solid ${color}`;
    el.style.boxShadow = `0 0 12px ${color}`;

    setTimeout(() => {
      el.style.outline = originalOutline;
      el.style.boxShadow = originalBoxShadow;
      el.style.transition = originalTransition;
    }, 1500);
  }

  function dispatchKeyEvent(element, key) {
    const keyCodeMap = {
      Enter: 13,
      Escape: 27,
      Tab: 9,
      Backspace: 8,
      ArrowDown: 40,
      ArrowUp: 38,
      ArrowLeft: 37,
      ArrowRight: 39,
      Space: 32
    };
    const keyCode = keyCodeMap[key] || 0;

    const opts = {
      key,
      code: key,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      view: window
    };

    element.dispatchEvent(new KeyboardEvent('keydown', opts));
    element.dispatchEvent(new KeyboardEvent('keypress', opts));
    element.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  // --- Humanization Engine (Anti-Detection) ---
  let lastMousePos = { x: 100, y: 100 };

  async function simulateHumanMouseTrajectory(targetX, targetY) {
    const startX = lastMousePos.x;
    const startY = lastMousePos.y;
    const distance = Math.hypot(targetX - startX, targetY - startY);
    const steps = Math.min(Math.max(Math.floor(distance / 25), 8), 25);

    // Quadratic Bezier curve with control point deviation
    const deviation = (Math.random() - 0.5) * Math.min(distance * 0.4, 150);
    const midX = (startX + targetX) / 2 + deviation;
    const midY = (startY + targetY) / 2 + deviation;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // Bezier formula B(t) = (1-t)^2*P0 + 2(1-t)t*P1 + t^2*P2
      const cx = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * midX + t * t * targetX;
      const cy = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * midY + t * t * targetY;

      // Micro-jitter
      const jitterX = (Math.random() - 0.5) * 2;
      const jitterY = (Math.random() - 0.5) * 2;

      const clientX = Math.round(cx + jitterX);
      const clientY = Math.round(cy + jitterY);

      window.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY
        })
      );

      // Sleep between 8ms and 20ms
      await new Promise((r) => setTimeout(r, 8 + Math.floor(Math.random() * 12)));
    }

    lastMousePos = { x: targetX, y: targetY };
  }

  function generateUniqueSelector(el) {
    if (el.id) return `#${el.id}`;
    if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.split(/\s+/).filter((c) => c && !c.includes(':') && !c.includes('/'));
      if (classes.length > 0) return `${el.tagName.toLowerCase()}.${classes.slice(0, 2).join('.')}`;
    }
    return el.tagName.toLowerCase();
  }
})();
