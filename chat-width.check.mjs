import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWidthManager, PRESETS, getWidthIndicatorPosition } from "./chat-width.js";

// Mock localStorage
const store = new Map();
const mockStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

// 1. Initial State
const wm = createWidthManager(mockStorage);
assert.equal(wm.state.width, 744, "Default width must be 744");
assert.equal(wm.state.isFull, false, "Default isFull must be false");
assert.equal(wm.state.syncComposer, true, "Default syncComposer must be true");

// 2. Set Width
wm.setWidth(1100);
assert.equal(wm.state.width, 1100);
assert.equal(wm.state.isFull, false);

// 3. Clamping bounds
wm.setWidth(200);
assert.equal(wm.state.width, 560, "Width should be clamped to MIN_WIDTH (560)");
wm.setWidth(99999);
assert.equal(wm.state.width, 3840, "Width should be clamped to max 3840");

// 4. Persistence in localStorage
assert.ok(store.has("oc-chat-width.v1"), "State should be persisted in storage");
const saved = JSON.parse(store.get("oc-chat-width.v1"));
assert.equal(saved.width, 3840);

// 5. Reloading from storage
const wm2 = createWidthManager(mockStorage);
assert.equal(wm2.state.width, 3840);

// 6. Reset
wm2.reset();
assert.equal(wm2.state.width, 744);
assert.equal(wm2.state.isFull, false);
assert.equal(wm2.state.syncComposer, true);

// 7. Cycle Presets
// 744 -> 1200
let next = wm2.cyclePreset();
assert.equal(next.width, 1200);
assert.equal(next.isFull, false);

// 1200 -> full
next = wm2.cyclePreset();
assert.equal(next.isFull, true);

// full -> 744
next = wm2.cyclePreset();
assert.equal(next.width, 744);
assert.equal(next.isFull, false);

// 8. Full mode toggle
wm2.setFull(true);
assert.equal(wm2.state.isFull, true);
wm2.setWidth(1000);
assert.equal(wm2.state.isFull, false, "Setting width should exit full mode");
assert.equal(wm2.state.width, 1000);

// 9. Composer sync toggle
wm2.setSyncComposer(false);
assert.equal(wm2.state.syncComposer, false);

// 10. Presets list validity
assert.equal(PRESETS.length, 5);
assert.equal(PRESETS[0].width, 744);
assert.equal(PRESETS[4].isFull, true);

// The label must follow the actual rail, not the pointer (which can move past
// the rail when the width reaches a minimum or maximum).
const viewport = { width: 1600, height: 900 };
const size = { width: 80, height: 30 };
const rightRail = { left: 1291, width: 18 };
assert.deepEqual(getWidthIndicatorPosition(rightRail, 400, "right", size, viewport), { left: 1312, top: 358 });
assert.deepEqual(getWidthIndicatorPosition({ left: 291, width: 18 }, 400, "left", size, viewport), { left: 208, top: 358 });
// At viewport edges, flip to the inside and keep the label visible.
assert.equal(getWidthIndicatorPosition({ left: 1551, width: 18 }, 400, "right", size, viewport).left, 1468);
assert.equal(getWidthIndicatorPosition({ left: 11, width: 18 }, 400, "left", size, viewport).left, 32);
assert.equal(getWidthIndicatorPosition(rightRail, 5, "right", size, viewport).top, 8);
assert.equal(getWidthIndicatorPosition(rightRail, 1200, "right", size, viewport).top, 862);

const source = readFileSync(new URL("./chat-width.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /ensureHeaderButton|togglePopover|oc-width-btn|oc-width-popover/, "No width toolbar button or popover should be injected");
assert.match(source, /document\.body\.appendChild\(activeIndicator\)/, "Fixed feedback must not inherit a transformed session containing block");

console.log("Chat width checks passed: state, persistence, presets, rail-anchored feedback, viewport bounds and toolbar removal.");
