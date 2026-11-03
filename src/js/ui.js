/** UI primitives: toasts, modals, cards, skeletons, empty/error states. */

import { icon } from "./icons.js";
import {
  escapeHtml,
  escapeAttr,
  formatCount,
  formatDuration,
  formatDate,
  timeAgo,
  imgTag,
  avatarTag,
  reactionFor,
  errorText,
} from "./utils.js";

export { avatarTag };

// ---------------- Toasts ----------------

const TOAST_ICONS = {
  success: "check-circle",
  error: "alert-circle",
  warning: "alert-triangle",
  info: "info",
};

export function toast(message, type = "info", duration = 3200) {
  const root = document.getElementById("toast-root");
  if (!root) return () => {};
  const text = String(message || "").trim();
  if (!text) return () => {};
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(TOAST_ICONS[type] || "info", 16)}<div>${escapeHtml(text)}</div>`;
  root.append(el);
  while (root.children.length > 4) root.firstElementChild?.remove();

  let timer = 0;
  const remove = () => {
    clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 220);
  };
  timer = setTimeout(remove, duration);
  el.addEventListener("click", remove);
  return remove;
}

// ---------------- Modal ----------------

const modalStack = [];
let modalSeq = 0;
let modalKeyBound = false;

function bindModalKeys() {
  if (modalKeyBound) return;
  modalKeyBound = true;
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !modalStack.length) return;
      const top = modalStack[modalStack.length - 1];
      if (top.closable) {
        event.stopPropagation();
        top.close();
      }
    },
    true
  );
}

export function openModal({
  title = "",
  body = "",
  footer = "",
  className = "",
  wide = false,
  small = false,
  closable = true,
  onClose = null,
} = {}) {
  const root = document.getElementById("modal-root");
  if (!root) throw new Error("modal root missing");

  const id = `modal_${++modalSeq}`;
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.dataset.modalId = id;
  const size = wide ? " wide" : small ? " small" : "";
  wrap.innerHTML = `
    <section class="modal${size} ${escapeAttr(className)}" role="dialog" aria-modal="true" aria-label="${escapeAttr(
    title || "对话框"
  )}">
      <div class="modal-head">
        <h3>${escapeHtml(title)}</h3>
        ${
          closable
            ? `<button class="icon-btn" data-modal-close title="关闭" aria-label="关闭">${icon("x", 18)}</button>`
            : ""
        }
      </div>
      <div class="modal-body"></div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ""}
    </section>`;
  const bodyEl = wrap.querySelector(".modal-body");
  if (body instanceof Node) bodyEl.append(body);
  else bodyEl.innerHTML = body;

  root.append(wrap);
  requestAnimationFrame(() => wrap.classList.add("show"));

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    const at = modalStack.indexOf(handle);
    if (at >= 0) modalStack.splice(at, 1);
    wrap.classList.remove("show");
    setTimeout(() => {
      wrap.remove();
      if (!modalStack.length) root.classList.remove("has-modal");
    }, 190);
    if (typeof onClose === "function") onClose(result);
  };

  const handle = {
    wrap,
    body: bodyEl,
    closable,
    close,
    setFooter(html) {
      let footerEl = wrap.querySelector(".modal-footer");
      if (!footerEl) {
        footerEl = document.createElement("div");
        footerEl.className = "modal-footer";
        wrap.querySelector(".modal").append(footerEl);
      }
      footerEl.innerHTML = html;
      return footerEl;
    },
    setTitle(text) {
      const h = wrap.querySelector(".modal-head h3");
      if (h) h.textContent = text;
    },
  };

  modalStack.push(handle);
  root.classList.add("has-modal");

  wrap.querySelectorAll("[data-modal-close]").forEach((btn) => {
    btn.addEventListener("click", () => close());
  });
  wrap.addEventListener("pointerdown", (event) => {
    if (event.target === wrap && closable) close();
  });
  wrap.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [
      ...wrap.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      ),
    ].filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  bindModalKeys();
  setTimeout(() => {
    const focusable = wrap.querySelector(
      "input:not([disabled]), textarea:not([disabled]), button.btn-primary, button.btn-soft, button:not([disabled])"
    );
    focusable?.focus({ preventScroll: true });
  }, 40);

  return handle;
}

export function confirmDialog({
  title = "确认操作",
  message = "",
  okText = "确定",
  cancelText = "取消",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const modal = openModal({
      title,
      small: true,
      body: `<p style="line-height:1.7;color:var(--text-2);font-size:13.5px;white-space:pre-wrap">${escapeHtml(
        message
      )}</p>`,
      footer: `<button class="btn" data-cancel>${escapeHtml(
        cancelText
      )}</button><button class="btn ${
        danger ? "btn-danger-soft" : "btn-primary"
      }" data-ok>${escapeHtml(okText)}</button>`,
      onClose: (result) => resolve(result === true),
    });
    modal.wrap.querySelector("[data-cancel]").addEventListener("click", () => modal.close(false));
    modal.wrap.querySelector("[data-ok]").addEventListener("click", () => modal.close(true));
  });
}

