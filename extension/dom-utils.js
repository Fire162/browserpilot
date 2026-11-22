/**
 * BrowserPilot DOM utilities.
 *
 * Loaded as a plain script before `content.js` (both are injected into the same
 * isolated world), and also exported for unit tests under Node. Keep this file
 * dependency-free and side-effect-free: it only defines functions.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BrowserPilotDom = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Collects every shadow root beneath `node` (including nested ones).
   * `querySelectorAll` cannot pierce shadow boundaries, so these have to be
   * queried separately.
   */
  function collectShadowRoots(node, out) {
    if (!node) return;
    if (node.shadowRoot) {
      out.push(node.shadowRoot);
      collectShadowRoots(node.shadowRoot, out);
    }
    const children = node.children;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        collectShadowRoots(children[i], out);
      }
    }
  }

  /**
   * `querySelectorAll` across the light DOM *and* open shadow roots.
   *
   * The previous implementation called `querySelectorAll` while recursing into
   * every descendant, so each match was returned once per ancestor level
   * (a button nested five divs deep came back five times). That inflated the
   * element catalog, made index-based clicks ambiguous, and turned every read
   * into an O(n^2) walk. Now: one query per tree scope, deduped, in document
   * order (light DOM first, then shadow scopes).
   */
  function deepQuerySelectorAll(selector, root) {
    const searchRoot = root || (typeof document !== 'undefined' ? document : null);
    if (!searchRoot || !selector) return [];

    const results = [];
    const seen = new Set();

    const add = (nodes) => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!seen.has(node)) {
          seen.add(node);
          results.push(node);
        }
      }
    };

    try {
      add(searchRoot.querySelectorAll(selector));
    } catch (err) {
      return []; // invalid selector — caller decides how to surface it
    }

    const shadowRoots = [];
    collectShadowRoots(searchRoot, shadowRoots);
    for (const shadowRoot of shadowRoots) {
      try {
        add(shadowRoot.querySelectorAll(selector));
      } catch (err) {
        // ignore individual scope failures
      }
    }

    return results;
  }

  function deepQuerySelector(selector, root) {
    const all = deepQuerySelectorAll(selector, root);
    return all.length > 0 ? all[0] : null;
  }

  function isVisible(el) {
    if (!el) return false;
    const view = el.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    if (!view || typeof view.getComputedStyle !== 'function') return true;
    if (typeof el.getBoundingClientRect !== 'function') return true;

    const style = view.getComputedStyle(el);
    if (!style) return true;
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;

    const rect = el.getBoundingClientRect();
    const tag = el.tagName;
    return (rect.width > 0 && rect.height > 0) || tag === 'TEXTAREA' || tag === 'INPUT';
  }

  /**
   * Best-effort CSS selector for an element. Not guaranteed unique on complex
   * pages, which is why callers still verify the match count.
   */
  function generateUniqueSelector(el) {
    if (!el || !el.tagName) return '';
    if (el.id) return `#${el.id}`;
    const name = el.getAttribute && el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.split(/\s+/).filter((c) => c && !c.includes(':') && !c.includes('/'));
      if (classes.length > 0) return `${el.tagName.toLowerCase()}.${classes.slice(0, 2).join('.')}`;
    }
    return el.tagName.toLowerCase();
  }

  /**
   * Finds the element whose accessible text best matches `text`.
   * Prefers exact matches on the most deeply nested (least children) element,
   * then bounded substring matches.
   */
  function findElementByText(text, options) {
    const opts = options || {};
    const clean = String(text || '').trim().toLowerCase();
    if (!clean) return null;

    const candidates = deepQuerySelectorAll(
      opts.selector ||
        'button, a, input[type=submit], input[type=button], [role="button"], span, div, p, h1, h2, h3, h4, h5, h6, label'
    );

    const labelOf = (el) =>
      (el.innerText || (el.getAttribute && el.getAttribute('aria-label')) || el.value || '').trim().toLowerCase();

    const exactMatches = [];
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      if (labelOf(el) === clean) exactMatches.push(el);
    }

    if (exactMatches.length > 0) {
      exactMatches.sort((a, b) => (a.childElementCount || 0) - (b.childElementCount || 0));
      return exactMatches[0];
    }

    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const content = labelOf(el);
      if (content.includes(clean) && content.length < clean.length + 30) {
        return el;
      }
    }
    return null;
  }

  return {
    deepQuerySelectorAll,
    deepQuerySelector,
    findElementByText,
    generateUniqueSelector,
    isVisible
  };
});
