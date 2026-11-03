import { history as fetchHistory, historyClear } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import {
  createInfiniteLoader,
  emptyState,
  errorState,
  loginRequiredHTML,
  pageHead,
  skeletonRows,
} from "../ui.js";
import {
  dayKey,
  dayLabel,
  errorText,
  escapeAttr,
  escapeHtml,
  formatDuration,
  formatCount,
  imgTag,
  isLoginError,
  reactionFor,
  timeAgo,
} from "../utils.js";

const TABS = [
  { id: "all", label: "综合" },
  { id: "archive", label: "视频" },
  { id: "live", label: "直播" },
  { id: "article", label: "专栏" },
];

function hiddenKids() {
  try {
    return new Set(store.get("historyHidden") || []);
  } catch (_) {
    return new Set();
  }
}

function hideKid(kid) {
  try {
    const set = new Set(store.get("historyHidden") || []);
    set.add(String(kid));
    store.set("historyHidden", [...set]);
  } catch (_) {
    /* ignore */
  }
}

/** 直播 → #/live/<roomid>，专栏 → 外链 cv 文章，视频 → #/video/<bvid>。 */
function itemHref(item) {
  const business = String(item.business || "archive");
  if (business === "live") {
    return `#/live/${Number(item.aid) || 0}`;
  }
  const bvid = String(item.bvid || "");
  if (!bvid) return "";
  const start = Math.max(0, Number(item.progress) || 0);
  return `#/video/${encodeURIComponent(bvid)}${start > 5 ? `?t=${Math.floor(start)}` : ""}`;
}

function articleUrl(item) {
  return `https://www.bilibili.com/read/cv${Number(item.aid) || 0}`;
}

function rowHtml(item) {
  const business = String(item.business || "archive");
  const href = itemHref(item);
  const progress = Math.max(0, Number(item.progress) || 0);
  const percent = reactionFor(progress, item.duration);
  const videos = Number(item.videos) || 1;
  const isLive = business === "live";
  const isArticle = business === "article";
  const liveOn = Number(item.live_status) === 1;
  const titleLink = isArticle
    ? `<a class="history-title" href="${escapeAttr(articleUrl(item))}" data-external>${escapeHtml(item.title || "无标题")}</a>`
    : href
      ? `<a class="history-title" href="${href}">${escapeHtml(item.title || "无标题")}</a>`
      : `<span class="history-title">${escapeHtml(item.title || "无标题")}</span>`;
  const badge = isLive
    ? `<span class="history-badge ${liveOn ? "is-on" : ""}">${liveOn ? "直播中" : "直播"}</span>`
    : isArticle
      ? `<span class="history-badge">专栏</span>`
      : "";
  const action = isArticle
    ? `<a class="btn btn-sm btn-soft" href="${escapeAttr(articleUrl(item))}" data-external>${icon("external-link", 14)}阅读</a>`
    : isLive
      ? `<a class="btn btn-sm btn-soft" href="${href}">${icon("radio", 14)}进入直播间</a>`
      : `<a class="btn btn-sm btn-soft" href="${href}">${icon("play", 14)}继续观看</a>`;
  return `<article class="history-row" data-kid="${Number(item.kid) || 0}">
    <a class="history-thumb" href="${isArticle ? escapeAttr(articleUrl(item)) : escapeAttr(href)}" ${isArticle ? 'data-external' : ""} aria-label="${escapeAttr(item.title)}">
      ${imgTag(item.cover, { w: 360, h: 202, alt: item.title })}
      ${!isLive && item.duration ? `<span class="duration">${escapeHtml(formatDuration(item.duration))}</span>` : ""}
      ${!isLive && progress > 0 ? `<span class="watched-bar"><i style="width:${percent.toFixed(2)}%"></i></span>` : ""}
    </a>
    <div class="history-body">
      ${titleLink}
      <div class="history-meta">
        <span>${icon("user", 13)}<a href="#/space/${Number(item.author_mid) || 0}">${escapeHtml(item.author || "未知 UP 主")}</a></span>
        <span>${icon("clock", 13)}${escapeHtml(timeAgo(item.view_at))}</span>
        ${badge}
        ${!isLive && progress > 0 ? `<span class="history-progress-text">看到 ${escapeHtml(formatDuration(progress))}</span>` : ""}
        ${!isLive && !isArticle && videos > 1 ? `<span>共 ${videos}P</span>` : ""}
      </div>
    </div>
    <div class="history-actions">
      ${action}
      <button class="btn btn-sm btn-ghost history-delete" type="button" data-del-kid="${Number(item.kid) || 0}" title="从列表中移除">${icon("trash", 14)}</button>
    </div>
  </article>`;
}

function tabsHtml(active) {
  return `<div class="history-tabs" role="tablist">${TABS.map(
    (t) =>
      `<button class="history-tab${t.id === active ? " is-active" : ""}" type="button" role="tab" data-history-tab="${t.id}">${t.label}</button>`
  ).join("")}</div>`;
}

