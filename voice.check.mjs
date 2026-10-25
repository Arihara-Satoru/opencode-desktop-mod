import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { validateConfig, validateAudio, MAX_AUDIO_BYTES, VOICE_PRESETS } from "./voice-shared.mjs";
import { encodeWav, toWav } from "./voice-audio.mjs";
import { buildVoiceRequest, readVoiceResponse } from "./voice-service.mjs";
import { createRecorder } from "./voice-recorder.mjs";
import { patchVoiceDesktopMain } from "./voice-patch.mjs";

const base = { endpoint: "https://example.com/v1/audio/transcriptions", model: "whisper-1", language: "zh" };
assert.equal(validateConfig(base).language, "zh");
assert.equal(validateConfig({ ...base, endpoint: "http://127.0.0.1:8080/v1/audio/transcriptions" }).remember, false);
for (const endpoint of ["http://example.com/api", "file:///audio", "https://user:pass@example.com/api", "https://example.com/api?key=secret", "https://example.com/#key"]) {
  assert.throws(() => validateConfig({ ...base, endpoint }));
}
assert.throws(() => validateConfig({ ...base, model: "" }));
assert.throws(() => validateConfig({ ...base, language: "中文" }));
assert.equal(validateConfig({ ...base, language: "auto" }).language, "");
assert.equal(validateConfig(VOICE_PRESETS.mimo).provider, "mimo");
assert.equal(validateConfig({ endpoint: VOICE_PRESETS.mimo.endpoint, model: "mimo-v2.5-asr" }).provider, "mimo");
assert.throws(() => validateConfig({ ...VOICE_PRESETS.mimo, language: "ja" }));
assert.throws(() => validateConfig({ ...base, provider: "unknown" }));
const wav = encodeWav(new Float32Array([-2, -1, 0, 1, 2, NaN]), 16000);
const wavView = new DataView(wav.buffer);
assert.equal(Buffer.from(wav).toString("ascii", 0, 4), "RIFF");
assert.equal(wavView.getUint32(24, true), 16000); assert.equal(wavView.getUint16(22, true), 1);
assert.equal(wavView.getUint16(34, true), 16); assert.equal(wavView.getUint32(40, true), 12);
assert.deepEqual(Array.from({ length: 6 }, (_, i) => wavView.getInt16(44 + i * 2, true)), [-32768, -32768, 0, 32767, 32767, 0]);
assert.throws(() => encodeWav(new Float32Array(), 16000));
assert.throws(() => encodeWav(new Float32Array([1]), 0));
let audioClosed = 0;
class TestAudioContext {
  async decodeAudioData() { return { duration: 1 }; }
  async close() { audioClosed++; }
}
class TestOfflineAudioContext {
  constructor(channels, length, rate) { assert.equal(channels, 1); assert.equal(length, 16000); assert.equal(rate, 16000); }
  createBufferSource() { return { connect() {}, start() {} }; }
  async startRendering() { return { getChannelData: () => new Float32Array(16000) }; }
}
const converted = await toWav(new Blob(["compressed audio"]), { AudioContext: TestAudioContext, OfflineAudioContext: TestOfflineAudioContext });
assert.equal(converted.mime, "audio/wav"); assert.equal(converted.bytes.length, 32044); assert.equal(audioClosed, 1);
await assert.rejects(toWav(new Blob(["bad"]), { AudioContext: class extends TestAudioContext { async decodeAudioData() { throw Error("bad audio"); } }, OfflineAudioContext: TestOfflineAudioContext }));
assert.equal(audioClosed, 2, "Always release Web Audio resources after conversion errors");
const mimoRequest = buildVoiceRequest(VOICE_PRESETS.mimo, "mimo-test-key", { bytes: wav, mime: "audio/wav" });
const mimoBody = JSON.parse(mimoRequest.body);
assert.equal(mimoRequest.headers["api-key"], "mimo-test-key"); assert.equal(mimoRequest.headers.Authorization, undefined);
assert.equal(mimoRequest.headers["Content-Type"], "application/json");
assert.equal(mimoBody.model, "mimo-v2.5-asr"); assert.equal(mimoBody.asr_options.language, "auto"); assert.equal(mimoBody.stream, false);
assert.equal(mimoBody.messages.length, 1); assert.equal(mimoBody.messages[0].content.length, 1);
const inputAudio = mimoBody.messages[0].content[0]; assert.equal(inputAudio.type, "input_audio"); assert.equal(inputAudio.input_audio.format, "wav");
assert.deepEqual(Buffer.from(inputAudio.input_audio.data.split(",")[1], "base64"), Buffer.from(wav));
assert.throws(() => buildVoiceRequest(VOICE_PRESETS.mimo, "", { bytes: wav, mime: "audio/webm" }), /需要 WAV/);
assert.throws(() => buildVoiceRequest(VOICE_PRESETS.mimo, "", { bytes: new Uint8Array([1]), mime: "audio/wav" }), /有效的 WAV/);
assert.equal(readVoiceResponse(VOICE_PRESETS.mimo, { choices: [{ message: { content: "小米识别" }, finish_reason: "stop" }] }), "小米识别");
assert.throws(() => readVoiceResponse(VOICE_PRESETS.mimo, { choices: [{ message: { content: "partial" }, finish_reason: "length" }] }), /截断/);
assert.equal(validateAudio({ bytes: new Uint8Array([1]), mime: "audio/webm;codecs=opus" }).bytes.length, 1);
for (const value of [{ bytes: [], mime: "audio/webm" }, { bytes: new Uint8Array(), mime: "audio/webm" }, { bytes: new Uint8Array(MAX_AUDIO_BYTES + 1), mime: "audio/webm" }, { bytes: new Uint8Array([1]), mime: "video/webm" }]) assert.throws(() => validateAudio(value));

