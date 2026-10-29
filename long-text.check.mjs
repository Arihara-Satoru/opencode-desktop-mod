import assert from "node:assert/strict";
import vm from "node:vm";
import fs, { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareLongText, shouldAttachText, textDataUri, insertTextCard, isTextCard, textCardContent, FILE_CHAR_LIMIT, FILE_LINE_LIMIT } from "./long-text.mjs";
import { patchLongTextComposer } from "./long-text-patch.mjs";

assert.equal(shouldAttachText("短消息"), false);
assert.equal(shouldAttachText("a".repeat(FILE_CHAR_LIMIT - 1)), false);
assert.equal(shouldAttachText("a".repeat(FILE_CHAR_LIMIT)), true);
assert.equal(shouldAttachText(Array(FILE_LINE_LIMIT).fill("一行").join("\r\n")), true);
assert.equal(shouldAttachText(Array(FILE_LINE_LIMIT - 1).fill("一行").join("\r")), false);
assert.equal(shouldAttachText("\n".repeat(FILE_LINE_LIMIT)), false);
assert.equal(isTextCard({ type: "file", path: 1, url: "data:text/plain;base64,eA==", mime: "text/plain" }), false);
const originalText = "完整内容：中文、emoji 🌸、<script>不执行</script>\r\n".repeat(400);
assert.equal(Buffer.from(textDataUri(originalText).split(",")[1], "base64").toString("utf8"), originalText);
const short = { text: "短消息", files: [] };
assert.equal(prepareLongText(short, { text: short.text }), short);
const mention = { start: 0, end: 5, text: "@file" };
const serialized = {
  text: originalText + "\n保留评审评论与路径上下文",
  displayText: originalText,
  files: [{ uri: "file:///source.txt", name: "source.txt", mention }, { uri: "data:image/png;base64,eA==", name: "image.png" }],
  agents: [{ name: "explore", mention: { text: "@explore", start: 6, end: 14 } }],
  skills: [{ id: "test", name: "test", mention: { text: "@test", start: 15, end: 20 } }],
  attachments: [{ name: "existing.txt", path: "/existing.txt", mime: "text/plain" }],
  comments: [{ comment: "保留评论" }],
};
const before = JSON.stringify(serialized);
const result = prepareLongText(serialized, { text: originalText, id: "msg_123" });
assert.equal(JSON.stringify(serialized), before, "Never mutate original prompt or references");
assert.equal(result.files.length, 3);
assert.equal(result.files.at(-1).name, "pasted-text.txt");
assert.equal(Buffer.from(result.files.at(-1).uri.split(",")[1], "base64").toString("utf8"), originalText);
assert.ok(result.text.endsWith("\n保留评审评论与路径上下文"));
assert.equal(result.displayText, "@file @explore @test");
assert.equal(result.comments, serialized.comments);
assert.equal(result.attachments, serialized.attachments);
for (const item of [...result.files, ...result.agents, ...result.skills].filter(item => item.mention)) {
  assert.equal(result.displayText.slice(item.mention.start, item.mention.end), item.mention.text);
}

// Plain long text without mentions must produce empty displayText to prevent awkward synthetic text bubbles
const plainSerialized = { text: originalText, displayText: originalText, files: [] };
const plainResult = prepareLongText(plainSerialized, { text: originalText });
assert.equal(plainResult.displayText, "");
assert.equal(plainResult.text, "");
assert.equal(plainResult.files.length, 1);
assert.equal(plainResult.files[0].name, "pasted-text.txt");

assert.deepEqual(prepareLongText(serialized, { text: originalText, id: "msg_123" }), result, "Retries must use the same filename and payload");
assert.equal(prepareLongText({ ...serialized, text: "unexpected serialized shape" }, { text: originalText }).text, "unexpected serialized shape");

