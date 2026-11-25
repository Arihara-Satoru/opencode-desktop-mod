// Native Markdown markers only; no document-wide path guessing or DOM rewriting.
export function fileLinkTarget(element, root) {
  const link = element?.closest?.('a[data-local-link]') || element?.closest?.(':not(pre) > code[data-inline-code-kind="path"]');
  if (!link || !root.contains(link)) return;
  if (link.closest?.('[data-component="markdown"]') !== root) return;
  if (link.tagName === "CODE" && link.closest("a")) return;
  const path = link.tagName === "A" ? link.dataset.localLink : link.textContent?.trim();
  if (path) return { link, path };
}

export function fileSessionContext(session) {
  // A loopback URL can be an SSH tunnel. Only the host's local flag counts.
  if (!session || session.server?.local !== true || session.location?.workspaceID) return;
  const directory = session.directory;
  if (typeof directory !== "string" || !directory) return;
  return { directory, local: true };
}

export function bindFileRoot(root, session, bridge, report) {
  const target = event => {
    const file = fileLinkTarget(event.target, root);
    const context = file && fileSessionContext(session());
    return context && { ...context, path: file.path };
  };
  const invoke = (action, data) => Promise.resolve().then(() => bridge[action](data)).catch(report);
  const click = event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const data = target(event);
    if (!data) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void invoke("open", data);
  };
  const menu = event => {
    if (event.defaultPrevented) return;
    const data = target(event);
    if (!data) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void invoke("menu", data);
  };
  const key = event => {
    if (event.defaultPrevented || event.repeat) return;
    if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) return menu(event);
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) click({
      target: event.target, button: 0,
      preventDefault: () => event.preventDefault(), stopImmediatePropagation: () => event.stopImmediatePropagation(),
    });
  };
  root.addEventListener("click", click, true);
  root.addEventListener("contextmenu", menu, true);
  root.addEventListener("keydown", key, true);
  return () => {
    root.removeEventListener("click", click, true);
    root.removeEventListener("contextmenu", menu, true);
    root.removeEventListener("keydown", key, true);
  };
}

if (typeof window !== "undefined" && window.__ocFiles && !window.__ocBindFileRoot) {
  const roots = new WeakMap();
  const report = error => {
    const message = error?.message || "文件操作失败。";
    const ext = window.__oc_app_ext;
    if (ext?.toast?.show) ext.toast.show({ variant: "error", title: "文件操作失败", description: message });
    else window.alert(message);
  };
  window.__ocBindFileRoot = (root, session) => {
    const existing = roots.get(root);
    if (existing) { existing.session = session; return; }
    const state = { session };
    roots.set(root, state);
    bindFileRoot(root, () => state.session(), window.__ocFiles, report);
  };
}
