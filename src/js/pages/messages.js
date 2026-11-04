/**
 * 消息中心 —— 回复我的 / @我的 / 收到的赞。
 */

import {
  msgFeed,
  msgUnread,
  openExternal,
  openWebWindow,
  videoDetail,
} from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import {
  createInfiniteLoader,
  emptyState,
  errorState,
  loginRequiredHTML,
  skeletonRows,
  toast,
  useRefreshFab,
} from "../ui.js";
import {
  avatarTag,
  escapeAttr,
  escapeHtml,
  formatCount,
  imgTag,
  timeAgo,
} from "../utils.js";

const TABS = [
  { key: "reply", label: "回复我的", iconName: "message-square" },
  { key: "at", label: "提到我的", iconName: "at-sign" },
  { key: "like", label: "收到的赞", iconName: "heart" },
];

const KIND_LABEL = {
  reply: "回复了你",
  at: "提到了你",
  like: "赞了你",
};

function normalizeTab(value) {
  return TABS.some((item) => item.key === value) ? value : "reply";
}

function unreadOf(unread, tab) {
  if (!unread) return 0;
  if (tab === "at") return Number(unread.at) || 0;
  if (tab === "like") return Number(unread.like) || 0;
  return Number(unread.reply) || 0;
}

function tabsHtml(tab, unread) {
  return `<div class="tabs-line msg-tabs">${TABS.map((item) => {
    const badge = unreadOf(unread, item.key);
    return `<a class="tab${item.key === tab ? " active" : ""}" href="#/messages?tab=${
      item.key
    }">${icon(item.iconName, 14)}${escapeHtml(item.label)}${
      badge > 0 ? `<b class="msg-badge">${badge > 99 ? "99+" : badge}</b>` : ""
    }</a>`;
  }).join("")}</div>`;
}

function usersHtml(users) {
  const list = (users || []).filter(Boolean).slice(0, 4);
  if (!list.length) return "";
  return `<div class="msg-users">${list
    .map(
      (user) => `<a class="msg-user" href="#/space/${Number(user.mid) || 0}" title="${escapeAttr(
        user.name || ""
      )}">
        ${avatarTag(user.face, user.name || "", "avatar avatar-xs")}
        <span>${escapeHtml(user.name || "用户")}</span>
      </a>`
    )
    .join("")}</div>`;
}

/** 从 uri 里抠出 BV 号，能站内跳转就不用开浏览器。 */
function bvidOf(uri) {
  const match = String(uri || "").match(/\/(BV[0-9A-Za-z]{10})/);
  return match ? match[1] : "";
}

function dynamicPageOf(uri) {
  const raw = String(uri || "");
  if (/t\.bilibili\.com\/\d+/i.test(raw)) return raw;
  if (/\/opus\/\d+/i.test(raw)) return raw;
  const match = raw.match(/bilibili:\/\/dynamic\/(\d+)/i);
  return match ? `https://t.bilibili.com/${match[1]}` : "";
}

function itemHref(item) {
  const uri = String(item.uri || "");
  if (uri.startsWith("bilibili://")) return "";
  if (/^https?:\/\//i.test(uri)) return uri;
  return "";
}

/** 原视频条目：标题 + BV 号，封面按 BV 号懒加载。 */
const coverCache = new Map();
let coverObserver = null;

function ensureCoverObserver() {
  if (coverObserver || typeof IntersectionObserver === "undefined") return coverObserver;
  coverObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const node = entry.target;
        coverObserver.unobserve(node);
        const bvid = node.dataset.msgCover || "";
        if (!bvid) return;
        const cached = coverCache.get(bvid);
        if (cached) {
          applyCover(node, cached);
          return;
        }
        videoDetail(bvid)
          .then((info) => {
            const cover = String(info?.cover || "");
            if (!cover) return;
            coverCache.set(bvid, cover);
            if (node.isConnected) applyCover(node, cover);
          })
          .catch(() => {});
      });
    },
    { rootMargin: "200px" }
  );
  return coverObserver;
}

