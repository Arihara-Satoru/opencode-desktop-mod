import { randomUUID } from "node:crypto";
import { budgetNotice, continuation, goalContext } from "./prompts.mjs";

const PREFIX = "goals/";
const INPUTS = "goal-inputs/";
const INPUT_STATE = "goal-input-state/";
const STOPPED = new Set(["paused", "blocked", "complete", "budget_limited", "usage_limited"]);
const OBSERVED = new Set(["session.execution.started", "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted", "session.usage.updated"]);
const clone = value => value == null ? value : structuredClone(value);
const normalPath = value => {
  const path = String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(path) ? path.toLowerCase() : path;
};
const millis = value => typeof value === "number" ? value : value ? Date.parse(String(value)) : 0;
const nativeInFlight = session => millis(session.time?.busy) > millis(session.time?.idle);

export function validateObjective(value) {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > 4000) {
    throw new Error("目标必须为 1–4000 个字符。");
  }
  return value.trim();
}

export function validateBudget(value) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Token 预算必须为正整数，或留空表示不限。");
  return value;
}

// OpenCode 2.2.7 input/output/reasoning/cache fields are disjoint, unlike Codex's
// inclusive input/output fields. Cache reads are excluded; cache writes are real
// uncached input, reasoning is real output. Never subtract cache.read from input.
export function goalTokens(tokens) {
  const number = value => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  return number(tokens?.input) + number(tokens?.output) + number(tokens?.reasoning) + number(tokens?.cache?.write);
}

export function isCompanionSession(session) {
  return session?.title === "/btw" && ["edit", "shell"].every(action => session.permissions?.some(rule => rule.action === action && rule.effect === "deny" && rule.resource === "*"));
}

export class GoalRuntime {
  constructor(host) {
    this.host = host;
    this.locks = new Map();
    this.cancelEpoch = new Map();
    this.closed = false;
  }

  serial(sessionID, run) {
    const previous = this.locks.get(sessionID) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(run);
    this.locks.set(sessionID, next);
    void next.finally(() => { if (this.locks.get(sessionID) === next) this.locks.delete(sessionID); }).catch(() => {});
    return next;
  }

  cancel(sessionID) {
    this.cancelEpoch.set(sessionID, (this.cancelEpoch.get(sessionID) ?? 0) + 1);
  }

  owns(session) {
    return normalPath(session?.location?.directory) === normalPath(this.host.directory)
      && (session?.location?.workspaceID ?? null) === (this.host.workspaceID ?? null);
  }

  async session(sessionID, execution = false) {
    const session = await this.host.getSession(sessionID);
    if (!this.owns(session)) throw new Error("目标只能由会话当前工作目录的插件实例控制。");
    if (session.parentID) throw new Error("子代理和临时会话不能创建独立的自动目标。");
    if (execution && session.time?.archived) throw new Error("已归档会话不能自动执行目标。");
    if (execution && session.revert) throw new Error("会话正在回退，不能自动执行目标。");
    return session;
  }

