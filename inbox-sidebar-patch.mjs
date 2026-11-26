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
  const navigation = /\.current,\.\.\.([\w$]+)\.needs,\.\.\.\1\.recent,/;
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
  if (!row || !section || !nav || !modelMatch) return source;

  const cardStart = source.indexOf(`function ${row[3]}(`, end);
  const cardPrefix = source.slice(cardStart, cardStart + 8000);
  const cardMatch = cardPrefix.match(/^function [\w$]+\(([\w$]+)\)\{[\s\S]+?(?=\}+[\w$]+\(\[`focusin`,`keydown`,`click`\]\);)/);
  if (cardStart < 0 || !cardMatch) return source;
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
  inbox = inbox.replace(row[0], row[0].replace(`=${list}=>`, `=(${list},__ocDirectory=false)=>`).replace("{ref:", "{__ocDirectory,ref:"));
  inbox = inbox.replace(nav[0], nav[0].replace(`...${nav[1]}.recent`, "...__ocDirectories.visible()"));
  // Navigation registers immediately, so initialize the controller before it;
  // the rows callback is only invoked later by the native section renderer.
  const modelEnd = inbox.match(/shown:[\w$]+\}\}\),[\w$]+=new Map;/);
  if (!modelEnd) return source;
  inbox = inbox.replace(modelEnd[0], modelEnd[0].replace("),", `),__ocDirectories=__ocCreateInboxDirectories(()=>${model}().recent,${modelMatch[1]},(...args)=>${renderRows}(...args),${modelMatch[3]},${signal}),`));
  // Keep native section object identities stable when directory membership changes.
  const sectionsAt = inbox.indexOf(section[0]) + section[0].length;
  const nativeSections = inbox.slice(sectionsAt, -1).replace(recentMatch[0],
    recentMatch[0].replace(`${model}().recent.length`, `Number(${model}().more)`)
      .replace(/rows:\(\)=>[\w$]+\(\(\)=>[\w$]+\(\)\.recent\)/, "rows:()=>null"));
  const beforeReturn = sectionsAt - section[0].length;
  inbox = inbox.slice(0, beforeReturn) + `;const __ocNativeSections=[${nativeSections}];` +
    section[0].slice(1).replace("sections:[", "get sections(){return[...__ocNativeSections.slice(0,2),...__ocDirectories.groups(),...__ocNativeSections.slice(2)]}");
  return `const __ocCreateInboxDirectories=${createInboxDirectories};\n` + source.slice(0, offset) + inbox + source.slice(end, cardStart) + styledCard + source.slice(cardStart + card.length);
}
