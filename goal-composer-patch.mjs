// The native composer still owns snapshots, attachments, model selection,
// delivery, optimistic history and retry. Only explicit goal-mode sends carry
// our admission metadata; no synthetic clicks or second sender are introduced.
export function patchGoalComposer(source, symbols) {
  const local = exported => {
    const matches = [...source.matchAll(/import\{([^}]+)\}from["'][^"']+["']/g)]
      .flatMap(match => match[1].split(",").map(item => item.trim().split(/\s+as\s+/)))
      .filter(([name]) => name === exported);
    if (matches.length !== 1) throw new Error("无法安全解析目标输入框的 Solid 生命周期，未写入补丁。");
    return matches[0][1] || matches[0][0];
  };
  const effect = local(symbols.createEffect), cleanup = local(symbols.onCleanup);
  const parts = [...source.matchAll(/parts\(\)\{return ([\w$]+)\.state\.prompt\}/g)];
  if (parts.length !== 1) throw new Error("无法安全定位目标草稿状态，未写入补丁。");
  const replace = (pattern, run, label) => {
    let count = 0;
    source = source.replace(pattern, (...args) => { count++; return run(...args); });
    if (count !== 1) throw new Error(`无法安全定位目标${label}（匹配 ${count} 处），未写入补丁。`);
  };
  replace(/setEditor\(([\w$]+)\)\{([\w$]+)=\1,([\w$]+)\.onEditor\?\.\(\1\)([^}]*?)\},restoreFocus:/g,
    (all, editor) => all.replace("},restoreFocus:", `,${effect}(()=>__oc_bind_goal(${editor},this,()=>${parts[0][1]}.state,${effect},${cleanup}))},restoreFocus:`), "草稿控制器");
  // Capture the mode synchronously, before uploads/new-session handoff can
  // change the route. Never consult the currently focused form during send.
  replace(/return\{draft:\{initial:([\w$]+),target:\1,([\s\S]*?)session:([\w$]+)\.adapter\.kind===`active-session`\?\3\.adapter\.session\(\):void 0\}\}/g,
    (all, draft, fields, host) => all.replace("return{draft:", `return __oc_capture_goal(${host}.editor?.(),{draft:`).replace(/\}\}$/, "})}"), "提交快照");
  replace(/([\w$]+)=\{mode:([\w$]+)\.mode,prompt:\2\.draft\.prompt,context:\2\.draft\.context,text:\2\.text,/g,
    (all, value, snapshot) => all.replace("={mode:", `={desktopGoal:${snapshot}.desktopGoal,mode:`), "快照交接");
  replace(/JSON\.stringify\(\[([\w$]+)\.mode,\1\.delivery,/g,
    (all, value) => all.replace(`[${value}.mode`, `[${value}.desktopGoal??null,${value}.mode`), "重试指纹");
  let sendingPrompt;
  replace(/async function ([\w$]+)\(([\w$]+),([\w$]+),([\w$]+)\)\{let ([\w$]+)=(?:__oc_prepare_long_text\()?await ([\w$]+)\(\2,\3\)(?:,\3\))?,([\w$]+)=async\(\)=>\{/g,
    (all, fn, session, prompt) => { sendingPrompt = prompt; return all.replace("{let ", `{__oc_check_goal(${prompt});let `); }, "原生发送入口");
  replace(/metadata:\{displayText:([\w$]+)\.displayText,comments:\1\.comments,attachments:\1\.attachments,agent:([\w$]+)\.selection\.agent,/g,
    (all, data, prompt) => all.replace("metadata:{", `metadata:{...__oc_goal_metadata(${prompt}),`), "消息元数据");
  replace(/await ([\w$]+)\.data\.session\.prompt\(([\w$]+)\)\.catch\(\(\)=>\1\.data\.session\.prompt\(\2\)\)\}/g,
    all => all.replace(/\}$/, `;__oc_goal_sent(${sendingPrompt})}`), "发送成功边界");
  return `import { bindGoalComposer as __oc_bind_goal, captureGoalSnapshot as __oc_capture_goal, checkGoalSend as __oc_check_goal, goalMetadata as __oc_goal_metadata, goalSent as __oc_goal_sent } from "./goal-composer.mjs";\n${source}`;
}
