import {
  bangumiDetail,
  bangumiFilters,
  bangumiList,
  danmaku as fetchDanmaku,
  openExternal,
  pgcPlayInfo,
} from "../api.js";
import { channelHref } from "../channels.js";
import { BANGUMI_TYPES } from "../constants.js";
import { icon } from "../icons.js";
import { orderStreams, pgcPlayOptions } from "../media.js";
import { Player } from "../player/player.js";
import { store } from "../store.js";
import {
  bangumiCard,
  createInfiniteLoader,
  emptyState,
  errorState,
  skeletonGrid,
  toast,
  useRefreshFab,
} from "../ui.js";
import {
  errorText,
  escapeAttr,
  escapeHtml,
  formatCount,
  formatDuration,
  imgTag,
} from "../utils.js";

/** 追番与影视共用一套列表页，但分类和筛选项完全分开。 */
const GROUP_TYPES = {
  bangumi: [1, 4],
  film: [2, 5, 3, 7],
};

const TAB_TYPES = {
  bangumi: [],
  film: [2, 5, 3, 7],
};

const REGION_FALLBACK = [
  { keyword: "-1", name: "全部" },
  { keyword: "2", name: "日本" },
  { keyword: "3", name: "美国" },
  { keyword: "cn", name: "中国" },
];

const GROUP_META = {
  bangumi: {
    title: "追番库",
    sub: "浏览正版番剧与国创内容。",
    noun: "番剧",
  },
  film: {
    title: "影视库",
    sub: "浏览电影、纪录片、电视剧与综艺。",
    noun: "影视",
  },
};

const FILTER_LABELS = {
  area: "地区",
  style_id: "风格",
  season_version: "版本类型",
  season_status: "付费类型",
  year: "全部年份",
  release_date: "年份",
  is_finish: "完结状态",
  spoken_language_type: "配音类型",
  copyright: "版权类型",
  season_month: "全部季度",
};

const FILTER_KEYS = Object.keys(FILTER_LABELS);
const FILTER_FIELDS = {
  bangumi: ["style_id", "season_version", "season_status"],
  film: ["area", "style_id", "release_date", "year", "season_status"],
};
const EXTRA_FIELDS = [
  "spoken_language_type",
  "copyright",
  "is_finish",
  "year",
  "season_month",
];
const COLLAPSED_CHIPS = 12;
const filterCache = new Map();

function groupChannel(ctx) {
  return ctx.params.channel === "film" ? "film" : "bangumi";
}

function groupTypes(channel) {
  return GROUP_TYPES[channel] || GROUP_TYPES.bangumi;
}

function normalizeType(value, channel) {
  const types = groupTypes(channel);
  const n = Number(value);
  return types.includes(n) ? n : types[0];
}

function typeLabel(value) {
  return BANGUMI_TYPES.find((item) => item.value === value)?.label || "番剧";
}

function readFilters(query) {
  const out = {};
  for (const key of FILTER_KEYS) {
    const value = query.get(key);
    if (value) out[key] = value;
  }
  if (!out.order) out.order = "1";
  return out;
}

function filtersForApi(filters) {
  const out = {};
  for (const key of [...FILTER_KEYS, "order"]) {
    const value = filters[key];
    if (value && value !== "-1") out[key] = value;
  }
  return out;
}

function filtersHref(channel, seasonType, filters) {
  return channelHref(channel, { type: seasonType, ...filtersForApi(filters) });
}

function hasActiveFilters(filters) {
  return Object.entries(filters).some(([key, value]) =>
    key === "order" ? String(value) !== "1" : Boolean(value) && value !== "-1"
  );
}

function getFilterSet(seasonType) {
  if (!filterCache.has(seasonType)) {
    filterCache.set(
      seasonType,
      bangumiFilters(seasonType).catch((error) => {
        filterCache.delete(seasonType);
        throw error;
      })
    );
  }
  return filterCache.get(seasonType);
}