function applyCover(node, url) {
  if (!node?.isConnected) return;
  const span = document.createElement("span");
  span.className = "msg-source-cover";
  span.innerHTML = imgTag(url, { w: 120, h: 68, alt: "" });
  node.replaceWith(span);
}

function hydrateCovers(container) {
  const observer = ensureCoverObserver();
  if (!observer) return;
  container.querySelectorAll("[data-msg-cover]").forEach((node) => {
    if (node.dataset.coverObserved === "1") return;
    node.dataset.coverObserved = "1";
    observer.observe(node);
  });
}

function sourceHtml(item) {
  const title = String(item.title || "").trim();
  if (!title) return "";
  const bvid = bvidOf(item.uri);
  const dynamicPage = dynamicPageOf(item.uri);
  if (dynamicPage) {
    const inner = `<span class="msg-source-icon">${icon("activity", 18)}</span>
      <span class="msg-source-body">
        <span class="msg-source-title">${escapeHtml(title)}</span>
        <span class="msg-source-sub">动态</span>
      </span>
      <span class="msg-source-go">${icon("chevron-right", 14)}</span>`;
    return `<button class="msg-source" type="button" data-open-web="${escapeAttr(
      dynamicPage
    )}">${inner}</button>`;
  }
  const business = String(item.business || "").trim() || "视频";
  const cover = String(item.cover || "").trim();
  const leading = cover
    ? `<span class="msg-source-cover">${imgTag(cover, { w: 120, h: 68, alt: "" })}</span>`
    : bvid
    ? `<span class="msg-source-icon" data-msg-cover="${escapeAttr(bvid)}">${icon(
        "play-circle",
        18
      )}</span>`
    : `<span class="msg-source-icon">${icon("play-circle", 18)}</span>`;
  const inner = `${leading}
    <span class="msg-source-body">
      <span class="msg-source-title">${escapeHtml(title)}</span>
      <span class="msg-source-sub">${escapeHtml(business)}${
    bvid ? ` · ${escapeHtml(bvid)}` : ""
  }</span>
    </span>
    <span class="msg-source-go">${icon("chevron-right", 14)}</span>`;
  if (bvid) {
    return `<a class="msg-source" href="#/video/${encodeURIComponent(bvid)}">${inner}</a>`;
  }
  const external = itemHref(item);
  if (external) {
    return `<a class="msg-source" href="${escapeAttr(external)}" data-external>${inner}</a>`;
  }
  return `<div class="msg-source">${inner}</div>`;
}

function messageCard(item) {
  const title = String(item.title || "").trim();
  const content = String(item.content || "").trim();
  const users = usersHtml(item.users);
  const count = Number(item.count) || 0;
  const image = String(item.image || "").trim();
  const cover = String(item.cover || "").trim();
  // 回复正文常常与视频标题重复，重复时正文不再单独占一行
  const showContent = content && content !== title;
  const showImage = image && image !== cover;
  const meta = `<div class="msg-meta">
      <span class="msg-kind">${icon(
        item.kind === "like" ? "heart" : item.kind === "at" ? "at-sign" : "message-square",
        12
      )}${escapeHtml(KIND_LABEL[item.kind] || "消息")}</span>
      ${item.business ? `<span class="msg-business">${escapeHtml(item.business)}</span>` : ""}
      ${item.time ? `<span>${escapeHtml(timeAgo(item.time))}</span>` : ""}
      ${count > 1 ? `<span>${formatCount(count)} 条</span>` : ""}
    </div>`;
  // 卡片本身不放整块链接：跳转交给里面的原视频条目，避免误点整张卡片
  return `<article class="msg-card">${users}${
    showContent ? `<div class="msg-content">${escapeHtml(content)}</div>` : ""
  }${sourceHtml(item)}${
    showImage ? `<div class="msg-image">${imgTag(image, { w: 240, h: 140, alt: "" })}</div>` : ""
  }${meta}</article>`;
}

