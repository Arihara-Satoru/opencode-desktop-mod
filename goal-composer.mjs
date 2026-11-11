import { isTextCard, textCardContent } from "./long-text.mjs";

const bindings = new Set();
const controllers = new WeakMap();
const drafts = new WeakMap();
const captures = new WeakMap();
let backend;

// A small window-local adapter to the loaded GUI plugin. It only provides UI
// availability/errors, never credentials or a parallel prompt sender.
export function connectGoalComposer(value) {
  backend = value;
  for (const binding of bindings) binding.render();
  return () => {
    if (backend !== value) return;
    backend = undefined;
    for (const binding of bindings) binding.render();
  };
}

function state(binding) {
  const key = binding.draft();
  let value = drafts.get(key);
  if (!value) { value = { enabled: false, generation: 0 }; drafts.set(key, value); }
  return value;
}
function normal(binding) {
  return (binding.controller.mode?.() ?? binding.controller.state?.mode) === "normal"
    && !binding.controller.view.draftOnly && binding.editor.getAttribute("contenteditable") !== "false";
}
function objective(value) {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > 4000) {
    throw new Error("请输入 1–4000 个字符作为目标；附件可以随消息一起发送。");
  }
  return value.trim();
}
function report(error) {
  backend?.error(error instanceof Error ? error.message : String(error));
}

// Lucide Target, ISC: use the same icon vocabulary as the existing microphone.
function targetIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "aria-hidden": "true" })) svg.setAttribute(name, value);
  for (const radius of [10, 6, 2]) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    for (const [name, value] of Object.entries({ cx: "12", cy: "12", r: String(radius) })) circle.setAttribute(name, value);
    svg.append(circle);
  }
  return svg;
}
const STYLE = `
.oc-goal-button{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:30px;height:30px;padding:0;margin-inline-end:6px;border:0;border-radius:8px;background:transparent;color:var(--v2-icon-icon-muted,#71717a);cursor:pointer}
.oc-goal-button:hover{background:var(--v2-overlay-simple-overlay-hover,rgba(120,120,128,.12));color:var(--v2-text-text-base,#27272a)}
.oc-goal-button[aria-pressed="true"]{background:var(--v2-background-bg-layer-02,#e4e4e7);color:var(--v2-text-text-base,#27272a)}
.oc-goal-button:active{transform:scale(.96)}
.oc-goal-button:focus-visible,.oc-goal-mode-close:focus-visible{outline:2px solid var(--v2-border-border-focus,#699dcc);outline-offset:2px}
.oc-goal-button:disabled{opacity:.45;cursor:default}
.oc-goal-button svg,.oc-goal-mode svg{width:17px;height:17px;flex-shrink:0}
.oc-goal-mode-row{display:flex;align-items:center;padding:12px 16px 0;gap:8px;min-width:0}
.oc-goal-mode{display:inline-flex;align-items:center;gap:6px;min-height:24px;max-width:100%;padding:2px 4px 2px 8px;border:1px solid var(--v2-border-border-base,#d4d4d8);border-radius:6px;background:var(--v2-background-bg-layer-02,#f4f4f5);color:var(--v2-text-text-base,#27272a);font:500 12px/18px var(--v2-font-family-sans,system-ui);white-space:nowrap}
.oc-goal-mode svg{width:13px;height:13px}
.oc-goal-mode-close{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;font:16px/1 system-ui;cursor:pointer}
.oc-goal-mode-close:hover{background:var(--v2-overlay-simple-overlay-hover,rgba(120,120,128,.12))}
.oc-goal-mode-row[hidden],.oc-goal-button[hidden]{display:none!important}
`;

