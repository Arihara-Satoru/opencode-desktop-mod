const filter = /\.\.\.([\w$]+)\.groups\.flatMap\(([\w$]+)=>\{let ([\w$]+)=\2\.items\.filter\(([\w$]+)=>!([\w$]+)\.has\(([\w$]+)\(\4\)\)\);return \3\.length>0\?\[\{\.\.\.\2,items:\3\}\]:\[\]\}\)/g;
const rows = /([\w$]+)\(\)\.flatMap\(([\w$]+)=>\2\.items\.map\(([\w$]+)=>\(\{id:([\w$]+)\(\3\),item:\3,group:\2\}\)\)\)/g;
const memoRows = /([\w$]+)\(\)\.flatMap\(([\w$]+)=>\2\.items\.map\(([\w$]+)=>\{let ([\w$]+)=([\w$]+)\.get\(([\w$]+)\(\3\)\);return \4\?\.item===\3&&\4\.section===\2\.category&&\4\.title===\2\.title\?\4:\{id:\6\(\3\),item:\3,section:\2\.category,title:\2\.title\}\}\)\)/g;

export function isModelPickerChunk(source) {
  return source.includes('dialog.model.recent') &&
    (source.includes('/*oc-model-picker*/') || [...source.matchAll(filter)].length > 0);
}

// Keep shortcut sections independent from the configured provider lists.
export function patchModelPicker(source) {
  if (source.includes('/*oc-model-picker*/')) return source;
  const filters = [...source.matchAll(filter)];
  const mappings = [...source.matchAll(rows)], memoMappings = [...source.matchAll(memoRows)];
  if (!source.includes('dialog.model.recent') || filters.length !== 1 || mappings.length + memoMappings.length !== 1) {
    throw new Error('无法安全定位模型选择器分组与行标识，未写入补丁。');
  }
  if (memoMappings.length) {
    const mapping = memoMappings[0];
    const modelKey = mapping[6];
    const list = source.slice(0, mapping.index).match(/([\w$]+)=[\w$]+\([\w$]+=>\{let [\w$]+=new Map\([\w$]+\.map\([\w$]+=>\[[\w$]+\.id,[\w$]+\]\)\);return $/)?.[1];
    const selected = /([\w$]+)=\(\)=>[\w$]+\(([\w$]+)\.model\.id\),[\w$]+=\(\)=>\2\.attrs\[`data-active`\]/g;
    const favorite = /([\w$]+)\?\.setActive\(([\w$]+)\(([\w$]+)\)\),([\w$]+)\(\{type:`keyboard`,id:\2\(\3\),repeat:!1\}\)/g;
    const favorites = [...source.matchAll(favorite)].filter(m => m[2] === modelKey);
    if (!list || [...source.matchAll(selected)].length !== 1 || favorites.length !== 1) {
      throw new Error('无法安全定位模型选择器的当前模型或收藏导航，未写入补丁。');
    }
    const [favoriteCall, widget, key, item, dispatch] = favorites[0];
    return source.replace(filter, '...$1.groups.filter(group=>group.items.length>0)/*oc-model-picker*/')
      .replace(memoRows, '$1().flatMap($2=>$2.items.map($3=>{let __oc_row=JSON.stringify([$2.category,$6($3)]),$4=$5.get(__oc_row);return $4?.item===$3&&$4.section===$2.category&&$4.title===$2.title?$4:{id:__oc_row,item:$3,section:$2.category,title:$2.title}}))')
      .replace(selected, (all, binding, row) => all.replace(`${row}.model.id`, `${modelKey}(${row}.model.item)`))
      .replace(favoriteCall, () => `(()=>{let __oc_rows=${list}(),__oc_active=${widget}?.active()?.id,__oc_model=${key}(${item}),__oc_id=(__oc_rows.find(row=>row.id===__oc_active&&${key}(row.item)===__oc_model)??__oc_rows.find(row=>${key}(row.item)===__oc_model))?.id;__oc_id&&${widget}?.setActive(__oc_id),${dispatch}({type:\`keyboard\`,id:__oc_id,repeat:!1})})()`);
  }
  return source
    .replace(filter, '...$1.groups.filter(group=>group.items.length>0)/*oc-model-picker*/')
    .replace(rows, '$1().flatMap($2=>$2.items.map($3=>({id:JSON.stringify([$2.category,$4($3)]),item:$3,group:$2})))');
}
