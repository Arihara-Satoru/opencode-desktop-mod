export function patchVoiceDesktopMain(source) {
  const request = /([\w$]+)\.webContents\.session\.setPermissionRequestHandler\(\(([\w$]+),([\w$]+),([\w$]+),([\w$]+)\)=>\{([\w$]+)\(([\w$]+)\.has\(([\w$]+)\)&&([\w$]+)\(([\w$]+)\.requestingUrl\)&&([\w$]+)\.id===([\w$]+)\)\}\)/g;
  let count = 0;
  let result = source.replace(request, (all, win, contents, permission, callback, details) => {
    count++;
    return all.replace(`{${callback}(`, `{if(__oc_allow_voice_media(${contents},${permission},${details}))return ${callback}(!0);${callback}(`);
  });
  const check = /([\w$]+)\.webContents\.session\.setPermissionCheckHandler\(\(([\w$]+),([\w$]+),([\w$]+),([\w$]+)\)=>([^;]+?)\)\}/g;
  let checkCount = 0;
  result = result.replace(check, (all, win, contents, permission, origin, details, body) => {
    checkCount++;
    return `${win}.webContents.session.setPermissionCheckHandler((${contents},${permission},${origin},${details})=>__oc_allow_voice_media(${contents},${permission},${details},${origin})||(${body}))}`;
  });
  if (count !== 1 || checkCount !== 1) throw new Error(`无法安全定位麦克风权限检查（request=${count}, check=${checkCount}），未写入补丁。`);
  return `import { allowVoiceMedia as __oc_allow_voice_media } from "./voice-main.mjs";\n${result}`;
}