const tick = () => new Promise(setImmediate);
function harness(overrides = {}) {
  let stopped = 0, uploads = 0, cancelled = 0, instance;
  const states = [], texts = [], errors = [], timers = new Map();
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  class Recorder {
    static isTypeSupported = () => true;
    constructor() { instance = this; this.state = "inactive"; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; queueMicrotask(() => { this.ondataavailable({ data: new Blob(["voice"]) }); this.onstop(); }); }
  }
  const bridge = { arm: async () => {}, cancel: async () => { cancelled++; }, transcribe: async () => { uploads++; return "识别文字"; }, ...overrides.bridge };
  const recorder = createRecorder({ bridge, mediaDevices: { getUserMedia: overrides.getUserMedia || (async () => stream) }, Recorder, prepareAudio: overrides.prepareAudio, onStream: overrides.onStream, onState: s => states.push(s), onText: s => texts.push(s), onError: s => errors.push(s), timers: { setTimeout: fn => { timers.set(1, fn); return 1; }, clearTimeout: id => timers.delete(id) } });
  return { recorder, states, texts, errors, timers, stream, instance: () => instance, stopped: () => stopped, uploads: () => uploads, cancelled: () => cancelled };
}
{
  const h = harness(); await h.recorder.start(); assert.equal(h.recorder.state(), "recording");
  h.recorder.stop(); await tick(); assert.equal(h.uploads(), 1); assert.deepEqual(h.texts, ["识别文字"]); assert.equal(h.recorder.state(), "idle"); assert.ok(h.stopped());
}
{
  const h = harness(); await h.recorder.start(); h.recorder.cancel(); await tick();
  assert.equal(h.uploads(), 0); assert.ok(h.stopped()); assert.equal(h.timers.size, 0);
}
{
  let resolve; const h = harness({ getUserMedia: () => new Promise(r => resolve = r) });
  const starting = h.recorder.start(); await tick(); h.recorder.cancel(); resolve(h.stream); await starting;
  assert.equal(h.uploads(), 0); assert.equal(h.stopped(), 1); assert.equal(h.recorder.state(), "idle");
}
{
  let resolve; const h = harness({ bridge: { transcribe: () => new Promise(r => resolve = r) } });
  await h.recorder.start(); h.recorder.stop(); await tick(); assert.equal(h.recorder.state(), "transcribing");
  h.recorder.cancel(); resolve("late result"); await tick(); assert.deepEqual(h.texts, []);
}
{
  const h = harness({ getUserMedia: async () => { throw Object.assign(new Error(), { name: "NotAllowedError" }); } });
  await h.recorder.start(); assert.match(h.errors[0], /权限/); assert.equal(h.uploads(), 0);
}
{
  const h = harness(); await h.recorder.start(); h.timers.get(1)(); await tick();
  assert.equal(h.uploads(), 0); assert.match(h.errors[0], /3 分钟/);
}
{
  const h = harness(); await h.recorder.start(); h.instance().ondataavailable({ data: { size: MAX_AUDIO_BYTES + 1 } }); await tick();
  assert.equal(h.uploads(), 0); assert.match(h.errors[0], /24 MiB/);
}
{
  const h = harness(); await h.recorder.start(); h.instance().stop(); await tick();
  assert.equal(h.uploads(), 0); assert.match(h.errors[0], /设备已断开/);
}
{
  const h = harness(); h.recorder.cancel(); assert.equal(h.cancelled(), 0, "Disposing an idle composer must not abort another composer's upload");
}
{
  let receivedStream = undefined;
  const h = harness({ onStream: s => { receivedStream = s; } });
  await h.recorder.start();
  assert.equal(receivedStream, h.stream, "createRecorder must supply live stream to onStream callback");
  h.recorder.stop();
  await tick();
  assert.equal(receivedStream, null, "createRecorder must notify onStream callback on release");
}

