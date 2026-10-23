/**
 * Codex-style project/session sidebar for OpenCode Desktop (vertical tab layout).
 * Self-contained vanilla DOM module: it never imports from the minified main bundle.
 * The host hook (injected by apply-mod.mjs) provides all data and actions through `api`.
 */

const LS_PINS = "oc-cx-pins.v1";
const LS_UI = "oc-cx-ui.v1";
const SESSION_PREVIEW = 6;

const STRINGS = {
  zh: {
      projects: "项目",
      pinned: "已固定",
      noChats: "暂无聊天",
      noProjects: "暂无项目",
      untitled: "新会话",
      draft: "新会话",
      more: (n) => `显示更多 (${n})`,
      less: "收起",
      chats: (n) => `${n} 次聊天`,
      editProject: "编辑项目",
      newChat: "新建会话",
      pinProject: "置顶项目",
      unpinProject: "取消置顶项目",
      pinChat: "置顶会话",
      unpinChat: "取消置顶",
      copyPath: "复制路径",
      rename: "重命名",
      remove: "删除会话…",
      confirmRemove: "确认删除",
      cancel: "取消",
      close: "关闭",
      moreOptions: "更多选项",
  },
  en: {
      projects: "Projects",
      pinned: "Pinned",
      noChats: "No chats yet",
      noProjects: "No projects",
      untitled: "New session",
      draft: "New session",
      more: (n) => `Show more (${n})`,
      less: "Show less",
      chats: (n) => `${n} ${n === 1 ? "chat" : "chats"}`,
      editProject: "Edit project",
      newChat: "New session",
      pinProject: "Pin project",
      unpinProject: "Unpin project",
      pinChat: "Pin chat",
      unpinChat: "Unpin",
      copyPath: "Copy path",
      rename: "Rename",
      remove: "Delete chat…",
      confirmRemove: "Confirm delete",
      cancel: "Cancel",
      close: "Close",
      moreOptions: "More options",
  },
};
let L = STRINGS.en;
const setLocale = (loc) => {
  L = /^zh/i.test(loc || document.documentElement.lang || navigator.language || "") ? STRINGS.zh : STRINGS.en;
};

const ICONS = {
  folder: '<path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.4 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
  folderOpen:
    '<path d="M2 12.2V4.5a1 1 0 0 1 1-1h3.2l1.4 1.5H12.5a1 1 0 0 1 1 1V7"/><path d="M2.4 12.6 4 7.4h10.2l-1.6 5.1a.6.6 0 0 1-.6.4H2.9a.5.5 0 0 1-.5-.3z"/>',
  chevron: '<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>',
  pin: '<path d="M9.6 2.4 13.6 6.4l-1.2.6-2.2 2.2.3 2.7-.9.9-2.7-2.7-3.4 3.4-.7-.7 3.4-3.4L3.5 6.7l.9-.9 2.7.3L9.3 3.9z"/>',
  dots: '<circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none"/>',
  edit: '<path d="M7.5 3H3.8A1.3 1.3 0 0 0 2.5 4.3v7.9A1.3 1.3 0 0 0 3.8 13.5h7.9A1.3 1.3 0 0 0 13 12.2V8.5"/><path d="M11.6 2.4a1.1 1.1 0 0 1 1.6 1.6L7.6 9.6 5.4 10.1l.5-2.2z"/>',
  chat: '<path d="M8 2.5c3 0 5.5 2 5.5 4.8S11 12.1 8 12.1c-.7 0-1.4-.1-2-.3l-2.6 1.2.5-2.4C2.9 9.6 2.5 8.5 2.5 7.3 2.5 4.5 5 2.5 8 2.5z"/>',
  gear: '<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
  x: '<path d="m4.5 4.5 7 7m0-7-7 7"/>',
};

