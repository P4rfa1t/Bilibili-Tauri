/** Hash router with per-page cleanup support. */

import * as home from "./pages/channel.js";
import { channelForBangumiType } from "./channels.js";
import * as dynamicPage from "./pages/dynamic.js";
import * as messages from "./pages/messages.js";
import * as search from "./pages/search.js";
import * as video from "./pages/video.js";
import * as bangumi from "./pages/bangumi.js";
import * as live from "./pages/live.js";
import * as space from "./pages/space.js";
import * as historyPage from "./pages/history.js";
import * as favorites from "./pages/favorites.js";
import * as watchlater from "./pages/watchlater.js";
import * as settings from "./pages/settings.js";
import { errorState, notFoundHTML } from "./ui.js";
import { errorText } from "./utils.js";

const TITLES = {
  home: "首页",
  dynamic: "动态",
  messages: "消息",
  search: "搜索",
  video: "视频",
  bangumi: "番剧",
  live: "直播",
  space: "用户空间",
  history: "历史记录",
  favorites: "收藏夹",
  watchlater: "稍后再看",
  settings: "设置",
  notfound: "页面不存在",
};

const APP_NAME = "Bilibili-Tauri";
let activeController = null;
let activeCleanup = null;
let renderSeq = 0;
let started = false;
let bootHidden = false;

export function parseLocation() {
  const raw = String(location.hash || "").replace(/^#/, "");
  const normalized = raw || "/home";
  const [pathPart, queryPart = ""] = normalized.split("?");
  const path = `/${pathPart.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  const segments = path.split("/").filter(Boolean).map(decodeURIComponent);
  return {
    path: path === "/" ? "/home" : path,
    segments,
    query: new URLSearchParams(queryPart),
    hash: location.hash,
  };
}

function resolve(route) {
  const [first, second] = route.segments;
  if (!first || first === "home") {
    const channel = String(route.query.get("channel") || "").trim();
    return { name: "home", module: home, params: {}, nav: channel || "hot" };
  }
  if (first === "dynamic") {
    return { name: "dynamic", module: dynamicPage, params: {}, nav: "dynamic" };
  }
  if (first === "messages") {
    return { name: "messages", module: messages, params: {}, nav: "messages" };
  }
  if (first === "search") {
    return { name: "search", module: search, params: {}, nav: "search" };
  }
  if (first === "video" && second) {
    return { name: "video", module: video, params: { bvid: second }, nav: "" };
  }
  if (first === "bangumi" && !second) {
    const channel = channelForBangumiType(route.query.get("type"), "bangumi");
    return { name: "bangumi", module: home, params: { channel }, nav: channel };
  }
  if (first === "bangumi") {
    return {
      name: "bangumi",
      module: bangumi,
      params: { seasonId: second },
      nav: "bangumi",
    };
  }
  if (first === "live" && !second) {
    return { name: "live", module: home, params: { channel: "live" }, nav: "live" };
  }
  if (first === "live") {
    return {
      name: "live",
      module: live,
      params: { roomId: second },
      nav: "live",
    };
  }
  if (first === "space" && second) {
    return { name: "space", module: space, params: { mid: second }, nav: "" };
  }
  if (first === "history") {
    return { name: "history", module: historyPage, params: {}, nav: "history" };
  }
  if (first === "favorites") {
    return { name: "favorites", module: favorites, params: {}, nav: "favorites" };
  }
  if (first === "watchlater") {
    return { name: "watchlater", module: watchlater, params: {}, nav: "watchlater" };
  }
  if (first === "settings") {
    return { name: "settings", module: settings, params: {}, nav: "settings" };
  }
  return { name: "notfound", module: null, params: {}, nav: "" };
}

function setActiveNav(nav) {
  document.querySelectorAll(".nav-item[data-nav]").forEach((item) => {
    item.classList.toggle("active", Boolean(nav) && item.dataset.nav === nav);
  });
}

function hideBoot() {
  if (bootHidden) return;
  bootHidden = true;
  const boot = document.getElementById("boot");
  if (!boot) return;
  boot.classList.add("hide");
  setTimeout(() => boot.remove(), 420);
}

function pageView() {
  const page = document.getElementById("page");
  if (!page) return null;
  const view = document.createElement("div");
  view.className = "page-view";
  page.replaceChildren(view);
  return view;
}

function buildContext(route, info, controller) {
  return {
    path: route.path,
    segments: route.segments,
    params: info.params,
    query: route.query,
    route: info.name,
    signal: controller.signal,
    navigate: (to, options) => navigate(to, options),
    replace: (to) => navigate(to, { replace: true }),
    refresh: () => renderCurrent(),
    close: () => {},
  };
}

async function renderCurrent() {
  const seq = ++renderSeq;
  const route = parseLocation();
  const info = resolve(route);

  if (activeCleanup) {
    const cleanup = activeCleanup;
    activeCleanup = null;
    try {
      cleanup();
    } catch (error) {
      console.error("page cleanup failed", error);
    }
  }
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;

  document.title = `${TITLES[info.name] || "发现"} - ${APP_NAME}`;
  setActiveNav(info.nav);
  const main = document.getElementById("main");
  if (main) main.scrollTop = 0;
  const view = pageView();
  if (!view) return;

  window.dispatchEvent(
    new CustomEvent("app:route", {
      detail: {
        name: info.name,
        path: route.path,
        segments: route.segments,
        query: route.query,
      },
    })
  );

  if (!info.module) {
    view.innerHTML = notFoundHTML("页面");
    hideBoot();
    return;
  }

  const ctx = buildContext(route, info, controller);
  let cleanup = null;
  try {
    const pending = info.module.render(view, ctx);
    // Pages paint a skeleton synchronously before their first await, so the
    // splash can go away immediately instead of waiting for the network.
    hideBoot();
    cleanup = await pending;
    if (seq !== renderSeq || controller.signal.aborted) {
      if (typeof cleanup === "function") cleanup();
      return;
    }
    activeCleanup = typeof cleanup === "function" ? cleanup : null;
  } catch (error) {
    if (seq !== renderSeq || controller.signal.aborted) return;
    console.error(`page ${info.name} failed`, error);
    view.innerHTML = errorState(errorText(error), { title: "页面加载失败", retry: true });
    view.querySelector("[data-retry]")?.addEventListener("click", () => renderCurrent());
    hideBoot();
  }
}

export function navigate(to, { replace = false } = {}) {
  let hash = String(to || "/home").trim();
  if (hash.startsWith("#")) hash = hash.slice(1);
  if (!hash.startsWith("/")) hash = `/${hash}`;
  const full = `#${hash}`;
  if (replace) {
    if (location.hash !== full) history.replaceState(null, "", full);
    renderCurrent();
    return;
  }
  if (location.hash === full) {
    renderCurrent();
    return;
  }
  location.hash = full;
}

export function reload() {
  renderCurrent();
}

export function currentRoute() {
  return resolve(parseLocation());
}

export function start() {
  if (started) return Promise.resolve();
  started = true;
  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    history.replaceState(null, "", "#/home");
  }
  window.addEventListener("hashchange", () => renderCurrent());
  return renderCurrent();
}
