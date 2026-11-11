import type { Plugin } from "@opencode/plugin"
import { Goals } from "./rpc.js"
import { GoalRuntime, isCompanionSession } from "./runtime.mjs"
import { CONTEXT_KEY, PLUGIN_ID } from "./prompts.mjs"

// Plugin.define is an identity helper in 2.2.7. Use its public type without a
// runtime SDK dependency so the shipped server bundle needs no node_modules.
export default {
  id: PLUGIN_ID,
  async setup(ctx) {
    const [major, minor, patch] = ctx.app.version.split(".").map(Number)
    if (major !== 2 || minor < 2 || minor === 2 && patch < 7) {
      throw new Error("目标插件需要 OpenCode 2.2.7+ 的 experimental.idle 接口。")
    }
    const abort = new AbortController()
    let emit: ((sessionID: string) => Promise<void>) | undefined
    const runtime = new GoalRuntime({
      directory: ctx.location.directory,
      workspaceID: ctx.location.workspaceID,
      now: () => Date.now(),
      storage: ctx.storage,
      getSession: (sessionID: string) => ctx.session.get({ sessionID }),
      synthetic: (input: Parameters<typeof ctx.session.synthetic>[0]) => ctx.session.synthetic(input),
      interrupt: (sessionID: string) => ctx.session.interrupt({ sessionID, resume: false }),
      wait: (sessionID: string) => ctx.session.wait({ sessionID }),
      isIdle: async (sessionID: string) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          // A successful wait authoritatively confirms process-local inactivity.
          // A timeout means UNKNOWN/active, never permission to restart work.
          return await Promise.race([
            ctx.session.wait({ sessionID }).then(() => true),
            new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 100) }),
          ])
        } finally { if (timer) clearTimeout(timer) }
      },
      context: (sessionID: string) => ctx.session.context({ sessionID }),
      descendants: async (sessionID: string) => {
        const descendants = []
        const parents = [sessionID]
        const visited = new Set(parents)
        while (parents.length) {
          const parentID = parents.shift()!
          let cursor: string | undefined
          do {
            const page = await ctx.session.list({ parentID, cursor, limit: 100 })
            for (const child of page.data) {
              if (visited.has(child.id) || isCompanionSession(child)) continue
              visited.add(child.id)
              descendants.push(child)
              parents.push(child.id)
            }
            cursor = page.cursor.next ?? undefined
          } while (cursor)
        }
        return descendants
      },
      setContext: (sessionID: string, value: string) => ctx.session.instructions.entry.put({ sessionID, key: CONTEXT_KEY, value }),
      removeContext: (sessionID: string) => ctx.session.instructions.entry.remove({ sessionID, key: CONTEXT_KEY }),
      changed: (sessionID: string) => emit?.(sessionID),
    })

    const rpc = await ctx.rpc.register(Goals, {
      get: async (input, context) => {
        try { return await runtime.get((input as { sessionID: string }).sessionID) }
        catch (error) { return context.error("goal_error", error instanceof Error ? error.message : String(error), {}) }
      },
      control: async (input, context) => {
        const { sessionID, action, ...options } = input as {
          sessionID: string; action: string; objective?: string; tokenBudget?: number | null
          expectedID?: string; expectedRevision?: number
        }
        try { return await runtime.mutate(sessionID, action, options) }
        catch (error) { return context.error("goal_error", error instanceof Error ? error.message : String(error), {}) }
      },
    })
    emit = sessionID => rpc.events.emit("updated", { sessionID })

    await ctx.session.hook("experimental.idle", event => runtime.idle(event.sessionID, [...event.background]))
    await ctx.session.hook("context", event => runtime.beforeContext(event))
    await ctx.session.hook("retry", event => runtime.retry(event))
    await ctx.tool.hook("execute.after", event => runtime.toolFinished(event))
    await ctx.session.hook("prompt", event => runtime.prompt(event))

    await ctx.tool.transform(editor => {
      for (const name of ["get_goal", "update_goal"]) {
        if (editor.get(name)) throw new Error(`目标工具 ${name} 已存在；拒绝覆盖其他插件或原生工具。`)
      }
      editor.add({
        name: "get_goal",
        description: "Get this session's persistent goal, status, ID, revision, token budget and usage. Ordinary tasks do not implicitly create goals.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { codemode: false },
        execute: async (_input, context) => ({ content: JSON.stringify({ goal: await runtime.get(context.sessionID) }) }),
      })
      editor.add({
        name: "update_goal",
        description: "Report the current persistent goal complete only after authoritative evidence proves every requirement. Report blocked only after the same genuine blocker recurs for at least three consecutive goal rounds. Do not shrink the objective or treat budget exhaustion as completion. Only users control pause/resume/budgets. Read get_goal for the current goalID and revision before updating.",
        input: {
          type: "object",
          properties: {
            goalID: { type: "string" }, revision: { type: "integer", minimum: 1 },
            status: { type: "string", enum: ["complete", "blocked"] },
            evidence: { type: "string", minLength: 1, maxLength: 8000 },
          },
          required: ["goalID", "revision", "status", "evidence"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input, context) => ({ content: JSON.stringify({ goal: await runtime.report(context.sessionID, input) }) }),
      })
    })

    await ctx.command.transform(editor => {
      editor.add({
        name: "goal",
        description: "持续目标：/goal <目标>；pause / resume / clear / edit <目标> / budget <整数或 none>",
        execute: async ({ sessionID, prompt }) => {
          const text = prompt.text.trim()
          if (prompt.files?.length || prompt.agents?.length || prompt.skills?.length) {
            throw new Error("请先在普通消息中提供附件或技能，再用 /goal 引用它们；目标命令不会丢弃附件。")
          }
          if (!text) {
            const goal = await runtime.get(sessionID)
            await ctx.session.synthetic({ sessionID, text: JSON.stringify({ goal }), description: "当前目标", resume: false })
            return
          }
          const [verb, ...rest] = text.split(/\s+/)
          if (["pause", "resume", "clear"].includes(verb) && !rest.length) {
            await runtime.mutate(sessionID, verb)
            return
          }
          if (verb === "edit") { await runtime.mutate(sessionID, "edit", { objective: rest.join(" ") }); return }
          if (verb === "budget") {
            const value = rest.join(" ")
            await runtime.mutate(sessionID, "budget", { tokenBudget: value === "none" ? null : Number(value) })
            return
          }
          await runtime.mutate(sessionID, "create", { objective: text })
        },
      })
    })

    const events = (async () => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        try { await runtime.observe(event) } catch (error) {
          console.error("[desktop-goals] failed to reconcile event", event.type, error)
        }
      }
    })().catch(error => { if (!abort.signal.aborted) console.error("[desktop-goals] event stream failed", error) })
    // Do not await restoration inside plugin setup: session admission waits for
    // plugin activation. Scheduling after setup avoids an activation deadlock.
    const restoreTimer = setTimeout(() => {
      void runtime.restore().catch(error => console.error("[desktop-goals] restore failed", error))
    }, 0)
    return async () => {
      clearTimeout(restoreTimer)
      abort.abort()
      await runtime.close()
      await events
    }
  },
} satisfies Plugin.Plugin
