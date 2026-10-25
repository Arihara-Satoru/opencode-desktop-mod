/**
 * Chat Width Controller for OpenCode Desktop
 * Allows users to freely adjust the chat message container and composer width
 * via interactive drag rails with double-click preset switching.
 */

const LS_KEY = "oc-chat-width.v1";
const DEFAULT_WIDTH = 744; // OpenCode's default container-session width
const MIN_WIDTH = 560; // Minimum readable width
const TIMELINE_GUTTER = 36; // Left gutter to clear the timeline scrubber ticks

export const PRESETS = [
  { id: "default", label: "标准 744", width: 744, isFull: false },
  { id: "cozy", label: "舒适 960", width: 960, isFull: false },
  { id: "wide", label: "宽屏 1200", width: 1200, isFull: false },
  { id: "ultrawide", label: "超宽 1440", width: 1440, isFull: false },
  { id: "full", label: "铺满 100%", width: null, isFull: true },
];

export function createWidthManager(storage = (typeof localStorage !== "undefined" ? localStorage : null)) {
  let state = {
    width: DEFAULT_WIDTH,
    isFull: false,
    syncComposer: true,
  };

  function load() {
    if (!storage) return;
    try {
      const raw = storage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.width === "number" && !isNaN(parsed.width)) {
          state.width = Math.max(MIN_WIDTH, Math.min(3840, Math.round(parsed.width)));
        }
        state.isFull = Boolean(parsed.isFull);
        if (typeof parsed.syncComposer === "boolean") {
          state.syncComposer = parsed.syncComposer;
        }
      }
    } catch {}
  }

  function save() {
    if (!storage) return;
    try {
      storage.setItem(LS_KEY, JSON.stringify(state));
    } catch {}
  }

  function setWidth(newWidth, saveAfter = true) {
    state.isFull = false;
    state.width = Math.max(MIN_WIDTH, Math.min(3840, Math.round(newWidth)));
    if (saveAfter) save();
  }

  function setFull(isFull, saveAfter = true) {
    state.isFull = Boolean(isFull);
    if (saveAfter) save();
  }

  function setSyncComposer(sync, saveAfter = true) {
    state.syncComposer = Boolean(sync);
    if (saveAfter) save();
  }

  function reset() {
    state.width = DEFAULT_WIDTH;
    state.isFull = false;
    state.syncComposer = true;
    save();
  }

  function cyclePreset() {
    if (state.isFull) {
      state.isFull = false;
      state.width = DEFAULT_WIDTH;
    } else if (state.width === DEFAULT_WIDTH) {
      state.width = 1200;
      state.isFull = false;
    } else if (state.width === 1200) {
      state.isFull = true;
    } else {
      state.isFull = false;
      state.width = DEFAULT_WIDTH;
    }
    save();
    return { ...state };
  }

  load();
  return {
    get state() { return { ...state }; },
    load,
    save,
    setWidth,
    setFull,
    setSyncComposer,
    reset,
    cyclePreset,
  };
}

const STYLE_ID = "oc-chat-width-style";

// Both the rail rectangle and the resulting position use viewport coordinates.
export function getWidthIndicatorPosition(railRect, pointerY, side, size, viewport) {
  const gap = 12;
  const margin = 8;
  const railX = railRect.left + railRect.width / 2;
  const before = railX - gap - size.width;
  const after = railX + gap;
  let left = side === "left" ? before : after;
  if (left < margin) left = after;
  if (left + size.width > viewport.width - margin) left = before;
  return {
    left: Math.max(margin, Math.min(left, viewport.width - size.width - margin)),
    top: Math.max(margin, Math.min(pointerY - size.height - gap, viewport.height - size.height - margin)),
  };
}

