// Resolve meanings, never minifier-local names: those change on every release.
export function resolvePanelSymbols(panel, route, main) {
  const exports = new Map();
  const exportBlock = main.slice(main.lastIndexOf("export{") + 7).split("}")[0];
  for (const entry of exportBlock.split(",")) {
    const [internal, external = internal] = entry.trim().split(/\s+as\s+/);
    exports.set(internal, external);
  }
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
    template: find("template", /function\s+([\w$]+)\([\w$]+,[\w$]+,[\w$]+,[\w$]+\)\{let [\w$]+,[\w$]+=\(\)=>\{let [\w$]+=[\w$]+\?document\.createElementNS/g),
    insert: find("insert", /function\s+([\w$]+)\([\w$]+,[\w$]+,[\w$]+,[\w$]+\)\{if\([\w$]+!==void 0&&!/g),
    useExtension: find("usePlugin/useExtension", /function\s+([\w$]+)\(\)\{let\s+[\w$]+=[\w$]+\([\w$]+\);if\(![\w$]+\)throw Error\([`'"]use(?:Plugin must run inside a plugin|Extension must run inside an extension) contribution[`'"]\)/g),
    Tooltip: component("Tooltip", "`triggerTabIndex`"),
    IconButton: component("IconButton", '"data-component":`icon-button-v2`'),
    Button: component("Button", '"data-component":`button-v2`'),
    Icon: find("Icon", /function\s+([\w$]+)\([\w$]+\)\{let\[[\w$]+,[\w$]+\]=[\w$]+\([\w$]+,\[`name`,`size`\]\)/g),
    showToast: find("showToast", /function\s+([\w$]+)\([\w$]+\)\{[^{}]{0,150}\{description:[\w$]+\}[^{}]{0,150}\{title:[\w$]+\.title,description:/g),
  };
  const routeImportBlock = route.match(/import\{([^}]+)\}from["']\.\/main-[^"']+["']/)?.[1] || "";
  const routeImports = new Map(routeImportBlock.split(",").map(part => {
    const [external, local = external] = part.trim().split(/\s+as\s+/);
    return [local, external];
  }));
  symbols.For = routeImports.get(route.match(/([\w$]+),\{get each\(\)/)?.[1]);
  if (!symbols.For) throw new Error("无法安全解析 For，未写入补丁。");
  // New releases inline Markdown and TextShimmer into main instead of chunks.
  const imports = panel.match(/import\{([^}]+)\}from["']\.\/main-[^"']+["']/)?.[1] || "";
  const panelImports = new Map(imports.split(",").map(part => {
    const [external, local = external] = part.trim().split(/\s+as\s+/);
    return [local, external];
  }));
  for (const [label, pattern] of [
    ["Markdown", /[\w$]+\(([\w$]+),\{get text\(\)\{return [\w$]+\(\)\},class:`text-14-regular`/],
    ["TextShimmer", /[\w$]+\(([\w$]+),\{get text\(\)\{return [\w$]+\.t\(`session\.timeline\.working`\)/],
  ]) {
    const external = panelImports.get(panel.match(pattern)?.[1]);
    if (external) symbols[label] = external;
  }
  return symbols;
}
