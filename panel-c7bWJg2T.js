import {
  Fc as onChange,
  Fn as Tooltip,
  Jr as useExtension,
  Rn as IconButton,
  Tc as createMemo,
  Tn as ScrollView,
  gc as Show,
  gi as Icon,
  hc as Match,
  ic as memoBool,
  jn as Button,
  kc as createSignal,
  mi as showToast,
  rc as insert,
  uc as template,
  vc as Switch,
  xc as createComponent,
  pc as For,
  wc as createEffect,
  Ic as onCleanup,
} from "./main-CZyBNj5O.js";
import { t as Markdown } from "./markdown-6qY6YODw.js";
import { t as TextShimmer } from "./text-shimmer-BhDe6336.js";

// ============================================================================
// Styles: GPT-Style Hover Timeline Scrubber + Native OpenCode /btw Side Panel
// ============================================================================
const COMPANION_STYLE_ID = "oc-companion-v3-styles";

const COMPANION_CSS = `
/* --- Left GPT-Style Minimalist Tick Rail --- */
[data-slot="session-chat-panel"] {
  position: relative !important;
}

.oc-gpt-rail {
  position: absolute;
  left: 4px;
  top: 56px;
  bottom: 104px;
  width: 28px;
  z-index: 35;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  pointer-events: auto;
  user-select: none;
}

.oc-gpt-rail-track {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0px;
  max-height: 100%;
  overflow-y: auto;
  overflow-x: visible;
  scrollbar-width: none;
  padding: 8px 6px 8px 4px;
}

.oc-gpt-rail-track::-webkit-scrollbar {
  display: none;
}

.oc-gpt-tick-hit {
  display: flex;
  align-items: center;
  height: 10px;
  width: 24px;
  cursor: pointer;
  flex-shrink: 0;
}

.oc-gpt-tick-bar {
  height: 2px;
  width: 8px;
  border-radius: 999px;
  background: var(--v2-border-border-strong, rgba(120, 120, 128, 0.32));
  transition: width 0.14s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.14s ease, opacity 0.14s ease;
  pointer-events: none;
}

.oc-gpt-tick-hit.is-sub .oc-gpt-tick-bar {
  height: 1.5px;
  width: 5px;
  opacity: 0.7;
}

.oc-gpt-tick-hit.is-active .oc-gpt-tick-bar {
  width: 18px;
  height: 2px;
  background: var(--v2-text-text-base, #18181b);
  opacity: 1;
}

/* --- GPT-Style Hover Preview Card (Lazy-loaded only on hover) --- */
.oc-gpt-hover-card {
  position: fixed;
  z-index: 9990;
  width: 308px;
  border-radius: 14px;
  background: var(--v2-background-bg-base, var(--background-base, #ffffff));
  border: 1px solid var(--v2-border-border-base, rgba(0, 0, 0, 0.08));
  box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.12), 0 2px 8px -2px rgba(0, 0, 0, 0.06);
  padding: 12px 14px;
  color: var(--v2-text-text-base, #18181b);
  font-family: var(--font-family-sans, inherit);
  pointer-events: auto;
  animation: oc-gpt-card-in 0.12s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes oc-gpt-card-in {
  from { opacity: 0; transform: translateX(-4px) scale(0.98); }
  to { opacity: 1; transform: translateX(0) scale(1); }
}

.oc-gpt-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.oc-gpt-card-icon {
  width: 15px;
  height: 15px;
  color: var(--v2-text-text-muted, #71717a);
  flex-shrink: 0;
}

.oc-gpt-card-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--v2-text-text-base, #18181b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.35;
}

.oc-gpt-card-badge {
  font-size: 11px;
  color: var(--v2-text-text-faint, #a1a1aa);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.oc-gpt-card-body {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--v2-text-text-muted, #71717a);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  cursor: pointer;
}

.oc-gpt-card-headings {
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid var(--v2-border-border-base, rgba(128, 128, 128, 0.14));
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 150px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.oc-gpt-card-h-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--v2-text-text-muted, #71717a);
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  width: 100%;
  transition: background 0.12s, color 0.12s;
}

.oc-gpt-card-h-item:hover,
.oc-gpt-card-h-item.is-current {
  background: var(--v2-overlay-simple-overlay-hover, rgba(128, 128, 128, 0.1));
  color: var(--v2-text-text-base, #18181b);
}

.oc-gpt-card-h-dot {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.5;
  flex-shrink: 0;
}

.oc-gpt-card-h-text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes oc-target-highlight {
  0% { background-color: rgba(59, 130, 246, 0.12); }
  100% { background-color: transparent; }
}

.oc-scroll-flash {
  animation: oc-target-highlight 1.2s ease-out;
  border-radius: 8px;
}

/* --- Floating Text Selection Pill (Matches Native OpenCode Popover) --- */
.oc-selection-popover {
  position: fixed;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: var(--v2-background-bg-base, #ffffff);
  border: 1px solid var(--v2-border-border-base, rgba(0, 0, 0, 0.1));
  box-shadow: var(--v2-elevation-raised, 0 6px 20px -4px rgba(0, 0, 0, 0.15));
  transform: translate(-50%, -100%);
  margin-top: -8px;
  pointer-events: auto;
  animation: oc-pop-in 0.1s ease-out;
}

@keyframes oc-pop-in {
  from { opacity: 0; transform: translate(-50%, -92%) scale(0.96); }
  to { opacity: 1; transform: translate(-50%, -100%) scale(1); }
}

.oc-sel-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--v2-text-text-base, #18181b);
  font-size: 12px;
  font-weight: 450;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s;
}

.oc-sel-btn:hover {
  background: var(--v2-overlay-simple-overlay-hover, rgba(128, 128, 128, 0.1));
}

.oc-sel-kbd {
  font-size: 10.5px;
  color: var(--v2-text-text-faint, #a1a1aa);
}

.oc-sel-sep {
  width: 1px;
  height: 12px;
  background: var(--v2-border-border-base, rgba(128, 128, 128, 0.2));
}

/* --- Native-Styled /btw Side Panel --- */
.oc-btw-tabs-bar {
  display: flex;
  align-items: center;
  height: 42px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-weaker-base, var(--v2-border-border-weak, rgba(0, 0, 0, 0.07)));
  background: var(--v2-background-bg-base, #ffffff);
  flex-shrink: 0;
  min-width: 0;
  box-sizing: border-box;
}

.oc-btw-tabs-scroll {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  min-width: 0;
  max-width: 100%;
  padding: 4px 0;
}

.oc-btw-tabs-scroll::-webkit-scrollbar {
  display: none;
}

.oc-btw-tab-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  max-width: 200px;
  padding: 0 6px 0 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--v2-text-text-muted, #71717a);
  font-family: var(--v2-font-family-sans, Inter, sans-serif);
  font-size: 13px;
  font-weight: 440;
  line-height: 16px;
  letter-spacing: -0.04px;
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
  transition: background-color 0.12s ease, color 0.12s ease;
  box-sizing: border-box;
}

.oc-btw-tab-item:hover:not(.is-active) {
  background: var(--v2-overlay-simple-overlay-hover, rgba(128, 128, 128, 0.08));
  color: var(--v2-text-text-base, #18181b);
}

.oc-btw-tab-item.is-active {
  background: var(--v2-background-bg-layer-02, rgba(0, 0, 0, 0.06));
  color: var(--v2-text-text-base, #18181b);
  font-weight: 500;
}

.oc-btw-tab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: currentColor;
  opacity: 0.75;
}

.oc-btw-tab-item.is-active .oc-btw-tab-icon {
  opacity: 1;
}

.oc-btw-tab-title {
  min-width: 0;
  max-width: 136px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.oc-btw-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--v2-text-text-faint, #a1a1aa);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  margin-left: 1px;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.oc-btw-tab-close:hover {
  background: var(--v2-overlay-simple-overlay-hover, rgba(128, 128, 128, 0.14));
  color: var(--v2-text-text-base, #18181b);
}

.oc-btw-tab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--v2-icon-icon-muted, #71717a);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  margin-left: 2px;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.oc-btw-tab-add:hover {
  background: var(--v2-overlay-simple-overlay-hover, rgba(128, 128, 128, 0.1));
  color: var(--v2-text-text-base, #18181b);
}

/* --- Composer Dock & Input Box --- */
.oc-btw-composer-dock {
  width: 100%;
  flex-shrink: 0;
  background: var(--v2-background-bg-base, #ffffff);
  padding: 4px 12px 12px 12px;
  box-sizing: border-box;
}

.oc-btw-composer {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  border-radius: 12px;
  background: var(--v2-background-bg-base, #ffffff);
  box-shadow: var(--v2-elevation-raised, 0 2px 4px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.08), 0 0 0 0.5px rgba(0, 0, 0, 0.12));
  border: none;
  box-sizing: border-box;
}

[data-color-scheme="dark"] .oc-btw-composer {
  background: var(--v2-background-bg-layer-01, #1f1f23);
}

.oc-btw-quotes-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px 2px 12px;
  box-sizing: border-box;
}

.oc-btw-draft-quote {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  border-radius: 6px;
  background: var(--v2-background-bg-layer-02, rgba(128, 128, 128, 0.08));
  border: 1px solid var(--v2-border-border-base, rgba(128, 128, 128, 0.14));
  padding: 3px 8px;
  font-size: 12px;
  color: var(--v2-text-text-muted, #71717a);
  box-sizing: border-box;
}

.oc-btw-draft-quote-text {
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.oc-btw-draft-quote-rm {
  border: none;
  background: transparent;
  color: var(--v2-text-text-faint, #a1a1aa);
  cursor: pointer;
  padding: 0 2px;
  font-size: 13px;
  line-height: 1;
}

.oc-btw-draft-quote-rm:hover {
  color: var(--v2-text-text-base, #18181b);
}

.oc-btw-textarea {
  display: block;
  width: 100%;
  min-height: 54px;
  max-height: 144px;
  resize: none !important;
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
  background: transparent !important;
  padding: 12px 14px 6px 14px;
  font-size: 13px;
  font-weight: 440;
  line-height: 20px;
  color: var(--v2-text-text-base, #18181b);
  font-family: var(--v2-font-family-sans, var(--font-family-sans, inherit));
  box-sizing: border-box;
  user-select: text;
}

.oc-btw-textarea::placeholder {
  color: var(--v2-text-text-faint, #a1a1aa);
}

.oc-btw-controls-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 40px;
  padding: 0 10px 6px 8px;
  box-sizing: border-box;
}

.oc-btw-controls-left {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.oc-btw-controls-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

/* --- Upward Popover Menus (Never clip at screen bottom) --- */
.oc-btw-popover-up {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 300;
  border-radius: 10px;
  background: var(--v2-background-bg-base, #ffffff);
  border: 1px solid var(--v2-border-border-base, rgba(0, 0, 0, 0.08));
  box-shadow: var(--v2-elevation-floating, 0 10px 28px -4px rgba(0, 0, 0, 0.16), 0 0 0 0.5px rgba(0, 0, 0, 0.08));
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
}

.oc-btw-popover-model {
  width: 268px;
  max-width: calc(100vw - 32px);
  max-height: min(300px, 52vh);
  overflow: hidden;
}

.oc-btw-popover-ctx {
  width: 236px;
  max-width: calc(100vw - 32px);
}

.oc-btw-model-search {
  padding: 4px 6px 6px 6px;
  border-bottom: 1px solid var(--v2-border-border-base, rgba(128, 128, 128, 0.14));
  flex-shrink: 0;
}

.oc-btw-model-search-input {
  width: 100%;
  border: none !important;
  outline: none !important;
  background: transparent !important;
  font-size: 12.5px;
  line-height: 18px;
  color: var(--v2-text-text-base, #18181b);
  padding: 0;
}

.oc-btw-model-search-input::placeholder {
  color: var(--v2-text-text-faint, #a1a1aa);
}

.oc-btw-model-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  scrollbar-width: thin;
}

.oc-btw-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 4px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--v2-text-text-base, #18181b);
  font-size: 12.5px;
  font-weight: 440;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  flex-shrink: 0;
}

.oc-btw-menu-item:hover,
.oc-btw-menu-item.is-selected {
  background: var(--v2-overlay-simple-overlay-hover, rgba(128, 128, 128, 0.1));
}

.oc-btw-menu-group-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--v2-text-text-faint, #a1a1aa);
  padding: 6px 8px 2px;
  flex-shrink: 0;
}

.oc-btw-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 7px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--v2-text-text-muted, #71717a);
  font-size: 12.5px;
  font-weight: 440;
  cursor: pointer;
  max-width: 185px;
  transition: background 0.12s, color 0.12s;
  box-sizing: border-box;
}

.oc-btw-pill-btn:hover {
  background: var(--v2-overlay-simple-overlay-hover, rgba(128, 128, 128, 0.1));
  color: var(--v2-text-text-base, #18181b);
}

.oc-btw-pill-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.oc-btw-msg-quote {
  border-radius: 8px;
  background: var(--v2-background-bg-layer-02, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--v2-border-border-base, rgba(128, 128, 128, 0.14));
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--v2-text-text-muted, #71717a);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  max-width: 90%;
}

.oc-btw-asst {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.oc-btw-asst-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.oc-btw-asst:hover .oc-btw-asst-footer {
  opacity: 1;
}
`;

