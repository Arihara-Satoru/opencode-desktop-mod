import assert from "node:assert/strict";
import vm from "node:vm";
import fs, { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareLongText, shouldAttachText, textDataUri, FILE_CHAR_LIMIT, FILE_LINE_LIMIT } from "./long-text.mjs";
import { patchLongTextComposer } from "./long-text-patch.mjs";

assert.equal(shouldAttachText("短消息"), false);
assert.equal(shouldAttachText("a".repeat(FILE_CHAR_LIMIT - 1)), false);
assert.equal(shouldAttachText("a".repeat(FILE_CHAR_LIMIT)), true);
assert.equal(shouldAttachText(Array(FILE_LINE_LIMIT).fill("一行").join("\r\n")), true);
assert.equal(shouldAttachText(Array(FILE_LINE_LIMIT - 1).fill("一行").join("\r")), false);
assert.equal(shouldAttachText("\n".repeat(FILE_LINE_LIMIT)), false);
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

const fixture = 'async function send(e,t,n){let r=await serialize(e,t),i=async()=>{return 1};let c={text:r.text,metadata:{displayText:r.displayText}};await e.data.session.prompt(c).catch(()=>e.data.session.prompt(c))}async function shell(e,t){return e.api.shell(t)}';
const patched = patchLongTextComposer(fixture);
assert.match(patched, /__oc_prepare_long_text\(await serialize\(e,t\),t\)/);
assert.ok(patched.includes('async function shell(e,t){return e.api.shell(t)}'));
assert.throws(() => patchLongTextComposer("unrecognized version"), /无法安全定位/);
assert.throws(() => patchLongTextComposer(fixture + fixture.replaceAll("send", "send2")), /匹配 2 处/);
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
const renderer = readFileSync(new URL("./long-text.mjs", import.meta.url), "utf8");
assert.doesNotMatch(renderer, /\.innerHTML\s*=|execCommand|\.submit\(|fetch\(/, "No untrusted HTML, editor mutation, synthetic sends or extra uploads");
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
    console.log("Copied ASAR integration passed: native composer patch, embedded module, integrity, syntax and idempotence.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log("Long text checks passed: thresholds, UTF-8 fidelity, references, metadata, native retries and fail-closed patching.");
