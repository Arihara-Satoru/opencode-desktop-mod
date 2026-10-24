import { MAX_AUDIO_BYTES } from "./voice-shared.mjs";

// Mono PCM16 WAV: native browser conversion, no ffmpeg, upload or external library.
export function encodeWav(samples, sampleRate) {
  if (!(samples instanceof Float32Array) || !samples.length || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error("无效的录音采样数据。");
  const length = 44 + samples.length * 2;
  if (length > MAX_AUDIO_BYTES) throw new Error("转换后的录音超过 24 MiB，请缩短后重试。");
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, length - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export async function toWav(blob, { AudioContext = globalThis.AudioContext, OfflineAudioContext = globalThis.OfflineAudioContext } = {}) {
  if (!AudioContext || !OfflineAudioContext) throw new Error("当前环境无法转换 WAV 音频，请使用支持 Web Audio 的桌面版本。");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000;
    const length = Math.ceil(decoded.duration * rate);
    if (!Number.isFinite(length) || length <= 0 || length > rate * 181) throw new Error("录音时长无效或超过上限。");
    const offline = new OfflineAudioContext(1, length, rate);
    const source = offline.createBufferSource();
    source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    return { bytes: encodeWav(rendered.getChannelData(0), rate), mime: "audio/wav" };
  } finally { await context.close(); }
}
