import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parse, parseTree, findNodeAtLocation, createScanner, modify, applyEdits } from "./dist/jsonc.mjs";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const owner = "opencode-desktop-mod/goals";
const slash = value => path.resolve(value).replaceAll("\\", "/").replace(/\/$/, "");
const equal = (a, b) => process.platform === "win32" ? slash(a).toLowerCase() === slash(b).toLowerCase() : slash(a) === slash(b);
const same = (a, b) => a === null ? b === null : b !== null && a.equals(b);

export function supportsGoals(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[^\s]+)?$/.exec(version);
  return !!match && Number(match[1]) === 2 && (Number(match[2]) > 2 || Number(match[2]) === 2 && Number(match[3]) >= 7);
}

function snapshot(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`不是普通文件，拒绝覆盖：${file}`);
    return fs.readFileSync(file);
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function directory(file) {
  if (!fs.existsSync(file)) return;
  const stat = fs.lstatSync(file);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`托管部署目录不是普通目录，拒绝写入：${file}`);
}

function replace(file, before, after) {
  if (!same(snapshot(file), before)) throw new Error(`文件在安装期间已变化，未覆盖：${file}`);
  if (after === null) { fs.unlinkSync(file); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.goals-${crypto.randomUUID()}.tmp`;
  const mode = before === null ? 0o600 : fs.statSync(file).mode & 0o777;
  try {
    fs.writeFileSync(temp, after, { flag: "wx", mode });
    if (!same(snapshot(file), before)) throw new Error(`文件在安装期间已变化，未覆盖：${file}`);
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function localPath(entry, configFile) {
  const value = typeof entry === "string" ? entry : entry?.package;
  if (typeof value !== "string") return null;
  if (value.startsWith("file:")) { try { return fileURLToPath(value); } catch { return null; } }
  if (path.isAbsolute(value)) return value;
  if (value.startsWith(".")) return path.resolve(path.dirname(configFile), value);
  return null;
}

function legacyPlugin(directory) {
  // Migrate only a verifiable copy of our earlier source installer, not an
  // arbitrary user plugin with a coincidentally similar directory name.
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    return pkg.name === "opencode-desktop-goals" && ["./src/index.ts", "./dist/server.mjs"].includes(pkg.exports?.["."])
      && fs.readFileSync(path.join(directory, "src/prompts.mjs"), "utf8").includes('PLUGIN_ID = "desktop-goals"')
      && fs.readFileSync(path.join(directory, "src/index.ts"), "utf8").includes("new GoalRuntime(");
  } catch { return false; }
}

function configDocument(bytes, file) {
  const original = bytes?.toString("utf8") ?? '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = original.slice(bom.length);
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  const tree = parseTree(text, [], { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== "object" || Array.isArray(value)) throw new Error(`配置不是有效 JSON/JSONC，未写入：${file}`);
  const keys = tree.children.map(property => property.children[0].value);
  if (new Set(keys).size !== keys.length) throw new Error(`配置存在重复字段，拒绝猜测：${file}`);
  if (value.plugins !== undefined && !Array.isArray(value.plugins)) throw new Error(`plugins 不是数组，未写入：${file}`);
  return { text, bom, value };
}

function artifacts(directory) {
  const files = new Map([
    ["package.json", fs.readFileSync(path.join(directory, "dist/package.json"))],
    ...["server.mjs", "rpc.mjs", "gui-experimental.cjs"].map(name => [name, fs.readFileSync(path.join(directory, "dist", name))]),
    ...["NOTICE", "LICENSE", "LICENSES/Apache-2.0.txt"].map(name => [name, fs.readFileSync(path.join(directory, name))]),
  ]);
  const pkg = JSON.parse(files.get("package.json"));
  if (pkg.name !== "opencode-desktop-goals" || pkg.dependencies || pkg.exports?.["."] !== "./server.mjs"
    || pkg.exports?.["./rpc"] !== "./rpc.mjs" || pkg.exports?.["./gui-experimental"] !== "./gui-experimental.cjs") {
    throw new Error("目标功能预构建清单不完整，请重新下载完整补丁包。");
  }
  const hash = crypto.createHash("sha256");
  for (const [name, bytes] of files) hash.update(name).update("\0").update(bytes).update("\0");
  return { files, hash: hash.digest("hex").slice(0, 20) };
}

function deployPayload(payload, target, base) {
  directory(target);
  if (fs.existsSync(target)) {
    for (const [name, bytes] of payload.files) {
      directory(path.dirname(path.join(target, name)));
      if (!same(snapshot(path.join(target, name)), bytes)) throw new Error(`目标功能文件缺失或被修改，拒绝覆盖：${path.join(target, name)}`);
    }
    return;
  }
  // Publish a complete immutable directory, never a half-written package. The
  // only recursive cleanup is this transaction's freshly created staging dir.
  const stage = fs.mkdtempSync(path.join(base, ".staging-"));
  try {
    for (const [name, bytes] of payload.files) {
      const file = path.join(stage, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes, { flag: "wx" });
    }
    if (fs.existsSync(target)) throw new Error(`目标部署目录在安装期间出现，拒绝覆盖：${target}`);
    fs.renameSync(stage, target);
  } finally { if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true }); }
}

function removePlugin(text, index) {
  // jsonc-parser 3.3.1's final-array-element deletion assumes a trailing comma
  // and can leave a quote behind on compact JSON. Remove the AST value and
  // exactly one separator token instead, preserving all comments/whitespace.
  const array = findNodeAtLocation(parseTree(text), ["plugins"]);
  const node = array.children[index];
  const comma = (start, end) => {
    const scanner = createScanner(text.slice(start, end));
    while (scanner.getPosition() < end - start) {
      scanner.scan();
      const offset = start + scanner.getTokenOffset();
      if (text.slice(offset, offset + scanner.getTokenLength()) === ",") return offset;
    }
  };
  const next = array.children[index + 1];
  const following = comma(node.offset + node.length, next?.offset ?? array.offset + array.length - 1);
  const previous = array.children[index - 1];
  const separator = following ?? (previous ? comma(previous.offset + previous.length, node.offset) : undefined);
  return applyEdits(text, [
    { offset: node.offset, length: node.length, content: "" },
    ...(separator === undefined ? [] : [{ offset: separator, length: 1, content: "" }]),
  ]);
}

/** Prepare without writing anything. commit/rollback coordinate with ASAR writes. */
export function prepareGoals(options = {}) {
  const uninstall = options.uninstall === true;
  if (!uninstall && !supportsGoals(options.version)) return { supported: false, changed: false, commit() {}, rollback() {}, finish() {} };
  const env = options.env ?? process.env;
  const explicit = options.configFile || env.OPENCODE_MOD_CONFIG_PATH;
  const configDirectory = path.resolve(options.configDirectory || (explicit ? path.dirname(path.resolve(explicit)) : null)
    || env.OPENCODE_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode"));
  const base = path.join(configDirectory, "desktop-mod-goals");
  directory(base);
  const receiptFile = path.join(base, "install.json");
  const receiptBefore = snapshot(receiptFile);
  let receipt;
  if (receiptBefore) {
    receipt = JSON.parse(receiptBefore);
    if (receipt.owner !== owner || receipt.schemaVersion !== 1 || !Array.isArray(receipt.pluginPaths)
      || typeof receipt.configFile !== "string" || !path.isAbsolute(receipt.configFile) || !equal(path.dirname(receipt.configFile), configDirectory)) {
      throw new Error(`目标功能安装记录不兼容，未写入：${receiptFile}`);
    }
    for (const file of receipt.pluginPaths) {
      if (typeof file !== "string" || !equal(path.dirname(file), base) || !/^release-[a-f0-9]{20}$/.test(path.basename(file))) {
        throw new Error("目标功能安装记录包含非托管路径，拒绝处理。");
      }
    }
  }
  if (uninstall && !receipt) return { supported: true, changed: false, commit() {}, rollback() {}, finish() {} };
  // OpenCode 2.2.7 ConfigDiscovery.names loads JSON before JSONC, and native
  // Config.update writes to the last existing candidate. Both files are valid
  // together: follow that rule, but keep an existing receipt's write target so
  // a later-created JSONC file cannot strand an earlier managed registration.
  const candidates = ["opencode.json", "opencode.jsonc"].map(name => path.join(configDirectory, name));
  const present = candidates.filter(file => fs.existsSync(file));
  const configFile = path.resolve(explicit || receipt?.configFile || present.at(-1) || candidates[1]);
  if (receipt && !equal(receipt.configFile, configFile)) throw new Error(`目标功能已登记在另一份配置中，请先还原该配置：${receipt.configFile}`);
  const before = snapshot(configFile);
  const { text, bom, value } = configDocument(before, configFile);
  const payload = uninstall ? null : artifacts(options.sourceDirectory || sourceDirectory);
  const pluginDirectory = payload ? path.join(base, `release-${payload.hash}`) : null;
  const owned = entry => {
    const file = localPath(entry, configFile);
    return file && (receipt?.pluginPaths.some(known => equal(known, file)) || pluginDirectory && equal(pluginDirectory, file));
  };
  const entries = value.plugins ?? [];
  let afterText = text, kept = false;
  const changes = [];
  const formattingOptions = { insertSpaces: true, tabSize: 2, eol: text.includes("\r\n") ? "\r\n" : "\n" };
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i], file = localPath(entry, configFile);
    if (!owned(entry) && (uninstall || !file || !legacyPlugin(file))) continue;
    if (uninstall || kept) changes.push([i, undefined]);
    else {
      kept = true;
      const replacement = typeof entry === "string" ? slash(pluginDirectory) : { ...entry, package: slash(pluginDirectory) };
      if (JSON.stringify(entry) !== JSON.stringify(replacement)) changes.push([i, replacement]);
    }
  }
  const expected = entries.flatMap((entry, index) => {
    const change = changes.find(([position]) => position === index);
    return change ? change[1] === undefined ? [] : [change[1]] : [entry];
  });
  for (const [index, replacement] of changes.reverse()) {
    afterText = replacement === undefined ? removePlugin(afterText, index)
      : typeof entries[index] === "object"
        ? applyEdits(afterText, modify(afterText, ["plugins", index, "package"], replacement.package, { formattingOptions }))
        : applyEdits(afterText, modify(afterText, ["plugins", index], replacement, { formattingOptions }));
  }
  if (!uninstall && !kept) {
    expected.push(slash(pluginDirectory));
    afterText = applyEdits(afterText, modify(afterText, value.plugins ? ["plugins", entries.length] : ["plugins"], value.plugins ? slash(pluginDirectory) : [slash(pluginDirectory)], { formattingOptions, isArrayInsertion: true }));
  }
  if (!uninstall && !value.$schema) afterText = applyEdits(afterText, modify(afterText, ["$schema"], "https://opencode.ai/config.json", { formattingOptions }));
  const after = before === null && uninstall ? null : Buffer.from(bom + afterText);
  if (after !== null) {
    const verified = configDocument(after, configFile).value;
    const expectedConfig = { ...value };
    if (!uninstall || value.plugins !== undefined) expectedConfig.plugins = expected;
    if (!uninstall && !value.$schema) expectedConfig.$schema = "https://opencode.ai/config.json";
    if (!isDeepStrictEqual(verified, expectedConfig)) throw new Error("目标配置编辑结果与预期不一致，未写入。");
  }
  const nextReceipt = receipt || !uninstall ? Buffer.from(JSON.stringify({
    owner, schemaVersion: 1, configFile, installed: !uninstall,
    pluginPaths: [...new Set([...(receipt?.pluginPaths ?? []), ...(pluginDirectory ? [pluginDirectory] : [])])],
  }, null, 2) + "\n") : null;
  let lock, committed = false, backup;
  const written = [];
  const release = () => { if (lock !== undefined) { fs.closeSync(lock); lock = undefined; fs.unlinkSync(path.join(base, "install.lock")); } };
  const result = {
    supported: true, changed: !same(before, after) || !same(receiptBefore, nextReceipt), configFile, pluginDirectory,
    get backup() { return backup; },
    commit() {
      if (committed) return;
      directory(base);
      fs.mkdirSync(base, { recursive: true });
      try { lock = fs.openSync(path.join(base, "install.lock"), "wx", 0o600); }
      catch (error) { if (error.code === "EEXIST") throw new Error(`另一安装正在进行；若上次异常退出，请确认后移除 ${path.join(base, "install.lock")}`); throw error; }
      try {
        if (!same(snapshot(configFile), before) || !same(snapshot(receiptFile), receiptBefore)) throw new Error("配置或安装记录已变化，未覆盖，请重试。");
        if (payload) deployPayload(payload, pluginDirectory, base);
        for (const [file, oldBytes, newBytes] of [[configFile, before, after], [receiptFile, receiptBefore, nextReceipt]]) {
          if (same(oldBytes, newBytes)) continue;
          if (file === configFile && oldBytes !== null) {
            backup = `${configFile}.goals-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.bak`;
            fs.writeFileSync(backup, oldBytes, { flag: "wx", mode: 0o600 });
          }
          replace(file, oldBytes, newBytes);
          written.push([file, oldBytes, newBytes]);
        }
        committed = true;
      } catch (error) {
        try { result.rollback(); } catch (rollback) { throw new AggregateError([error, rollback], "目标功能安装失败，且回滚遇到冲突；配置备份已保留。"); }
        throw error;
      }
    },
    rollback() {
      try {
        while (written.length) {
          const [file, oldBytes, newBytes] = written.at(-1);
          replace(file, newBytes, oldBytes);
          written.pop();
        }
        committed = false;
      } finally { release(); }
    },
    finish() { release(); },
  };
  return result;
}

export function installGoals(options) {
  const transaction = prepareGoals(options);
  try { transaction.commit(); } finally { transaction.finish(); }
  return transaction;
}
