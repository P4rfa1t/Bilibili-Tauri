import {
  liveAreas,
  liveFeed,
  livePlayInfo,
  liveRoomDetail,
  liveRooms,
  openUrl,
} from "../api.js";
import { icon } from "../icons.js";
import { mpegtsConfig, orderLiveUrls } from "../media.js";
import { store } from "../store.js";
import {
  avatarTag,
  emptyState,
  errorState,
  pageHead,
  skeletonPlayer,
  skeletonRows,
  toast,
} from "../ui.js";
import {
  errorText,
  escapeAttr,
  escapeHtml,
  formatCount,
  imgTag,
} from "../utils.js";

const TABS = [
  { key: "recommend", label: "推荐直播", iconName: "flame" },
  { key: "areas", label: "直播分区", iconName: "list" },
];

let areaCache = null;

async function getAreas() {
  if (!areaCache) {
    areaCache = liveAreas().catch((error) => {
      areaCache = null;
      throw error;
    });
  }
  return areaCache;
}

function roomHref(room) {
  const id = Number(room?.room_id) || 0;
  return id ? `#/live/${id}` : "#/live";
}

function liveBadge(room) {
  const living = Number(room?.live_status) !== 0;
  return `<span class="live-card-badge${living ? "" : " offline"}"><i class="live-dot"></i>${
    living ? "直播中" : "未开播"
  }</span>`;
}

function roomCard(room) {
  if (!room) return "";
  return `<a class="live-card" href="${roomHref(room)}" aria-label="${escapeAttr(
    room.title || "直播间"
  )}">
    <div class="live-card-cover">
      ${imgTag(room.cover || room.face, { w: 480, h: 270, alt: room.title })}
      ${liveBadge(room)}
      <span class="live-card-online">${icon("eye", 12)}${formatCount(room.online)}</span>
      <span class="live-card-hover">${icon("play", 24)}</span>
    </div>
    <div class="live-card-body">
      <div class="live-card-title">${escapeHtml(room.title || "未命名直播间")}</div>
      <div class="live-card-meta">
        <span class="live-card-anchor">${escapeHtml(room.uname || "未知主播")}</span>
        ${
          room.area_name
            ? `<span class="live-card-area">${escapeHtml(room.area_name)}</span>`
            : ""
        }
      </div>
    </div>
  </a>`;
}

function liveHero(room) {
  if (!room) return "";
  return `<a class="live-hero" href="${roomHref(room)}" aria-label="${escapeAttr(
    room.title || "直播间"
  )}">
    ${imgTag(room.cover, {
      w: 1280,
      h: 720,
      alt: room.title,
      className: "live-hero-bg",
      eager: true,
    })}
    <div class="live-hero-shade"></div>
    <div class="live-hero-inner">
      <span class="live-hero-tag"><i class="live-dot"></i>正在直播${
        room.area_name ? ` · ${escapeHtml(room.area_name)}` : ""
      }</span>
      <h2 class="live-hero-title">${escapeHtml(room.title || "未命名直播间")}</h2>
      <div class="live-hero-meta">
        <span>${avatarTag(room.face, room.uname, "avatar avatar-sm")}${escapeHtml(
    room.uname || "未知主播"
  )}</span>
        <span>${icon("eye", 14)}${formatCount(room.online)} 人气</span>
      </div>
      <span class="btn btn-glass live-hero-btn">${icon("play", 15)}进入直播间</span>
    </div>
  </a>`;
}