export async function render(root, ctx) {
  const onAuth = () => ctx.refresh();
  window.addEventListener("app:auth", onAuth);

  if (!store.isLoggedIn()) {
    root.innerHTML = `
      ${pageHead({
        title: "历史记录",
        subtitle: "登录后可查看完整观看记录并跨设备同步。",
      })}
      ${loginRequiredHTML("登录后即可同步历史记录，继续上次的观看进度。")}`;
    return () => window.removeEventListener("app:auth", onAuth);
  }

  root.innerHTML = `
    ${pageHead({
      title: "历史记录",
      subtitle: "正在读取观看记录…",
      actions: `<button class="btn btn-sm btn-outline" type="button" data-refresh>${icon(
        "refresh-cw",
        14
      )}刷新</button>
      <button class="btn btn-sm btn-outline danger" type="button" data-clear-history>${icon(
        "trash-2",
        14
      )}清空历史</button>`,
    })}
    ${tabsHtml("all")}
    <div class="history-list" data-history-list>${skeletonRows(6)}</div>
    <div data-history-more></div>`;

  let disposed = false;
  let loader = null;
  let loaded = 0;
  let lastDay = "";
  let cursorMax = 0;
  let cursorViewAt = 0;
  let tab = "all";

  const list = root.querySelector("[data-history-list]");
  const more = root.querySelector("[data-history-more]");
  const subtitle = root.querySelector(".page-subtitle");

  const cleanup = () => {
    disposed = true;
    loader?.remove();
    loader = null;
    window.removeEventListener("app:auth", onAuth);
  };

  root.querySelector("[data-refresh]")?.addEventListener("click", () => ctx.refresh());

  root.querySelector("[data-clear-history]")?.addEventListener("click", async () => {
    if (!window.confirm("确定要清空全部历史记录吗？此操作会删除 B 站账号内的所有观看历史，且不可恢复。")) {
      return;
    }
    try {
      await historyClear();
      hideAll();
      list.innerHTML = emptyState(
        "历史记录已清空",
        "全部观看记录已删除。",
        `<a class="btn btn-primary" href="#/home">${icon("home", 15)}去首页逛逛</a>`,
        "history"
      );
      loader?.remove();
      loader = null;
      loaded = 0;
      updateSubtitle();
    } catch (error) {
      if (!disposed) window.alert(`清空失败：${errorText(error)}`);
    }
  });

  /** 清空后把当前列表里所有 kid 记进隐藏集合，界面立即变空。 */
  const hideAll = () => {
    const kids = new Set(store.get("historyHidden") || []);
    list.querySelectorAll(".history-row[data-kid]").forEach((row) => {
      const kid = row.getAttribute("data-kid");
      if (kid && kid !== "0") kids.add(kid);
    });
    store.set("historyHidden", [...kids]);
  };

  root.querySelector("[data-history-tabs], .history-tabs")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-history-tab]");
    if (!btn || btn.dataset.historyTab === tab) return;
    tab = btn.dataset.historyTab;
    root.querySelectorAll("[data-history-tab]").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.historyTab === tab);
    });
    restart();
  });

  list.addEventListener("click", (event) => {
    const del = event.target.closest("[data-del-kid]");
    if (!del) return;
    const kid = del.getAttribute("data-del-kid");
    const row = del.closest(".history-row");
    if (kid && kid !== "0") hideKid(kid);
    row?.remove();
    loaded = Math.max(0, loaded - 1);
    if (!list.querySelector(".history-row")) {
      list.innerHTML = emptyState(
        "暂无记录",
        "这个分类下暂时没有观看记录。",
        "",
        "history"
      );
    }
    updateSubtitle();
  });

  const updateSubtitle = () => {
    if (!subtitle) return;
    const label = TABS.find((t) => t.id === tab)?.label || "综合";
    subtitle.textContent = loaded
      ? `${label} · 最近观看的 ${formatCount(loaded)} 条记录，按时间倒序排列。`
      : "观看过的内容会出现在这里。";
  };

  const append = (items) => {
    const hidden = hiddenKids();
    const visible = items.filter((it) => !hidden.has(String(it.kid)));
    if (!visible.length) return;
    let html = "";
    visible.forEach((item) => {
      const key = dayKey(item.view_at);
      if (key !== lastDay) {
        lastDay = key;
        html += `<div class="history-day">${escapeHtml(dayLabel(item.view_at))}</div>`;
      }
      html += rowHtml(item);
    });
    list.insertAdjacentHTML("beforeend", html);
    loaded += visible.length;
    updateSubtitle();
  };

  async function loadFirst() {
    const data = await fetchHistory(0, 0, tab);
    if (disposed || ctx.signal.aborted) return;
    cursorMax = Number(data.max) || 0;
    cursorViewAt = Number(data.view_at) || 0;
    list.innerHTML = "";
    if (!data.items.length) {
      list.innerHTML = emptyState(
        "还没有观看记录",
        "去首页发现一些有趣的内容吧。",
        `<a class="btn btn-primary" href="#/home">${icon("home", 15)}去首页逛逛</a>`,
        "history"
      );
      updateSubtitle();
      return;
    }
    append(data.items);
    if (data.has_more) {
      loader = createInfiniteLoader(more, async () => {
        const next = await fetchHistory(cursorMax, cursorViewAt, tab);
        if (disposed) return false;
        cursorMax = Number(next.max) || cursorMax;
        cursorViewAt = Number(next.view_at) || cursorViewAt;
        append(next.items || []);
        return Boolean(next.has_more) && next.items.length > 0;
      });
    }
  }

  function restart() {
    disposed && cleanup();
    loader?.remove();
    loader = null;
    loaded = 0;
    lastDay = "";
    cursorMax = 0;
    cursorViewAt = 0;
    list.innerHTML = skeletonRows(6);
    loadFirst().catch((error) => {
      if (disposed || ctx.signal.aborted) return;
      if (isLoginError(error)) {
        list.innerHTML = loginRequiredHTML("登录状态已失效，请重新扫码登录。");
        if (subtitle) subtitle.textContent = "需要重新登录";
      } else {
        list.innerHTML = errorState(error);
        list.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
        if (subtitle) subtitle.textContent = `加载失败：${errorText(error)}`;
      }
    });
  }

  restart();

  return cleanup;
}