function icon(name, size = 16, extra = "") {
  const filled = extra.includes("filled");
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const baseName = (p) => {
  const t = String(p || "").replace(/[\\/]+$/, "");
  return t.slice(Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")) + 1) || t;
};
const projKey = (srv, wt) => `${srv}\u0000${norm(wt)}`;
const sessKey = (srv, id) => `${srv}\u0000${id}`;

function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

function injectStyle() {
  if (document.getElementById("oc-cx-style")) return;
  const css = `
.oc-cx-host{flex:1 1 auto;min-height:0;width:100%;overflow-y:auto;overflow-x:hidden;padding:2px 0 12px;font-size:13px;line-height:18px;color:var(--v2-text-text-base);scrollbar-width:thin;scrollbar-color:transparent transparent;user-select:none}
.oc-cx-host:hover{scrollbar-color:var(--v2-border-border-base,rgba(128,128,128,.4)) transparent}
.oc-cx-host *{box-sizing:border-box}
.oc-cx-host button{all:unset;box-sizing:border-box;cursor:pointer}
.oc-cx-label{display:flex;align-items:center;gap:4px;height:28px;padding:0 8px;margin-top:6px;color:var(--v2-text-text-faint);font-size:12.5px;cursor:pointer;border-radius:8px}
.oc-cx-label:hover{color:var(--v2-text-text-base)}
.oc-cx-label.is-static{cursor:default}
.oc-cx-label.is-static:hover{color:var(--v2-text-text-faint)}
.oc-cx-chev{display:inline-flex;transition:transform .15s ease}
.oc-cx-label.is-collapsed .oc-cx-chev{transform:rotate(-90deg)}
.oc-cx-row{position:relative;display:flex;align-items:center;gap:8px;height:32px;padding:0 6px 0 8px;border-radius:8px;cursor:pointer;color:var(--v2-text-text-muted,inherit);outline:none}
.oc-cx-row:hover,.oc-cx-row:focus-visible{background:var(--v2-background-bg-layer-01,rgba(128,128,128,.12));color:var(--v2-text-text-base)}
.oc-cx-row.is-active{background:var(--v2-background-bg-layer-02,rgba(128,128,128,.2));color:var(--v2-text-text-base)}
.oc-cx-proj{margin-top:6px;color:var(--v2-text-text-base)}
.oc-cx-proj .oc-cx-ico{color:var(--v2-icon-icon-muted,currentColor)}
.oc-cx-ico{display:inline-flex;flex:none;width:16px;height:16px}
.oc-cx-name,.oc-cx-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc-cx-sess{padding-left:32px;height:30px}
.oc-cx-sess.is-flat{padding-left:8px}
.oc-cx-sess .oc-cx-title{color:inherit}
.oc-cx-draft .oc-cx-title{font-style:italic;color:var(--v2-text-text-faint)}
.oc-cx-srv{flex:none;font-size:11px;color:var(--v2-text-text-faint);max-width:70px;overflow:hidden;text-overflow:ellipsis}
.oc-cx-pinmark{flex:none;display:inline-flex;color:var(--v2-icon-icon-faint,currentColor);opacity:.7}
.oc-cx-status{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px}
.oc-cx-dot{width:7px;height:7px;border-radius:50%;background:var(--v2-icon-icon-accent,#0a84ff)}
.oc-cx-spin{width:12px;height:12px;border-radius:50%;border:1.5px solid var(--v2-border-border-base,rgba(128,128,128,.4));border-top-color:var(--v2-icon-icon-muted,currentColor);animation:oc-cx-spin .8s linear infinite}
@keyframes oc-cx-spin{to{transform:rotate(360deg)}}
.oc-cx-acts{display:none;flex:none;align-items:center;gap:2px}
.oc-cx-row:hover .oc-cx-acts,.oc-cx-row:focus-within .oc-cx-acts,.oc-cx-row.has-menu .oc-cx-acts{display:inline-flex}
.oc-cx-row:hover .oc-cx-status,.oc-cx-row:focus-within .oc-cx-status,.oc-cx-row.has-menu .oc-cx-status,.oc-cx-row:hover .oc-cx-pinmark,.oc-cx-row.has-menu .oc-cx-pinmark{display:none}
.oc-cx-btn{display:inline-flex !important;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;color:var(--v2-icon-icon-muted,currentColor)}
.oc-cx-btn:hover{background:var(--v2-background-bg-layer-03,rgba(128,128,128,.22));color:var(--v2-text-text-base)}
.oc-cx-btn.is-on{color:var(--v2-text-text-base)}
.oc-cx-more{height:26px;padding:0 8px 0 32px;color:var(--v2-text-text-faint);font-size:12.5px}
.oc-cx-more:hover{color:var(--v2-text-text-base);background:transparent}
.oc-cx-empty{height:28px;padding:0 8px 0 32px;display:flex;align-items:center;color:var(--v2-text-text-faint);opacity:.75;cursor:default}
.oc-cx-rename{flex:1 1 auto;min-width:0;height:22px;padding:0 4px;border-radius:5px;border:1px solid var(--v2-border-border-focus,#0a84ff);background:var(--v2-background-bg-base,transparent);color:var(--v2-text-text-base);font:inherit;outline:none;user-select:text}
.oc-cx-pop{position:fixed;z-index:2147483000;min-width:168px;padding:6px;border-radius:12px;background:var(--v2-background-bg-base,#fff);color:var(--v2-text-text-base,#111);border:1px solid var(--v2-border-border-muted,rgba(128,128,128,.25));box-shadow:0 10px 32px rgba(0,0,0,.16),0 2px 6px rgba(0,0,0,.08);font-size:13px;line-height:18px;user-select:none}
.oc-cx-pop button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-height:30px;padding:0 10px;border-radius:8px;cursor:pointer}
.oc-cx-pop button:hover{background:var(--v2-background-bg-layer-01,rgba(128,128,128,.12))}
.oc-cx-pop button[disabled]{opacity:.4;pointer-events:none}
.oc-cx-pop button.is-danger{color:#e5484d}
.oc-cx-pop hr{border:0;border-top:1px solid var(--v2-border-border-muted,rgba(128,128,128,.22));margin:6px 4px}
.oc-cx-card{width:300px;padding:10px 12px;border-radius:16px}
.oc-cx-card-r{display:flex;align-items:center;gap:10px;min-height:30px;padding:0 4px;color:var(--v2-text-text-muted,inherit)}
.oc-cx-card-r .oc-cx-ico{color:var(--v2-icon-icon-muted,currentColor)}
.oc-cx-card-h{display:flex;align-items:center;gap:10px;min-height:32px;padding:0 4px;font-weight:600;color:var(--v2-text-text-base)}
.oc-cx-card-h .oc-cx-name{font-size:14px}
.oc-cx-card-path{word-break:break-all;line-height:17px;padding:6px 0}
.oc-cx-card .oc-cx-btn{margin-left:auto}
.oc-cx-pop .oc-cx-card-edit{padding:0 4px;color:var(--v2-text-text-base);min-height:32px}
@media (prefers-reduced-motion:reduce){.oc-cx-spin{animation:none}.oc-cx-chev{transition:none}}
`;
  const el = document.createElement("style");
  el.id = "oc-cx-style";
  el.textContent = css;
  document.head.appendChild(el);
}

function mountUi(host, api) {
  injectStyle();
  host.classList.add("oc-cx-host");

  const state = {
    snap: null,
    hash: "",
    pins: Object.assign({ projects: [], sessions: [] }, loadJson(LS_PINS, {})),
    ui: Object.assign({ projectsCollapsed: false, collapsed: {}, expanded: {} }, loadJson(LS_UI, {})),
    renaming: null,
    popup: null,
    card: null,
    cardTimer: 0,
    cardHide: 0,
  };
  state.pins.projects = Array.isArray(state.pins.projects) ? state.pins.projects : [];
  state.pins.sessions = Array.isArray(state.pins.sessions) ? state.pins.sessions : [];

  const savePins = () => localStorage.setItem(LS_PINS, JSON.stringify(state.pins));
  const saveUi = () => localStorage.setItem(LS_UI, JSON.stringify(state.ui));

  const togglePin = (list, key) => {
    const i = list.indexOf(key);
    if (i === -1) list.unshift(key);
    else list.splice(i, 1);
    savePins();
    render();
  };

  const closePopup = () => {
    if (state.popup) {
      state.popup.remove();
      state.popup = null;
      host.querySelectorAll(".has-menu").forEach((n) => n.classList.remove("has-menu"));
    }
  };
  const hideCard = () => {
    clearTimeout(state.cardTimer);
    clearTimeout(state.cardHide);
    if (state.card) {
      state.card.remove();
      state.card = null;
    }
  };

  const place = (pop, rect, side) => {
    document.body.appendChild(pop);
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let left = side === "right" ? rect.right + 8 : rect.right - pw;
    let top = side === "right" ? rect.top - 6 : rect.bottom + 4;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };

  const openMenu = (anchor, items, row) => {
    closePopup();
    hideCard();
    const build = (list) => {
      const pop = h("div", { class: "oc-cx-pop", role: "menu" });
      for (const it of list) {
        if (it.sep) {
          pop.append(h("hr"));
          continue;
        }
        pop.append(
          h(
            "button",
            {
              role: "menuitem",
              disabled: it.disabled,
              class: it.danger ? "is-danger" : "",
              onclick: (e) => {
                e.stopPropagation();
                const next = it.onClick?.();
                if (Array.isArray(next)) {
                  const rect = pop.getBoundingClientRect();
                  pop.remove();
                  state.popup = build(next);
                  place(state.popup, { right: rect.right, bottom: rect.top - 4 }, "left");
                  return;
                }
                closePopup();
              },
            },
            it.icon ? h("span", { class: "oc-cx-ico", html: icon(it.icon, 15) }) : null,
            it.label,
          ),
        );
      }
      return pop;
    };
    state.popup = build(items);
    row?.classList.add("has-menu");
    place(state.popup, anchor.getBoundingClientRect(), "left");
  };

  const onDocPointer = (e) => {
    if (state.popup && !state.popup.contains(e.target)) closePopup();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      closePopup();
      hideCard();
    }
  };
  document.addEventListener("pointerdown", onDocPointer, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", closePopup);
  host.addEventListener("scroll", () => {
    closePopup();
    hideCard();
  });

  const showCard = (g, row) => {
    hideCard();
    const pinned = state.pins.projects.includes(g.key);
    const total = g.sessions.length;
    const card = h(
      "div",
      { class: "oc-cx-pop oc-cx-card", role: "tooltip" },
      h(
        "div",
        { class: "oc-cx-card-h" },
        h("span", { class: "oc-cx-ico", html: icon("folder", 17) }),
        h("span", { class: "oc-cx-name", title: g.name }, g.name),
        h("button", {
          class: "oc-cx-btn" + (pinned ? " is-on" : ""),
          "aria-label": pinned ? L.unpinProject : L.pinProject,
          title: pinned ? L.unpinProject : L.pinProject,
          html: icon("pin", 16, pinned ? "filled" : ""),
          onclick: (e) => {
            e.stopPropagation();
            togglePin(state.pins.projects, g.key);
            hideCard();
          },
        }),
      ),
      h("div", { class: "oc-cx-card-r" }, h("span", { class: "oc-cx-ico", html: icon("chat", 16) }), L.chats(total)),
      h("hr"),
      h(
        "div",
        { class: "oc-cx-card-r" },
        h("span", { class: "oc-cx-ico", html: icon("folder", 16) }),
        h("span", { class: "oc-cx-card-path" }, g.worktree),
      ),
      api.canEdit
        ? [
            h("hr"),
            h(
              "button",
              {
                class: "oc-cx-card-edit",
                onclick: () => {
                  hideCard();
                  api.editProject(g.srv, g.worktree);
                },
              },
              h("span", { class: "oc-cx-ico", html: icon("gear", 16) }),
              L.editProject,
            ),
          ]
        : null,
    );
    card.addEventListener("mouseenter", () => clearTimeout(state.cardHide));
    card.addEventListener("mouseleave", () => {
      state.cardHide = setTimeout(hideCard, 160);
    });
    state.card = card;
    const aside = host.closest("aside") || host;
    const ar = aside.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    place(card, { right: ar.right, top: rr.top, bottom: rr.bottom }, "right");
  };

  const buildModel = (snap) => {
    const projs = [];
    const bySrv = new Map();
    for (const sv of snap.servers) {
      const byKey = new Map();
      bySrv.set(sv.key, byKey);
      for (const p of sv.projects) {
        const key = projKey(sv.key, p.worktree);
        if (byKey.has(key)) continue;
        const g = {
          key,
          srv: sv.key,
          srvName: sv.name,
          worktree: p.worktree,
          name: p.name || baseName(p.worktree),
          dirs: [p.worktree, ...(p.sandboxes || [])].map(norm),
          sessions: [],
          drafts: [],
        };
        byKey.set(key, g);
        projs.push(g);
      }
      for (const s of sv.sessions) {
        const g = byKey.get(projKey(sv.key, s.worktree));
        if (!g) continue;
        g.sessions.push({ ...s, srv: sv.key, key: sessKey(sv.key, s.id), project: g });
      }
    }
    for (const d of snap.drafts || []) {
      const byKey = bySrv.get(d.server);
      if (!byKey) continue;
      const dir = norm(d.directory);
      for (const g of byKey.values()) {
        if (g.dirs.includes(dir)) {
          g.drafts.push(d);
          break;
        }
      }
    }
    for (const g of projs) g.sessions.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const all = projs.flatMap((g) => g.sessions);
    const pinnedSessions = state.pins.sessions.map((k) => all.find((s) => s.key === k)).filter(Boolean);
    const rank = (g) => {
      const i = state.pins.projects.indexOf(g.key);
      return i === -1 ? Infinity : i;
    };
    const ordered = projs.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map((x) => x.g);
    return { projs: ordered, pinnedSessions, pinnedKeys: new Set(pinnedSessions.map((s) => s.key)) };
  };

  const titleOf = (s) => (s.title && s.title.trim()) || L.untitled;

  const statusEl = (s) => {
    if (s.loading) return h("span", { class: "oc-cx-status" }, h("span", { class: "oc-cx-spin" }));
    if (s.unread && !s.active) return h("span", { class: "oc-cx-status" }, h("span", { class: "oc-cx-dot" }));
    return null;
  };

  const commitRename = async (s, value, ok) => {
    state.renaming = null;
    const next = value.trim();
    if (ok && next && next !== s.title) {
      try {
        await api.rename(s.srv, s.id, next);
      } catch {}
      await poll(true);
    } else {
      render();
    }
  };

  const sessionRow = (s, flat) => {
    const cur = state.snap.current;
    s.active = !!cur && cur.server === s.srv && cur.sessionId === s.id;
    const pinned = state.pins.sessions.includes(s.key);
    const renaming = state.renaming === s.key;
    const row = h("div", {
      class: "oc-cx-row oc-cx-sess" + (flat ? " is-flat" : "") + (s.active ? " is-active" : ""),
      role: "button",
      tabindex: "0",
      title: titleOf(s),
      "data-key": s.key,
      onclick: () => !renaming && api.openSession(s.srv, s.id, s.worktree),
      onkeydown: (e) => {
        if (!renaming && (e.key === "Enter" || e.key === " ") && e.target === row) {
          e.preventDefault();
          api.openSession(s.srv, s.id, s.worktree);
        }
      },
      oncontextmenu: (e) => {
        e.preventDefault();
        sessionMenu(s, row, row);
      },
    });
    if (renaming) {
      const input = h("input", {
        class: "oc-cx-rename",
        value: s.title || "",
        onclick: (e) => e.stopPropagation(),
        onkeydown: (e) => {
          e.stopPropagation();
          if (e.key === "Enter") commitRename(s, input.value, true);
          else if (e.key === "Escape") commitRename(s, "", false);
        },
        onblur: () => state.renaming && commitRename(s, input.value, true),
      });
      row.append(input);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
      return row;
    }
    const pinBtn = h("button", {
      class: "oc-cx-btn" + (pinned ? " is-on" : ""),
      title: pinned ? L.unpinChat : L.pinChat,
      "aria-label": pinned ? L.unpinChat : L.pinChat,
      html: icon("pin", 15, pinned ? "filled" : ""),
      onclick: (e) => {
        e.stopPropagation();
        togglePin(state.pins.sessions, s.key);
      },
    });
    const dots = h("button", {
      class: "oc-cx-btn",
      title: L.moreOptions,
      "aria-label": L.moreOptions,
      html: icon("dots", 15),
      onclick: (e) => {
        e.stopPropagation();
        sessionMenu(s, dots, row);
      },
    });
    row.append(
      h("span", { class: "oc-cx-title" }, titleOf(s)),
      pinned ? h("span", { class: "oc-cx-pinmark", html: icon("pin", 12, "filled") }) : null,
      statusEl(s),
      h("span", { class: "oc-cx-acts" }, pinBtn, dots),
    );
    return row;
  };

  const sessionMenu = (s, anchor, row) => {
    const pinned = state.pins.sessions.includes(s.key);
    openMenu(
      anchor,
      [
        { label: pinned ? L.unpinChat : L.pinChat, icon: "pin", onClick: () => togglePin(state.pins.sessions, s.key) },
        {
          label: L.rename,
          icon: "edit",
          onClick: () => {
            state.renaming = s.key;
            render();
          },
        },
        { sep: true },
        {
          label: L.remove,
          icon: "x",
          danger: true,
          onClick: () => [
            {
              label: `${L.confirmRemove}`,
              icon: "x",
              danger: true,
              onClick: async () => {
                state.pins.sessions = state.pins.sessions.filter((k) => k !== s.key);
                savePins();
                try {
                  await api.remove(s.srv, s.id);
                } catch {}
                await poll(true);
              },
            },
            { label: L.cancel },
          ],
        },
      ],
      row,
    );
  };

  const draftRow = (d) => {
    const row = h(
      "div",
      {
        class: "oc-cx-row oc-cx-sess oc-cx-draft" + (d.active ? " is-active" : ""),
        role: "button",
        tabindex: "0",
        onclick: () => api.select(d.key),
        onkeydown: (e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === row) {
            e.preventDefault();
            api.select(d.key);
          }
        },
      },
      h("span", { class: "oc-cx-title" }, L.draft),
      h(
        "span",
        { class: "oc-cx-acts" },
        h("button", {
          class: "oc-cx-btn",
          title: L.close,
          "aria-label": L.close,
          html: icon("x", 14),
          onclick: (e) => {
            e.stopPropagation();
            api.closeTab(d.key);
          },
        }),
      ),
    );
    return row;
  };

  const projectMenu = (g, anchor, row) => {
    const pinned = state.pins.projects.includes(g.key);
    openMenu(
      anchor,
      [
        { label: L.newChat, icon: "edit", onClick: () => api.newSession(g.srv, g.worktree) },
        { label: pinned ? L.unpinProject : L.pinProject, icon: "pin", onClick: () => togglePin(state.pins.projects, g.key) },
        api.canEdit ? { label: L.editProject, icon: "gear", onClick: () => api.editProject(g.srv, g.worktree) } : null,
        {
          label: L.copyPath,
          icon: "folder",
          onClick: () => {
            try {
              navigator.clipboard?.writeText(g.worktree);
            } catch {}
          },
        },
      ].filter(Boolean),
      row,
    );
  };

  const projectBlock = (g, model, multi) => {
    const collapsed = !!state.ui.collapsed[g.key];
    const pinned = state.pins.projects.includes(g.key);
    const row = h("div", {
      class: "oc-cx-row oc-cx-proj",
      role: "button",
      tabindex: "0",
      "aria-expanded": String(!collapsed),
      onclick: () => {
        state.ui.collapsed[g.key] = !collapsed;
        saveUi();
        hideCard();
        render();
      },
      onkeydown: (e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === row) {
          e.preventDefault();
          row.click();
        }
      },
      oncontextmenu: (e) => {
        e.preventDefault();
        projectMenu(g, row, row);
      },
      onmouseenter: () => {
        clearTimeout(state.cardHide);
        if (state.popup) return;
        clearTimeout(state.cardTimer);
        state.cardTimer = setTimeout(() => showCard(g, row), 380);
      },
      onmouseleave: () => {
        clearTimeout(state.cardTimer);
        state.cardHide = setTimeout(hideCard, 160);
      },
    });
    const dots = h("button", {
      class: "oc-cx-btn",
      title: L.moreOptions,
      "aria-label": L.moreOptions,
      html: icon("dots", 15),
      onclick: (e) => {
        e.stopPropagation();
        projectMenu(g, dots, row);
      },
    });
    row.append(
      h("span", { class: "oc-cx-ico", html: icon(collapsed ? "folder" : "folderOpen", 17) }),
      h("span", { class: "oc-cx-name" }, g.name),
      multi ? h("span", { class: "oc-cx-srv" }, g.srvName) : null,
      pinned ? h("span", { class: "oc-cx-pinmark", html: icon("pin", 12, "filled") }) : null,
      h(
        "span",
        { class: "oc-cx-acts" },
        dots,
        h("button", {
          class: "oc-cx-btn",
          title: L.newChat,
          "aria-label": L.newChat,
          html: icon("edit", 15),
          onclick: (e) => {
            e.stopPropagation();
            api.newSession(g.srv, g.worktree);
          },
        }),
      ),
    );
    const frag = [row];
    if (collapsed) return frag;
    const visible = g.sessions.filter((s) => !model.pinnedKeys.has(s.key));
    const expanded = !!state.ui.expanded[g.key];
    const shown = expanded ? visible : visible.slice(0, SESSION_PREVIEW);
    for (const d of g.drafts) frag.push(draftRow(d));
    for (const s of shown) frag.push(sessionRow(s, false));
    if (g.sessions.length === 0 && g.drafts.length === 0) frag.push(h("div", { class: "oc-cx-empty" }, L.noChats));
    if (visible.length > SESSION_PREVIEW) {
      frag.push(
        h(
          "div",
          {
            class: "oc-cx-row oc-cx-more",
            role: "button",
            tabindex: "0",
            onclick: () => {
              state.ui.expanded[g.key] = !expanded;
              saveUi();
              render();
            },
          },
          expanded ? L.less : L.more(visible.length - SESSION_PREVIEW),
        ),
      );
    }
    return frag;
  };

  function render() {
    if (!state.snap) return;
    hideCard();
    const scroll = host.scrollTop;
    const model = buildModel(state.snap);
    const multi = state.snap.multi;
    const nodes = [];
    if (model.pinnedSessions.length) {
      nodes.push(h("div", { class: "oc-cx-label is-static" }, L.pinned));
      for (const s of model.pinnedSessions) nodes.push(sessionRow(s, true));
    }
    nodes.push(
      h(
        "div",
        {
          class: "oc-cx-label" + (state.ui.projectsCollapsed ? " is-collapsed" : ""),
          role: "button",
          tabindex: "0",
          onclick: () => {
            state.ui.projectsCollapsed = !state.ui.projectsCollapsed;
            saveUi();
            render();
          },
        },
        L.projects,
        h("span", { class: "oc-cx-chev", html: icon("chevron", 14) }),
      ),
    );
    if (!state.ui.projectsCollapsed) {
      if (!model.projs.length) nodes.push(h("div", { class: "oc-cx-empty" }, L.noProjects));
      for (const g of model.projs) nodes.push(...projectBlock(g, model, multi));
    }
    host.replaceChildren(...nodes);
    host.scrollTop = scroll;
  }

  let polling = false;
  async function poll(force) {
    if (polling && !force) return;
    polling = true;
    try {
      let snap;
      try {
        snap = api.snapshot();
      } catch {
        return;
      }
      const hash = JSON.stringify(snap);
      if (hash === state.hash && !force) return;
      state.hash = hash;
      state.snap = snap;
      if (state.renaming) return;
      render();
    } finally {
      polling = false;
    }
  }

  const refresh = async () => {
    try {
      await api.refresh();
    } catch {}
    poll(true);
  };

  window.addEventListener("storage", (e) => {
    if (e.key !== LS_PINS) return;
    const p = loadJson(LS_PINS, {});
    state.pins.projects = Array.isArray(p.projects) ? p.projects : [];
    state.pins.sessions = Array.isArray(p.sessions) ? p.sessions : [];
    render();
  });

  let lastRefresh = 0;
  const maybeRefresh = () => {
    if (Date.now() - lastRefresh < 5000) return;
    lastRefresh = Date.now();
    refresh();
  };
  window.addEventListener("focus", maybeRefresh);
  document.addEventListener("visibilitychange", () => !document.hidden && maybeRefresh());

  let seen = false;
  let missing = 0;
  let tick = 0;
  const timer = setInterval(() => {
    if (host.isConnected) {
      seen = true;
      missing = 0;
    } else if (seen && ++missing > 20) {
      clearInterval(timer);
      closePopup();
      hideCard();
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onKey, true);
      return;
    }
    if (document.hidden) return;
    poll();
    if (++tick % 100 === 0) maybeRefresh();
  }, 600);

  lastRefresh = Date.now();
  poll(true);
  refresh();
}

