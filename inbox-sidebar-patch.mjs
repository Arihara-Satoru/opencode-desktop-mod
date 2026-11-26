// Group the native list, so its cards, archive, pins and commands keep using the
// official stores. This function is embedded in the renderer bundle as-is.
export function createInboxDirectories(recent, pinned, rows, memo, signal) {
  const storageKey = "opencode-mod.inbox.collapsed-directories";
  let saved = [];
  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(value)) saved = value.filter(key => typeof key === "string");
  } catch { /* Storage can be disabled. */ }
  const [collapsed, setCollapsed] = signal(new Set(saved));
  const grouped = memo(() => {
    const directories = new Map();
    const pins = [];
    for (const entry of recent()) {
      if (pinned(entry)) {
        pins.push(entry);
        continue;
      }
      const path = entry.session.location.directory;
      const windows = /^[a-z]:[\\/]|^\\\\/i.test(path);
      const normalized = (windows ? path.replaceAll("\\", "/") : path).replace(/\/+$/, "") || "/";
      const key = JSON.stringify([entry.server, windows ? normalized.toLowerCase() : normalized]);
      if (!directories.has(key)) directories.set(key, { label: normalized.split("/").at(-1) || normalized, entries: [] });
      directories.get(key).entries.push(entry);
    }
    return { directories, pins };
  });
  const pinnedSection = {
    id: "oc-inbox-pins", label: "", unlabeled: true,
    get count() { return grouped().pins.length; },
    rows: () => rows(() => grouped().pins),
  };
  let serial = 0;
  let sections = new Map();
  const groups = memo(() => {
    const next = new Map();
    for (const key of grouped().directories.keys()) {
      const group = () => grouped().directories.get(key);
      next.set(key, sections.get(key) ?? {
        id: `oc-directory-${++serial}`,
        get label() { return group()?.label ?? ""; },
        get count() { return group()?.entries.length ?? 0; },
        get expanded() { return !collapsed().has(key); },
        rows: () => rows(() => group()?.entries ?? [], true),
        onToggle() {
          const next = new Set(collapsed());
          if (!next.delete(key)) next.add(key);
          setCollapsed(next);
          try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* Optional persistence. */ }
        },
      });
    }
    sections = next;
    return [pinnedSection, ...next.values()];
  });
  return {
    groups,
    visible: () => [...grouped().pins, ...[...grouped().directories].flatMap(([key, group]) => collapsed().has(key) ? [] : group.entries)],
  };
}

