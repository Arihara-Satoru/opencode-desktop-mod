import { createRecorder } from "./voice-recorder.mjs";
import { validateConfig, VOICE_PRESETS } from "./voice-shared.mjs";
import { toWav } from "./voice-audio.mjs";

// Matches the host's composer slots instead of obfuscated Solid symbols.
const FORM = '[data-component="session-composer-dock"] [data-component="composer"]';
const EDITOR = '[data-component="composer-editor"]';
const STYLE = `
/* --- Microphone Button in Composer --- */
.oc-voice-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  margin-right: 6px;
  margin-inline-end: 6px;
  background: transparent;
  color: var(--v2-icon-icon-muted, #71717a);
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease, transform 0.1s ease;
}
.oc-voice-button:hover {
  background: var(--v2-overlay-simple-overlay-hover, rgba(120, 120, 128, 0.12));
  color: var(--v2-text-text-base, #18181b);
}
.oc-voice-button:active {
  transform: scale(0.94);
}
.oc-voice-button[data-active="true"] {
  color: #ef4444 !important;
  background: rgba(239, 68, 68, 0.12) !important;
  animation: oc-mic-pulse 1.6s ease-in-out infinite;
}
@keyframes oc-mic-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}
.oc-voice-button svg {
  width: 17px;
  height: 17px;
}

/* --- Recording & Processing Status Bar in Composer --- */
.oc-voice-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  font-family: var(--v2-font-family-sans, system-ui, -apple-system, sans-serif);
  font-size: 12px;
  line-height: 1.5;
  color: var(--v2-text-text-base, #18181b);
  background: var(--v2-background-bg-layer-02, rgba(120, 120, 128, 0.06));
  border-top: 1px solid var(--v2-border-border-base, rgba(120, 120, 128, 0.14));
  animation: oc-fade-in 0.2s ease-out;
}
.oc-voice-status[hidden] {
  display: none !important;
}
.oc-voice-status-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.oc-voice-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  flex-shrink: 0;
  animation: oc-dot-pulse 1.2s ease-in-out infinite;
}
@keyframes oc-dot-pulse {
  0%, 100% { transform: scale(0.9); opacity: 0.8; }
  50% { transform: scale(1.25); opacity: 1; }
}
.oc-voice-timer {
  font-family: var(--v2-font-family-mono, monospace);
  font-weight: 600;
  font-size: 12px;
  color: var(--v2-text-text-base, #18181b);
  background: var(--v2-background-bg-layer-03, rgba(120, 120, 128, 0.12));
  padding: 1px 6px;
  border-radius: 4px;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}
.oc-voice-status-msg {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--v2-text-text-muted, #71717a);
  font-size: 12px;
}
.oc-voice-status-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.oc-voice-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.14s ease, border-color 0.14s ease, transform 0.1s ease;
  user-select: none;
  white-space: nowrap;
}
.oc-voice-btn:active {
  transform: scale(0.96);
}
.oc-voice-btn-primary {
  background: var(--v2-background-bg-contrast, #18181b);
  color: var(--v2-text-text-inverse, #ffffff);
  border: none;
}
.oc-voice-btn-primary:hover {
  opacity: 0.9;
}
.oc-voice-btn-secondary {
  background: var(--v2-background-bg-base, #ffffff);
  color: var(--v2-text-text-base, #18181b);
  border: 1px solid var(--v2-border-border-base, rgba(120, 120, 128, 0.22));
}
.oc-voice-btn-secondary:hover {
  background: var(--v2-overlay-simple-overlay-hover, rgba(120, 120, 128, 0.08));
  border-color: var(--v2-border-border-strong, rgba(120, 120, 128, 0.35));
}

/* --- Modern Settings Modal Dialog (Always Viewport Centered) --- */
dialog.oc-voice-dialog {
  position: fixed !important;
  inset: 0 !important;
  margin: auto !important;
  transform: none !important;
  box-sizing: border-box !important;
  width: min(480px, calc(100vw - 32px)) !important;
  height: fit-content !important;
  max-height: calc(100dvh - 64px) !important;
  padding: 0 !important;
  border: 1px solid var(--v2-border-border-base, rgba(120, 120, 128, 0.2)) !important;
  border-radius: 16px !important;
  background: var(--v2-background-bg-base, #ffffff) !important;
  color: var(--v2-text-text-base, #18181b) !important;
  font-family: var(--v2-font-family-sans, system-ui, -apple-system, sans-serif) !important;
  box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(0, 0, 0, 0.05) !important;
  overflow: hidden !important;
  display: flex !important;
  flex-direction: column !important;
  z-index: 10000 !important;
  animation: oc-fade-in 0.18s ease-out !important;
}
dialog.oc-voice-dialog::backdrop {
  background: rgba(0, 0, 0, 0.45) !important;
  backdrop-filter: blur(6px) !important;
  -webkit-backdrop-filter: blur(6px) !important;
}
@keyframes oc-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.oc-voice-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--v2-border-border-base, rgba(120, 120, 128, 0.12));
}
.oc-voice-modal-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--v2-text-text-base, #18181b);
  letter-spacing: -0.2px;
}
.oc-voice-modal-close {
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
  font-size: 16px;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.oc-voice-modal-close:hover {
  background: var(--v2-overlay-simple-overlay-hover, rgba(120, 120, 128, 0.1));
  color: var(--v2-text-text-base, #18181b);
}

.oc-voice-modal-body {
  padding: 18px 22px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 13px;
  flex: 1;
}

.oc-voice-desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--v2-text-text-muted, #71717a);
}

/* --- Segmented Provider Switch --- */
.oc-voice-tabs {
  display: flex;
  background: var(--v2-background-bg-layer-02, rgba(120, 120, 128, 0.08));
  border-radius: 10px;
  padding: 3px;
  gap: 3px;
}
.oc-voice-tab {
  flex: 1;
  padding: 7px 10px;
  font-size: 12.5px;
  font-weight: 500;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  text-align: center;
  color: var(--v2-text-text-muted, #71717a);
  background: transparent;
  transition: all 0.15s ease;
}
.oc-voice-tab[data-active="true"] {
  background: var(--v2-background-bg-base, #ffffff);
  color: var(--v2-text-text-base, #18181b);
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.oc-voice-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.oc-voice-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--v2-text-text-muted, #71717a);
}
.oc-voice-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--v2-border-border-base, rgba(120, 120, 128, 0.22));
  background: var(--v2-background-bg-layer-01, rgba(120, 120, 128, 0.04));
  color: var(--v2-text-text-base, #18181b);
  font-family: inherit;
  font-size: 13px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.oc-voice-input:focus {
  outline: none;
  border-color: var(--v2-border-border-focus, #3b82f6);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}
.oc-voice-input::placeholder {
  color: var(--v2-text-text-faint, #a1a1aa);
}

.oc-voice-info-card {
  background: rgba(59, 130, 246, 0.06);
  border: 1px solid rgba(59, 130, 246, 0.16);
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--v2-text-text-muted, #71717a);
}

.oc-voice-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--v2-text-text-base, #18181b);
  cursor: pointer;
  user-select: none;
  margin-top: 2px;
}
.oc-voice-checkbox-row input[type="checkbox"] {
  width: 16px;
  height: 16px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--v2-background-bg-contrast, #18181b);
}

.oc-voice-error {
  margin: 0;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #ef4444;
  font-size: 12px;
  line-height: 1.4;
}

.oc-voice-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 13px 22px;
  border-top: 1px solid var(--v2-border-border-base, rgba(120, 120, 128, 0.12));
  background: var(--v2-background-bg-layer-02, rgba(120, 120, 128, 0.04));
}
.oc-voice-modal-footer button {
  padding: 7px 16px;
  font-size: 13px;
}

/* --- Result Inspection Dialog --- */
.oc-voice-result {
  min-height: 140px;
  resize: vertical;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--v2-border-border-base, rgba(120, 120, 128, 0.22));
  background: var(--v2-background-bg-layer-01, rgba(120, 120, 128, 0.04));
  color: var(--v2-text-text-base, #18181b);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
}
`;