function ensureStyles() {
  if (typeof document === "undefined") return;
  let style = document.getElementById(COMPANION_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = COMPANION_STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== COMPANION_CSS) {
    style.textContent = COMPANION_CSS;
  }
}

// ============================================================================
// Persistent Store for /btw Multi-Turn Threads & Global Preferences
// ============================================================================
const PREFS_KEY = "oc.btw.v2.prefs";
const SESSION_PREFIX = "oc.btw.v2.session.";

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        modelKey: typeof parsed.modelKey === "string" ? parsed.modelKey : "",
        contextMode: ["none", "recent", "full"].includes(parsed.contextMode) ? parsed.contextMode : "none",
      };
    }
  } catch {}
  return {
    modelKey: "",
    contextMode: "none",
  };
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

const [globalPrefs, setGlobalPrefs] = createSignal(loadPrefs());

function updatePrefs(patch) {
  const next = { ...globalPrefs(), ...patch };
  setGlobalPrefs(next);
  savePrefs(next);
}

const sessionStoreMap = new Map();
const activeAbortControllers = new Map();

function createDefaultThread() {
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    quotes: [],
    messages: [],
  };
}

function getSessionBtwStore(sessionID, legacyChatsAccessor) {
  if (!sessionID) {
    const [dummy, setDummy] = createSignal({ activeThreadId: "default", threads: [createDefaultThread()] });
    return { state: dummy, setState: setDummy };
  }
  if (sessionStoreMap.has(sessionID)) {
    return sessionStoreMap.get(sessionID);
  }
  let initial = null;
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + sessionID);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.threads) && parsed.threads.length > 0) {
        initial = parsed;
      }
    }
  } catch {}

  if (!initial) {
    const migratedThreads = [];
    try {
      const legacy = legacyChatsAccessor?.()?.value?.chats;
      if (Array.isArray(legacy) && legacy.length > 0) {
        for (const item of legacy) {
          if (!item?.question) continue;
          const msgs = [
            {
              id: crypto.randomUUID(),
              role: "user",
              text: item.question,
              quotes: [],
              createdAt: Date.now(),
            },
          ];
          if (item.answer) {
            msgs.push({
              id: crypto.randomUUID(),
              role: "assistant",
              text: item.answer,
              createdAt: Date.now(),
            });
          }
          migratedThreads.push({
            id: item.id || crypto.randomUUID(),
            title: item.question.slice(0, 24),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            quotes: [],
            messages: msgs,
          });
        }
      }
    } catch {}
    const threads = migratedThreads.length > 0 ? migratedThreads : [createDefaultThread()];
    initial = {
      activeThreadId: threads[threads.length - 1].id,
      threads,
    };
  }

  const [state, rawSetState] = createSignal(initial);
  const setState = (updater) => {
    const next = typeof updater === "function" ? updater(state()) : updater;
    rawSetState(next);
    try {
      localStorage.setItem(SESSION_PREFIX + sessionID, JSON.stringify(next));
    } catch {}
  };

  const entry = { state, setState };
  sessionStoreMap.set(sessionID, entry);
  return entry;
}

// ============================================================================
// Helper: Clean Text & Main Session Messages
// ============================================================================
function cleanUserText(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<conversation-checkpoint>[\s\S]*?<\/conversation-checkpoint>/gi, "")
    .trim();
}

function getMainSessionMessages(session) {
  try {
    if (!session?.id || !session?.server?.data?.session?.message?.list) return [];
    return session.server.data.session.message.list(session.id) || [];
  } catch {
    return [];
  }
}

function buildMainSessionContextSnippet(session, mode) {
  if (mode === "none") return "";
  const all = getMainSessionMessages(session);
  if (!all.length) return "";
  const turns = [];
  for (const m of all) {
    if (m.type === "user") {
      const txt = cleanUserText(m.text);
      if (txt) turns.push({ role: "User", text: txt });
    } else if (m.type === "assistant" && Array.isArray(m.content)) {
      const parts = m.content
        .filter((p) => p?.type === "text" && p.text?.trim())
        .map((p) => p.text.trim())
        .join("\n\n");
      if (parts) turns.push({ role: "Assistant", text: parts });
    }
  }
  if (!turns.length) return "";
  const selected = mode === "recent" ? turns.slice(-6) : turns.slice(-30);
  const formatted = selected
    .map((t) => {
      const limit = mode === "recent" ? 1800 : 3000;
      const body = t.text.length > limit ? t.text.slice(0, limit) + "\n...[已截断]" : t.text;
      return `[主会话 ${t.role}]:\n${body}`;
    })
    .join("\n\n---\n\n");
  return `<main_session_context mode="${mode}">\n以下是当前主会话的上下文供参考：\n\n${formatted}\n</main_session_context>`;
}

function resolveSessionDefaultModel(session) {
  try {
    const info = session?.id ? session.server?.data?.session?.get?.(session.id) : undefined;
    if (info?.model?.providerID && info?.model?.id) {
      return { providerID: info.model.providerID, id: info.model.id };
    }
    const msgs = getMainSessionMessages(session);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m?.type === "assistant" && m?.model?.providerID && m?.model?.id) {
        return { providerID: m.model.providerID, id: m.model.id };
      }
    }
    const loc = session?.directory ? { directory: session.directory } : undefined;
    const models = session?.server?.data?.location?.model?.list?.(loc) || [];
    const active = models.find((m) => m.enabled !== false && m.status !== "deprecated");
    if (active) return { providerID: active.providerID, id: active.id };
  } catch {}
  return undefined;
}

function resolveSelectedModel(session, modelKey) {
  if (modelKey && modelKey.includes("/")) {
    const idx = modelKey.indexOf("/");
    return {
      providerID: modelKey.slice(0, idx),
      id: modelKey.slice(idx + 1),
    };
  }
  return resolveSessionDefaultModel(session);
}

// ============================================================================
// Core /btw Multi-Turn Generation Logic
// ============================================================================
const SYSTEM_INSTRUCTION = [
  "你是 OpenCode 桌面端右侧的「/btw 随时问答助手」。",
  "请直接、简洁、准确地使用 Markdown 回答用户的问题。",
  "如果用户附带了引用内容，请重点结合引用内容进行解答。",
  "不要调用任何工具，也不要试图修改工作区文件。",
].join(" ");