function toolbar(tab) {
  return `<div class="home-toolbar live-toolbar">
    <div class="home-toolbar-left">
      <div class="tabs">${TABS.map(
        (item) =>
          `<a class="tab${item.key === tab ? " active" : ""}" href="#/live?tab=${
            item.key
          }">${icon(item.iconName, 14)}${item.label}</a>`
      ).join("")}</div>
    </div>
  </div>`;
}

function skeletonCards(count) {
  return Array.from(
    { length: count },
    () => `<div class="skeleton-card">
      <div class="skeleton skeleton-cover"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line short"></div>
    </div>`
  ).join("");
}

function bindRetry(root, ctx) {
  root.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
}

async function renderFeed(root, ctx) {
  const body = root.querySelector("#live-body");
  if (!body) return;

  try {
    const data = await liveFeed();
    if (ctx.signal.aborted) return;
    const recommend = data.recommend || [];
    const modules = (data.modules || []).filter((m) => (m.rooms || []).length);

    if (!recommend.length && !modules.length) {
      body.innerHTML = emptyState(
        "暂时没有直播",
        "稍后再来看看，或者去 B 站直播首页逛逛。",
        `<button class="btn btn-primary" data-retry type="button">重新加载</button>`,
        "radio"
      );
      bindRetry(body, ctx);
      return;
    }

    const [hero, ...rest] = recommend;
    let html = "";
    if (hero) html += liveHero(hero);
    if (rest.length) {
      html += `<div class="live-grid live-recommend-grid">${rest
        .map(roomCard)
        .join("")}</div>`;
    }
    for (const mod of modules) {
      html += `<section class="live-module">
        <div class="live-module-head">
          <h2 class="section-title">${icon("radio", 17)}${escapeHtml(
        mod.title || "直播分区"
      )}</h2>
          <span class="live-module-count">${(mod.rooms || []).length} 个直播</span>
        </div>
        <div class="live-grid">${(mod.rooms || []).map(roomCard).join("")}</div>
      </section>`;
    }
    body.innerHTML = html;
  } catch (error) {
    if (ctx.signal.aborted) return;
    body.innerHTML = errorState(error, { retry: true });
    bindRetry(body, ctx);
  }
}

async function loadAreaRooms(area, page, { grid, more, signal, append = false }) {
  if (!grid || !more) return;
  if (append) {
    more.innerHTML = `<span class="live-loading"><span class="spinner"></span>加载中…</span>`;
  }

  try {
    const data = await liveRooms(area.id, area.name, page);
    if (signal.aborted) return;
    const items = data.items || [];

    if (!append) {
      if (!items.length) {
        grid.classList.add("live-grid-empty");
        grid.innerHTML = emptyState(
          "这个分区暂时没有直播",
          "换个分区看看，或者稍后再来。",
          "",
          "radio"
        );
        more.innerHTML = "";
        return;
      }
      grid.classList.remove("live-grid-empty");
      grid.innerHTML = items.map(roomCard).join("");
    } else if (items.length) {
      grid.insertAdjacentHTML("beforeend", items.map(roomCard).join(""));
    }

    if (data.has_more) {
      more.innerHTML = `<button class="btn btn-outline" data-load-more type="button">加载更多</button>`;
      const button = more.querySelector("[data-load-more]");
      button?.addEventListener("click", () => {
        button.disabled = true;
        loadAreaRooms(area, page + 1, { grid, more, signal, append: true });
      });
    } else {
      more.innerHTML = items.length ? `<span class="live-list-end">没有更多了</span>` : "";
    }
  } catch (error) {
    if (signal.aborted) return;
    if (append) {
      more.innerHTML = `<span class="live-list-error">${escapeHtml(errorText(error))}</span>`;
    } else {
      grid.classList.add("live-grid-empty");
      grid.innerHTML = errorState(error, { retry: true });
      grid.querySelector("[data-retry]")?.addEventListener("click", () => {
        if (signal.aborted) return;
        grid.classList.remove("live-grid-empty");
        grid.innerHTML = skeletonCards(8);
        loadAreaRooms(area, 1, { grid, more, signal });
      });
    }
  }
}

async function renderAreas(root, ctx) {
  const body = root.querySelector("#live-body");
  if (!body) return;
  body.innerHTML = `<div class="live-area-loading">${skeletonRows(4)}</div>`;

  let groups;
  try {
    groups = await getAreas();
  } catch (error) {
    if (ctx.signal.aborted) return;
    body.innerHTML = errorState(error, { title: "分区加载失败", retry: true });
    bindRetry(body, ctx);
    return;
  }
  if (ctx.signal.aborted) return;

  groups = (groups || []).filter((g) => (g.areas || []).length);
  if (!groups.length) {
    body.innerHTML = emptyState("暂时没有分区数据", "稍后再试一次。", "", "list");
    return;
  }

  const wantedGroup = Number(ctx.query.get("group") || 0);
  const group = groups.find((g) => Number(g.id) === wantedGroup) || groups[0];
  const wantedArea = Number(ctx.query.get("area") || 0);
  const area =
    group.areas.find((a) => Number(a.id) === wantedArea) || group.areas[0];

  const groupTabs = groups
    .map((g) => {
      const firstArea = g.areas[0];
      return `<a class="tab${Number(g.id) === Number(group.id) ? " active" : ""}" href="#/live?tab=areas&group=${
        g.id
      }&area=${firstArea.id}">${escapeHtml(g.name)}</a>`;
    })
    .join("");

  const areaChips = group.areas
    .map(
      (a) =>
        `<a class="chip${Number(a.id) === Number(area.id) ? " active" : ""}" href="#/live?tab=areas&group=${
          group.id
        }&area=${a.id}" title="${escapeAttr(a.name)}">${escapeHtml(a.name)}</a>`
    )
    .join("");

  body.innerHTML = `<div class="live-area-panel">
      <div class="live-area-groups"><div class="tabs">${groupTabs}</div></div>
      <div class="live-area-chips">${areaChips}</div>
    </div>
    <div class="live-area-result">
      <div class="live-module-head">
        <h2 class="section-title">${icon("radio", 17)}${escapeHtml(
    area.name
  )}<span class="live-area-parent">${escapeHtml(group.name)}</span></h2>
        <span class="live-module-count">按人气排序</span>
      </div>
      <div class="live-grid" data-area-grid>${skeletonCards(12)}</div>
      <div class="live-more" data-area-more></div>
    </div>`;

  const grid = body.querySelector("[data-area-grid]");
  const more = body.querySelector("[data-area-more]");
  await loadAreaRooms(area, 1, { grid, more, signal: ctx.signal });
}

