// Match the normal prompt path, not shell/commands or arbitrary SDK requests.
// Fail before writing the archive if an upstream release changes this contract.
export function patchLongTextComposer(source) {
  const pattern = /async function ([\w$]+)\(([\w$]+),([\w$]+),([\w$]+)\)\{let ([\w$]+)=await ([\w$]+)\(\2,\3\),([\w$]+)=async\(\)=>\{/g;
  let count = 0;
  const result = source.replace(pattern, (all, fn, session, prompt, track, data, serialize) => {
    // Verify this function actually delivers a serialized native user prompt.
    const start = source.indexOf(all);
    const end = source.indexOf("async function ", start + all.length);
    const body = source.slice(start, end < 0 ? source.length : end);
    if (!body.includes(".data.session.prompt(") || !body.includes(`displayText:${data}.displayText`)) return all;
    count++;
    return all.replace(`await ${serialize}(${session},${prompt})`, `__oc_prepare_long_text(await ${serialize}(${session},${prompt}),${prompt})`);
  });
  if (count !== 1) throw new Error(`无法安全定位长文本发送流程（匹配 ${count} 处），未写入补丁。`);
  // Use the native controller, not synthetic input or a second draft store.
  // Its file mentions persist url/mime/filename and survive native retries.
  const editor = /setEditor\(([\w$]+)\)\{([\w$]+)=\1,([\w$]+)\.onEditor\?\.\(\1\)\},restoreFocus:([\w$]+),onInput\(/g;
  let editors = 0;
  const bound = result.replace(editor, (all, node) => {
    editors++;
    return all.replace(`.onEditor?.(${node})}`, `.onEditor?.(${node}),__oc_bind_long_text(${node},this)}`);
  });
  if (editors !== 1) throw new Error(`无法安全定位长文本草稿控制器（匹配 ${editors} 处），未写入补丁。`);
  return `import { prepareLongText as __oc_prepare_long_text, bindLongTextComposer as __oc_bind_long_text } from "./long-text.mjs";\n${bound}`;
}