const CSS_CONTENT = `
/* Smooth transition when switching width presets */
html.oc-width-transitioning {
  --container-session-transition: max-width 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
html.oc-width-transitioning .md\\:max-w-session,
html.oc-width-transitioning [data-component="session-composer-dock"] > div {
  transition: var(--container-session-transition) !important;
}

/* Ensure markdown tables have horizontal scrolling if content overflows */
[data-slot="session-turn-message-content"] table,
[data-slot="session-turn-assistant-content"] table {
  display: block !important;
  max-width: 100% !important;
  overflow-x: auto !important;
  scrollbar-width: thin !important;
}

/* Drag Rails container */
.oc-width-drag-container {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 25;
  overflow: visible;
}

/* Vertical Drag Rails on both left & right edges */
.oc-width-rail {
  position: absolute;
  top: 56px;
  bottom: 84px;
  width: 18px;
  margin-left: -9px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  pointer-events: auto;
  user-select: none;
  opacity: 0;
  transition: opacity 0.16s ease;
  touch-action: none;
}
.oc-width-rail:hover,
body.oc-width-dragging .oc-width-rail,
.oc-width-rail.is-active {
  opacity: 1;
}

/* Subtle line indicator inside the rail */
.oc-width-rail-bar {
  width: 3px;
  height: calc(100% - 40px);
  border-radius: 999px;
  background: var(--v2-border-border-strong, rgba(120, 120, 128, 0.32));
  transition: background-color 0.15s ease, transform 0.15s ease, width 0.15s ease, box-shadow 0.15s ease;
}
.oc-width-rail:hover .oc-width-rail-bar {
  background: var(--v2-icon-icon-muted, #71717a);
  width: 3.5px;
  transform: scaleY(1.02);
}
body.oc-width-dragging .oc-width-rail .oc-width-rail-bar,
.oc-width-rail.is-active .oc-width-rail-bar {
  background: var(--v2-icon-icon-accent, #0a84ff) !important;
  width: 4px;
  box-shadow: 0 0 10px rgba(10, 132, 255, 0.5);
}

/* Center grip indicator */
.oc-width-rail-grip {
  position: absolute;
  width: 6px;
  height: 24px;
  border-radius: 999px;
  background: var(--v2-icon-icon-muted, #71717a);
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
  pointer-events: none;
}
.oc-width-rail:hover .oc-width-rail-grip {
  opacity: 0.8;
}
body.oc-width-dragging .oc-width-rail .oc-width-rail-grip {
  opacity: 1;
  background: var(--v2-icon-icon-accent, #0a84ff);
  transform: scale(1.1);
}

/* Floating indicator while dragging */
.oc-width-indicator {
  position: fixed;
  box-sizing: border-box;
  z-index: 99999;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--v2-background-bg-base, #1c1c1e);
  color: var(--v2-text-text-base, #ffffff);
  border: 1px solid var(--v2-border-border-base, rgba(128, 128, 128, 0.25));
  font-family: var(--v2-font-family-mono, monospace);
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.24);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.1s ease;
  white-space: nowrap;
}
.oc-width-indicator.is-visible {
  opacity: 1;
}

/* Toast Badge */
.oc-width-toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%) translateY(10px);
  z-index: 99999;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--v2-background-bg-base, rgba(24, 24, 27, 0.92));
  color: var(--v2-text-text-base, #ffffff);
  border: 1px solid var(--v2-border-border-base, rgba(120, 120, 128, 0.25));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  font-family: var(--v2-font-family-sans, system-ui, sans-serif);
  font-size: 12px;
  font-weight: 500;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.oc-width-toast.is-show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
`;

function injectStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS_CONTENT;
  document.head.append(style);
}

