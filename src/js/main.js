/** Application shell: titlebar, sidebar, global search, account menu, shortcuts. */

import {
  cachedTrending,
  dynamicUplist,
  isTauri,
  msgUnread,
  openPlayerWindow,
  searchSuggest,
  showMainWindow,
} from "./api.js";
import { icon, mountIcons } from "./icons.js";
import { logoutUser, openLoginModal, refreshUser } from "./login.js";
import * as router from "./router.js";
import { store } from "./store.js";
import { confirmDialog, toast } from "./ui.js";
import {
  avatarUrl,
  debounce,
  errorText,
  escapeAttr,
  escapeHtml,
  highlight,
} from "./utils.js";

const app = document.getElementById("app");
const accountWrap = document.querySelector(".account-wrap");
const accountButton = document.getElementById("account-btn");
const accountMenu = document.getElementById("account-menu");
const accountAvatar = document.getElementById("account-avatar");
const accountName = document.getElementById("account-name");
const sidebar = document.getElementById("sidebar");
const sidebarAccount = document.getElementById("sidebar-account");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const themeToggle = document.getElementById("theme-toggle");
const searchForm = document.getElementById("global-search");
const searchInput = document.getElementById("search-input");
const searchPop = document.getElementById("search-pop");
const searchClear = document.getElementById("search-clear");
const msgButton = document.getElementById("msg-btn");
const msgDot = document.getElementById("msg-dot");
const dynButton = document.getElementById("dyn-btn");
const dynDot = document.getElementById("dyn-dot");
const mobileQuery = window.matchMedia("(max-width: 980px)");

let searchPopSeq = 0;
let searchActive = -1;

// ---------------------------------------------------------------- account UI

function avatarInner(user) {
  const url = avatarUrl(user?.face, 96);
  if (!url) return icon("user", 16);
  return `<img src="${escapeAttr(url)}" alt="" referrerpolicy="no-referrer">`;
}

function avatarBlock(user, className = "avatar avatar-lg") {
  const url = avatarUrl(user?.face, 96);
  const name = String(user?.name || "用户");
  if (url) {
    return `<img class="${escapeAttr(className)}" src="${escapeAttr(
      url
    )}" alt="${escapeAttr(name)}" referrerpolicy="no-referrer">`;
  }
  return `<span class="${escapeAttr(
    className
  )} avatar-fallback">${escapeHtml(name.slice(0, 1).toUpperCase() || "?")}</span>`;
}

function accountBadges(user) {
  return `${user?.vip_status ? '<span class="vip-badge">大会员</span>' : ""}${
    user?.level ? `<span class="level-badge">Lv${Number(user.level)}</span>` : ""
  }`;
}

function accountMenuHtml(user) {
  if (!user) {
    return `<div class="account-menu-head">
        <span class="avatar avatar-lg avatar-fallback">${icon("user", 22)}</span>
        <div>
          <div class="account-menu-name">未登录</div>
          <div class="account-menu-sub">登录后同步历史、收藏与稍后再看</div>
        </div>
      </div>
      <div style="padding:2px 2px 6px">
        <button class="btn btn-primary" type="button" data-login style="width:100%">
          ${icon("qr-code", 15)}扫码登录
        </button>
      </div>
      <a class="account-menu-item" href="#/settings">${icon("settings", 16)}设置</a>`;
  }

  const mid = Number(user.mid) || 0;
  return `<div class="account-menu-head">
      ${avatarBlock(user)}
      <div style="min-width:0">
        <div class="account-menu-name">
          <span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${escapeHtml(
            user.name || "Bilibili 用户"
          )}</span>
          ${accountBadges(user)}
        </div>
        <div class="account-menu-sub">UID ${mid} · 硬币 ${Math.round(Number(user.coin) || 0)}</div>
      </div>
    </div>
    <div class="account-menu-grid">
      <a class="account-menu-item" href="#/space/${mid}">${icon("user", 16)}个人空间</a>
      <a class="account-menu-item" href="#/history">${icon("history", 16)}历史记录</a>
      <a class="account-menu-item" href="#/favorites">${icon("star", 16)}收藏夹</a>
      <a class="account-menu-item" href="#/watchlater">${icon("clock", 16)}稍后再看</a>
    </div>
    <a class="account-menu-item" href="#/settings">${icon("settings", 16)}设置</a>
    <button class="account-menu-item danger" type="button" data-logout>
      ${icon("log-out", 16)}退出登录
    </button>`;
}

