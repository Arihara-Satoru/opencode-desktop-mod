export function patchVoiceDesktopMain(source) {
  const request = /([\w$]+)\.webContents\.session\.setPermissionRequestHandler\(\(([\w$]+),([\w$]+),([\w$]+),([\w$]+)\)=>\{([\s\S]*?)([\w$]+)\(([\w$]+)\.has\(\3\)&&([\w$]+)\(\5\.requestingUrl\)&&\2\.id===([\w$]+)\)\}\)/g;
  let count = 0;
  let result = source.replace(request, (all, win, contents, permission, callback, details, prefix, hasFn, setVar, urlFn, winId) => {
    count++;
    return `${win}.webContents.session.setPermissionRequestHandler((${contents},${permission},${callback},${details})=>{if(__oc_allow_voice_media(${contents},${permission},${details}))return ${callback}(!0);${prefix}${hasFn}(${setVar}.has(${permission})&&${urlFn}(${details}.requestingUrl)&&${contents}.id===${winId})})`;
  });
  const check = /([\w$]+)\.webContents\.session\.setPermissionCheckHandler\(\(([\w$]+),([\w$]+),([\w$]+),([\w$]+)\)=>([^;]+?)\)\}/g;
  let checkCount = 0;
  result = result.replace(check, (all, win, contents, permission, origin, details, body) => {
    checkCount++;
    return `${win}.webContents.session.setPermissionCheckHandler((${contents},${permission},${origin},${details})=>__oc_allow_voice_media(${contents},${permission},${details},${origin})||(${body}))}`;
  });

  // 2.2.5 shares one handler pair across desktop windows in an Electron Session.
  // Match the pair together so request/check cannot refer to different Sessions,
  // live-window Sets or trust predicates. Leave registration/cleanup untouched.
  const shared = /([\w$]+)\.setPermissionRequestHandler\(\(([\w$]+),([\w$]+),([\w$]+),([\w$]+)\)=>\{(if\(\3===[`'"]media[`'"]\)\{[^{}]*;return\})\4\(([\w$]+)\.has\(\3\)&&([\w$]+)\(\5\.requestingUrl\)&&([\w$]+)\.has\(\2\.id\)\)\}\),\1\.setPermissionCheckHandler\(\(([\w$]+),([\w$]+),([\w$]+),([\w$]+)\)=>([^;{}]+?)\),\9\}/g;
  result = result.replace(shared, (all, session, contents, permission, callback, details, prefix, allowed, trusted, windows, checkContents, checkPermission, origin, checkDetails, body) => {
    const expected = `${checkPermission}===\`media\`?${checkContents}!==null&&${windows}.has(${checkContents}.id)&&${trusted}(${checkDetails}.requestingUrl)&&${checkDetails}.isMainFrame&&${checkDetails}.mediaType===\`audio\`:!${allowed}.has(${checkPermission})||(${checkContents}?!${windows}.has(${checkContents}.id):${windows}.size===0)?!1:${trusted}(${checkDetails}.requestingUrl)||${trusted}(${origin})`;
    if (body !== expected) return all;
    count++;
    checkCount++;
    const requestStart = `${session}.setPermissionRequestHandler((${contents},${permission},${callback},${details})=>{`;
    const checkStart = `${session}.setPermissionCheckHandler((${checkContents},${checkPermission},${origin},${checkDetails})=>`;
    return all.replace(requestStart, `${requestStart}if(${contents}!==null&&${windows}.has(${contents}.id)&&__oc_allow_voice_media(${contents},${permission},${details}))return ${callback}(!0);`)
      .replace(checkStart + body, `${checkStart}${checkContents}!==null&&${windows}.has(${checkContents}.id)&&__oc_allow_voice_media(${checkContents},${checkPermission},${checkDetails},${origin})||(${body})`);
  });
  const requestHandlers = (source.match(/\.setPermissionRequestHandler\(/g) ?? []).length;
  const checkHandlers = (source.match(/\.setPermissionCheckHandler\(/g) ?? []).length;
  if (count !== 1 || checkCount !== 1 || requestHandlers !== 1 || checkHandlers !== 1) throw new Error(`无法安全定位麦克风权限检查（request=${count}, check=${checkCount}），未写入补丁。`);
  return `import { allowVoiceMedia as __oc_allow_voice_media } from "./voice-main.mjs";\n${result}`;
}