export function promptDialog({
  title = "请输入",
  label = "",
  placeholder = "",
  value = "",
  okText = "确定",
  cancelText = "取消",
  maxLength = 80,
} = {}) {
  return new Promise((resolve) => {
    const modal = openModal({
      title,
      small: true,
      body: `<div class="form-group" style="margin:0">
        ${label ? `<label class="form-label">${escapeHtml(label)}</label>` : ""}
        <input class="input" data-prompt-input maxlength="${Number(maxLength) || 80}"
          placeholder="${escapeAttr(placeholder)}" value="${escapeAttr(value)}" />
      </div>`,
      footer: `<button class="btn" data-cancel>${escapeHtml(
        cancelText
      )}</button><button class="btn btn-primary" data-ok>${escapeHtml(okText)}</button>`,
      onClose: (result) => resolve(typeof result === "string" ? result : null),
    });
    const input = modal.body.querySelector("[data-prompt-input]");
    const submit = () => {
      const text = input.value.trim();
      if (!text) {
        input.focus();
        input.classList.add("shake");
        setTimeout(() => input.classList.remove("shake"), 300);
        return;
      }
      modal.close(text);
    };
    modal.wrap.querySelector("[data-cancel]").addEventListener("click", () => modal.close(null));
    modal.wrap.querySelector("[data-ok]").addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
    setTimeout(() => input.focus(), 60);
  });
}

export function openImageViewer(url, alt = "") {
  if (!url) return;
  openModal({
    title: alt || "查看图片",
    wide: true,
    body: `<div style="display:flex;justify-content:center;padding:4px 0"><img src="${escapeAttr(
      url
    )}" alt="${escapeAttr(alt)}" referrerpolicy="no-referrer" style="max-width:100%;max-height:72vh;border-radius:8px;object-fit:contain"></div>`,
  });
}

// ---------------- Cards ----------------

function durationText(value) {
  if (typeof value === "string" && value) return value;
  return formatDuration(Number(value) || 0);
}

