/**
 * 动态 —— 关注的 UP 主动态流（需要登录）。
 *
 * 后端把 B 站的动态结构拍平成 kind + archive/live/orig，
 * 这里只负责排版：正文、图文、视频卡片、直播卡片、转发。
 */

import { dynamicFeed, openExternal } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import {
  createInfiniteLoader,
  emptyState,
  errorState,
  loginRequiredHTML,
  openImageViewer,
  skeletonRows,
  toast,
} from "../ui.js";
import {
  avatarTag,
  escapeAttr,
  escapeHtml,
  formatCount,
  imgTag,
  timeAgo,
} from "../utils.js";

function authorHtml(item, { compact = false } = {}) {
  const mid = Number(item.author_mid) || 0;
  const name = String(item.author_name || "未知用户");
  const time = item.pub_time || timeAgo(item.pub_ts);
  const avatar = avatarTag(item.author_face, name, `avatar ${compact ? "avatar-xs" : "avatar-sm"}`);
  const inner = `${avatar}
    <div class="dyn-author-main">
      <span class="dyn-author-name">${escapeHtml(name)}</span>
      <span class="dyn-author-time">${escapeHtml(time)}</span>
    </div>`;
  return mid
    ? `<a class="dyn-author" href="#/space/${mid}">${inner}</a>`
    : `<div class="dyn-author">${inner}</div>`;
}

function archiveHtml(archive, { compact = false, external = "" } = {}) {
  if (!archive || !archive.title) return "";
  const bvid = String(archive.bvid || "");
  const cover = `<div class="dyn-archive-cover">
      ${imgTag(archive.cover, { w: 320, h: compact ? 180 : 200, alt: archive.title })}
      ${archive.duration ? `<span class="duration">${escapeHtml(archive.duration)}</span>` : ""}
    </div>
    <div class="dyn-archive-body">
      <div class="dyn-archive-title">${escapeHtml(archive.title)}</div>
      <div class="dyn-archive-meta">
        ${icon("play", 12)}${formatCount(archive.play)}
        ${archive.danmaku ? `${icon("message-square", 12)}${formatCount(archive.danmaku)}` : ""}
      </div>
    </div>`;
  if (bvid) {
    return `<a class="dyn-archive" href="#/video/${encodeURIComponent(bvid)}">${cover}</a>`;
  }
  // 番剧类没有 bvid，只能跳到 B 站页面
  if (external) {
    return `<button type="button" class="dyn-archive" data-open-url="${escapeAttr(
      external
    )}">${cover}</button>`;
  }
  return `<div class="dyn-archive">${cover}</div>`;
}

function liveHtml(live) {
  if (!live) return "";
  const roomId = Number(live.room_id) || 0;
  if (!roomId) return "";
  return `<a class="dyn-live" href="#/live/${roomId}">
    <div class="dyn-live-cover">${imgTag(live.cover, { w: 320, h: 180, alt: live.title })}
      <span class="live-card-badge"><i class="live-dot"></i>直播中</span>
    </div>
    <div class="dyn-live-body">
      <div class="dyn-live-title">${escapeHtml(live.title || "直播间")}</div>
      <div class="dyn-live-meta">
        ${live.area_name ? `<span>${escapeHtml(live.area_name)}</span>` : ""}
        ${live.uname ? `<span>${escapeHtml(live.uname)}</span>` : ""}
        <span>${icon("eye", 12)}${formatCount(live.online)}</span>
      </div>
    </div>
  </a>`;
}

function picsHtml(pics) {
  const list = (pics || []).filter(Boolean).slice(0, 9);
  if (!list.length) return "";
  const cols = list.length === 1 ? 1 : list.length === 2 || list.length === 4 ? 2 : 3;
  return `<div class="dyn-pics" data-cols="${cols}">
    ${list
      .map(
        (url) =>
          `<button type="button" class="dyn-pic" data-view-image="${escapeAttr(url)}">${imgTag(
            url,
            { w: 320, h: 320, alt: "" }
          )}</button>`
      )
      .join("")}
  </div>`;
}

