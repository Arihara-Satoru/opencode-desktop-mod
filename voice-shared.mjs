export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
export const VOICE_PRESETS = {
  mimo: { provider: "mimo", endpoint: "https://api.xiaomimimo.com/v1/chat/completions", model: "mimo-v2.5-asr", language: "" },
  openai: { provider: "openai", endpoint: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1", language: "" },
};

export function validateConfig(value) {
  if (!value || typeof value.endpoint !== "string") throw new Error("请填写完整的语音转文字接口地址。");
  // Old configs had no provider; retain their multipart protocol unless the URL is MiMo's.
  const provider = value.provider ?? (value.endpoint.trim() === VOICE_PRESETS.mimo.endpoint ? "mimo" : "openai");
  if (!["mimo", "openai"].includes(provider)) throw new Error("不支持的语音接口类型。");
  let url;
  try { url = new URL(value.endpoint.trim()); } catch { throw new Error("接口地址无效。"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.hash || url.search) {
    throw new Error("接口必须使用 HTTPS（本机可用 HTTP），且不能包含账号、查询参数或锚点。");
  }
  const model = typeof value.model === "string" ? value.model.trim() : "";
  let language = typeof value.language === "string" ? value.language.trim() : "";
  if (language === "auto") language = "";
  if (!model || model.length > 200 || /[\r\n]/.test(model)) throw new Error("请填写有效的语音识别模型名称。");
  if (language && !/^[a-z]{2,3}$/.test(language)) throw new Error("语言请填写 zh、en 等语言代码，或留空自动识别。");
  if (provider === "mimo" && !["", "zh", "en"].includes(language)) throw new Error("小米 MiMo 仅支持 auto、zh、en，留空代表自动识别。");
  return { provider, endpoint: url.href, model, language, remember: value.remember === true };
}

export function validateAudio(value) {
  const bytes = value?.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) throw new Error("录音为空或超过 24 MiB 限制。");
  const mime = value.mime;
  if (typeof mime !== "string" || !/^audio\/(?:(webm|ogg|mp4)(;codecs=opus)?|wav)$/.test(mime)) throw new Error("不支持的录音格式。");
  return { bytes, mime };
}
