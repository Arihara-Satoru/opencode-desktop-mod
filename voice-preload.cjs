// This bridge has a fixed allowlist, not arbitrary ipcRenderer access.
{
  const { contextBridge, ipcRenderer } = require("electron");
  const call = (action, data) => ipcRenderer.invoke("oc-mod:voice", action, data);
  contextBridge.exposeInMainWorld("__ocVoice", {
    config: () => call("config"),
    save: data => call("save", data),
    arm: () => call("arm"),
    cancel: () => call("cancel"),
    transcribe: (bytes, mime) => call("transcribe", { bytes, mime }),
  });
}
