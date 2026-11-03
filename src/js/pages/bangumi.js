import {
  bangumiDetail,
  bangumiList,
  danmaku as fetchDanmaku,
  openExternal,
  pgcPlayInfo,
} from "../api.js";
import { BANGUMI_TYPES } from "../constants.js";
import { icon } from "../icons.js";
import { Player } from "../player/player.js";
import { store } from "../store.js";
import {
  bangumiCard,
  createInfiniteLoader,
  emptyState,
  errorState,
  skeletonGrid,
  toast,
} from "../ui.js";
import {
  errorText,
  escapeHtml,
  formatCount,
  formatDuration,
  imgTag,
} from "../utils.js";

function normalizeType(value) {
  const n = Number(value);
  return BANGUMI_TYPES.some((item) => item.value === n) ? n : 1;
}

function resumeSeconds(play) {
  let value = Number(play?.last_play_time) || 0;
  const duration = Number(play?.duration) || 0;
  if (value > 0 && duration > 0 && value > duration + 5) value = value / 1000;
  return Math.max(0, value);
}

// ------------------------------------------------------------------- list

async function renderList(root, ctx) {
  const seasonType = normalizeType(ctx.query.get("type"));
  const typeLabel =
    BANGUMI_TYPES.find((item) => item.value === seasonType)?.label || "番剧";

  root.innerHTML = `
    <div class="bangumi-list-hero">
      <div>
        <h1 class="bangumi-list-title">番剧库</h1>
        <p class="bangumi-list-sub" data-list-sub>浏览正版番剧、国创、电影、纪录片与综艺。</p>
      </div>
      <button class="btn btn-sm btn-outline" type="button" data-refresh>
        ${icon("refresh-cw", 14)}刷新
      </button>
    </div>
    <div class="chip-row" style="margin-bottom:18px">
      ${BANGUMI_TYPES.map(
        (item) =>
          `<a class="chip${item.value === seasonType ? " active" : ""}" href="#/bangumi?type=${
            item.value
          }">${escapeHtml(item.label)}</a>`
      ).join("")}
    </div>
    <div data-bangumi-results>${skeletonGrid(12, { bangumi: true })}</div>`;

  const results = root.querySelector("[data-bangumi-results]");
  const sub = root.querySelector("[data-list-sub]");
  let disposed = false;
  let page = 0;
  let grid = null;
  let loader = null;

  root.querySelector("[data-refresh]")?.addEventListener("click", () => ctx.refresh());

  const append = (items) => {
    if (!items.length) return;
    if (!grid) {
      grid = document.createElement("div");
      grid.className = "bangumi-grid";
      results.append(grid);
    }
    grid.insertAdjacentHTML("beforeend", items.map((item) => bangumiCard(item)).join(""));
  };

  const loadMore = async () => {
    if (disposed) return false;
    const data = await bangumiList(page + 1, seasonType);
    if (disposed || ctx.signal.aborted) return false;
    page = data.page || page + 1;
    append(data.items || []);
    return Boolean(data.has_more);
  };

  try {
    const data = await bangumiList(1, seasonType);
    if (disposed || ctx.signal.aborted) return () => {};
    page = data.page || 1;
    const items = data.items || [];
    if (sub) {
      sub.textContent = data.total
        ? `共收录 ${formatCount(data.total)} 部${typeLabel}，按热门排序。`
        : `浏览正版${typeLabel}内容。`;
    }
    results.innerHTML = "";
    if (!items.length) {
      results.innerHTML = emptyState(
        "暂时没有内容",
        "换一个分类，或稍后再来看看。",
        `<button class="btn btn-primary" type="button" data-empty-retry>重新加载</button>`,
        "tv"
      );
      results
        .querySelector("[data-empty-retry]")
        ?.addEventListener("click", () => ctx.refresh());
    } else {
      append(items);
      if (data.has_more) loader = createInfiniteLoader(results, loadMore);
    }
  } catch (error) {
    if (disposed || ctx.signal.aborted) return () => {};
    results.innerHTML = errorState(error);
    results.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
    if (sub) sub.textContent = "番剧列表加载失败";
  }

  return () => {
    disposed = true;
    loader?.remove();
    loader = null;
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
    player.showLoading();

    const token = ++episodeToken;
    try {
      const play = await pgcPlayInfo(episode.ep_id, episode.cid, store.get("quality"));
      if (disposed || token !== episodeToken) return;
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