// Exercise the actual main-process bridge with mock Electron, filesystem and fetch.
{
  let resolve;
  const h = harness({ prepareAudio: () => new Promise(r => resolve = r) });
  await h.recorder.start(); h.recorder.stop(); await tick(); assert.equal(h.recorder.state(), "converting");
  h.recorder.cancel(); resolve({ bytes: wav, mime: "audio/wav" }); await tick(); assert.equal(h.uploads(), 0);
}
{
  let receivedMime;
  const h = harness({ prepareAudio: async () => ({ bytes: wav, mime: "audio/wav" }), bridge: { transcribe: async (_, mime) => { receivedMime = mime; return "小米结果"; } } });
  await h.recorder.start(); h.recorder.stop(); await tick(); assert.equal(receivedMime, "audio/wav"); assert.deepEqual(h.texts, ["小米结果"]);
}
const mainSource = fs.readFileSync(new URL("./voice-main.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace("export function allowVoiceMedia", "function allowVoiceMedia");
let handler, fetchCount = 0, request, disk;
const contents = Object.assign(new EventEmitter(), { id: 7, getURL: () => "oc://renderer/index.html" });
const frame = { url: "oc://renderer/index.html" }; contents.mainFrame = frame;
const event = { sender: contents, senderFrame: frame };
const sandbox = {
  app: { getPath: () => "/mock" }, ipcMain: { handle: (_, fn) => handler = fn },
  safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "test", encryptString: s => Buffer.from(`encrypted:${s}`), decryptString: b => b.toString().slice(10) },
  fs: { readFileSync: () => { throw Error("missing"); }, writeFileSync: (_, value) => disk = value, renameSync() {} }, path,
  validateConfig, validateAudio, VOICE_PRESETS, buildVoiceRequest, readVoiceResponse, Buffer, Uint8Array, URL, FormData, Blob, AbortController, setTimeout, clearTimeout, process: { env: {} },
  fetch: async (url, options) => { fetchCount++; request = { url, options }; return new Response(JSON.stringify({ text: "你好" })); },
};
vm.createContext(sandbox); vm.runInContext(mainSource + "\nglobalThis.allow = allowVoiceMedia;", sandbox);
assert.equal((await handler(event, "config")).provider, "mimo", "New installs default to Xiaomi MiMo");
await assert.rejects(handler({ ...event, senderFrame: { url: "https://evil.example" } }, "config"));
assert.equal(sandbox.allow(contents, "media", { requestingUrl: frame.url, mediaTypes: ["audio"] }), false);
await handler(event, "arm");
assert.equal(sandbox.allow(contents, "media", { requestingUrl: frame.url, mediaTypes: ["audio"] }), true);
assert.equal(sandbox.allow(contents, "media", { requestingUrl: frame.url, mediaTypes: ["video"] }), false);
assert.equal(sandbox.allow(contents, "media", { requestingUrl: "https://evil.example", mediaTypes: ["audio"] }), false);
assert.equal(sandbox.allow(contents, "media", { requestingUrl: frame.url, mediaTypes: ["audio"], isMainFrame: false }), false);
assert.equal(sandbox.allow(contents, "media", { requestingUrl: frame.url, mediaType: "audio" }, frame.url), true);
await handler(event, "cancel");
assert.equal(sandbox.allow(contents, "media", { requestingUrl: frame.url, mediaTypes: ["audio"] }), false);
await handler(event, "save", { ...base, key: "secret-token", remember: false });
assert.ok(!disk.includes("secret-token")); assert.equal((await handler(event, "config")).hasKey, true);
assert.equal((await handler(event, "config")).key, undefined);
await handler(event, "save", { ...base, key: "encrypted-secret", remember: true });
assert.ok(!disk.includes("encrypted-secret")); assert.ok(JSON.parse(disk).encryptedKey);
await handler(event, "save", { ...base, key: "secret-token", remember: false });
assert.ok(!JSON.parse(disk).encryptedKey);
assert.equal(await handler(event, "transcribe", { bytes: new Uint8Array([1, 2]), mime: "audio/webm" }), "你好");
assert.equal(fetchCount, 1); assert.equal(request.options.redirect, "error"); assert.equal(request.options.headers.Authorization, "Bearer secret-token");
assert.equal(request.options.body.get("model"), "whisper-1"); assert.equal(request.options.body.get("language"), "zh");
assert.equal(request.options.body.get("file").name, "recording.webm");
await handler(event, "save", { ...base, key: "", remember: false });
assert.equal((await handler(event, "config")).hasKey, false);
sandbox.fetch = async () => new Response("private upstream error", { status: 401 });
await assert.rejects(handler(event, "transcribe", { bytes: new Uint8Array([1]), mime: "audio/webm" }), /HTTP 401/);
sandbox.fetch = async () => new Response("not json");
await assert.rejects(handler(event, "transcribe", { bytes: new Uint8Array([1]), mime: "audio/webm" }), /响应格式不兼容/);
sandbox.fetch = async (_, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
const uploading = handler(event, "transcribe", { bytes: new Uint8Array([1]), mime: "audio/webm" });
await assert.rejects(handler(event, "transcribe", { bytes: new Uint8Array([1]), mime: "audio/webm" }), /already running/);
await handler(event, "cancel"); await assert.rejects(uploading, /取消或超时/);
sandbox.fetch = async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "小米语音识别成功" } }] })); };
await handler(event, "save", { ...VOICE_PRESETS.mimo, key: "mimo-key", language: "zh" });
assert.equal(await handler(event, "transcribe", { bytes: wav, mime: "audio/wav" }), "小米语音识别成功");
assert.equal(request.url, VOICE_PRESETS.mimo.endpoint); assert.equal(request.options.headers["api-key"], "mimo-key");
assert.equal(JSON.parse(request.options.body).asr_options.language, "zh"); assert.equal(request.options.redirect, "error");
await assert.rejects(handler(event, "transcribe", { bytes: new Uint8Array([1]), mime: "audio/webm" }), /需要 WAV/);
await handler(event, "save", { ...base, key: "old-provider-secret" });
await handler(event, "save", { ...base, endpoint: "https://other.example/v1/audio/transcriptions" });
assert.equal((await handler(event, "config")).hasKey, false, "Changing endpoints must not leak an existing credential");
await assert.rejects(handler(event, "unknown"));
await assert.rejects(handler(event, "transcribe", { bytes: new Uint8Array(), mime: "audio/webm" }));