// Lucide microphone / square paths, ISC license; same stroke vocabulary as the host.
function icon(recording = false) {
  return recording
    ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></svg>';
}

function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function button(text, fn) {
  const el = node("button", text);
  el.type = "button";
  el.addEventListener("click", fn);
  return el;
}

async function settings(bridge, anchor) {
  // Always clean up any existing dialogs to guarantee a fresh, responsive opening
  document.querySelectorAll(".oc-voice-dialog").forEach(d => {
    try { d.close(); } catch {}
    d.remove();
  });

  let config;
  try {
    config = await bridge.config();
  } catch (e) {
    alert("无法获取语音设置：" + (e.message || "未知错误"));
    return;
  }

  const dialog = node("dialog", "", "oc-voice-dialog");
  dialog.setAttribute("aria-label", "语音输入设置");

  // Header
  const header = node("div", "", "oc-voice-modal-header");
  const title = node("h2", "语音输入设置");
  const closeBtn = node("button", "✕", "oc-voice-modal-close");
  closeBtn.type = "button";
  closeBtn.title = "关闭 (Esc)";
  closeBtn.addEventListener("click", () => dialog.close());
  header.append(title, closeBtn);

  // Body
  const body = node("div", "", "oc-voice-modal-body");
  const desc = node("p", "配置语音识别服务。录音结束后音频会发送到指定接口，识别文字填入草稿，不自动发送。", "oc-voice-desc");
  body.append(desc);

  // Segmented Provider Tab Bar
  let currentProvider = config.provider || "mimo";
  const tabsWrap = node("div", "", "oc-voice-tabs");
  const tabMimo = node("button", "小米 MiMo ASR（推荐）", "oc-voice-tab");
  tabMimo.type = "button";
  const tabOpenAI = node("button", "通用 OpenAI 转写", "oc-voice-tab");
  tabOpenAI.type = "button";
  tabsWrap.append(tabMimo, tabOpenAI);
  body.append(tabsWrap);

  const field = (titleText, value, type = "text") => {
    const wrap = node("div", "", "oc-voice-field");
    const label = node("label", titleText, "oc-voice-label");
    const input = node("input", "", "oc-voice-input");
    input.type = type;
    input.value = value || "";
    input.autocomplete = "off";
    input.spellcheck = false;
    wrap.append(label, input);
    body.append(wrap);
    return input;
  };

  const endpointInput = field("接口完整地址", config.endpoint, "url");
  const modelInput = field("语音识别模型", config.model);
  const langInput = field("识别语言（留空自动识别，例如 zh / en）", config.language);
  const keyInput = field("API Key（密钥）", "", "password");
  keyInput.placeholder = config.hasKey ? "已配置，留空保留原有密钥" : "输入该语音服务的 API Key";

  const infoCard = node("div", "", "oc-voice-info-card");
  body.append(infoCard);

  const updateTabs = (provider) => {
    currentProvider = provider;
    tabMimo.setAttribute("data-active", String(provider === "mimo"));
    tabOpenAI.setAttribute("data-active", String(provider === "openai"));
    if (provider === "mimo") {
      infoCard.innerHTML = "<b>小米 MiMo 说明：</b>采用 <code>mimo-v2.5-asr</code> 模型，客户端自动转换为 16kHz WAV 格式后上传；原生支持中文和英文。";
    } else {
      infoCard.innerHTML = "<b>通用 OpenAI 说明：</b>使用标准 multipart/form-data 格式上传音频，兼容各类 Whisper 及兼容服务。";
    }
  };

  tabMimo.addEventListener("click", () => {
    const preset = VOICE_PRESETS.mimo;
    endpointInput.value = preset.endpoint;
    modelInput.value = preset.model;
    langInput.value = preset.language;
    keyInput.value = "";
    updateTabs("mimo");
  });

  tabOpenAI.addEventListener("click", () => {
    const preset = VOICE_PRESETS.openai;
    endpointInput.value = preset.endpoint;
    modelInput.value = preset.model;
    langInput.value = preset.language;
    keyInput.value = "";
    updateTabs("openai");
  });

  updateTabs(currentProvider);

  // Checkboxes
  const checkWrap = node("div", "", "oc-voice-field");
  const rememberLabel = node("label", "", "oc-voice-checkbox-row");
  const rememberCheck = node("input");
  rememberCheck.type = "checkbox";
  rememberCheck.checked = config.remember;
  rememberCheck.disabled = !config.canRemember;
  rememberLabel.append(rememberCheck, document.createTextNode(config.canRemember ? " 使用系统加密记住 API Key" : " 系统加密存储不可用，密钥仅本次有效"));

  const clearLabel = node("label", "", "oc-voice-checkbox-row");
  const clearCheck = node("input");
  clearCheck.type = "checkbox";
  clearLabel.append(clearCheck, document.createTextNode(" 清除已保存的 API Key"));
  checkWrap.append(rememberLabel, clearLabel);
  body.append(checkWrap);

  // Error alert container
  const errorEl = node("div", "", "oc-voice-error");
  errorEl.hidden = true;
  body.append(errorEl);

  // Footer
  const footer = node("div", "", "oc-voice-modal-footer");
  const cancelBtn = node("button", "取消", "oc-voice-btn oc-voice-btn-secondary");
  cancelBtn.type = "button";
  cancelBtn.addEventListener("click", () => dialog.close());

  const saveBtn = node("button", "保存设置", "oc-voice-btn oc-voice-btn-primary");
  saveBtn.type = "button";
  saveBtn.addEventListener("click", async () => {
    try {
      saveBtn.disabled = true;
      saveBtn.textContent = "保存中…";
      errorEl.hidden = true;
      const data = validateConfig({
        provider: currentProvider,
        endpoint: endpointInput.value,
        model: modelInput.value,
        language: langInput.value,
        remember: rememberCheck.checked,
      });
      if (keyInput.value || clearCheck.checked || !config.hasKey) {
        data.key = clearCheck.checked ? "" : keyInput.value;
      }
      await bridge.save(data);
      dialog.close();
    } catch (e) {
      errorEl.hidden = false;
      errorEl.textContent = e.message || "保存失败，请检查输入";
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "保存设置";
    }
  });

  footer.append(cancelBtn, saveBtn);
  dialog.append(header, body, footer);

  document.body.appendChild(dialog);
  // Click outside (on backdrop) to close
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  dialog.addEventListener("close", () => {
    dialog.remove();
    if (anchor?.isConnected) anchor.focus();
  }, { once: true });
  dialog.showModal();
}

