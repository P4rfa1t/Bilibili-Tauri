/**
 * 推荐 — 官方首页推荐流。
 *
 * 数据来自 api.bilibili.com 的 web-interface/index/top/feed/rcmd，
 * 通过递增 fresh_idx 拿到下一批。
 */

import { recommendFeed } from "../api.js";
import { icon } from "../icons.js";
import {
  createInfiniteLoader,
  emptyState,
  errorState,
  pageHead,
  skeletonGrid,
  videoCard,
} from "../ui.js";
import { errorText } from "../utils.js";

/** “换一批”在重渲染之间传递的起始批次（模块级，refresh 后仍有效）。 */
let pendingStart = 0;

export async function render(root, ctx) {
  const startFrom = pendingStart > 0 ? pendingStart : 0;
  pendingStart = 0;
  let freshIdx = startFrom || 1;

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
      <span class="controls-spacer"></span>
      <span class="rec-hint">下拉自动加载更多</span>
    </div>
    <div id="rec-results">${skeletonGrid(12)}</div>`;

  const results = root.querySelector("#rec-results");
  const idxEl = root.querySelector("[data-idx]");

  let disposed = false;
  let loader = null;
  let grid = null;

  const cleanup = () => {
    disposed = true;
    loader?.remove();
    loader = null;
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

  const paint = (items) => {
    if (!items.length) return;
    const target = ensureGrid();
    const html = items
      .map((item) => videoCard(item, { showDanmaku: true, note: item.recommend_reason }))
      .join("");
    target.insertAdjacentHTML("beforeend", html);
  };

  /** 拉一批，接口偶发空批或风控时换下一批再试。 */
  const fetchBatch = async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const batchIdx = freshIdx;
      let data = null;
      try {
        data = await recommendFeed(batchIdx);
      } catch (error) {
        lastError = error;
        freshIdx = batchIdx + 1;
        continue;
      }
      if (disposed) return { items: [], hasMore: false };
      freshIdx = batchIdx + 1;
      if (idxEl) idxEl.textContent = String(freshIdx);
      if ((data.items || []).length || !data.has_more) {
        return { items: data.items || [], hasMore: Boolean(data.has_more) };
      }
    }
    if (lastError) throw lastError;
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
        "暂时没有推荐内容",
        "稍后再试，或先去热门频道逛逛。",
        "",
        "compass"
      );
      return cleanup;
    }

    results.innerHTML = "";
    grid = null;
    paint(items);
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
