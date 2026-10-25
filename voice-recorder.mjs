import { MAX_AUDIO_BYTES } from "./voice-shared.mjs";

// MediaRecorder lifecycle is isolated so cancellation and permission races are testable.
export function createRecorder({ bridge, mediaDevices, Recorder, onState, onText, onError, prepareAudio, onStream, timers = globalThis }) {
  let generation = 0;
  let recorder, stream, timeout;
  let chunks = [], size = 0;
  let state = "idle";
  let pending = false;
  let uploadAuthorized = false;
  const update = value => { state = value; onState(value); };
  const release = () => {
    timers.clearTimeout(timeout);
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    onStream?.(null);
  };
  const cancel = () => {
    const wasActive = state !== "idle";
    generation++;
    if (recorder?.state !== "inactive") { try { recorder?.stop(); } catch {} }
    release();
    recorder = undefined;
    chunks = [];
    if (wasActive) void bridge.cancel().catch(() => {});
    update("idle");
  };
  const start = async () => {
    if (state !== "idle" || pending) return;
    if (!mediaDevices?.getUserMedia || !Recorder) { onError("当前桌面环境不支持录音。"); return; }
    pending = true;
    const token = ++generation;
    update("permission");
    try {
      await bridge.arm();
      if (token !== generation) return;
      const acquired = await mediaDevices.getUserMedia({ audio: true, video: false });
      if (token !== generation) { acquired.getTracks().forEach(t => t.stop()); return; }
      stream = acquired;
      onStream?.(stream);
      const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type => Recorder.isTypeSupported(type));
      if (!mime) throw new Error("当前环境没有可用的录音编码器。");
      recorder = new Recorder(stream, { mimeType: mime });
      uploadAuthorized = false;
      chunks = []; size = 0;
      recorder.ondataavailable = event => {
        if (token !== generation || !event.data.size) return;
        size += event.data.size;
        if (size > MAX_AUDIO_BYTES) { cancel(); onError("录音超过 24 MiB，请缩短后重试。"); return; }
        chunks.push(event.data);
      };
      recorder.onerror = () => { if (token === generation) { cancel(); onError("录音设备发生错误，请检查麦克风。"); } };
      recorder.onstop = async () => {
        if (token !== generation) return;
        release();
        if (!uploadAuthorized) { cancel(); onError("录音设备已断开，录音未上传，请重试。"); return; }
        const blob = new Blob(chunks, { type: mime });
        chunks = [];
        if (!blob.size) { cancel(); onError("没有录到声音，请重试。"); return; }
        update(prepareAudio ? "converting" : "transcribing");
        try {
          const audio = prepareAudio ? await prepareAudio(blob) : { bytes: new Uint8Array(await blob.arrayBuffer()), mime };
          if (token !== generation) return;
          update("transcribing");
          const text = await bridge.transcribe(audio.bytes, audio.mime);
          if (token === generation) { update("idle"); onText(text); }
        } catch (error) {
          if (token === generation) { update("idle"); onError(error.message || "语音识别失败。"); }
        }
      };
      recorder.start(1000);
      update("recording");
      timeout = timers.setTimeout(() => {
        // Never upload on a timer: only the explicit stop button authorizes upload.
        if (token === generation) { cancel(); onError("录音已达 3 分钟上限，已取消且未上传，请缩短后重试。"); }
      }, 3 * 60_000);
    } catch (error) {
      if (token === generation) {
        cancel();
        onError(error.name === "NotAllowedError" ? "麦克风权限被拒绝，请检查系统隐私设置。" : error.name === "NotFoundError" ? "未找到麦克风。" : error.message || "无法开始录音。");
      }
    } finally { pending = false; }
  };
  const stop = () => {
    if (state !== "recording") return;
    timers.clearTimeout(timeout);
    uploadAuthorized = true;
    update("stopping");
    try { recorder.stop(); } catch { cancel(); onError("无法结束录音，请重试。"); }
    release();
  };
  return { start, stop, cancel, state: () => state, stream: () => stream };
}
