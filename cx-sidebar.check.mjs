import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { getEventListeners } from "node:events";

// ponytail: Exercise the real adapter/model/poll without a DOM dependency.
// Intercept only painting; Electron's visual layout still needs a manual smoke check.
const source = readFileSync(new URL("./cx-sidebar.js", import.meta.url), "utf8")
  .replace("export function mount", "function mount")
  .replace("  injectStyle();", `
    host.check = { api, poll: (...args) => poll(...args), refresh: () => refresh(), state: () => state };
    render = (model) => host.paints.push(model || buildModel(state.snap));
  `);
const storage = new Map();
const intervals = new Map();
let nextInterval = 0;
const sandbox = {
  document: Object.assign(new EventTarget(), { documentElement: { lang: "en" } }),
  window: new EventTarget(),
  localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  setInterval: (fn) => { intervals.set(++nextInterval, fn); return nextInterval; },
  clearInterval: (id) => intervals.delete(id), AbortController, clearTimeout, Date,
};
vm.createContext(sandbox);
vm.runInContext(source + "\nglobalThis.mount = mount;", sandbox);

let projects = [
  { id: "p1", worktree: "/one", name: "Same name" },
  { id: "p2", worktree: "/two", name: "Same name" },
];
let history = Array.from({ length: 8 }, (_, i) => ({
  id: `s${i}`, title: `Session ${i}`, projectID: "p1", location: { directory: "/one" },
  time: { created: 100 - i, updated: i === 7 ? 10000 : 100 - i },
}));
// Equal creation times must have a deterministic tie-break, too.
history[6].time.created = history[7].time.created;
const live = [];
let current;
const tabs = [];
const ctx = {
  projects: { list: () => projects },
  data: { session: { list: () => live, root: (id) => id, status: () => "idle", pending: { list: () => [] } } },
  notification: { session: { unread: () => false } },
  sdk: { connection: { status: () => "connected" }, api: { session: {
    list: async () => ({ data: history, cursor: {} }),
  } } },
};
const makeHost = () => ({ paints: [], style: {}, isConnected: true, classList: { add() {} }, addEventListener() {}, querySelectorAll: () => [] });
const host = makeHost();
const deps = {
  servers: { servers: { list: () => [{ key: "local" }] }, ensureServerCtx: () => ctx, local: () => true },
  tabs, current: () => current, serverKey: (s) => s.key, tabKey: (t) => `${t.server}\0${t.sessionId}`,
  locale: () => "en",
  tabsStore: {
    addSessionTab: (t) => { const tab = { type: "session", ...t }; tabs.push(tab); return tab; },
    select: (t) => { current = t; },
  },
};
const dispose = sandbox.mount(host, deps);
await new Promise(setImmediate); // Let the initial history request and its poll finish.
const check = host.check;
const model = () => host.paints.at(-1);
const ids = (worktree = "/one") => Array.from(model().projs.find((g) => g.worktree === worktree).sessions, (s) => s.id);
const expected = history.map((s) => s.id);
assert.deepEqual(ids(), expected, "Creation time, not updated time, determines order");

let paints = host.paints.length;
for (const i of [3, 7]) {
  check.api.openSession("local", `s${i}`, "/one");
  live.unshift({ ...history[i], location: {}, time: { created: 99999, updated: 50000, viewed: 50000 } });
  projects.reverse();
  await check.poll();
  assert.equal(check.state().activeKey, `local\0s${i}`);
  assert.equal(host.paints.length, paints, "Selecting an older session must not rebuild the tree");
  assert.deepEqual(ids(), expected);
  assert.equal(check.state().snap.servers[0].sessions.find((s) => s.id === `s${i}`).created, history[i].time.created);
}
assert.equal(tabs.length, 2);
check.api.openSession("local", "s3", "/one");
assert.equal(tabs.length, 2, "Reuse an existing session tab");

const previousSnap = check.state().snap;
history = [...history].reverse().map((s) => ({ ...s, time: { ...s.time, updated: 90000 } }));
await check.refresh();
assert.equal(host.paints.length, paints, "Unchanged history refresh must not force a rebuild");
assert.notEqual(check.state().snap, previousSnap, "Fast-path polling must retain the latest snapshot");

live[0] = { ...live[0], title: "Renamed" };
await check.poll();
assert.equal(host.paints.length, ++paints, "Title changes still invalidate the rendered model");

const oldHash = check.state().structureHash;
check.state().renaming = "local\0s7";
live[0] = { ...live[0], title: "Changed while editing" };
await check.poll();
assert.equal(host.paints.length, paints);
assert.equal(check.state().structureHash, oldHash, "A deferred render must not commit its signature");
check.state().renaming = null;
await check.poll();
assert.equal(host.paints.length, ++paints, "Render deferred changes when editing ends");

live[0] = { ...live[0], location: { directory: "/two" } };
await check.poll();
assert.equal(host.paints.length, ++paints, "Moving a session between projects invalidates the model");
assert.deepEqual(ids("/two"), ["s7"]);

live.push({ id: "no-directory", title: "Project fallback", project: { id: "p1" }, time: { created: 0 } });
await check.poll();
assert.ok(ids().includes("no-directory"), "Project-ID fallback must work with multiple projects");