function filterChipName(condition, field, value) {
  const group = condition?.filters?.find((item) => item.field === field);
  return (
    group?.values?.find((item) => String(item.keyword) === String(value))?.name ||
    String(value)
  );
}

function filterRowHtml(label, field, values, filters) {
  const collapsed = values.length > COLLAPSED_CHIPS;
  const chips = values
    .map((item) => {
      const active =
        field === "order"
          ? String(filters.order || "1") === String(item.keyword)
          : String(filters[field] ?? "-1") === String(item.keyword);
      return `<button class="chip${active ? " active" : ""}" type="button" data-filter="${escapeHtml(
        field
      )}" data-value="${escapeHtml(item.keyword)}">${escapeHtml(item.name)}</button>`;
    })
    .join("");
  return `<div class="filter-row${collapsed ? " collapsed" : ""}" data-filter-row>
    <span class="filter-label">${escapeHtml(label)}</span>
    <span class="filter-values">${chips}</span>
    ${
      collapsed
        ? '<button class="filter-more" type="button" data-filter-more>查看全部</button>'
        : ""
    }
  </div>`;
}

function extraFields(condition, channel) {
  const core = new Set(FILTER_FIELDS[channel] || FILTER_FIELDS.bangumi);
  return EXTRA_FIELDS.filter(
    (field) =>
      !core.has(field) && condition?.filters?.some((group) => group.field === field)
  );
}

function buildRegionValues(condition) {
  const group = condition?.filters?.find((item) => item.field === "area");
  const values = group?.values?.length
    ? group.values.map((item) => ({ keyword: item.keyword, name: item.name }))
    : REGION_FALLBACK.filter((item) => item.keyword !== "cn");
  const existing = values.findIndex((item) => item.keyword === "cn");
  if (existing >= 0) values.splice(existing, 1);
  const allIndex = values.findIndex((item) => item.keyword === "-1");
  values.splice(allIndex >= 0 ? allIndex + 1 : 0, 0, {
    keyword: "cn",
    name: "中国",
  });
  return values;
}

function regionRowHtml(values, active) {
  const chips = values
    .map(
      (item) =>
        `<button class="chip${
          String(item.keyword) === String(active) ? " active" : ""
        }" type="button" data-region="${escapeAttr(item.keyword)}">${escapeHtml(
          item.name
        )}</button>`
    )
    .join("");
  return `<div class="filter-row" data-filter-row>
    <span class="filter-label">地区</span>
    <span class="filter-values">${chips}</span>
  </div>`;
}

function filtersHtml(
  condition,
  channel,
  filters,
  showMore = false,
  regionValues = [],
  seasonType = 1
) {
  const groups = new Map((condition?.filters || []).map((group) => [group.field, group]));
  const rows = [];
  const orders = (condition?.orders || []).map((item) => ({
    keyword: String(item.value),
    name: item.label,
  }));
  if (orders.length) rows.push(filterRowHtml("排序", "order", orders, filters));

  if (channel === "bangumi" && regionValues.length) {
    rows.push(
      regionRowHtml(
        regionValues,
        seasonType === 4 ? "cn" : filters.area ?? "-1"
      )
    );
  }

  let yearField = "";
  for (const field of FILTER_FIELDS[channel] || FILTER_FIELDS.bangumi) {
    if (field === "release_date" || field === "year") yearField = field;
  }
  const used = new Set();
  for (const field of FILTER_FIELDS[channel] || FILTER_FIELDS.bangumi) {
    if (field === "year" && used.has("year")) continue;
    if (field === "year" && yearField === "release_date" && groups.has("release_date")) {
      continue;
    }
    const group = groups.get(field);
    if (!group) continue;
    if (field === "release_date" || field === "year") used.add("year");
    rows.push(
      filterRowHtml(FILTER_LABELS[field] || group.name || field, field, group.values, filters)
    );
  }
  if (showMore) {
    for (const field of extraFields(condition, channel)) {
      const group = groups.get(field);
      if (!group) continue;
      rows.push(
        filterRowHtml(FILTER_LABELS[field] || group.name || field, field, group.values, filters)
      );
    }
  }
  return rows.join("");
}