function bodyHtml(item, { forward = false } = {}) {
  const text = String(item.text || "").trim();
  const parts = [];
  if (text) parts.push(`<p class="dyn-text">${escapeHtml(text)}</p>`);
  if (item.kind === "live") parts.push(liveHtml(item.live));
  else if (item.archive) parts.push(archiveHtml(item.archive, { compact: forward, external: item.jump_url }));
  else if (item.pics?.length) parts.push(picsHtml(item.pics));
  if (item.jump_url && item.kind === "opus") {
    parts.push(
      `<button type="button" class="dyn-more" data-open-url="${escapeAttr(
        item.jump_url
      )}">查看全文${icon("external-link", 12)}</button>`
    );
  }
  return parts.join("");
}

function forwardHtml(orig) {
  if (!orig) return "";
  return `<div class="dyn-forward">
    ${authorHtml(orig, { compact: true })}
    ${bodyHtml(orig, { forward: true })}
  </div>`;
}

function cardHtml(item) {
  const stats = `<div class="dyn-stats">
      <span>${icon("repeat-2", 13)}${formatCount(item.forward)}</span>
      <span>${icon("message-square", 13)}${formatCount(item.comment)}</span>
      <span>${icon("thumbs-up", 13)}${formatCount(item.like)}</span>
    </div>`;
  return `<article class="dyn-card" data-dyn-id="${escapeAttr(item.id)}">
    ${authorHtml(item)}
    ${bodyHtml(item)}
    ${forwardHtml(item.orig)}
    ${stats}
  </article>`;
}

export async function render(root, ctx) {
  const onAuth = () => ctx.refresh();
  window.addEventListener("app:auth", onAuth);
  const detachAuth = () => window.removeEventListener("app:auth", onAuth);

  if (!store.isLoggedIn()) {
    root.innerHTML = loginRequiredHTML("登录后即可查看关注的 UP 主动态。");
    return detachAuth;
  }

  root.innerHTML = `<div class="dyn-toolbar">
      <span class="rec-hint">按关注时间排序，下拉自动加载更多</span>
    </div>
    <div class="dyn-list" data-dyn-list>${skeletonRows(5)}</div>`;

  const list = root.querySelector("[data-dyn-list]");

  // 图片查看与“查看全文”都以事件委托处理，动态插入的卡片也能用
  const onClick = async (event) => {
    const pic = event.target.closest("[data-view-image]");
    if (pic) {
      event.preventDefault();
      openImageViewer(pic.dataset.viewImage, "");
      return;
    }
    const opener = event.target.closest("[data-open-url]");
    if (opener) {
      event.preventDefault();
      const ok = await openExternal(opener.dataset.openUrl);
      if (!ok) toast("无法打开浏览器", "error");
    }
  };
  list.addEventListener("click", onClick);

  let disposed = false;
  let offset = "";
  let loader = null;
  let count = 0;

  const append = (items) => {
    if (!items.length) return;
    list.insertAdjacentHTML("beforeend", items.map(cardHtml).join(""));
    count += items.length;
  };

  const loadMore = async () => {
    if (disposed) return false;
    const data = await dynamicFeed("all", offset);
    if (disposed || ctx.signal.aborted) return false;
    offset = String(data.offset || "");
    append(data.items || []);
    return Boolean(data.has_more) && Boolean(offset);
  };

  try {
    const data = await dynamicFeed("all", "");
    if (disposed || ctx.signal.aborted) return () => {};
    offset = String(data.offset || "");
    const items = data.items || [];
    list.innerHTML = "";
    if (!items.length) {
      list.innerHTML = emptyState(
        "还没有动态",
        "关注一些 UP 主后，这里会出现他们的最新动态。",
        `<a class="btn btn-primary" href="#/recommend">去推荐看看</a>`,
        "at-sign"
      );
    } else {
      append(items);
      if (data.has_more && offset) loader = createInfiniteLoader(list, loadMore);
    }
  } catch (error) {
    if (disposed || ctx.signal.aborted) return () => {};
    list.innerHTML = errorState(error);
    list.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
  }

  return () => {
    disposed = true;
    loader?.remove();
    loader = null;
    detachAuth();
  };
}