live.push({ id: "new", title: "New session", location: { directory: "/one" }, time: { created: 200 } });
await check.poll();
assert.equal(ids()[0], "new", "New sessions still appear first");
live.push({ id: "missing-time", title: "Missing time", location: { directory: "/one" }, time: { updated: 999999 } });
await check.poll();
assert.notEqual(ids()[0], "missing-time", "Missing creation time must not fall back to mutable updated time");

live[0] = { ...live[0], time: { ...live[0].time, archived: 123 } };
await check.poll();
assert.deepEqual(ids("/two"), [], "Live archive metadata must not be masked by historical time fields");

paints = host.paints.length;
await check.poll(true);
assert.equal(host.paints.length, paints + 1, "Explicit UI actions can still request a rebuild");

const secondDispose = sandbox.mount(host, deps);
await new Promise(setImmediate);
assert.equal(intervals.size, 1, "Remounting a host must dispose its previous instance");
assert.equal(getEventListeners(sandbox.window, "focus").length, 1);
dispose();
assert.equal(host.__oc_cx_dispose, secondDispose, "An old disposer must not clear a newer mount");
paints = host.paints.length;
await check.poll(true);
assert.equal(host.paints.length, paints, "Disposed instances must stop rendering");
secondDispose();
assert.equal(intervals.size, 0);
for (const name of ["focus", "blur", "storage"]) assert.equal(getEventListeners(sandbox.window, name).length, 0);
for (const name of ["pointerdown", "keydown", "visibilitychange"]) assert.equal(getEventListeners(sandbox.document, name).length, 0);

// Optionally exercise the emitted hook with the exact Solid runtime shipped in OpenCode 2.1.3.
// Run: node cx-sidebar.check.mjs <path-to-app.asar.bak>
if (process.argv[2]) {
  const archive = readFileSync(process.argv[2]);
  const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)));
  const start = 8 + archive.readUInt32LE(4);
  const assets = header.files.out.files.renderer.files.assets.files;
  const read = (name) => {
    const node = assets[name];
    return archive.subarray(start + Number(node.offset), start + Number(node.offset) + node.size).toString();
  };
  const main = read(Object.keys(assets).find((name) => /^main-.*\.js$/.test(name)));
  const panelName = main.slice(main.indexOf("slash:{name:`btw`") - 1000, main.indexOf("slash:{name:`btw`"))
    .match(/import\([`'"]\.\/(panel-[A-Za-z0-9_-]+\.js)[`'"]\)/)[1];
  const patcher = readFileSync(new URL("./apply-mod.mjs", import.meta.url), "utf8");
  const patchMain = vm.runInNewContext(patcher.slice(patcher.indexOf("function patchMainBundle("), patcher.indexOf("function patchSessionRouteBundle(")) + ";patchMainBundle", { console });
  const patched = patchMain(main, panelName, read(panelName));
  const lifecycleCapture = patched.match(/^const __oc_cx_onCleanup=[\w$]+;/)?.[0] || "";
  const hook = patched.match(/Vae\(\),((\(\(\)=>\{var )[\s\S]*?return [\w$]+\([\w$]+,\[host,origWrap\]\),[\w$]+;\}\)\(\))/)[1];
  const solid = vm.runInNewContext(main.slice(main.indexOf("var t={context:"), main.indexOf("function Fe()")) + ";({root:x,signal:S,memo:E,component:F,cleanup:A})");
  solid.root((disposeRoot) => {
    const [current, select] = solid.signal(undefined);
    let mounts = 0;
    const parent = solid.memo(() => {
      mounts++;
      // The real vertical-tab component binds A to { open, settings }, shadowing Solid's helper.
      return vm.runInNewContext(lifecycleCapture + ";(()=>{const A={open:false,settings:false};return " + hook + ";})()", {
        Hae: makeHost, H: (el, children) => { el.children = children; },
        F: solid.component, A: solid.cleanup, i5: () => ({}),
        document: { createElement: makeHost }, window: { __oc_cx_sidebar: { mount: sandbox.mount } },
        s: deps.servers, d: deps.tabsStore, _: deps.tabs, D: current,
        jR: deps.tabKey, Q: { key: deps.serverKey }, zU: () => null, r: { locale: () => "en" },
      });
    });
    const element = parent();
    select({ type: "session", server: "local", sessionId: "s3" });
    assert.equal(parent(), element, "Selecting a session must preserve the Solid-owned sidebar host");
    assert.equal(mounts, 1, "Snapshot reads must not subscribe the sidebar's Solid parent");
    assert.equal(intervals.size, 1);
    disposeRoot();
    assert.equal(intervals.size, 0, "Disposing the Solid owner must dispose the injected sidebar immediately");
  });
  await new Promise(setImmediate);
  assert.equal(intervals.size, 0, "Pending history requests must not revive a disposed mount");
  console.log("OpenCode Solid checks passed: stable parent host, one mount, immediate owner cleanup, no async revival.");
}
console.log("Sidebar checks passed: stable creation order, model signature, refresh, deferred rendering, grouping, live metadata and lifecycle cleanup.");