function showResult(text) {
  document.querySelectorAll(".oc-voice-dialog").forEach(d => {
    try { d.close(); } catch {}
    d.remove();
  });
  const dialog = node("dialog", "", "oc-voice-dialog");
  dialog.setAttribute("aria-label", "语音识别结果");

  const header = node("div", "", "oc-voice-modal-header");
  header.append(node("h2", "识别文字已保留"), node("button", "✕", "oc-voice-modal-close"));
  header.querySelector("button").addEventListener("click", () => dialog.close());

  const body = node("div", "", "oc-voice-modal-body");
  body.append(node("p", "当前输入框状态已变化，为避免写入错误会话，已为您保留识别结果：", "oc-voice-desc"));
  const result = node("textarea", "", "oc-voice-result");
  result.value = text;
  result.readOnly = true;
  result.setAttribute("aria-label", "识别文字");
  body.append(result);

  const footer = node("div", "", "oc-voice-modal-footer");
  const copyBtn = node("button", "复制并关闭", "oc-voice-btn oc-voice-btn-primary");
  copyBtn.type = "button";
  copyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); } catch {}
    dialog.close();
  });
  const closeBtn = node("button", "关闭", "oc-voice-btn oc-voice-btn-secondary");
  closeBtn.type = "button";
  closeBtn.addEventListener("click", () => dialog.close());

  footer.append(closeBtn, copyBtn);
  dialog.append(header, body, footer);
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

