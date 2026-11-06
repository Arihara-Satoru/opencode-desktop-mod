import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./panel-c7bWJg2T.js", import.meta.url), "utf8");
const start = source.indexOf("function setupSelectionQuotePopover(ext)");
const end = source.indexOf("// 2. Left GPT/Codex-Style", start);
const setupSource = source.slice(start, end);

function harness() {
  const documentEvents = new Map(), windowEvents = new Map(), timers = new Map();
  let timerID = 0, observer;
  class Element {
    constructor(kind = "div") { this.kind = kind; this.children = []; this.attributes = new Map(); this.events = new Map(); this.style = {}; }
    get isConnected() { return this === body || !!this.parentElement?.isConnected; }
    appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    contains(child) { return child === this || this.children.some(node => node.contains(child)); }
    setAttribute(key, value) { this.attributes.set(key, value); }
    hasAttribute(key) { return this.attributes.has(key); }
    removeAttribute(key) { this.attributes.delete(key); }
    closest(selector) {
      if (selector === '[data-component="timeline-quote"]') return this.kind === "native" ? this : this.parentElement?.closest(selector);
      if (selector === '[data-slot="session-chat-panel"]') return this.kind === "panel" ? this : this.parentElement?.closest(selector);
      if (this.kind === "editor") return this;
      return this.parentElement?.closest(selector);
    }
    addEventListener(type, fn) { this.events.set(type, fn); }
  }
  const body = new Element("body"), panel = body.appendChild(new Element("panel"));
  const text = panel.appendChild(new Element("text")), editor = panel.appendChild(new Element("editor"));
  let toolbar, selected = "本轮需要引用的内容", anchor = text, focus = text, collapsed = false;
  const selection = { rangeCount: 1, get isCollapsed() { return collapsed; }, get anchorNode() { return anchor; }, get focusNode() { return focus; },
    toString: () => selected, getRangeAt: () => ({ getBoundingClientRect: () => ({ width: 160, height: 24, left: 240, top: 180 }) }),
    removeAllRanges() { collapsed = true; this.rangeCount = 0; } };
  const quotes = [], sent = [], opened = [];
  const document = { body, createElement: kind => new Element(kind), querySelector: () => toolbar?.isConnected ? toolbar : null,
    addEventListener: (type, fn) => documentEvents.set(type, fn) };
  const window = { innerWidth: 1024, getSelection: () => selection, addEventListener: (type, fn) => windowEvents.set(type, fn) };
  const ext = { sessions: { current: () => ({ id: "session" }) }, layout: { open: (...args) => opened.push(args) } };
  vm.runInNewContext(setupSource + ";setupSelectionQuotePopover(ext)", { document, window, Element, ext,
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} },
    setTimeout: fn => { const id = ++timerID; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    addQuoteToSession: (session, text) => quotes.push({ session, text }), sendBtwMessage: arg => sent.push(arg),
    crypto: { randomUUID: () => "quote" }, focusInputCallback: null });
  const fire = (type, event = {}) => documentEvents.get(type)?.({ target: text, ...event });
  const key = event => { const e = { key: "q", altKey: true, preventDefault() { this.prevented = true; }, ...event }; windowEvents.get("keydown")(e); return e; };
  const flush = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
  const native = () => {
    toolbar = body.appendChild(new Element("native"));
    const button = toolbar.appendChild(new Element("native-button"));
    button.addEventListener("click", e => { quotes.push({ native: true, alt: e.altKey }); selection.removeAllRanges(); });
    observer();
    return { toolbar, button };
  };
  const popover = () => {
    const find = root => root.className === "oc-selection-popover" ? root : root.children.map(find).find(Boolean);
    return find(body);
  };
  return { body, text, editor, fire, key, flush, native, popover, quotes, sent, opened, observer: () => observer(),
    select(value, target = text, other = target) { selected = value; anchor = target; focus = other; selection.rangeCount = 1; collapsed = false; } };
}

{
  const h = harness();
  h.fire("mouseup");
  assert.equal(h.popover(), undefined, "Do not cover the official 150ms debounce with an immediate Mod pill");
  const { toolbar, button } = h.native();
  h.flush();
  const pop = h.popover();
  assert.equal(pop.parentElement, toolbar);
  assert.ok(pop.hasAttribute("data-native-quote"));
  assert.equal(toolbar.children[0], button, "Keep the original quote action first and unchanged");
  h.observer(); h.observer();
  assert.equal(toolbar.children.length, 2, "Do not duplicate buttons on streaming mutations");
  h.fire("mousedown", { target: button });
  assert.equal(h.popover(), pop, "Do not resize/remove toolbar between pointerdown and native click");
  button.events.get("click")({ altKey: true });
  h.fire("selectionchange");
  assert.equal(h.popover(), undefined);
  assert.deepEqual(h.quotes, [{ native: true, alt: true }], "Native quote/Alt-click must not route to /btw");
  assert.equal(h.opened.length, 0);
}
{
  const h = harness();
  h.fire("mouseup"); h.flush();
  const pop = h.popover();
  assert.equal(pop.parentElement, h.body, "Keep fallback on older versions without native quoting");
  const { toolbar } = h.native();
  assert.equal(pop.parentElement, toolbar, "Adopt a toolbar that mounts after the fallback");
  h.fire("scroll");
  assert.equal(h.popover(), pop, "Leave native scroll positioning in control");
  toolbar.remove(); h.observer();
  assert.equal(h.popover(), undefined);
  assert.equal(h.key({}).prevented, true);
  assert.equal(h.quotes[0].text, "本轮需要引用的内容");
  assert.equal(h.opened.length, 1);
}
for (const action of [0, 2]) {
  const h = harness(); h.native(); h.fire("mouseup"); h.flush();
  const button = h.popover().children[action];
  const down = { preventDefault() { this.prevented = true; } };
  button.events.get("mousedown")(down);
  assert.equal(down.prevented, true, "Keep selection for mouse activation");
  button.events.get("click")();
  assert.equal(h.opened.length, 1, "Click supports both pointer and keyboard activation");
  if (action === 0) assert.equal(h.quotes[0].text, "本轮需要引用的内容");
  else assert.equal(h.sent[0].quotes[0].text, "本轮需要引用的内容");
}
{
  const h = harness(); h.fire("mouseup"); h.flush();
  h.select("新的选区");
  h.key({});
  assert.equal(h.quotes[0].text, "新的选区", "Never reuse cached text from an earlier selection");
}
for (const event of [{ defaultPrevented: true }, { isComposing: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { key: "Escape" }]) {
  const h = harness();
  assert.ok(!h.key(event).prevented);
  assert.equal(h.opened.length, 0, "Do not steal official or composing keyboard events");
}
for (const target of ["editor", "body", "detached", "cross-panel"]) {
  const h = harness();
  if (target === "detached") { h.text.remove(); h.select("无效选区"); }
  else if (target === "cross-panel") h.select("跨面板选区", h.text, h.body);
  else h.select("输入框或非消息选区", h[target]);
  h.fire("selectionchange"); h.flush();
  assert.equal(h.popover(), undefined);
  assert.ok(!h.key({}).prevented);
  assert.equal(h.opened.length, 0);
}
console.log("Selection quote checks passed: native toolbar/action preserved, late mounting, fallback, live selections, keyboard and composer isolation.");