async function renderList(root, ctx, tab, body) {
  let cursorId = 0;
  let cursorTime = 0;
  let disposed = false;
  let loader = null;

  const append = (items) => {
    if (!items.length) return;
    body.insertAdjacentHTML("beforeend", items.map(messageCard).join(""));
    hydrateCovers(body);
  };

  const loadMore = async () => {
    if (disposed) return false;
    const data = await msgFeed(tab, cursorId, cursorTime);
    if (disposed || ctx.signal.aborted) return false;
    cursorId = Number(data.cursor_id) || 0;
    cursorTime = Number(data.cursor_time) || 0;
    append(data.items || []);
    return Boolean(data.has_more) && cursorId > 0 && cursorTime > 0;
  };

  try {
    const data = await msgFeed(tab, 0, 0);
    if (disposed || ctx.signal.aborted) return () => {};
    cursorId = Number(data.cursor_id) || 0;
    cursorTime = Number(data.cursor_time) || 0;
    const items = data.items || [];
    body.innerHTML = "";
    if (!items.length) {
      body.innerHTML = emptyState(
        "暂时没有这一类消息",
        "有新消息时会出现在这里，也可以在 B 站消息中心查看全部。",
        `<button class="btn btn-outline" type="button" data-open-msg-center>${icon(
          "external-link",
          15
        )}打开 B 站消息中心</button>`,
        tab === "like" ? "heart" : tab === "at" ? "at-sign" : "message-square"
      );
    } else {
      append(items);
      if (data.has_more && cursorId > 0) loader = createInfiniteLoader(body, loadMore);
    }
  } catch (error) {
    if (disposed || ctx.signal.aborted) return () => {};
    body.innerHTML = errorState(error);
    body.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
  }

  return () => {
    disposed = true;
    loader?.remove();
    loader = null;
  };
}

export async function render(root, ctx) {
  const onAuth = () => ctx.refresh();
  window.addEventListener("app:auth", onAuth);
  const detachAuth = () => window.removeEventListener("app:auth", onAuth);

  if (!store.isLoggedIn()) {
    root.innerHTML = loginRequiredHTML("登录后即可查看回复、@ 与点赞消息。");
    return detachAuth;
  }

  const tab = normalizeTab(ctx.query.get("tab"));

  const stopRefreshFab = useRefreshFab(() => ctx.refresh());

  root.innerHTML = `<div class="page-head">
      <div>
        <h1 class="page-title">消息</h1>
        <p class="page-subtitle" data-msg-sub>正在读取未读消息…</p>
      </div>
    </div>
    ${tabsHtml(tab, null)}
    <div class="msg-body" data-msg-body>${skeletonRows(5)}</div>`;

  const body = root.querySelector("[data-msg-body]");
  const sub = root.querySelector("[data-msg-sub]");
  const tabsHolder = root.querySelector(".msg-tabs");

  root.addEventListener("click", async (event) => {
    if (!event.target.closest("[data-open-msg-center]")) return;
    const ok = await openExternal("https://message.bilibili.com/");
    if (!ok) toast("无法打开浏览器", "error");
  });

  // 外链消息用系统浏览器打开
  body.addEventListener("click", async (event) => {
    const dynamic = event.target.closest("[data-open-web]");
    if (dynamic) {
      event.preventDefault();
      try {
        await openWebWindow(dynamic.dataset.openWeb || "", "动态");
      } catch (error) {
        toast(errorText(error), "error");
      }
      return;
    }
    const link = event.target.closest("[data-external]");
    if (!link) return;
    event.preventDefault();
    const ok = await openExternal(link.getAttribute("href") || "");
    if (!ok) toast("无法打开浏览器", "error");
  });

  let unread = null;
  try {
    unread = await msgUnread();
    if (ctx.signal.aborted) return detachAuth;
  } catch (_) {
    unread = null;
  }

  if (ctx.signal.aborted) return detachAuth;

  if (sub) {
    const total = Number(unread?.total) || 0;
    sub.textContent = total > 0 ? `共 ${total} 条未读消息。` : "暂无未读消息。";
  }
  if (tabsHolder) tabsHolder.outerHTML = tabsHtml(tab, unread);

  const cleanup = await renderList(root, ctx, tab, body);

  return () => {
    detachAuth();
    stopRefreshFab();
    if (typeof cleanup === "function") cleanup();
  };
}