function sidebarAccountHtml(user) {
  if (!user) {
    return `<div class="side-card">
      <div class="side-card-title">登录 Bilibili</div>
      <div class="side-card-text">同步历史、收藏与稍后再看。</div>
      <button class="btn btn-primary btn-sm" type="button" data-login>
        ${icon("qr-code", 15)}<span>扫码登录</span>
      </button>
    </div>`;
  }

  const mid = Number(user.mid) || 0;
  return `<div class="side-card">
    <a class="side-user" href="#/space/${mid}" title="${escapeAttr(
    user.name || "个人空间"
  )}">
      ${avatarBlock(user, "avatar avatar-md")}
      <div style="min-width:0">
        <div class="side-user-name">${escapeHtml(user.name || "Bilibili 用户")}</div>
        <div class="side-user-sub">UID ${mid}</div>
      </div>
    </a>
  </div>`;
}

function syncAccount() {
  const user = store.user;
  if (accountAvatar) accountAvatar.innerHTML = avatarInner(user);
  if (accountName) accountName.textContent = user ? user.name || "我的账号" : "登录";
  if (accountButton) {
    accountButton.title = user ? user.name || "账号" : "登录";
    accountButton.setAttribute("aria-label", accountButton.title);
  }
  if (accountMenu) accountMenu.innerHTML = accountMenuHtml(user);
  if (sidebarAccount) sidebarAccount.innerHTML = sidebarAccountHtml(user);
  refreshUnread();
}

/** 顶栏铃铛与动态按钮的未读红点：只显示数量级别，不打断阅读。 */
let unreadSeq = 0;

function paintDot(dot, button, count, baseTitle, label) {
  if (!dot) return;
  if (count > 0) {
    dot.textContent = count > 99 ? "99+" : String(count);
    dot.classList.remove("hidden");
    if (button) button.title = `${label}（${count} 条未读）`;
  } else {
    dot.classList.add("hidden");
    if (button) button.title = baseTitle;
  }
}

async function refreshUnread() {
  if (!msgDot && !dynDot) return;
  const seq = ++unreadSeq;
  if (!store.isLoggedIn()) {
    paintDot(msgDot, msgButton, 0, "消息", "消息");
    paintDot(dynDot, dynButton, 0, "动态", "动态");
    return;
  }
  // 两路互不阻塞：消息未读数失败不该拖掉动态红点，反之亦然
  msgUnread()
    .then((unread) => {
      if (seq !== unreadSeq) return;
      paintDot(msgDot, msgButton, Number(unread?.total) || 0, "消息", "消息");
    })
    .catch(() => {
      if (seq !== unreadSeq) return;
      paintDot(msgDot, msgButton, 0, "消息", "消息");
    });
  dynamicUplist()
    .then((list) => {
      if (seq !== unreadSeq) return;
      paintDot(dynDot, dynButton, (list || []).length, "动态", "动态更新");
    })
    .catch(() => {
      if (seq !== unreadSeq) return;
      paintDot(dynDot, dynButton, 0, "动态", "动态更新");
    });
}

function openAccountMenu() {
  if (!accountMenu) return;
  accountMenu.hidden = false;
  accountButton?.classList.add("active");
  accountButton?.setAttribute("aria-expanded", "true");
}

function closeAccountMenu() {
  if (!accountMenu) return;
  accountMenu.hidden = true;
  accountButton?.classList.remove("active");
  accountButton?.setAttribute("aria-expanded", "false");
}

function toggleAccountMenu() {
  if (!accountMenu) return;
  if (accountMenu.hidden) openAccountMenu();
  else closeAccountMenu();
}

async function handleLogout() {
  closeAccountMenu();
  const ok = await confirmDialog({
    title: "退出登录",
    message: "退出后将无法同步历史、收藏与稍后再看。确定继续吗？",
    okText: "退出登录",
    danger: true,
  });
  if (!ok) return;
  try {
    await logoutUser();
    toast("已退出登录", "success");
  } catch (error) {
    toast(errorText(error), "error");
  }
}

// -------------------------------------------------------------------- theme

function resolvedTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function syncTheme() {
  const resolved = resolvedTheme();
  const holder = themeToggle?.querySelector("[data-icon]");
  if (holder) {
    holder.innerHTML = icon(resolved === "dark" ? "moon" : "sun", 20);
    holder.dataset.iconMounted = "1";
  }
  if (themeToggle) {
    const title = resolved === "dark" ? "切换到浅色主题" : "切换到深色主题";
    themeToggle.title = title;
    themeToggle.setAttribute("aria-label", title);
  }
}

function toggleTheme() {
  store.set("theme", resolvedTheme() === "dark" ? "light" : "dark");
}

// ------------------------------------------------------------------ sidebar

function isMobile() {
  return mobileQuery.matches;
}

function syncSidebarToggle() {
  if (!sidebarToggle) return;
  const mobile = isMobile();
  const collapsed = app?.classList.contains("sidebar-collapsed");
  const open = app?.classList.contains("sidebar-open");
  const title = mobile
    ? open
      ? "关闭侧边栏"
      : "打开侧边栏"
    : collapsed
    ? "展开侧边栏"
    : "收起侧边栏";
  sidebarToggle.title = title;
  sidebarToggle.setAttribute("aria-label", title);
  sidebarToggle.setAttribute("aria-expanded", String(mobile ? Boolean(open) : !collapsed));
}

function setSidebarOpen(open) {
  app?.classList.toggle("sidebar-open", open);
  if (sidebarBackdrop) sidebarBackdrop.hidden = !open;
  syncSidebarToggle();
}

function applySidebar() {
  const mobile = isMobile();
  app?.classList.toggle("sidebar-collapsed", !mobile && Boolean(store.get("sidebarCollapsed")));
  if (!mobile) setSidebarOpen(false);
  syncSidebarToggle();
}

function toggleSidebar() {
  if (isMobile()) {
    setSidebarOpen(!app?.classList.contains("sidebar-open"));
    return;
  }
  const next = !app?.classList.contains("sidebar-collapsed");
  app?.classList.toggle("sidebar-collapsed", next);
  store.set("sidebarCollapsed", next);
  syncSidebarToggle();
}

// ------------------------------------------------------------- global search

function groupHtml(title, content, action = "") {
  return `<div class="search-pop-group">
    <div class="search-pop-title"><span>${escapeHtml(title)}</span>${action}</div>
    ${content}
  </div>`;
}

function recentGroupHtml() {
  const items = store.get("recentSearches") || [];
  if (!items.length) return "";
  const rows = items
    .map(
      (word) => `<div class="search-suggestion" role="button" tabindex="0" data-keyword="${escapeAttr(
        word
      )}">
        ${icon("clock-3", 15)}
        <span>${escapeHtml(word)}</span>
        <button class="search-remove" type="button" data-remove-keyword="${escapeAttr(
          word
        )}" title="移除" aria-label="移除 ${escapeAttr(word)}">${icon("x", 12)}</button>
      </div>`
    )
    .join("");
  return groupHtml(
    "最近搜索",
    rows,
    '<button type="button" data-clear-recent>清空</button>'
  );
}