  async read(sessionID) {
    const value = await this.host.storage.get(PREFIX + sessionID);
    if (!value) return null;
    if (value.schemaVersion !== 1 || value.sessionID !== sessionID || !STOPPED.has(value.status) && value.status !== "active") {
      throw new Error("目标存储版本或内容不兼容，已拒绝自动恢复。");
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
    // Notifications are live-only, not the durable commit. A disconnected GUI
    // must not turn a successful state change into a failed admission.
    try { await this.host.changed?.(goal.sessionID, this.view(goal)); } catch {}
  }

  async context(goal) {
    await this.host.setContext(goal.sessionID, goalContext(goal));
  }

  async account(goal, session) {
    if (goal.status !== "active" && !goal.settling) return;
    session ??= await this.host.getSession(goal.sessionID);
    if (session.agent === "plan") {
      await this.rebase(goal, session);
      goal.activeSince = null;
      await this.save(goal);
      return;
    }
    const family = [session, ...await this.host.descendants?.(goal.sessionID) ?? []];
    for (const member of family) {
      const total = goalTokens(member.tokens);
      // Existing descendants have a baseline recorded at goal creation. Newly
      // spawned ones start at zero; account their whole usage exactly once.
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
      goal.reason = "已达到用户设置的 Token 预算；目标尚未完成。";
      goal.settling = true;
      goal.activeSince = null;
    }
    await this.save(goal);
  }

  async rebase(goal, session) {
    const family = [session, ...await this.host.descendants?.(goal.sessionID) ?? []];
    goal.usage = Object.fromEntries(family.map(member => [member.id, goalTokens(member.tokens)]));
  }

  async newGoal(sessionID, session, input) {
    if (session.agent === "plan") throw new Error("请先切换到允许执行的 Agent；目标模式不会绕过 Plan。");
    const family = [session, ...await this.host.descendants?.(sessionID) ?? []];
    return {
      schemaVersion: 1, id: randomUUID(), revision: 1, sessionID, directory: this.host.directory,
      objective: validateObjective(input.objective), status: "active", tokenBudget: validateBudget(input.tokenBudget),
      tokensUsed: 0, timeUsedMs: 0, createdAt: this.host.now(), updatedAt: this.host.now(), activeSince: this.host.now(), runStartedAt: this.host.now(),
      usage: Object.fromEntries(family.map(member => [member.id, goalTokens(member.tokens)])), seen: [],
      round: { number: input.sourceMessageID ? 1 : 0, activity: false, tools: 0, failedExecutions: 0, successfulTool: false },
      emptyRounds: 0, failedRounds: 0, reason: null, settling: false, pending: null,
      ...(input.sourceMessageID ? { sourceMessageID: input.sourceMessageID } : {}),
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
    // Stamp the actual admission target. Forked history may copy user metadata,
    // but cannot silently copy a persistent goal into a different session.
    return this.serial(event.sessionID, async () => {
      const session = await this.session(event.sessionID, true);
      if (session.agent === "plan") throw new Error("Plan 模式不能开始持续目标。请自行切换到执行 Agent 后重试。");
      const old = await this.read(event.sessionID);
      if (old && old.status !== "complete" && old.sourceMessageID !== event.messageID) throw new Error("当前存在未完成目标；请在目标详情中编辑、恢复或清除后再创建。");
      event.metadata.desktopGoal = { version: 1, objective: marker.objective, sessionID: event.sessionID, epoch: await this.inputEpoch(event.sessionID) };
    });
  }

  // Only promoted, durable user messages authorize goal creation. Reading raw
  // context preserves application metadata without putting marker text into the
  // user's prompt or weakening native attachment resolution. Receipts live
  // outside the clearable goal, so replaying history can never re-arm old input.
  async consumeGoalInput(event, session) {
    if (!this.host.context) return;
    const ids = new Set(event.messages.filter(message => message.role === "user").map(message => message.id));
    if (!ids.size) return;
    const messages = await this.host.context(event.sessionID);
    for (const message of messages) {
      const marker = message.metadata?.desktopGoal;
      if (message.type !== "user" || !ids.has(message.id) || marker?.version !== 1 || marker.sessionID !== event.sessionID) continue;
      const key = `${INPUTS}${event.sessionID}/${message.id}`;
      if (await this.host.storage.get(key)) continue;
      if ((marker.epoch ?? 0) !== await this.inputEpoch(event.sessionID)) {
        await this.host.storage.set(key, { rejected: "目标输入已被用户停止、暂停或清除。" });
        continue;
      }
      const old = await this.read(event.sessionID);
      if (old?.sourceMessageID === message.id) {
        await this.host.storage.set(key, { goalID: old.id });
        continue;
      }
      let reason;
      if (event.agent === "plan" || session.agent === "plan") reason = "Plan 模式不能开始持续目标。";
      else if (session.time?.archived || session.revert) reason = "会话已归档或正在回退，不能开始持续目标。";
      else if (old && old.status !== "complete") reason = "当前存在未完成目标；未覆盖原目标。请在详情中编辑、恢复或清除。";
      if (reason) {
        await this.host.storage.set(key, { rejected: reason });
        event.system.push({ type: "text", text: `The user's goal-mode submission could not create a goal: ${reason} Explain this to the user; do not claim a new persistent goal was started.` });
        continue;
      }
      const goal = await this.newGoal(event.sessionID, session, { objective: marker.objective, sourceMessageID: message.id });
      await this.save(goal);
      await this.host.storage.set(key, { goalID: goal.id });
      // The native user message already started this execution. Never wake a
      // second runner or append an unnecessary initial synthetic turn.
      await this.context(goal);
    }
  }

  async mutate(sessionID, action, input = {}) {
    if (["pause", "clear"].includes(action)) this.cancel(sessionID);
    let settle = false;
    const result = await this.serial(sessionID, async () => {
      const session = await this.session(sessionID, action === "create" || action === "resume");
      const old = await this.read(sessionID);
      const wasActive = old?.status === "active";
      if (input.expectAbsent && old) throw new Error("目标已变化，请刷新后重试。");
      if (input.expectedID && old?.id !== input.expectedID || input.expectedRevision != null && old?.revision !== input.expectedRevision) {
        throw new Error("目标已变化，请刷新后重试。");
      }
      if (["pause", "clear"].includes(action)) await this.revokeInputs(sessionID);
      if (old) await this.account(old, session);
      if (action === "clear") {
        await this.host.storage.remove(PREFIX + sessionID);
        await this.host.removeContext(sessionID);
        if (wasActive) { settle = true; await this.host.interrupt?.(sessionID); }
        try { await this.host.changed?.(sessionID, null); } catch {}
        return null;
      }
      if (action === "create") {
        if (old && old.status !== "complete") throw new Error("当前存在未完成目标；请编辑、恢复或先清除原目标。");
        const goal = await this.newGoal(sessionID, session, input);
        await this.save(goal);
        await this.context(goal);
        try { await this.wake(goal); } catch (error) {
          goal.status = "blocked";
          goal.reason = `无法提交目标执行：${error instanceof Error ? error.message : String(error)}`;
          goal.activeSince = null;
          await this.save(goal);
          throw error;
        }
        return this.view(goal);
      }
      if (!old) throw new Error("当前会话没有目标。");
      if (action === "pause") {
        // Budget-limited takes precedence over a user pause, as in Codex.
        if (old.status === "active") { old.status = "paused"; old.settling = true; }
        old.reason = old.status === "paused" ? "用户暂停" : old.reason;
        old.activeSince = null;
      } else if (action === "resume") {
        if (session.agent === "plan") throw new Error("请先切换执行 Agent，不能在 Plan 中自动恢复。");
        if (old.status === "complete") throw new Error("已完成目标不能恢复；请创建新目标。");
        if (old.tokenBudget != null && old.tokensUsed >= old.tokenBudget) throw new Error("请先明确提高或清除预算，再恢复目标。");
        // Two windows may submit resume before the executor's busy timestamp
        // is projected. An already active goal is an idempotent no-op.
        if (old.status === "active" && !old.reason) return this.view(old);
        // Work done while paused is not part of the goal. Rebase all counters
        // before the new run, without discarding already charged usage.
        const family = [session, ...await this.host.descendants?.(sessionID) ?? []];
        old.usage = Object.fromEntries(family.map(member => [member.id, goalTokens(member.tokens)]));
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
        // Changing a budget never implicitly resumes a stopped goal.
        if (old.status === "active" && old.tokenBudget != null && old.tokensUsed >= old.tokenBudget) {
          old.status = "budget_limited";
          old.reason = "已达到更新后的 Token 预算。";
          old.activeSince = null;
        }
      } else throw new Error("不支持的目标操作。");
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
    // Waiting under the goal mutex can deadlock an interrupted context/idle
    // hook which is itself queued for that mutex. Release it before settlement.
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
    // Explicit user create/resume is allowed to wake the native execution. This
    // is NOT the automatic idle path and doesn't switch the session's agent.
    await this.admit(goal, true);
  }

  async admit(goal, resume) {
    const id = `msg_goal_${goal.id.replaceAll("-", "")}_${goal.revision}_${goal.round.number + 1}`;
    const pending = { id, revision: goal.revision };
    goal.pending = pending;
    await this.save(goal); // Persist the intent before durable inbox admission.
    await this.host.synthetic({
      sessionID: goal.sessionID, id, text: continuation(goal), description: "目标自动推进",
      metadata: { source: "desktop-goals", goalID: goal.id, goalRevision: goal.revision },
      delivery: "queue", resume,
    });
    goal.pending = null;
    goal.round = { number: goal.round.number + 1, activity: false, tools: 0, failedExecutions: 0, successfulTool: false };
    await this.save(goal);
  }

  async idle(sessionID, background = []) {
    const epoch = this.cancelEpoch.get(sessionID) ?? 0;
    return this.serial(sessionID, async () => {
      if (this.closed || epoch !== (this.cancelEpoch.get(sessionID) ?? 0)) return;
      const session = await this.host.getSession(sessionID);
      if (!this.owns(session) || session.parentID || session.time?.archived || session.revert) return;
      const goal = await this.read(sessionID);
      if (!goal || goal.status !== "active" && goal.status !== "budget_limited") return;
      if (session.agent === "plan") {
        await this.rebase(goal, session);
        goal.activeSince = null;
        await this.save(goal);
        return;
      }
      await this.account(goal, session);
      // Persisted instruction entries announce updates into history. Only
      // lifecycle mutations change that entry; current usage is injected by the
      // context hook, avoiding an ever-growing full-template update per round.
      if (goal.status !== "active") await this.context(goal);
      if (goal.status === "budget_limited" && !goal.budgetReported) {
        goal.budgetReported = true;
        await this.save(goal);
        await this.host.synthetic({ sessionID, id: `msg_goal_budget_${goal.id.replaceAll("-", "")}`, text: budgetNotice(goal), description: "目标预算已达到", delivery: "queue", resume: false });
        return;
      }
      if (goal.status !== "active") return;
      if (background.some(job => job.sessionID === sessionID)) return;
      // Synthetic admission is not atomic with plugin storage. Reconcile a
      // pending intent by its deterministic ID before allocating another round.
      if (goal.pending) {
        try { await this.admit(goal, false); } catch (error) {
          goal.status = "blocked";
          goal.reason = `内部续跑提交失败：${error instanceof Error ? error.message : String(error)}`;
          goal.activeSince = null;
          await this.save(goal);
        }
        return;
      }
      // Read persisted context here as well: public bus events can lag the
      // synchronous idle boundary. Never infer an empty round from a slow SSE.
      if (this.host.context) {
        const messages = await this.host.context(sessionID);
        const lastInput = messages.findLastIndex(message => goal.sourceMessageID && message.id === goal.sourceMessageID || message.type === "synthetic" && message.id?.startsWith(`msg_goal_${goal.id.replaceAll("-", "")}_`));
        const lastRound = lastInput < 0 ? [] : messages.slice(lastInput + 1);
        goal.round.activity ||= lastRound.some(message => message.type === "assistant" && message.content?.some(part => part.type === "tool" || typeof part.text === "string" && part.text.trim()));
      }
      goal.emptyRounds = goal.round.activity ? 0 : goal.emptyRounds + 1;
      goal.failedRounds = goal.round.failedExecutions && !goal.round.successfulTool ? goal.failedRounds + 1 : 0;
      if (goal.emptyRounds >= 3 || goal.failedRounds >= 3) {
        goal.status = "blocked";
        goal.reason = goal.emptyRounds >= 3 ? "连续三轮没有可观察活动，已停止自动续跑。" : "连续三轮执行失败且没有成功工具，已停止自动续跑。";
        goal.activeSince = null;
        await this.save(goal);
        await this.context(goal);
        return;
      }
      if (this.closed || epoch !== (this.cancelEpoch.get(sessionID) ?? 0)) return;
      // Runs INSIDE the native idle hook, without starting a second execution.
      // The executor rechecks its inbox and preserves native steering priority
      // and the order of previously queued user input.
      try { await this.admit(goal, false); } catch (error) {
        goal.status = "blocked";
        goal.reason = `内部续跑提交失败：${error instanceof Error ? error.message : String(error)}`;
        goal.activeSince = null;
        await this.save(goal);
      }
    });
  }

  async report(sessionID, input) {
    return this.serial(sessionID, async () => {
      await this.session(sessionID, true);
      const goal = await this.read(sessionID);
      if (!goal || goal.id !== input.goalID || goal.revision !== input.revision) throw new Error("目标已变化，请先调用 get_goal。");
      if (!["complete", "blocked"].includes(input.status)) throw new Error("模型只能报告 complete 或 blocked；暂停、恢复和预算由用户控制。");
      if (goal.status !== "active") throw new Error("目标当前未运行，模型不能自行恢复或修改其状态。");
      if (typeof input.evidence !== "string" || !input.evidence.trim()) throw new Error("必须说明完成证据或连续阻塞审查结果。");
      if (input.status === "blocked" && goal.round.number - (goal.blockedAuditStart ?? 0) < 3) throw new Error("同一阻塞至少应连续审查三轮，不能第一次遇到就停止。");
      await this.account(goal);
      if (goal.status === "budget_limited" && input.status !== "complete") throw new Error("预算限制优先于 blocked。");
      goal.status = input.status;
      goal.reason = input.evidence.trim().slice(0, 8000);
      goal.settling = true;
      goal.activeSince = null;
      await this.save(goal);
      await this.context(goal);
      return this.view(goal);
    });
  }

  async beforeContext(event) {
    return this.serial(event.sessionID, async () => {
      const session = await this.host.getSession(event.sessionID);
      if (!this.owns(session) || session.parentID) return;
      await this.consumeGoalInput(event, session);
      const goal = await this.read(event.sessionID);
      const wasActive = goal?.status === "active";
      if (goal && event.agent === "plan") {
        await this.rebase(goal, session);
        goal.activeSince = null;
      } else if (goal) await this.account(goal, session);
      if (goal?.status === "active" && event.agent !== "plan" && (!event.tools.get_goal || !event.tools.update_goal)) {
        goal.status = "blocked";
        goal.reason = "当前 Agent 的工具快照缺少目标查询或完成工具，已停止自动推进。";
        goal.activeSince = null;
        await this.save(goal);
      }
      const active = goal?.status === "active" && event.agent !== "plan";
      if (goal) event.system.push({ type: "text", text: goalContext(goal) });
      else if (event.messages.some(message => message.id?.startsWith("msg_goal_"))) {
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
          // Identify our messages by their durable ID, never by user-authored text.
          const replacement = "An automatic goal continuation was cancelled or superseded. Do not pursue it. Follow current user input and current goal state only.";
          if (typeof message.content === "string") message.content = replacement;
          else if (Array.isArray(message.content)) for (const part of message.content) if (part.type === "text") part.text = replacement;
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
        goal.reason = "Plan 模式：自动续跑挂起，需切换执行 Agent 后恢复。";
        event.system.push({ type: "text", text: "Goal automation is suspended in Plan mode. Do not bypass the selected agent's restrictions or switch agents. Only perform planning explicitly requested by the user." });
        await this.save(goal);
      }
    });
  }

  async toolFinished(event) {
    if (["get_goal", "update_goal"].includes(event.tool)) return;
    return this.serial(event.sessionID, async () => {
      const session = await this.host.getSession(event.sessionID);
      if (!this.owns(session)) return;
      const goal = await this.read(event.sessionID);
      if (!goal || goal.status !== "active") return;
      if (event.agent === "plan") {
        await this.rebase(goal, session);
        goal.activeSince = null;
        await this.save(goal);
        return;
      }
      goal.round.activity = true;
      goal.round.tools++;
      if (event.status === "completed") goal.round.successfulTool = true;
      else if (["shell", "bash"].includes(event.tool)) goal.round.failedExecutions++;
      await this.account(goal, session);
    });
  }

  async retry(event) {
    const session = await this.host.getSession(event.sessionID);
    if (!this.owns(session)) return;
    const goal = await this.read(event.sessionID);
    if (goal?.status === "active" && event.attempt >= 4) event.decision = { retry: false };
  }

  async observe(event) {
    let sessionID = event.data?.sessionID;
    if (!sessionID || this.closed || !OBSERVED.has(event.type)) return;
    // Descendants do not own goals; route their usage to the nearest root goal.
    if (event.type === "session.usage.updated") {
      let member;
      try { member = await this.host.getSession(sessionID); } catch { return; }
      if (isCompanionSession(member)) return;
      const visited = new Set();
      while (member.parentID && !visited.has(member.id)) {
        visited.add(member.id);
        try { member = await this.host.getSession(member.parentID); } catch { return; }
      }
      sessionID = member.id;
    }
    if (event.type === "session.execution.interrupted" && event.data.reason === "user") this.cancel(sessionID);
    return this.serial(sessionID, async () => {
      let session;
      try { session = await this.host.getSession(sessionID); } catch { return; }
      if (!this.owns(session)) return;
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
        if (session.agent === "plan") { await this.rebase(goal, session); goal.activeSince = null; }
        else await this.account(goal, session);
      }
      if (event.type === "session.execution.interrupted" && event.data.reason === "user" && goal.status === "active") {
        await this.account(goal, session);
        if (goal.status === "active") { goal.status = "paused"; goal.reason = "用户停止执行"; }
        goal.activeSince = null;
        goal.revision++;
        await this.context(goal);
      }
      if (event.type === "session.execution.failed" && goal.status === "active") {
        await this.account(goal, session);
        goal.status = /usage|quota|rate.limit|credit/i.test(event.data.error?.type ?? "") ? "usage_limited" : "blocked";
        goal.reason = event.data.error?.message || "原生执行失败，已停止自动续跑。";
        goal.activeSince = null;
        await this.context(goal);
      }
      if (event.type === "session.execution.succeeded" || event.type === "session.execution.interrupted" || event.type === "session.execution.failed") {
        await this.account(goal, session);
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
          let session;
          try { session = await this.session(value.sessionID, true); } catch { return; }
          const goal = await this.read(value.sessionID);
          if (!goal || goal.status !== "active") return;
          // Rebase wall time on startup. Downtime is not execution time.
          goal.activeSince = this.host.now();
          await this.account(goal, session);
          await this.context(goal);
          // Re-admission of the same ID is idempotent. Native execution restart
          // recovers in-flight work; an idle goal needs one explicit wake.
          const idle = this.host.isIdle ? await this.host.isIdle(value.sessionID) : !nativeInFlight(session);
          if (this.closed) return;
          if (goal.status === "active" && session.agent !== "plan" && idle) await this.wake(goal);
        });
      }
      after = page.next;
    } while (after);
  }

  async close() {
    this.closed = true;
    await Promise.allSettled([...this.locks.values()]);
  }
}
