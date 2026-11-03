import { history as fetchHistory } from "../api.js";
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
  imgTag,
  isLoginError,
  reactionFor,
  timeAgo,
} from "../utils.js";

function rowHtml(item) {
  const bvid = String(item.bvid || "");
  const progress = Math.max(0, Number(item.progress) || 0);
  const start = progress > 5 ? Math.floor(progress) : 0;
  const href = `#/video/${encodeURIComponent(bvid)}${start ? `?t=${start}` : ""}`;
  const percent = reactionFor(progress, item.duration);
  const videos = Number(item.videos) || 1;
  return `<article class="history-row">
    <a class="history-thumb" href="${href}" aria-label="${escapeAttr(item.title)}">
      ${imgTag(item.cover, { w: 360, h: 202, alt: item.title })}
      ${item.duration ? `<span class="duration">${escapeHtml(formatDuration(item.duration))}</span>` : ""}
      ${progress > 0 ? `<span class="watched-bar"><i style="width:${percent.toFixed(2)}%"></i></span>` : ""}
    </a>
    <div class="history-body">
      <a class="history-title" href="${href}">${escapeHtml(item.title || "无标题")}</a>
      <div class="history-meta">
        <span>${icon("user", 13)}<a href="#/space/${Number(item.author_mid) || 0}">${escapeHtml(
    item.author || "未知 UP 主"
  )}</a></span>
        <span>${icon("clock", 13)}${escapeHtml(timeAgo(item.view_at))}</span>
        ${
          progress > 0
            ? `<span class="history-progress-text">看到 ${escapeHtml(
                formatDuration(progress)
              )}</span>`
            : ""
        }
        ${videos > 1 ? `<span>共 ${videos}P</span>` : ""}
      </div>
    </div>
    <div class="history-actions">
      <a class="btn btn-sm btn-soft" href="${href}">${icon("play", 14)}继续观看</a>
    </div>
  </article>`;
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
      )}刷新</button>`,
    })}
    <div class="history-list" data-history-list>${skeletonRows(6)}</div>
    <div data-history-more></div>`;

  let disposed = false;
  let loader = null;
  let loaded = 0;
  let lastDay = "";
  let cursorMax = 0;
  let cursorViewAt = 0;

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

  const updateSubtitle = () => {
    if (subtitle) {
      subtitle.textContent = loaded
        ? `最近观看的 ${loaded} 条记录，按时间倒序排列。`
        : "观看过的视频会出现在这里。";
    }
  };

  const append = (items) => {
    if (!items.length) return;
    let html = "";
    items.forEach((item) => {
      const key = dayKey(item.view_at);
      if (key !== lastDay) {
        lastDay = key;
        html += `<div class="history-day">${escapeHtml(dayLabel(item.view_at))}</div>`;
      }
      html += rowHtml(item);
    });
    list.insertAdjacentHTML("beforeend", html);
    loaded += items.length;
    updateSubtitle();
  };

  try {
    const data = await fetchHistory(0, 0);
    if (disposed || ctx.signal.aborted) return cleanup;
    cursorMax = Number(data.max) || 0;
    cursorViewAt = Number(data.view_at) || 0;
    list.innerHTML = "";
    if (!data.items.length) {
      list.innerHTML = emptyState(
        "还没有观看记录",
        "去首页发现一些有趣的视频吧。",
        `<a class="btn btn-primary" href="#/home">${icon("home", 15)}去首页逛逛</a>`,
        "history"
      );
      updateSubtitle();
      return cleanup;
    }
    append(data.items);
    if (data.has_more) {
      loader = createInfiniteLoader(more, async () => {
        const next = await fetchHistory(cursorMax, cursorViewAt);
        if (disposed) return false;
        cursorMax = Number(next.max) || cursorMax;
        cursorViewAt = Number(next.view_at) || cursorViewAt;
        append(next.items || []);
        return Boolean(next.has_more) && next.items.length > 0;
      });
    }
  } catch (error) {
    if (disposed || ctx.signal.aborted) return cleanup;
    if (isLoginError(error)) {
      list.innerHTML = loginRequiredHTML("登录状态已失效，请重新扫码登录。");
      if (subtitle) subtitle.textContent = "需要重新登录";
    } else {
      list.innerHTML = errorState(error);
      list.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
      if (subtitle) subtitle.textContent = `加载失败：${errorText(error)}`;
    }
  }

  return cleanup;
}