export function bindGoalComposer(editor, controller, draft, effect, cleanup) {
  if (!editor || controllers.has(controller)) return;
  const form = editor.closest('form[data-component="composer"]');
  const actions = form?.querySelector('[data-slot="composer-actions"]');
  const content = form?.querySelector('[data-slot="composer-content"]');
  if (!actions || !content) return;
  if (!document.querySelector("style[data-oc-goal-composer]")) {
    const style = document.createElement("style");
    style.setAttribute("data-oc-goal-composer", ""); style.textContent = STYLE; document.head.append(style);
  }
  const button = document.createElement("button");
  button.type = "button"; button.className = "oc-goal-button"; button.append(targetIcon());
  const row = document.createElement("div"); row.className = "oc-goal-mode-row";
  row.setAttribute("role", "status"); row.setAttribute("aria-live", "polite");
  const pill = document.createElement("span"); pill.className = "oc-goal-mode";
  pill.title = "下一条消息将作为持续目标执行；发送成功后自动退出输入模式，不会暂停已创建的目标。";
  const label = document.createElement("span"); label.textContent = "目标模式";
  const close = document.createElement("button"); close.type = "button"; close.className = "oc-goal-mode-close"; close.textContent = "×";
  close.setAttribute("aria-label", "退出目标输入模式");
  pill.append(targetIcon(), label, close); row.append(pill); content.prepend(row);
  const binding = { editor, controller, draft, form, button, row, render };
  controllers.set(controller, binding); bindings.add(binding);
  const toggle = enabled => {
    const value = state(binding); value.enabled = enabled; value.generation++;
    render(); controller.restoreFocus();
  };
  button.addEventListener("mousedown", event => event.preventDefault());
  button.addEventListener("click", () => { if (backend && normal(binding)) toggle(!state(binding).enabled); });
  close.addEventListener("mousedown", event => event.preventDefault());
  close.addEventListener("click", () => toggle(false));
  function render() {
    const current = state(binding);
    const available = !!backend;
    const enabled = available && normal(binding) && current.enabled;
    button.hidden = !available; button.disabled = !normal(binding);
    button.setAttribute("aria-pressed", String(enabled));
    const title = enabled ? "退出目标输入模式" : "目标模式：将下一条消息设为持续目标";
    if (button.title !== title) { button.title = title; button.setAttribute("aria-label", title); }
    row.hidden = !enabled;
    const anchor = actions.querySelector(".oc-voice-button");
    if (anchor ? button.nextSibling !== anchor : button.parentElement !== actions) actions.insertBefore(button, anchor || actions.firstChild);
  }
  effect(render);
  // Voice may mount after us, or the native action row may rerender. Repair only
  // this local order, without document-wide polling or rerunning the sender.
  const observer = new MutationObserver(() => {
    const mic = actions.querySelector(".oc-voice-button");
    if (mic && button.nextSibling !== mic) actions.insertBefore(button, mic);
  });
  observer.observe(actions, { childList: true });
  cleanup(() => { observer.disconnect(); button.remove(); row.remove(); bindings.delete(binding); controllers.delete(controller); });
}

export function captureGoalSnapshot(editor, snapshot) {
  const binding = [...bindings].find(value => value.editor === editor);
  if (!binding || !backend || !normal(binding) || !state(binding).enabled || snapshot.mode !== "normal" || /^\s*\//.test(snapshot.text)) return snapshot;
  const value = state(binding);
  // Long plain-text pastes may already be native TXT cards. Their display
  // filename is not the user's goal; keep the full authored text as objective.
  const text = snapshot.prompt?.some(isTextCard)
    ? snapshot.prompt.map(part => isTextCard(part) ? textCardContent(part) : part.content ?? "").join("")
    : snapshot.text;
  const marker = { version: 1, objective: text.trim() };
  captures.set(marker, { binding, state: value, generation: value.generation });
  return { ...snapshot, desktopGoal: marker };
}

export function checkGoalSend(prompt) {
  if (!prompt.desktopGoal) return;
  try {
    if (!backend) throw new Error("目标插件尚未就绪，未发送消息。请等待插件加载后重试。");
    objective(prompt.desktopGoal.objective);
    if (prompt.selection?.agent === "plan") throw new Error("Plan 模式不能开始持续目标。请自行切换到执行 Agent 后重试。");
  } catch (error) { report(error); throw error; }
}
export function goalMetadata(prompt) {
  return prompt.desktopGoal ? { desktopGoal: { version: 1, objective: prompt.desktopGoal.objective } } : {};
}
export function goalSent(prompt) {
  const capture = captures.get(prompt.desktopGoal);
  if (!capture || capture.state.generation !== capture.generation) return;
  capture.state.enabled = false;
  capture.binding.render();
}
export function armGoalComposer() {
  const binding = [...bindings].find(value => value.form.getClientRects().length && normal(value));
  if (!backend || !binding) return false;
  const value = state(binding); value.enabled = true; value.generation++;
  binding.render(); binding.controller.restoreFocus(); return true;
}
if (typeof window !== "undefined") window.__ocGoalComposer = { connect: connectGoalComposer, arm: armGoalComposer };
