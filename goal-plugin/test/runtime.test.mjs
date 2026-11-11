import assert from "node:assert/strict";
import test from "node:test";
import { GoalRuntime, goalTokens, isCompanionSession, validateBudget, validateObjective } from "../src/runtime.mjs";

function harness() {
  const values = new Map(), messages = [], updates = [], contexts = new Map(), admitted = new Map();
  const session = { id: "ses_test", agent: "build", location: { directory: "D:/project" }, time: {}, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } };
  let now = 1000, interrupts = 0;
  const host = {
    directory: "D:/project", now: () => now,
    storage: {
      get: async key => structuredClone(values.get(key)),
      set: async (key, value) => { values.set(key, structuredClone(value)); },
      remove: async key => { values.delete(key); },
      scan: async ({ prefix }) => ({ entries: [...values].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) })) }),
    },
    getSession: async () => structuredClone(session),
    context: async () => structuredClone(messages),
    setContext: async (id, value) => { contexts.set(id, value); },
    removeContext: async id => { contexts.delete(id); },
    synthetic: async input => {
      if (!admitted.has(input.id)) {
        admitted.set(input.id, structuredClone(input));
        messages.push({ id: input.id, type: "synthetic", text: input.text, metadata: input.metadata });
      }
    },
    interrupt: async () => { interrupts++; },
    changed: async (id, goal) => { updates.push(structuredClone(goal)); },
  };
  const runtime = new GoalRuntime(host);
  return {
    runtime, host, values, session, messages, admitted, updates, contexts,
    tick: ms => { now += ms; }, interrupts: () => interrupts,
    create: input => runtime.mutate(session.id, "create", { objective: "Complete the feature and verify tests", ...input }),
    goal: () => runtime.get(session.id),
    progress: text => messages.push({ type: "assistant", content: [{ type: "text", text: text ?? "Inspected current state." }] }),
  };
}

