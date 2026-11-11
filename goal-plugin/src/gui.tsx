import { createSignal, onCleanup, Show } from "solid-js"
import { Command, ComposerPill, Plugin, createKeyed } from "@opencode/plugin/gui"
import type { MountedSession } from "@opencode/plugin/gui"
import { Goals } from "./rpc.js"

declare global {
  interface Window {
    __ocGoalComposer?: {
      connect(value: { error(message: string): void }): () => void
      arm(): boolean
    }
  }
}

type Goal = {
  id: string; revision: number; objective: string; status: string; tokensUsed: number
  tokenBudget: number | null; timeUsedMs: number; rounds: number; reason: string | null
}
const labels: Record<string, string> = {
  active: "运行中", paused: "已暂停", blocked: "受阻", complete: "已完成",
  budget_limited: "预算已用尽", usage_limited: "供应商用量受限",
}
const count = (value: number) => new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value)

export default Plugin.define({
  setup(ctx) {
    const [goals, setGoals] = createSignal<Record<string, Goal | null>>({})
    const [busy, setBusy] = createSignal(false)
    const [failure, setFailure] = createSignal("")
    const requests = new Map<string, number>()
    const pendingRefresh = new Set<string>()
    let closed = false
    const ui = ctx.ui
    const disconnectComposer = window.__ocGoalComposer?.connect({
      error: message => ctx.toast.show({ title: "目标未发送", description: message, variant: "error" }),
    })
    const api = (session: MountedSession) => session.server.client.rpc(Goals)
    const options = (session: MountedSession) => ({ location: session.location })
    const currentGoal = (session: MountedSession) => goals()[session.key]
    const update = (session: MountedSession, goal: Goal | null) => {
      if (!closed) setGoals(previous => ({ ...previous, [session.key]: goal }))
    }
    const refresh = async (session: MountedSession) => {
      if (!session.location || !session.server.connected) return
      const request = (requests.get(session.key) ?? 0) + 1
      requests.set(session.key, request)
      const goal = await api(session).get({ sessionID: session.id }, options(session)) as Goal | null
      if (request === requests.get(session.key)) update(session, goal)
    }
    const safe = (run: () => Promise<void>) => {
      if (busy()) return
      setBusy(true)
      setFailure("")
      void run().catch(error => {
        const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : String(error)
        setFailure(message)
        ctx.toast.show({ title: "目标操作失败", description: message, variant: "error" })
      }).finally(() => { if (!closed) setBusy(false) })
    }
    const control = async (session: MountedSession, action: string, fields: Record<string, unknown> = {}) => {
      const goal = currentGoal(session)
      requests.set(session.key, (requests.get(session.key) ?? 0) + 1)
      const result = await api(session).control({
        sessionID: session.id, action,
        ...(goal ? { expectedID: goal.id, expectedRevision: goal.revision } : { expectAbsent: true }),
        ...fields,
      }, options(session)) as Goal | null
      requests.set(session.key, (requests.get(session.key) ?? 0) + 1)
      update(session, result)
    }
    const create = async (session: MountedSession, text?: string) => {
      if (!text && ctx.sessions.current()?.key === session.key && window.__ocGoalComposer?.arm()) return
      const objective = text || await ctx.dialogs.prompt({
        title: "设定持续目标", description: "在当前会话持续推进，直到完成、受阻、暂停或达到你设置的预算。不会扩大权限或切换 Agent。",
        placeholder: "完成什么？如何验证？哪些约束必须保留？", submit: "开始目标",
      })
      if (objective) await control(session, "create", { objective })
    }
    const edit = async (session: MountedSession) => {
      const goal = currentGoal(session)
      if (!goal) return
      const objective = await ctx.dialogs.prompt({ title: "编辑目标", value: goal.objective, description: "保留当前目标的用量与状态。", submit: "保存" })
      if (objective) await control(session, "edit", { objective, expectedID: goal.id, expectedRevision: goal.revision })
    }
    const budget = async (session: MountedSession) => {
      const goal = currentGoal(session)
      if (!goal) return
      const text = await ctx.dialogs.prompt({
        title: "目标 Token 总预算", value: goal.tokenBudget == null ? "none" : String(goal.tokenBudget),
        description: `已使用 ${goal.tokensUsed.toLocaleString()}。输入正整数，或 none 表示不限。修改预算不会自动恢复目标。`, submit: "保存预算",
      })
      if (text != null) await control(session, "budget", { tokenBudget: text.trim() === "none" ? null : Number(text), expectedID: goal.id, expectedRevision: goal.revision })
    }
    const clear = async (session: MountedSession) => {
      const goal = currentGoal(session)
      if (!goal) return
      if (await ctx.dialogs.confirm({ title: "清除当前目标？", description: "停止自动推进，不删除聊天记录或代码。", confirm: "清除目标", danger: true })) {
        await control(session, "clear", { expectedID: goal.id, expectedRevision: goal.revision })
      }
    }

    createKeyed(
      () => {
        const session = ctx.sessions.current()
        return session?.server.connected && session.location ? `${session.key}\n${session.directory}` : undefined
      },
      () => {
        const session = ctx.sessions.current()
        if (!session) return
        // Subscribe before the initial read. Events are live only; reconnects
        // establish a new subscription and reread persisted state.
        const unsubscribe = api(session).events.on("updated", event => {
          if (event.data.sessionID !== session.id || pendingRefresh.has(session.key)) return
          pendingRefresh.add(session.key)
          queueMicrotask(() => {
            pendingRefresh.delete(session.key)
            if (!closed) void refresh(session).catch(() => {})
          })
        })
        void refresh(session).catch(error => setFailure(String(error)))
        onCleanup(unsubscribe)
      },
    )

    const details = (props: { session: MountedSession }) => {
      const goal = () => currentGoal(props.session)
      return <div style={{ padding: "12px", "max-width": "440px", "min-width": "min(280px, 100%)", display: "grid", gap: "12px" }}>
        <Show when={goal()}>{value => <>
          <p style={{ margin: "0", "white-space": "pre-wrap", "overflow-wrap": "anywhere", "max-height": "240px", overflow: "auto" }}>{value().objective}</p>
          <div style={{ color: "var(--v2-text-text-subtle, inherit)", "font-size": "12px", "line-height": "1.8" }}>
            <div>{labels[value().status] ?? value().status} · 已推进 {value().rounds} 轮</div>
            <div>Token {value().tokensUsed.toLocaleString()} / {value().tokenBudget?.toLocaleString() ?? "不限"}</div>
            <div>运行时间 {Math.floor(value().timeUsedMs / 60000)} 分 {Math.floor(value().timeUsedMs / 1000) % 60} 秒</div>
          </div>
          <Show when={value().reason}><p style={{ margin: "0", "font-size": "12px", "white-space": "pre-wrap", "overflow-wrap": "anywhere", "max-height": "160px", overflow: "auto" }}>{value().reason}</p></Show>
          <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
            <Show when={value().status !== "complete"}>
              <ui.Button size="small" busy={busy()} onClick={() => safe(() => control(props.session, value().status === "active" ? "pause" : "resume"))}>
                {value().status === "active" ? "暂停" : "恢复目标"}
              </ui.Button>
            </Show>
            <ui.Button size="small" disabled={busy()} onClick={() => safe(() => edit(props.session))}>编辑</ui.Button>
            <ui.Button size="small" disabled={busy()} onClick={() => safe(() => budget(props.session))}>预算</ui.Button>
            <ui.Button size="small" variant="ghost-muted" disabled={busy()} onClick={() => safe(() => clear(props.session))}>清除</ui.Button>
          </div>
          <Show when={value().status === "complete"}>
            <ui.Button size="small" onClick={() => safe(() => create(props.session))}>新目标</ui.Button>
          </Show>
        </>}</Show>
        <Show when={!goal()}><p style={{ margin: "0" }}>当前没有目标。点击语音输入左侧的目标图标，或用 /goal 创建。</p></Show>
        <Show when={failure()}><p role="alert" style={{ margin: "0", "font-size": "12px" }}>{failure()}</p></Show>
      </div>
    }

    ctx.add(ComposerPill, {
      id: "goal",
      show: input => {
        const goal = currentGoal(input.session)
        if (!goal) return undefined
        return {
          label: `${labels[goal.status] ?? goal.status} · ${goal.objective}`,
          title: `持续目标 · ${count(goal.tokensUsed)} tokens`,
          tone: goal.status === "complete" ? "success" : goal.status === "active" ? undefined : "warning",
        }
      },
      menu: input => details(input),
    })
    // The server command owns /goal. Do not register a competing GUI slash
    // command: this preserves the same behavior in Desktop, TUI and API clients.
    ctx.add(Command, (): Command => ({
      id: "open", title: "设定或查看持续目标", section: "session", enabled: !!ctx.sessions.current(),
      run: () => {
        const session = ctx.sessions.current()
        if (!session) return
        if (!currentGoal(session)) safe(() => create(session))
        else ctx.dialogs.open(() => <ui.Dialog title="持续目标">{details({ session })}</ui.Dialog>)
      },
    }))
    return () => { closed = true; disconnectComposer?.() }
  },
})
