// Attach the originating MountedSession to the native Markdown handler. Never
// use the currently selected project: cached timelines can belong to another one.
export function patchFileActionsRenderer(source) {
  const handler = /openLocalFile:([\w$]+)=>void ([\w$]+)\.links\.open\(\{href:\1,session:([\w$]+)\.session\}\)/g;
  const root = /([\w$]+)\.toggleAttribute\([`'"]data-local-links[`'"],!!([\w$]+)\?\.openLocalFile\)/g;
  let handlers = 0, roots = 0;
  let result = source.replace(handler, (all, href, host, props) => {
    handlers++;
    return `openLocalFile:Object.assign(${href}=>void ${host}.links.open({href:${href},session:${props}.session}),{__ocFileContext:()=>${props}.session})`;
  });
  result = result.replace(root, (all, container, markdown) => {
    roots++;
    return `${all},window.__ocBindFileRoot?.(${container},()=>${markdown}?.openLocalFile?.__ocFileContext?.())`;
  });
  if (handlers !== 1 || roots !== 1) throw new Error(`无法安全接入文件操作（handler=${handlers}, root=${roots}），未写入补丁。`);
  return result;
}
