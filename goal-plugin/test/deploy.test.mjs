import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { installGoals, prepareGoals, supportsGoals } from "../deploy.mjs";
import { parse } from "../dist/jsonc.mjs";
import { writeDesktopPatch } from "../../desktop-install.mjs";

const source = fileURLToPath(new URL("..", import.meta.url));
function fixture(t) {
  const parent = process.platform === "win32" ? path.join(os.homedir(), "AppData/Local/Temp/opencode") : os.tmpdir();
  const root = fs.mkdtempSync(path.join(parent, "goal-deploy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configDirectory = path.join(root, "config");
  fs.mkdirSync(configDirectory);
  const configFile = path.join(configDirectory, "opencode.jsonc");
  const options = { version: "2.2.7", configDirectory, env: {} };
  return { root, configDirectory, configFile, options, read: () => parse(fs.readFileSync(configFile, "utf8")) };
}

test("version gating keeps old/unknown/prerelease clients unchanged", t => {
  const f = fixture(t);
  for (const version of ["2.2.6", "2.1.99", "3.0.0", "unknown", "2.2.7-beta.1"]) {
    assert.equal(supportsGoals(version), false);
    assert.equal(installGoals({ ...f.options, version }).supported, false);
  }
  assert.deepEqual(fs.readdirSync(f.configDirectory), []);
  for (const version of ["2.2.7", "2.3.0", "2.2.8+desktop"]) assert.equal(supportsGoals(version), true);
});

test("deploys a self-contained package and needs neither source files nor node_modules", async t => {
  const f = fixture(t), deployment = installGoals(f.options);
  assert.equal(f.read().plugins[0], deployment.pluginDirectory.replaceAll("\\", "/"));
  assert.equal(fs.existsSync(path.join(deployment.pluginDirectory, "src")), false);
  assert.equal(fs.existsSync(path.join(deployment.pluginDirectory, "node_modules")), false);
  const pkg = JSON.parse(fs.readFileSync(path.join(deployment.pluginDirectory, "package.json")));
  assert.equal(pkg.dependencies, undefined);
  const loaded = await import(pathToFileURL(path.join(deployment.pluginDirectory, "server.mjs")));
  assert.equal(loaded.default.id, "desktop-goals");
  assert.equal(typeof loaded.default.setup, "function");
  assert.ok(fs.existsSync(path.join(deployment.pluginDirectory, "LICENSES/Apache-2.0.txt")));
  const receipt = fs.readFileSync(path.join(f.configDirectory, "desktop-mod-goals/install.json"));
  const second = installGoals(f.options);
  assert.equal(second.changed, false);
  assert.deepEqual(fs.readFileSync(path.join(f.configDirectory, "desktop-mod-goals/install.json")), receipt);
  assert.equal(fs.readdirSync(f.configDirectory).filter(file => file.endsWith(".bak")).length, 0);
});

test("offline installer runs from a copied release without an npm executable", t => {
  const f = fixture(t), release = path.join(f.root, "downloaded-patch", "goal-plugin");
  fs.mkdirSync(release, { recursive: true });
  for (const file of ["deploy.mjs", "install.mjs", "LICENSE", "NOTICE"]) fs.copyFileSync(path.join(source, file), path.join(release, file));
  for (const dir of ["dist", "LICENSES"]) fs.cpSync(path.join(source, dir), path.join(release, dir), { recursive: true });
  execFileSync(process.execPath, [path.join(release, "install.mjs"), "--config", f.configFile], { env: { ...process.env, PATH: "" }, cwd: f.root });
  const plugin = f.read().plugins[0];
  fs.rmSync(path.dirname(release), { recursive: true });
  execFileSync(process.execPath, ["--input-type=module", "-e", `const p=await import(${JSON.stringify(pathToFileURL(path.join(plugin, "server.mjs")).href)});if(p.default.id!=="desktop-goals")throw Error("Invalid plugin");`], { cwd: f.root, env: { ...process.env, PATH: "" } });
  assert.ok(!plugin.includes("downloaded-patch"));
});

test("preserves BOM, CRLF, comments, custom schema and unrelated credentials", t => {
  const f = fixture(t);
  const original = '\uFEFF{\r\n  // User comment\r\n  "$schema": "https://example.test/schema",\r\n  "providers": { "x": { "settings": { "apiKey": "{env:KEEP}" } } },\r\n  "plugins": [\r\n    // Annotated plugin\r\n    "existing",\r\n  ],\r\n}\r\n';
  fs.writeFileSync(f.configFile, original);
  const installed = installGoals(f.options);
  const text = fs.readFileSync(f.configFile, "utf8");
  assert.equal(text.charCodeAt(0), 0xFEFF);
  assert.ok(text.includes("// Annotated plugin"));
  assert.equal(/(?<!\r)\n/.test(text), false);
  assert.equal(parse(text.slice(1)).providers.x.settings.apiKey, "{env:KEEP}");
  assert.equal(parse(text.slice(1)).$schema, "https://example.test/schema");
  assert.equal(fs.readFileSync(installed.backup, "utf8"), original);
});

test("invalid configuration fails before ASAR or deployment changes", t => {
  const f = fixture(t);
  for (const text of ['{"plugins": {}}', '{"plugins":[],"plugins":[]}', '{"plugins":[}']) {
    fs.writeFileSync(f.configFile, text);
    assert.throws(() => prepareGoals(f.options));
    assert.equal(fs.readFileSync(f.configFile, "utf8"), text);
    assert.equal(fs.existsSync(path.join(f.configDirectory, "desktop-mod-goals")), false);
  }
});

test("both configs coexist: follow native JSONC write priority without modifying JSON", t => {
  const f = fixture(t), jsonFile = path.join(f.configDirectory, "opencode.json");
  const json = '{\n  "model": "existing/model",\n  "providers": { "fixture": { "settings": { "apiKey": "{env:KEEP}" } } }\n}\n';
  const jsonc = '{\n  // Keep JSONC settings and legacy plugin entries.\n  "shell": "existing-shell",\n  "plugin": ["legacy-plugin"],\n  "plugins": ["other-plugin"],\n}\n';
  fs.writeFileSync(jsonFile, json);
  fs.writeFileSync(f.configFile, jsonc);
  const installed = installGoals(f.options);
  assert.equal(installed.configFile, f.configFile);
  assert.equal(fs.readFileSync(jsonFile, "utf8"), json);
  assert.equal(f.read().shell, "existing-shell");
  assert.deepEqual(f.read().plugin, ["legacy-plugin"]);
  assert.deepEqual(f.read().plugins, ["other-plugin", installed.pluginDirectory.replaceAll("\\", "/")]);
  assert.ok(fs.readFileSync(f.configFile, "utf8").includes("// Keep JSONC settings"));
  assert.equal(fs.readFileSync(installed.backup, "utf8"), jsonc);
  assert.equal(installGoals(f.options).changed, false);
  installGoals({ ...f.options, uninstall: true });
  assert.deepEqual(f.read().plugins, ["other-plugin"]);
  assert.equal(fs.readFileSync(jsonFile, "utf8"), json);
});

test("a lone JSON is selected and later JSONC creation does not move a recorded install", t => {
  const f = fixture(t), jsonFile = path.join(f.configDirectory, "opencode.json");
  fs.writeFileSync(jsonFile, '{"plugins":["keep"]}');
  const first = installGoals(f.options);
  assert.equal(first.configFile, jsonFile);
  assert.equal(fs.existsSync(f.configFile), false);
  const jsonc = '{\n  // Added later by OpenCode\n  "plugins": ["new-plugin"]\n}\n';
  fs.writeFileSync(f.configFile, jsonc);
  assert.equal(installGoals(f.options).changed, false);
  assert.equal(fs.readFileSync(f.configFile, "utf8"), jsonc);
  installGoals({ ...f.options, uninstall: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(jsonFile)).plugins, ["keep"]);
  assert.equal(fs.readFileSync(f.configFile, "utf8"), jsonc);
  assert.equal(installGoals(f.options).configFile, jsonFile, "Reinstall keeps the same ownership target");
});

test("explicit config still overrides the default choice without silently moving ownership", t => {
  const f = fixture(t), jsonFile = path.join(f.configDirectory, "opencode.json");
  fs.writeFileSync(jsonFile, "{}");
  fs.writeFileSync(f.configFile, "{}");
  const installed = installGoals({ ...f.options, configFile: jsonFile });
  assert.equal(installed.configFile, jsonFile);
  assert.equal(fs.readFileSync(f.configFile, "utf8"), "{}");
  assert.equal(installGoals(f.options).changed, false);
  assert.throws(() => prepareGoals({ ...f.options, configFile: f.configFile }), /另一份配置/);
});

test("migrates verified legacy paths once, retaining object options and other plugins", t => {
  const f = fixture(t);
  const legacy = path.join(f.root, "old-source-goals");
  fs.mkdirSync(path.join(legacy, "src"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "package.json"), JSON.stringify({ name: "opencode-desktop-goals", exports: { ".": "./src/index.ts" } }));
  fs.writeFileSync(path.join(legacy, "src/prompts.mjs"), 'export const PLUGIN_ID = "desktop-goals";');
  fs.writeFileSync(path.join(legacy, "src/index.ts"), "const runtime = new GoalRuntime({});");
  fs.writeFileSync(f.configFile, JSON.stringify({ plugins: [{ package: pathToFileURL(legacy).href, options: { keep: true } }, "other", legacy] }));
  const deployment = installGoals(f.options);
  assert.deepEqual(f.read().plugins, [{ package: deployment.pluginDirectory.replaceAll("\\", "/"), options: { keep: true } }, "other"]);
  assert.ok(fs.existsSync(path.join(legacy, "src/index.ts")), "Do not delete old user-owned source");
});

test("restore only unregisters managed paths and retains goals/files and user edits", t => {
  const f = fixture(t), deployment = installGoals(f.options);
  const config = f.read();
  config.model = "user/new-model";
  config.plugins.push("another-plugin");
  fs.writeFileSync(f.configFile, JSON.stringify(config));
  const savedGoals = path.join(deployment.pluginDirectory, "user-goals.json");
  fs.writeFileSync(savedGoals, '{"keep":true}');
  installGoals({ ...f.options, uninstall: true });
  assert.deepEqual(f.read().plugins, ["another-plugin"]);
  assert.equal(f.read().model, "user/new-model");
  assert.equal(fs.readFileSync(savedGoals, "utf8"), '{"keep":true}');
  assert.ok(fs.existsSync(path.join(deployment.pluginDirectory, "server.mjs")));
  assert.equal(installGoals({ ...f.options, uninstall: true }).changed, false);
});

test("restore with no install record is a no-op, even with invalid unrelated config", t => {
  const f = fixture(t); fs.writeFileSync(f.configFile, "invalid user configuration");
  installGoals({ ...f.options, uninstall: true });
  assert.deepEqual(fs.readdirSync(f.configDirectory), ["opencode.jsonc"]);
});

test("concurrent configuration edits trigger rollback to the exact pre-run ASAR", t => {
  const f = fixture(t), asar = path.join(f.root, "app.asar");
  fs.writeFileSync(asar, "original-current-package");
  fs.writeFileSync(f.configFile, "{}");
  const transaction = prepareGoals(f.options);
  fs.writeFileSync(f.configFile, '{"model":"concurrent-edit"}');
  assert.throws(() => writeDesktopPatch(asar, Buffer.from("patched"), transaction), /已变化/);
  assert.equal(fs.readFileSync(asar, "utf8"), "original-current-package");
  assert.equal(f.read().model, "concurrent-edit");
  assert.equal(fs.existsSync(path.join(f.configDirectory, "desktop-mod-goals/install.lock")), false);
});

test("rollback reverts only bytes written by this transaction", t => {
  const f = fixture(t); fs.writeFileSync(f.configFile, '{"plugins":["keep"]}');
  const transaction = prepareGoals(f.options);
  transaction.commit(); transaction.rollback();
  assert.deepEqual(f.read().plugins, ["keep"]);
  assert.equal(fs.existsSync(path.join(f.configDirectory, "desktop-mod-goals/install.json")), false);
  const next = prepareGoals(f.options); next.commit();
  fs.writeFileSync(f.configFile, '{"model":"concurrent-after-commit"}');
  assert.throws(() => next.rollback(), /已变化/);
  assert.equal(f.read().model, "concurrent-after-commit");
});

test("failed ASAR write never registers goals; modified deployment files are not overwritten", t => {
  const f = fixture(t), asar = path.join(f.root, "app.asar");
  fs.writeFileSync(asar, "current");
  assert.throws(() => writeDesktopPatch(asar, Buffer.from("patch"), prepareGoals(f.options), Buffer.from("stale")), /已变化/);
  assert.equal(fs.existsSync(f.configFile), false);
  const installed = installGoals(f.options);
  fs.writeFileSync(path.join(installed.pluginDirectory, "server.mjs"), "user-modified");
  assert.throws(() => installGoals(f.options), /拒绝覆盖/);
  assert.equal(fs.readFileSync(path.join(installed.pluginDirectory, "server.mjs"), "utf8"), "user-modified");
});

test("an update replaces one managed registration and keeps previous payloads intact", t => {
  const f = fixture(t), first = installGoals(f.options);
  const nextSource = path.join(f.root, "next-release");
  fs.mkdirSync(nextSource);
  for (const name of ["dist", "LICENSES"]) fs.cpSync(path.join(source, name), path.join(nextSource, name), { recursive: true });
  for (const name of ["NOTICE", "LICENSE"]) fs.copyFileSync(path.join(source, name), path.join(nextSource, name));
  fs.appendFileSync(path.join(nextSource, "dist/server.mjs"), "\n// next release\n");
  const second = installGoals({ ...f.options, sourceDirectory: nextSource });
  assert.notEqual(second.pluginDirectory, first.pluginDirectory);
  assert.deepEqual(f.read().plugins, [second.pluginDirectory.replaceAll("\\", "/")]);
  assert.ok(fs.existsSync(path.join(first.pluginDirectory, "server.mjs")));
  assert.equal(installGoals({ ...f.options, sourceDirectory: nextSource }).changed, false);
  installGoals({ ...f.options, uninstall: true });
  assert.deepEqual(f.read().plugins, []);
});

test("removes first/middle/final entries and trailing commas without damaging comments", t => {
  const f = fixture(t), installed = installGoals(f.options);
  const entry = JSON.stringify(installed.pluginDirectory.replaceAll("\\", "/"));
  for (const entries of [
    `${entry}, /* after managed */ "keep"`,
    `"keep", ${entry} /* before bracket */`,
    `"keep", ${entry}, /* keep end comment */`,
    `"keep", ${entry}, "last"`,
    `${entry} /* only managed entry */`,
  ]) {
    fs.writeFileSync(f.configFile, `{ "plugins": [${entries}], "model": "keep-model" }`);
    installGoals({ ...f.options, uninstall: true });
    const expected = entries.includes('"last"') ? ["keep", "last"] : entries.includes('"keep"') ? ["keep"] : [];
    assert.deepEqual(f.read().plugins, expected);
    assert.equal(f.read().model, "keep-model");
    if (entries.includes("/*")) assert.ok(fs.readFileSync(f.configFile, "utf8").includes("/*"));
  }
});

test("an existing install lock is not removed or bypassed by another transaction", t => {
  const f = fixture(t), first = prepareGoals(f.options), second = prepareGoals(f.options);
  first.commit();
  assert.throws(() => second.commit(), /另一安装/);
  second.finish();
  assert.ok(fs.existsSync(path.join(f.configDirectory, "desktop-mod-goals/install.lock")));
  first.finish();
});

test("restore uses the recorded config if another config file appeared later", t => {
  const f = fixture(t); installGoals(f.options);
  const otherFile = path.join(f.configDirectory, "opencode.json");
  fs.writeFileSync(otherFile, '{"plugins":["unrelated"]}');
  installGoals({ ...f.options, uninstall: true });
  assert.deepEqual(f.read().plugins, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(otherFile)), { plugins: ["unrelated"] });
});