test("validates objectives and explicit optional budgets", () => {
  assert.equal(validateBudget(undefined), null);
  for (const value of [0, -1, 1.5, NaN, Infinity, "100", Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validateBudget(value));
  assert.equal(validateObjective("  goal  "), "goal");
  assert.throws(() => validateObjective(" "));
  assert.throws(() => validateObjective("a".repeat(4001)));
  assert.equal(validateObjective("🙂".repeat(4000)).length, 8000);
});

test("normalizes OpenCode disjoint usage without charging cached reads twice", () => {
  assert.equal(goalTokens({ input: 10, output: 20, reasoning: 5, cache: { read: 1000, write: 3 } }), 38);
  assert.equal(goalTokens({ input: NaN, output: -10 }), 0);
});

test("recognizes the existing isolated read-only /btw companion without excluding regular subagents", () => {
  assert.equal(isCompanionSession({ title: "/btw", permissions: [{ action: "edit", effect: "deny", resource: "*" }, { action: "shell", effect: "deny", resource: "*" }] }), true);
  assert.equal(isCompanionSession({ title: "/btw" }), false);
  assert.equal(isCompanionSession({ title: "subagent", permissions: [{ action: "edit", effect: "deny", resource: "*" }, { action: "shell", effect: "deny", resource: "*" }] }), false);
});

test("creates one durable session goal and admits internal queued work", async () => {
  const h = harness(), goal = await h.create();
  assert.equal(goal.status, "active");
  assert.equal(goal.tokenBudget, null);
  assert.equal(h.admitted.size, 1);
  assert.equal([...h.admitted.values()][0].resume, true);
  assert.equal([...h.admitted.values()][0].delivery, "queue");
  assert.match(h.contexts.get(h.session.id), /higher-priority/);
  await assert.rejects(h.create(), /未完成/);
});

const goalEvent = (h, id = "msg_goal_input", text = "Complete the feature with attachments") => ({
  sessionID: h.session.id, messageID: id, prompt: { text, files: [{ uri: "file:///fixture.txt" }] },
  metadata: { desktopGoal: { version: 1, objective: text, sessionID: h.session.id, epoch: 0 }, displayText: text }, delivery: "queue",
});
const goalContextEvent = (h, id = "msg_goal_input") => ({ sessionID: h.session.id, agent: h.session.agent,
  system: [], tools: { get_goal: {}, update_goal: {}, shell: {} }, messages: [{ id, role: "user", content: "Native prompt" }] });

test("goal-mode admission validates without creating work until the user message is durable", async () => {
  const h = harness(), event = goalEvent(h);
  const before = structuredClone(event);
  await h.runtime.prompt(event);
  assert.deepEqual(event, before, "Keep native text, files, user metadata and queue delivery untouched");
  assert.equal(await h.goal(), null, "Failed attachment resolution must leave no goal or runner");
  await h.runtime.beforeContext(goalContextEvent(h));
  assert.equal(await h.goal(), null, "An event ID alone is not proof of durable user admission");
  h.messages.push({ type: "user", id: event.messageID, text: event.prompt.text, metadata: event.metadata });
  await h.runtime.beforeContext(goalContextEvent(h));
  const goal = await h.goal();
  assert.equal(goal.status, "active"); assert.equal(goal.objective, event.prompt.text); assert.equal(goal.rounds, 1);
  assert.equal(h.admitted.size, 0, "The first round is the native prompt, never a duplicate synthetic turn");
  h.progress(); await h.runtime.idle(h.session.id);
  assert.equal(h.admitted.size, 1); assert.equal((await h.goal()).rounds, 2);
  assert.equal([...h.admitted.values()][0].resume, false);
});

test("ordinary prompts and quoted goal-looking text never implicitly create goals", async () => {
  const h = harness(), event = goalEvent(h);
  delete event.metadata.desktopGoal;
  await h.runtime.prompt(event);
  h.messages.push({ type: "user", id: event.messageID, metadata: event.metadata });
  await h.runtime.beforeContext(goalContextEvent(h));
  assert.equal(await h.goal(), null);
});

test("forked user metadata cannot copy a goal authorization to a new session", async () => {
  const h = harness(), event = goalEvent(h);
  event.metadata.desktopGoal.sessionID = "ses_original";
  h.messages.push({ type: "user", id: event.messageID, metadata: event.metadata });
  await h.runtime.beforeContext(goalContextEvent(h));
  assert.equal(await h.goal(), null);
  assert.equal(h.admitted.size, 0);
});

test("Stop and clear revoke goal-mode input before its first model request", async () => {
  for (const stop of [h => h.runtime.observe({ type: "session.execution.interrupted", data: { sessionID: h.session.id, reason: "user" } }),
    h => h.runtime.mutate(h.session.id, "clear")]) {
    const h = harness(), event = goalEvent(h);
    await h.runtime.prompt(event);
    h.messages.push({ type: "user", id: event.messageID, metadata: event.metadata });
    await stop(h);
    await h.runtime.beforeContext(goalContextEvent(h));
    assert.equal(await h.goal(), null, "Old pending authorization must not start when normal chat resumes");
    const next = goalEvent(h, "msg_new_input"); await h.runtime.prompt(next);
    h.messages.push({ type: "user", id: next.messageID, metadata: next.metadata });
    await h.runtime.beforeContext(goalContextEvent(h, next.messageID));
    assert.equal((await h.goal()).sourceMessageID, next.messageID, "Only a new explicit send can start the goal");
  }
});

test("goal input replay is idempotent across completion, clear, restart and concurrent context reads", async () => {
  const h = harness(), event = goalEvent(h);
  h.messages.push({ type: "user", id: event.messageID, metadata: event.metadata });
  await Promise.all([h.runtime.beforeContext(goalContextEvent(h)), h.runtime.beforeContext(goalContextEvent(h))]);
  const first = await h.goal();
  await h.runtime.report(h.session.id, { goalID: first.id, revision: first.revision, status: "complete", evidence: "Verified" });
  await h.runtime.beforeContext(goalContextEvent(h)); assert.equal((await h.goal()).id, first.id);
  await h.runtime.mutate(h.session.id, "clear");
  await new GoalRuntime(h.host).beforeContext(goalContextEvent(h));
  assert.equal(await h.goal(), null, "Old user authorization is permanently consumed even after clear");
  assert.equal(h.admitted.size, 0);
});

test("an unpromoted queued goal and Plan mode cannot authorize execution", async () => {
  const h = harness(), event = goalEvent(h);
  h.messages.push({ type: "user", id: event.messageID, metadata: event.metadata });
  await h.runtime.beforeContext(goalContextEvent(h, "msg_other"));
  assert.equal(await h.goal(), null, "Only prompt IDs in the model's current context can activate");
  h.session.agent = "plan";
  await assert.rejects(h.runtime.prompt(event), /Plan/);
  await h.runtime.beforeContext(goalContextEvent(h));
  assert.equal(await h.goal(), null);
  h.session.agent = "build";
  await h.runtime.beforeContext(goalContextEvent(h));
  assert.equal(await h.goal(), null, "A rejected Plan input is not replayed later as authorization");
});

test("goal-mode sends never overwrite an unfinished goal or revive cleared inputs", async () => {
  const h = harness(), first = await h.create(), event = goalEvent(h);
  await assert.rejects(h.runtime.prompt(event), /未完成目标/);
  h.messages.push({ type: "user", id: event.messageID, metadata: event.metadata });
  const context = goalContextEvent(h); await h.runtime.beforeContext(context);
  assert.equal((await h.goal()).id, first.id);
  assert.ok(context.system.some(part => part.text.includes("未覆盖原目标")));
  await h.runtime.mutate(h.session.id, "clear");
  await h.runtime.beforeContext(goalContextEvent(h)); assert.equal(await h.goal(), null);
  for (const change of [s => { s.parentID = "ses_parent"; }, s => { s.time.archived = 1; }, s => { s.location.directory = "D:/other"; }]) {
    const other = harness(); change(other.session); await assert.rejects(other.runtime.prompt(goalEvent(other)));
    assert.equal(other.admitted.size, 0);
  }
});

test("continues inside the native idle hook without a second execution", async () => {
  const h = harness(); await h.create(); h.progress();
  await h.runtime.idle(h.session.id);
  assert.equal(h.admitted.size, 2);
  assert.equal([...h.admitted.values()][1].resume, false);
  assert.equal((await h.goal()).rounds, 2);
});

test("a pending user mutation cancels an in-flight idle decision", async () => {
  const h = harness(); await h.create(); h.progress();
  let reached, release;
  const entered = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  h.host.context = async () => { reached(); await gate; return h.messages; };
  const idle = h.runtime.idle(h.session.id);
  await entered;
  const pause = h.runtime.mutate(h.session.id, "pause");
  release(); await Promise.all([idle, pause]);
  assert.equal(h.admitted.size, 1);
  assert.equal((await h.goal()).status, "paused");
  assert.equal(h.interrupts(), 1);
});

test("pause, native user stop, clear and stale idle callbacks never revive goals", async () => {
  const h = harness(); await h.create();
  await h.runtime.observe({ id: "evt_stop", type: "session.execution.interrupted", data: { sessionID: h.session.id, reason: "user" } });
  await h.runtime.idle(h.session.id);
  assert.equal((await h.goal()).status, "paused");
  assert.equal(h.admitted.size, 1);
  await h.runtime.mutate(h.session.id, "clear");
  await h.runtime.idle(h.session.id);
  assert.equal(await h.goal(), null);
  assert.equal(h.contexts.size, 0);
});

test("completion needs current ID, revision and explicit evidence", async () => {
  const h = harness(), first = await h.create();
  const updated = await h.runtime.mutate(h.session.id, "edit", { objective: "Original full scope, plus tests" });
  await assert.rejects(h.runtime.report(h.session.id, { goalID: first.id, revision: first.revision, status: "complete", evidence: "ok" }), /目标已变化/);
  await assert.rejects(h.runtime.report(h.session.id, { goalID: updated.id, revision: updated.revision, status: "complete", evidence: "" }), /证据/);
  const complete = await h.runtime.report(h.session.id, { goalID: updated.id, revision: updated.revision, status: "complete", evidence: "All specified requirements checked, tests and build pass." });
  assert.equal(complete.status, "complete");
  await h.runtime.idle(h.session.id);
  assert.equal(h.admitted.size, 1);
  await assert.rejects(h.runtime.mutate(h.session.id, "resume"), /已完成/);
});

test("budget accounting uses deltas and survives duplicate notifications", async () => {
  const h = harness(); h.session.tokens.input = 500; await h.create({ tokenBudget: 100 });
  h.session.tokens.input += 60; h.session.tokens.output += 50; h.tick(2000);
  const event = { id: "evt_usage", type: "session.usage.updated", data: { sessionID: h.session.id } };
  await Promise.all([h.runtime.observe(event), h.runtime.observe(event)]);
  const goal = await h.goal();
  assert.equal(goal.tokensUsed, 110);
  assert.equal(goal.status, "budget_limited");
  assert.equal(goal.timeUsedMs, 2000);
  await assert.rejects(h.runtime.mutate(h.session.id, "resume"), /预算/);
  const increased = await h.runtime.mutate(h.session.id, "budget", { tokenBudget: 300 });
  assert.equal(increased.status, "budget_limited");
  assert.equal(increased.tokensUsed, 110);
  await h.runtime.mutate(h.session.id, "resume");
  assert.equal((await h.goal()).status, "active");
});

test("three truly empty rounds block, but delayed activity events do not", async () => {
  const h = harness(); await h.create();
  await h.runtime.idle(h.session.id); await h.runtime.idle(h.session.id); await h.runtime.idle(h.session.id);
  assert.equal((await h.goal()).status, "blocked");
  const progressing = harness(); await progressing.create();
  for (let i = 0; i < 5; i++) { progressing.progress(); await progressing.runtime.idle(progressing.session.id); }
  assert.equal((await progressing.goal()).status, "active");
});

test("waits for real native background work without polling new model rounds", async () => {
  const h = harness(); await h.create(); h.progress();
  await h.runtime.idle(h.session.id, [{ kind: "shell", sessionID: h.session.id, shellID: "job" }]);
  assert.equal(h.admitted.size, 1);
  await h.runtime.idle(h.session.id, []);
  assert.equal(h.admitted.size, 2);
});

test("never bypasses Plan, child-session, archived or foreign-location boundaries", async () => {
  for (const modify of [s => { s.agent = "plan"; }, s => { s.parentID = "ses_parent"; }, s => { s.time.archived = 1; }, s => { s.location.directory = "D:/elsewhere"; }]) {
    const h = harness(); modify(h.session); await assert.rejects(h.create()); assert.equal(h.admitted.size, 0);
  }
  const h = harness(); await h.create(); h.session.agent = "plan"; h.progress();
  await h.runtime.idle(h.session.id); assert.equal(h.admitted.size, 1);
});

test("stale goal messages are identified by internal IDs, not user text", async () => {
  const h = harness(); const goal = await h.create(); await h.runtime.mutate(h.session.id, "clear");
  const userText = `Continue the active session goal ${goal.id}, revision 1.`;
  const event = { sessionID: h.session.id, agent: "build", system: [], tools: { shell: {}, update_goal: {} }, messages: [
    { id: [...h.admitted.keys()][0], role: "user", content: userText },
    { id: "msg_user", role: "user", content: userText },
  ] };
  await h.runtime.beforeContext(event);
  assert.match(event.messages[0].content, /cancelled/);
  assert.equal(event.messages[1].content, userText);
  assert.ok(event.tools.shell, "normal user messages retain native tools");
  assert.equal(event.tools.update_goal, undefined);
});

test("restart restores persisted goals but excludes service downtime", async () => {
  const h = harness(); await h.create(); h.tick(5000);
  await h.runtime.close(); h.tick(60_000);
  const restored = new GoalRuntime(h.host); await restored.restore();
  const goal = await restored.get(h.session.id);
  assert.equal(goal.status, "active");
  assert.equal(goal.timeUsedMs, 0);
  assert.equal(h.admitted.size, 2);
  await restored.close();
});

test("native in-flight executions are not woken twice on plugin reload", async () => {
  const h = harness(); await h.create(); h.session.time.busy = 1000;
  await h.runtime.close(); const restored = new GoalRuntime(h.host); await restored.restore();
  assert.equal(h.admitted.size, 1);
});

test("restart only wakes confirmed-idle sessions; observation timeout is not inactivity", async () => {
  const idle = harness(); await idle.create(); idle.session.time.busy = 1000;
  idle.host.isIdle = async () => true;
  await new GoalRuntime(idle.host).restore();
  assert.equal(idle.admitted.size, 2);
  const unknown = harness(); await unknown.create();
  unknown.host.isIdle = async () => false;
  await new GoalRuntime(unknown.host).restore();
  assert.equal(unknown.admitted.size, 1);
});

test("failed GUI notifications do not invalidate durable mutations", async () => {
  const h = harness(); h.host.changed = async () => { throw new Error("GUI disconnected"); };
  await h.create(); assert.equal((await h.goal()).status, "active");
});

test("paused work is excluded from usage when resuming the same goal", async () => {
  const h = harness(); await h.create();
  h.session.tokens.input = 20;
  await h.runtime.mutate(h.session.id, "pause");
  h.session.tokens.input += 200;
  await h.runtime.mutate(h.session.id, "resume");
  h.session.tokens.input += 7;
  await h.runtime.observe({ type: "session.usage.updated", data: { sessionID: h.session.id } });
  assert.equal((await h.goal()).tokensUsed, 27);
});

test("subagent and grandchild usage is charged once from cumulative baselines", async () => {
  const h = harness();
  const child = { id: "ses_child", tokens: { input: 40 } };
  h.host.descendants = async () => [child];
  await h.create(); child.tokens.input += 15;
  const grandchild = { id: "ses_grandchild", tokens: { input: 7, reasoning: 3 } };
  h.host.descendants = async () => [child, grandchild];
  await h.runtime.observe({ type: "session.usage.updated", data: { sessionID: h.session.id } });
  await h.runtime.observe({ type: "session.usage.updated", data: { sessionID: h.session.id } });
  assert.equal((await h.goal()).tokensUsed, 25);
});

test("resuming active goals is idempotent and resumed blocked audits start fresh", async () => {
  const h = harness(); const first = await h.create();
  await h.runtime.mutate(h.session.id, "resume");
  assert.equal(h.admitted.size, 1);
  assert.equal((await h.goal()).revision, first.revision);
  await h.runtime.idle(h.session.id); await h.runtime.idle(h.session.id); await h.runtime.idle(h.session.id);
  const resumed = await h.runtime.mutate(h.session.id, "resume");
  await assert.rejects(h.runtime.report(h.session.id, { goalID: resumed.id, revision: resumed.revision, status: "blocked", evidence: "same blocker" }), /三轮/);
});

test("Plan mode does not accrue goal token usage or wall time", async () => {
  const h = harness(); await h.create(); h.session.agent = "plan"; h.session.tokens.input += 200; h.tick(60_000);
  const event = { sessionID: h.session.id, agent: "plan", system: [], tools: { shell: {}, update_goal: {} }, messages: [] };
  await h.runtime.beforeContext(event);
  await h.runtime.idle(h.session.id);
  assert.equal((await h.goal()).tokensUsed, 0);
  assert.equal((await h.goal()).timeUsedMs, 0);
  assert.equal(event.tools.update_goal, undefined);
});

test("budget reached via usage event still admits exactly one wrap-up notice", async () => {
  const h = harness(); await h.create({ tokenBudget: 10 }); h.session.tokens.input = 15;
  await h.runtime.observe({ type: "session.usage.updated", data: { sessionID: h.session.id } });
  await h.runtime.idle(h.session.id); await h.runtime.idle(h.session.id);
  assert.equal([...h.admitted.values()].filter(input => input.description === "目标预算已达到").length, 1);
});

test("late terminal events from the previous run cannot pause a resumed goal", async () => {
  const h = harness(); await h.create(); await h.runtime.mutate(h.session.id, "pause"); h.tick(100);
  await h.runtime.mutate(h.session.id, "resume");
  await h.runtime.observe({ id: "evt_late", created: 1000, type: "session.execution.interrupted", data: { sessionID: h.session.id, reason: "user" } });
  assert.equal((await h.goal()).status, "active");
});

test("provider retry cutoff applies only to an active goal", async () => {
  const h = harness(); await h.create();
  const event = { sessionID: h.session.id, attempt: 4, decision: { retry: true, delay: 1000 } };
  await h.runtime.retry(event); assert.deepEqual(event.decision, { retry: false });
  await h.runtime.mutate(h.session.id, "pause");
  event.decision = { retry: true, delay: 1000 };
  await h.runtime.retry(event); assert.equal(event.decision.retry, true);
});

test("failed admission blocks a goal instead of leaving a misleading running state", async () => {
  const h = harness(); h.host.synthetic = async () => { throw new Error("disk unavailable"); };
  await assert.rejects(h.create(), /disk unavailable/);
  const goal = await h.goal(); assert.equal(goal.status, "blocked"); assert.match(goal.reason, /disk unavailable/);
});

test("pause releases the goal lock before waiting for native hook settlement", async () => {
  const h = harness(); await h.create();
  h.host.wait = async () => h.runtime.beforeContext({ sessionID: h.session.id, agent: "build", system: [], tools: {}, messages: [] });
  await h.runtime.mutate(h.session.id, "pause");
  assert.equal((await h.goal()).status, "paused");
});

test("archived goals can be inspected and cleared, but cannot be resumed", async () => {
  const h = harness(); await h.create(); h.session.time.archived = 1;
  assert.equal((await h.goal()).status, "active");
  await assert.rejects(h.runtime.mutate(h.session.id, "resume"), /归档/);
  await h.runtime.mutate(h.session.id, "clear"); assert.equal(await h.goal(), null);
});

test("matching directory with a different workspace cannot control or resume goals", async () => {
  const h = harness(); h.session.location.workspaceID = "workspace-other";
  await assert.rejects(h.create(), /工作目录/);
  assert.equal(h.admitted.size, 0);
});

test("cannot auto-continue when the selected agent has no goal completion tools", async () => {
  const h = harness(); await h.create();
  await h.runtime.beforeContext({ sessionID: h.session.id, agent: "build", system: [], tools: { shell: {} }, messages: [] });
  assert.equal((await h.goal()).status, "blocked");
  await h.runtime.idle(h.session.id); assert.equal(h.admitted.size, 1);
});
