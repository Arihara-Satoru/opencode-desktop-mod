import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "../dist/jsonc.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));
const tempBase = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Temp", "opencode") : os.tmpdir();
test("installer preserves comments, credentials, plugin entries and idempotency; uninstall removes only its own entry", async () => {
  const root = await fs.mkdtemp(path.join(tempBase, "goal-install-"));
  const config = path.join(root, "opencode.jsonc");
  const before = '{\n  // Keep this comment and the user settings.\n  "model": "existing/model",\n  "providers": { "example": { "settings": { "apiKey": "{env:KEY}" } } },\n  "plugins": [\n    // Keep the existing plugin annotation.\n    "other-plugin",\n    { "package": "another", "options": { "strict": true } },\n  ],\n}\n';
  await fs.writeFile(config, before);
  const run = extra => {
    const result = spawnSync(process.execPath, ["install.mjs", "--config", config, ...extra], { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  run([]);
  const installed = await fs.readFile(config, "utf8"), value = parse(installed);
  assert.ok(installed.includes("// Keep this comment"));
  assert.ok(installed.includes("// Keep the existing plugin annotation."));
  assert.equal(value.model, "existing/model");
  assert.equal(value.providers.example.settings.apiKey, "{env:KEY}");
  assert.equal(value.plugins.length, 3);
  assert.deepEqual(value.plugins[1], { package: "another", options: { strict: true } });
  const backups = (await fs.readdir(root)).filter(name => name.endsWith(".bak"));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(root, backups[0]), "utf8"), before);
  run([]);
  assert.equal(await fs.readFile(config, "utf8"), installed);
  assert.equal((await fs.readdir(root)).filter(name => name.endsWith(".bak")).length, 1);
  run(["--uninstall"]);
  const removed = parse(await fs.readFile(config, "utf8"));
  assert.deepEqual(removed.plugins, parse(before).plugins);
  assert.equal(removed.providers.example.settings.apiKey, "{env:KEY}");
});

test("installer refuses invalid JSONC without modifying it", async () => {
  const root = await fs.mkdtemp(path.join(tempBase, "goal-invalid-"));
  const config = path.join(root, "opencode.jsonc"), invalid = '{ "plugins": [ }';
  await fs.writeFile(config, invalid);
  const result = spawnSync(process.execPath, ["install.mjs", "--config", config], { cwd: directory, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(await fs.readFile(config, "utf8"), invalid);
});
