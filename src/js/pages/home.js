import { homeFeed } from "../api.js";
import { RANKING_CATEGORIES, REGION_CATEGORIES } from "../constants.js";
import { icon } from "../icons.js";
import {
  createInfiniteLoader,
  emptyState,
  errorState,
  pageHead,
  skeletonGrid,
  useRefreshFab,
  videoCard,
} from "../ui.js";
import {
  escapeAttr,
  escapeHtml,
  formatCount,
  formatDate,
  imgTag,
} from "../utils.js";

const TABS = [
  { key: "popular", label: "热门", iconName: "flame" },
  { key: "ranking", label: "排行榜", iconName: "trophy" },
  { key: "region", label: "分区", iconName: "list-video" },
];

function heroHtml(v, { ranking = false } = {}) {
  const bvid = String(v?.bvid || "");
  const href = `#/video/${encodeURIComponent(bvid)}`;
  return `<a class="home-hero" href="${href}" aria-label="${escapeAttr(v.title)}">
    ${imgTag(v.cover, { w: 1280, h: 720, alt: v.title, className: "hero-bg", eager: true })}
    <div class="home-hero-content">
      <span class="hero-eyebrow">${icon(ranking ? "trophy" : "flame", 13)}${
    ranking ? "排行榜精选" : "热门推荐"
  }</span>
      <h2 class="home-hero-title">${escapeHtml(v.title || "无标题")}</h2>
      ${
        v.description
          ? `<p class="home-hero-desc">${escapeHtml(v.description)}</p>`
          : ""
      }
      <div class="home-hero-meta">
        <span>${icon("user", 14)}${escapeHtml(v.author || "未知 UP 主")}</span>
        <span>${icon("play", 14)}${formatCount(v.play)} 播放</span>
        <span>${icon("message-square", 14)}${formatCount(v.danmaku)} 弹幕</span>
        ${
          v.pubdate
            ? `<span>${icon("calendar", 14)}${escapeHtml(formatDate(v.pubdate, false))}</span>`
            : ""
        }
      </div>
      <div class="home-hero-actions">
        <span class="btn btn-primary">${icon("play", 15)}立即播放</span>
        <span class="btn btn-glass">${icon("info", 15)}查看详情</span>
      </div>
    </div>
  </a>`;
}

function toolbarHtml(tab, rid) {
  const tabs = TABS.map(
    (item) =>
      `<a class="tab${item.key === tab ? " active" : ""}" href="#/home?tab=${item.key}">
        ${icon(item.iconName, 14)}${item.label}
      </a>`
  ).join("");

  let chips = "";
  if (tab === "ranking") {
    chips = `<div class="chip-row">${RANKING_CATEGORIES.map(
      (item) =>
        `<a class="chip${item.rid === rid ? " active" : ""}" href="#/home?tab=ranking&rid=${item.rid}">${escapeHtml(
          item.label
        )}</a>`
    ).join("")}</div>`;
  } else if (tab === "region") {
    chips = `<div class="chip-row">${REGION_CATEGORIES.map(
      (item) =>
        `<a class="chip${item.rid === rid ? " active" : ""}" href="#/home?tab=region&rid=${item.rid}">${escapeHtml(
          item.label
        )}</a>`
    ).join("")}</div>`;
  }

  return `<div class="home-toolbar">
    <div class="home-toolbar-left">
      <div class="tabs">${tabs}</div>
      ${chips}
    </div>
  </div>`;
}

export async function render(root, ctx) {
  const tabParam = ctx.query.get("tab") || "popular";
  const tab = TABS.some((item) => item.key === tabParam) ? tabParam : "popular";
  const kind = tab === "ranking" ? "ranking" : tab === "region" ? "region" : "popular";
  const rid =
    tab === "ranking"
      ? Number(ctx.query.get("rid") || 0)
      : tab === "region"
      ? Number(ctx.query.get("rid") || 1)
      : 0;

  const titleMap = {
    popular: ["发现", "热门视频、排行榜与分区精选，都在这里。"],
    ranking: ["排行榜", "看看全站和各分区最近最受欢迎的视频。"],
    region: ["分区精选", "按分区浏览近期热门内容。"],
  };
  const [title, subtitle] = titleMap[tab];

  root.innerHTML = `
    ${pageHead({
      title,
      subtitle,
    })}
    ${toolbarHtml(tab, rid)}
    <div id="home-results">${skeletonGrid(12)}</div>`;

  const results = root.querySelector("#home-results");
  const stopRefreshFab = useRefreshFab(() => ctx.refresh());
  let disposed = false;
  let page = 1;
  let count = 0;
  let loader = null;
  let grid = null;

  const cleanup = () => {
    disposed = true;
    loader?.remove();
    loader = null;
    stopRefreshFab();
  };

  const appendCards = (items, ranked) => {
    if (!items.length) return;
    if (!grid) {
      grid = document.createElement("div");
      grid.className = "video-grid";
      results.append(grid);
    }
    const html = items
      .map((item, index) =>
        videoCard(item, {
          rank: ranked ? count + index + 1 : 0,
          showDanmaku: true,
        })
      )
      .join("");
    grid.insertAdjacentHTML("beforeend", html);
    count += items.length;
  };

  const loadMore = async () => {
    if (disposed) return false;
    try {
      const data = await homeFeed(kind, page + 1, rid);
      if (disposed || ctx.signal.aborted) return false;
      page += 1;
      appendCards(data.items || [], tab === "ranking");
      return Boolean(data.has_more);
    } catch (_) {
      return false;
    }
  };

  try {
    const data = await homeFeed(kind, 1, rid);
    if (disposed || ctx.signal.aborted) return cleanup;
    const items = data.items || [];
    if (!items.length) {
      results.innerHTML = emptyState(
        "暂时没有内容",
        "换一个分区或稍后再刷新看看。",
        `<button class="btn btn-primary" data-empty-retry type="button">重新加载</button>`,
        "sparkles"
      );
      results
        .querySelector("[data-empty-retry]")
        ?.addEventListener("click", () => ctx.refresh());
      return cleanup;
    }

    const first = items[0];
    const rest = items.slice(1);
    count = 1;
    results.innerHTML = `${heroHtml(first, { ranking: tab === "ranking" })}${
      rest.length ? '<div class="video-grid" id="home-grid"></div>' : ""
    }`;
    grid = results.querySelector("#home-grid");
    if (grid) {
      grid.innerHTML = rest
        .map((item, index) =>
          videoCard(item, {
            rank: tab === "ranking" ? index + 2 : 0,
            showDanmaku: true,
          })
        )
        .join("");
      count += rest.length;
    }

    if (tab !== "ranking" && data.has_more) {
      loader = createInfiniteLoader(results, loadMore);
    }
    return cleanup;
  } catch (error) {
    if (disposed || ctx.signal.aborted) return cleanup;
    results.innerHTML = errorState(error, { retry: true });
    results.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
    return cleanup;
  }
}