/**
 * Host adapter. `deps` are raw handles captured by the hook in the main bundle:
 *   servers   - servers context (jz())      tabsStore - tabs store (FR())
 *   tabs      - reactive tab array          current   - () => current tab
 *   tabKey    - tab -> key fn (jR)          serverKey - server -> key fn (Q.key)
 *   settings  - settings controller (zU())  locale    - () => locale string
 */
export function mount(host, deps) {
  const rawSessions = new Map();
  const removed = new Set();
  const srvOf = new Map();

  const serverList = () => {
    try {
      return deps.servers.servers.list() || [];
    } catch {
      return [];
    }
  };
  const ctxOf = (key) => {
    const sv = srvOf.get(key) || serverList().find((x) => deps.serverKey(x) === key);
    if (!sv) return null;
    srvOf.set(key, sv);
    try {
      return deps.servers.ensureServerCtx(sv);
    } catch {
      return null;
    }
  };
  const srvName = (sv, key) => {
    try {
      return sv.displayName || new URL(sv.http.url).host;
    } catch {
      return key;
    }
  };
  const toRow = (ctx, raw) => {
    const data = ctx.data;
    let loading = false;
    let unread = false;
    try {
      loading = data.session
        .list()
        .some(
          (n) =>
            data.session.root(n.id) === raw.id &&
            (data.session.status(n.id) === "running" || data.session.pending.list(n.id).some((x) => x.type !== "synthetic")),
        );
    } catch {}
    try {
      unread = !!ctx.notification.session.unread(raw.id);
    } catch {}
    return {
      id: raw.id,
      title: raw.title || "",
      worktree: raw.location?.directory || "",
      updated: raw.time?.updated ?? raw.time?.created ?? 0,
      loading,
      unread,
    };
  };

  const snapshot = () => {
    const list = serverList();
    const servers = [];
    for (const sv of list) {
      const key = deps.serverKey(sv);
      srvOf.set(key, sv);
      const ctx = ctxOf(key);
      if (!ctx) continue;
      let projects = [];
      try {
        projects = (ctx.projects.list() || []).map((p) => ({ worktree: p.worktree, name: p.name, sandboxes: p.sandboxes }));
      } catch {}
      const merged = new Map();
      for (const [id, raw] of rawSessions) if (id.startsWith(key + "\u0000")) merged.set(id.slice(key.length + 1), raw);
      try {
        for (const s of ctx.data.session.list() || []) merged.set(s.id, s);
      } catch {}
      const sessions = [];
      for (const raw of merged.values()) {
        if (raw.parentID || typeof raw.time?.archived === "number" || removed.has(sessKey(key, raw.id))) continue;
        sessions.push(toRow(ctx, raw));
      }
      const known = new Set(projects.flatMap((p) => [p.worktree, ...(p.sandboxes || [])].map(norm)));
      for (const s of sessions) {
        const dir = norm(s.worktree);
        if (dir && !known.has(dir)) {
          known.add(dir);
          projects.push({ worktree: s.worktree, name: "", sandboxes: [] });
        }
      }
      servers.push({ key, name: srvName(sv, key), projects, sessions });
    }
    const tabs = deps.tabs;
    const cur = deps.current?.();
    const curKey = cur ? deps.tabKey(cur) : "";
    const drafts = [];
    for (const t of tabs) {
      if (t.type !== "draft") continue;
      const k = deps.tabKey(t);
      drafts.push({ key: k, server: t.server, directory: t.directory || "", active: k === curKey });
    }
    return {
      servers,
      drafts,
      multi: list.length > 1,
      current: cur && cur.type === "session" ? { server: cur.server, sessionId: cur.sessionId } : null,
    };
  };

  const refresh = async () => {
    await Promise.allSettled(
      serverList().map(async (sv) => {
        const key = deps.serverKey(sv);
        const ctx = ctxOf(key);
        if (!ctx || ctx.sdk.connection.status() !== "connected") return;
        let cursor;
        for (let page = 0; page < 5; page++) {
          const res = await ctx.sdk.api.session.list({ limit: 200, order: "desc", parentID: null, ...(cursor ? { cursor } : {}) });
          for (const s of res.data) rawSessions.set(sessKey(key, s.id), s);
          cursor = res.cursor?.next;
          if (res.data.length < 200 || !cursor) break;
        }
      }),
    );
  };

  const findTab = (key) => deps.tabs.find((t) => deps.tabKey(t) === key);

  const api = {
    canEdit: !!deps.settings?.openProject,
    snapshot,
    refresh,
    editProject: (srv, worktree) => deps.settings.openProject({ server: srv, project: worktree }),
    select: (key) => {
      const t = findTab(key);
      if (t) deps.tabsStore.select(t);
    },
    closeTab: (key) => {
      const i = deps.tabs.findIndex((t) => deps.tabKey(t) === key);
      if (i !== -1) deps.tabsStore.closeTab(i);
    },
    openSession: (srv, id, worktree) => {
      const ctx = ctxOf(srv);
      const raw = rawSessions.get(sessKey(srv, id)) || ctx?.data.session.get(id);
      try {
        ctx?.data.session.message.sync(id).catch(() => {});
        if (raw) ctx?.data.session.remember(raw);
        ctx?.projects.open(worktree);
        ctx?.projects.touch(worktree);
      } catch {}
      const t = deps.tabsStore.addSessionTab({ server: srv, sessionId: id });
      deps.tabsStore.select(t);
    },
    newSession: (srv, worktree) => {
      const ctx = ctxOf(srv);
      try {
        ctx?.projects.open(worktree);
        ctx?.projects.touch(worktree);
      } catch {}
      deps.tabsStore.newDraft({ server: srv, directory: worktree }, "");
    },
    rename: async (srv, id, title) => {
      const ctx = ctxOf(srv);
      if (!ctx) return;
      const cur = rawSessions.get(sessKey(srv, id)) || ctx.data.session.get(id);
      await ctx.sdk.api.session.update({ sessionID: id, title });
      if (cur) {
        const next = { ...cur, title };
        rawSessions.set(sessKey(srv, id), next);
        ctx.data.session.remember(next);
      }
    },
    remove: async (srv, id) => {
      const ctx = ctxOf(srv);
      if (!ctx) return;
      await ctx.sdk.api.session.remove({ sessionID: id });
      removed.add(sessKey(srv, id));
      rawSessions.delete(sessKey(srv, id));
      const i = deps.tabs.findIndex((t) => t.type === "session" && t.server === srv && t.sessionId === id);
      if (i !== -1) deps.tabsStore.closeTab(i);
      try {
        ctx.data.session.invalidate?.(id);
      } catch {}
    },
  };

  try {
    setLocale(deps.locale?.());
  } catch {
    setLocale();
  }
  mountUi(host, api);
}
