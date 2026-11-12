// Keep shortcut sections independent from the configured provider lists.
export function patchModelPicker(source) {
  if (source.includes('/*oc-model-picker*/')) return source;
  const filter = /\.\.\.([\w$]+)\.groups\.flatMap\(([\w$]+)=>\{let ([\w$]+)=\2\.items\.filter\(([\w$]+)=>!([\w$]+)\.has\(([\w$]+)\(\4\)\)\);return \3\.length>0\?\[\{\.\.\.\2,items:\3\}\]:\[\]\}\)/g;
  const rows = /([\w$]+)\(\)\.flatMap\(([\w$]+)=>\2\.items\.map\(([\w$]+)=>\(\{id:([\w$]+)\(\3\),item:\3,group:\2\}\)\)\)/g;
  const filters = [...source.matchAll(filter)];
  const mappings = [...source.matchAll(rows)];
  if (!source.includes('dialog.model.recent') || filters.length !== 1 || mappings.length !== 1) {
    throw new Error('无法安全定位模型选择器分组与行标识，未写入补丁。');
  }
  return source
    .replace(filter, '...$1.groups.filter(group=>group.items.length>0)/*oc-model-picker*/')
    .replace(rows, '$1().flatMap($2=>$2.items.map($3=>({id:JSON.stringify([$2.category,$4($3)]),item:$3,group:$2})))');
}