function shellHtml(channel, seasonType, filters) {
  const meta = GROUP_META[channel];
  const tabTypes = TAB_TYPES[channel] || groupTypes(channel);
  const tabs = tabTypes
    .map((value) => {
      const active =
        value === seasonType ||
        (channel === "bangumi" && value === 1 && seasonType === 4)
          ? " active"
          : "";
      return `<a class="chip${active}" href="${channelHref(channel, {
        type: value,
      })}">${escapeHtml(typeLabel(value))}</a>`;
    })
    .join("");
  return `
    <div class="bangumi-list-hero">
      <div>
        <h1 class="bangumi-list-title">${meta.title}</h1>
        <p class="bangumi-list-sub" data-list-sub>${meta.sub}</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-outline hidden" type="button" data-more-filters>
          更多筛选 ${icon("chevron-down", 14)}
        </button>
        <button class="btn btn-sm btn-outline hidden" type="button" data-clear-filters>
          ${icon("list-video", 14)}查看全部
        </button>
      </div>
    </div>
    ${tabs ? `<div class="chip-row" style="margin-bottom:14px">${tabs}</div>` : ""}
    <div class="library-filters" data-filters>
      <div class="filter-loading"><span class="spinner"></span>正在加载筛选条件…</div>
    </div>
    <div class="library-result-head">
      <span data-result-total>正在加载…</span>
      <span class="hint" data-active-filters></span>
    </div>
    <div data-bangumi-results>${skeletonGrid(12, { bangumi: true })}</div>`;
}

function resumeSeconds(play) {
  let value = Number(play?.last_play_time) || 0;
  const duration = Number(play?.duration) || 0;
  if (value > 0 && duration > 0 && value > duration + 5) value = value / 1000;
  return Math.max(0, value);
}

// ------------------------------------------------------------------- list