export function insertTranscript(editor, text, range) {
  if (!editor.isConnected || editor.getAttribute("contenteditable") === "false") return false;
  editor.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (!selection) return false;
  if (range && editor.contains(range.commonAncestorContainer)) {
    range.collapse(false);
    selection.removeAllRanges(); selection.addRange(range);
  } else {
    const end = document.createRange(); end.selectNodeContents(editor); end.collapse(false);
    selection.removeAllRanges(); selection.addRange(end);
  }
  // Use the native editor input path, preserving mention nodes, undo and draft persistence.
  // Never replace innerHTML/textContent or synthesize Enter/submit.
  return document.execCommand("insertText", false, text);
}

export function mountVoiceInput() {
  if (!window.__ocVoice || window.__ocVoiceMounted) return;
  window.__ocVoiceMounted = true;
  const bridge = window.__ocVoice;
  const style = node("style"); style.textContent = STYLE; document.head.append(style);
  const mounts = new Map();
  let active;
  function mount(form) {
    const actions = form.querySelector('[data-slot="composer-actions"]');
    const editor = form.querySelector(EDITOR);
    if (!actions || !editor || mounts.has(form)) return;

    const mic = node("button", "", "oc-voice-button"); mic.type = "button"; mic.innerHTML = icon();

    const status = node("div", "", "oc-voice-status"); status.hidden = true;
    const statusLeft = node("div", "", "oc-voice-status-left");
    const pulseDot = node("span", "", "oc-voice-pulse-dot");
    const timerEl = node("span", "00:00", "oc-voice-timer");
    const message = node("span", "", "oc-voice-status-msg"); message.setAttribute("role", "status"); message.setAttribute("aria-live", "polite");
    statusLeft.append(pulseDot, timerEl, message);

    const statusActions = node("div", "", "oc-voice-status-actions");
    const finishButton = node("button", "完成", "oc-voice-btn oc-voice-btn-primary");
    finishButton.type = "button";
    finishButton.title = "结束录音并开始识别";

    const configButton = node("button", "设置", "oc-voice-btn oc-voice-btn-secondary");
    configButton.type = "button";
    configButton.title = "配置语音接口与密钥";

    const cancelButton = node("button", "取消", "oc-voice-btn oc-voice-btn-secondary");
    cancelButton.type = "button";
    cancelButton.title = "取消当前录音 (Esc)";

    statusActions.append(finishButton, configButton, cancelButton);
    status.append(statusLeft, statusActions);

    let context, lastState = "idle", started = 0, recordingProvider;
    const showError = text => {
      status.hidden = false;
      pulseDot.style.background = "#ef4444";
      timerEl.hidden = true;
      finishButton.hidden = true;
      message.textContent = text;
    };

    // Finish button triggers transcribing
    finishButton.addEventListener("click", () => {
      if (lastState === "recording") recorder.stop();
    });

    // Setting button NEVER blocked: cancels active recording and opens settings modal directly
    configButton.addEventListener("click", () => {
      if (lastState !== "idle") recorder.cancel();
      status.hidden = true;
      void settings(bridge, mic).catch(e => showError(e.message));
    });

    // Cancel button aborts immediately
    cancelButton.addEventListener("click", () => {
      recorder.cancel();
      status.hidden = true;
    });

    const recorder = createRecorder({
      bridge, mediaDevices: navigator.mediaDevices, Recorder: window.MediaRecorder,
      prepareAudio: blob => recordingProvider === "mimo" ? toWav(blob) : blob.arrayBuffer().then(buffer => ({ bytes: new Uint8Array(buffer), mime: blob.type })),
      onState(state) {
        lastState = state;
        if (state === "recording") started = Date.now();
        mic.innerHTML = icon(state === "recording");
        const label = state === "recording" ? "结束录音并转文字" : ["converting", "transcribing"].includes(state) ? "取消语音识别" : "语音输入（右键打开设置）";
        mic.title = label; mic.setAttribute("aria-label", label); mic.setAttribute("aria-pressed", String(state !== "idle"));
        mic.dataset.active = String(state !== "idle");
        status.hidden = state === "idle";

        if (state === "recording") {
          pulseDot.hidden = false;
          pulseDot.style.background = "#ef4444";
          timerEl.hidden = false;
          timerEl.textContent = "00:00";
          finishButton.hidden = false;
          finishButton.disabled = false;
          finishButton.textContent = "完成";
          message.textContent = "录音中 · 点击「完成」或麦克风结束";
        } else if (state === "permission") {
          pulseDot.hidden = false;
          pulseDot.style.background = "#f59e0b";
          timerEl.hidden = true;
          finishButton.hidden = true;
          message.textContent = "正在请求麦克风权限…";
        } else if (state === "converting") {
          pulseDot.hidden = false;
          pulseDot.style.background = "#3b82f6";
          timerEl.hidden = true;
          finishButton.hidden = false;
          finishButton.disabled = true;
          finishButton.textContent = "处理中…";
          message.textContent = "正在本地转换 WAV 音频…";
        } else if (state === "transcribing" || state === "stopping") {
          pulseDot.hidden = false;
          pulseDot.style.background = "#8b5cf6";
          timerEl.hidden = true;
          finishButton.hidden = false;
          finishButton.disabled = true;
          finishButton.textContent = "识别中…";
          message.textContent = "正在向服务转写文字，可点击取消…";
        }

        if (state === "idle" && active === recorder) active = undefined;
      },
      onText(text) {
        if (!context || context.url !== location.href || !editor.isConnected || editor.textContent !== context.draft || !insertTranscript(editor, text, context.range)) showResult(text);
      },
      onError: showError,
    });

    mic.title = "语音输入（右键打开设置）"; mic.setAttribute("aria-label", mic.title);
    mic.addEventListener("mousedown", e => e.preventDefault());
    mic.addEventListener("contextmenu", e => {
      e.preventDefault();
      if (lastState !== "idle") recorder.cancel();
      status.hidden = true;
      void settings(bridge, mic).catch(e => showError(e.message));
    });
    mic.addEventListener("keydown", e => {
      if (e.shiftKey && e.key === "F10") {
        e.preventDefault();
        if (lastState !== "idle") recorder.cancel();
        status.hidden = true;
        void settings(bridge, mic).catch(e => showError(e.message));
      }
    });
    mic.addEventListener("click", async () => {
      if (lastState !== "idle" && (context?.url !== location.href || !editor.isConnected)) { recorder.cancel(); return; }
      if (lastState === "recording") { recorder.stop(); return; }
      if (lastState !== "idle") { recorder.cancel(); return; }
      try {
        const config = await bridge.config();
        if (!config.hasKey && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(config.endpoint).hostname)) { await settings(bridge, mic); return; }
        if (!editor.isConnected) return;
        active?.cancel();
        const selection = window.getSelection();
        const range = selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.getRangeAt(0).cloneRange() : null;
        context = { url: location.href, draft: editor.textContent, range };
        recordingProvider = config.provider || "openai";
        active = recorder;
        await recorder.start();
      } catch (error) { showError(error.message); }
    });
    actions.prepend(mic); form.append(status);
    const timer = setInterval(() => {
      if (lastState !== "idle" && (context?.url !== location.href || !editor.isConnected)) recorder.cancel();
      if (lastState === "recording") {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
        const s = String(elapsed % 60).padStart(2, "0");
        timerEl.textContent = `${m}:${s}`;
      }
    }, 500);
    mounts.set(form, () => { recorder.cancel(); clearInterval(timer); mic.remove(); status.remove(); });
  }
  let queued = false;
  function scan() {
    queued = false;
    for (const [form, dispose] of mounts) if (!form.isConnected) { dispose(); mounts.delete(form); }
    document.querySelectorAll(FORM).forEach(mount);
  }
  const observer = new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(scan); } });
  observer.observe(document.body, { childList: true, subtree: true }); scan();
  document.addEventListener("keydown", e => { if (e.key === "Escape" && active) { active.cancel(); e.preventDefault(); e.stopPropagation(); } }, true);
  window.addEventListener("pagehide", () => { observer.disconnect(); for (const dispose of mounts.values()) dispose(); mounts.clear(); }, { once: true });
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountVoiceInput, { once: true });
  else mountVoiceInput();
}
