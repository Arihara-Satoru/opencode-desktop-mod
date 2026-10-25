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
  return `import { prepareLongText as __oc_prepare_long_text } from "./long-text.mjs";\n${result}`;
}
