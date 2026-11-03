/**
 * 消息中心 —— 回复我的 / @我的 / 收到的赞 / 系统消息。
 *
 * 回复、@、赞三类都有分页列表；系统消息接口未开放，
 * 只展示未读计数并给一个跳转 B 站消息中心的入口。
 */

import { msgFeed, msgUnread, openExternal } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import {
  createInfiniteLoader,
  emptyState,
  errorState,
  loginRequiredHTML,
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

const TABS = [
  { key: "reply", label: "回复我的", iconName: "message-square" },
  { key: "at", label: "提到我的", iconName: "at-sign" },
  { key: "like", label: "收到的赞", iconName: "heart" },
  { key: "sys", label: "系统消息", iconName: "bell" },
];

const KIND_LABEL = {
  reply: "回复了你",
  at: "提到了你",
  like: "赞了你",
  sys: "系统通知",
};

function normalizeTab(value) {
  return TABS.some((item) => item.key === value) ? value : "reply";
}

function unreadOf(unread, tab) {
  if (!unread) return 0;
  if (tab === "at") return Number(unread.at) || 0;
  if (tab === "like") return Number(unread.like) || 0;
  if (tab === "sys") return Number(unread.sys_msg) || 0;
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

function itemHref(item) {
  const uri = String(item.uri || "");
  if (uri.startsWith("bilibili://")) return "";
  if (/^https?:\/\//i.test(uri)) return uri;
  return "";
}

function messageCard(item) {
  const href = itemHref(item);
  const title = String(item.title || "").trim();
  const content = String(item.content || "").trim();
  const users = usersHtml(item.users);
  const count = Number(item.count) || 0;
  const meta = `<div class="msg-meta">
      <span class="msg-kind">${icon(
        item.kind === "like" ? "heart" : item.kind === "at" ? "at-sign" : "message-square",
        12
      )}${escapeHtml(KIND_LABEL[item.kind] || "消息")}</span>
      ${item.business ? `<span class="msg-business">${escapeHtml(item.business)}</span>` : ""}
      ${item.time ? `<span>${escapeHtml(timeAgo(item.time))}</span>` : ""}
      ${count > 1 ? `<span>${formatCount(count)} 条</span>` : ""}
    </div>`;
  const inner = `${users}
    ${title ? `<div class="msg-title">${escapeHtml(title)}</div>` : ""}
    ${content ? `<div class="msg-content">${escapeHtml(content)}</div>` : ""}
    ${meta}
    ${
      item.image
        ? `<div class="msg-image">${imgTag(item.image, { w: 240, h: 140, alt: "" })}</div>`
        : ""
    }`;
  if (href) {
    return `<a class="msg-card" href="${escapeAttr(href)}" data-external>${inner}</a>`;
  }
  return `<article class="msg-card">${inner}</article>`;
}

async function renderList(root, ctx, tab, body) {
  let cursorId = 0;
  let cursorTime = 0;
  let disposed = false;
  let loader = null;

  const append = (items) => {
    if (!items.length) return;
    body.insertAdjacentHTML("beforeend", items.map(messageCard).join(""));
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

function renderSystem(body, unread) {
  const count = Number(unread?.sys_msg) || 0;
  body.innerHTML = emptyState(
    count > 0 ? `有 ${count} 条未读系统消息` : "暂时没有系统消息",
    "B 站的系统消息接口未对外开放，这里只同步未读计数，点下面的按钮去网页版查看。",
    `<button class="btn btn-primary" type="button" data-open-msg-center>${icon(
      "external-link",
      15
    )}打开 B 站消息中心</button>`,
    "bell"
  );
  return () => {};
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

  root.innerHTML = `<div class="page-head">
      <div>
        <h1 class="page-title">消息</h1>
        <p class="page-subtitle" data-msg-sub>正在读取未读消息…</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-outline" type="button" data-refresh>
          ${icon("refresh-cw", 14)}刷新
        </button>
      </div>
    </div>
    ${tabsHtml(tab, null)}
    <div class="msg-body" data-msg-body>${skeletonRows(5)}</div>`;

  const body = root.querySelector("[data-msg-body]");
  const sub = root.querySelector("[data-msg-sub]");
  const tabsHolder = root.querySelector(".msg-tabs");

  root.querySelector("[data-refresh]")?.addEventListener("click", () => ctx.refresh());

  root.addEventListener("click", async (event) => {
    if (!event.target.closest("[data-open-msg-center]")) return;
    const ok = await openExternal("https://message.bilibili.com/");
    if (!ok) toast("无法打开浏览器", "error");
  });

  // 外链消息用系统浏览器打开
  body.addEventListener("click", async (event) => {
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

  const cleanup =
    tab === "sys"
      ? renderSystem(body, unread)
      : await renderList(root, ctx, tab, body);

  return () => {
    detachAuth();
    if (typeof cleanup === "function") cleanup();
  };
}
