/**
 * BrowserPilot Content Script - DOM Engine
 */
(() => {
  // Prevent duplicate script injection
  if (window.__browserpilot_injected) return;
  window.__browserpilot_injected = true;

  console.log('[BrowserPilot Content] DOM Engine initialized on:', window.location.href);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
      case 'evaluate':
        return evaluateScript(params);
      default:
        throw new Error(`Unknown DOM action: ${action}`);
    }
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
  async function clickElement({ selector, text, x, y, index }) {
    let el = null;

    if (typeof x === 'number' && typeof y === 'number') {
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

    // Dispatch realistic sequence of pointer & mouse events
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

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
  async function typeIntoElement({ selector, text, clear = false, pressEnter = false }) {
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

    if (el.isContentEditable) {
      if (clear) {
        el.innerText = '';
      }
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      if (clear) {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Set value and trigger native events
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

  // --- 6. Evaluate Script ---
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
