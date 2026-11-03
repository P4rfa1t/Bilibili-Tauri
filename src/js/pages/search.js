import { cachedTrending, search, searchTrending } from "../api.js";
import { SEARCH_ORDERS, SEARCH_TYPES } from "../constants.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import {
  bangumiCard,
  createInfiniteLoader,
  emptyState,
  errorState,
  skeletonGrid,
  userCard,
  videoCard,
} from "../ui.js";
import { errorText, escapeAttr, escapeHtml, formatCount } from "../utils.js";

function normalizedType(value) {
  return SEARCH_TYPES.some((item) => item.value === value) ? value : "video";
}

function normalizedOrder(value) {
  return SEARCH_ORDERS.some((item) => item.value === value) ? value : "totalrank";
}

function searchHref({ q, type, order }) {
  const sp = new URLSearchParams();
  sp.set("q", q);
  if (type && type !== "video") sp.set("type", type);
  if (type === "video" && order && order !== "totalrank") sp.set("order", order);
  return `#/search?${sp.toString()}`;
}

function submitSearch(ctx, word) {
  const keyword = String(word || "").trim();
  if (!keyword) return;
  store.addRecentSearch(keyword);
  ctx.navigate(`/search?q=${encodeURIComponent(keyword)}`);
}

// ---------------------------------------------------------------- discovery

function recentCardHtml() {
  const items = store.get("recentSearches") || [];
  if (!items.length) return "";
  return `<section class="search-trending-card" data-recent-card>
    <div class="search-trending-head">
      <h3>${icon("history", 17)}最近搜索</h3>
      <button class="btn btn-sm btn-ghost" type="button" data-clear-recent>清空</button>
    </div>
    <div class="search-trending-list" data-recent-list>
      ${items
        .map(
          (word) => `<span class="trending-pill recent-pill" data-search-word="${escapeAttr(word)}">
            ${icon("clock", 12)}
            <span>${escapeHtml(word)}</span>
            <button class="recent-remove" type="button" data-remove-recent="${escapeAttr(
              word
            )}" title="移除" aria-label="移除 ${escapeAttr(word)}">${icon("x", 11)}</button>
          </span>`
        )
        .join("")}
    </div>
  </section>`;
}

function trendingPills(items) {
  return items
    .map(
      (word, index) => `<button class="trending-pill" type="button" data-search-word="${escapeAttr(
        word
      )}">
        <span class="idx">${String(index + 1).padStart(2, "0")}</span>
        <span>${escapeHtml(word)}</span>
      </button>`
    )
    .join("");
}

async function renderDiscover(root, ctx) {
  root.innerHTML = `
    <div class="search-page-head">
      <div>
        <div class="search-keyword">${icon("search", 24)}发现精彩内容</div>
        <p class="page-subtitle">在顶部搜索框输入关键词，或从下面的热门搜索开始。</p>
      </div>
    </div>
    ${recentCardHtml()}
    <section class="search-trending-card" data-trending-card>
      <div class="search-trending-head">
        <h3>${icon("flame", 17)}热门搜索</h3>
        <button class="btn btn-sm btn-ghost" type="button" data-refresh-trending>
          ${icon("refresh-cw", 13)}换一批
        </button>
      </div>
      <div class="search-trending-list" data-trending-list>
        <span class="hint"><span class="spinner" style="width:14px;height:14px;border-width:2px"></span>正在加载热门搜索…</span>
      </div>
    </section>`;

  let disposed = false;
  const trendingList = root.querySelector("[data-trending-list]");
  const refresh = root.querySelector("[data-refresh-trending]");

  const paintTrending = (items) => {
    if (!items || !items.length) {
      trendingList.innerHTML = `<span class="hint">暂时没有热门搜索，直接输入关键词试试吧。</span>`;
      return;
    }
    trendingList.innerHTML = trendingPills(items);
  };

  const loadTrending = async ({ force = false } = {}) => {
    if (!trendingList) return;
    refresh?.setAttribute("disabled", "");
    try {
      const items = force ? await searchTrending() : await cachedTrending();
      if (disposed) return;
      paintTrending(items);
    } catch (error) {
      if (disposed) return;
      trendingList.innerHTML = `<span class="hint">${escapeHtml(errorText(error))}</span>`;
    } finally {
      refresh?.removeAttribute("disabled");
    }
  };

  root.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-recent]");
    if (remove) {
      const word = remove.dataset.removeRecent;
      store.removeRecentSearch(word);
      remove.closest(".recent-pill")?.remove();
      const list = root.querySelector("[data-recent-list]");
      if (list && !list.children.length) {
        root.querySelector("[data-recent-card]")?.remove();
      }
      return;
    }

    if (event.target.closest("[data-clear-recent]")) {
      store.clearRecentSearches();
      root.querySelector("[data-recent-card]")?.remove();
      return;
    }

    const item = event.target.closest("[data-search-word]");
    if (item) submitSearch(ctx, item.dataset.searchWord);
  });

  root.querySelector("[data-refresh-trending]")?.addEventListener("click", () => {
    loadTrending({ force: true });
  });

  await loadTrending();
  return () => {
    disposed = true;
  };
}

// ------------------------------------------------------------------ results