const textPart = content => ({ type: "text", content, start: 0, end: content.length });
const serializeDraft = parts => ({
  text: parts.map(part => part.content ?? "").join(""),
  displayText: parts.map(part => part.content ?? "").join(""),
  files: parts.filter(part => part.type === "file").map(part => ({ uri: part.url ?? `file://${part.path}`,
    name: part.filename ?? part.path, mime: part.mime ?? "text/plain",
    mention: { start: part.start, end: part.end, text: part.content } })),
  agents: parts.filter(part => part.type === "agent").map(part => ({ name: part.name, mention: { start: part.start, end: part.end, text: part.content } })),
  skills: parts.filter(part => part.type === "skill").map(part => ({ id: part.id, name: part.name, mention: { start: part.start, end: part.end, text: part.content } })),
});
const checkOffsets = parts => {
  let cursor = 0;
  for (const part of parts) {
    if (typeof part.content !== "string") continue;
    assert.equal(part.start, cursor);
    cursor += part.content.length;
    assert.equal(part.end, cursor);
  }
};
const emptyCard = insertTextCard([textPart("")], originalText, 0, 0, "first");
const card = emptyCard.parts.find(isTextCard);
assert.equal(textCardContent(card), originalText, "Paste must preserve CRLF, Unicode and literal markup");
assert.equal(textCardContent(JSON.parse(JSON.stringify(card))), originalText, "Native draft/history JSON must contain the complete attachment");
checkOffsets(emptyCard.parts);
const cardSerialized = serializeDraft(emptyCard.parts);
const onlyCard = prepareLongText(cardSerialized, { text: cardSerialized.text, prompt: emptyCard.parts });
assert.equal(onlyCard.displayText, "");
assert.equal(onlyCard.text, "");
assert.equal(onlyCard.files.length, 1);
assert.equal(onlyCard.files[0].mention, undefined, "A text-only paste must render only the attachment, without a filename bubble");
assert.equal(onlyCard.files[0].uri, card.url);
assert.deepEqual(prepareLongText(cardSerialized, { text: cardSerialized.text, prompt: emptyCard.parts }), onlyCard);
const baseParts = [textPart("请分析 旧日志 最后"), { type: "image", id: "image", filename: "image.png", blob: { id: "blob" } }];
const baseBefore = JSON.stringify(baseParts);
const replaced = insertTextCard(baseParts, originalText, 4, 7, "replace");
assert.equal(JSON.stringify(baseParts), baseBefore);
assert.equal(replaced.parts.map(part => part.content ?? "").join(""), "请分析 pasted-text.txt  最后");
assert.equal(replaced.parts.at(-1), baseParts[1], "Keep existing images untouched");
checkOffsets(replaced.parts);
const twice = insertTextCard(emptyCard.parts, "第二段\n".repeat(200), emptyCard.cursor, emptyCard.cursor, "second");
assert.deepEqual(twice.parts.filter(isTextCard).map(part => part.filename), ["pasted-text.txt", "pasted-text-2.txt"]);
checkOffsets(twice.parts);
const multiSerialized = serializeDraft(twice.parts);
const multiResult = prepareLongText(multiSerialized, { text: multiSerialized.text, prompt: twice.parts });
assert.equal(multiResult.text, "");
assert.equal(multiResult.displayText, "");
assert.equal(multiResult.files.length, 2);
assert.ok(multiResult.files.every(file => !file.mention));
const refs = insertTextCard([
  { type: "file", path: "source.ts", content: "@source.ts", start: 0, end: 10 }, textPart(" 请检查 "),
  { type: "agent", name: "explore", content: "@explore", start: 0, end: 0 }, textPart(" "),
  { type: "skill", id: "test", name: "test", content: "@test", start: 0, end: 0 },
], originalText, 0, 0, "refs");
const refsSerialized = serializeDraft(refs.parts);
refsSerialized.text += "\n保留评审评论";
refsSerialized.comments = [{ comment: "评论" }];
refsSerialized.attachments = [{ name: "upload.txt", path: "/upload.txt", mime: "text/plain" }];
const compactRefs = prepareLongText(refsSerialized, { text: refsSerialized.displayText, prompt: refs.parts });
assert.ok(!compactRefs.displayText.includes("pasted-text.txt"));
assert.ok(compactRefs.text.endsWith("\n保留评审评论"));
assert.equal(compactRefs.comments, refsSerialized.comments);
assert.equal(compactRefs.attachments, refsSerialized.attachments);
for (const item of [...compactRefs.files, ...compactRefs.agents, ...compactRefs.skills].filter(item => item.mention)) {
  assert.equal(compactRefs.displayText.slice(item.mention.start, item.mention.end), item.mention.text);
}
// Native session-mention normalization shifts all following ranges.
const shifted = { ...cardSerialized, text: `session-ref ${cardSerialized.text}`, displayText: `session-ref ${cardSerialized.displayText}`,
  files: cardSerialized.files.map(file => ({ ...file, mention: { ...file.mention, start: file.mention.start + 12, end: file.mention.end + 12 } })) };