function roomBadge(detail, play) {
  const living =
    Number(detail?.live_status) === 1 &&
    (!play || Number(play.live_status) === 1);
  return `<span class="live-room-state${living ? "" : " offline"}"><i class="live-dot"></i>${
    living ? "直播中" : "未开播"
  }</span>`;
}

function roomMeta(detail, play) {
  const parts = [];
  if (detail.online) {
    parts.push(`<span>${icon("eye", 14)}${formatCount(detail.online)} 人气</span>`);
  }
  if (detail.attention) {
    parts.push(`<span>${icon("user", 14)}${formatCount(detail.attention)} 关注</span>`);
  }
  if (detail.parent_area_name || detail.area_name) {
    const area = [detail.parent_area_name, detail.area_name]
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(" · ");
    parts.push(`<span>${icon("radio", 14)}${escapeHtml(area)}</span>`);
  }
  if (detail.live_time) {
    parts.push(`<span>${icon("clock", 14)}${escapeHtml(detail.live_time)} 开播</span>`);
  }
  if (play?.quality_desc) {
    parts.push(`<span>${icon("gauge", 14)}${escapeHtml(play.quality_desc)}</span>`);
  }
  return parts.join("");
}

function initPlayer(root, ctx, detail, play) {
  const video = root.querySelector("[data-live-video]");
  const overlay = root.querySelector("[data-live-overlay]");
  const buffering = root.querySelector("[data-live-buffering]");
  if (!video || !overlay) return () => {};

  const urls = orderLiveUrls(play);
  const living =
    Number(detail?.live_status) === 1 &&
    (!play || Number(play.live_status) === 1);
  let player = null;
  let attempt = 0;
  let disposed = false;
  let retryTimer = 0;

  const showOverlay = (html) => {
    overlay.hidden = false;
    overlay.innerHTML = html;
  };
  const hideOverlay = () => {
    overlay.hidden = true;
  };

  const destroy = () => {
    if (!player) return;
    try {
      player.pause();
    } catch (_) {}
    try {
      player.unload();
    } catch (_) {}
    try {
      player.detachMediaElement();
    } catch (_) {}
    try {
      player.destroy();
    } catch (_) {}
    player = null;
  };

  const fail = (message) => {
    if (disposed) return;
    if (buffering) buffering.hidden = true;
    showOverlay(`<div class="live-player-error">${icon("alert-circle", 28)}<p>${escapeHtml(
      message
    )}</p><button class="btn btn-primary btn-sm" data-play-retry type="button">重新连接</button></div>`);
  };

  const start = () => {
    if (disposed || !living) return;
    if (!urls.length) {
      fail("暂时没有获取到直播播放地址");
      return;
    }
    if (!window.mpegts) {
      fail("直播播放器脚本没有加载，请重新打开应用");
      return;
    }
    if (!window.mpegts.isSupported()) {
      fail("当前环境不支持 MSE 直播播放");
      return;
    }

    destroy();
    const url = urls[Math.min(attempt, urls.length - 1)];
    if (buffering) buffering.hidden = true;
    showOverlay(`<span class="live-connecting"><span class="spinner"></span>正在连接直播流…</span>`);

    const mpegts = window.mpegts;
    player = mpegts.createPlayer(
      { type: "flv", isLive: true, url },
      mpegtsConfig()
    );
    player.attachMediaElement(video);
    player.on(mpegts.Events.ERROR, () => {
      if (disposed) return;
      if (attempt < Math.min(urls.length - 1, 2)) {
        attempt += 1;
        showOverlay(
          `<span class="live-connecting"><span class="spinner"></span>线路异常，正在切换备用线路…</span>`
        );
        retryTimer = setTimeout(start, 600);
      } else {
        fail("直播流连接失败，可能是主播未开播或网络受限");
      }
    });
    player.load();
    player
      .play()
      .then(hideOverlay)
      .catch(() => {
        if (disposed) return;
        showOverlay(
          `<div class="live-player-error">${icon("play-circle", 30)}<p>点击开始播放</p><button class="btn btn-primary btn-sm" data-play-gate type="button">播放直播</button></div>`
        );
      });
  };

  const onPlaying = () => {
    if (buffering) buffering.hidden = true;
    hideOverlay();
  };
  const onWaiting = () => {
    if (!overlay.hidden) return;
    if (buffering) buffering.hidden = false;
  };
  video.addEventListener("playing", onPlaying);
  video.addEventListener("waiting", onWaiting);

  const onClick = (event) => {
    const retry = event.target.closest("[data-play-retry]");
    const gate = event.target.closest("[data-play-gate]");
    if (!retry && !gate) return;
    attempt = 0;
    if (gate && player) {
      player
        .play()
        .then(hideOverlay)
        .catch(() => fail("播放失败，请重试"));
      return;
    }
    start();
  };
  overlay.addEventListener("click", onClick);

  if (!living) {
    showOverlay(
      `<div class="live-player-error live-offline">${icon("moon", 30)}<p>主播当前未开播</p><span>可以先看看主播的主页或稍后再来</span></div>`
    );
  } else {
    start();
  }

  return () => {
    disposed = true;
    clearTimeout(retryTimer);
    if (buffering) buffering.hidden = true;
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("waiting", onWaiting);
    overlay.removeEventListener("click", onClick);
    destroy();
  };
}

