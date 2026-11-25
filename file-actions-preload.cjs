// No generic IPC, command, process or filesystem API is exposed to the page.
{
  const { contextBridge, ipcRenderer } = require("electron");
  contextBridge.exposeInMainWorld("__ocFiles", {
    open: target => ipcRenderer.invoke("oc-mod:files", "open", target),
    menu: target => ipcRenderer.invoke("oc-mod:files", "menu", target),
  });
}
