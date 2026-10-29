// Shared by the native prompt serializer and the renderer. Draft edits go through
// the native controller; the regular prompt lifecycle owns delivery and retries.
export const FILE_CHAR_LIMIT = 8000;
export const FILE_LINE_LIMIT = 120;
export const PREVIEW_LINES = 12;
const CARD_PATH = "__oc_pasted_text__/";

export function shouldAttachText(text) {
  return typeof text === "string" && text.trim().length > 0 &&
    (text.length >= FILE_CHAR_LIMIT || text.split(/\r\n|\r|\n/).length >= FILE_LINE_LIMIT);
}

export function textDataUri(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:text/plain;base64,${btoa(binary)}`;
}

export function prepareLongText(serialized, prompt) {
  const compact = compactTextCards(serialized, prompt);
  if (compact !== serialized) {
    serialized = compact;
    prompt = { ...prompt, text: compact.displayText };
  }
  if (!shouldAttachText(prompt?.text) || !serialized.text?.startsWith(prompt.text)) return serialized;
  const name = nextTextFilename(serialized.files?.map(file => ({ filename: file.name })));
  let displayText = "";
  // Keep structured references valid if mentions are present
  const remap = (items = []) => items.map(item => {
    if (!item.mention) return item;
    const label = item.mention.text ?? prompt.text.slice(item.mention.start, item.mention.end);
    const start = displayText.length === 0 ? 0 : displayText.length + 1;
    displayText = displayText.length === 0 ? label : `${displayText} ${label}`;
    return { ...item, mention: { ...item.mention, start, end: start + label.length, text: label } };
  });
  const files = remap(serialized.files);
  const agents = remap(serialized.agents);
  const skills = remap(serialized.skills);
  const trailingText = serialized.text.slice(prompt.text.length).trim();
  const text = [displayText, trailingText].filter(Boolean).join("\n");
  return {
    ...serialized,
    text,
    displayText,
    files: [...files, { uri: textDataUri(prompt.text), mime: "text/plain", name }],
    agents,
    skills,
  };
}

function nextTextFilename(parts = []) {
  const names = new Set(parts.map(part => part.filename));
  let index = 1;
  while (names.has(index === 1 ? "pasted-text.txt" : `pasted-text-${index}.txt`)) index++;
  return index === 1 ? "pasted-text.txt" : `pasted-text-${index}.txt`;
}

export function isTextCard(part) {
  return part?.type === "file" && typeof part.path === "string" && part.path.startsWith(CARD_PATH) &&
    part.mime === "text/plain" && typeof part.url === "string" && part.url.startsWith("data:text/plain;base64,");
}

export function textCardContent(part) {
  if (!isTextCard(part)) return null;
  const binary = atob(part.url.slice(part.url.indexOf(",") + 1));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

function reindexParts(parts) {
  let offset = 0;
  return parts.map(part => {
    if (typeof part.content !== "string") return part;
    const next = { ...part, start: offset, end: offset + part.content.length };
    offset = next.end;
    return next;
  });
}

// Replace the native selection with one serializable file mention. Full text is
// kept in the native draft's data URI, never in a separate volatile side store.
export function insertTextCard(parts, text, start, end = start, id = crypto.randomUUID()) {
  const length = parts.reduce((sum, part) => sum + (part.content?.length ?? 0), 0);
  start = Math.max(0, Math.min(length, start ?? length));
  end = Math.max(start, Math.min(length, end ?? start));
  const filename = nextTextFilename(parts);
  const card = { type: "file", path: `${CARD_PATH}${id}/${filename}`, filename,
    mime: "text/plain", url: textDataUri(text), content: filename, start: 0, end: 0 };
  const next = [];
  let offset = 0, inserted = false, position = start;
  const insert = () => {
    next.push(card, { type: "text", content: " ", start: 0, end: 0 });
    inserted = true;
  };
  for (const part of parts) {
    if (typeof part.content !== "string") { next.push(part); continue; }
    const from = offset, to = offset + part.content.length;
    offset = to;
    if (to <= start && !(from === to && start === from)) { next.push(part); continue; }
    if (from >= end && inserted) { next.push(part); continue; }
    if (!inserted) {
      // Mentions are atomic, matching the native contentEditable=false behavior.
      position = part.type === "text" ? start : from;
      if (part.type === "text" && start > from) next.push({ ...part, content: part.content.slice(0, start - from) });
      insert();
    }
    if (to > end) {
      if (part.type === "text") next.push({ ...part, content: part.content.slice(Math.max(0, end - from)) });
      else if (end <= from) next.push(part);
    }
  }
  if (!inserted) insert();
  return { parts: reindexParts(next), cursor: position + filename.length + 1 };
}

// Turn only our own file-mention labels into attachment cards in the message.
// Native file/agent/skill references keep their remapped character offsets.
function compactTextCards(serialized, prompt) {
  const cards = prompt?.prompt?.filter(isTextCard) ?? [];
  // Session mentions can be normalized by the native serializer, shifting all
  // subsequent offsets. Its displayText is the authoritative rendered string.
  const sourceText = serialized.displayText ?? prompt?.text;
  if (!cards.length || typeof sourceText !== "string" || !serialized.text?.startsWith(sourceText)) return serialized;
  const files = new Set((serialized.files ?? []).filter(file => cards.some(card => card.url === file.uri &&
    file.name === card.filename && file.mention?.text === card.content)));
  if (!files.size) return serialized;
  const ranges = [...files].map(file => file.mention).sort((a, b) => a.start - b.start);
  if (ranges.some((range, index) => range.start < 0 || range.end > sourceText.length || range.end <= range.start ||
    sourceText.slice(range.start, range.end) !== range.text || index > 0 && range.start < ranges[index - 1].end)) return serialized;
  let value = "", offset = 0;
  for (const range of ranges) { value += sourceText.slice(offset, range.start); offset = range.end; }
  value += sourceText.slice(offset);
  const leading = value.length - value.trimStart().length;
  const displayText = value.trim();
  const mapIndex = index => index - ranges.reduce((sum, range) => sum + Math.max(0, Math.min(index, range.end) - range.start), 0) - leading;
  const remap = (items = []) => items.map(item => {
    if (files.has(item)) { const { mention, ...file } = item; return file; }
    if (!item.mention) return item;
    return { ...item, mention: { ...item.mention, start: mapIndex(item.mention.start), end: mapIndex(item.mention.end) } };
  });
  const trailing = serialized.text.slice(sourceText.length).trim();
  return { ...serialized, text: [displayText, trailing].filter(Boolean).join("\n"), displayText,
    files: remap(serialized.files), agents: remap(serialized.agents), skills: remap(serialized.skills) };
}

const composerBindings = new WeakMap();

function draftSelection(editor, controller) {
  const selection = window.getSelection();
  const fallback = controller.parts().reduce((sum, part) => sum + (part.content?.length ?? 0), 0);
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return [fallback, fallback];
  const range = selection.getRangeAt(0);
  // Count the native editor's BR/block newlines as well as atomic mentions.
  const lengthTo = (node, offset) => {
    const prefix = document.createRange();
    prefix.selectNodeContents(editor);
    prefix.setEnd(node, offset);
    const fragment = prefix.cloneContents();
    const read = node => node.nodeType === Node.TEXT_NODE ? node.textContent :
      node.nodeName === "BR" ? "\n" : Array.from(node.childNodes).map(read).join("");
    return Array.from(fragment.childNodes).map((node, index, list) => read(node) +
      (["DIV", "P"].includes(node.nodeName) && index < list.length - 1 ? "\n" : "")).join("").replace(/\u200B/g, "").length;
  };
  return [lengthTo(range.startContainer, range.startOffset), lengthTo(range.endContainer, range.endOffset)];
}

function cardSummary(text) {
  const size = new TextEncoder().encode(text).length;
  return `${text.split(/\r\n|\r|\n/).length} 行 · ${size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`}`;
}

export function bindLongTextComposer(editor, controller) {
  if (!editor || !controller?.parts || !controller.onInput || composerBindings.has(editor)) return;
  composerBindings.set(editor, controller);
  const writable = () => controller.state.mode === "normal" && !controller.view.draftOnly && editor.getAttribute("contenteditable") !== "false";
  editor.addEventListener("paste", event => {
    const data = event.clipboardData;
    const text = data?.getData("text/plain");
    if (!writable() || !shouldAttachText(text) || Array.from(data?.items ?? []).some(item => item.kind === "file") ||
      /^\s*\//.test(controller.value()) || !controller.value().trim() && /^\s*\//.test(text)) return;
    const [start, end] = draftSelection(editor, controller);
    const next = insertTextCard(controller.parts(), text, start, end);
    event.preventDefault();
    event.stopImmediatePropagation();
    controller.onInput(next.parts.map(part => part.content ?? "").join(""), next.parts, next.cursor);
    controller.restoreFocus(next.cursor);
  }, true);
  const openCard = event => {
    const chip = event.target.closest?.('[data-mention="file"]');
    const part = controller.parts().find(part => isTextCard(part) && part.path === chip?.dataset.path);
    if (!part || !writable()) return;
    const remove = event.type === "keydown" && (event.key === "Backspace" || event.key === "Delete");
    if (event.type === "keydown" && !remove && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (remove) {
      const parts = reindexParts(controller.parts().filter(item => item.path !== part.path));
      controller.onInput(parts.map(item => item.content ?? "").join(""), parts, part.start);
      controller.restoreFocus(part.start);
      return;
    }
    openTextCardEditor(part, controller, editor);
  };
  editor.addEventListener("click", openCard, true);
  editor.addEventListener("keydown", openCard, true);
}

function openTextCardEditor(part, controller, editor) {
  if (document.querySelector(".oc-long-dialog")) return;
  let original;
  try { original = textCardContent(part); }
  catch (error) { console.error("[mod-long-text] Cannot decode text card", error); return; }
  const dialog = document.createElement("dialog");
  dialog.className = "oc-long-dialog";
  const header = document.createElement("div");
  header.className = "oc-long-dialog-header";
  const title = document.createElement("h2");
  title.id = "oc-long-dialog-title";
  title.textContent = part.filename;
  dialog.setAttribute("aria-labelledby", title.id);
  const stats = document.createElement("span");
  stats.className = "oc-long-dialog-stats";
  stats.textContent = cardSummary(original);
  header.append(title, stats);
  const textarea = document.createElement("textarea");
  textarea.className = "oc-long-dialog-editor";
  textarea.setAttribute("aria-label", "文本附件完整内容");
  textarea.spellcheck = false;
  textarea.value = original;
  const initialValue = textarea.value;
  textarea.addEventListener("input", () => { stats.textContent = cardSummary(textarea.value); });
  const footer = document.createElement("div");
  footer.className = "oc-long-dialog-footer";
  const status = document.createElement("span");
  status.textContent = "保留全文，发送时作为 TXT 附件。";
  status.setAttribute("role", "status");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  cancel.addEventListener("click", () => dialog.close());
  const save = document.createElement("button");
  save.type = "button";
  save.className = "oc-long-dialog-save";
  save.textContent = "保存并收起";
  const commit = () => {
    const parts = controller.parts();
    if (!editor.isConnected || controller.state.mode !== "normal" || !parts.some(item => item.path === part.path && item.url === part.url)) {
      status.textContent = "草稿已变化，请关闭后重新打开文本卡片。";
      return;
    }
    const value = textarea.value === initialValue ? original : textarea.value;
    const next = parts.map(item => item.path === part.path ? { ...item, url: textDataUri(value) } : item);
    controller.onInput(next.map(item => item.content ?? "").join(""), next);
    dialog.close();
  };
  save.addEventListener("click", commit);
  dialog.addEventListener("keydown", event => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.isComposing) { event.preventDefault(); commit(); }
  });
  dialog.addEventListener("close", () => {
    window.__oc_set_dialog_active?.(false);
    dialog.remove();
    controller.restoreFocus();
  }, { once: true });
  footer.append(status, cancel, save);
  dialog.append(header, textarea, footer);
  document.body.append(dialog);
  try {
    window.__oc_set_dialog_active?.(true);
    dialog.showModal();
  } catch (error) {
    window.__oc_set_dialog_active?.(false);
    dialog.remove();
    throw error;
  }
  textarea.focus();
}

const TEXT = '[data-component="user-message"] [data-slot="user-message-text"]';
const FORM = 'form[data-component="composer"]';
function createToggleIcon() {
  const create = tag => typeof document.createElementNS === "function"
    ? document.createElementNS("http://www.w3.org/2000/svg", tag)
    : document.createElement(tag);
  const svg = create("svg");
  svg.setAttribute("class", "oc-long-toggle-icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = create("path");
  path.setAttribute("d", "M3.75 6L8 10.25L12.25 6");
  svg.append(path);
  return svg;
}
const STYLE = `
[data-slot="user-message-body"].oc-long-body {
  background: var(--v2-background-bg-layer-02, #f1f1f3);
  border-radius: 10px;
  overflow: hidden;
  align-items: stretch;
}
[data-slot="user-message-body"].oc-long-body > [data-slot="user-message-text"] {
  background: transparent;
  border-radius: 0;
  box-sizing: border-box;
}
[data-slot="user-message-text"][data-oc-long-collapsed] {
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 40px), transparent 100%);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 40px), transparent 100%);
}
[data-slot="user-message-body"] > .oc-long-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  align-self: flex-start;
  margin: 6px 12px 10px 12px;
  padding: 4px 10px;
  min-height: 28px;
  border: 1px solid var(--v2-border-border-base, rgba(120, 120, 128, 0.28));
  border-radius: 6px;
  background: var(--v2-background-bg-base, rgba(120, 120, 128, 0.08));
  color: var(--v2-text-text-base, currentColor);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease;
}
.oc-long-toggle:hover {
  background: var(--v2-overlay-simple-overlay-hover, rgba(120, 120, 128, 0.14));
  border-color: var(--v2-border-border-strong, rgba(120, 120, 128, 0.45));
  color: var(--v2-text-text-base, currentColor);
}
.oc-long-toggle:active {
  transform: scale(0.97);
}
.oc-long-toggle:focus-visible {
  outline: 2px solid var(--v2-border-border-focus, #3b82f6);
  outline-offset: 1px;
}
.oc-long-toggle-icon {
  display: inline-block;
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  transform-origin: center;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.oc-long-toggle[aria-expanded="true"] .oc-long-toggle-icon {
  transform: rotate(180deg);
}
.oc-long-hint {
  padding: 4px 12px 8px;
  color: var(--v2-text-text-muted, #71717a);
  font: inherit;
  font-size: 12px;
}
.oc-long-hint[hidden] { display: none; }
[data-component="composer-editor"] [data-oc-text-card] {
  display: inline-grid;
  grid-template-columns: 30px minmax(0, 1fr);
  column-gap: 9px;
  align-items: center;
  vertical-align: middle;
  box-sizing: border-box;
  max-width: min(320px, 100%);
  margin: 0 4px 4px 0;
  padding: 9px 12px;
  border: 1px solid var(--v2-border-border-base, #d4d4d8);
  border-radius: 9px;
  background: var(--v2-background-bg-layer-02, #f4f4f5);
  color: var(--v2-text-text-base, #27272a);
  font: inherit;
  font-weight: 500;
  line-height: 19px;
  white-space: nowrap;
  cursor: pointer;
}
[data-component="composer-editor"] [data-oc-text-card]::before {
  content: "TXT";
  grid-column: 1;
  grid-row: 1 / 3;
  display: grid;
  place-items: center;
  width: 30px;
  height: 34px;
  border-radius: 4px;
  border: 1px solid var(--v2-border-border-base, #d4d4d8);
  background: var(--v2-background-bg-base, #fafafa);
  color: var(--v2-text-text-muted, #52525b);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
[data-component="composer-editor"] [data-oc-text-card]::after {
  content: attr(data-oc-text-summary);
  grid-column: 2;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--v2-text-text-muted, #52525b);
  font-size: 11px;
  font-weight: 400;
  line-height: 16px;
}
[data-component="composer-editor"] [data-oc-text-card]:hover {
  border-color: var(--v2-border-border-strong, #a1a1aa);
  background: var(--v2-overlay-simple-overlay-hover, #e4e4e7);
}
[data-component="composer-editor"] [data-oc-text-card]:focus-visible {
  outline: 2px solid var(--v2-border-border-focus, #3b82f6);
  outline-offset: 2px;
}
dialog.oc-long-dialog {
  box-sizing: border-box;
  position: fixed;
  inset: 0;
  width: min(860px, calc(100vw - 32px));
  max-width: none;
  height: min(680px, calc(100dvh - 48px));
  max-height: none;
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--v2-border-border-base, #d4d4d8);
  border-radius: 12px;
  background: var(--v2-background-bg-base, #fafafa);
  color: var(--v2-text-text-base, #27272a);
  font-family: inherit;
  box-shadow: var(--v2-elevation-raised, 0 16px 48px rgba(24, 24, 27, 0.18));
}
dialog.oc-long-dialog[open] { display: flex; flex-direction: column; }
.oc-long-dialog::backdrop { background: rgba(24, 24, 27, 0.4); }
.oc-long-dialog-header, .oc-long-dialog-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  flex-shrink: 0;
}
.oc-long-dialog-header { border-bottom: 1px solid var(--v2-border-border-base, #d4d4d8); }
.oc-long-dialog-header h2 { margin: 0; font-size: 14px; font-weight: 600; }
.oc-long-dialog-stats { color: var(--v2-text-text-muted, #52525b); font-size: 12px; }
.oc-long-dialog-editor {
  box-sizing: border-box;
  display: block;
  flex: 1;
  min-height: 0;
  width: 100%;
  padding: 16px 18px;
  resize: none;
  border: 0;
  border-radius: 0;
  outline: none;
  background: transparent;
  color: inherit;
  font-family: var(--v2-font-family-mono, ui-monospace, monospace);
  font-size: 13px;
  line-height: 1.6;
  tab-size: 2;
}
.oc-long-dialog-editor:focus-visible { box-shadow: inset 0 0 0 2px var(--v2-border-border-focus, #3b82f6); }
.oc-long-dialog-footer { border-top: 1px solid var(--v2-border-border-base, #d4d4d8); flex-wrap: wrap; }
.oc-long-dialog-footer > span { flex: 1; min-width: 140px; font-size: 12px; color: var(--v2-text-text-muted, #52525b); }
.oc-long-dialog-footer button {
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid var(--v2-border-border-base, #d4d4d8);
  border-radius: 6px;
  background: var(--v2-background-bg-layer-02, #f4f4f5);
  color: var(--v2-text-text-base, #27272a);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.oc-long-dialog-footer button:hover { border-color: var(--v2-border-border-strong, #a1a1aa); }
.oc-long-dialog-footer button:focus-visible { outline: 2px solid var(--v2-border-border-focus, #3b82f6); outline-offset: 2px; }
.oc-long-dialog-footer .oc-long-dialog-save {
  background: var(--v2-background-bg-inverse, #27272a);
  color: var(--v2-text-text-inverse, #fafafa);
  border-color: transparent;
}
@media (max-width: 480px) {
  .oc-long-dialog-header, .oc-long-dialog-footer { padding: 12px; }
  .oc-long-dialog-stats { margin-inline-start: auto; }
  .oc-long-dialog-footer > span { flex-basis: 100%; }
}
`;

export function initLongText() {
  if (typeof window === "undefined" || window.__ocLongTextMounted) return;
  window.__ocLongTextMounted = true;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  const states = new Map();
  const entries = new Map();
  const chips = new WeakMap();
  let nextID = 0;
  let scheduled = false;
  const refreshLayout = () => {
    window.__oc_virtual_scroll?.be?.();
    window.__oc_virtual_scroll?.M?._willUpdate?.();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    // A short timer also works when Electron throttles animation frames while
    // a native view owns focus; batch streaming mutations rather than polling.
    setTimeout(scan, 32);
  };
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);

  function scan() {
    scheduled = false;
    let changed = false;
    for (const [text, entry] of entries) {
      if (text.isConnected) continue;
      resize?.unobserve(text);
      entry.button?.remove();
      entries.delete(text);
    }
    for (const text of document.querySelectorAll(TEXT)) {
      const body = text.parentElement;
      if (!body?.matches('[data-slot="user-message-body"]')) continue;
      let entry = entries.get(text);
      if (!entry) {
        entry = {};
        entries.set(text, entry);
        resize?.observe(text);
      }
      const value = text.textContent ?? "";
      const messageID = text.closest('[data-component="user-message"]')?.getAttribute("data-timeline-part-id");
      const key = `${location.href}:${messageID ?? value}`;
      if (entry.key !== key || entry.value !== value) {
        entry.key = key;
        entry.value = value;
        entry.expanded = states.get(key) ?? false;
      }
      const css = getComputedStyle(text);
      const lineHeight = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.5;
      const padding = (parseFloat(css.paddingTop) || 0) + (parseFloat(css.paddingBottom) || 0);
      const height = Math.ceil(lineHeight * PREVIEW_LINES + padding);
      const collapsible = text.scrollHeight > height + 2;
      if (!collapsible) {
        if (entry.button) {
          entry.button.remove();
          entry.button = null;
          body.classList.remove("oc-long-body");
          text.style.removeProperty("max-height");
          text.removeAttribute("data-oc-long-collapsed");
          changed = true;
        }
        continue;
      }
      if (!entry.button) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "oc-long-toggle";
        const label = document.createElement("span");
        label.className = "oc-long-toggle-label";
        label.textContent = "显示更多";
        const icon = createToggleIcon();
        button.append(label, icon);
        text.id ||= `oc-long-text-${++nextID}`;
        button.setAttribute("aria-controls", text.id);
        button.addEventListener("click", () => {
          const before = body.getBoundingClientRect().top;
          entry.expanded = !entry.expanded;
          states.delete(entry.key);
          states.set(entry.key, entry.expanded);
          if (states.size > 500) states.delete(states.keys().next().value);
          scan();
          // On collapse, keep the beginning of this message in view, rather than
          // leaving the reader at a now-removed position far below it.
          if (!entry.expanded && before < 0) body.scrollIntoView({ block: "start", behavior: "instant" });
        });
        body.append(button);
        body.classList.add("oc-long-body");
        entry.button = button;
        entry.label = label;
        changed = true;
      }
      const expanded = String(entry.expanded);
      const maxHeight = entry.expanded ? "none" : `${height}px`;
      if (text.style.maxHeight !== maxHeight) { text.style.maxHeight = maxHeight; changed = true; }
      if (text.hasAttribute("data-oc-long-collapsed") === entry.expanded) {
        text.toggleAttribute("data-oc-long-collapsed", !entry.expanded);
      }
      if (entry.button.getAttribute("aria-expanded") !== expanded) {
        entry.button.setAttribute("aria-expanded", expanded);
        const label = entry.label || entry.button.querySelector(".oc-long-toggle-label");
        if (label) label.textContent = entry.expanded ? "收起" : "显示更多";
      }
    }
    for (const form of document.querySelectorAll(FORM)) updateComposer(form);
    if (changed) refreshLayout();
  }

  function updateComposer(form) {
    const editor = form.querySelector('[data-component="composer-editor"]');
    const controller = composerBindings.get(editor);
    const cards = controller?.parts().filter(isTextCard) ?? [];
    for (const chip of editor?.querySelectorAll('[data-mention="file"]') ?? []) {
      const card = cards.find(card => card.path === chip.dataset.path);
      if (!card || chips.get(chip) === card.url) continue;
      try {
        const summary = `${cardSummary(textCardContent(card))} · 点击编辑`;
        chip.setAttribute("data-oc-text-card", "");
        chip.setAttribute("data-oc-text-summary", summary);
        chip.setAttribute("role", "button");
        chip.setAttribute("tabindex", "0");
        chip.setAttribute("aria-label", `${card.filename}，${summary}`);
        chip.title = `${card.filename} · ${summary}`;
        chips.set(chip, card.url);
      } catch (error) { console.error("[mod-long-text] Cannot render text card", error); }
    }
    // innerText preserves BR/newline-only paragraphs in the native editor.
    const long = controller?.state.mode !== "shell" && !/^\s*\//.test(controller?.value() ?? "") && shouldAttachText(editor?.innerText ?? "");
    let hint = form.querySelector(".oc-long-hint");
    if (!long && !hint) return;
    if (!hint) {
      hint = document.createElement("div");
      hint.className = "oc-long-hint";
      hint.setAttribute("role", "status");
      hint.textContent = "长文本将在发送时自动转为 TXT 附件，完整内容不会截断。";
      form.append(hint);
    }
    if (hint.hidden === long) hint.hidden = !long;
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener("input", event => {
    const form = event.target.closest?.(FORM);
    if (form) updateComposer(form);
  });
  window.addEventListener("resize", schedule);
  scan();
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initLongText, { once: true });
  else initLongText();
}
