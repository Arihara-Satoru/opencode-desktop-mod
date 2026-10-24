// Narrow desktop-only bridge. Never exposes generic IPC, filesystem or HTTP access.
import { app, ipcMain, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { validateConfig, validateAudio, VOICE_PRESETS } from "./voice-shared.mjs";
import { buildVoiceRequest, readVoiceResponse } from "./voice-service.mjs";

const CHANNEL = "oc-mod:voice";
const armed = new Map();
const requests = new Map();
let config;
let key = "";
const configPath = () => path.join(app.getPath("userData"), "mod-voice.json");

function trusted(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "oc:" && u.host === "renderer") return true;
    const dev = process.env.ELECTRON_RENDERER_URL;
    return Boolean(dev && u.origin === new URL(dev).origin);
  } catch { return false; }
}

function encryptionAvailable() {
  return safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend?.() !== "basic_text");
}

function load() {
  if (config) return;
  config = { ...VOICE_PRESETS.mimo, remember: false };
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    config = validateConfig(saved);
    if (saved.encryptedKey && encryptionAvailable()) {
      key = safeStorage.decryptString(Buffer.from(saved.encryptedKey, "base64"));
    }
  } catch { /* Defaults are usable even after a corrupt file or unavailable keychain. */ }
}

export function allowVoiceMedia(contents, permission, details, origin) {
  if (permission !== "media" || !contents || (armed.get(contents.id) || 0) < Date.now()) return false;
  if (details?.isMainFrame === false || !trusted(contents.getURL()) || !trusted(details?.requestingUrl || origin || "")) return false;
  const types = details?.mediaTypes || (details?.mediaType ? [details.mediaType] : []);
  return types.length > 0 && types.every(type => type === "audio");
}

ipcMain.handle(CHANNEL, async (event, action, data) => {
  if (event.senderFrame !== event.sender.mainFrame || !trusted(event.senderFrame?.url)) {
    throw new Error("Voice input is available only in the desktop main frame.");
  }
  load();
  const id = event.sender.id;
  if (action === "config") return { ...config, hasKey: Boolean(key), canRemember: encryptionAvailable() };
  if (action === "save") {
    const next = validateConfig(data);
    // Never forward an existing provider's credential to a newly configured URL.
    const nextKey = typeof data.key === "string" ? data.key.trim() : next.endpoint === config.endpoint ? key : "";
    if (nextKey.length > 8192 || /[\r\n]/.test(nextKey)) throw new Error("Invalid API Key.");
    if (next.remember && nextKey && !encryptionAvailable()) throw new Error("System key encryption is unavailable.");
    const saved = { ...next };
    if (next.remember && nextKey) saved.encryptedKey = safeStorage.encryptString(nextKey).toString("base64");
    const temp = `${configPath()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(saved), { mode: 0o600 });
    fs.renameSync(temp, configPath());
    config = next;
    key = nextKey;
    return { ...config, hasKey: Boolean(key), canRemember: encryptionAvailable() };
  }
  if (action === "arm") {
    armed.set(id, Date.now() + 4 * 60_000);
    return true;
  }
  if (action === "cancel") {
    armed.delete(id);
    requests.get(id)?.abort();
    return true;
  }
  if (action !== "transcribe") throw new Error("Unknown voice operation.");
  armed.delete(id);
  if (requests.has(id)) throw new Error("A transcription is already running.");
  const audio = validateAudio(data);
  const settings = { ...config };
  const apiKey = key;
  const controller = new AbortController();
  requests.set(id, controller);
  const timer = setTimeout(() => controller.abort(), 120_000);
  const onDestroy = () => { armed.delete(id); controller.abort(); };
  event.sender.once("destroyed", onDestroy);
  try {
    const request = buildVoiceRequest(settings, apiKey, audio);
    const response = await fetch(settings.endpoint, {
      ...request, method: "POST", redirect: "error", signal: controller.signal,
    });
    // Do not reflect arbitrary server errors, credentials or HTML into the client.
    if (!response.ok) { await response.body?.cancel(); throw new Error(`语音服务返回 HTTP ${response.status}，请检查地址、模型、密钥或额度。`); }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) { await reader.cancel(); throw new Error("语音服务响应过大。"); }
      chunks.push(Buffer.from(value));
    }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const text = readVoiceResponse(settings, result);
    if (typeof text !== "string" || !text.trim()) throw new Error("未识别到文字，请重试。");
    return text.trim();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("语音识别已取消或超时。");
    if (error.message?.startsWith("语音服务") || error.message?.startsWith("未识别") || error.message?.startsWith("小米 MiMo")) throw error;
    throw new Error("无法连接语音服务或响应格式不兼容，请检查设置和网络。");
  } finally {
    clearTimeout(timer);
    requests.delete(id);
    event.sender.removeListener("destroyed", onDestroy);
  }
});