export async function render(root, ctx) {
  const q = (ctx.query.get("q") || "").trim();
  if (!q) return renderDiscover(root, ctx);

  const type = normalizedType(ctx.query.get("type") || "video");
  const order = normalizedOrder(ctx.query.get("order") || "totalrank");
  const typeLabel = SEARCH_TYPES.find((item) => item.value === type)?.label || "视频";

  const tabs = SEARCH_TYPES.map(
    (item) =>
      `<a class="tab${item.value === type ? " active" : ""}" href="${searchHref({
        q,
        type: item.value,
        order,
      })}">${escapeHtml(item.label)}</a>`
  ).join("");

  root.innerHTML = `
    <div class="search-page-head">
      <div>
        <div class="search-keyword">
          <span>搜索</span>
          <span class="q">“${escapeHtml(q)}”</span>
          <span class="count" data-total></span>
        </div>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-outline" type="button" data-focus-search>
          ${icon("search", 14)}修改关键词
        </button>
      </div>
    </div>
    <div class="tabs-line" style="margin-bottom:14px">${tabs}</div>
    <div class="search-toolbar">
      <div class="search-result-info" data-result-info>正在搜索${typeLabel}…</div>
      ${
        type === "video"
          ? `<div class="search-toolbar-right">
              <span class="hint">排序</span>
              <select class="select" data-order aria-label="排序方式">
                ${SEARCH_ORDERS.map(
                  (item) =>
                    `<option value="${item.value}"${
                      item.value === order ? " selected" : ""
                    }>${escapeHtml(item.label)}</option>`
                ).join("")}
              </select>
            </div>`
          : ""
      }
    </div>
    <div data-search-results>${skeletonGrid(12, {
      bangumi: type === "bangumi",
    })}</div>`;

  const results = root.querySelector("[data-search-results]");
  const info = root.querySelector("[data-result-info]");
  const totalEl = root.querySelector("[data-total]");
  let disposed = false;
  let page = 0;
  let loader = null;
  let listEl = null;

  const emptyForQuery = () =>
    emptyState(
      "没有找到相关内容",
      "换个关键词，或尝试切换搜索类型。",
      `<button class="btn btn-primary" type="button" data-focus-search>${icon(
        "search",
        15
      )}重新搜索</button>`,
      "search"
    );

  const paintItems = (data) => {
    const items =
      type === "user" ? data.users || [] : type === "bangumi" ? data.bangumi || [] : data.videos || [];
    if (!items.length && page <= 1) {
      results.innerHTML = emptyForQuery();
      return;
    }
    if (!listEl) {
      listEl = document.createElement("div");
      listEl.className =
        type === "user" ? "user-grid" : type === "bangumi" ? "bangumi-grid" : "video-grid";
      results.append(listEl);
    }
    if (type === "user") {
      listEl.insertAdjacentHTML("beforeend", items.map((item) => userCard(item)).join(""));
    } else if (type === "bangumi") {
      listEl.insertAdjacentHTML("beforeend", items.map((item) => bangumiCard(item)).join(""));
    } else {
      listEl.insertAdjacentHTML(
        "beforeend",
        items
          .map((item) => videoCard(item, { showDanmaku: true, showDate: false }))
          .join("")
      );
    }
  };

  const loadMore = async () => {
    if (disposed) return false;
    const data = await search(q, page + 1, type, type === "video" ? order : "totalrank");
    if (disposed || ctx.signal.aborted) return false;
    page = data.page || page + 1;
    paintItems(data);
    if (type === "user") {
      info.textContent = `共约 ${formatCount(data.total)} 位 UP 主`;
    } else if (type === "bangumi") {
      info.textContent = `共约 ${formatCount(data.total)} 部番剧`;
    }
    return Boolean(data.has_more);
  };

  try {
    const data = await search(q, 1, type, type === "video" ? order : "totalrank");
    if (disposed || ctx.signal.aborted) return () => {};
    page = data.page || 1;
    const total = Number(data.total) || 0;
    const count =
      type === "user"
        ? (data.users || []).length
        : type === "bangumi"
        ? (data.bangumi || []).length
        : (data.videos || []).length;
    if (totalEl) totalEl.textContent = `约 ${formatCount(total)} 个结果`;
    if (count) {
      info.textContent =
        type === "user"
          ? `共约 ${formatCount(total)} 位 UP 主`
          : type === "bangumi"
          ? `共约 ${formatCount(total)} 部番剧`
          : `共约 ${formatCount(total)} 个视频`;
    } else {
      info.textContent = "没有找到相关内容";
    }
    results.innerHTML = "";
    paintItems(data);

    if (data.has_more && count) {
      loader = createInfiniteLoader(results, loadMore);
    } else if (!count) {
      results.innerHTML = emptyForQuery();
    }
    return () => {
      disposed = true;
      loader?.remove();
      loader = null;
    };
  } catch (error) {
    if (disposed || ctx.signal.aborted) return () => {};
    results.innerHTML = errorState(error);
    results.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
    info.textContent = "搜索失败";
    return () => {
      disposed = true;
    };
  }
}

// Heats up the cache before the user lands on the search page.
export function warmTrending() {
  cachedTrending().catch(() => {});
}

// Handlers that live on the page shell rather than a specific result list.
document.addEventListener("change", (event) => {
  const select = event.target.closest("[data-order]");
  if (!select) return;
  const order = normalizedOrder(select.value);
  const q = (new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "").trim();
  if (!q) return;
  const type = normalizedType(
    new URLSearchParams(location.hash.split("?")[1] || "").get("type") || "video"
  );
  location.hash = searchHref({ q, type, order }).slice(1);
});