async function renderList(root, ctx) {
  const channel = groupChannel(ctx);
  const seasonType = normalizeType(ctx.query.get("type"), channel);
  const filters = readFilters(ctx.query);
  const meta = GROUP_META[channel];

  // 防止从旧链接进入另一个分组时标签与内容不一致
  if (ctx.query.get("type") && String(ctx.query.get("type")) !== String(seasonType)) {
    history.replaceState(null, "", filtersHref(channel, seasonType, filters));
  }

  root.innerHTML = shellHtml(channel, seasonType, filters);

  const results = root.querySelector("[data-bangumi-results]");
  const filtersEl = root.querySelector("[data-filters]");
  const sub = root.querySelector("[data-list-sub]");
  const totalEl = root.querySelector("[data-result-total]");
  const activeEl = root.querySelector("[data-active-filters]");
  const clearBtn = root.querySelector("[data-clear-filters]");
  const moreBtn = root.querySelector("[data-more-filters]");

  let disposed = false;
  let page = 0;
  let grid = null;
  let loader = null;
  let condition = null;
  let regionValues = [];
  let loadingMore = false;
  let loadSeq = 0;
  let lastTotal = 0;
  let showMore = EXTRA_FIELDS.some(
    (field) => filters[field] && filters[field] !== "-1"
  );
  const stopRefreshFab = useRefreshFab(() => ctx.refresh());

  const updateUrl = () => {
    history.replaceState(null, "", filtersHref(channel, seasonType, filters));
  };

  const paintFilters = () => {
    if (!filtersEl) return;
    filtersEl.innerHTML = condition
      ? filtersHtml(condition, channel, filters, showMore, regionValues, seasonType)
      : '<div class="filter-loading"><span class="spinner"></span>正在加载筛选条件…</div>';
    const extras = extraFields(condition, channel);
    if (moreBtn) {
      moreBtn.classList.toggle("hidden", !extras.length);
      moreBtn.innerHTML = `更多筛选 ${icon(showMore ? "chevron-up" : "chevron-down", 14)}`;
      moreBtn.setAttribute("aria-expanded", showMore ? "true" : "false");
    }
    clearBtn?.classList.toggle("hidden", !hasActiveFilters(filters));
  };

  const paintSummary = (total = lastTotal) => {
    lastTotal = Number(total) || 0;
    if (sub) {
      sub.textContent = lastTotal
        ? `共收录 ${formatCount(lastTotal)} 部${meta.noun}，按当前筛选排序。`
        : meta.sub;
    }
    if (totalEl) totalEl.textContent = lastTotal ? `共 ${formatCount(lastTotal)} 部` : "";
    if (activeEl) {
      const active = Object.entries(filters)
        .filter(([key, value]) => key !== "order" && value && value !== "-1")
        .map(([key, value]) => `${FILTER_LABELS[key] || key}：${filterChipName(condition, key, value)}`);
      if (channel === "bangumi" && seasonType === 4) active.unshift("地区：中国");
      activeEl.textContent = active.join(" · ");
    }
  };

  function append(items) {
    if (!items.length) return;
    if (!grid) {
      grid = document.createElement("div");
      grid.className = "bangumi-grid";
      results.append(grid);
    }
    grid.insertAdjacentHTML("beforeend", items.map((item) => bangumiCard(item)).join(""));
  }

  async function loadMore() {
    if (disposed || loadingMore) return false;
    loadingMore = true;
    try {
      const data = await bangumiList(page + 1, seasonType, filtersForApi(filters));
      if (disposed || ctx.signal.aborted) return false;
      page = data.page || page + 1;
      append(data.items || []);
      return Boolean(data.has_more);
    } catch (error) {
      if (!disposed) toast(errorText(error), "error");
      return false;
    } finally {
      loadingMore = false;
    }
  }

  async function loadFirst() {
    if (disposed) return;
    const token = ++loadSeq;
    loader?.remove();
    loader = null;
    grid = null;
    results.innerHTML = skeletonGrid(12, { bangumi: true });
    try {
      const data = await bangumiList(1, seasonType, filtersForApi(filters));
      if (disposed || ctx.signal.aborted || token !== loadSeq) return;
      page = data.page || 1;
      const items = data.items || [];
      results.innerHTML = "";
      paintSummary(data.total);
      if (!items.length) {
        results.innerHTML = emptyState(
          "没有符合条件的内容",
          "可以换个筛选条件，或查看全部内容。",
          `<button class="btn btn-primary" type="button" data-empty-retry>查看全部</button>`,
          "tv"
        );
        results.querySelector("[data-empty-retry]")?.addEventListener("click", () => {
          resetFilters();
        });
        return;
      }
      append(items);
      if (data.has_more) loader = createInfiniteLoader(results, loadMore);
    } catch (error) {
      if (disposed || ctx.signal.aborted || token !== loadSeq) return;
      results.innerHTML = errorState(error);
      results.querySelector("[data-retry]")?.addEventListener("click", () => loadFirst());
      if (totalEl) totalEl.textContent = "加载失败";
    }
  }

  function resetFilters() {
    for (const key of Object.keys(filters)) delete filters[key];
    filters.order = "1";
    showMore = false;
    paintFilters();
    updateUrl();
    loadFirst();
  }

  function applyFilter(field, value) {
    if (field === "order") filters.order = String(value || "1");
    else if (!value || value === "-1") delete filters[field];
    else filters[field] = String(value);
    paintFilters();
    updateUrl();
    loadFirst();
  }

  clearBtn?.addEventListener("click", resetFilters);
  moreBtn?.addEventListener("click", () => {
    showMore = !showMore;
    paintFilters();
  });
  filtersEl?.addEventListener("click", (event) => {
    const region = event.target.closest("[data-region]");
    if (region) {
      event.preventDefault();
      const value = region.dataset.region || "-1";
      const params = { type: value === "cn" ? 4 : 1 };
      if (value !== "cn" && value !== "-1") params.area = value;
      location.hash = channelHref(channel, params);
      return;
    }
    const chip = event.target.closest("[data-filter]");
    if (chip) {
      applyFilter(chip.dataset.filter, chip.dataset.value);
      return;
    }
    const more = event.target.closest("[data-filter-more]");
    if (!more) return;
    const row = more.closest("[data-filter-row]");
    if (!row) return;
    row.classList.toggle("collapsed");
    more.textContent = row.classList.contains("collapsed") ? "查看全部" : "收起";
  });

  getFilterSet(seasonType)
    .then((value) => {
      if (disposed || ctx.signal.aborted) return;
      condition = value;
      paintFilters();
      paintSummary();
      if (channel === "bangumi") {
        getFilterSet(1)
          .then((base) => {
            if (disposed || ctx.signal.aborted) return;
            regionValues = buildRegionValues(base);
            paintFilters();
          })
          .catch(() => {
            if (disposed || ctx.signal.aborted) return;
            regionValues = buildRegionValues(null);
            paintFilters();
          });
      }
    })
    .catch(() => {
      if (disposed || !filtersEl) return;
      filtersEl.innerHTML =
        '<div class="filter-loading">筛选条件加载失败，可以直接浏览内容。</div>';
    });

  loadFirst();

  return () => {
    disposed = true;
    loader?.remove();
    loader = null;
    stopRefreshFab();
  };
}

