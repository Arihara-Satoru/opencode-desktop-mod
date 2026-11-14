import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { patchGoalComposer } from "./goal-composer-patch.mjs";
import { patchLongTextComposer } from "./long-text-patch.mjs";
import { isTextCard, textCardContent, insertTextCard } from "./long-text.mjs";

const source = fs.readFileSync(new URL("./goal-composer.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /\.innerHTML\s*=|execCommand|\.submit\(|fetch\(|setInterval\(/, "No input mutation, synthetic sending, extra HTTP requests or polling");
const native = 'import{effect as eff,cleanup as clean}from"./host.js";' +
  'function ctl(){let t,e={},s={state:{}};return{parts(){return s.state.prompt},setEditor(n){t=n,e.onEditor?.(n)},restoreFocus:focus,onInput(){}}}' +
  'function snapshot(e,t){let n=e.adapter.state;return{draft:{initial:n,target:n,prompt:n.current()},text:"objective",mode:"normal",session:e.adapter.kind===`active-session`?e.adapter.session():void 0}}' +
  'function value(t){let s={mode:t.mode,prompt:t.draft.prompt,context:t.draft.context,text:t.text,images:[]};return s}' +
  'function fingerprint(t){return JSON.stringify([t.mode,t.delivery,t.text])}' +
  'async function send(e,t,n){let r=await serialize(e,t),i=async()=>{};let c={id:t.id,text:r.text,files:r.files,metadata:{displayText:r.displayText,comments:r.comments,attachments:r.attachments,agent:t.selection.agent,model:t.selection.model}};await e.data.session.prompt(c).catch(()=>e.data.session.prompt(c))}';
const patched = patchGoalComposer(patchLongTextComposer(native), { createEffect: "effect", onCleanup: "cleanup" });
const modern = native.replace('.catch(()=>e.data.session.prompt(c))}', '.catch(()=>e.data.session.prompt(c)),e.data.session.acceptSend(e.id)}');
const modernPatched = patchGoalComposer(patchLongTextComposer(modern), { createEffect: "effect", onCleanup: "cleanup" });
assert.ok(modernPatched.includes('.catch(()=>e.data.session.prompt(c)),e.data.session.acceptSend(e.id);__oc_goal_sent(t)}'), '2.3.0 keeps native acceptance before consuming goal mode');
assert.match(patched, /__oc_capture_goal\(e\.editor\?\.\(\),\{draft:/);
assert.match(patched, /desktopGoal:t\.desktopGoal,mode:t\.mode/);
assert.match(patched, /\[t\.desktopGoal\?\?null,t\.mode/);
assert.match(patched, /__oc_bind_goal\(n,this,\(\)=>s\.state,eff,clean\)/);
assert.match(patched, /__oc_check_goal\(t\);let r=__oc_prepare_long_text/);
assert.match(patched, /metadata:\{\.\.\.__oc_goal_metadata\(t\)/);
assert.throws(() => patchGoalComposer("unknown", { createEffect: "effect", onCleanup: "cleanup" }), /无法安全解析/);
assert.throws(() => patchGoalComposer(native + native, { createEffect: "effect", onCleanup: "cleanup" }), /无法安全解析/);

// Exercise the patched native sender: the metadata/payload is prepared once,
// retried under the same ID, and only confirmed sends consume goal input mode.
{
  let checks = 0, prepared = 0, attempts = 0, accepted = 0;
  const sandbox = {
    __oc_check_goal: () => { checks++; },
    __oc_prepare_long_text: data => { prepared++; return data; },
    __oc_goal_metadata: prompt => ({ desktopGoal: prompt.desktopGoal }),
    __oc_goal_sent: prompt => { accepted++; assert.equal(prompt.id, "msg_retry"); },
    serialize: async () => ({ text: "objective", displayText: "objective", files: [{ uri: "fixture" }], comments: [1], attachments: [2] }),
  };
  vm.createContext(sandbox);
  vm.runInContext(patched.replace(/^import[^\n]+\n/gm, "").replace('import{effect as eff,cleanup as clean}from"./host.js";', "") + ";globalThis.send=send;", sandbox);
  const prompt = { id: "msg_retry", desktopGoal: { version: 1, objective: "objective" }, selection: { agent: "build" } };
  await sandbox.send({ data: { session: { prompt: async data => { attempts++; assert.equal(data.metadata.desktopGoal.objective, "objective"); assert.equal(data.files[0].uri, "fixture"); if (attempts === 1) throw Error("retry"); } } } }, prompt);
  assert.deepEqual([checks, prepared, attempts, accepted], [1, 1, 2, 1]);
  await assert.rejects(sandbox.send({ data: { session: { prompt: async () => { throw Error("unavailable"); } } } }, prompt));
  assert.equal(accepted, 1, "Failed native sends leave input mode intact");
}

// Minimal deterministic DOM. Solid's real reactivity is checked separately in
// gui-preview.mjs; these tests cover all state transitions without browser timing.
function element(tag) {
  const attrs = new Map(), handlers = new Map();
  return { tag, children: [], className: "", hidden: false, parentElement: null,
    get firstChild() { return this.children[0] ?? null; },
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null; },
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } },
    prepend(child) { this.insertBefore(child, this.firstChild); },
    insertBefore(child, anchor) { child.remove(); const index = anchor ? this.children.indexOf(anchor) : this.children.length; assert.ok(index >= 0); this.children.splice(index, 0, child); child.parentElement = this; },
    remove() { const parent = this.parentElement; if (parent) parent.children.splice(parent.children.indexOf(this), 1); this.parentElement = null; },
    setAttribute: (key, value) => attrs.set(key, value), getAttribute: key => attrs.get(key),
    addEventListener: (key, value) => handlers.set(key, value), fire(key, event = {}) { handlers.get(key)?.(event); },
    getClientRects: () => [1],
  };
}
{
  const cleanups = [], effects = [], observers = [], errors = [];
  const document = { head: element("head"), querySelector: () => document.head.children[0], createElement: element, createElementNS: (_, tag) => element(tag) };
  const sandbox = { document, window: {}, console, isTextCard, textCardContent, MutationObserver: class { constructor(callback) { this.run = callback; observers.push(this); } observe() {} disconnect() { this.closed = true; } } };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/^import[^\n]+\n/, "").replaceAll("export ", ""), sandbox);
  const form = element("form"), actions = element("actions"), content = element("content"), editor = element("editor"), send = element("send"), mic = element("mic");
  mic.className = "oc-voice-button"; actions.append(send); form.append(content, actions); content.append(editor);
  form.querySelector = selector => selector.includes("composer-actions") ? actions : content;
  actions.querySelector = () => actions.children.find(value => value.className === "oc-voice-button");
  editor.closest = () => form; editor.setAttribute("contenteditable", "true");
  let current = {}, mode = "normal", focused = 0;
  const first = current, second = {};
  const controller = { mode: () => mode, view: {}, restoreFocus: () => { focused++; } };
  sandbox.bindGoalComposer(editor, controller, () => current, effect => { effects.push(effect); effect(); }, cleanup => cleanups.push(cleanup));
  const button = actions.children[0], row = content.children[0];
  assert.equal(button.hidden, true, "The button stays unavailable until the GUI plugin is loaded");
  const disconnect = sandbox.connectGoalComposer({ error: message => errors.push(message) });
  assert.equal(button.hidden, false);
  actions.prepend(mic); observers[0].run();
  assert.deepEqual(actions.children, [button, mic, send], "Always immediately left of the actual microphone, even on late mount");
  const snapshot = (text = "Full objective") => sandbox.captureGoalSnapshot(editor, { text, mode, selection: { agent: "build" }, prompt: [1], files: [2] });
  assert.equal(snapshot().desktopGoal, undefined);
  button.fire("click");
  assert.equal(row.hidden, false); assert.equal(button.getAttribute("aria-pressed"), "true"); assert.equal(focused, 1);
  const queued = snapshot();
  assert.equal(queued.desktopGoal.objective, "Full objective");
  assert.equal(queued.files[0], 2);
  const pasted = "逐项完成并验证\n".repeat(120);
  const card = insertTextCard([], pasted, 0, 0, "goal-card");
  const cardGoal = sandbox.captureGoalSnapshot(editor, { mode, text: "pasted-text.txt ", prompt: card.parts });
  assert.equal(cardGoal.desktopGoal.objective, pasted.trim(), "A pasted goal uses its full authored text, not a card's filename");
  current = second; effects.forEach(fn => fn()); assert.equal(row.hidden, true, "Mode belongs to a draft, not the whole window");
  current = first; effects.forEach(fn => fn()); assert.equal(row.hidden, false);
  assert.equal(snapshot("/goal pause").desktopGoal, undefined, "Native slash commands retain their own route");
  mode = "shell"; effects.forEach(fn => fn());
  assert.equal(button.disabled, true); assert.equal(row.hidden, true); assert.equal(snapshot().desktopGoal, undefined);
  mode = "normal"; effects.forEach(fn => fn());
  assert.throws(() => sandbox.checkGoalSend({ ...snapshot(), selection: { agent: "plan" } }), /Plan/);
  assert.throws(() => sandbox.checkGoalSend(snapshot(" ")), /1–4000/);
  assert.throws(() => sandbox.checkGoalSend(snapshot("a".repeat(4001))), /1–4000/);
  assert.equal(errors.length, 3);
  // Turning mode off and on while a send is pending must not be undone by the
  // completion of that older request.
  button.fire("click"); button.fire("click"); sandbox.goalSent(queued); assert.equal(row.hidden, false);
  sandbox.goalSent(snapshot()); assert.equal(row.hidden, true, "One successful send resets only its captured mode");
  assert.equal(snapshot().desktopGoal, undefined, "Follow-ups stay normal messages");
  sandbox.armGoalComposer(); assert.equal(row.hidden, false);
  row.children[0].children.at(-1).fire("click"); assert.equal(row.hidden, true, "The small badge can be dismissed without editing text");
  disconnect(); assert.equal(button.hidden, true);
  for (const dispose of cleanups) dispose();
  assert.equal(actions.children.includes(button), false); assert.equal(observers[0].closed, true);
}
console.log("Goal composer checks passed: native snapshot/metadata/retry, one-shot mode, mic ordering, draft/Plan/shell isolation, failure and cleanup.");
