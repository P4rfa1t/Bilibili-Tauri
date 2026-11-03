/**
 * 推荐 — 官方首页推荐流。
 *
 * 数据来自 api.bilibili.com 的 web-interface/index/top/feed/rcmd，
 * 通过递增 fresh_idx 拿到下一批。设置页的“推荐流设置”在这里生效：
 * 过滤规则、记住刷新位置、上次浏览位置。
 */

import { recommendFeed } from "../api.js";
import { filterVideos, readRules, rulesAreDefault } from "../filters.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import {
  createInfiniteLoader,
  emptyState,
  errorState,
  pageHead,
  skeletonGrid,
  videoCard,
} from "../ui.js";
import { errorText, escapeHtml } from "../utils.js";

const MAX_FILTER_RETRY = 3;

/** “换一批”在重渲染之间传递的起始批次（模块级，refresh 后仍有效）。 */
let pendingStart = 0;

function rulesChipHtml(rules, filteredCount) {
  if (rulesAreDefault(rules) && !filteredCount) {
    return `<a class="rec-chip" href="#/settings">${icon(
      "settings-2",
      13
    )}推荐流设置</a>`;
  }
  const parts = [];
  if (rules.likeRateMin > 0) parts.push(`点赞率 ≥ ${Math.round(rules.likeRateMin * 100)}%`);
  if (rules.playMin > 0) parts.push(`播放 ≥ ${rules.playMin}`);
  if (rules.durationMin > 0) parts.push(`时长 ≥ ${Math.round(rules.durationMin / 60)} 分`);
  if (rules.durationMax > 0) parts.push(`时长 ≤ ${Math.round(rules.durationMax / 60)} 分`);
  if (rules.titleFilters.length) parts.push(`标题屏蔽 ${rules.titleFilters.length} 个`);
  if (rules.partitionFilters.length) parts.push(`分区屏蔽 ${rules.partitionFilters.length} 个`);
  const summary = parts.length ? parts.join(" · ") : "仅关注豁免";
  return `<a class="rec-chip${filteredCount ? " active" : ""}" href="#/settings">${icon(
    "filter",
    13
  )}${escapeHtml(summary)}${filteredCount ? ` · 已过滤 ${filteredCount} 条` : ""}</a>`;
}

function dividerHtml(text) {
  return `<div class="rec-divider"><span>${escapeHtml(text)}</span></div>`;
}

export async function render(root, ctx) {
  const rules = readRules();
  const keepPosition = store.get("recommendKeepRefresh") === true;
  const startFrom = pendingStart > 0 ? pendingStart : 0;
  pendingStart = 0;
  let freshIdx =
    startFrom || (keepPosition ? Math.max(1, Number(store.get("recommendFreshIdx")) || 1) : 1);

  root.innerHTML = `
    ${pageHead({
      title: "推荐",
      subtitle: "哔哩哔哩官方推荐流，按你的口味持续刷新。",
      actions: `<button class="btn btn-sm btn-outline refresh-btn" data-refresh type="button">${icon(
        "refresh-cw",
        14
      )}换一批</button>`,
    })}
    <div class="rec-toolbar">
      <span class="rec-chip static">${icon("compass", 13)}第 <b data-idx>${freshIdx}</b> 批</span>
      <span data-rules-chip>${rulesChipHtml(rules, 0)}</span>
      <span class="controls-spacer"></span>
      <span class="rec-hint">下拉自动加载更多</span>
    </div>
    <div id="rec-results">${skeletonGrid(12)}</div>`;

  const results = root.querySelector("#rec-results");
  const idxEl = root.querySelector("[data-idx]");
  const chipEl = root.querySelector("[data-rules-chip]");

  let disposed = false;
  let filteredTotal = 0;
  let lastBvid = "";
  let markedSeen = false;
  let loader = null;
  let grid = null;

  const syncChip = () => {
    if (chipEl) chipEl.innerHTML = rulesChipHtml(rules, filteredTotal);
  };

  const cleanup = () => {
    disposed = true;
    loader?.remove();
    loader = null;
    if (lastBvid && store.get("recommendLastSeen") !== false) {
      store.set("recommendLastBvid", lastBvid);
    }
    if (keepPosition) store.set("recommendFreshIdx", freshIdx);
  };

  root.querySelector("[data-refresh]")?.addEventListener("click", () => {
    pendingStart = freshIdx;
    ctx.refresh();
  });

  const ensureGrid = () => {
    if (grid) return grid;
    grid = document.createElement("div");
    grid.className = "video-grid";
    results.append(grid);
    return grid;
  };

  const paint = (items, { first = false } = {}) => {
    if (!items.length) return;
    const target = ensureGrid();
    const html = items
      .map((item) => videoCard(item, { showDanmaku: true, note: item.recommend_reason }))
      .join("");
    target.insertAdjacentHTML("beforeend", html);
    lastBvid = String(items[items.length - 1]?.bvid || lastBvid);

    // "上次看到这里"标记：只在首次渲染时插一次
    if (first && !markedSeen && store.get("recommendLastSeen") !== false) {
      markedSeen = true;
      const seen = String(store.get("recommendLastBvid") || "");
      if (seen) {
        const card = target.querySelector(`.video-card[data-bvid="${CSS.escape(seen)}"]`);
        card?.insertAdjacentHTML("afterend", dividerHtml("上次看到这里"));
      }
    }
  };

  /** 拉一批，过滤后仍为空就继续换批，避免页面卡在空白。 */
  const fetchBatch = async () => {
    let lastError = null;
    for (let attempt = 0; attempt < MAX_FILTER_RETRY; attempt += 1) {
      const batchIdx = freshIdx;
      let data = null;
      try {
        data = await recommendFeed(batchIdx);
      } catch (error) {
        // 接口偶发空批或风控时接口会报错，换下一批再试
        lastError = error;
        freshIdx = batchIdx + 1;
        continue;
      }
      if (disposed) return { items: [], hasMore: false };
      freshIdx = batchIdx + 1;
      if (idxEl) idxEl.textContent = String(freshIdx);
      const { items, filtered } = filterVideos(data.items || [], rules);
      filteredTotal += filtered;
      syncChip();
      if (items.length || !data.has_more) {
        return { items, hasMore: Boolean(data.has_more) };
      }
    }
    if (lastError && filteredTotal === 0) throw lastError;
    return { items: [], hasMore: true };
  };

  const loadMore = async () => {
    if (disposed) return false;
    try {
      const { items, hasMore } = await fetchBatch();
      if (disposed || ctx.signal.aborted) return false;
      paint(items);
      return hasMore;
    } catch (_) {
      return false;
    }
  };

  try {
    const { items, hasMore } = await fetchBatch();
    if (disposed || ctx.signal.aborted) return cleanup;

    if (!items.length) {
      results.innerHTML = emptyState(
        "这一批都被过滤了",
        rulesAreDefault(rules)
          ? "稍后再试，或到设置里调整推荐流偏好。"
          : "当前过滤规则比较严格，可以到设置里放宽条件。",
        `<a class="btn btn-primary" href="#/settings">${icon(
          "settings-2",
          15
        )}调整推荐流设置</a>`,
        "filter"
      );
      return cleanup;
    }

    results.innerHTML = "";
    grid = null;
    paint(items, { first: true });
    if (hasMore) loader = createInfiniteLoader(results, loadMore);
    return cleanup;
  } catch (error) {
    if (disposed || ctx.signal.aborted) return cleanup;
    results.innerHTML = errorState(errorText(error), { retry: true });
    results
      .querySelector("[data-retry]")
      ?.addEventListener("click", () => ctx.refresh());
    return cleanup;
  }
}