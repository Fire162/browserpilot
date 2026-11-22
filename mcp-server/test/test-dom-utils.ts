/**
 * Unit tests for extension/dom-utils.js.
 *
 * The module is a dependency-free UMD file, so it can be exercised under Node
 * against a minimal fake DOM. This locks in the traversal bug that used to
 * return every match once per ancestor level (which inflated element catalogs
 * and made index-based clicks ambiguous).
 *
 * Run with:  npx tsx test/test-dom-utils.ts
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dom = require(path.join(here, '..', '..', 'extension', 'dom-utils.js')) as {
  deepQuerySelectorAll: (selector: string, root?: any) => any[];
  deepQuerySelector: (selector: string, root?: any) => any | null;
  findElementByText: (text: string) => any | null;
  generateUniqueSelector: (el: any) => string;
  isVisible: (el: any) => boolean;
};

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    console.error(`  ❌ ${name}\n     ${err?.message || err}`);
    throw err;
  }
}

/** Minimal element: matching, children, optional shadow root. */
class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  shadowRoot: FakeElement | null = null;
  id = '';
  className = '';
  innerText = '';
  childElementCount = 0;
  private attrs: Record<string, string> = {};

  constructor(tagName: string, options: { id?: string; text?: string; className?: string } = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = options.id || '';
    this.text = options.text || '';
    this.className = options.className || '';
  }

  set text(value: string) {
    this.innerText = value;
  }
  get text() {
    return this.innerText;
  }

  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      this.children.push(node);
    }
    this.childElementCount = this.children.length;
    return this;
  }

  matches(selector: string): boolean {
    return selector
      .split(',')
      .map((part) => part.trim())
      .some((part) => part === this.tagName.toLowerCase());
  }

  /** Mirrors querySelectorAll semantics: matches this subtree, never crosses shadow roots. */
  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

function makeTree() {
  const deepButton = new FakeElement('button', { id: 'deep', text: 'Save' });
  const inner = new FakeElement('div').append(deepButton);
  const middle = new FakeElement('div').append(inner);
  const sibling = new FakeElement('button', { id: 'sibling', text: 'Cancel' });
  const body = new FakeElement('body').append(middle, sibling);

  // A shadow host two levels down, with a button inside its shadow root.
  const shadowButton = new FakeElement('button', { id: 'shadow', text: 'Shadow Save' });
  const shadowRoot = new FakeElement('div').append(shadowButton);
  const host = new FakeElement('div');
  host.shadowRoot = shadowRoot;

  const nestedHost = new FakeElement('div');
  const nestedShadowRoot = new FakeElement('div').append(new FakeElement('button', { id: 'nested-shadow' }));
  nestedHost.shadowRoot = nestedShadowRoot;
  shadowRoot.append(nestedHost);

  body.append(host);
  return { body, deepButton, sibling, shadowButton };
}

function run() {
  console.log('🧪 DOM utility tests\n');

  const { body, deepButton, sibling, shadowButton } = makeTree();

  check('returns each match exactly once (no per-ancestor duplicates)', () => {
    const buttons = dom.deepQuerySelectorAll('button', body);
    assert.equal(buttons.length, 4, `expected 4 buttons, got ${buttons.length}`);
    assert.equal(new Set(buttons).size, buttons.length, 'results must be unique');
  });

  check('keeps document order for light DOM matches', () => {
    const ids = dom.deepQuerySelectorAll('button', body)
      .map((el) => el.id)
      .filter((id) => id !== 'nested-shadow');
    assert.deepEqual(ids, ['deep', 'sibling', 'shadow']);
  });

  check('pierces open shadow roots, including nested ones', () => {
    const ids = dom.deepQuerySelectorAll('button', body).map((el) => el.id);
    assert.ok(ids.includes('shadow'), 'shadow root match missing');
    assert.ok(ids.includes('nested-shadow'), 'nested shadow root match missing');
  });

  check('returns an empty list for invalid selectors instead of throwing', () => {
    assert.deepEqual(dom.deepQuerySelectorAll('button[', body), []);
  });

  check('deepQuerySelector returns the first light-DOM match', () => {
    assert.equal(dom.deepQuerySelector('button', body), deepButton);
  });

  check('generateUniqueSelector prefers #id, then [name], then classes', () => {
    assert.equal(dom.generateUniqueSelector(deepButton), '#deep');
    const named = new FakeElement('input');
    named.setAttribute('name', 'email');
    assert.equal(dom.generateUniqueSelector(named), 'input[name="email"]');
    const classed = new FakeElement('div', { className: 'card wide' });
    assert.equal(dom.generateUniqueSelector(classed), 'div.card.wide');
  });

  check('generateUniqueSelector is safe for empty input', () => {
    assert.equal(dom.generateUniqueSelector(null), '');
  });

  // findElementByText uses the module-level `document`; wire the fake body in.
  check('findElementByText resolves inside a document-like root', () => {
    const previous = (globalThis as any).document;
    (globalThis as any).document = body;
    try {
      const found = dom.findElementByText('Sibling Save');
      assert.equal(found, null, 'no element should match a made-up label');
      const cancel = dom.findElementByText('Cancel');
      assert.equal(cancel, sibling);
    } finally {
      if (previous === undefined) delete (globalThis as any).document;
      else (globalThis as any).document = previous;
    }
  });

  check('shadow matches are reachable through the same call', () => {
    const previous = (globalThis as any).document;
    (globalThis as any).document = body;
    try {
      assert.equal(dom.findElementByText('Shadow Save'), shadowButton);
    } finally {
      if (previous === undefined) delete (globalThis as any).document;
      else (globalThis as any).document = previous;
    }
  });

  console.log(`\n🎉 All ${passed} DOM utility checks passed.`);
}

run();