function trendingGroupHtml(words) {
  if (!Array.isArray(words) || !words.length) {
    return groupHtml(
      "热门搜索",
      '<div class="chip-row"><span class="hint">暂时没有热门搜索，直接输入关键词吧。</span></div>'
    );
  }
  return groupHtml(
    "热门搜索",
    `<div class="chip-row">${words
      .slice(0, 10)
      .map(
        (word, index) => `<button class="chip${index < 3 ? " hot" : ""}" type="button" data-keyword="${escapeAttr(
          word
        )}"><span class="chip-index">${index + 1}</span><span>${escapeHtml(word)}</span></button>`
      )
      .join("")}</div>`
  );
}

function suggestionRowsHtml(words, keyword) {
  return words
    .slice(0, 9)
    .map(
      (word) => `<button class="search-suggestion" type="button" data-keyword="${escapeAttr(
        word
      )}">
        ${icon("search", 15)}
        <span>${highlight(word, keyword)}</span>
      </button>`
    )
    .join("");
}

function searchActionRow(keyword) {
  return groupHtml(
    "搜索",
    `<button class="search-suggestion" type="button" data-search-submit>
      ${icon("search", 15)}
      <span>搜索 “${escapeHtml(keyword)}”</span>
      ${icon("corner-down-right", 15)}
    </button>`
  );
}

function loadingHint(text) {
  return `<div class="chip-row"><span class="hint"><span class="spinner" style="width:13px;height:13px;border-width:2px"></span>${escapeHtml(
    text
  )}</span></div>`;
}

function closeSearchPop() {
  searchPopSeq += 1;
  searchActive = -1;
  if (searchPop) searchPop.hidden = true;
}

function openSearchPop() {
  if (!searchPop) return;
  searchPop.hidden = false;
}

function setSearchClearVisible() {
  searchClear?.classList.toggle("hidden", !searchInput?.value);
}

async function fillSearchPop() {
  if (!searchPop || !searchInput || searchPop.hidden) return;
  const token = ++searchPopSeq;
  const keyword = searchInput.value.trim();
  searchActive = -1;

  if (!keyword) {
    searchPop.innerHTML = `${recentGroupHtml()}${groupHtml(
      "热门搜索",
      loadingHint("正在加载热门搜索…")
    )}`;
    try {
      const words = await cachedTrending();
      if (token !== searchPopSeq || searchPop.hidden || searchInput.value.trim()) return;
      searchPop.innerHTML = `${recentGroupHtml()}${trendingGroupHtml(words)}`;
    } catch (_) {
      if (token !== searchPopSeq || searchPop.hidden || searchInput.value.trim()) return;
      searchPop.innerHTML = `${recentGroupHtml()}${groupHtml(
        "热门搜索",
        '<div class="chip-row"><span class="hint">热门搜索加载失败，按 Enter 直接搜索。</span></div>'
      )}`;
    }
    return;
  }

  searchPop.innerHTML = `${searchActionRow(keyword)}${groupHtml(
    "搜索建议",
    loadingHint("正在获取搜索建议…")
  )}`;
  try {
    const words = await searchSuggest(keyword);
    if (
      token !== searchPopSeq ||
      searchPop.hidden ||
      searchInput.value.trim() !== keyword
    ) {
      return;
    }
    searchPop.innerHTML = `${searchActionRow(keyword)}${
      Array.isArray(words) && words.length
        ? groupHtml("搜索建议", suggestionRowsHtml(words, keyword))
        : groupHtml(
            "搜索建议",
            '<div class="chip-row"><span class="hint">没有更多建议，按 Enter 直接搜索。</span></div>'
          )
    }`;
  } catch (_) {
    if (
      token !== searchPopSeq ||
      searchPop.hidden ||
      searchInput.value.trim() !== keyword
    ) {
      return;
    }
    searchPop.innerHTML = `${searchActionRow(keyword)}${groupHtml(
      "搜索建议",
      '<div class="chip-row"><span class="hint">建议加载失败，按 Enter 直接搜索。</span></div>'
    )}`;
  }
}

const fillSearchPopSoon = debounce(() => fillSearchPop(), 190);

function refreshSearchPop({ immediate = false } = {}) {
  setSearchClearVisible();
  openSearchPop();
  if (immediate || !searchInput?.value.trim()) fillSearchPop();
  else fillSearchPopSoon();
}

function submitSearch(keyword) {
  const word = String(keyword ?? searchInput?.value ?? "").trim();
  if (!word) {
    searchInput?.focus();
    return;
  }
  if (searchInput) searchInput.value = word;
  setSearchClearVisible();
  store.addRecentSearch(word);
  closeSearchPop();
  searchInput?.blur();
  router.navigate(`/search?q=${encodeURIComponent(word)}`);
}

function focusSearch() {
  if (!searchInput) return;
  searchInput.focus();
  searchInput.select();
  refreshSearchPop({ immediate: true });
}

function searchItems() {
  if (!searchPop) return [];
  return [...searchPop.querySelectorAll("[data-keyword], [data-search-submit]")];
}

function moveSearchActive(delta) {
  const items = searchItems();
  if (!items.length) return;
  searchActive =
    searchActive < 0
      ? delta > 0
        ? 0
        : items.length - 1
      : (searchActive + delta + items.length) % items.length;
  items.forEach((el, index) => el.classList.toggle("active", index === searchActive));
  items[searchActive]?.scrollIntoView({ block: "nearest" });
}

function activateSearchItem(item) {
  if (!item) return;
  if (item.hasAttribute("data-search-submit")) submitSearch();
  else submitSearch(item.dataset.keyword);
}

// --------------------------------------------------------------- window API

function initWindowControls() {
  const controls = document.getElementById("window-controls");
  const tauriWindow = window.__TAURI__?.window;
  const appWindow =
    isTauri() && tauriWindow?.getCurrentWindow ? tauriWindow.getCurrentWindow() : null;
  if (!appWindow) {
    controls?.remove();
    return;
  }

  // 自绘标题栏：Tauri 2 的 data-tauri-drag-region 不继承子元素，而标题栏里
  // 全是按钮和输入框，可拖区域基本为零，这里手动调 startDragging 补上。
  const titlebar = document.getElementById("titlebar");
  const interactive = "button, a, input, textarea, select, [data-win], [data-no-drag]";
  titlebar?.addEventListener("pointerdown", async (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(interactive)) return;
    try {
      await appWindow.startDragging();
    } catch (error) {
      console.error("startDragging failed", error);
    }
  });
  titlebar?.addEventListener("dblclick", async (event) => {
    if (event.target.closest(interactive)) return;
    try {
      await appWindow.toggleMaximize();
    } catch (error) {
      console.error("toggleMaximize failed", error);
    }
  });

  controls?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-win]");
    if (!button) return;
    try {
      if (button.dataset.win === "minimize") await appWindow.minimize();
      else if (button.dataset.win === "maximize") await appWindow.toggleMaximize();
      else if (button.dataset.win === "close") await appWindow.close();
    } catch (error) {
      console.error("window action failed", error);
    }
  });
}

// ------------------------------------------------------------ player window

let playerWindowMode = false;

/** 独立播放窗口通过 ?win=player 启动，隐藏侧栏并显示「回到主界面」。 */
function applyWindowMode() {
  const params = new URLSearchParams(location.search);
  const isPlayer = params.get("win") === "player";
  playerWindowMode = isPlayer;
  document.body.classList.toggle("win-player", isPlayer);
  const back = document.getElementById("back-main");
  if (!back) return;
  if (!isPlayer) {
    back.remove();
    return;
  }
  back.addEventListener("click", async () => {
    try {
      await showMainWindow();
      const current = window.__TAURI__?.window?.getCurrentWindow;
      if (current) await current().close();
    } catch (error) {
      console.error("回到主界面失败", error);
    }
  });
}

/** 主窗口里点视频/直播间链接，改成开独立窗口（官方客户端的手感）。 */
function bindPlayerWindowLinks() {
  if (!isTauri()) return;
  document.addEventListener(
    "click",
    (event) => {
      if (playerWindowMode) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const link = event.target.closest('a[href^="#/video/"], a[href^="#/live/"]');
      if (!link) return;
      if (link.dataset.inline === "1") return;
      const raw = String(link.getAttribute("href") || "").replace(/^#/, "");
      const [pathPart, queryPart = ""] = raw.split("?");
      const segments = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
      const kind = segments[0];
      const id = segments[1];
      if (!id || (kind !== "video" && kind !== "live")) return;
      event.preventDefault();
      const title =
        link.getAttribute("aria-label") ||
        link.querySelector(".video-title, .related-title, .history-title, .live-room-title")
          ?.textContent ||
        "";
      openPlayerWindow(kind, id, String(title).trim(), queryPart).catch((error) => {
        toast(errorText(error), "error");
      });
    },
    true
  );
}

// ----------------------------------------------------------------- bindings

function bindAccount() {
  accountButton?.setAttribute("aria-haspopup", "menu");
  accountButton?.setAttribute("aria-expanded", "false");
  accountButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAccountMenu();
  });

  accountMenu?.addEventListener("click", (event) => {
    if (event.target.closest("[data-login]")) {
      closeAccountMenu();
      openLoginModal();
      return;
    }
    if (event.target.closest("[data-logout]")) {
      handleLogout();
      return;
    }
    if (event.target.closest("a[href]")) closeAccountMenu();
  });

  sidebarAccount?.addEventListener("click", (event) => {
    if (event.target.closest("[data-login]")) openLoginModal();
  });
}

function bindSearch() {
  if (!searchForm || !searchInput) return;

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitSearch();
  });

  searchInput.addEventListener("focus", () => refreshSearchPop({ immediate: true }));

  searchInput.addEventListener("input", () => {
    searchActive = -1;
    refreshSearchPop();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      if (searchPop && !searchPop.hidden) {
        event.preventDefault();
        closeSearchPop();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (searchPop && !searchPop.hidden) {
        event.preventDefault();
        moveSearchActive(event.key === "ArrowDown" ? 1 : -1);
      }
      return;
    }
    if (event.key === "Enter" && searchActive >= 0) {
      const item = searchItems()[searchActive];
      if (item) {
        event.preventDefault();
        activateSearchItem(item);
      }
    }
  });

  searchClear?.addEventListener("click", () => {
    if (!searchInput) return;
    searchInput.value = "";
    setSearchClearVisible();
    searchInput.focus();
    refreshSearchPop({ immediate: true });
  });

  searchPop?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-keyword]");
    if (remove) {
      store.removeRecentSearch(remove.dataset.removeKeyword);
      fillSearchPop();
      return;
    }

    if (event.target.closest("[data-clear-recent]")) {
      store.clearRecentSearches();
      fillSearchPop();
      return;
    }

    const submit = event.target.closest("[data-search-submit]");
    if (submit) {
      submitSearch();
      return;
    }

    const item = event.target.closest("[data-keyword]");
    if (item) submitSearch(item.dataset.keyword);
  });
}

function initShell() {
  mountIcons(document);
  syncTheme();
  syncAccount();
  applySidebar();

  bindAccount();
  bindSearch();
  initWindowControls();
  applyWindowMode();

  sidebarToggle?.addEventListener("click", toggleSidebar);
  sidebarBackdrop?.addEventListener("click", () => setSidebarOpen(false));
  themeToggle?.addEventListener("click", toggleTheme);

  document.getElementById("nav-back")?.addEventListener("click", () => history.back());
  document.getElementById("nav-forward")?.addEventListener("click", () => history.forward());

  sidebar?.addEventListener("click", (event) => {
    if (event.target.closest("a[href]") && isMobile()) setSidebarOpen(false);
  });

  document.addEventListener("pointerdown", (event) => {
    if (accountMenu && !accountMenu.hidden && !accountWrap?.contains(event.target)) {
      closeAccountMenu();
    }
    if (searchPop && !searchPop.hidden && !searchForm?.contains(event.target)) {
      closeSearchPop();
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-require-login]")) {
      event.preventDefault();
      openLoginModal();
      return;
    }
    const trigger = event.target.closest("[data-focus-search]");
    if (!trigger) return;
    event.preventDefault();
    focusSearch();
  });

  document.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
      const modalOpen = document.getElementById("modal-root")?.classList.contains("has-modal");
      if (modalOpen) return;
      event.preventDefault();
      focusSearch();
      return;
    }

    if (event.altKey && !modifier && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      const modalOpen = document.getElementById("modal-root")?.classList.contains("has-modal");
      if (modalOpen) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") history.back();
      else history.forward();
      return;
    }

    if (event.key === "Escape") {
      closeAccountMenu();
      if (searchPop && !searchPop.hidden) closeSearchPop();
      if (isMobile()) setSidebarOpen(false);
    }
  });

  window.addEventListener("app:route", (event) => {
    closeAccountMenu();
    closeSearchPop();
    if (isMobile()) setSidebarOpen(false);

    const detail = event.detail || {};
    if (detail.name === "search") {
      const q = detail.query?.get("q") || "";
      if (searchInput) searchInput.value = q;
      setSearchClearVisible();
    }
    refreshUnread();
  });

  window.addEventListener("app:auth", syncAccount);
  window.addEventListener("app:theme", syncTheme);

  store.subscribe(() => {
    applySidebar();
    syncTheme();
    setSearchClearVisible();
  });

  if (mobileQuery.addEventListener) mobileQuery.addEventListener("change", applySidebar);
  else if (mobileQuery.addListener) mobileQuery.addListener(applySidebar);
}

initShell();

router.start().catch((error) => {
  console.error("router failed to start", error);
  document.getElementById("boot")?.remove();
});

refreshUser()
  .then(() => syncAccount())
  .catch((error) => {
    // A missing or expired cookie is expected; the rest of the UI still works.
    console.warn("account refresh failed", errorText(error));
  });
