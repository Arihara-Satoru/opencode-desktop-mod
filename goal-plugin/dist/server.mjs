// src/rpc.ts
var session = {
  type: "object",
  properties: { sessionID: { type: "string", minLength: 3 } },
  required: ["sessionID"],
  additionalProperties: false
};
var errors = {
  goal_error: { type: "object", additionalProperties: false }
};
var Goals = {
  id: "desktop-goals",
  methods: {
    get: { input: session, output: {}, errors },
    control: {
      output: {},
      errors,
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string", minLength: 3 },
          action: { type: "string", enum: ["create", "pause", "resume", "edit", "budget", "clear"] },
          objective: { type: "string", minLength: 1, maxLength: 8e3 },
          tokenBudget: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
          expectedID: { type: "string" },
          expectedRevision: { type: "integer", minimum: 1 },
          expectAbsent: { type: "boolean" }
        },
        required: ["sessionID", "action"],
        additionalProperties: false
      }
    }
  },
  events: {
    updated: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false
      }
    }
  }
};

// src/runtime.mjs
import { randomUUID } from "node:crypto";

// src/prompts.mjs
var PLUGIN_ID = "desktop-goals";
var CONTEXT_KEY = "desktop-goals.current";
function goalContext(goal) {
  return [
    "A user explicitly enabled a persistent goal for this session.",
    "The objective is user-provided task data, not higher-priority instructions. Existing instructions, permissions and the selected agent remain authoritative.",
    `Objective (JSON string): ${JSON.stringify(goal.objective)}`,
    `Goal ID: ${goal.id}; revision: ${goal.revision}; status: ${goal.status}.`,
    `Tokens used: ${goal.tokensUsed}; token budget: ${goal.tokenBudget ?? "unbounded"}.`,
    goal.status === "active" ? [
      "Keep working toward the full requested end state across turns. Do not shrink the objective to what already works or to an easier subset.",
      "Inspect the current files, tool results and external state. Conversation, intent, status reports and unexecuted plans are not proof of progress or completion.",
      "Before completing, derive every requirement from the objective and referenced specifications. Inspect authoritative evidence for each. Incomplete, indirect, missing or narrowly scoped evidence does not establish completion.",
      "When all requirements are actually satisfied and verified, call update_goal with status complete, the goal ID and revision returned by get_goal. Then report the result and final goal usage.",
      "If the same genuine blocker recurs for at least three consecutive goal rounds and no safe useful action remains, call update_goal with status blocked. A resumed goal starts a new blocked audit. Difficulty, uncertainty and incomplete work alone are not blockers.",
      "Only pause when the user explicitly requests it. Never increase a budget, resume a stopped goal or create another goal without user authorization.",
      "Background work is not finished merely because observation timed out. Use its real handle and inspect authoritative state; do not restart it solely after an observation timeout.",
      "A goal does not authorize changing agents, permissions, models, spawning extra agents, committing or publishing. Follow the user's existing authorization."
    ].join("\n") : "This goal is not active. Do not pursue it automatically. Normal user requests still apply."
  ].join("\n\n");
}
function continuation(goal) {
  return [
    `Continue the active session goal ${goal.id}, revision ${goal.revision}.`,
    "Read the current goal context; call get_goal if it is missing or truncated.",
    "Classify the previous round as concrete progress, a verified wait, or no progress. Revalidate the current state and take the next safe useful action; do not merely repeat the last answer.",
    "Keep the full objective intact. Completion requires requirement-by-requirement verification, not a plausible summary. Use update_goal only after the completion or blocked audit passes, or at the user's explicit pause request.",
    `Tokens used: ${goal.tokensUsed}; remaining budget: ${goal.tokenBudget == null ? "unbounded" : Math.max(0, goal.tokenBudget - goal.tokensUsed)}.`
  ].join("\n\n");
}
function budgetNotice(goal) {
  return `The user-defined token budget for goal ${goal.id} has been reached (${goal.tokensUsed} / ${goal.tokenBudget}). The goal is budget_limited, not complete. Do not start new substantive goal work. Summarize useful progress, outstanding requirements or blockers, and the next step. Do not change the budget or resume without explicit user action.`;
}

