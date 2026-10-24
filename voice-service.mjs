// Build only the documented ASR payload. Never includes chat history or project context.
export function buildVoiceRequest(settings, apiKey, audio) {
  if (settings.provider === "mimo") {
    if (audio.mime !== "audio/wav") throw new Error("小米 MiMo 需要 WAV 音频，请重新录音并确认本机音频转换可用。");
    const bytes = Buffer.from(audio.bytes);
    if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("小米 MiMo 录音不是有效的 WAV 文件。");
    return {
      headers: { "Content-Type": "application/json", ...(apiKey ? { "api-key": apiKey } : {}) },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: `data:audio/wav;base64,${bytes.toString("base64")}`, format: "wav" } }] }],
        asr_options: { language: settings.language || "auto" },
        stream: false,
      }),
    };
  }
  const form = new FormData();
  const ext = audio.mime === "audio/wav" ? "wav" : audio.mime.startsWith("audio/ogg") ? "ogg" : audio.mime.startsWith("audio/mp4") ? "m4a" : "webm";
  form.append("file", new Blob([audio.bytes], { type: audio.mime }), `recording.${ext}`);
  form.append("model", settings.model); form.append("response_format", "json");
  if (settings.language) form.append("language", settings.language);
  return { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, body: form };
}

export function readVoiceResponse(settings, result) {
  if (settings.provider === "mimo") {
    const choice = result?.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error("语音服务输出被截断，请缩短录音后重试。");
    if (choice?.finish_reason === "content_filter") throw new Error("语音服务未返回识别结果（内容过滤）。");
    return choice?.message?.content;
  }
  return result?.text;
}
