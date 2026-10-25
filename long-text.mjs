// Shared by the native prompt serializer and the renderer. No draft mutation or
// network interception: the regular prompt lifecycle owns delivery and retries.
export const FILE_CHAR_LIMIT = 8000;
export const FILE_LINE_LIMIT = 120;
export const PREVIEW_LINES = 12;

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
  if (!shouldAttachText(prompt?.text) || !serialized.text?.startsWith(prompt.text)) return serialized;
  const name = "pasted-text.txt";
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
`;

export function initLongText() {
  if (typeof window === "undefined" || window.__ocLongTextMounted) return;
  window.__ocLongTextMounted = true;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  const states = new Map();
  const entries = new Map();
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
    for (const form of document.querySelectorAll(FORM)) updateHint(form);
    if (changed) refreshLayout();
  }

  function updateHint(form) {
    const editor = form.querySelector('[data-component="composer-editor"]');
    // innerText preserves BR/newline-only paragraphs in the native editor.
    const long = shouldAttachText(editor?.innerText ?? "");
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
    if (form) updateHint(form);
  });
  window.addEventListener("resize", schedule);
  scan();
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initLongText, { once: true });
  else initLongText();
}
