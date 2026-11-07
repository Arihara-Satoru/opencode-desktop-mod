// Resolve meanings, never minifier-local names: those change on every release.
function readExports(main) {
  const exports = new Map();
  const exportBlock = main.slice(main.lastIndexOf("export{") + 7).split("}")[0];
  for (const entry of exportBlock.split(",")) {
    const [internal, external = internal] = entry.trim().split(/\s+as\s+/);
    exports.set(internal, external);
  }
  return exports;
}

export function resolveTooltipSymbol(main, createComponent, Show) {
  const exports = readExports(main);
  // 2.2.6 moved the implementation behind an inactive/fallback wrapper. Resolve
  // the prop-splitting implementation first, not a later property read or caller.
  const implementations = [...main.matchAll(/function\s+([\w$]+)\(([\w$]+)\)\{[^{}]*?\[([\w$]+),([\w$]+)\]=[\w$]+\(\2,\[([^\]]+)\]\)/g)]
    .filter(match => match[5].split(",").includes("`triggerTabIndex`"));
  if (implementations.length !== 1) throw new Error(`无法安全解析 Tooltip 实现（匹配 ${implementations.length} 处），未写入补丁。`);
  const implementation = implementations[0][1];
  const componentInternal = [...exports].find(([, external]) => external === createComponent)?.[0];
  const showInternal = [...exports].find(([, external]) => external === Show)?.[0];
  const wrappers = [...main.matchAll(/function\s+([\w$]+)\(([\w$]+)\)\{return ([\w$]+)\(([\w$]+),\{get when\(\)\{return!\2\.inactive\},get fallback\(\)\{return \2\.children\},get children\(\)\{return \3\(([\w$]+),\2\)\}\}\)\}/g)]
    .filter(match => match[3] === componentInternal && match[4] === showInternal && match[5] === implementation);
  if (wrappers.length > 1 || (wrappers.length && exports.has(implementation))) throw new Error("无法安全解析 Tooltip 包装组件（存在歧义），未写入补丁。");
  const name = wrappers.length ? wrappers[0][1] : implementation;
  if (!exports.has(name)) throw new Error("无法安全解析 Tooltip 组件（未导出或未知包装结构），未写入补丁。");
  return exports.get(name);
}

