/**
 * 首页频道栏：动态 / 直播 / 推荐 / 热门 / 追番 / 影视。
 *
 * 频道只是首页内的一层包装：真正的渲染由各页面模块负责，
 * 这里只提供频道定义、频道内链接、以及站内链接的频道内改写。
 */

import { escapeHtml } from "./utils.js";

export const CHANNELS = [
  { key: "dynamic", label: "动态" },
  { key: "live", label: "直播" },
  { key: "recommend", label: "推荐" },
  { key: "hot", label: "热门" },
  { key: "bangumi", label: "追番" },
  { key: "film", label: "影视" },
];

export const DEFAULT_CHANNEL = "hot";

/** 各频道在频道内需要保留的查询参数。 */
const KEEP_PARAMS = {
  dynamic: [],
  live: ["tab", "group", "area"],
  recommend: [],
  hot: ["tab", "rid"],
  bangumi: ["type"],
  film: ["type"],
};

export function channelOf(query) {
  const raw = String(query?.get?.("channel") || "").trim();
  return CHANNELS.some((item) => item.key === raw) ? raw : DEFAULT_CHANNEL;
}

export function channelLabel(key) {
  return CHANNELS.find((item) => item.key === key)?.label || "首页";
}

export function channelHref(key, params = {}) {
  const query = new URLSearchParams();
  query.set("channel", key);
  Object.entries(params).forEach(([name, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(name, String(value));
  });
  return `#/home?${query.toString()}`;
}

export function channelBarHtml(active) {
  const tabs = CHANNELS.map(
    (item) =>
      `<a class="channel-tab${item.key === active ? " active" : ""}" href="${channelHref(
        item.key
      )}" data-channel="${item.key}">${escapeHtml(item.label)}</a>`
  ).join("");
  return `<div class="channel-bar" role="tablist" aria-label="首页频道">${tabs}</div>`;
}

function parseHash(href) {
  const raw = String(href || "");
  if (!raw.startsWith("#/")) return null;
  const [path, search = ""] = raw.slice(1).split("?");
  const segments = path.split("/").filter(Boolean);
  if (!segments.length) return null;
  return { segments, query: new URLSearchParams(search) };
}

function build(channel, query, keep) {
  const params = {};
  keep.forEach((name) => {
    const value = query.get(name);
    if (value) params[name] = value;
  });
  return channelHref(channel, params);
}

/** 追番与影视共用番剧库，按 season_type 分到两个频道。 */
const FILM_TYPES = [2, 3, 5, 7];

export function channelForBangumiType(type, fallback) {
  const value = Number(type);
  if (!value) return fallback;
  return FILM_TYPES.includes(value) ? "film" : "bangumi";
}

/**
 * 把一个站内链接改写成“留在当前频道内”的链接。
 * 直播间 / 番剧详情 / 视频 / 搜索等具体页面保持原样。
 */
export function channelize(href, channel) {
  const parsed = parseHash(href);
  if (!parsed) return href;
  const [first, second] = parsed.segments;

  if (first === "recommend" && !second) return build("recommend", parsed.query, []);
  if (first === "live" && !second) return build("live", parsed.query, KEEP_PARAMS.live);
  if (first === "bangumi" && !second) {
    const target = channelForBangumiType(
      parsed.query.get("type"),
      channel === "film" ? "film" : "bangumi"
    );
    return build(target, parsed.query, ["type"]);
  }
  if (first === "home" && channel === "hot") return build("hot", parsed.query, KEEP_PARAMS.hot);
  return href;
}

/** 让频道容器内的站内链接都留在频道里。返回解绑函数。 */
export function bindChannelLinks(container, channel) {
  if (!container) return () => {};

  const onClick = (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target?.closest?.("a[href^='#/']");
    if (!anchor || !container.contains(anchor)) return;
    // 频道标签自己就是切换频道的入口，不能再被改写成当前频道
    if (anchor.hasAttribute("data-channel")) return;
    const current = anchor.getAttribute("href") || "";
    const next = channelize(current, channel);
    if (!next || next === current) return;
    event.preventDefault();
    location.hash = next;
  };

  container.addEventListener("click", onClick, true);
  return () => container.removeEventListener("click", onClick, true);
}

/** 子页面用的查询参数：去掉频道名，保留各自的筛选参数。 */
export function channelQuery(query) {
  const next = new URLSearchParams(query);
  next.delete("channel");
  return next;
}
