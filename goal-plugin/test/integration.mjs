// Opt-in real OpenCode test. All data, config and credentials are isolated;
// model requests go to a loopback fixture, never a paid provider.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { OpenCode } from "@opencode/client";
import { Goals } from "../dist/rpc.mjs";
import { installGoals } from "../deploy.mjs";

const cli = process.env.OPENCODE_TEST_CLI || process.argv[2];
if (!cli) throw new Error("Set OPENCODE_TEST_CLI to a 2.2.7+ executable to run the isolated integration test.");
const tempBase = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Temp", "opencode") : (await import("node:os")).tmpdir();
const root = await fs.mkdtemp(path.join(tempBase, "goal-integration-"));
const project = path.join(root, "project");
const config = path.join(root, "config");
await fs.mkdir(project, { recursive: true });
await fs.mkdir(config, { recursive: true });
let calls = [], step = 0, serverOutput = "", hold = false, completeTool = false, lastRequest;
const model = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  lastRequest = body;
  calls.push({ url: request.url, tools: (body.tools ?? []).map(tool => tool.function?.name), completeTool });
  if (request.url === "/v1/models") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "fixture", object: "model" }] })); return;
  }
  const text = "Inspected authoritative fixture state and made concrete progress.";
  const tools = body.tools ?? [];
  // A deterministic fixture exercises native model -> tool -> runtime completion.
  // Direct tool mode is enabled in the fixture config for easy protocol inspection.
  const systemText = JSON.stringify((body.messages ?? []).filter(message => message.role === "system"));
  const goalText = [...systemText.matchAll(/Goal ID: ([a-f0-9-]+); revision: (\d+)/g)].at(-1);
  calls.at(-1).goalText = goalText?.[0];
  const shouldComplete = completeTool && tools.some(tool => tool.function?.name === "update_goal") && goalText;
  const delta = shouldComplete ? { tool_calls: [{ index: 0, id: "call_goal_done", type: "function", function: {
    name: "update_goal", arguments: JSON.stringify({ goalID: goalText[1], revision: Number(goalText[2]), status: "complete", evidence: "Fixture requirements inspected; deterministic completion verified." }),
  } }] } : { content: text };
  if (shouldComplete) completeTool = false;
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({ id: `chat-${++step}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }] })}\n\n`);
  if (hold || step > 40) { response.on("close", () => {}); return; }
  response.write(`data: ${JSON.stringify({ id: `chat-${step}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: {}, finish_reason: shouldComplete ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
  response.end("data: [DONE]\n\n");
});
model.listen(0, "127.0.0.1"); await once(model, "listening");
const modelPort = model.address().port;
await fs.writeFile(path.join(config, "opencode.json"), JSON.stringify({
  $schema: "https://opencode.ai/config.json",
  model: "goal-fixture/fixture", update: "disable", warming: false, snapshots: false,
  providers: { "goal-fixture": {
    name: "Goal local fixture", env: ["GOAL_FIXTURE_KEY"], package: "@opencode/ai/providers/openai-compatible",
    settings: { baseURL: `http://127.0.0.1:${modelPort}/v1`, encoding: "none" },
    models: { fixture: { name: "Fixture", limit: { context: 128000, output: 4096 }, capabilities: { tools: true } } },
  } },
  experimental: { codemode: false },
}, null, 2));
const providerConfigBefore = await fs.readFile(path.join(config, "opencode.json"), "utf8");
await fs.writeFile(path.join(config, "opencode.jsonc"), '{\n  // Higher-priority config: preserve the provider/model in opencode.json.\n  "$schema": "https://opencode.ai/config.json"\n}\n');
const deployment = installGoals({ version: "2.2.7", configDirectory: config, env: {} });
assert.equal(deployment.configFile, path.join(config, "opencode.jsonc"));
assert.equal(await fs.readFile(path.join(config, "opencode.json"), "utf8"), providerConfigBefore);
assert.equal(installGoals({ version: "2.2.7", configDirectory: config, env: {} }).changed, false);
assert.equal((await fs.readdir(deployment.pluginDirectory)).includes("node_modules"), false);
assert.equal((await fs.readdir(deployment.pluginDirectory)).includes("src"), false);
const installedPackage = JSON.parse(await fs.readFile(path.join(deployment.pluginDirectory, "package.json"), "utf8"));
assert.equal(installedPackage.dependencies, undefined);
const reserve = net.createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const env = {
  ...process.env, OPENCODE_TEST_HOME: root, OPENCODE_CONFIG_DIR: config,
  HOME: root, USERPROFILE: root,
  XDG_CONFIG_HOME: path.join(root, "xdg-config"), XDG_DATA_HOME: path.join(root, "data"),
  XDG_STATE_HOME: path.join(root, "state"), XDG_CACHE_HOME: path.join(root, "cache"),
  OPENCODE_DB: path.join(root, "isolated.db"), GOAL_FIXTURE_KEY: "local-fixture-not-a-secret",
  OPENCODE_SERVER_PASSWORD: "goal-fixture", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
};
const launch = () => {
  const process = spawn(cli, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--log-level", "debug", "--print-logs"], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
  process.stdout.on("data", data => { serverOutput += data; });
  process.stderr.on("data", data => { serverOutput += data; });
  return process;
};
let child = launch();
const baseUrl = `http://127.0.0.1:${port}`;
const auth = { authorization: `Basic ${Buffer.from("opencode:goal-fixture").toString("base64")}` };
const client = OpenCode.make({ baseUrl, headers: auth });
const rpc = client.rpc(Goals);
const location = { directory: project };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, description, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Server exited (${child.exitCode})\n${serverOutput}`);
    try { const result = await predicate(); if (result) return result; } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
    }
    await delay(60);
  }
  throw new Error(`Timed out: ${description}\n${serverOutput.slice(-18000)}\nFixture calls: ${JSON.stringify(calls.slice(-4)).slice(-6000)}`);
}
try {
  await until(() => client.server.info(), "isolated server ready");
  const paths = await new Promise((resolve, reject) => {
    const check = spawn(cli, ["debug", "paths", "db"], { cwd: project, env }); let out = "";
    check.stdout.on("data", data => { out += data; }); check.on("error", reject); check.on("exit", code => code === 0 ? resolve(out.trim()) : reject(new Error("Cannot verify isolated database")));
  });
  assert.equal(path.resolve(paths), path.join(root, "isolated.db"), "must never touch the user's real database");
  const plugins = await until(async () => {
    const plugins = await client.plugin.list({ location });
    return JSON.stringify(plugins).includes("desktop-goals") && plugins;
  }, "goal server plugin loaded");
  const loadedPlugin = plugins.data.find(plugin => plugin.id === "desktop-goals");
  assert.equal(plugins.data.filter(plugin => plugin.id === "desktop-goals").length, 1, "dual configs do not duplicate goal registration");
  assert.equal(loadedPlugin.state.status, "active");
  assert.equal(loadedPlugin.features.gui, true);
  const gui = await client.plugin.gui({ location, id: "desktop-goals" });
  assert.equal(gui.data.code, await fs.readFile(path.join(deployment.pluginDirectory, "gui-experimental.cjs"), "utf8"), "the native GUI endpoint serves the deployed bundle");
  // The desktop toggle adds metadata to one real native prompt. Failed file
  // resolution, ordinary chat and an unpromoted queue must not create goals.
  const composerSession = await client.session.create({ title: "Composer goal fixture", location, agent: "build", model: { providerID: "goal-fixture", id: "fixture" } });
  const composerInput = { sessionID: composerSession.id };
  hold = true;
  await client.session.prompt({ ...composerInput, text: "Ordinary chat stays ordinary." });
  await until(async () => (await client.session.active())[composerSession.id], "ordinary composer execution");
  assert.equal(await rpc.get(composerInput, { location }), null);
  await client.session.interrupt({ ...composerInput, resume: false });
  const marker = { desktopGoal: { version: 1, objective: "Finish the composer fixture with its text attachment." }, displayText: "Finish the composer fixture with its text attachment." };
  await assert.rejects(client.session.prompt({ ...composerInput, text: marker.displayText, metadata: marker, files: [{ uri: "file:///does-not-exist-goal-fixture.txt" }] }));
  assert.equal(await rpc.get(composerInput, { location }), null, "Failed sends cannot create phantom running goals");
  const sent = await client.session.prompt({ ...composerInput, text: marker.displayText, metadata: marker,
    files: [{ uri: "data:text/plain;base64," + Buffer.from("Full attachment content 中文").toString("base64"), name: "fixture.txt" }] });
  const composerGoal = await until(async () => { const goal = await rpc.get(composerInput, { location }); return goal?.status === "active" && goal; }, "composer native prompt creates goal");
  assert.equal(composerGoal.objective, marker.desktopGoal.objective);
  assert.equal(composerGoal.rounds, 1);
  assert.equal(composerGoal.sourceMessageID, sent.id);
  await assert.rejects(client.session.prompt({ ...composerInput, text: "Do not overwrite an unfinished goal.", metadata: { desktopGoal: { version: 1, objective: "Do not overwrite an unfinished goal." } } }));
  assert.equal((await rpc.get(composerInput, { location })).id, composerGoal.id, "Conflicting sends leave the original goal intact");
  const composerMessages = await client.session.context(composerInput);
  assert.equal(composerMessages.filter(message => message.type === "user" && message.metadata?.desktopGoal).length, 1);
  assert.equal(composerMessages.filter(message => message.type === "synthetic" && message.metadata?.source === "desktop-goals").length, 0, "No duplicate first round");
  assert.equal(composerMessages.find(message => message.type === "user" && message.metadata?.desktopGoal).files[0].name, "fixture.txt");
  await client.session.interrupt({ ...composerInput, resume: false });
  await until(async () => (await rpc.get(composerInput, { location }))?.status === "paused", "Stop pauses composer goal");
  await rpc.control({ ...composerInput, action: "clear" }, { location });
  hold = true;
  await client.session.prompt({ ...composerInput, text: "Normal follow-up after clearing goal." });
  await until(async () => (await client.session.active())[composerSession.id], "follow-up execution active");
  assert.equal(await rpc.get(composerInput, { location }), null, "Old metadata in history never recreates a cleared goal");
  await client.session.interrupt({ ...composerInput, resume: false });
  await client.session.switchAgent({ ...composerInput, agent: "plan" });
  await assert.rejects(client.session.prompt({ ...composerInput, text: "Cannot bypass Plan.", metadata: { desktopGoal: { version: 1, objective: "Cannot bypass Plan." } } }));
  assert.equal(await rpc.get(composerInput, { location }), null);
  await client.session.switchAgent({ ...composerInput, agent: "build" });
  completeTool = true; hold = false;
  await client.session.prompt({ ...composerInput, text: "Complete this native goal-mode prompt.", metadata: { desktopGoal: { version: 1, objective: "Complete this native goal-mode prompt." } } });
  await until(async () => (await rpc.get(composerInput, { location }))?.status === "complete", "composer goal can complete through the native model tool");
  await client.experimental.session.wait(composerInput);
  await rpc.control({ ...composerInput, action: "clear" }, { location });
  hold = false;
  const session = await client.session.create({ title: "Goals fixture", location, agent: "build", model: { providerID: "goal-fixture", id: "fixture" } });
  const input = { sessionID: session.id };
  assert.equal(await rpc.get(input, { location }), null);
  const created = await rpc.control({ ...input, action: "create", objective: "Finish the deterministic local fixture; verify every requirement.", tokenBudget: 120 }, { location });
  assert.equal(created.status, "active");
  const budget = await until(async () => { const goal = await rpc.get(input, { location }); return goal.status === "budget_limited" && goal; }, "native auto continuation reaches budget");
  assert.ok(budget.rounds >= 2, "must cross native idle boundaries, not just tool steps");
  assert.ok(calls.every(call => call.url.startsWith("/v1/")));
  await client.session.interrupt({ ...input, resume: false });
  await rpc.control({ ...input, action: "budget", tokenBudget: 10000 }, { location });
  hold = true;
  await rpc.control({ ...input, action: "resume" }, { location });
  await until(async () => (await client.session.active())[session.id], "resumed execution active");
  const paused = await rpc.control({ ...input, action: "pause" }, { location });
  assert.equal(paused.status, "paused");
  await until(async () => !(await client.session.active())[session.id], "pause interrupts the native executor");
  const afterPause = calls.length; await delay(250);
  assert.equal(calls.length, afterPause, "paused goals cannot auto-revive");
  hold = false; completeTool = true;
  await rpc.control({ ...input, action: "resume" }, { location });
  const complete = await until(async () => { const goal = await rpc.get(input, { location }); return goal.status === "complete" && goal; }, "native goal tool completes goal");
  assert.ok(complete.tokensUsed >= budget.tokensUsed);
  await rpc.control({ ...input, action: "clear" }, { location });
  assert.equal(await rpc.get(input, { location }), null);
  // A native Stop action, rather than the plugin's own pause button, must also
  // revoke automatic continuation without waiting for another idle hook.
  hold = true;
  await client.session.command({ ...input, name: "goal", text: "Check native Stop semantics." });
  await until(async () => (await client.session.active())[session.id], "native stop fixture active");
  await client.session.interrupt({ ...input, resume: false });
  await until(async () => (await rpc.get(input, { location }))?.status === "paused", "native Stop pauses goal");
  await rpc.control({ ...input, action: "clear" }, { location });
  // The native slash-command route uses the same persisted runtime.
  hold = true;
  await client.session.command({ ...input, name: "goal", text: "Restart fixture with the full original objective." });
  const restartGoal = await rpc.get(input, { location });
  assert.equal(restartGoal.status, "active");
  await until(async () => (await client.session.active())[session.id], "restart fixture in-flight");
  await client.session.command({ ...input, name: "goal", text: "budget 20000" });
  assert.equal((await rpc.get(input, { location })).tokenBudget, 20000);
  child.kill(); if (child.exitCode == null) await once(child, "exit");
  hold = false; completeTool = true;
  serverOutput += "\n--- isolated server restart ---\n";
  child = launch();
  await until(() => client.server.info(), "server restarted with the same isolated database");
  await until(async () => (await client.plugin.list({ location })).data.some(plugin => plugin.id === "desktop-goals"), "plugin reloaded after restart");
  const recovered = await until(async () => {
    const goal = await rpc.get(input, { location });
    return goal?.id === restartGoal.id && goal.status === "complete" && goal;
  }, "native in-flight recovery preserves and completes the same goal");
  assert.ok(recovered.rounds <= restartGoal.rounds + 1, "unmanaged serve may require one confirmed-idle recovery continuation, not a duplicate execution");
  await rpc.control({ ...input, action: "clear" }, { location });
  console.log(`Real OpenCode offline-package integration passed (dual JSON/JSONC, no node_modules/source links): composer goal-mode/native attachments/failure/replay/Stop, ${budget.rounds} goal rounds, budget/pause/resume/tool completion/commands/clear, same-goal restart recovery; ${calls.length} local fixture calls. Data: ${root}`);
} catch (error) {
  console.error(`Isolated test artifacts retained at ${root}`);
  throw error;
} finally {
  child.kill(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  if (child.exitCode == null) await Promise.race([once(child, "exit"), delay(3000)]);
  await fs.writeFile(path.join(root, "server.log"), serverOutput);
  await fs.writeFile(path.join(root, "fixture-calls.json"), JSON.stringify(calls, null, 2));
  if (lastRequest) await fs.writeFile(path.join(root, "last-request.json"), JSON.stringify(lastRequest, null, 2));
}