export function patchInboxSidebar(source, signal) {
  // Match the 2.4.2 Inbox contract as a unit. If any link changes, leave the
  // entire native implementation intact instead of shipping a partial patch.
  const rows = /let ([\w$]+)=([\w$]+)=>[\w$]+\([\w$]+,\{get each\(\)\{return \2\(\)\.map\([\w$]+=>[\w$]+\.key\)\},children:[\s\S]{0,300}?=>[\w$]+\(([\w$]+),\{ref:/;
  const recent = /\{id:`recent`,get label\(\)\{return [\w$]+\.t\(`sidebar\.inbox\.section\.recent`\)\},unlabeled:!0,get count\(\)\{return ([\w$]+)\(\)\.recent\.length\},rows:\(\)=>[\w$]+\(\(\)=>\1\(\)\.recent\),more:/;
  const sectionStart = /;return [\w$]+\([\w$]+,\{get loading\(\)\{return [\w$]+\.loading\(\)\},get announcement\(\)\{return [\w$]+\.text\},current:\{get count\(\)\{return [\w$]+\(\)\.current\.length\},rows:\(\)=>[\w$]+\(\(\)=>[\w$]+\(\)\.current\)\},sections:\[/;
  const navigation = /return\[\.\.\.([\w$]+)\.current,\.\.\.\1\.needs,\.\.\.\1\.recent,([^;]+?)\]\.map\(([\w$]+)=>\3\.key\)/;
  const recentMatch = source.match(recent);
  if (!recentMatch || !signal) return source;
  const prefix = source.slice(Math.max(0, recentMatch.index - 12000), recentMatch.index);
  const start = [...prefix.matchAll(/function [\w$]+\(\)\{let [\w$]+=[\w$]+\(\),[\w$]+=[\w$]+\(\),[\w$]+=[\w$]+\(\),[\w$]+=[\w$]+\(\{archived:!0\}\)/g)].at(-1);
  const tail = source.slice(recentMatch.index);
  const finish = tail.match(/\}\],working:\{get count\(\)\{return [\w$]+\(\)\?/);
  if (!start || !finish) return source;
  const offset = recentMatch.index - prefix.length + start.index;
  const end = recentMatch.index + finish.index + 2;
  let inbox = source.slice(offset, end);
  const row = inbox.match(rows);
  const section = inbox.match(sectionStart);
  const nav = inbox.match(navigation);
  const model = recentMatch[1];
  const modelMatch = inbox.match(new RegExp(`([\\w$]+)=([\\w$]+)=>[\\w$]+\\.pinned\\([\\w$]+\\(\\2\\)\\),${model.replaceAll("$", "\\$")}=([\\w$]+)\\(\\(\\)=>`));
  const settled = inbox.match(/([\w$]+)=([\w$]+)\.filter\(([\w$]+)=>\3\.status===`done`\|\|\3\.status===`failed`\|\|\3\.status===`ready`\)\.toSorted\(\(([\w$]+),([\w$]+)\)=>\(\5\.since\?\?0\)-\(\4\.since\?\?0\)\),([\w$]+)=\[\.\.\.([\w$]+),\.\.\.([\w$]+)\.recentExpanded\?\1:\1\.slice\(0,([\w$]+)\)\]/);
  const working = inbox.match(/([\w$]+)=([\w$]+)\.filter\(([\w$]+)=>\3\.status===`working`\)\.toSorted\(([\w$]+)\)/);
  const shown = inbox.match(/(=\[\.\.\.[\w$]+,\.\.\.([\w$]+)),\.\.\.([\w$]+)(,\.\.\.[\w$]+\.archivedExpanded\?)/);
  const refs = row?.[0] && inbox.slice(row.index + row[0].length).match(/^([\w$]+)=>\{([\w$]+)\.set\(([\w$]+),\1\),([\w$]+)\(\(\)=>\2\.get\(\3\)===\1&&\2\.delete\(\3\)\)\}/);
  if (!row || !section || !nav || !modelMatch || !settled || !working || !shown || !refs) return source;
  const [, candidates, active, , , , recentList, pins, state, limit] = settled;
  const [, workingList, workingActive, , compareWorking] = working;
  const [, element, rowRefs, key, cleanup] = refs;
  const allEntries = inbox.match(/\(\(\)=>\{let ([\w$]+)=[\w$]+\.entries\(\),[\w$]+=new Map\([\w$]+\([\w$]+\.state\)/)?.[1];
  const archived = [...inbox.matchAll(/([\w$]+)=[\w$]+\.filter\(([\w$]+)=>!([\w$]+)\(\2\)\),/g)]
    .find(match => match[1] === active)?.[3];
  const revealMatch = inbox.match(/([\w$]+)\.get\(([\w$]+)\)\?\.scrollIntoView\(/);
  const workingRows = new RegExp(`rows:\\(\\)=>${row[1].replaceAll("$", "\\$")}\\(\\(\\)=>${model.replaceAll("$", "\\$")}\\(\\)\\.working\\)`, "g");
  const cardStart = source.indexOf(`function ${row[3]}(`, end);
  if (active !== workingActive || shown[2] !== recentList || shown[3] !== workingList || !allEntries || !archived ||
    !revealMatch || revealMatch[1] !== rowRefs || !inbox.includes(`more:${candidates}.length>${limit}`) ||
    cardStart < 0 || [...source.slice(offset, cardStart).matchAll(workingRows)].length !== 2) return source;

  const cardPrefix = source.slice(cardStart, cardStart + 8000);
  const cardMatch = cardPrefix.match(/^function [\w$]+\(([\w$]+)\)\{[\s\S]+?(?=\}+[\w$]+\(\[`focusin`,`keydown`,`click`\]\);)/);
  if (!cardMatch) return source;
  const props = cardMatch[1];
  const card = cardMatch[0];
  const title = /var ([\w$]+)=[\w$]+\(\),([\w$]+)=\1\.firstChild,([\w$]+)=\2\.nextSibling;return/;
  const metadata = /var ([\w$]+)=[\w$]+\(\),([\w$]+)=\1\.firstChild,([\w$]+)=\2\.firstChild,([\w$]+)=\2\.nextSibling;return/;
  if (!title.test(card) || !metadata.test(card) || !card.includes('class:`group flex h-[54px]')) return source;
  const styledCard = card
    .replace('class:`group flex h-[54px]', `get style(){return ${props}.__ocDirectory?{height:"34px","flex-direction":"row","align-items":"center",gap:"8px"}:void 0},class:\`group flex h-[54px]`)
    .replace(title, (match, node) => `${match.slice(0,-6)}if(${props}.__ocDirectory)${node}.style.cssText="flex:1 1 0%;min-width:0";return`)
    .replace(metadata, (match, node, badges, label) => `${match.slice(0,-6)}if(${props}.__ocDirectory){${node}.style.cssText="width:auto;gap:4px;padding-inline-start:0";${badges}.style.flex="none";${label}.hidden=true}return`)
    // Keep the remote-server badge in flow when the metadata is no longer indented.
    .replace('class:`absolute start-0 top-0 flex size-4 shrink-0`', `get class(){return ${props}.__ocDirectory?\`flex size-4 shrink-0\`:\`absolute start-0 top-0 flex size-4 shrink-0\`}`);

  const [renderRows, list] = row.slice(1, 3);
  // Keep running sessions in the main list even outside the recent cutoff.
  // Sort the directory list by session activity, independent of the run timer.
  inbox = inbox.replace(settled[0], `${candidates}=${active}.filter(entry=>[\`done\`,\`failed\`,\`ready\`,\`working\`].includes(entry.status))` +
    `.toSorted((a,b)=>(b.session.time.idle??b.session.time.updated)-(a.session.time.idle??a.session.time.updated)),` +
    `${recentList}=[...${pins},...${state}.recentExpanded?${candidates}:${candidates}.filter((entry,index)=>index<${limit}||entry.status===\`working\`)]`);
  inbox = inbox.replace(working[0], `${workingList}=${allEntries}.filter(entry=>entry.status===\`working\`&&!${archived}(entry)).toSorted(${compareWorking})`);
  inbox = inbox.replace(shown[0], shown[1] + shown[4]).replace(`more:${candidates}.length>${limit}`, `more:${candidates}.slice(${limit}).some(entry=>entry.status!==\`working\`)`);

  inbox = inbox.replace(row[0], row[0].replace(`=${list}=>`, `=(${list},__ocDirectory=false,__ocWorkingView=false)=>`).replace("{ref:", "{__ocDirectory,ref:"));
  inbox = inbox.replace(refs[0], `${element}=>{const refs=__ocWorkingView?__ocWorkingRefs:${rowRefs};refs.set(${key},${element});${cleanup}(()=>refs.get(${key})===${element}&&refs.delete(${key}))}`);
  inbox = inbox.replace(revealMatch[0], `(${rowRefs}.get(${revealMatch[2]})??__ocWorkingRefs.get(${revealMatch[2]}))?.scrollIntoView(`);
  inbox = inbox.replace(nav[0], `return [...new Set([...${nav[1]}.current,...${nav[1]}.needs,...__ocDirectories.visible(),${nav[2]}].map(${nav[3]}=>${nav[3]}.key))]`);
  // Navigation registers immediately, so initialize the controller before it;
  // the rows callback is only invoked later by the native section renderer.
  const modelEnd = inbox.match(/shown:[\w$]+\}\}\),[\w$]+=new Map;/);
  if (!modelEnd) return source;
  inbox = inbox.replace(modelEnd[0], modelEnd[0].replace("),", `),__ocWorkingRefs=new Map,__ocDirectories=__ocCreateInboxDirectories(()=>${model}().recent,${modelMatch[1]},(...args)=>${renderRows}(...args),${modelMatch[3]},${signal}),`));
  // Keep native section object identities stable when directory membership changes.
  const sectionsAt = inbox.indexOf(section[0]) + section[0].length;
  const nativeSections = inbox.slice(sectionsAt, -1).replace(recentMatch[0],
    recentMatch[0].replace(`${model}().recent.length`, `Number(${model}().more)`)
      .replace(/rows:\(\)=>[\w$]+\(\(\)=>[\w$]+\(\)\.recent\)/, "rows:()=>null"));
  const beforeReturn = sectionsAt - section[0].length;
  inbox = inbox.slice(0, beforeReturn) + `;const __ocNativeSections=[${nativeSections}];` +
    section[0].slice(1).replace("sections:[", "get sections(){return[...__ocNativeSections.slice(0,2),...__ocDirectories.groups(),...__ocNativeSections.slice(2)]}");
  const renderedInbox = (inbox + source.slice(end, cardStart)).replace(workingRows, match => `${match.slice(0, -1)},false,true)`);
  return `const __ocCreateInboxDirectories=${createInboxDirectories};\n` + source.slice(0, offset) + renderedInbox + styledCard + source.slice(cardStart + card.length);
}