// Minified-version anchors must fail closed, not broaden all media permissions.
const fixture = 'function G9(e){let t=e.webContents.id;e.webContents.session.setPermissionRequestHandler((e,n,r,i)=>{r(W9.has(n)&&Ae(i.requestingUrl)&&e.id===t)}),e.webContents.session.setPermissionCheckHandler((e,n,r,i)=>!W9.has(n)||e&&e.id!==t?!1:Ae(i.requestingUrl)||Ae(r))}';
const patched = patchVoiceDesktopMain(fixture);
assert.match(patched, /__oc_allow_voice_media\(e,n,i\)/);
assert.match(patched, /__oc_allow_voice_media\(e,n,i,r\)/);
new vm.Script(patched.replace(/^import[^\n]+\n/, ""));
assert.throws(() => patchVoiceDesktopMain("unsupported version"));

// Verify the DOM selector matches both new session (draft) and active session dock.
const voiceInputSrc = fs.readFileSync(new URL("./voice-input.mjs", import.meta.url), "utf8");
const formSelectorMatch = voiceInputSrc.match(/const FORM = '([^']+)';/);
assert.ok(formSelectorMatch, "FORM selector must exist in voice-input.mjs");
const formSelector = formSelectorMatch[1];
assert.equal(formSelector, 'form[data-component="composer"]', "Must match all composer forms without being restricted to session-composer-dock");