assert.equal(prepareLongText(shifted, { text: cardSerialized.text, prompt: emptyCard.parts }).displayText, "session-ref");
const mixed = insertTextCard([textPart("y".repeat(FILE_CHAR_LIMIT))], originalText, 0, 0, "mixed");
const mixedSerialized = serializeDraft(mixed.parts);
const mixedResult = prepareLongText(mixedSerialized, { text: mixedSerialized.text, prompt: mixed.parts });
assert.deepEqual(mixedResult.files.map(file => file.name), ["pasted-text.txt", "pasted-text-2.txt"]);
assert.equal(Buffer.from(mixedResult.files[1].uri.split(",")[1], "base64").toString(), "y".repeat(FILE_CHAR_LIMIT));

const nativeEditor = 'function controller(){let t,e={};return{setEditor(n){t=n,e.onEditor?.(n)},restoreFocus:focus,onInput(value,parts,cursor){return parts}}}';
const fixture = 'async function send(e,t,n){let r=await serialize(e,t),i=async()=>{return 1};let c={text:r.text,metadata:{displayText:r.displayText}};await e.data.session.prompt(c).catch(()=>e.data.session.prompt(c))}async function shell(e,t){return e.api.shell(t)}' + nativeEditor;
const patched = patchLongTextComposer(fixture);
assert.match(patched, /__oc_prepare_long_text\(await serialize\(e,t\),t\)/);
assert.ok(patched.includes('async function shell(e,t){return e.api.shell(t)}'));
assert.match(patched, /__oc_bind_long_text\(n,this\)/);
assert.throws(() => patchLongTextComposer("unrecognized version"), /无法安全定位/);
assert.throws(() => patchLongTextComposer(fixture + fixture.replaceAll("send", "send2")), /匹配 2 处/);
assert.throws(() => patchLongTextComposer(fixture.replace(nativeEditor, "")), /草稿控制器/);
assert.throws(() => patchLongTextComposer(fixture + nativeEditor), /草稿控制器（匹配 2 处）/);
let prepared = 0, sent = 0;
const sandbox = {
  serialize: async () => ({ text: "original", displayText: "original" }),
  __oc_prepare_long_text: (data, prompt) => { prepared++; assert.equal(prompt.id, "msg"); return { ...data, text: "attachment", displayText: "compact" }; },
};
vm.createContext(sandbox);
vm.runInContext(patched.replace(/^import[^\n]+\n/, "") + ";globalThis.sendPrompt=send;", sandbox);
await sandbox.sendPrompt({ data: { session: { prompt: async data => { sent++; assert.equal(data.text, "attachment"); assert.equal(data.metadata.displayText, "compact"); if (sent === 1) throw Error("retry"); } } } }, { id: "msg" });
assert.equal(prepared, 1, "Prepare once before the native delivery retry");
assert.equal(sent, 2);
const editorNode = {};
let bound;
sandbox.focus = () => {};
sandbox.__oc_bind_long_text = (node, controller) => { assert.equal(node, editorNode); bound = controller; };
const boundController = vm.runInContext("controller()", sandbox);
boundController.setEditor(editorNode);
assert.equal(bound, boundController, "Bind the real controller as this, not a missing argument or wrong minified local");
const renderer = readFileSync(new URL("./long-text.mjs", import.meta.url), "utf8");
assert.doesNotMatch(renderer, /\.innerHTML\s*=|execCommand|\.submit\(|fetch\(/, "No untrusted HTML, direct editor mutation, synthetic sends or extra uploads");
assert.match(renderer, /aria-expanded/);
assert.match(renderer, /ResizeObserver/);

// Deterministic renderer lifecycle, including virtualized unmount/remount and
// resize-driven reflow. No browser timing assumptions in the regression suite.
{
  let mutation, resize, flush;
  const classes = new Set(), attributes = new Map(), handlers = new Map();
  const body = {
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    matches: () => true, getBoundingClientRect: () => ({ top: 20 }),
    append: button => { body.button = button; },
  };
  const style = { maxHeight: "", removeProperty: () => { style.maxHeight = ""; } };
  const text = {
    isConnected: true, parentElement: body, textContent: "正文".repeat(500), scrollHeight: 600, style,
    closest: () => ({ getAttribute: () => "msg:text:0" }),
    hasAttribute: name => attributes.has(name),
    toggleAttribute: (name, on) => on ? attributes.set(name, "") : attributes.delete(name),
    removeAttribute: name => attributes.delete(name),
  };
  let visible = [text];
  const document = {
    head: { append() {} }, body: {}, addEventListener() {},
    querySelectorAll: selector => selector.startsWith("form") ? [] : visible,
    createElementNS: (ns, tag) => document.createElement(tag),
    createElement: tag => tag === "style" ? {} : {
      attrs: new Map(), setAttribute(name, value) { this.attrs.set(name, value); },
      getAttribute(name) { return this.attrs.get(name); },
      addEventListener(name, handler) { handlers.set(name, handler); },
      remove() { if (body.button === this) body.button = null; },
      append(...children) { for (const child of children) if (child && typeof child === "object" && child.className === "oc-long-toggle-label") this.label = child; },
    },
  };
  const sandbox = {
    document, window: { addEventListener() {} }, location: { href: "session/one" },
    getComputedStyle: () => ({ lineHeight: "20px", fontSize: "14px", paddingTop: "8px", paddingBottom: "8px" }),
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
    ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} unobserve() {} },
    setTimeout: callback => { flush = callback; },
  };
  vm.createContext(sandbox);
  vm.runInContext(renderer.replaceAll("export ", "").replace(/if \(typeof window !== "undefined"\) \{[\s\S]*$/, "") + "\ninitLongText();", sandbox);
  assert.equal(body.button.getAttribute("aria-expanded"), "false");
  assert.equal(style.maxHeight, "256px");
  handlers.get("click")();
  assert.equal(body.button.getAttribute("aria-expanded"), "true");
  assert.equal(style.maxHeight, "none");
  text.isConnected = false; visible = []; mutation(); flush();
  text.isConnected = true; visible = [text]; mutation(); flush();
  assert.equal(body.button.getAttribute("aria-expanded"), "true", "Restore expansion after virtualized remount");
  text.scrollHeight = 60; text.textContent = "短消息"; mutation(); flush();
  assert.equal(body.button, null);
  assert.equal(style.maxHeight, "");
  assert.equal(classes.has("oc-long-body"), false);
  text.scrollHeight = 600; resize(); flush();
  assert.ok(body.button, "Reflow can create the toggle again");
}

// Event wiring must intercept only long plain-text pastes, in capture phase.
{
  const handlers = new Map();
  let parts = [textPart("说明 ")], inputCalls = 0, focused;
  const editor = {
    getAttribute: () => "true", contains: () => false,
    addEventListener: (name, callback, capture) => { assert.equal(capture, true); handlers.set(name, callback); },
  };
  const controller = {
    state: { mode: "normal" }, view: {}, parts: () => parts,
    value: () => parts.map(part => part.content ?? "").join(""),
    onInput(value, next, cursor) { parts = next; inputCalls++; assert.equal(value, this.value()); focused = cursor; },
    restoreFocus: cursor => { focused = cursor; },
  };
  const sandbox = { window: { getSelection: () => null }, crypto: { randomUUID: () => "event" },
    TextEncoder, TextDecoder, btoa, atob, console };
  vm.createContext(sandbox);
  vm.runInContext(renderer.replaceAll("export ", "").replace(/if \(typeof window !== "undefined"\) \{[\s\S]*$/, ""), sandbox);
  sandbox.bindLongTextComposer(editor, controller);
  sandbox.bindLongTextComposer(editor, controller);
  const paste = (text, items = []) => {
    const event = { clipboardData: { getData: () => text, items }, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    handlers.get("paste")(event);
    return event;
  };
  assert.equal(paste("short").prevented, false);
  controller.state.mode = "shell";
  assert.equal(paste(originalText).prevented, false);
  controller.state.mode = "normal";
  parts = [textPart("/command ")];
  assert.equal(paste(originalText).prevented, false);
  parts = [textPart("")];
  assert.equal(paste("/command\n" + originalText).prevented, false);
  assert.equal(paste(originalText, [{ kind: "file" }]).prevented, false);
  controller.view.draftOnly = true;
  assert.equal(paste(originalText).prevented, false);
  controller.view.draftOnly = false;
  parts = [textPart("说明 ")];
  assert.equal(paste(originalText).stopped, true);
  assert.equal(inputCalls, 1);
  assert.equal(textCardContent(parts.find(isTextCard)), originalText);
  assert.equal(focused, 3 + "pasted-text.txt".length + 1);
}

// Edit/cancel/save must touch only the live native draft and never submit it.
{
  let dialog, writes = 0, focused = 0;
  const bridge = [], editorEvents = new Map();
  const makeElement = tag => {
    const events = new Map();
    let value = "";
    return { tag, children: [], attrs: new Map(),
      get value() { return value; }, set value(next) { value = String(next).replace(/\r\n?/g, "\n"); },
      setAttribute(name, value) { this.attrs.set(name, value); },
      addEventListener(name, callback) { events.set(name, callback); },
      fire(name, event = {}) { events.get(name)?.(event); },
      append(...children) { this.children.push(...children); }, focus() {},
      showModal() { this.open = true; }, close() { this.open = false; this.fire("close"); },
      remove() { if (dialog === this) dialog = null; },
    };
  };
  const editor = { isConnected: true, getAttribute: () => "true",
    addEventListener: (name, callback) => editorEvents.set(name, callback) };
  let parts = JSON.parse(JSON.stringify(emptyCard.parts));
  const controller = { state: { mode: "normal" }, view: {}, parts: () => parts,
    value: () => parts.map(part => part.content ?? "").join(""),
    onInput(value, next) { parts = next; writes++; }, restoreFocus() { focused++; } };
  const document = { querySelector: () => dialog, createElement: makeElement,
    body: { append: node => { dialog = node; } } };
  const sandbox = { document, window: { __oc_set_dialog_active: active => bridge.push(active) },
    TextEncoder, TextDecoder, btoa, atob, console };
  vm.createContext(sandbox);
  vm.runInContext(renderer.replaceAll("export ", "").replace(/if \(typeof window !== "undefined"\) \{[\s\S]*$/, ""), sandbox);
  sandbox.bindLongTextComposer(editor, controller);
  const open = () => {
    const chip = { dataset: { path: parts.find(isTextCard).path } };
    editorEvents.get("click")({ target: { closest: () => chip }, preventDefault() {}, stopImmediatePropagation() {} });
    assert.ok(dialog?.open);
    return { textarea: dialog.children[1], status: dialog.children[2].children[0],
      cancel: dialog.children[2].children[1], save: dialog.children[2].children[2] };
  };
  let edit = open();
  assert.equal(edit.textarea.value, originalText.replaceAll("\r\n", "\n"));
  edit.save.fire("click");
  assert.equal(dialog, null);
  assert.equal(textCardContent(parts.find(isTextCard)), originalText, "No-op save must keep original CRLF bytes");
  edit = open();
  edit.textarea.value = "取消的改动";
  edit.cancel.fire("click");
  assert.equal(textCardContent(parts.find(isTextCard)), originalText);
  assert.equal(writes, 1);
  edit = open();
  edit.textarea.value = "编辑后的中文 🌸\n完整保留";
  let prevented = false;
  dialog.fire("keydown", { key: "Enter", ctrlKey: true, stopPropagation() {}, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(dialog, null);
  assert.equal(textCardContent(parts.find(isTextCard)), "编辑后的中文 🌸\n完整保留");
  assert.equal(writes, 2);
  edit = open();
  parts = [textPart("另一个草稿")];
  edit.save.fire("click");
  assert.equal(edit.status.textContent, "草稿已变化，请关闭后重新打开文本卡片。");
  assert.equal(writes, 2, "Do not overwrite a switched draft");
  edit.cancel.fire("click");
  parts = JSON.parse(JSON.stringify(emptyCard.parts));
  edit = open();
  editor.isConnected = false;
  edit.save.fire("click");
  assert.equal(writes, 2, "Do not write through a disposed controller");
  edit.cancel.fire("click");
  assert.equal(focused, 5);
  assert.deepEqual(bridge, [true, false, true, false, true, false, true, false, true, false]);
}

// Minifier-local names change even in patch releases. Resolve the serializer
// and its small test doubles by their contracts, not a 2.2.0 symbol snapshot.
function loadNativeSerializer(source) {
  const candidates = [...source.matchAll(/function ([\w$]+)\(([\w$]+)\)\{let ([\w$]+)=([\w$]+)\(\2\.prompt\),/g)];
  assert.equal(candidates.length, 1, "Find exactly one native prompt serializer");
  const candidate = candidates[0];
  const tail = source.slice(candidate.index).match(/,attachments:[\w$]+\}\}/);
  assert.ok(tail, "Find the native serializer's complete result contract");
  const body = source.slice(candidate.index, candidate.index + tail.index + tail[0].length);
  const predicates = new Map([...source.slice(0, candidate.index).matchAll(/(?:var\s+|,)([\w$]+)=([\w$]+)=>\2\.type===[`'"](\w+)[`'"]/g)]
    .map(match => [match[1], match[3]]));
  const bindings = { [candidate[4]]: parts => parts };
  const kinds = [];
  for (const match of body.matchAll(/\.filter\(([\w$]+)\)/g)) {
    const kind = predicates.get(match[1]);
    assert.ok(kind, `Resolve native part predicate: ${match[1]}`);
    kinds.push(kind);
    bindings[match[1]] = part => part.type === kind;
  }
  assert.deepEqual([...new Set(kinds)].sort(), ["agent", "file", "path", "skill"]);
  const join = body.match(/([\w$]+)\([\w$]+\.sessionDirectory,[\w$]+\.path\)/);
  const uri = body.match(/return\{uri:[\w$]+\.url\?\?`file:\/\/\$\{([\w$]+)\([\w$]+\)\}\$\{([\w$]+)\([\w$]+\.selection\)\}`/);
  const basename = body.match(/name:[\w$]+\.filename\?\?([\w$]+)\([\w$]+\.path\)/);
  const describe = body.match(/\.\.\.[\w$]+\.map\(([\w$]+)\),/);
  assert.ok(join && uri && basename && describe, "Resolve native file/attachment helpers");
  Object.assign(bindings, {
    [join[1]]: (directory, file) => `${directory}/${file}`,
    [uri[1]]: value => value,
    [uri[2]]: selection => selection ? `?start=${selection.startLine}&end=${selection.endLine}` : "",
    [basename[1]]: value => value.split("/").at(-1),
    [describe[1]]: file => `Attached file: \`${file.path}\``,
  });
  return vm.runInNewContext(`(${body})`, bindings);
}

// The old function name can now belong to a DOM cursor helper. It must not be
// selected or executed when validating attachment content on a newer release.
const serializerFixture = 'var ff=p=>p.type===`file`,aa=p=>p.type===`agent`,ss=p=>p.type===`skill`,pp=p=>p.type===`path`;function _i(e){throw Error("DOM cursor helper must not execute")}function renamed(e){let t=normalize(e.prompt),n=e.text,s=t.filter(ss).map(p=>({id:p.id,name:p.name,mention:{start:p.start,end:p.end,text:p.content}})),f=t.filter(ff).map(p=>{let joined=join(e.sessionDirectory,p.path);return{uri:p.url??`file://${encode(joined)}${selection(p.selection)}`,mime:p.mime??`text/plain`,name:p.filename??basename(p.path),mention:{start:p.start,end:p.end,text:p.content}}}),a=t.filter(aa).map(p=>({name:p.name,mention:{start:p.start,end:p.end,text:p.content}})),c=[],x=e.prompt.filter(pp).map(p=>({name:p.filename,mime:p.mime,path:p.path}));return{text:[...n.trim()?[n]:[],...x.map(describe),...c.map(p=>p.comment)].join(`\\n`),displayText:n,files:[...f],agents:a,skills:s,comments:c,attachments:x}}';
const fixtureSerialized = loadNativeSerializer(serializerFixture)({ prompt: emptyCard.parts,
  text: cardSerialized.text, context: [], images: [], sessionDirectory: "/workspace" });
assert.equal(fixtureSerialized.files[0].uri, card.url);
assert.equal(prepareLongText(fixtureSerialized, { text: cardSerialized.text, prompt: emptyCard.parts }).text, "");
assert.throws(() => loadNativeSerializer("function _i(e){return e.firstChild}"), /native prompt serializer/);
assert.throws(() => loadNativeSerializer(serializerFixture + serializerFixture), /native prompt serializer/);

// Explicit optional integration against a copied archive, never the live app.
const asarIndex = process.argv.indexOf("--asar");
if (asarIndex >= 0) {
  const parent = process.platform === "win32" ? path.join(os.homedir(), "AppData/Local/Temp/opencode") : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(parent, "long-text-check-"));
  try {
    const target = path.join(dir, "app.asar");
    fs.copyFileSync(process.argv[asarIndex + 1], target);
    const apply = () => execFileSync(process.execPath, ["apply-mod.mjs", "--force"], {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      env: { ...process.env, OPENCODE_ASAR_PATH: target }, encoding: "utf8",
    });
    console.log(apply());
    const first = fs.readFileSync(target);
    apply();
    assert.deepEqual(fs.readFileSync(target), first, "Repeated installation must be byte-identical");
    const header = JSON.parse(first.subarray(16, 16 + first.readUInt32LE(12)));
    const offset = 8 + first.readUInt32LE(4);
    const assets = header.files.out.files.renderer.files.assets.files;
    const read = node => first.subarray(offset + Number(node.offset), offset + Number(node.offset) + node.size);
    assert.equal(read(assets["long-text.mjs"]).toString(), renderer);
    const modules = Object.entries(assets).filter(([name, node]) => /\.m?js$/.test(name) && read(node).includes(Buffer.from("__oc_prepare_long_text")));
    assert.equal(modules.length, 1);
    for (const [name, node] of [["long-text.mjs", assets["long-text.mjs"]], ...modules]) {
      const bytes = read(node);
      assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), node.integrity.hash);
      const file = path.join(dir, name);
      fs.writeFileSync(file, bytes);
      execFileSync(process.execPath, ["--check", file]);
    }
    const native = read(modules[0][1]).toString();
    assert.equal((native.match(/__oc_bind_long_text\([\w$]+,this\)/g) ?? []).length, 1);
    // Execute the official serialization routine, not just the patch anchor.
    const serializeNative = loadNativeSerializer(native);
    const nativeDraft = JSON.parse(JSON.stringify(refs.parts));
    const nativeText = nativeDraft.map(part => part.content ?? "").join("");
    const nativeResult = prepareLongText(serializeNative({ prompt: nativeDraft, text: nativeText,
      context: [], images: [], sessionDirectory: "/workspace" }), { prompt: nativeDraft, text: nativeText });
    assert.equal(nativeResult.displayText, compactRefs.displayText);
    assert.equal(nativeResult.files.length, 2);
    assert.equal(Buffer.from(nativeResult.files[0].uri.split(",")[1], "base64").toString(), originalText);
    assert.equal(nativeResult.files[0].mention, undefined);
    for (const item of [...nativeResult.files, ...nativeResult.agents, ...nativeResult.skills].filter(item => item.mention)) {
      assert.equal(nativeResult.displayText.slice(item.mention.start, item.mention.end), item.mention.text);
    }
    console.log("Copied ASAR integration passed: native composer binding/serialization, complete text cards, references, embedded module, integrity, syntax and idempotence.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log("Long text checks passed: immediate text cards, complete drafts, thresholds, UTF-8 fidelity, reference offsets, paste filtering, native controller/retries and fail-closed patching.");