// ----------------------------------------------------------------- detail

function episodeLabel(episode, index) {
  return episode?.title || `第 ${index + 1} 话`;
}

function episodeSub(episode) {
  if (episode?.long_title) return episode.long_title;
  return episode?.duration ? formatDuration(episode.duration) : "";
}

function skipRanges(episode) {
  const ranges = [];
  const opStart = Number(episode?.skip_op_start) || 0;
  const opEnd = Number(episode?.skip_op_end) || 0;
  if (opStart > 0 && opEnd > opStart) {
    ranges.push({ from: opStart, to: opEnd, label: "跳过片头" });
  }
  const edStart = Number(episode?.skip_ed_start) || 0;
  const edEnd = Number(episode?.skip_ed_end) || 0;
  if (edStart > 0 && edEnd > edStart) {
    ranges.push({ from: edStart, to: edEnd, label: "跳过片尾" });
  }
  return ranges;
}

async function renderDetail(root, ctx, seasonId) {
  root.innerHTML = `
    <div class="skeleton" style="height:310px;border-radius:18px"></div>
    <div style="margin-top:18px">${skeletonGrid(8, { bangumi: true })}</div>`;

  let detail;
  try {
    detail = await bangumiDetail(seasonId);
  } catch (error) {
    if (ctx.signal.aborted) return () => {};
    root.innerHTML = errorState(error);
    root.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
    return () => {};
  }
  if (ctx.signal.aborted) return () => {};

  const episodes = Array.isArray(detail.episodes) ? detail.episodes : [];
  const seasons = Array.isArray(detail.seasons) ? detail.seasons : [];
  const score = String(detail.score || "").trim();
  const hasScore = score && score !== "0" && score !== "0.0";
  const title = detail.title || detail.season_title || "未命名番剧";
  const subTitle =
    detail.season_title && detail.season_title !== title ? detail.season_title : "";
  const summary = String(detail.summary || detail.evaluate || "").trim();
  const tags = [...(detail.areas || []), ...(detail.styles || [])].filter(Boolean);

  root.innerHTML = `
    <section class="bangumi-hero">
      ${imgTag(detail.cover, {
        w: 1280,
        h: 720,
        alt: "",
        className: "bangumi-hero-bg",
      })}
      <div class="bangumi-hero-content">
        <div class="bangumi-poster">
          ${imgTag(detail.cover, { w: 336, h: 448, alt: title })}
        </div>
        <div class="bangumi-info">
          <h1>${escapeHtml(title)}</h1>
          <div class="bangumi-info-sub">${escapeHtml(subTitle || detail.up_name || "")}</div>
          <div class="bangumi-info-meta">
            ${
              hasScore
                ? `<span class="bangumi-score-big">${escapeHtml(score)}<small>分</small></span>`
                : ""
            }
            ${detail.badge ? `<span class="badge badge-brand">${escapeHtml(detail.badge)}</span>` : ""}
            ${detail.index_show ? `<span class="hint">${escapeHtml(detail.index_show)}</span>` : ""}
            ${detail.pub_time ? `<span class="hint">${escapeHtml(detail.pub_time)}</span>` : ""}
          </div>
          ${
            tags.length
              ? `<div class="bangumi-info-tags">${tags
                  .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
                  .join("")}</div>`
              : ""
          }
          ${summary ? `<p class="bangumi-summary">${escapeHtml(summary)}</p>` : ""}
          <div class="bangumi-info-actions">
            ${
              episodes.length
                ? `<button class="btn btn-primary" type="button" data-start>${icon(
                    "play",
                    15
                  )}立即观看</button>`
                : ""
            }
            <button class="btn btn-soft" type="button" data-external>${icon(
              "external-link",
              15
            )}在浏览器打开</button>
          </div>
          <div class="bangumi-info-stats">
            <span><b>${formatCount(detail.stat_views)}</b> 播放</span>
            <span><b>${formatCount(detail.stat_follows)}</b> 追番</span>
            <span><b>${Number(detail.total_ep) || episodes.length}</b> 话</span>
            ${detail.up_name ? `<span>出品：${escapeHtml(detail.up_name)}</span>` : ""}
          </div>
        </div>
      </div>
    </section>

    ${
      seasons.length > 1
        ? `<div class="season-chips">
            ${seasons
              .map(
                (season) =>
                  `<a class="season-chip${
                    Number(season.season_id) === Number(detail.season_id) ? " active" : ""
                  }" href="#/bangumi/${Number(season.season_id)}">${escapeHtml(
                    season.title || `第 ${season.season_id} 季`
                  )}</a>`
              )
              .join("")}
          </div>`
        : ""
    }

    <div class="bangumi-player-block" data-player-block hidden>
      <div class="bangumi-player-head">
        <div class="bangumi-player-title" data-player-title></div>
        <div class="bangumi-ep-nav">
          <button class="btn btn-sm btn-soft" type="button" data-prev>${icon(
            "chevron-left",
            14
          )}上一集</button>
          <button class="btn btn-sm btn-soft" type="button" data-next>下一集${icon(
            "chevron-right",
            14
          )}</button>
        </div>
      </div>
      <div data-player-mount></div>
    </div>

    <section class="bangumi-episodes-card">
      <div class="bangumi-episodes-head">
        <h2>选集</h2>
        <span class="sub">${episodes.length} 集</span>
      </div>
      ${
        episodes.length
          ? `<div class="episode-grid" data-episode-grid>
              ${episodes
                .map(
                  (episode, index) => `<button class="episode-btn" type="button" data-episode="${index}">
                    <span class="ep-name">${escapeHtml(episodeLabel(episode, index))}</span>
                    <span class="ep-sub">${escapeHtml(episodeSub(episode))}</span>
                    ${episode.badge ? `<span class="ep-badge">${escapeHtml(episode.badge)}</span>` : ""}
                  </button>`
                )
                .join("")}
            </div>`
          : emptyState("暂无剧集", "这部番剧暂时没有可播放的剧集。", "", "tv")
      }
    </section>`;

  document.title = `${title} - Bilibili-Tauri`;

  const playerBlock = root.querySelector("[data-player-block]");
  const playerMount = root.querySelector("[data-player-mount]");
  const playerTitle = root.querySelector("[data-player-title]");
  const episodeGrid = root.querySelector("[data-episode-grid]");
  const prevBtn = root.querySelector("[data-prev]");
  const nextBtn = root.querySelector("[data-next]");

  let player = null;
  let currentIndex = -1;
  let episodeToken = 0;
  let disposed = false;

  const cleanup = () => {
    disposed = true;
    episodeToken += 1;
    player?.destroy();
    player = null;
  };

  const selectEpisode = async (
    index,
    { scroll = true, autoplay = true } = {}
  ) => {
    if (disposed || index < 0 || index >= episodes.length) return;
    const episode = episodes[index];
    currentIndex = index;
    playerBlock.hidden = false;
    playerTitle.innerHTML = `${escapeHtml(episodeLabel(episode, index))}<span class="sub">${escapeHtml(
      episodeSub(episode)
    )}</span>`;
    episodeGrid
      ?.querySelectorAll("[data-episode]")
      .forEach((button) =>
        button.classList.toggle("active", Number(button.dataset.episode) === index)
      );
    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) nextBtn.disabled = index === episodes.length - 1;

    const label = `${title} · ${episodeLabel(episode, index)}`;
    if (!player) {
      player = new Player(playerMount, {
        quality: store.get("quality"),
        onEnded: () => {
          if (store.get("autoplay") === false) return;
          if (currentIndex < episodes.length - 1) {
            selectEpisode(currentIndex + 1, { scroll: false, autoplay: true });
          }
        },
      });
    }
    player.setTitle(label);
    player.setSkipRanges(skipRanges(episode));
    player.showLoading();

    const token = ++episodeToken;
    try {
      const play = await pgcPlayInfo(
        episode.ep_id,
        episode.cid,
        store.get("quality"),
        pgcPlayOptions()
      );
      if (disposed || token !== episodeToken) return;
      play.streams = orderStreams(play.streams);
      const resume = store.get("resume") ? resumeSeconds(play) : 0;
      const ok = player.setSource(play, {
        title: label,
        startTime: resume,
        autoplay: autoplay && store.get("autoplay") !== false,
      });
      if (!ok) {
        player.showError("没有获取到可播放的视频流，请稍后重试。", () =>
          selectEpisode(index, { scroll: false, autoplay })
        );
      }
      fetchDanmaku(episode.cid)
        .then((items) => {
          if (!disposed && token === episodeToken) player?.setDanmaku(items);
        })
        .catch(() => {});
      history.replaceState(null, "", `#/bangumi/${seasonId}?ep=${episode.ep_id}`);
      if (scroll) {
        playerBlock.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (error) {
      if (disposed || token !== episodeToken) return;
      player.showError(errorText(error), () =>
        selectEpisode(index, { scroll: false, autoplay })
      );
    }
  };

  episodeGrid?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-episode]");
    if (!button) return;
    const index = Number(button.dataset.episode);
    if (index === currentIndex && player) {
      playerBlock.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    selectEpisode(index, { scroll: true, autoplay: true });
  });

  root.querySelector("[data-start]")?.addEventListener("click", () => {
    const target = Math.max(0, currentIndex);
    selectEpisode(target, { scroll: true, autoplay: true });
  });

  prevBtn?.addEventListener("click", () => {
    selectEpisode(currentIndex - 1, { scroll: false, autoplay: true });
  });

  nextBtn?.addEventListener("click", () => {
    selectEpisode(currentIndex + 1, { scroll: false, autoplay: true });
  });

  root.querySelector("[data-external]")?.addEventListener("click", async () => {
    const ok = await openExternal(`https://www.bilibili.com/bangumi/play/ss${seasonId}`);
    if (!ok) toast("无法打开浏览器", "error");
  });

  const queryEp = Number(ctx.query.get("ep")) || 0;
  const initialIndex = queryEp
    ? episodes.findIndex((episode) => Number(episode.ep_id) === queryEp)
    : -1;
  if (initialIndex >= 0) {
    selectEpisode(initialIndex, { scroll: false, autoplay: true });
  }

  return cleanup;
}

export async function render(root, ctx) {
  const seasonId = Number(ctx.params.seasonId) || 0;
  if (seasonId) return renderDetail(root, ctx, seasonId);
  return renderList(root, ctx);
}