export function resolvePanelSymbols(panel, route, main) {
  const exports = readExports(main);
  function find(label, pattern) {
    const names = [...new Set([...main.matchAll(pattern)].map(match => match[1]))];
    if (names.length !== 1 || !exports.has(names[0])) {
      throw new Error(`无法安全解析 ${label}（匹配 ${names.length} 处或未导出），未写入补丁。`);
    }
    return exports.get(names[0]);
  }
  function component(label, marker) {
    const index = main.indexOf(marker);
    if (index < 0) throw new Error(`缺少 ${label} 组件标记，未写入补丁。`);
    // These prop/DOM markers sit at the start of their component functions.
    const declaration = main.slice(main.lastIndexOf("function ", index), index);
    const name = declaration.match(/^function\s+([\w$]+)\(/)?.[1];
    if (!name || !exports.has(name)) throw new Error(`无法安全解析 ${label} 组件，未写入补丁。`);
    return exports.get(name);
  }
  const symbols = {
    createSignal: find("createSignal", /function\s+([\w$]+)\([\w$]+,[\w$]+\)\{[\w$]+=[\w$]+\?Object\.assign\(\{\},[\w$]+,[\w$]+\):[\w$]+;let [\w$]+=\{value:/g),
    createMemo: find("createMemo", /function\s+([\w$]+)\([\w$]+,[\w$]+,[\w$]+\)\{[\w$]+=[\w$]+\?Object\.assign\(\{\},[\w$]+,[\w$]+\):[\w$]+;let [\w$]+=[\w$]+\([\w$]+,[\w$]+,!0,0\);return [\w$]+\.observers=null/g),
    createEffect: find("createEffect", /function\s+([\w$]+)\([\w$]+,[\w$]+,[\w$]+\)\{[^{}]{0,350}\.user=!0/g),
    onCleanup: find("onCleanup", /function\s+([\w$]+)\([\w$]+\)\{return [\w$]+===null\|\|\([^{}]*\.cleanups\.push\([\w$]+\)\),[\w$]+\}/g),
    createComponent: find("createComponent", /function\s+([\w$]+)\([\w$]+,[\w$]+\)\{if\([^{}]*\.context\)\{(?:(?!function\s)[\s\S]){0,350}?\}return [\w$]+\(\(\)=>[\w$]+\([\w$]+\|\|\{\}\)\)\}/g),
    Show: find("Show", /function\s+([\w$]+)\([\w$]+\)\{let [\w$]+=[\w$]+\.keyed,[\w$]+=[\w$]+\(\(\)=>[\w$]+\.when/g),
    For: find("For", /For:\(\)=>([\w$]+),Index:/g),
    template: find("template", /function\s+([\w$]+)\([\w$]+,[\w$]+,[\w$]+,[\w$]+\)\{let [\w$]+,[\w$]+=\(\)=>\{let [\w$]+=[\w$]+\?document\.createElementNS/g),
    insert: find("insert", /function\s+([\w$]+)\([\w$]+,[\w$]+,[\w$]+,[\w$]+\)\{if\([\w$]+!==void 0&&!/g),
    useExtension: find("usePlugin/useExtension", /function\s+([\w$]+)\(\)\{let\s+[\w$]+=[\w$]+\([\w$]+\);if\(![\w$]+\)throw Error\([`'"]use(?:Plugin must run inside a plugin|Extension must run inside an extension) contribution[`'"]\)/g),
    IconButton: component("IconButton", '"data-component":`icon-button-v2`'),
    Button: component("Button", '"data-component":`button-v2`'),
    Icon: find("Icon", /function\s+([\w$]+)\([\w$]+\)\{let\[[\w$]+,[\w$]+\]=[\w$]+\([\w$]+,\[`name`,`size`\]\)/g),
    showToast: find("showToast", /function\s+([\w$]+)\([\w$]+\)\{[^{}]{0,150}\{description:[\w$]+\}[^{}]{0,150}\{title:[\w$]+\.title,description:/g),
  };
  symbols.Tooltip = resolveTooltipSymbol(main, symbols.createComponent, symbols.Show);
  // New releases inline Markdown and TextShimmer into main instead of chunks.
  const imports = panel.match(/import\{([^}]+)\}from["']\.\/main-[^"']+["']/)?.[1] || "";
  const panelImports = new Map(imports.split(",").map(part => {
    const [external, local = external] = part.trim().split(/\s+as\s+/);
    return [local, external];
  }));
  for (const [label, pattern] of [
    ["Markdown", /[\w$]+\(([\w$]+),\{get text\(\)\{return [\w$]+\(\)(?:\.answer)?\},class:`text-14-regular`/],
    ["TextShimmer", /[\w$]+\(([\w$]+),\{get text\(\)\{return [\w$]+\.t\(`session\.timeline\.working`\)/],
  ]) {
    const external = panelImports.get(panel.match(pattern)?.[1]);
    if (external) {
      if (![...exports.values()].includes(external)) throw new Error(`${label} 未从主模块导出，未写入补丁。`);
      symbols[label] = external;
    }
  }
  return symbols;
}

export function resolvePanelChunkImport(panel, label) {
  const pattern = label === "Markdown"
    ? /[\w$]+\(([\w$]+),\{get text\(\)\{return [\w$]+\(\)(?:\.answer)?\},class:`text-14-regular`/g
    : /[\w$]+\(([\w$]+),\{get text\(\)\{return [\w$]+\.t\(`session\.timeline\.working`\)/g;
  const locals = [...new Set([...panel.matchAll(pattern)].map(match => match[1]))];
  if (locals.length !== 1) throw new Error(`无法安全解析 ${label} 调用，未写入补丁。`);
  const candidates = [];
  for (const match of panel.matchAll(/import\{([^}]+)\}from["']\.\/([^"']+)["']/g)) {
    for (const entry of match[1].split(",")) {
      const [external, local = external] = entry.trim().split(/\s+as\s+/);
      if (local === locals[0] && !/^main-/.test(match[2])) candidates.push({ file: match[2], external });
    }
  }
  if (candidates.length !== 1) throw new Error(`无法安全解析 ${label} 模块导入，未写入补丁。`);
  return candidates[0];
}