export function videoCard(v, options = {}) {
  if (!v) return "";
  const {
    rank = 0,
    compact = false,
    showDate = false,
    remove = false,
    progress = 0,
    showStat = true,
    showDanmaku = true,
    startAt = 0,
    cardClass = "",
  } = options;
  const bvid = String(v.bvid || "");
  const start = Math.max(0, Math.floor(Number(startAt) || 0));
  const href = `#/video/${encodeURIComponent(bvid)}${start > 5 ? `?t=${start}` : ""}`;
  const author = String(v.author || v.owner?.name || "");
  const mid = Number(v.mid || v.owner?.mid || 0);
  const dur = durationText(v.duration);
  const rankHtml = rank
    ? `<span class="rank-badge${rank <= 3 ? " top" : ""}">${rank}</span>`
    : "";
  const statHtml = showStat
    ? `<div class="cover-stat">
        <span>${icon("play", 12)}${formatCount(v.play)}</span>
        ${showDanmaku ? `<span>${icon("message-square", 12)}${formatCount(v.danmaku)}</span>` : ""}
      </div>`
    : "";
  const progressHtml =
    Number(progress) > 0
      ? `<div class="video-progress"><i style="width:${Math.min(100, Number(progress)).toFixed(
          2
        )}%"></i></div>`
      : "";
  const dateHtml = showDate
    ? `<span class="dot"></span><span>${escapeHtml(formatDate(v.pubdate, false))}</span>`
    : "";
  return `<article class="video-card ${compact ? "compact" : ""} ${escapeAttr(
    cardClass
  )}" data-bvid="${escapeAttr(bvid)}" data-aid="${escapeAttr(v.aid || "")}">
    <a class="video-cover" href="${href}" aria-label="${escapeAttr(v.title)}">
      ${rankHtml}
      ${imgTag(v.cover, { w: 480, h: 270, alt: v.title })}
      ${dur ? `<span class="duration">${escapeHtml(dur)}</span>` : ""}
      ${statHtml}
      ${progressHtml}
    </a>
    <div class="video-body">
      <a class="video-title" href="${href}">${escapeHtml(v.title || "无标题")}</a>
      <div class="video-meta">
        ${
          author
            ? `<a class="author" href="#/space/${mid}" title="${escapeAttr(author)}">${escapeHtml(
                author
              )}</a>`
            : `<span class="author">未知 UP 主</span>`
        }
        ${dateHtml}
        ${
          showStat
            ? `<span class="stat">${icon("eye", 12)}${formatCount(v.play)}</span>`
            : ""
        }
      </div>
    </div>
    ${
      remove
        ? `<button class="card-remove" data-remove-aid="${escapeAttr(
            v.aid || ""
          )}" title="移除" aria-label="移除">${icon("trash", 15)}</button>`
        : ""
    }
  </article>`;
}

export function bangumiCard(b) {
  if (!b) return "";
  const id = Number(b.season_id || 0);
  const href = id ? `#/bangumi/${id}` : "#/bangumi";
  const score = String(b.score || "").trim();
  const showScore = score && score !== "0" && score !== "0.0";
  return `<a class="bangumi-card" href="${href}" aria-label="${escapeAttr(b.title || "")}">
    <div class="bangumi-cover">
      ${imgTag(b.cover, { w: 336, h: 448, alt: b.title })}
      ${b.badge ? `<span class="bangumi-badge">${escapeHtml(b.badge)}</span>` : ""}
      ${b.index_show ? `<span class="bangumi-update">${escapeHtml(b.index_show)}</span>` : ""}
      ${showScore ? `<span class="bangumi-score">${escapeHtml(score)}</span>` : ""}
    </div>
    <div class="bangumi-title" title="${escapeAttr(b.title || "")}">${escapeHtml(
    b.title || "无标题"
  )}</div>
    <div class="bangumi-sub">${escapeHtml(b.subtitle || b.index_show || b.badge || "")}</div>
  </a>`;
}

export function userCard(user) {
  if (!user) return "";
  const mid = Number(user.mid || 0);
  return `<a class="user-card" href="#/space/${mid}">
    ${avatarTag(user.avatar, user.name, "avatar avatar-lg")}
    <div class="user-card-main">
      <div class="user-card-name">
        <span>${escapeHtml(user.name || "未知用户")}</span>
        ${user.level ? `<span class="level-badge">Lv${Number(user.level)}</span>` : ""}
      </div>
      <div class="user-card-sign">${escapeHtml(user.sign || "这个人很神秘，什么都没有写")}</div>
      <div class="user-card-stats">
        <span><b>${formatCount(user.fans)}</b> 粉丝</span>
        <span><b>${formatCount(user.videos)}</b> 视频</span>
      </div>
    </div>
    <span class="btn btn-sm btn-soft">查看空间</span>
  </a>`;
}

export function tagsHtml(tags, { search = true } = {}) {
  return (tags || [])
    .filter(Boolean)
    .map((tag) =>
      search
        ? `<a class="tag" href="#/search?q=${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`
        : `<span class="tag">${escapeHtml(tag)}</span>`
    )
    .join("");
}

// ---------------- Skeletons ----------------

export function skeletonGrid(count = 12, { bangumi = false } = {}) {
  const itemClass = bangumi ? "skeleton-card skeleton-bangumi" : "skeleton-card";
  return `<div class="${bangumi ? "bangumi-grid" : "video-grid"}">
    ${Array.from({ length: count })
      .map(
        () => `<div class="${itemClass}">
          <div class="skeleton skeleton-cover"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>`
      )
      .join("")}
  </div>`;
}

export function skeletonRows(count = 6) {
  return `<div style="display:flex;flex-direction:column;gap:8px">
    ${Array.from({ length: count })
      .map(
        () => `<div class="skeleton-row">
          <div class="skeleton skeleton-thumb"></div>
          <div class="skeleton-lines">
            <div class="skeleton skeleton-line" style="width:72%"></div>
            <div class="skeleton skeleton-line short" style="width:38%"></div>
          </div>
        </div>`
      )
      .join("")}
  </div>`;
}

export function skeletonPlayer() {
  return `<div class="skeleton" style="aspect-ratio:16/9;border-radius:12px"></div>`;
}

// ---------------- States ----------------