// Optional full packaging test against a COPY of an installed clean ASAR.
if (process.env.OPENCODE_TEST_ASAR) {
  const parent = process.platform === "win32" ? path.join(os.homedir(), "AppData/Local/Temp/opencode") : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(parent, "voice-check-"));
  try {
    const target = path.join(dir, "app.asar"); fs.copyFileSync(process.env.OPENCODE_TEST_ASAR, target);
    const apply = () => execFileSync(process.execPath, ["apply-mod.mjs", "--force"], { cwd: import.meta.dirname, env: { ...process.env, OPENCODE_ASAR_PATH: target }, encoding: "utf8" });
    console.log(apply());
    const first = fs.readFileSync(target);
    apply(); assert.deepEqual(fs.readFileSync(target), first, "Packaging is idempotent");
    const header = JSON.parse(first.subarray(16, 16 + first.readUInt32LE(12)));
    const offset = 8 + first.readUInt32LE(4);
    const read = n => first.subarray(offset + Number(n.offset), offset + Number(n.offset) + n.size);
    const out = header.files.out.files;
    for (const [name, n] of Object.entries(out.main.files)) {
      if (name === "index.js" || name.startsWith("voice-")) {
        const file = path.join(dir, name); fs.writeFileSync(file, read(n)); execFileSync(process.execPath, ["--check", file]);
      }
    }
    for (const [name, n] of Object.entries(out.renderer.files.assets.files)) {
      if (!/\.(m?js)$/.test(name)) continue;
      if (!name.startsWith("voice-") && !name.startsWith("main-")) continue;
      const file = path.join(dir, name); fs.writeFileSync(file, read(n)); execFileSync(process.execPath, ["--check", file]);
    }
    assert.match(read(out.preload.files["index.cjs"]).toString(), /__ocVoice/);
    console.log("Copied ASAR packaging, generated module syntax and idempotence: passed");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
console.log("Voice config, permission isolation, IPC, multipart upload, recorder lifecycle and patch anchors: passed");