async function renderRoom(root, ctx, roomId) {
  root.innerHTML = `<div class="live-room-page">
    <div class="live-room-topbar">
      <a class="btn btn-sm btn-outline" href="#/live">${icon("arrow-left", 14)}直播首页</a>
    </div>
    <div class="live-room-loading">${skeletonPlayer()}</div>
  </div>`;

  const [detailResult, playResult] = await Promise.allSettled([
    liveRoomDetail(roomId),
    livePlayInfo(roomId, Number(store.get("liveQuality")) || 0),
  ]);
  if (ctx.signal.aborted) return () => {};

  if (detailResult.status !== "fulfilled") {
    root.innerHTML = `<div class="live-room-page">
      <div class="live-room-topbar">
        <a class="btn btn-sm btn-outline" href="#/live">${icon("arrow-left", 14)}直播首页</a>
      </div>
      ${errorState(detailResult.reason, { title: "直播间加载失败", retry: true })}
    </div>`;
    bindRetry(root, ctx);
    return () => {};
  }

  const detail = detailResult.value || {};
  const play = playResult.status === "fulfilled" ? playResult.value : null;
  const cover = detail.keyframe || detail.cover;
  const tags = (detail.tags || [])
    .map((tag) => `<span class="live-room-tag">${escapeHtml(tag)}</span>`)
    .join("");
  const playError =
    playResult.status === "rejected" ? errorText(playResult.reason) : "";

  root.innerHTML = `<div class="live-room-page">
    <div class="live-room-topbar">
      <a class="btn btn-sm btn-outline" href="#/live">${icon("arrow-left", 14)}直播首页</a>
      ${roomBadge(detail, play)}
      <div class="live-room-actions">
        <button class="btn btn-sm btn-outline" data-room-refresh type="button">${icon(
          "refresh-cw",
          14
        )}刷新</button>
        <button class="btn btn-sm btn-outline" data-room-open type="button">${icon(
          "external-link",
          14
        )}原网页</button>
      </div>
    </div>

    <div class="live-watch-layout">
      <div class="live-watch-main">
        <div class="live-player-shell">
          <video
            data-live-video
            playsinline
            controls
            preload="none"
            referrerpolicy="no-referrer"
            poster="${escapeAttr(cover || "")}"
          ></video>
          <div class="live-player-overlay" data-live-overlay>
            <span class="live-connecting"><span class="spinner"></span>正在加载直播间…</span>
          </div>
          <span class="live-buffering" data-live-buffering hidden><span class="spinner"></span>缓冲中…</span>
        </div>

        <div class="live-room-info">
          <h1 class="live-room-title">${escapeHtml(detail.title || "未命名直播间")}</h1>
          <div class="live-room-meta">
            <a class="live-room-anchor" href="#/space/${Number(detail.uid) || 0}">
              ${avatarTag(detail.face, detail.uname, "avatar avatar-sm")}
              <span>${escapeHtml(detail.uname || "未知主播")}</span>
            </a>
            ${roomMeta(detail, play)}
          </div>
          ${tags ? `<div class="live-room-tags">${tags}</div>` : ""}
          ${
            detail.description
              ? `<p class="live-room-desc">${escapeHtml(detail.description)}</p>`
              : ""
          }
          ${
            playError
              ? `<p class="live-room-play-error">${icon("alert-triangle", 14)}${escapeHtml(
                  playError
                )}</p>`
              : ""
          }
        </div>
      </div>

      <aside class="live-watch-side">
        <div class="live-side-card">
          <div class="live-side-anchor">
            ${avatarTag(detail.face, detail.uname, "avatar avatar-lg")}
            <div>
              <div class="live-side-name">${escapeHtml(detail.uname || "未知主播")}</div>
              <div class="live-side-sub">${formatCount(detail.attention)} 人关注</div>
            </div>
          </div>
          <div class="live-side-actions">
            <a class="btn btn-sm btn-primary" href="#/space/${Number(detail.uid) || 0}">${icon(
    "user",
    14
  )}主播主页</a>
            <button class="btn btn-sm btn-outline" data-room-open type="button">${icon(
              "external-link",
              14
            )}打开直播间</button>
          </div>
        </div>

        <div class="live-side-card">
          <h3 class="live-side-title">直播信息</h3>
          <dl class="live-side-list">
            <div><dt>分区</dt><dd>${escapeHtml(
              [detail.parent_area_name, detail.area_name].filter(Boolean).join(" · ") || "未知"
            )}</dd></div>
            <div><dt>开播时间</dt><dd>${escapeHtml(detail.live_time || "—")}</dd></div>
            <div><dt>清晰度</dt><dd>${escapeHtml(play?.quality_desc || "自动")}</dd></div>
            <div><dt>房间号</dt><dd>${escapeHtml(String(detail.room_id || roomId))}</dd></div>
          </dl>
        </div>
      </aside>
    </div>
  </div>`;

  root.querySelector("[data-room-refresh]")?.addEventListener("click", () => ctx.refresh());
  root.querySelectorAll("[data-room-open]").forEach((button) => {
    button.addEventListener("click", () => {
      openUrl(`https://live.bilibili.com/${roomId}`).catch((error) => {
        toast(errorText(error), "error");
      });
    });
  });

  return initPlayer(root, ctx, detail, play);
}

export async function render(root, ctx) {
  const roomId = Number(ctx.params.roomId || 0);
  if (roomId > 0) {
    return renderRoom(root, ctx, roomId);
  }

  const tabParam = ctx.query.get("tab");
  const tab = TABS.some((item) => item.key === tabParam) ? tabParam : "recommend";
  root.innerHTML = `
    ${pageHead({
      title: "直播",
      subtitle: "看看正在直播的 UP 主，或者按分区发现新主播。",
      actions: `<button class="btn btn-sm btn-outline refresh-btn" data-refresh type="button">${icon(
        "refresh-cw",
        14
      )}刷新</button>`,
    })}
    ${toolbar(tab)}
    <div id="live-body"></div>`;

  root.querySelector("[data-refresh]")?.addEventListener("click", () => ctx.refresh());

  if (tab === "areas") {
    await renderAreas(root, ctx);
  } else {
    await renderFeed(root, ctx);
  }
  return () => {};
}