export function stateHTML({
  iconName = "info",
  title = "",
  text = "",
  actions = "",
  className = "",
}) {
  return `<div class="state ${escapeAttr(className)}">
    <div class="state-icon">${icon(iconName, 30)}</div>
    <h3>${escapeHtml(title)}</h3>
    ${text ? `<p>${escapeHtml(text)}</p>` : ""}
    ${actions ? `<div class="state-actions">${actions}</div>` : ""}
  </div>`;
}

export function emptyState(title = "这里空空如也", text = "", actions = "", iconName = "sparkles") {
  return stateHTML({ iconName, title, text, actions });
}

export function errorState(message, { title = "加载失败", retry = true } = {}) {
  return stateHTML({
    iconName: "alert-circle",
    title,
    text: errorText(message),
    className: "error",
    actions: retry
      ? `<button class="btn btn-primary" data-retry>${icon("refresh-cw", 15)}重新加载</button>`
      : "",
  });
}

export function loginRequiredHTML(text = "登录后即可同步历史、收藏与稍后再看。") {
  return stateHTML({
    iconName: "user",
    title: "需要登录",
    text,
    className: "login",
    actions: `<button class="btn btn-primary" data-require-login>${icon(
      "qr-code",
      15
    )}扫码登录</button>`,
  });
}

export function notFoundHTML(what = "页面") {
  return stateHTML({
    iconName: "wifi-off",
    title: `${what}不存在`,
    text: "链接可能已失效，或者内容已经被删除。",
    actions: `<a class="btn btn-primary" href="#/home">返回首页</a>`,
  });
}

// ---------------- Loaders ----------------

export function setButtonLoading(button, loading, loadingText = "") {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" style="width:15px;height:15px;border-width:2px"></span>${
      loadingText ? `<span>${escapeHtml(loadingText)}</span>` : ""
    }`;
  } else {
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
    button.disabled = false;
  }
}

export function createInfiniteLoader(parent, onLoad, { rootMargin = "520px" } = {}) {
  const el = document.createElement("div");
  el.className = "infinite-loader";
  parent.append(el);

  let busy = false;
  let done = false;
  let failed = null;

  const render = () => {
    if (done) {
      el.innerHTML = '<span style="opacity:.66">已经到底啦</span>';
      return;
    }
    if (busy) {
      el.innerHTML = '<span class="spinner"></span><span>正在加载更多…</span>';
      return;
    }
    if (failed) {
      el.innerHTML = `<button class="btn btn-sm btn-outline">${icon(
        "refresh-cw",
        13
      )}加载失败，点击重试</button>`;
      return;
    }
    el.innerHTML = '<button class="btn btn-sm btn-ghost">加载更多</button>';
  };

  const run = async () => {
    if (busy || done) return false;
    if (failed && !busy) failed = null;
    busy = true;
    render();
    try {
      const more = await onLoad();
      busy = false;
      if (more === false) {
        done = true;
        io.disconnect();
      }
      render();
      return more !== false;
    } catch (error) {
      busy = false;
      failed = errorText(error);
      render();
      observerRetry();
      return false;
    }
  };

  let io = null;
  const observerRetry = () => {
    if (!io) return;
    io.disconnect();
    setTimeout(() => {
      if (!done && el.isConnected) io.observe(el);
    }, 700);
  };

  el.addEventListener("click", () => {
    if (!busy && !done) run();
  });

  if ("IntersectionObserver" in window) {
    const root = document.getElementById("main");
    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !failed) run();
      },
      { root: root && root.scrollHeight > root.clientHeight ? root : null, rootMargin }
    );
    io.observe(el);
  }

  render();

  return {
    el,
    run,
    finish() {
      done = true;
      io?.disconnect();
      render();
    },
    remove() {
      io?.disconnect();
      el.remove();
    },
  };
}

export function pageHead({ title, subtitle = "", actions = "", titleSub = "" }) {
  return `<div class="page-head">
    <div>
      <h1 class="page-title">${escapeHtml(title)}${
    titleSub ? `<span class="page-title-sub">${escapeHtml(titleSub)}</span>` : ""
  }</h1>
      ${subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : ""}
    </div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ""}
  </div>`;
}

export function sectionTitle(text, sub = "", iconName = "") {
  return `<div class="section-head">
    <h2 class="section-title">${iconName ? icon(iconName, 18) : ""}${escapeHtml(text)}${
    sub ? `<span class="muted" style="font-size:12px;font-weight:500">${escapeHtml(sub)}</span>` : ""
  }</h2>
  </div>`;
}

export function commentTime(ts) {
  return timeAgo(ts);
}

export function progressPercent(progress, duration) {
  return reactionFor(progress, duration);
}