async function sendBtwMessage({ session, threadId, text, quotes, legacyChatsAccessor }) {
  if (!session?.id) return;
  const trimmed = (text || "").trim();
  const store = getSessionBtwStore(session.id, legacyChatsAccessor);
  const current = store.state();
  const thread = current.threads.find((t) => t.id === (threadId || current.activeThreadId)) || current.threads[0];
  if (!thread) return;

  const attachedQuotes = quotes ?? thread.quotes ?? [];
  if (!trimmed && attachedQuotes.length === 0) return;

  const finalUserText = trimmed || "请解释这段引用内容。";
  const prefs = globalPrefs();
  const resolvedModel = resolveSelectedModel(session, prefs.modelKey);
  const modelLabel = resolvedModel ? resolvedModel.id : "默认模型";
  const contextMode = prefs.contextMode || "none";

  const userMsg = {
    id: crypto.randomUUID(),
    role: "user",
    text: finalUserText,
    quotes: attachedQuotes,
    createdAt: Date.now(),
  };

  const assistantMsgId = crypto.randomUUID();
  const assistantMsg = {
    id: assistantMsgId,
    role: "assistant",
    text: "",
    modelLabel,
    contextMode,
    pending: true,
    createdAt: Date.now(),
  };

  const priorHistory = thread.messages
    .filter((m) => !m.pending && !m.error && m.text)
    .slice(-14)
    .map((m) => {
      if (m.role === "user") {
        const qText =
          Array.isArray(m.quotes) && m.quotes.length > 0
            ? m.quotes.map((q, idx) => `> [引用 ${idx + 1}]: ${q.text.replace(/\n/g, "\n> ")}`).join("\n\n") + "\n\n"
            : "";
        return `### 用户:\n${qText}${m.text}`;
      }
      return `### 助手:\n${m.text}`;
    })
    .join("\n\n");

  const currentQuotesBlock =
    attachedQuotes.length > 0
      ? attachedQuotes
          .map((q, idx) => `<quoted_selection index="${idx + 1}">\n${q.text}\n</quoted_selection>`)
          .join("\n\n") + "\n\n"
      : "";

  const mainContextBlock = buildMainSessionContextSnippet(session, contextMode);

  const promptParts = [SYSTEM_INSTRUCTION];
  if (mainContextBlock) promptParts.push(mainContextBlock);
  if (priorHistory) {
    promptParts.push(`<btw_conversation_history>\n${priorHistory}\n</btw_conversation_history>`);
  }
  promptParts.push(`${currentQuotesBlock}用户问题：\n${finalUserText}`);
  const assembledPrompt = promptParts.join("\n\n");

  const isFirstMessage = thread.messages.length === 0;
  const nextTitle = isFirstMessage ? finalUserText.replace(/\s+/g, " ").slice(0, 22) : thread.title;

  store.setState((prev) => ({
    ...prev,
    activeThreadId: thread.id,
    threads: prev.threads.map((t) =>
      t.id === thread.id
        ? {
            ...t,
            title: nextTitle,
            updatedAt: Date.now(),
            quotes: [],
            messages: [...t.messages, userMsg, assistantMsg],
          }
        : t
    ),
  }));

  const abortKey = `${session.id}:${thread.id}`;
  activeAbortControllers.get(abortKey)?.abort();
  const controller = new AbortController();
  activeAbortControllers.set(abortKey, controller);

  try {
    let answerText = "";
    const client = session.server?.client;
    const directory = session.location?.directory || session.directory;
    const reqOptions = {
      signal: controller.signal,
      headers: directory ? { "x-opencode-directory": encodeURIComponent(directory) } : undefined,
    };

    if (contextMode === "full" && !prefs.modelKey && client?.session?.generate) {
      const res = await client.session.generate(
        {
          sessionID: session.id,
          prompt: [
            SYSTEM_INSTRUCTION,
            priorHistory ? `前序对话：\n${priorHistory}` : "",
            `${currentQuotesBlock}问题：${finalUserText}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
        { signal: controller.signal }
      );
      answerText = res?.text || "";
    } else if (client?.generate?.text && resolvedModel) {
      try {
        const res = await client.generate.text(
          {
            prompt: assembledPrompt,
            model: resolvedModel,
          },
          reqOptions
        );
        answerText = res?.text || "";
      } catch (genErr) {
        if (controller.signal.aborted) throw genErr;
        const resFallback = await client.session.generate(
          {
            sessionID: session.id,
            prompt: assembledPrompt,
          },
          { signal: controller.signal }
        );
        answerText = resFallback?.text || "";
      }
    } else if (client?.session?.generate) {
      const res = await client.session.generate(
        {
          sessionID: session.id,
          prompt: assembledPrompt,
        },
        { signal: controller.signal }
      );
      answerText = res?.text || "";
    } else {
      throw new Error("未连接到生成服务");
    }

    if (controller.signal.aborted) return;

    store.setState((prev) => ({
      ...prev,
      threads: prev.threads.map((t) =>
        t.id === thread.id
          ? {
              ...t,
              updatedAt: Date.now(),
              messages: t.messages.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, text: (answerText || "").trim() || "_（无返回内容）_", pending: false, error: undefined }
                  : m
              ),
            }
          : t
      ),
    }));
  } catch (err) {
    if (controller.signal.aborted) {
      store.setState((prev) => ({
        ...prev,
        threads: prev.threads.map((t) =>
          t.id === thread.id
            ? {
                ...t,
                messages: t.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, text: m.text || "_（已停止）_", pending: false } : m
                ),
              }
            : t
        ),
      }));
      return;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    store.setState((prev) => ({
      ...prev,
      threads: prev.threads.map((t) =>
        t.id === thread.id
          ? {
              ...t,
              messages: t.messages.map((m) =>
                m.id === assistantMsgId ? { ...m, text: "", pending: false, error: errMsg || "请求失败" } : m
              ),
            }
          : t
      ),
    }));
  } finally {
    if (activeAbortControllers.get(abortKey) === controller) {
      activeAbortControllers.delete(abortKey);
    }
  }
}

function addQuoteToSession(session, quoteText) {
  if (!session?.id || !quoteText?.trim()) return;
  const store = getSessionBtwStore(session.id);
  const current = store.state();
  const activeId = current.activeThreadId || current.threads[0]?.id;
  const quoteItem = {
    id: crypto.randomUUID(),
    text: quoteText.trim(),
  };
  store.setState((prev) => ({
    ...prev,
    threads: prev.threads.map((t) =>
      t.id === activeId ? { ...t, quotes: [...(t.quotes || []), quoteItem] } : t
    ),
  }));
}

// ============================================================================
// Upgraded /btw Panel Component (100% Native OpenCode Styling)
// ============================================================================
let focusInputCallback = null;

function BtwPanel(props) {
  ensureStyles();
  const ext = useExtension();
  const system = ext.system;

  const sessionMemo = createMemo(() => props.session);
  const storeMemo = createMemo(() => {
    const s = sessionMemo();
    return getSessionBtwStore(s?.id, () => props.btw?.saved?.(s));
  });

  const sessionState = createMemo(() => storeMemo().state());
  const threads = createMemo(() => sessionState().threads || []);
  const activeThread = createMemo(() => {
    const list = threads();
    const activeId = sessionState().activeThreadId;
    return list.find((t) => t.id === activeId) || list[0] || createDefaultThread();
  });

  const activeMessages = createMemo(() => activeThread()?.messages || []);
  const draftQuotes = createMemo(() => activeThread()?.quotes || []);
  const isThreadGenerating = createMemo(() => activeMessages().some((m) => m.pending));

  const [inputValue, setInputValue] = createSignal("");
  const [copiedId, setCopiedId] = createSignal("");
  const [fetchedModels, setFetchedModels] = createSignal([]);
  const [openMenu, setOpenMenu] = createSignal(""); // "" | "thread" | "model" | "context"
  const [modelFilter, setModelFilter] = createSignal("");

  createEffect(() => {
    const s = sessionMemo();
    if (!s?.server?.client?.model?.list) return;
    const loc = s.location?.directory
      ? { directory: s.location.directory }
      : s.directory
      ? { directory: s.directory }
      : undefined;
    s.server.client.model
      .list({ location: loc })
      .then((res) => {
        if (Array.isArray(res?.data)) setFetchedModels(res.data);
      })
      .catch(() => {});
  });

  const availableModels = createMemo(() => {
    const s = sessionMemo();
    const loc = s?.directory ? { directory: s.directory } : undefined;
    const fromData = s?.server?.data?.location?.model?.list?.(loc) || [];
    const raw = fromData.length > 0 ? fromData : fetchedModels();
    return raw.filter((m) => m && m.enabled !== false && m.status !== "deprecated");
  });

  const sessionDefaultModel = createMemo(() => resolveSessionDefaultModel(sessionMemo()));

  // Root panel container (matches original panel-c7bWJg2T.js classes)
  const root = document.createElement("div");
  root.className = "relative flex h-full min-h-0 flex-col bg-v2-background-bg-base select-none";
  root.setAttribute("data-slot", "session-btw-panel");

  // Close popovers when clicking outside
  const onDocMouseDown = (e) => {
    if (!openMenu()) return;
    if (!root.contains(e.target) || !e.target.closest("[data-btw-menu-zone]")) {
      setOpenMenu("");
    }
  };
  document.addEventListener("mousedown", onDocMouseDown);
  onCleanup(() => document.removeEventListener("mousedown", onDocMouseDown));

  // --- 1. Native Tab-Strip Header Bar (Matches Image 2: [💬 Title ×] [💬 Title ×] +) ---
  const headerBar = document.createElement("div");
  headerBar.className = "oc-btw-tabs-bar";

  const tabsScroll = document.createElement("div");
  tabsScroll.className = "oc-btw-tabs-scroll";
  tabsScroll.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        tabsScroll.scrollLeft += e.deltaY > 0 ? 48 : -48;
        e.preventDefault();
      }
    },
    { passive: false }
  );

  const closeThreadById = (targetId) => {
    const s = sessionMemo();
    if (s?.id && targetId) {
      activeAbortControllers.get(`${s.id}:${targetId}`)?.abort();
    }
    storeMemo().setState((prev) => {
      const idx = prev.threads.findIndex((t) => t.id === targetId);
      const remaining = prev.threads.filter((t) => t.id !== targetId);
      const nextThreads = remaining.length > 0 ? remaining : [createDefaultThread()];
      let nextActiveId = prev.activeThreadId;
      if (prev.activeThreadId === targetId || !nextThreads.some((t) => t.id === nextActiveId)) {
        const pickIdx = Math.min(Math.max(0, idx), nextThreads.length - 1);
        nextActiveId = nextThreads[pickIdx].id;
      }
      return {
        ...prev,
        activeThreadId: nextActiveId,
        threads: nextThreads,
      };
    });
  };

  insert(
    tabsScroll,
    createComponent(For, {
      get each() {
        return threads();
      },
      children: (t) => {
        const tabEl = document.createElement("div");
        tabEl.setAttribute("role", "tab");
        createEffect(() => {
          const isActive = activeThread()?.id === t.id;
          tabEl.className = `oc-btw-tab-item ${isActive ? "is-active" : ""}`;
          tabEl.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        const iconWrap = document.createElement("span");
        iconWrap.className = "oc-btw-tab-icon";
        insert(iconWrap, createComponent(Icon, { name: "bubble-5", size: "small" }), null);

        const titleSpan = document.createElement("span");
        titleSpan.className = "oc-btw-tab-title";
        insert(
          titleSpan,
          () => {
            const latest = threads().find((item) => item.id === t.id);
            return latest?.title || t.title || "新对话";
          },
          null
        );

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "oc-btw-tab-close";
        closeBtn.title = "关闭此对话";
        closeBtn.setAttribute("aria-label", "关闭此对话");
        insert(closeBtn, createComponent(Icon, { name: "outline-xmark", size: "small" }), null);
        closeBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeThreadById(t.id);
        });

        tabEl.addEventListener("click", () => {
          storeMemo().setState((prev) => ({ ...prev, activeThreadId: t.id }));
        });
        tabEl.addEventListener("auxclick", (e) => {
          if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            closeThreadById(t.id);
          }
        });

        tabEl.append(iconWrap, titleSpan, closeBtn);
        return tabEl;
      },
    }),
    null
  );

  // "+" button immediately next to the last tab (matches Image 2)
  const addTabBtn = document.createElement("button");
  addTabBtn.type = "button";
  addTabBtn.className = "oc-btw-tab-add";
  addTabBtn.title = "新建对话";
  addTabBtn.setAttribute("aria-label", "新建对话");
  insert(addTabBtn, createComponent(Icon, { name: "plus", size: "small" }), null);
  addTabBtn.addEventListener("click", () => {
    const nt = createDefaultThread();
    storeMemo().setState((prev) => ({
      ...prev,
      activeThreadId: nt.id,
      threads: [...prev.threads, nt],
    }));
    setOpenMenu("");
    requestAnimationFrame(() => {
      tabsScroll.scrollTo({ left: tabsScroll.scrollWidth, behavior: "smooth" });
      textarea.focus();
    });
  });

  tabsScroll.appendChild(addTabBtn);
  headerBar.appendChild(tabsScroll);

  // --- 2. Messages Area (Native OpenCode Message Layout) ---
  const messagesScroll = document.createElement("div");
  messagesScroll.className = "flex-1 min-h-0 overflow-y-auto px-4 py-4 select-text flex flex-col gap-5";
  messagesScroll.style.scrollbarWidth = "thin";

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      messagesScroll.scrollTop = messagesScroll.scrollHeight;
    });
  };

  createEffect(() => {
    if (activeMessages().length > 0) scrollToBottom();
  });

  // Minimalist Empty State (matches original panel-c7bWJg2T.js)
  insert(
    messagesScroll,
    createComponent(Show, {
      get when() {
        return activeMessages().length === 0;
      },
      get children() {
        const empty = document.createElement("div");
        empty.className = "flex h-full flex-col items-center justify-center gap-1.5 px-6 pb-12 text-center select-none";
        const line1 = document.createElement("div");
        line1.className = "text-13-regular text-v2-text-text-muted";
        line1.textContent = "随时提问，独立于主会话流";
        const line2 = document.createElement("div");
        line2.className = "text-[12px] text-v2-text-text-faint";
        line2.textContent = "在左侧选中文字可引用 (Alt+Q)，关闭面板不会丢失记录";
        empty.append(line1, line2);
        return empty;
      },
    }),
    null
  );

  // Conversation turns
  insert(
    messagesScroll,
    createComponent(For, {
      get each() {
        return activeMessages();
      },
      children: (msg) => {
        if (msg.role === "user") {
          const userWrap = document.createElement("div");
          userWrap.setAttribute("data-component", "user-message");
          userWrap.className = "flex flex-col items-end gap-1.5 w-full";

          if (Array.isArray(msg.quotes) && msg.quotes.length > 0) {
            const qContainer = document.createElement("div");
            qContainer.className = "flex flex-col items-end gap-1 w-full";
            for (const q of msg.quotes) {
              const qBox = document.createElement("div");
              qBox.className = "oc-btw-msg-quote";
              qBox.textContent = q.text;
              qBox.title = q.text;
              qContainer.appendChild(qBox);
            }
            userWrap.appendChild(qContainer);
          }

          const body = document.createElement("div");
          body.setAttribute("data-slot", "user-message-body");
          const bubble = document.createElement("div");
          bubble.setAttribute("data-slot", "user-message-text");
          bubble.setAttribute("dir", "auto");
          bubble.textContent = msg.text;
          body.appendChild(bubble);
          userWrap.appendChild(body);
          return userWrap;
        }

        // Assistant response (clean borderless Markdown like main chat)
        const asstWrap = document.createElement("div");
        asstWrap.className = "oc-btw-asst";

        if (msg.pending) {
          const working = document.createElement("div");
          working.className = "flex h-7 items-center text-[13px] font-[530] leading-text-compact";
          insert(
            working,
            createComponent(TextShimmer, {
              get text() {
                return ext.t("session.timeline.working") || "Thinking…";
              },
              active: true,
            }),
            null
          );
          asstWrap.appendChild(working);
          return asstWrap;
        }

        if (msg.error) {
          const errRow = document.createElement("div");
          errRow.className = "flex items-center justify-between gap-2 rounded-lg bg-v2-background-bg-layer-02 px-3 py-2 text-[13px] text-v2-text-text-muted";
          const errText = document.createElement("span");
          errText.className = "truncate";
          errText.textContent = msg.error;
          errRow.appendChild(errText);
          insert(
            errRow,
            createComponent(Button, {
              size: "small",
              variant: "outline",
              onClick: () => retryAssistantMessage(msg.id),
              get children() {
                return ext.t("retry") || "重试";
              },
            }),
            null
          );
          asstWrap.appendChild(errRow);
          return asstWrap;
        }

        const mdContainer = document.createElement("div");
        mdContainer.className = "min-w-0";
        insert(
          mdContainer,
          createComponent(Markdown, {
            get text() {
              return msg.text || "";
            },
            class: "text-14-regular",
          }),
          null
        );

        const footerBar = document.createElement("div");
        footerBar.className = "oc-btw-asst-footer";

        const metaSpan = document.createElement("span");
        metaSpan.className = "text-[11px] text-v2-text-text-faint truncate select-none";
        metaSpan.textContent = msg.modelLabel || "";

        const btnGroup = document.createElement("div");
        btnGroup.className = "flex items-center gap-1";

        insert(
          btnGroup,
          createComponent(Tooltip, {
            get value() {
              return copiedId() === msg.id ? ext.t("common.copied") || "已复制" : ext.t("copy") || "复制";
            },
            get children() {
              return createComponent(IconButton, {
                size: "small",
                variant: "ghost-muted",
                get icon() {
                  return createComponent(Icon, {
                    get name() {
                      return copiedId() === msg.id ? "check" : "outline-copy";
                    },
                  });
                },
                onClick: () => {
                  if (!msg.text) return;
                  system
                    .copy(msg.text)
                    .then(() => {
                      setCopiedId(msg.id);
                      setTimeout(() => {
                        if (copiedId() === msg.id) setCopiedId("");
                      }, 1800);
                    })
                    .catch(() => showToast({ title: ext.t("common.requestFailed") }));
                },
              });
            },
          }),
          null
        );

        footerBar.append(metaSpan, btnGroup);
        asstWrap.append(mdContainer, footerBar);
        return asstWrap;
      },
    }),
    null
  );

  function retryAssistantMessage(assistantMsgId) {
    const s = sessionMemo();
    const curT = activeThread();
    if (!s?.id || !curT) return;
    const idx = curT.messages.findIndex((m) => m.id === assistantMsgId);
    if (idx <= 0) return;
    const prevUser = curT.messages[idx - 1];
    if (prevUser?.role !== "user") return;
    storeMemo().setState((prev) => ({
      ...prev,
      threads: prev.threads.map((t) =>
        t.id === curT.id ? { ...t, messages: t.messages.slice(0, idx - 1) } : t
      ),
    }));
    sendBtwMessage({
      session: s,
      threadId: curT.id,
      text: prevUser.text,
      quotes: prevUser.quotes || [],
    });
  }

  // --- 3. Bottom Composer Dock (Identical to OpenCode Native Composer Dock) ---
  const composerDock = document.createElement("div");
  composerDock.className = "oc-btw-composer-dock";

  const composerForm = document.createElement("form");
  composerForm.setAttribute("data-component", "composer");
  composerForm.className = "group/composer oc-btw-composer";
  composerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    handleSendOrStop();
  });

  // 3a. Attached Quotes inside top of Composer Card
  const quotesRow = document.createElement("div");
  quotesRow.className = "oc-btw-quotes-row";
  createEffect(() => {
    const quotes = draftQuotes();
    quotesRow.style.display = quotes.length > 0 ? "flex" : "none";
    quotesRow.innerHTML = "";
    for (const q of quotes) {
      const pill = document.createElement("div");
      pill.className = "oc-btw-draft-quote";
      const textSpan = document.createElement("span");
      textSpan.className = "oc-btw-draft-quote-text";
      textSpan.textContent = q.text.replace(/\s+/g, " ");
      textSpan.title = q.text;

      const rmBtn = document.createElement("button");
      rmBtn.type = "button";
      rmBtn.className = "oc-btw-draft-quote-rm";
      rmBtn.textContent = "×";
      rmBtn.addEventListener("click", () => {
        const curT = activeThread();
        storeMemo().setState((prev) => ({
          ...prev,
          threads: prev.threads.map((t) =>
            t.id === curT.id ? { ...t, quotes: (t.quotes || []).filter((i) => i.id !== q.id) } : t
          ),
        }));
      });

      pill.append(textSpan, rmBtn);
      quotesRow.appendChild(pill);
    }
  });

  // 3b. Textarea Editor (No browser border, no resize grip)
  const textarea = document.createElement("textarea");
  textarea.rows = 2;
  textarea.placeholder = "随便问点什么，选中左侧文字可引用…";
  textarea.className = "oc-btw-textarea";

  const resizeTextarea = () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(144, Math.max(54, textarea.scrollHeight)) + "px";
  };

  textarea.addEventListener("input", () => {
    setInputValue(textarea.value);
    resizeTextarea();
  });

  function handleSendOrStop() {
    const s = sessionMemo();
    const curT = activeThread();
    if (!s?.id || !curT) return;

    if (isThreadGenerating()) {
      activeAbortControllers.get(`${s.id}:${curT.id}`)?.abort();
      return;
    }

    const txt = textarea.value.trim();
    const qList = draftQuotes();
    if (!txt && qList.length === 0) return;

    textarea.value = "";
    setInputValue("");
    resizeTextarea();

    sendBtwMessage({
      session: s,
      threadId: curT.id,
      text: txt,
      quotes: qList,
      legacyChatsAccessor: () => props.btw?.saved?.(s),
    });
  }

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!isThreadGenerating()) handleSendOrStop();
    }
  });

  // Helper to clamp upward popovers horizontally within the side panel / viewport
  const clampUpwardMenuHorizontal = (menuEl) => {
    menuEl.style.left = "0px";
    requestAnimationFrame(() => {
      if (!menuEl.isConnected) return;
      const menuRect = menuEl.getBoundingClientRect();
      const panelRect = root.getBoundingClientRect();
      const rightBound = Math.min(window.innerWidth - 8, panelRect.right - 8);
      if (menuRect.right > rightBound) {
        const shift = Math.min(menuRect.left - Math.max(8, panelRect.left + 8), menuRect.right - rightBound);
        if (shift > 0) {
          menuEl.style.left = `${-Math.round(shift)}px`;
        }
      }
    });
  };

  // 3c. Bottom Controls Bar inside Composer Card (Model Pill + Context Pill + Submit Button)
  const controlsBar = document.createElement("div");
  controlsBar.className = "oc-btw-controls-bar";

  const leftControls = document.createElement("div");
  leftControls.className = "oc-btw-controls-left";

  // Model Selector Pill + Upward Popover
  const modelZone = document.createElement("div");
  modelZone.className = "relative";
  modelZone.setAttribute("data-btw-menu-zone", "model");

  const modelBtn = document.createElement("button");
  modelBtn.type = "button";
  modelBtn.className = "oc-btw-pill-btn";
  const modelBtnLabel = document.createElement("span");
  modelBtnLabel.className = "oc-btw-pill-text";
  insert(
    modelBtnLabel,
    () => {
      const key = globalPrefs().modelKey;
      if (!key) {
        const def = sessionDefaultModel();
        return def ? def.id : "跟随主会话";
      }
      const idx = key.indexOf("/");
      return idx !== -1 ? key.slice(idx + 1) : key;
    },
    null
  );
  modelBtn.appendChild(modelBtnLabel);
  insert(
    modelBtn,
    createComponent(Icon, { name: "chevron-down", size: "small", class: "shrink-0 opacity-60" }),
    null
  );
  modelBtn.addEventListener("click", () => {
    setModelFilter("");
    modelSearchInput.value = "";
    const next = openMenu() === "model" ? "" : "model";
    setOpenMenu(next);
    if (next === "model") {
      clampUpwardMenuHorizontal(modelMenu);
      requestAnimationFrame(() => modelSearchInput.focus());
    }
  });

  const modelMenu = document.createElement("div");
  modelMenu.className = "oc-btw-popover-up oc-btw-popover-model";

  const modelSearchWrap = document.createElement("div");
  modelSearchWrap.className = "oc-btw-model-search";
  const modelSearchInput = document.createElement("input");
  modelSearchInput.type = "text";
  modelSearchInput.placeholder = "搜索模型…";
  modelSearchInput.className = "oc-btw-model-search-input";
  modelSearchInput.addEventListener("input", () => setModelFilter(modelSearchInput.value));
  modelSearchWrap.appendChild(modelSearchInput);

  const modelListScroll = document.createElement("div");
  modelListScroll.className = "oc-btw-model-list";

  modelMenu.append(modelSearchWrap, modelListScroll);

  createEffect(() => {
    const isOpen = openMenu() === "model";
    modelMenu.style.display = isOpen ? "flex" : "none";
    if (!isOpen) return;

    const kw = modelFilter().trim().toLowerCase();
    const models = availableModels();
    const def = sessionDefaultModel();
    const curKey = globalPrefs().modelKey || "";

    modelListScroll.innerHTML = "";

    if (!kw) {
      const defItem = document.createElement("button");
      defItem.type = "button";
      defItem.className = `oc-btw-menu-item ${curKey === "" ? "is-selected" : ""}`;
      const defSpan = document.createElement("span");
      defSpan.className = "truncate";
      defSpan.textContent = def ? `跟随主会话 (${def.id})` : "跟随主会话";
      defItem.appendChild(defSpan);
      defItem.addEventListener("click", () => {
        updatePrefs({ modelKey: "" });
        setOpenMenu("");
      });
      modelListScroll.appendChild(defItem);
    }

    const groups = new Map();
    for (const m of models) {
      const full = `${m.providerID}/${m.id} ${m.name || ""}`.toLowerCase();
      if (kw && !full.includes(kw)) continue;
      const pid = m.providerID || "other";
      if (!groups.has(pid)) groups.set(pid, []);
      groups.get(pid).push(m);
    }

    for (const [pid, list] of groups.entries()) {
      const grp = document.createElement("div");
      grp.className = "oc-btw-menu-group-label";
      grp.textContent = pid;
      modelListScroll.appendChild(grp);

      for (const m of list) {
        const key = `${m.providerID}/${m.id}`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `oc-btw-menu-item ${curKey === key ? "is-selected" : ""}`;
        const nameSpan = document.createElement("span");
        nameSpan.className = "truncate";
        nameSpan.textContent = m.name || m.id;
        btn.appendChild(nameSpan);
        btn.addEventListener("click", () => {
          updatePrefs({ modelKey: key });
          setOpenMenu("");
        });
        modelListScroll.appendChild(btn);
      }
    }
  });

  modelZone.append(modelBtn, modelMenu);

  // Context Scope Pill + Upward Popover
  const ctxZone = document.createElement("div");
  ctxZone.className = "relative";
  ctxZone.setAttribute("data-btw-menu-zone", "context");

  const ctxModes = [
    { id: "none", short: "仅当前", label: "仅当前对话与划词引用 (推荐)" },
    { id: "recent", short: "最近3轮", label: "附带主会话最近 3 轮对话" },
    { id: "full", short: "完整会话", label: "附带完整主会话上下文" },
  ];

  const ctxBtn = document.createElement("button");
  ctxBtn.type = "button";
  ctxBtn.className = "oc-btw-pill-btn";
  const ctxBtnLabel = document.createElement("span");
  ctxBtnLabel.className = "oc-btw-pill-text";
  insert(
    ctxBtnLabel,
    () => {
      const mode = globalPrefs().contextMode || "none";
      return ctxModes.find((m) => m.id === mode)?.short || "仅当前";
    },
    null
  );
  ctxBtn.appendChild(ctxBtnLabel);
  insert(
    ctxBtn,
    createComponent(Icon, { name: "chevron-down", size: "small", class: "shrink-0 opacity-60" }),
    null
  );
  ctxBtn.addEventListener("click", () => {
    const next = openMenu() === "context" ? "" : "context";
    setOpenMenu(next);
    if (next === "context") {
      clampUpwardMenuHorizontal(ctxMenu);
    }
  });

  const ctxMenu = document.createElement("div");
  ctxMenu.className = "oc-btw-popover-up oc-btw-popover-ctx";
  createEffect(() => {
    const isOpen = openMenu() === "context";
    ctxMenu.style.display = isOpen ? "flex" : "none";
    if (!isOpen) return;
    ctxMenu.innerHTML = "";
    const curMode = globalPrefs().contextMode || "none";
    for (const m of ctxModes) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `oc-btw-menu-item ${curMode === m.id ? "is-selected" : ""}`;
      item.textContent = m.label;
      item.addEventListener("click", () => {
        updatePrefs({ contextMode: m.id });
        setOpenMenu("");
      });
      ctxMenu.appendChild(item);
    }
  });

  ctxZone.append(ctxBtn, ctxMenu);
  leftControls.append(modelZone, ctxZone);

  // Right Submit / Stop Button (Exact native OpenCode IconButton)
  const rightActions = document.createElement("div");
  rightActions.className = "oc-btw-controls-right";

  insert(
    rightActions,
    createComponent(IconButton, {
      "data-action": "composer-submit",
      type: "button",
      size: "large",
      get disabled() {
        return !isThreadGenerating() && inputValue().trim().length === 0 && draftQuotes().length === 0;
      },
      get icon() {
        return createComponent(Icon, {
          get name() {
            return isThreadGenerating() ? "stop" : "arrow-up";
          },
        });
      },
      variant: "submit",
      "aria-label": "发送",
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleSendOrStop();
      },
    }),
    null
  );

  controlsBar.append(leftControls, rightActions);
  composerForm.append(quotesRow, textarea, controlsBar);
  composerDock.appendChild(composerForm);

  root.append(headerBar, messagesScroll, composerDock);

  focusInputCallback = () => {
    requestAnimationFrame(() => {
      textarea.focus();
      resizeTextarea();
    });
  };
  onCleanup(() => {
    if (focusInputCallback) focusInputCallback = null;
  });

  return root;
}

// ============================================================================
// Companion Initializer: Left GPT Hover Timeline Rail + Selection Quote Pill
// ============================================================================
let companionInitialized = false;

export function initCompanion(ext) {
  if (companionInitialized || typeof window === "undefined") return;
  companionInitialized = true;
  ensureStyles();

  window.__oc_btw_slash = (arg, session) => {
    if (!session?.id) return;
    const trimmed = (arg || "").trim();
    if (!trimmed) {
      ext.layout.toggle("btw:main", session);
      setTimeout(() => focusInputCallback?.(), 80);
      return;
    }
    ext.layout.open("btw:main", session, { tab: "select" });
    sendBtwMessage({
      session,
      text: trimmed,
      legacyChatsAccessor: () => ext.stores?.chats?.(session),
    });
  };

  setupSelectionQuotePopover(ext);
  setupGptHoverTimelineRail(ext);
}

// ----------------------------------------------------------------------------
// 1. Clean Native-Styled Selection Quote Popover
// ----------------------------------------------------------------------------
function setupSelectionQuotePopover(ext) {
  let popoverEl = null;
  let currentSelectedText = "";

  const removePopover = () => {
    if (popoverEl) {
      popoverEl.remove();
      popoverEl = null;
    }
  };

  const triggerQuoteToBtw = (explainImmediately = false) => {
    const text = currentSelectedText || window.getSelection()?.toString()?.trim() || "";
    if (!text) return;
    const session = ext.sessions.current();
    if (!session?.id) return;

    removePopover();
    window.getSelection()?.removeAllRanges?.();

    ext.layout.open("btw:main", session, { tab: "select" });
    if (explainImmediately) {
      sendBtwMessage({
        session,
        text: "请解释这段内容：",
        quotes: [{ id: crypto.randomUUID(), text }],
        legacyChatsAccessor: () => ext.stores?.chats?.(session),
      });
    } else {
      addQuoteToSession(session, text);
      setTimeout(() => focusInputCallback?.(), 80);
    }
  };

  document.addEventListener("mouseup", (e) => {
    if (popoverEl && popoverEl.contains(e.target)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (!text || text.length < 2) {
        removePopover();
        return;
      }
      const anchorNode = sel.anchorNode;
      const el = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
      if (!el || !el.closest('[data-slot="session-chat-panel"]')) {
        removePopover();
        return;
      }
      if (el.closest('[data-component="session-composer-dock"], .oc-gpt-rail, input, textarea')) {
        removePopover();
        return;
      }

      currentSelectedText = text;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        removePopover();
        return;
      }

      if (!popoverEl) {
        popoverEl = document.createElement("div");
        popoverEl.className = "oc-selection-popover";

        const btnQuote = document.createElement("button");
        btnQuote.type = "button";
        btnQuote.className = "oc-sel-btn";
        btnQuote.innerHTML = `<span>引用到 /btw</span><span class="oc-sel-kbd">Alt+Q</span>`;
        btnQuote.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          triggerQuoteToBtw(false);
        });

        const sep = document.createElement("div");
        sep.className = "oc-sel-sep";

        const btnExplain = document.createElement("button");
        btnExplain.type = "button";
        btnExplain.className = "oc-sel-btn";
        btnExplain.textContent = "解释";
        btnExplain.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          triggerQuoteToBtw(true);
        });

        popoverEl.append(btnQuote, sep, btnExplain);
        document.body.appendChild(popoverEl);
      }

      const left = Math.min(window.innerWidth - 110, Math.max(110, rect.left + rect.width / 2));
      const top = Math.max(44, rect.top);
      popoverEl.style.left = `${left}px`;
      popoverEl.style.top = `${top}px`;
    }, 15);
  });

  document.addEventListener("mousedown", (e) => {
    if (popoverEl && !popoverEl.contains(e.target)) removePopover();
  });

  document.addEventListener("scroll", () => {
    if (popoverEl) removePopover();
  }, true);

  window.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "q" || e.key === "Q")) {
      const selText = window.getSelection()?.toString()?.trim();
      if (selText) {
        e.preventDefault();
        currentSelectedText = selText;
        triggerQuoteToBtw(false);
      }
    }
  });
}

// ----------------------------------------------------------------------------
// 2. Left GPT/Codex-Style Hover Timeline Scrubber + Local Cache & Auto-Hydration
// ----------------------------------------------------------------------------
const TIMELINE_CACHE_PREFIX = "oc.timeline.v1.";
const TIMELINE_LRU_KEY = "oc.timeline.v1.lru";
const memoryTimelineCache = new Map();
const hydratingSessions = new Map();

function loadCachedTimelineTurns(sessionID) {
  if (!sessionID) return [];
  if (memoryTimelineCache.has(sessionID)) {
    return memoryTimelineCache.get(sessionID);
  }
  try {
    const raw = localStorage.getItem(TIMELINE_CACHE_PREFIX + sessionID);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryTimelineCache.set(sessionID, parsed);
        return parsed;
      }
    }
  } catch {}
  return [];
}

function saveCachedTimelineTurns(sessionID, turns) {
  if (!sessionID || !Array.isArray(turns) || turns.length === 0) return;
  const compact = turns.map((t, idx) => ({
    index: idx + 1,
    userMessageID: t.userMessageID,
    title: t.title,
    preview: (t.preview || "").slice(0, 160),
    assistantPreview: (t.assistantPreview || "").slice(0, 140),
    headings: Array.isArray(t.headings) ? t.headings.slice(0, 12) : [],
  }));
  memoryTimelineCache.set(sessionID, compact);
  try {
    localStorage.setItem(TIMELINE_CACHE_PREFIX + sessionID, JSON.stringify(compact));
    const lruRaw = localStorage.getItem(TIMELINE_LRU_KEY);
    const lru = lruRaw ? JSON.parse(lruRaw) : [];
    const nextLru = [sessionID, ...lru.filter((id) => id !== sessionID)];
    while (nextLru.length > 40) {
      const evicted = nextLru.pop();
      if (evicted) localStorage.removeItem(TIMELINE_CACHE_PREFIX + evicted);
    }
    localStorage.setItem(TIMELINE_LRU_KEY, JSON.stringify(nextLru));
  } catch {}
}

function ensureFullSessionHistoryLoaded(session, onLoaded) {
  const sid = session?.id;
  const msgApi = session?.server?.data?.session?.message;
  if (!sid || !msgApi?.more || !msgApi?.loadMore) return Promise.resolve(false);
  if (!msgApi.more(sid)) return Promise.resolve(false);

  if (hydratingSessions.has(sid)) {
    return hydratingSessions.get(sid).then((res) => {
      onLoaded?.();
      return res;
    });
  }

  const p = (async () => {
    try {
      await msgApi.loadMore(sid, { all: true });
      return true;
    } catch {
      return false;
    } finally {
      hydratingSessions.delete(sid);
    }
  })();

  hydratingSessions.set(sid, p);
  p.then(() => onLoaded?.());
  return p;
}

function getTimelineScroller(chatPanelEl) {
  const ctrl = window.__oc_timeline_ctrl;
  const fromCtrl = ctrl?.scroller?.();
  if (fromCtrl && fromCtrl.isConnected) return fromCtrl;
  const root = chatPanelEl || document;
  return (
    root.querySelector('[data-slot="session-timeline-scroll"] .scroll-view__viewport') ||
    root.querySelector('[data-slot="session-timeline-scroll"] [data-scrollable]') ||
    root.querySelector(".scroll-view__viewport") ||
    root.querySelector('[data-slot="session-timeline-scroll"]')?.firstElementChild ||
    null
  );
}

function extractMarkdownHeadings(markdownText, partID) {
  if (!markdownText || typeof markdownText !== "string") return [];
  const lines = markdownText.split(/\r?\n/);
  const headings = [];
  let inCodeFence = false;
  let headingIdx = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(`{3,}|~{3,})/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*$/.exec(trimmed);
    if (m) {
      const level = m[1].length;
      const rawTitle = m[2]
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/`(.+?)`/g, "$1")
        .replace(/\[(.+?)\]\(.+?\)/g, "$1")
        .trim();
      if (rawTitle) {
        headings.push({
          level,
          text: rawTitle,
          partID,
          headingIdx: headingIdx++,
        });
      }
    }
  }
  return headings;
}

function buildConversationTurns(session, chatPanelEl) {
  const sid = session?.id;
  const msgs = getMainSessionMessages(session);
  const liveTurns = [];

  if (msgs.length > 0) {
    let currentTurn = null;
    for (const m of msgs) {
      if (m.type === "user") {
        const clean = cleanUserText(m.text);
        const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const firstLine = lines[0] || "提问";
        const restLines = lines.slice(1).join("\n") || clean;
        currentTurn = {
          index: liveTurns.length + 1,
          userMessageID: m.id,
          title: firstLine.length > 42 ? firstLine.slice(0, 42) + "…" : firstLine,
          preview: restLines.slice(0, 220),
          assistantPreview: "",
          headings: [],
        };
        liveTurns.push(currentTurn);
      } else if (m.type === "assistant" && currentTurn && Array.isArray(m.content)) {
        let textCounter = 0;
        for (const part of m.content) {
          if (part?.type === "text" && part.text) {
            const partID = `${m.id}:text:${textCounter++}`;
            if (!currentTurn.assistantPreview) {
              currentTurn.assistantPreview = part.text
                .replace(/[#*`>-]/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 180);
            }
            const hList = extractMarkdownHeadings(part.text, partID);
            currentTurn.headings.push(...hList);
          }
        }
      }
    }
  }

  const cachedTurns = sid ? loadCachedTimelineTurns(sid) : [];
  const hasMoreOlder = Boolean(sid && session?.server?.data?.session?.message?.more?.(sid));

  if (liveTurns.length > 0) {
    let finalTurns = liveTurns;
    if (cachedTurns.length > 0 && hasMoreOlder) {
      // Prepend cached early turns that have not yet been paginated into memory
      const liveIds = new Set(liveTurns.map((t) => t.userMessageID));
      const firstLiveId = liveTurns[0].userMessageID;
      const anchorIdx = cachedTurns.findIndex((t) => t.userMessageID === firstLiveId);
      const olderCached =
        anchorIdx > 0
          ? cachedTurns.slice(0, anchorIdx).filter((t) => !liveIds.has(t.userMessageID))
          : cachedTurns.filter((t) => !liveIds.has(t.userMessageID) && t.userMessageID < firstLiveId);
      if (olderCached.length > 0) {
        finalTurns = [...olderCached, ...liveTurns];
      }
    }
    finalTurns = finalTurns.map((t, idx) => ({ ...t, index: idx + 1 }));
    if (sid && (!hasMoreOlder || finalTurns.length >= cachedTurns.length)) {
      saveCachedTimelineTurns(sid, finalTurns);
    }
    return finalTurns;
  }

  if (cachedTurns.length > 0) {
    return cachedTurns;
  }

  // Fallback DOM scan
  if (!chatPanelEl) return [];
  const domTurns = [];
  const domUserMsgs = chatPanelEl.querySelectorAll("[data-message-id]");
  domUserMsgs.forEach((el, idx) => {
    const id = el.getAttribute("data-message-id");
    const textEl = el.querySelector('[data-slot="user-message-text"]') || el;
    const text = cleanUserText(textEl.textContent || "");
    if (id) {
      domTurns.push({
        index: idx + 1,
        userMessageID: id,
        title: text.slice(0, 42) || `第 ${idx + 1} 轮提问`,
        preview: text.slice(0, 200),
        assistantPreview: "",
        headings: [],
      });
    }
  });
  return domTurns;
}

let activeScrollCleanup = null;

async function jumpToTurnOrHeading(chatPanelEl, userMessageID, headingInfo = null, session = null) {
  const scroller = getTimelineScroller(chatPanelEl);
  if (!scroller) return;
  const ctrl = window.__oc_timeline_ctrl;
  const vs = window.__oc_virtual_scroll;

  if (activeScrollCleanup) {
    activeScrollCleanup();
    activeScrollCleanup = null;
  }

  // If target message is from an older unpaginated page, hydrate full session history first
  const rowIdxCheck = vs?.getRowIndex?.(userMessageID, headingInfo?.partID);
  if ((rowIdxCheck === undefined || rowIdxCheck < 0) && session?.server?.data?.session?.message?.more?.(session?.id)) {
    await ensureFullSessionHistoryLoaded(session);
    await new Promise((r) => requestAnimationFrame(r));
  }

  // 1. Unpin auto-scroll and flush any pending virtual scrollAdjustment synchronously
  if (ctrl) {
    try {
      ctrl.view?.markUserScroll?.();
      ctrl.view?.unpin?.();
    } catch {}
  }
  if (vs?.be) {
    try {
      vs.be();
    } catch {}
  }

  const locateTargetElement = () => {
    const root = scroller || chatPanelEl || document;
    if (headingInfo?.partID) {
      const partEl = root.querySelector(`[data-timeline-part-id="${CSS.escape(headingInfo.partID)}"]`);
      if (partEl) {
        const hEls = partEl.querySelectorAll("h1, h2, h3");
        const matched =
          hEls[headingInfo.headingIdx] ||
          Array.from(hEls).find((el) => (el.textContent || "").trim().includes(headingInfo.text));
        return matched || partEl;
      }
      return null;
    }
    return (
      document.getElementById(`message-${userMessageID}`) ||
      root.querySelector(`[data-message-id="${CSS.escape(userMessageID)}"]`)
    );
  };

  const topOffset = 56;
  const computeElementTargetTop = (el) => {
    const targetRect = el.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    return Math.min(
      maxScroll,
      Math.max(0, scroller.scrollTop + (targetRect.top - scrollerRect.top) - topOffset)
    );
  };

  let currentPos = scroller.scrollTop;
  let targetEl = locateTargetElement();
  let destTop = null;

  if (targetEl) {
    destTop = computeElementTargetTop(targetEl);
  } else if (vs?.M && vs?.getRowIndex) {
    try {
      const rowIdx = vs.getRowIndex(userMessageID, headingInfo?.partID);
      if (rowIdx !== undefined && rowIdx >= 0) {
        const offsetTuple = vs.M.getOffsetForIndex(rowIdx, "start");
        if (offsetTuple) {
          destTop = Math.max(0, offsetTuple[0] - 24);
        }
      }
    } catch {}
  }

  // Fallback if __oc_virtual_scroll was not available: probe via revealMessage and immediately restore
  if (destTop === null && ctrl?.actions?.revealMessage) {
    try {
      ctrl.actions.revealMessage(userMessageID, headingInfo?.partID);
      destTop = scroller.scrollTop;
      scroller.scrollTop = currentPos;
      ctrl.view?.unpin?.();
    } catch {}
  }

  if (destTop === null) return;

  // Lock virtualizer into smooth-scrolling state so resizeItem never snaps scrollTop mid-flight
  let origScheduleReconcile = null;
  if (vs?.M) {
    origScheduleReconcile = vs.M.scheduleScrollReconcile;
    vs.M.scheduleScrollReconcile = () => {};
    vs.M.scrollState = {
      index: null,
      align: "start",
      behavior: "smooth",
      startedAt: performance.now(),
      lastTargetOffset: destTop,
      stableFrames: 0,
    };
  }

  let rafId = null;
  const cleanup = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    scroller.removeEventListener("wheel", cleanup);
    scroller.removeEventListener("touchstart", cleanup);
    if (vs?.M) {
      if (origScheduleReconcile) vs.M.scheduleScrollReconcile = origScheduleReconcile;
      vs.M.scrollState = null;
    }
    if (activeScrollCleanup === cleanup) {
      activeScrollCleanup = null;
    }
  };
  activeScrollCleanup = cleanup;

  scroller.addEventListener("wheel", cleanup, { passive: true, once: true });
  scroller.addEventListener("touchstart", cleanup, { passive: true, once: true });

  const distance = Math.abs(destTop - currentPos);
  const duration = Math.min(520, Math.max(280, 240 + Math.sqrt(distance) * 3.2));
  const startTime = performance.now();
  let lastNow = startTime;

  const step = (now) => {
    if (ctrl) {
      try {
        ctrl.view?.unpin?.();
      } catch {}
    }

    const dt = Math.max(1, now - lastNow);
    const elapsed = now - startTime;
    const remTime = duration - elapsed;
    lastNow = now;

    // Continuously refine target position as virtualized rows mount along the path
    const liveEl = locateTargetElement();
    if (liveEl) {
      targetEl = liveEl;
      destTop = computeElementTargetTop(liveEl);
    }

    if (remTime <= dt || Math.abs(destTop - currentPos) < 0.8) {
      scroller.scrollTop = destTop;
      const finalEl = locateTargetElement() || targetEl;
      cleanup();
      if (finalEl) {
        scroller.scrollTop = computeElementTargetTop(finalEl);
        finalEl.classList.remove("oc-scroll-flash");
        void finalEl.offsetWidth;
        finalEl.classList.add("oc-scroll-flash");
        setTimeout(() => finalEl.classList.remove("oc-scroll-flash"), 1300);
      }
      return;
    }

    // Self-similar cubic ease-out step: smooth C1 curve even when destTop refines mid-scroll
    const stepRatio = 1 - Math.pow(Math.max(0, (remTime - dt) / remTime), 3);
    currentPos += (destTop - currentPos) * stepRatio;
    scroller.scrollTop = currentPos;

    rafId = requestAnimationFrame(step);
  };

  rafId = requestAnimationFrame(step);
}

function setupGptHoverTimelineRail(ext) {
  let mountedPanel = null;
  let railEl = null;
  let trackEl = null;
  let hoverCardEl = null;
  let hideCardTimer = null;

  let cachedItems = []; // [{ type: 'turn' | 'heading', turn, heading, id }]
  let activeTurnID = "";
  let hoveredIdx = -1;
  let lastTurnCount = -1;
  let lastSessionID = "";

  const clearHideTimer = () => {
    if (hideCardTimer) {
      clearTimeout(hideCardTimer);
      hideCardTimer = null;
    }
  };

  const scheduleHideCard = () => {
    clearHideTimer();
    hideCardTimer = setTimeout(() => {
      hoveredIdx = -1;
      updateTickFisheye();
      if (hoverCardEl) {
        hoverCardEl.remove();
        hoverCardEl = null;
      }
    }, 140);
  };

  // Apply GPT-style fisheye wave widths to ticks
  const updateTickFisheye = () => {
    if (!trackEl) return;
    const tickEls = trackEl.children;
    for (let i = 0; i < tickEls.length; i++) {
      const hitEl = tickElAt(tickEls, i);
      const barEl = hitEl?.firstElementChild;
      if (!hitEl || !barEl) continue;
      const item = cachedItems[i];
      const isSub = item?.type === "heading";
      const isActiveTurn = item && item.turn.userMessageID === activeTurnID && !isSub;

      hitEl.classList.toggle("is-active", Boolean(isActiveTurn && hoveredIdx === -1));

      if (hoveredIdx === -1) {
        barEl.style.width = isActiveTurn ? "18px" : isSub ? "5px" : "8px";
        barEl.style.background = isActiveTurn
          ? "var(--v2-text-text-base, #18181b)"
          : "var(--v2-border-border-strong, rgba(120, 120, 128, 0.34))";
        barEl.style.opacity = isActiveTurn ? "1" : isSub ? "0.65" : "0.85";
      } else {
        const dist = Math.abs(i - hoveredIdx);
        if (dist === 0) {
          barEl.style.width = "22px";
          barEl.style.background = "var(--v2-text-text-base, #18181b)";
          barEl.style.opacity = "1";
        } else if (dist === 1) {
          barEl.style.width = "15px";
          barEl.style.background = "var(--v2-text-text-muted, rgba(113, 113, 122, 0.65))";
          barEl.style.opacity = "0.95";
        } else if (dist === 2) {
          barEl.style.width = "11px";
          barEl.style.background = "var(--v2-border-border-strong, rgba(120, 120, 128, 0.45))";
          barEl.style.opacity = "0.85";
        } else {
          barEl.style.width = isSub ? "5px" : "7px";
          barEl.style.background = "var(--v2-border-border-strong, rgba(120, 120, 128, 0.3))";
          barEl.style.opacity = "0.65";
        }
      }
    }
  };

  function tickElAt(collection, idx) {
    return collection[idx];
  }

  // Lazy-render floating GPT preview card ONLY when hovering a tick
  const showHoverCardForIndex = (idx, tickHitEl) => {
    const item = cachedItems[idx];
    if (!item || !tickHitEl) return;

    if (!hoverCardEl) {
      hoverCardEl = document.createElement("div");
      hoverCardEl.className = "oc-gpt-hover-card";
      hoverCardEl.addEventListener("mouseenter", clearHideTimer);
      hoverCardEl.addEventListener("mouseleave", scheduleHideCard);
      document.body.appendChild(hoverCardEl);
    }

    const { turn, heading } = item;
    hoverCardEl.innerHTML = "";

    // Top row: Clock SVG + Title + Turn #
    const header = document.createElement("div");
    header.className = "oc-gpt-card-header";
    header.innerHTML = `
      <svg class="oc-gpt-card-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
        <circle cx="8" cy="8" r="6.25" />
        <path d="M8 4.75V8L10.25 9.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
    const titleEl = document.createElement("div");
    titleEl.className = "oc-gpt-card-title";
    titleEl.textContent = heading ? heading.text : turn.title;

    const badgeEl = document.createElement("div");
    badgeEl.className = "oc-gpt-card-badge";
    badgeEl.textContent = `#${turn.index}`;

    header.append(titleEl, badgeEl);
    header.addEventListener("click", () => {
      jumpToTurnOrHeading(mountedPanel, turn.userMessageID, heading || null, ext.sessions.current());
    });

    // Body preview text
    const bodyEl = document.createElement("div");
    bodyEl.className = "oc-gpt-card-body";
    bodyEl.textContent =
      turn.preview && turn.preview !== turn.title
        ? turn.preview
        : turn.assistantPreview || turn.title;
    bodyEl.addEventListener("click", () => {
      jumpToTurnOrHeading(mountedPanel, turn.userMessageID, heading || null, ext.sessions.current());
    });

    hoverCardEl.append(header, bodyEl);

    // Optional clickable section headings inside the turn
    if (turn.headings && turn.headings.length > 0) {
      const hListEl = document.createElement("div");
      hListEl.className = "oc-gpt-card-headings";
      for (const h of turn.headings) {
        const hBtn = document.createElement("button");
        hBtn.type = "button";
        const isCurrentHeading = heading && heading.partID === h.partID && heading.headingIdx === h.headingIdx;
        hBtn.className = `oc-gpt-card-h-item ${isCurrentHeading ? "is-current" : ""}`;
        hBtn.style.paddingLeft = h.level === 1 ? "6px" : h.level === 2 ? "14px" : "22px";

        const dot = document.createElement("span");
        dot.className = "oc-gpt-card-h-dot";

        const hTxt = document.createElement("span");
        hTxt.className = "oc-gpt-card-h-text";
        hTxt.textContent = h.text;

        hBtn.append(dot, hTxt);
        hBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          jumpToTurnOrHeading(mountedPanel, turn.userMessageID, h, ext.sessions.current());
        });
        hListEl.appendChild(hBtn);
      }
      hoverCardEl.appendChild(hListEl);
    }

    // Position floating card to the right of the hovered tick
    const tickRect = tickHitEl.getBoundingClientRect();
    const cardHeight = hoverCardEl.offsetHeight || 120;
    const left = Math.round(tickRect.right + 10);
    const top = Math.min(
      window.innerHeight - cardHeight - 16,
      Math.max(52, Math.round(tickRect.top + tickRect.height / 2 - 28))
    );
    hoverCardEl.style.left = `${left}px`;
    hoverCardEl.style.top = `${top}px`;
  };

  // Build tick marks from conversation turns
  const rebuildTicks = () => {
    if (!mountedPanel || !trackEl) return;
    const session = ext.sessions.current();
    if (session?.id && session?.server?.data?.session?.message?.more?.(session.id)) {
      ensureFullSessionHistoryLoaded(session, () => {
        lastTurnCount = -1;
        rebuildTicks();
      });
    }
    const turns = buildConversationTurns(session, mountedPanel);

    const items = [];
    for (const turn of turns) {
      items.push({ type: "turn", turn, heading: null, id: turn.userMessageID });
      // Include H1 & H2 headings as sub-ticks on the ruler
      for (const h of turn.headings.slice(0, 8)) {
        if (h.level <= 2) {
          items.push({
            type: "heading",
            turn,
            heading: h,
            id: `${turn.userMessageID}:${h.partID}:${h.headingIdx}`,
          });
        }
      }
    }

    cachedItems = items;
    trackEl.innerHTML = "";
    railEl.style.display = items.length > 0 ? "flex" : "none";

    items.forEach((item, idx) => {
      const hit = document.createElement("div");
      hit.className = `oc-gpt-tick-hit ${item.type === "heading" ? "is-sub" : "is-turn"}`;
      const bar = document.createElement("div");
      bar.className = "oc-gpt-tick-bar";
      hit.appendChild(bar);

      hit.addEventListener("mouseenter", () => {
        clearHideTimer();
        hoveredIdx = idx;
        updateTickFisheye();
        showHoverCardForIndex(idx, hit);
      });

      hit.addEventListener("click", (ev) => {
        ev.stopPropagation();
        jumpToTurnOrHeading(mountedPanel, item.turn.userMessageID, item.heading, ext.sessions.current());
      });

      trackEl.appendChild(hit);
    });

    detectActiveTurn();
    updateTickFisheye();
  };

  const detectActiveTurn = () => {
    if (!mountedPanel || !cachedItems.length) return;
    const scroller = getTimelineScroller(mountedPanel);
    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const anchorY = scrollerRect.top + 140;
    const nodes = scroller.querySelectorAll("[data-message-id]");
    let bestId = "";
    for (const node of nodes) {
      const id = node.getAttribute("data-message-id");
      if (!id) continue;
      const r = node.getBoundingClientRect();
      if (r.top <= anchorY) {
        bestId = id;
      } else if (!bestId && r.top < scrollerRect.bottom) {
        bestId = id;
        break;
      }
    }
    const nextActive = bestId || cachedItems[cachedItems.length - 1]?.turn?.userMessageID || "";
    if (nextActive && nextActive !== activeTurnID) {
      activeTurnID = nextActive;
      if (hoveredIdx === -1) updateTickFisheye();
    }
  };

  const mountRailIntoChatPanel = (chatPanel) => {
    if (mountedPanel === chatPanel && railEl?.isConnected) return;
    if (railEl) railEl.remove();

    mountedPanel = chatPanel;
    railEl = document.createElement("div");
    railEl.className = "oc-gpt-rail";
    railEl.setAttribute("data-oc-gpt-rail", "true");

    trackEl = document.createElement("div");
    trackEl.className = "oc-gpt-rail-track";
    railEl.appendChild(trackEl);

    // Refresh full turn & heading data lazily when mouse enters the rail
    railEl.addEventListener("mouseenter", () => {
      clearHideTimer();
      rebuildTicks();
    });

    railEl.addEventListener("mouseleave", () => {
      scheduleHideCard();
    });

    chatPanel.appendChild(railEl);

    chatPanel.addEventListener(
      "scroll",
      () => {
        detectActiveTurn();
      },
      { passive: true, capture: true }
    );

    rebuildTicks();
  };

  const lightweightCheck = () => {
    const chatPanel = document.querySelector('[data-slot="session-chat-panel"]');
    if (!chatPanel) return;
    if (mountedPanel !== chatPanel || !railEl?.isConnected) {
      mountRailIntoChatPanel(chatPanel);
      return;
    }
    // Only rebuild ticks in background when session ID or message count changes
    const session = ext.sessions.current();
    const sid = session?.id || "";
    const msgCount = getMainSessionMessages(session).length;
    if (sid !== lastSessionID || msgCount !== lastTurnCount) {
      lastSessionID = sid;
      lastTurnCount = msgCount;
      rebuildTicks();
    }
  };

  const domObserver = new MutationObserver(() => {
    const chatPanel = document.querySelector('[data-slot="session-chat-panel"]');
    if (chatPanel && (mountedPanel !== chatPanel || !railEl?.isConnected)) {
      mountRailIntoChatPanel(chatPanel);
    }
  });
  domObserver.observe(document.body, { childList: true, subtree: true });

  setInterval(lightweightCheck, 800);
  requestAnimationFrame(lightweightCheck);
}

export { BtwPanel as default };