export function showWidthToast(msg) {
  if (typeof document === "undefined") return;
  let toast = document.querySelector(".oc-width-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "oc-width-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("is-show");
  clearTimeout(toast.__timer);
  toast.__timer = setTimeout(() => {
    toast.classList.remove("is-show");
  }, 1400);
}

export function initChatWidth() {
  if (typeof window === "undefined" || window.__ocChatWidthMounted) return;
  window.__ocChatWidthMounted = true;

  const manager = createWidthManager();
  injectStyle();

  function apply(animate = false) {
    const root = document.documentElement;
    if (animate) {
      root.classList.add("oc-width-transitioning");
      clearTimeout(apply.__animTimer);
      apply.__animTimer = setTimeout(() => {
        root.classList.remove("oc-width-transitioning");
      }, 250);
    }

    if (manager.state.isFull) {
      root.style.setProperty("--container-session", "calc(100% - 72px)");
    } else {
      root.style.setProperty("--container-session", `min(calc(100% - 72px), ${manager.state.width}px)`);
    }

    if (!manager.state.syncComposer) {
      root.setAttribute("data-oc-composer-fixed", "true");
      root.style.setProperty("--oc-composer-override-width", `${DEFAULT_WIDTH}px`);
    } else {
      root.removeAttribute("data-oc-composer-fixed");
      root.style.removeProperty("--oc-composer-override-width");
    }

    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
      window.__oc_virtual_scroll?.be?.();
      window.__oc_virtual_scroll?.M?._willUpdate?.();
    });
  }

  // Initial apply
  apply(false);

  // Drag Rail mounting & management
  let dragContainer = null;
  let activeIndicator = null;
  let leftRail = null;
  let rightRail = null;
  let chatPanel = null;
  let resizeObserver = null;

  function ensureDragRails() {
    const panel = document.querySelector('[data-slot="session-chat-panel"]');
    if (!panel) return;
    if (panel === chatPanel && dragContainer?.isConnected) {
      updateRailPositions();
      return;
    }

    chatPanel = panel;
    dragContainer?.remove();
    activeIndicator?.remove();
    resizeObserver?.disconnect();

    dragContainer = document.createElement("div");
    dragContainer.className = "oc-width-drag-container";

    leftRail = document.createElement("div");
    leftRail.className = "oc-width-rail oc-width-rail-left";
    leftRail.setAttribute("title", "按住拖拽调节宽度 (双击切换预设)");
    leftRail.innerHTML = '<div class="oc-width-rail-bar"></div><div class="oc-width-rail-grip"></div>';

    rightRail = document.createElement("div");
    rightRail.className = "oc-width-rail oc-width-rail-right";
    rightRail.setAttribute("title", "按住拖拽调节宽度 (双击切换预设)");
    rightRail.innerHTML = '<div class="oc-width-rail-bar"></div><div class="oc-width-rail-grip"></div>';

    activeIndicator = document.createElement("div");
    activeIndicator.className = "oc-width-indicator";

    // Keep fixed-position feedback outside transformed/contained session panels.
    document.body.appendChild(activeIndicator);
    dragContainer.append(leftRail, rightRail);
    chatPanel.appendChild(dragContainer);

    bindRailEvents(leftRail, "left");
    bindRailEvents(rightRail, "right");
    updateRailPositions();

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        updateRailPositions();
      });
      resizeObserver.observe(panel);
    }
  }

  function updateRailPositions() {
    if (!chatPanel || !leftRail || !rightRail) return;
    const panelRect = chatPanel.getBoundingClientRect();
    if (panelRect.width <= 0) return;

    const availableWidth = Math.max(MIN_WIDTH, panelRect.width - 72);
    const currentWidth = manager.state.isFull ? availableWidth : Math.min(availableWidth, manager.state.width);

    const minLeftOffset = TIMELINE_GUTTER;
    const leftOffset = Math.max(minLeftOffset, Math.round((panelRect.width - currentWidth) / 2));
    const rightOffset = Math.min(panelRect.width - 12, Math.round(leftOffset + currentWidth));

    leftRail.style.left = `${leftOffset}px`;
    rightRail.style.left = `${rightOffset}px`;
  }

  function bindRailEvents(rail, side) {
    rail.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      rail.setPointerCapture(e.pointerId);
      document.body.classList.add("oc-width-dragging");
      rail.classList.add("is-active");

      const panelRect = chatPanel.getBoundingClientRect();
      const centerX = panelRect.left + panelRect.width / 2;
      const maxAvailable = Math.floor(panelRect.width - 72);

      const indicator = activeIndicator;
      function positionIndicator(pointerY) {
        indicator.textContent = manager.state.isFull ? "铺满 (100%)" : `${manager.state.width} px`;
        const position = getWidthIndicatorPosition(
          rail.getBoundingClientRect(), pointerY, side,
          { width: indicator.offsetWidth, height: indicator.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
        );
        indicator.style.left = `${position.left}px`;
        indicator.style.top = `${position.top}px`;
      }
      positionIndicator(e.clientY);
      indicator.classList.add("is-visible");

      function onPointerMove(ev) {
        const dist = Math.abs(ev.clientX - centerX);
        let targetWidth = Math.round(dist * 2);

        if (targetWidth >= maxAvailable - 30) {
          manager.setFull(true, false);
        } else {
          manager.setWidth(Math.max(MIN_WIDTH, Math.min(maxAvailable, targetWidth)), false);
        }

        apply(false);
        updateRailPositions();

        positionIndicator(ev.clientY);
      }

      function onPointerUp(ev) {
        rail.releasePointerCapture(ev.pointerId);
        rail.removeEventListener("pointermove", onPointerMove);
        rail.removeEventListener("pointerup", onPointerUp);
        rail.removeEventListener("pointercancel", onPointerUp);

        document.body.classList.remove("oc-width-dragging");
        rail.classList.remove("is-active");
        indicator.classList.remove("is-visible");

        manager.save();
      }

      rail.addEventListener("pointermove", onPointerMove);
      rail.addEventListener("pointerup", onPointerUp);
      rail.addEventListener("pointercancel", onPointerUp);
    });

    rail.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = manager.cyclePreset();
      apply(true);
      updateRailPositions();
      showWidthToast(next.isFull ? "正文宽度：铺满 100%" : `正文宽度：${next.width} px`);
    });
  }

  // Periodic DOM scanner & MutationObserver
  let scheduled = false;
  function scan() {
    scheduled = false;
    ensureDragRails();
  }

  const observer = new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(scan);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  scan();

  window.addEventListener("resize", () => {
    updateRailPositions();
  });

  // Expose on window for external triggers or debugging
  window.__oc_chat_width = {
    manager,
    apply,
    updateRailPositions,
  };
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initChatWidth, { once: true });
  } else {
    initChatWidth();
  }
}