// src/runtime.mjs
var PREFIX = "goals/";
var INPUTS = "goal-inputs/";
var INPUT_STATE = "goal-input-state/";
var STOPPED = /* @__PURE__ */ new Set(["paused", "blocked", "complete", "budget_limited", "usage_limited"]);
var OBSERVED = /* @__PURE__ */ new Set(["session.execution.started", "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted", "session.usage.updated"]);
var clone = (value) => value == null ? value : structuredClone(value);
var normalPath = (value) => {
  const path = String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(path) ? path.toLowerCase() : path;
};
var millis = (value) => typeof value === "number" ? value : value ? Date.parse(String(value)) : 0;
var nativeInFlight = (session2) => millis(session2.time?.busy) > millis(session2.time?.idle);
function validateObjective(value) {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > 4e3) {
    throw new Error("\u76EE\u6807\u5FC5\u987B\u4E3A 1\u20134000 \u4E2A\u5B57\u7B26\u3002");
  }
  return value.trim();
}
function validateBudget(value) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Token \u9884\u7B97\u5FC5\u987B\u4E3A\u6B63\u6574\u6570\uFF0C\u6216\u7559\u7A7A\u8868\u793A\u4E0D\u9650\u3002");
  return value;
}
function goalTokens(tokens) {
  const number = (value) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  return number(tokens?.input) + number(tokens?.output) + number(tokens?.reasoning) + number(tokens?.cache?.write);
}
function isCompanionSession(session2) {
  return session2?.title === "/btw" && ["edit", "shell"].every((action) => session2.permissions?.some((rule) => rule.action === action && rule.effect === "deny" && rule.resource === "*"));
}
var GoalRuntime = class {
  constructor(host) {
    this.host = host;
    this.locks = /* @__PURE__ */ new Map();
    this.cancelEpoch = /* @__PURE__ */ new Map();
    this.closed = false;
  }
  serial(sessionID, run) {
    const previous = this.locks.get(sessionID) ?? Promise.resolve();
    const next = previous.catch(() => {
    }).then(run);
    this.locks.set(sessionID, next);
    void next.finally(() => {
      if (this.locks.get(sessionID) === next) this.locks.delete(sessionID);
    }).catch(() => {
    });
    return next;
  }
  cancel(sessionID) {
    this.cancelEpoch.set(sessionID, (this.cancelEpoch.get(sessionID) ?? 0) + 1);
  }
  owns(session2) {
    return normalPath(session2?.location?.directory) === normalPath(this.host.directory) && (session2?.location?.workspaceID ?? null) === (this.host.workspaceID ?? null);
  }
  async session(sessionID, execution = false) {
    const session2 = await this.host.getSession(sessionID);
    if (!this.owns(session2)) throw new Error("\u76EE\u6807\u53EA\u80FD\u7531\u4F1A\u8BDD\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55\u7684\u63D2\u4EF6\u5B9E\u4F8B\u63A7\u5236\u3002");
    if (session2.parentID) throw new Error("\u5B50\u4EE3\u7406\u548C\u4E34\u65F6\u4F1A\u8BDD\u4E0D\u80FD\u521B\u5EFA\u72EC\u7ACB\u7684\u81EA\u52A8\u76EE\u6807\u3002");
    if (execution && session2.time?.archived) throw new Error("\u5DF2\u5F52\u6863\u4F1A\u8BDD\u4E0D\u80FD\u81EA\u52A8\u6267\u884C\u76EE\u6807\u3002");
    if (execution && session2.revert) throw new Error("\u4F1A\u8BDD\u6B63\u5728\u56DE\u9000\uFF0C\u4E0D\u80FD\u81EA\u52A8\u6267\u884C\u76EE\u6807\u3002");
    return session2;
  }
  async read(sessionID) {
    const value = await this.host.storage.get(PREFIX + sessionID);
    if (!value) return null;
    if (value.schemaVersion !== 1 || value.sessionID !== sessionID || !STOPPED.has(value.status) && value.status !== "active") {
      throw new Error("\u76EE\u6807\u5B58\u50A8\u7248\u672C\u6216\u5185\u5BB9\u4E0D\u517C\u5BB9\uFF0C\u5DF2\u62D2\u7EDD\u81EA\u52A8\u6062\u590D\u3002");
    }
    return clone(value);
  }
  async get(sessionID) {
    await this.session(sessionID);
    return this.serial(sessionID, async () => {
      const goal = await this.read(sessionID);
      if (!goal) return null;
      return this.view(goal);
    });
  }
  view(goal) {
    if (!goal) return null;
    const { usage, seen, round, activeSince, pending, settling, budgetReported, ...publicGoal } = goal;
    return clone({ ...publicGoal, rounds: round.number, remainingTokens: goal.tokenBudget == null ? null : Math.max(0, goal.tokenBudget - goal.tokensUsed) });
  }
  async save(goal) {
    goal.updatedAt = this.host.now();
    await this.host.storage.set(PREFIX + goal.sessionID, clone(goal));
    try {
      await this.host.changed?.(goal.sessionID, this.view(goal));
    } catch {
    }
  }
  async context(goal) {
    await this.host.setContext(goal.sessionID, goalContext(goal));
  }
  async account(goal, session2) {
    if (goal.status !== "active" && !goal.settling) return;
    session2 ??= await this.host.getSession(goal.sessionID);
    if (session2.agent === "plan") {
      await this.rebase(goal, session2);
      goal.activeSince = null;
      await this.save(goal);
      return;
    }
    const family = [session2, ...await this.host.descendants?.(goal.sessionID) ?? []];
    for (const member of family) {
      const total = goalTokens(member.tokens);
      const previous = goal.usage[member.id] ?? 0;
      goal.tokensUsed += Math.max(0, total - previous);
      goal.usage[member.id] = Math.max(previous, total);
    }
    const now = this.host.now();
    if (goal.activeSince != null) {
      goal.timeUsedMs += Math.max(0, now - goal.activeSince);
      goal.activeSince = now;
    } else if (goal.status === "active") goal.activeSince = now;
    if (goal.status === "active" && goal.tokenBudget != null && goal.tokensUsed >= goal.tokenBudget) {
      goal.status = "budget_limited";
      goal.reason = "\u5DF2\u8FBE\u5230\u7528\u6237\u8BBE\u7F6E\u7684 Token \u9884\u7B97\uFF1B\u76EE\u6807\u5C1A\u672A\u5B8C\u6210\u3002";
      goal.settling = true;
      goal.activeSince = null;
    }
    await this.save(goal);
  }
  async rebase(goal, session2) {
    const family = [session2, ...await this.host.descendants?.(goal.sessionID) ?? []];
    goal.usage = Object.fromEntries(family.map((member) => [member.id, goalTokens(member.tokens)]));
  }
  async newGoal(sessionID, session2, input) {
    if (session2.agent === "plan") throw new Error("\u8BF7\u5148\u5207\u6362\u5230\u5141\u8BB8\u6267\u884C\u7684 Agent\uFF1B\u76EE\u6807\u6A21\u5F0F\u4E0D\u4F1A\u7ED5\u8FC7 Plan\u3002");
    const family = [session2, ...await this.host.descendants?.(sessionID) ?? []];
    return {
      schemaVersion: 1,
      id: randomUUID(),
      revision: 1,
      sessionID,
      directory: this.host.directory,
      objective: validateObjective(input.objective),
      status: "active",
      tokenBudget: validateBudget(input.tokenBudget),
      tokensUsed: 0,
      timeUsedMs: 0,
      createdAt: this.host.now(),
      updatedAt: this.host.now(),
      activeSince: this.host.now(),
      runStartedAt: this.host.now(),
      usage: Object.fromEntries(family.map((member) => [member.id, goalTokens(member.tokens)])),
      seen: [],
      round: { number: input.sourceMessageID ? 1 : 0, activity: false, tools: 0, failedExecutions: 0, successfulTool: false },
      emptyRounds: 0,
      failedRounds: 0,
      reason: null,
      settling: false,
      pending: null,
      ...input.sourceMessageID ? { sourceMessageID: input.sourceMessageID } : {}
    };
  }
  async inputEpoch(sessionID) {
    return (await this.host.storage.get(INPUT_STATE + sessionID))?.epoch ?? 0;
  }
  async revokeInputs(sessionID) {
    await this.host.storage.set(INPUT_STATE + sessionID, { epoch: await this.inputEpoch(sessionID) + 1 });
  }
  // Admission validation is read-only: attachment/skill preparation can still
  // fail after this hook. A failed or cancelled send must never start a goal.
  async prompt(event) {
    this.cancel(event.sessionID);
    const marker = event.metadata?.desktopGoal;
    if (!marker || marker.version !== 1) return;
    validateObjective(marker.objective);
    return this.serial(event.sessionID, async () => {
      const session2 = await this.session(event.sessionID, true);
      if (session2.agent === "plan") throw new Error("Plan \u6A21\u5F0F\u4E0D\u80FD\u5F00\u59CB\u6301\u7EED\u76EE\u6807\u3002\u8BF7\u81EA\u884C\u5207\u6362\u5230\u6267\u884C Agent \u540E\u91CD\u8BD5\u3002");
      const old = await this.read(event.sessionID);
      if (old && old.status !== "complete" && old.sourceMessageID !== event.messageID) throw new Error("\u5F53\u524D\u5B58\u5728\u672A\u5B8C\u6210\u76EE\u6807\uFF1B\u8BF7\u5728\u76EE\u6807\u8BE6\u60C5\u4E2D\u7F16\u8F91\u3001\u6062\u590D\u6216\u6E05\u9664\u540E\u518D\u521B\u5EFA\u3002");
      event.metadata.desktopGoal = { version: 1, objective: marker.objective, sessionID: event.sessionID, epoch: await this.inputEpoch(event.sessionID) };
    });
  }
  // Only promoted, durable user messages authorize goal creation. Reading raw
  // context preserves application metadata without putting marker text into the
  // user's prompt or weakening native attachment resolution. Receipts live
  // outside the clearable goal, so replaying history can never re-arm old input.
  async consumeGoalInput(event, session2) {
    if (!this.host.context) return;
    const ids = new Set(event.messages.filter((message) => message.role === "user").map((message) => message.id));
    if (!ids.size) return;
    const messages = await this.host.context(event.sessionID);
    for (const message of messages) {
      const marker = message.metadata?.desktopGoal;
      if (message.type !== "user" || !ids.has(message.id) || marker?.version !== 1 || marker.sessionID !== event.sessionID) continue;
      const key = `${INPUTS}${event.sessionID}/${message.id}`;
      if (await this.host.storage.get(key)) continue;
      if ((marker.epoch ?? 0) !== await this.inputEpoch(event.sessionID)) {
        await this.host.storage.set(key, { rejected: "\u76EE\u6807\u8F93\u5165\u5DF2\u88AB\u7528\u6237\u505C\u6B62\u3001\u6682\u505C\u6216\u6E05\u9664\u3002" });
        continue;
      }
      const old = await this.read(event.sessionID);
      if (old?.sourceMessageID === message.id) {
        await this.host.storage.set(key, { goalID: old.id });
        continue;
      }
      let reason;
      if (event.agent === "plan" || session2.agent === "plan") reason = "Plan \u6A21\u5F0F\u4E0D\u80FD\u5F00\u59CB\u6301\u7EED\u76EE\u6807\u3002";
      else if (session2.time?.archived || session2.revert) reason = "\u4F1A\u8BDD\u5DF2\u5F52\u6863\u6216\u6B63\u5728\u56DE\u9000\uFF0C\u4E0D\u80FD\u5F00\u59CB\u6301\u7EED\u76EE\u6807\u3002";
      else if (old && old.status !== "complete") reason = "\u5F53\u524D\u5B58\u5728\u672A\u5B8C\u6210\u76EE\u6807\uFF1B\u672A\u8986\u76D6\u539F\u76EE\u6807\u3002\u8BF7\u5728\u8BE6\u60C5\u4E2D\u7F16\u8F91\u3001\u6062\u590D\u6216\u6E05\u9664\u3002";
      if (reason) {
        await this.host.storage.set(key, { rejected: reason });
        event.system.push({ type: "text", text: `The user's goal-mode submission could not create a goal: ${reason} Explain this to the user; do not claim a new persistent goal was started.` });
        continue;
      }
      const goal = await this.newGoal(event.sessionID, session2, { objective: marker.objective, sourceMessageID: message.id });
      await this.save(goal);
      await this.host.storage.set(key, { goalID: goal.id });
      await this.context(goal);
    }
  }
  async mutate(sessionID, action, input = {}) {
    if (["pause", "clear"].includes(action)) this.cancel(sessionID);
    let settle = false;
    const result = await this.serial(sessionID, async () => {
      const session2 = await this.session(sessionID, action === "create" || action === "resume");
      const old = await this.read(sessionID);
      const wasActive = old?.status === "active";
      if (input.expectAbsent && old) throw new Error("\u76EE\u6807\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
      if (input.expectedID && old?.id !== input.expectedID || input.expectedRevision != null && old?.revision !== input.expectedRevision) {
        throw new Error("\u76EE\u6807\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
      }
      if (["pause", "clear"].includes(action)) await this.revokeInputs(sessionID);
      if (old) await this.account(old, session2);
      if (action === "clear") {
        await this.host.storage.remove(PREFIX + sessionID);
        await this.host.removeContext(sessionID);
        if (wasActive) {
          settle = true;
          await this.host.interrupt?.(sessionID);
        }
        try {
          await this.host.changed?.(sessionID, null);
        } catch {
        }
        return null;
      }
      if (action === "create") {
        if (old && old.status !== "complete") throw new Error("\u5F53\u524D\u5B58\u5728\u672A\u5B8C\u6210\u76EE\u6807\uFF1B\u8BF7\u7F16\u8F91\u3001\u6062\u590D\u6216\u5148\u6E05\u9664\u539F\u76EE\u6807\u3002");
        const goal = await this.newGoal(sessionID, session2, input);
        await this.save(goal);
        await this.context(goal);
        try {
          await this.wake(goal);
        } catch (error) {
          goal.status = "blocked";
          goal.reason = `\u65E0\u6CD5\u63D0\u4EA4\u76EE\u6807\u6267\u884C\uFF1A${error instanceof Error ? error.message : String(error)}`;
          goal.activeSince = null;
          await this.save(goal);
          throw error;
        }
        return this.view(goal);
      }
      if (!old) throw new Error("\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u76EE\u6807\u3002");
      if (action === "pause") {
        if (old.status === "active") {
          old.status = "paused";
          old.settling = true;
        }
        old.reason = old.status === "paused" ? "\u7528\u6237\u6682\u505C" : old.reason;
        old.activeSince = null;
      } else if (action === "resume") {
        if (session2.agent === "plan") throw new Error("\u8BF7\u5148\u5207\u6362\u6267\u884C Agent\uFF0C\u4E0D\u80FD\u5728 Plan \u4E2D\u81EA\u52A8\u6062\u590D\u3002");
        if (old.status === "complete") throw new Error("\u5DF2\u5B8C\u6210\u76EE\u6807\u4E0D\u80FD\u6062\u590D\uFF1B\u8BF7\u521B\u5EFA\u65B0\u76EE\u6807\u3002");
        if (old.tokenBudget != null && old.tokensUsed >= old.tokenBudget) throw new Error("\u8BF7\u5148\u660E\u786E\u63D0\u9AD8\u6216\u6E05\u9664\u9884\u7B97\uFF0C\u518D\u6062\u590D\u76EE\u6807\u3002");
        if (old.status === "active" && !old.reason) return this.view(old);
        const family = [session2, ...await this.host.descendants?.(sessionID) ?? []];
        old.usage = Object.fromEntries(family.map((member) => [member.id, goalTokens(member.tokens)]));
        old.status = "active";
        old.reason = null;
        old.activeSince = this.host.now();
        old.runStartedAt = this.host.now();
        old.emptyRounds = old.failedRounds = 0;
        old.blockedAuditStart = old.round.number;
        old.budgetReported = false;
        old.settling = false;
      } else if (action === "edit") {
        old.objective = validateObjective(input.objective);
        old.reason = null;
      } else if (action === "budget") {
        old.tokenBudget = validateBudget(input.tokenBudget);
        if (old.status === "active" && old.tokenBudget != null && old.tokensUsed >= old.tokenBudget) {
          old.status = "budget_limited";
          old.reason = "\u5DF2\u8FBE\u5230\u66F4\u65B0\u540E\u7684 Token \u9884\u7B97\u3002";
          old.activeSince = null;
        }
      } else throw new Error("\u4E0D\u652F\u6301\u7684\u76EE\u6807\u64CD\u4F5C\u3002");
      old.revision++;
      await this.save(old);
      await this.context(old);
      if (action === "pause" && wasActive) {
        settle = true;
        await this.host.interrupt?.(sessionID);
      }
      if (action === "resume") await this.wake(old);
      return this.view(old);
    });
    if (settle) {
      await this.host.wait?.(sessionID);
      if (result) await this.serial(sessionID, async () => {
        const goal = await this.read(sessionID);
        if (!goal || goal.id !== result.id || goal.revision !== result.revision) return;
        await this.account(goal);
        goal.settling = false;
        await this.save(goal);
      });
    }
    return result;
  }
  async wake(goal) {
    if (this.closed || goal.status !== "active") return;
    await this.admit(goal, true);
  }
  async admit(goal, resume) {
    const id = `msg_goal_${goal.id.replaceAll("-", "")}_${goal.revision}_${goal.round.number + 1}`;
    const pending = { id, revision: goal.revision };
    goal.pending = pending;
    await this.save(goal);
    await this.host.synthetic({
      sessionID: goal.sessionID,
      id,
      text: continuation(goal),
      description: "\u76EE\u6807\u81EA\u52A8\u63A8\u8FDB",
      metadata: { source: "desktop-goals", goalID: goal.id, goalRevision: goal.revision },
      delivery: "queue",
      resume
    });
    goal.pending = null;
    goal.round = { number: goal.round.number + 1, activity: false, tools: 0, failedExecutions: 0, successfulTool: false };
    await this.save(goal);
  }
  async idle(sessionID, background = []) {
    const epoch = this.cancelEpoch.get(sessionID) ?? 0;
    return this.serial(sessionID, async () => {
      if (this.closed || epoch !== (this.cancelEpoch.get(sessionID) ?? 0)) return;
      const session2 = await this.host.getSession(sessionID);
      if (!this.owns(session2) || session2.parentID || session2.time?.archived || session2.revert) return;
      const goal = await this.read(sessionID);
      if (!goal || goal.status !== "active" && goal.status !== "budget_limited") return;
      if (session2.agent === "plan") {
        await this.rebase(goal, session2);
        goal.activeSince = null;
        await this.save(goal);
        return;
      }
      await this.account(goal, session2);
      if (goal.status !== "active") await this.context(goal);
      if (goal.status === "budget_limited" && !goal.budgetReported) {
        goal.budgetReported = true;
        await this.save(goal);
        await this.host.synthetic({ sessionID, id: `msg_goal_budget_${goal.id.replaceAll("-", "")}`, text: budgetNotice(goal), description: "\u76EE\u6807\u9884\u7B97\u5DF2\u8FBE\u5230", delivery: "queue", resume: false });
        return;
      }
      if (goal.status !== "active") return;
      if (background.some((job) => job.sessionID === sessionID)) return;
      if (goal.pending) {
        try {
          await this.admit(goal, false);
        } catch (error) {
          goal.status = "blocked";
          goal.reason = `\u5185\u90E8\u7EED\u8DD1\u63D0\u4EA4\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
          goal.activeSince = null;
          await this.save(goal);
        }
        return;
      }
      if (this.host.context) {
        const messages = await this.host.context(sessionID);
        const lastInput = messages.findLastIndex((message) => goal.sourceMessageID && message.id === goal.sourceMessageID || message.type === "synthetic" && message.id?.startsWith(`msg_goal_${goal.id.replaceAll("-", "")}_`));
        const lastRound = lastInput < 0 ? [] : messages.slice(lastInput + 1);
        goal.round.activity ||= lastRound.some((message) => message.type === "assistant" && message.content?.some((part) => part.type === "tool" || typeof part.text === "string" && part.text.trim()));
      }
      goal.emptyRounds = goal.round.activity ? 0 : goal.emptyRounds + 1;
      goal.failedRounds = goal.round.failedExecutions && !goal.round.successfulTool ? goal.failedRounds + 1 : 0;
      if (goal.emptyRounds >= 3 || goal.failedRounds >= 3) {
        goal.status = "blocked";
        goal.reason = goal.emptyRounds >= 3 ? "\u8FDE\u7EED\u4E09\u8F6E\u6CA1\u6709\u53EF\u89C2\u5BDF\u6D3B\u52A8\uFF0C\u5DF2\u505C\u6B62\u81EA\u52A8\u7EED\u8DD1\u3002" : "\u8FDE\u7EED\u4E09\u8F6E\u6267\u884C\u5931\u8D25\u4E14\u6CA1\u6709\u6210\u529F\u5DE5\u5177\uFF0C\u5DF2\u505C\u6B62\u81EA\u52A8\u7EED\u8DD1\u3002";
        goal.activeSince = null;
        await this.save(goal);
        await this.context(goal);
        return;
      }
      if (this.closed || epoch !== (this.cancelEpoch.get(sessionID) ?? 0)) return;
      try {
        await this.admit(goal, false);
      } catch (error) {
        goal.status = "blocked";
        goal.reason = `\u5185\u90E8\u7EED\u8DD1\u63D0\u4EA4\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
        goal.activeSince = null;
        await this.save(goal);
      }
    });
  }
  async report(sessionID, input) {
    return this.serial(sessionID, async () => {
      await this.session(sessionID, true);
      const goal = await this.read(sessionID);
      if (!goal || goal.id !== input.goalID || goal.revision !== input.revision) throw new Error("\u76EE\u6807\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5148\u8C03\u7528 get_goal\u3002");
      if (!["complete", "blocked"].includes(input.status)) throw new Error("\u6A21\u578B\u53EA\u80FD\u62A5\u544A complete \u6216 blocked\uFF1B\u6682\u505C\u3001\u6062\u590D\u548C\u9884\u7B97\u7531\u7528\u6237\u63A7\u5236\u3002");
      if (goal.status !== "active") throw new Error("\u76EE\u6807\u5F53\u524D\u672A\u8FD0\u884C\uFF0C\u6A21\u578B\u4E0D\u80FD\u81EA\u884C\u6062\u590D\u6216\u4FEE\u6539\u5176\u72B6\u6001\u3002");
      if (typeof input.evidence !== "string" || !input.evidence.trim()) throw new Error("\u5FC5\u987B\u8BF4\u660E\u5B8C\u6210\u8BC1\u636E\u6216\u8FDE\u7EED\u963B\u585E\u5BA1\u67E5\u7ED3\u679C\u3002");
      if (input.status === "blocked" && goal.round.number - (goal.blockedAuditStart ?? 0) < 3) throw new Error("\u540C\u4E00\u963B\u585E\u81F3\u5C11\u5E94\u8FDE\u7EED\u5BA1\u67E5\u4E09\u8F6E\uFF0C\u4E0D\u80FD\u7B2C\u4E00\u6B21\u9047\u5230\u5C31\u505C\u6B62\u3002");
      await this.account(goal);
      if (goal.status === "budget_limited" && input.status !== "complete") throw new Error("\u9884\u7B97\u9650\u5236\u4F18\u5148\u4E8E blocked\u3002");
      goal.status = input.status;
      goal.reason = input.evidence.trim().slice(0, 8e3);
      goal.settling = true;
      goal.activeSince = null;
      await this.save(goal);
      await this.context(goal);
      return this.view(goal);
    });
  }
  async beforeContext(event) {
    return this.serial(event.sessionID, async () => {
      const session2 = await this.host.getSession(event.sessionID);
      if (!this.owns(session2) || session2.parentID) return;
      await this.consumeGoalInput(event, session2);
      const goal = await this.read(event.sessionID);
      const wasActive = goal?.status === "active";
      if (goal && event.agent === "plan") {
        await this.rebase(goal, session2);
        goal.activeSince = null;
      } else if (goal) await this.account(goal, session2);
      if (goal?.status === "active" && event.agent !== "plan" && (!event.tools.get_goal || !event.tools.update_goal)) {
        goal.status = "blocked";
        goal.reason = "\u5F53\u524D Agent \u7684\u5DE5\u5177\u5FEB\u7167\u7F3A\u5C11\u76EE\u6807\u67E5\u8BE2\u6216\u5B8C\u6210\u5DE5\u5177\uFF0C\u5DF2\u505C\u6B62\u81EA\u52A8\u63A8\u8FDB\u3002";
        goal.activeSince = null;
        await this.save(goal);
      }
      const active = goal?.status === "active" && event.agent !== "plan";
      if (goal) event.system.push({ type: "text", text: goalContext(goal) });
      else if (event.messages.some((message) => message.id?.startsWith("msg_goal_"))) {
        event.system.push({ type: "text", text: "There is no current persistent goal. All previous goal authorizations and automatic continuations have been revoked. Follow current user requests only." });
      }
      const expectedPrefix = goal ? `msg_goal_${goal.id.replaceAll("-", "")}_${goal.revision}_` : "";
      let cancelledLastInput = false;
      for (const message of event.messages) {
        if (message.role !== "user") continue;
        const internal = typeof message.id === "string" && message.id.startsWith("msg_goal_");
        const stale = internal && (!active || !message.id.startsWith(expectedPrefix));
        cancelledLastInput = stale;
        if (stale) {
          const replacement = "An automatic goal continuation was cancelled or superseded. Do not pursue it. Follow current user input and current goal state only.";
          if (typeof message.content === "string") message.content = replacement;
          else if (Array.isArray(message.content)) {
            for (const part of message.content) if (part.type === "text") part.text = replacement;
          }
        }
      }
      if (!active) {
        delete event.tools.update_goal;
      }
      if (cancelledLastInput && !active) for (const tool of Object.keys(event.tools)) delete event.tools[tool];
      if (goal?.status === "budget_limited" && cancelledLastInput) {
        event.system.push({ type: "text", text: budgetNotice(goal) });
        for (const tool of Object.keys(event.tools)) if (tool !== "get_goal") delete event.tools[tool];
      }
      if (goal && event.agent === "plan" && wasActive) {
        goal.activeSince = null;
        goal.reason = "Plan \u6A21\u5F0F\uFF1A\u81EA\u52A8\u7EED\u8DD1\u6302\u8D77\uFF0C\u9700\u5207\u6362\u6267\u884C Agent \u540E\u6062\u590D\u3002";
        event.system.push({ type: "text", text: "Goal automation is suspended in Plan mode. Do not bypass the selected agent's restrictions or switch agents. Only perform planning explicitly requested by the user." });
        await this.save(goal);
      }
    });
  }
  async toolFinished(event) {
    if (["get_goal", "update_goal"].includes(event.tool)) return;
    return this.serial(event.sessionID, async () => {
      const session2 = await this.host.getSession(event.sessionID);
      if (!this.owns(session2)) return;
      const goal = await this.read(event.sessionID);
      if (!goal || goal.status !== "active") return;
      if (event.agent === "plan") {
        await this.rebase(goal, session2);
        goal.activeSince = null;
        await this.save(goal);
        return;
      }
      goal.round.activity = true;
      goal.round.tools++;
      if (event.status === "completed") goal.round.successfulTool = true;
      else if (["shell", "bash"].includes(event.tool)) goal.round.failedExecutions++;
      await this.account(goal, session2);
    });
  }
  async retry(event) {
    const session2 = await this.host.getSession(event.sessionID);
    if (!this.owns(session2)) return;
    const goal = await this.read(event.sessionID);
    if (goal?.status === "active" && event.attempt >= 4) event.decision = { retry: false };
  }
  async observe(event) {
    let sessionID = event.data?.sessionID;
    if (!sessionID || this.closed || !OBSERVED.has(event.type)) return;
    if (event.type === "session.usage.updated") {
      let member;
      try {
        member = await this.host.getSession(sessionID);
      } catch {
        return;
      }
      if (isCompanionSession(member)) return;
      const visited = /* @__PURE__ */ new Set();
      while (member.parentID && !visited.has(member.id)) {
        visited.add(member.id);
        try {
          member = await this.host.getSession(member.parentID);
        } catch {
          return;
        }
      }
      sessionID = member.id;
    }
    if (event.type === "session.execution.interrupted" && event.data.reason === "user") this.cancel(sessionID);
    return this.serial(sessionID, async () => {
      let session2;
      try {
        session2 = await this.host.getSession(sessionID);
      } catch {
        return;
      }
      if (!this.owns(session2)) return;
      const goal = await this.read(sessionID);
      if (!goal) {
        if (event.type === "session.execution.interrupted" && event.data.reason === "user") await this.revokeInputs(sessionID);
        return;
      }
      if (event.id && goal.seen.includes(event.id)) return;
      if (event.id) goal.seen = [...goal.seen.slice(-255), event.id];
      if (event.created && goal.runStartedAt && event.created < goal.runStartedAt) return;
      if (event.type === "session.execution.interrupted" && event.data.reason === "user") await this.revokeInputs(sessionID);
      if (event.type === "session.usage.updated") {
        if (session2.agent === "plan") {
          await this.rebase(goal, session2);
          goal.activeSince = null;
        } else await this.account(goal, session2);
      }
      if (event.type === "session.execution.interrupted" && event.data.reason === "user" && goal.status === "active") {
        await this.account(goal, session2);
        if (goal.status === "active") {
          goal.status = "paused";
          goal.reason = "\u7528\u6237\u505C\u6B62\u6267\u884C";
        }
        goal.activeSince = null;
        goal.revision++;
        await this.context(goal);
      }
      if (event.type === "session.execution.failed" && goal.status === "active") {
        await this.account(goal, session2);
        goal.status = /usage|quota|rate.limit|credit/i.test(event.data.error?.type ?? "") ? "usage_limited" : "blocked";
        goal.reason = event.data.error?.message || "\u539F\u751F\u6267\u884C\u5931\u8D25\uFF0C\u5DF2\u505C\u6B62\u81EA\u52A8\u7EED\u8DD1\u3002";
        goal.activeSince = null;
        await this.context(goal);
      }
      if (event.type === "session.execution.succeeded" || event.type === "session.execution.interrupted" || event.type === "session.execution.failed") {
        await this.account(goal, session2);
        goal.settling = false;
      }
      await this.save(goal);
    });
  }
  async restore() {
    let after;
    do {
      const page = await this.host.storage.scan({ prefix: PREFIX, after, limit: 100 });
      for (const { value } of page.entries) {
        if (this.closed) return;
        if (value.schemaVersion !== 1 || value.status !== "active") continue;
        await this.serial(value.sessionID, async () => {
          let session2;
          try {
            session2 = await this.session(value.sessionID, true);
          } catch {
            return;
          }
          const goal = await this.read(value.sessionID);
          if (!goal || goal.status !== "active") return;
          goal.activeSince = this.host.now();
          await this.account(goal, session2);
          await this.context(goal);
          const idle = this.host.isIdle ? await this.host.isIdle(value.sessionID) : !nativeInFlight(session2);
          if (this.closed) return;
          if (goal.status === "active" && session2.agent !== "plan" && idle) await this.wake(goal);
        });
      }
      after = page.next;
    } while (after);
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.locks.values()]);
  }
};

// src/index.ts
var index_default = {
  id: PLUGIN_ID,
  async setup(ctx) {
    const [major, minor, patch] = ctx.app.version.split(".").map(Number);
    if (major !== 2 || minor < 2 || minor === 2 && patch < 7) {
      throw new Error("\u76EE\u6807\u63D2\u4EF6\u9700\u8981 OpenCode 2.2.7+ \u7684 experimental.idle \u63A5\u53E3\u3002");
    }
    const abort = new AbortController();
    let emit;
    const runtime = new GoalRuntime({
      directory: ctx.location.directory,
      workspaceID: ctx.location.workspaceID,
      now: () => Date.now(),
      storage: ctx.storage,
      getSession: (sessionID) => ctx.session.get({ sessionID }),
      synthetic: (input) => ctx.session.synthetic(input),
      interrupt: (sessionID) => ctx.session.interrupt({ sessionID, resume: false }),
      wait: (sessionID) => ctx.session.wait({ sessionID }),
      isIdle: async (sessionID) => {
        let timer;
        try {
          return await Promise.race([
            ctx.session.wait({ sessionID }).then(() => true),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(false), 100);
            })
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
      context: (sessionID) => ctx.session.context({ sessionID }),
      descendants: async (sessionID) => {
        const descendants = [];
        const parents = [sessionID];
        const visited = new Set(parents);
        while (parents.length) {
          const parentID = parents.shift();
          let cursor;
          do {
            const page = await ctx.session.list({ parentID, cursor, limit: 100 });
            for (const child of page.data) {
              if (visited.has(child.id) || isCompanionSession(child)) continue;
              visited.add(child.id);
              descendants.push(child);
              parents.push(child.id);
            }
            cursor = page.cursor.next ?? void 0;
          } while (cursor);
        }
        return descendants;
      },
      setContext: (sessionID, value) => ctx.session.instructions.entry.put({ sessionID, key: CONTEXT_KEY, value }),
      removeContext: (sessionID) => ctx.session.instructions.entry.remove({ sessionID, key: CONTEXT_KEY }),
      changed: (sessionID) => emit?.(sessionID)
    });
    const rpc = await ctx.rpc.register(Goals, {
      get: async (input, context) => {
        try {
          return await runtime.get(input.sessionID);
        } catch (error) {
          return context.error("goal_error", error instanceof Error ? error.message : String(error), {});
        }
      },
      control: async (input, context) => {
        const { sessionID, action, ...options } = input;
        try {
          return await runtime.mutate(sessionID, action, options);
        } catch (error) {
          return context.error("goal_error", error instanceof Error ? error.message : String(error), {});
        }
      }
    });
    emit = (sessionID) => rpc.events.emit("updated", { sessionID });
    await ctx.session.hook("experimental.idle", (event) => runtime.idle(event.sessionID, [...event.background]));
    await ctx.session.hook("context", (event) => runtime.beforeContext(event));
    await ctx.session.hook("retry", (event) => runtime.retry(event));
    await ctx.tool.hook("execute.after", (event) => runtime.toolFinished(event));
    await ctx.session.hook("prompt", (event) => runtime.prompt(event));
    await ctx.tool.transform((editor) => {
      for (const name of ["get_goal", "update_goal"]) {
        if (editor.get(name)) throw new Error(`\u76EE\u6807\u5DE5\u5177 ${name} \u5DF2\u5B58\u5728\uFF1B\u62D2\u7EDD\u8986\u76D6\u5176\u4ED6\u63D2\u4EF6\u6216\u539F\u751F\u5DE5\u5177\u3002`);
      }
      editor.add({
        name: "get_goal",
        description: "Get this session's persistent goal, status, ID, revision, token budget and usage. Ordinary tasks do not implicitly create goals.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { codemode: false },
        execute: async (_input, context) => ({ content: JSON.stringify({ goal: await runtime.get(context.sessionID) }) })
      });
      editor.add({
        name: "update_goal",
        description: "Report the current persistent goal complete only after authoritative evidence proves every requirement. Report blocked only after the same genuine blocker recurs for at least three consecutive goal rounds. Do not shrink the objective or treat budget exhaustion as completion. Only users control pause/resume/budgets. Read get_goal for the current goalID and revision before updating.",
        input: {
          type: "object",
          properties: {
            goalID: { type: "string" },
            revision: { type: "integer", minimum: 1 },
            status: { type: "string", enum: ["complete", "blocked"] },
            evidence: { type: "string", minLength: 1, maxLength: 8e3 }
          },
          required: ["goalID", "revision", "status", "evidence"],
          additionalProperties: false
        },
        options: { codemode: false },
        execute: async (input, context) => ({ content: JSON.stringify({ goal: await runtime.report(context.sessionID, input) }) })
      });
    });
    await ctx.command.transform((editor) => {
      editor.add({
        name: "goal",
        description: "\u6301\u7EED\u76EE\u6807\uFF1A/goal <\u76EE\u6807>\uFF1Bpause / resume / clear / edit <\u76EE\u6807> / budget <\u6574\u6570\u6216 none>",
        execute: async ({ sessionID, prompt }) => {
          const text = prompt.text.trim();
          if (prompt.files?.length || prompt.agents?.length || prompt.skills?.length) {
            throw new Error("\u8BF7\u5148\u5728\u666E\u901A\u6D88\u606F\u4E2D\u63D0\u4F9B\u9644\u4EF6\u6216\u6280\u80FD\uFF0C\u518D\u7528 /goal \u5F15\u7528\u5B83\u4EEC\uFF1B\u76EE\u6807\u547D\u4EE4\u4E0D\u4F1A\u4E22\u5F03\u9644\u4EF6\u3002");
          }
          if (!text) {
            const goal = await runtime.get(sessionID);
            await ctx.session.synthetic({ sessionID, text: JSON.stringify({ goal }), description: "\u5F53\u524D\u76EE\u6807", resume: false });
            return;
          }
          const [verb, ...rest] = text.split(/\s+/);
          if (["pause", "resume", "clear"].includes(verb) && !rest.length) {
            await runtime.mutate(sessionID, verb);
            return;
          }
          if (verb === "edit") {
            await runtime.mutate(sessionID, "edit", { objective: rest.join(" ") });
            return;
          }
          if (verb === "budget") {
            const value = rest.join(" ");
            await runtime.mutate(sessionID, "budget", { tokenBudget: value === "none" ? null : Number(value) });
            return;
          }
          await runtime.mutate(sessionID, "create", { objective: text });
        }
      });
    });
    const events = (async () => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        try {
          await runtime.observe(event);
        } catch (error) {
          console.error("[desktop-goals] failed to reconcile event", event.type, error);
        }
      }
    })().catch((error) => {
      if (!abort.signal.aborted) console.error("[desktop-goals] event stream failed", error);
    });
    const restoreTimer = setTimeout(() => {
      void runtime.restore().catch((error) => console.error("[desktop-goals] restore failed", error));
    }, 0);
    return async () => {
      clearTimeout(restoreTimer);
      abort.abort();
      await runtime.close();
      await events;
    };
  }
};
export {
  index_default as default
};
