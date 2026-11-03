import {
  bilibiliVideoUrl,
  coinVideo,
  commentLike,
  commentReplies,
  commentAdd,
  comments as fetchComments,
  createFavoriteFolder,
  danmaku as fetchDanmaku,
  favoriteFolders,
  favoriteVideo,
  followUser,
  interactionState,
  likeVideo,
  openExternal,
  openPlayerWindow,
  playInfo,
  reportProgress,
  subtitleCues,
  videoDetail,
  videoSubtitles,
  watchLaterAdd,
} from "../api.js";
import { icon } from "../icons.js";
import { ensureLogin } from "../login.js";
import { orderStreams, videoPlayOptions } from "../media.js";
import { Player } from "../player/player.js";
import { store } from "../store.js";
import {
  avatarTag,
  createInfiniteLoader,
  errorState,
  openImageViewer,
  openModal,
  skeletonPlayer,
  skeletonRows,
  toast,
} from "../ui.js";
import {
  copyText,
  errorText,
  escapeAttr,
  escapeHtml,
  formatCount,
  formatDate,
  formatDuration,
  imgTag,
  isLoginError,
  thumb,
  timeAgo,
} from "../utils.js";

function clampIndex(value, length) {
  const n = Number(value) || 1;
  return Math.min(length - 1, Math.max(0, n - 1));
}

function resumeSeconds(play) {
  let value = Number(play?.last_play_time) || 0;
  const duration = Number(play?.duration) || 0;
  if (value > 0 && duration > 0 && value > duration + 5) value = value / 1000;
  return Math.max(0, value);
}

function replyHtml(reply) {
  return `<div class="comment-reply" data-sub-rpid="${Number(reply.rpid) || 0}" data-sub-mid="${
    Number(reply.mid) || 0
  }" data-sub-name="${escapeAttr(reply.name || "")}">
    ${avatarTag(reply.avatar, reply.name, "avatar avatar-sm")}
    <div class="comment-main">
      <div class="comment-head">
        <a class="comment-name" href="#/space/${Number(reply.mid) || 0}">${escapeHtml(
    reply.name || "匿名用户"
  )}</a>
        ${reply.level ? `<span class="level-badge">Lv${Number(reply.level)}</span>` : ""}
        <span class="comment-time">${escapeHtml(timeAgo(reply.ctime))}</span>
      </div>
      <div class="comment-text">${escapeHtml(reply.message || "")}</div>
    </div>
    <button class="comment-reply-btn" type="button" data-reply-to="${Number(reply.rpid) || 0}" data-reply-name="${escapeAttr(
    reply.name || ""
  )}">回复</button>
  </div>`;
}

function commentHtml(item) {
  const replies = Array.isArray(item.replies) ? item.replies : [];
  const pictures = Array.isArray(item.pictures) ? item.pictures : [];
  const rpid = Number(item.rpid) || 0;
  const replyCount = Number(item.reply_count) || 0;
  const hasMoreReplies = replyCount > replies.length;
  const liked = Number(item.like_action) === 1;
  return `<article class="comment" data-rpid="${rpid}" data-oid="${Number(item.oid) || 0}">
    ${avatarTag(item.avatar, item.name, "avatar avatar-sm")}
    <div class="comment-main">
      <div class="comment-head">
        <a class="comment-name" href="#/space/${Number(item.mid) || 0}">${escapeHtml(
    item.name || "匿名用户"
  )}</a>
        ${item.level ? `<span class="level-badge">Lv${Number(item.level)}</span>` : ""}
        <span class="comment-time">${escapeHtml(timeAgo(item.ctime))}</span>
      </div>
      <div class="comment-text">${escapeHtml(item.message || "")}</div>
      ${
        pictures.length
          ? `<div class="comment-pics">${pictures
              .map(
                (pic) =>
                  `<img src="${escapeAttr(thumb(pic, 216, 156))}" data-comment-pic="${escapeAttr(
                    pic
                  )}" alt="评论图片" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
              )
              .join("")}</div>`
          : ""
      }
      <div class="comment-actions">
        <button class="comment-reply-btn" type="button" data-reply-to="${rpid}" data-reply-name="${escapeAttr(
    item.name || ""
  )}">回复</button>
        <button class="comment-like${liked ? " active" : ""}" type="button" data-like-btn data-liked="${
    liked ? "1" : "0"
  }" data-count="${item.like || 0}">${icon("thumbs-up", 18)}<span class="like-count">${formatCount(
    item.like
  )}</span></button>
      </div>
      ${
        replies.length
          ? `<div class="comment-replies">${replies.map(replyHtml).join("")}</div>`
          : ""
      }
      ${
        hasMoreReplies
          ? `<div class="comment-more"><button class="btn btn-sm btn-soft" type="button" data-more-replies data-page="1">查看全部 ${formatCount(
              replyCount
            )} 条回复</button></div>`
          : ""
      }
    </div>
  </article>`;
}

/** 评论输入框：发表新评论 / 回复某条评论共用。 */
function commentComposerHtml() {
  return `<div class="comment-composer" data-composer>
    <span class="avatar avatar-sm" data-composer-avatar></span>
    <div class="comment-composer-body">
      <div class="comment-reply-hint" data-reply-hint hidden>
        <span>正在回复 <b data-reply-target></b></span>
        <button class="comment-reply-cancel" type="button" data-reply-cancel>取消</button>
      </div>
      <textarea class="comment-input" data-comment-input rows="2" placeholder="发一条友善的评论" maxlength="1000"></textarea>
      <div class="comment-composer-foot">
        <span class="comment-composer-count" data-comment-counter>0/1000</span>
        <button class="btn btn-sm btn-primary" type="button" data-comment-submit>发表评论</button>
      </div>
    </div>
  </div>`;
}

function pagesCardHtml(pages, activeIndex) {
  if (!pages || pages.length <= 1) return "";
  return `<section class="pages-card">
    <div class="pages-card-head">分P <span>${pages.length} 个视频</span></div>
    <div class="pages-list">
      ${pages
        .map(
          (page, index) => `<button class="page-item${
            index === activeIndex ? " active" : ""
          }" type="button" data-page-index="${index}">
            <span class="pidx">${Number(page.page) || index + 1}</span>
            <span class="ptitle">${escapeHtml(page.part || `P${index + 1}`)}</span>
            <span class="pidx">${escapeHtml(formatDuration(page.duration))}</span>
          </button>`
        )
        .join("")}
    </div>
  </section>`;
}

function relatedCardHtml(items) {
  if (!items || !items.length) return "";
  return `<section class="related-card">
    <div class="related-head">相关推荐 <span>${items.length} 个视频</span></div>
    <div class="related-list">
      ${items
        .map(
          (item) => `<a class="related-item" href="#/video/${encodeURIComponent(
            item.bvid
          )}">
            <span class="related-thumb">
              ${imgTag(item.cover, { w: 264, h: 148, alt: item.title })}
              ${item.duration ? `<span class="duration">${escapeHtml(item.duration)}</span>` : ""}
            </span>
            <span class="related-body">
              <span class="related-title">${escapeHtml(item.title || "无标题")}</span>
              <span class="related-meta">${escapeHtml(item.author || "未知 UP 主")} · ${formatCount(
            item.play
          )} 播放</span>
            </span>
          </a>`
        )
        .join("")}
    </div>
  </section>`;
}

function syncAction(button, { active, count }) {
  if (!button) return;
  button.classList.toggle("active", Boolean(active));
  const countEl = button.querySelector(".count");
  if (countEl && count !== undefined) countEl.textContent = formatCount(count);
}

export async function render(root, ctx) {
  const bvid = String(ctx.params.bvid || "").trim();
  if (!bvid) {
    root.innerHTML = errorState("视频地址无效", { retry: false });
    return () => {};
  }

  root.innerHTML = `<div class="watch-layout">
    <div class="watch-stage">
      <div class="watch-player">${skeletonPlayer()}</div>
    </div>
    <aside class="watch-rail">
      <div class="skeleton skeleton-line" style="width:78%;height:20px"></div>
      <div class="skeleton skeleton-line short" style="width:44%;margin-top:10px"></div>
      ${skeletonRows(4)}
    </aside>
  </div>`;

  let disposed = false;
  let player = null;
  let commentLoader = null;
  let onAuth = null;

  const cleanup = () => {
    disposed = true;
    commentLoader?.remove();
    commentLoader = null;
    player?.destroy();
    player = null;
    if (onAuth) window.removeEventListener("app:auth", onAuth);
  };

  let info;
  try {
    info = await videoDetail(bvid);
  } catch (error) {
    if (disposed || ctx.signal.aborted) return cleanup;
    root.innerHTML = errorState(error);
    root.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
    return cleanup;
  }
  if (disposed || ctx.signal.aborted) return cleanup;

  const pages =
    Array.isArray(info.pages) && info.pages.length
      ? info.pages
      : [{ cid: info.cid, page: 1, part: "正片", duration: info.duration }];
  const pageIndex = clampIndex(ctx.query.get("p"), pages.length);
  const currentPage = pages[pageIndex];
  const cid = currentPage.cid || info.cid;
  const owner = info.owner || { mid: 0, name: "未知 UP 主", face: "" };
  const stat = info.stat || {};
  const related = (info.related || [])
    .filter((item) => item && item.bvid !== bvid)
    .slice(0, 14);
  const queryStart = Math.max(0, Number(ctx.query.get("t")) || 0);
  const initialStart = queryStart > 0 ? queryStart : 0;
  const description = String(info.desc || "").trim();
  const descCollapsed = description.length > 260;

  root.innerHTML = `<div class="watch-layout">
    <div class="watch-stage">
      <div class="watch-player" data-player-mount></div>
    </div>

    <aside class="watch-rail">
      <div class="watch-tabs" data-watch-tabs>
        <button class="watch-tab active" type="button" data-watch-tab="intro">简介</button>
        <button class="watch-tab" type="button" data-watch-tab="comments">评论
          <span class="count" data-comment-count>${formatCount(stat.reply)}</span>
        </button>
        <button class="watch-tab-ext" type="button" data-open-window title="在新窗口打开">${icon(
          "external-link",
          14
        )}</button>
      </div>

      <div class="watch-panel" data-watch-panel="intro">
        <div class="watch-head">
          <h1 class="watch-title">${escapeHtml(info.title || "无标题")}</h1>
          <div class="watch-meta">
            <span>${icon("eye", 13)}${formatCount(stat.view)} 播放</span>
            <span>${icon("message-square", 13)}${formatCount(stat.danmaku)} 弹幕</span>
            <span class="dot"></span>
            <span>${icon("calendar", 13)}${escapeHtml(formatDate(info.pubdate))}</span>
            ${info.tname ? `<span class="badge badge-muted">${escapeHtml(info.tname)}</span>` : ""}
            ${pages.length > 1 ? `<span class="badge badge-muted">${pages.length}P</span>` : ""}
          </div>
          <div class="watch-actions">
            <button class="action-btn" type="button" data-act="like" title="点赞">
              ${icon("thumbs-up", 17)}<span class="count">${formatCount(stat.like)}</span>
            </button>
            <button class="action-btn coin" type="button" data-act="coin" title="投币">
              ${icon("coin", 17)}<span class="count">${formatCount(stat.coin)}</span>
            </button>
            <button class="action-btn" type="button" data-act="fav" title="收藏">
              ${icon("star", 17)}<span>收藏</span>
            </button>
            <button class="action-btn" type="button" data-act="watchlater" title="稍后再看">
              ${icon("clock", 17)}<span>稍后再看</span>
            </button>
            <span class="action-sep"></span>
            <button class="action-btn" type="button" data-act="share" title="分享">
              ${icon("share-2", 17)}<span>分享</span>
            </button>
          </div>
        </div>

        <section class="up-card">
          <div class="up-card-head">
            <a href="#/space/${owner.mid}" aria-label="${escapeAttr(owner.name)}">
              ${avatarTag(owner.face, owner.name, "up-avatar")}
            </a>
            <div style="min-width:0;flex:1">
              <a class="up-name" href="#/space/${owner.mid}">${escapeHtml(
    owner.name || "未知 UP 主"
  )}</a>
              <div class="up-sub">UID ${owner.mid} · ${formatCount(stat.favorite)} 收藏</div>
            </div>
            <button class="btn btn-primary btn-sm up-card-follow" type="button" data-follow>
              ${icon("plus", 14)}关注
            </button>
          </div>
        </section>

        ${
          description
            ? `<section class="watch-desc-card">
                <div class="watch-desc-text${descCollapsed ? " collapsed" : ""}" data-desc>${escapeHtml(
                description
              )}</div>
                ${
                  descCollapsed
                    ? `<button class="watch-desc-toggle" type="button" data-desc-toggle>展开更多</button>`
                    : ""
                }
                ${
                  info.tags?.length
                    ? `<div class="watch-tags">${(info.tags || [])
                        .slice(0, 18)
                        .map(
                          (tag) =>
                            `<a class="tag" href="#/search?q=${encodeURIComponent(
                              tag
                            )}">${escapeHtml(tag)}</a>`
                        )
                        .join("")}</div>`
                    : ""
                }
              </section>`
            : ""
        }

        ${pagesCardHtml(pages, pageIndex)}
      </div>

      <div class="watch-panel" data-watch-panel="comments" hidden>
        <section class="comments-card">
          <div class="comments-head">
            <div class="comments-title">评论</div>
            <div class="segmented" data-comment-sort>
              <button class="active" type="button" data-sort="hot">最热</button>
              <button type="button" data-sort="time">最新</button>
            </div>
          </div>
          <div class="comment-composer-slot" data-composer-slot>${commentComposerHtml()}</div>
          <div class="comment-list" data-comment-list>${skeletonRows(3)}</div>
        </section>
      </div>

      <div class="watch-rail-related">
        ${relatedCardHtml(related)}
      </div>
    </aside>
  </div>`;

  document.title = `${info.title || "视频"} - Bilibili-Tauri`;

  const mount = root.querySelector("[data-player-mount]");
  const likeBtn = root.querySelector('[data-act="like"]');
  const coinBtn = root.querySelector('[data-act="coin"]');
  const favBtn = root.querySelector('[data-act="fav"]');
  const watchLaterBtn = root.querySelector('[data-act="watchlater"]');
  const followBtn = root.querySelector("[data-follow]");
  const commentList = root.querySelector("[data-comment-list]");
  const commentCountEl = root.querySelector("[data-comment-count]");
  const commentCard = root.querySelector(".comments-card");
  const commentSortEl = root.querySelector("[data-comment-sort]");
  const tabsEl = root.querySelector("[data-watch-tabs]");

  // 右栏「简介 / 评论」切换
  let activeTab = "intro";
  tabsEl?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-watch-tab]");
    if (!button) return;
    activeTab = button.dataset.watchTab === "comments" ? "comments" : "intro";
    tabsEl
      .querySelectorAll("[data-watch-tab]")
      .forEach((item) => item.classList.toggle("active", item === button));
    root.querySelectorAll("[data-watch-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.watchPanel !== activeTab;
    });
  });

  // 单独开一个视频窗口
  root.querySelector("[data-open-window]")?.addEventListener("click", async () => {
    try {
      await openPlayerWindow("video", bvid, info.title || "");
    } catch (error) {
      toast(errorText(error), "error");
    }
  });

  let liked = false;
  let likeCount = Number(stat.like) || 0;
  let coinCount = 0;
  let coinTotal = Number(stat.coin) || 0;
  let favFolderIds = new Set();
  let followed = false;
  let inWatchLater = false;

  // ------------------------------------------------------------- player
  player = new Player(mount, {
    quality: store.get("quality"),
    onProgress: (seconds) => {
      if (!store.isLoggedIn()) return;
      reportProgress(info.aid, cid, Math.floor(seconds)).catch(() => {});
    },
    onEnded: () => {
      if (store.get("autoplay") === false) return;
      if (pages.length > 1 && pageIndex < pages.length - 1) {
        ctx.navigate(`/video/${encodeURIComponent(bvid)}?p=${pageIndex + 2}`);
        return;
      }
      if (related.length) {
        ctx.navigate(`/video/${encodeURIComponent(related[0].bvid)}`);
      }
    },
  });

  let streamToken = 0;
  const loadStream = async () => {
    const token = ++streamToken;
    player.showLoading();
    try {
      const play = await playInfo(bvid, cid, store.get("quality"), videoPlayOptions());
      if (disposed || token !== streamToken) return;
      play.streams = orderStreams(play.streams);
      const resume = initialStart > 0 ? initialStart : store.get("resume") ? resumeSeconds(play) : 0;
      const ok = player.setSource(play, {
        title: info.title,
        startTime: resume,
        autoplay: store.get("autoplay") !== false,
      });
      if (!ok) {
        player.showError("没有获取到可播放的视频流，请稍后重试。", () => loadStream());
      }
    } catch (error) {
      if (disposed || token !== streamToken) return;
      player.showError(errorText(error), () => loadStream());
    }
  };

  loadStream();

  Promise.allSettled([
    fetchDanmaku(cid).then((items) => {
      if (!disposed) player?.setDanmaku(items);
    }),
    videoSubtitles(bvid, cid).then((tracks) => {
      if (disposed) return;
      player?.setSubtitles(tracks, (track) => subtitleCues(track.url));
    }),
  ]);

  const onAuthHandler = () => {
    loadInteraction();
  };
  onAuth = onAuthHandler;
  window.addEventListener("app:auth", onAuthHandler);

  async function loadInteraction() {
    if (!store.isLoggedIn()) {
      liked = false;
      coinCount = 0;
      favFolderIds = new Set();
      syncAction(likeBtn, { active: false, count: likeCount });
      syncAction(coinBtn, { active: false, count: coinTotal });
      syncAction(favBtn, { active: false, count: undefined });
      return;
    }
    try {
      const state = await interactionState(bvid, info.aid);
      if (disposed) return;
      liked = Boolean(state.liked);
      coinCount = Number(state.coin) || 0;
      favFolderIds = new Set((state.fav_folders || []).map((id) => Number(id)));
      syncAction(likeBtn, { active: liked, count: likeCount });
      syncAction(coinBtn, { active: coinCount > 0, count: coinTotal });
      syncAction(favBtn, { active: favFolderIds.size > 0, count: undefined });
    } catch (_) {
      /* interaction state is optional */
    }
  }
  loadInteraction();

  // -------------------------------------------------------------- actions
  likeBtn?.addEventListener("click", async () => {
    if (!ensureLogin("点赞需要先登录")) return;
    if (likeBtn.disabled) return;
    likeBtn.disabled = true;
    try {
      await likeVideo(info.aid, !liked);
      liked = !liked;
      likeCount = Math.max(0, likeCount + (liked ? 1 : -1));
      syncAction(likeBtn, { active: liked, count: likeCount });
      toast(liked ? "已点赞" : "已取消点赞", "success");
    } catch (error) {
      if (isLoginError(error)) ensureLogin("登录状态已失效，请重新登录");
      toast(errorText(error), "error");
    } finally {
      likeBtn.disabled = false;
    }
  });

  coinBtn?.addEventListener("click", () => {
    if (!ensureLogin("投币需要先登录")) return;
    const available = Math.max(0, 2 - coinCount);
    if (!available) {
      toast("这个视频已经投过两枚硬币啦", "info");
      return;
    }
    let selected = 1;
    let alsoLike = false;
    const modal = openModal({
      title: "投币",
      small: true,
      body: `<div class="coin-options">
        ${Array.from({ length: available }, (_, index) => index + 1)
          .map(
            (count) => `<button class="coin-option${count === 1 ? " active" : ""}" type="button" data-coin="${count}">
              <span class="num">${Array.from({ length: count })
                .map(() => icon("coin", 18))
                .join("")}</span>
              <span>${count} 枚硬币</span>
            </button>`
          )
          .join("")}
      </div>
      <label class="fav-folder-option">
        <input type="checkbox" data-also-like>
        <span class="name">同时点赞</span>
      </label>
      <p class="form-hint">已为这个视频投过 ${coinCount} 枚硬币，最多可投 2 枚。</p>`,
      footer: `<button class="btn" type="button" data-cancel>取消</button>
        <button class="btn btn-primary" type="button" data-ok>${icon(
          "coin",
          15
        )}确认投币</button>`,
    });
    modal.body.querySelectorAll("[data-coin]").forEach((button) => {
      button.addEventListener("click", () => {
        selected = Number(button.dataset.coin) || 1;
        modal.body
          .querySelectorAll("[data-coin]")
          .forEach((item) => item.classList.toggle("active", item === button));
      });
    });
    modal.body.querySelector("[data-also-like]")?.addEventListener("change", (event) => {
      alsoLike = event.target.checked;
    });
    modal.wrap.querySelector("[data-cancel]")?.addEventListener("click", () => modal.close());
    modal.wrap.querySelector("[data-ok]")?.addEventListener("click", async () => {
      const button = modal.wrap.querySelector("[data-ok]");
      button.disabled = true;
      try {
        await coinVideo(info.aid, selected, alsoLike);
        coinCount += selected;
        coinTotal += selected;
        if (alsoLike && !liked) {
          liked = true;
          likeCount += 1;
          syncAction(likeBtn, { active: true, count: likeCount });
        }
        syncAction(coinBtn, { active: true, count: coinTotal });
        modal.close();
        toast("投币成功", "success");
      } catch (error) {
        button.disabled = false;
        if (isLoginError(error)) ensureLogin("登录状态已失效，请重新登录");
        toast(errorText(error), "error");
      }
    });
  });

  favBtn?.addEventListener("click", () => {
    if (!ensureLogin("收藏视频需要先登录")) return;
    let folders = [];
    let folderArea = null;
    const modal = openModal({
      title: "收藏",
      small: true,
      body: `<div data-folder-area><div class="hint"><span class="spinner"></span>正在读取收藏夹…</div></div>
        <div class="modal-create-folder">
          <input class="input" data-new-folder-input maxlength="40" placeholder="新建收藏夹名称">
          <button class="btn btn-soft" type="button" data-new-folder>${icon("plus", 15)}新建</button>
        </div>`,
      footer: `<button class="btn" type="button" data-cancel>取消</button>
        <button class="btn btn-primary" type="button" data-ok>${icon(
          "star",
          15
        )}保存收藏</button>`,
    });
    folderArea = modal.body.querySelector("[data-folder-area]");

    const folderRow = (folder, checked) => `<label class="fav-folder-option">
      <input type="checkbox" value="${folder.id}" data-folder-id ${
      checked ? "checked" : ""
    }>
      <span class="name">${escapeHtml(folder.title || "未命名收藏夹")}</span>
      <span class="count">${formatCount(folder.media_count)}</span>
    </label>`;

    const paintFolders = () => {
      if (!folders.length) {
        folderArea.innerHTML = `<div class="hint" data-folder-empty>${icon(
          "folder",
          15
        )}还没有收藏夹，先在下面创建一个吧。</div>`;
        return;
      }
      folderArea.innerHTML = `<div class="fav-folder-pick">${folders
        .map((folder) => folderRow(folder, favFolderIds.has(Number(folder.id))))
        .join("")}</div>`;
    };

    const loadFolders = async () => {
      try {
        folders = await favoriteFolders();
        if (disposed) return;
        paintFolders();
      } catch (error) {
        folderArea.innerHTML = `<div class="hint">${icon(
          "alert-circle",
          15
        )}${escapeHtml(errorText(error))}</div>`;
      }
    };
    loadFolders();

    modal.body.querySelector("[data-new-folder]")?.addEventListener("click", async () => {
      const input = modal.body.querySelector("[data-new-folder-input]");
      const title = String(input.value || "").trim();
      if (!title) {
        input.focus();
        return;
      }
      const button = modal.body.querySelector("[data-new-folder]");
      button.disabled = true;
      try {
        const id = await createFavoriteFolder(title);
        if (disposed) return;
        input.value = "";
        await loadFolders();
        const option = folderArea.querySelector(`input[value="${id}"]`);
        if (option) option.checked = true;
        toast("收藏夹已创建", "success");
      } catch (error) {
        if (isLoginError(error)) ensureLogin("登录状态已失效，请重新登录");
        toast(errorText(error), "error");
      } finally {
        button.disabled = false;
      }
    });

    modal.wrap.querySelector("[data-cancel]")?.addEventListener("click", () => modal.close());
    modal.wrap.querySelector("[data-ok]")?.addEventListener("click", async () => {
      const selected = new Set(
        [...modal.body.querySelectorAll("[data-folder-id]:checked")].map((input) =>
          Number(input.value)
        )
      );
      const add = [...selected].filter((id) => !favFolderIds.has(id));
      const del = [...favFolderIds].filter((id) => !selected.has(id));
      if (!add.length && !del.length) {
        modal.close();
        return;
      }
      const button = modal.wrap.querySelector("[data-ok]");
      button.disabled = true;
      try {
        await favoriteVideo(info.aid, add, del);
        if (disposed) return;
        favFolderIds = selected;
        syncAction(favBtn, { active: favFolderIds.size > 0, count: undefined });
        modal.close();
        toast("收藏已更新", "success");
      } catch (error) {
        button.disabled = false;
        if (isLoginError(error)) ensureLogin("登录状态已失效，请重新登录");
        toast(errorText(error), "error");
      }
    });
  });

  watchLaterBtn?.addEventListener("click", async () => {
    if (!ensureLogin("使用稍后再看需要先登录")) return;
    if (inWatchLater) {
      toast("已经在稍后再看里了", "info");
      return;
    }
    watchLaterBtn.disabled = true;
    try {
      await watchLaterAdd(info.aid, true);
      inWatchLater = true;
      watchLaterBtn.classList.add("active");
      toast("已添加到稍后再看", "success");
    } catch (error) {
      if (isLoginError(error)) ensureLogin("登录状态已失效，请重新登录");
      toast(errorText(error), "error");
    } finally {
      watchLaterBtn.disabled = false;
    }
  });

  root.querySelector("[data-act='share']")?.addEventListener("click", () => {
    const url = bilibiliVideoUrl(bvid);
    const modal = openModal({
      title: "分享视频",
      small: true,
      body: `<div class="form-group" style="margin:0">
        <label class="form-label">视频链接</label>
        <input class="input" data-share-url readonly value="${escapeAttr(url)}">
      </div>
      <div class="settings-actions">
        <button class="btn btn-soft" type="button" data-copy>${icon("copy", 15)}复制链接</button>
        <button class="btn btn-soft" type="button" data-open>${icon(
          "external-link",
          15
        )}在浏览器打开</button>
      </div>`,
    });
    const input = modal.body.querySelector("[data-share-url]");
    input?.addEventListener("focus", () => input.select());
    modal.body.querySelector("[data-copy]")?.addEventListener("click", async () => {
      const ok = await copyText(url);
      toast(ok ? "链接已复制" : "复制失败，请手动复制", ok ? "success" : "error");
    });
    modal.body.querySelector("[data-open]")?.addEventListener("click", async () => {
      const ok = await openExternal(url);
      if (!ok) toast("无法打开浏览器", "error");
    });
  });

  followBtn?.addEventListener("click", async () => {
    if (!ensureLogin("关注 UP 主需要先登录")) return;
    if (followBtn.disabled) return;
    followBtn.disabled = true;
    try {
      await followUser(owner.mid, !followed);
      followed = !followed;
      followBtn.classList.toggle("btn-primary", !followed);
      followBtn.classList.toggle("btn-soft", followed);
      followBtn.innerHTML = followed
        ? `${icon("check", 15)}已关注`
        : `${icon("plus", 15)}关注`;
      toast(followed ? "已关注" : "已取消关注", "success");
    } catch (error) {
      if (isLoginError(error)) ensureLogin("登录状态已失效，请重新登录");
      toast(errorText(error), "error");
    } finally {
      followBtn.disabled = false;
    }
  });

  const descToggle = root.querySelector("[data-desc-toggle]");
  descToggle?.addEventListener("click", () => {
    const desc = root.querySelector("[data-desc]");
    const collapsed = desc?.classList.toggle("collapsed");
    descToggle.textContent = collapsed ? "展开更多" : "收起";
  });

  const pagesList = root.querySelector(".pages-list");
  pagesList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page-index]");
    if (!button) return;
    const index = Number(button.dataset.pageIndex);
    if (!Number.isFinite(index) || index === pageIndex) return;
    ctx.navigate(`/video/${encodeURIComponent(bvid)}?p=${index + 1}`);
  });

  // ------------------------------------------------------------- comments
  let commentSort = "hot";
  let commentPage = 0;
  let commentToken = 0;
  // 回复目标：0 表示发表新评论
  let replyRoot = 0;

  // 输入框：补头像、字数统计、回复态切换
  const composer = root.querySelector("[data-composer]");
  const composerAvatar = root.querySelector("[data-composer-avatar]");
  if (composerAvatar) {
    const me = store.user;
    if (me?.face) {
      const img = document.createElement("img");
      img.src = me.face;
      img.alt = me.name || "我";
      img.referrerPolicy = "no-referrer";
      composerAvatar.replaceWith(img);
      img.dataset.composerAvatar = "";
    } else {
      composerAvatar.classList.add("avatar-fallback");
      composerAvatar.textContent = (store.user?.name || "我").slice(0, 1).toUpperCase();
    }
  }
  const commentInput = root.querySelector("[data-comment-input]");
  const commentSubmit = root.querySelector("[data-comment-submit]");
  const commentCounter = root.querySelector("[data-comment-counter]");
  const replyHint = root.querySelector("[data-reply-hint]");
  const replyTargetEl = root.querySelector("[data-reply-target]");

  const setReplyTarget = (rpid, name) => {
    replyRoot = Number(rpid) || 0;
    if (replyHint) replyHint.hidden = replyRoot <= 0;
    if (replyTargetEl) replyTargetEl.textContent = replyRoot > 0 ? `@${name || "该用户"}` : "";
    if (commentInput) {
      commentInput.placeholder = replyRoot > 0 ? `回复 @${name || "该用户"}` : "发一条友善的评论";
      commentInput.focus();
    }
    if (commentSubmit) commentSubmit.textContent = replyRoot > 0 ? "发表回复" : "发表评论";
  };

  commentInput?.addEventListener("input", () => {
    const len = commentInput.value.length;
    if (commentCounter) {
      commentCounter.textContent = `${len}/1000`;
      commentCounter.classList.toggle("over", len > 1000);
    }
  });

  root.querySelector("[data-reply-cancel]")?.addEventListener("click", () => setReplyTarget(0, ""));

  const submitComment = async () => {
    if (!ensureLogin("发表评论需要先登录")) return;
    const text = String(commentInput?.value || "").trim();
    if (!text) {
      toast("评论内容不能为空", "error");
      return;
    }
    if (text.length > 1000) {
      toast("评论最多 1000 字", "error");
      return;
    }
    const target = replyRoot;
    if (commentSubmit) {
      commentSubmit.classList.add("busy");
      commentSubmit.textContent = "发送中…";
    }
    try {
      const created = await commentAdd(info.aid, text, target);
      if (commentInput) commentInput.value = "";
      if (commentCounter) commentCounter.textContent = "0/1000";
      setReplyTarget(0, "");
      if (target > 0) {
        // 子回复：插进对应楼中楼
        const host = commentList.querySelector(`.comment[data-rpid="${target}"]`);
        if (host) {
          const wrap = host.querySelector(".comment-replies");
          const html = replyHtml(created);
          if (wrap) wrap.insertAdjacentHTML("beforeend", html);
          else
            host
              .querySelector(".comment-main")
              .insertAdjacentHTML("beforeend", `<div class="comment-replies">${html}</div>`);
        }
        toast("回复成功", "success");
      } else {
        // 新评论：插到列表最前面（最新）或按热度就放到最前也可接受
        commentList.insertAdjacentHTML("afterbegin", commentHtml(created));
        toast("评论成功", "success");
      }
      const count = Number(commentCountEl?.textContent?.replace(/[^\d]/g, "")) || 0;
      if (commentCountEl) commentCountEl.textContent = formatCount(count + 1);
    } catch (error) {
      if (isLoginError(error)) ensureLogin("登录状态已失效，请重新登录");
      toast(errorText(error), "error");
    } finally {
      if (commentSubmit) {
        commentSubmit.classList.remove("busy");
        commentSubmit.textContent = replyRoot > 0 ? "发表回复" : "发表评论";
      }
    }
  };

  commentSubmit?.addEventListener("click", submitComment);
  commentInput?.addEventListener("keydown", (event) => {
    // Ctrl/Cmd + Enter 快捷发送
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submitComment();
    }
  });

  const paintCommentError = (message) => {
    commentList.innerHTML = `<div class="comment-empty">${escapeHtml(
      errorText(message)
    )}<div style="margin-top:10px"><button class="btn btn-sm btn-soft" type="button" data-comment-retry>${icon(
      "refresh-cw",
      13
    )}重新加载</button></div></div>`;
    commentList.querySelector("[data-comment-retry]")?.addEventListener("click", () => {
      loadFirstComments();
    });
  };

  const loadFirstComments = async () => {
    commentLoader?.remove();
    commentLoader = null;
    commentPage = 0;
    commentList.innerHTML = skeletonRows(3);
    const token = ++commentToken;
    try {
      const data = await fetchComments(info.aid, 1, commentSort);
      if (disposed || token !== commentToken) return;
      commentPage = data.page || 1;
      if (commentCountEl) commentCountEl.textContent = formatCount(data.total);
      if (!data.items.length) {
        commentList.innerHTML = `<div class="comment-empty">还没有评论，来抢沙发吧～</div>`;
        return;
      }
      commentList.innerHTML = data.items.map(commentHtml).join("");
      if (data.has_more) {
        commentLoader = createInfiniteLoader(commentCard, async () => {
          const more = await fetchComments(info.aid, commentPage + 1, commentSort);
          if (disposed || token !== commentToken) return false;
          commentPage = more.page || commentPage + 1;
          commentList.insertAdjacentHTML("beforeend", more.items.map(commentHtml).join(""));
          return Boolean(more.has_more);
        });
      }
    } catch (error) {
      if (disposed || token !== commentToken) return;
      paintCommentError(error);
    }
  };

  commentList.addEventListener("click", async (event) => {
    const pic = event.target.closest("[data-comment-pic]");
    if (pic) {
      openImageViewer(pic.dataset.commentPic, "评论图片");
      return;
    }

    // 回复某条评论
    const replyBtn = event.target.closest("[data-reply-to]");
    if (replyBtn) {
      event.preventDefault();
      const rpid = Number(replyBtn.dataset.replyTo) || 0;
      // 回复子回复时，root 要落到楼层主评论上
      const host = replyBtn.closest(".comment");
      const rootRpid = Number(host?.dataset.rpid) || rpid;
      setReplyTarget(rootRpid, replyBtn.dataset.replyName || "");
      return;
    }

    // 点赞 / 取消点赞
    const likeBtn = event.target.closest("[data-like-btn]");
    if (likeBtn) {
      if (!ensureLogin("点赞评论需要先登录")) return;
      const comment = likeBtn.closest(".comment");
      const rpid = Number(comment?.dataset.rpid) || 0;
      const aid = Number(comment?.dataset.oid) || info.aid;
      if (!rpid) return;
      const next = likeBtn.dataset.liked !== "1";
      const countEl = likeBtn.querySelector(".like-count");
      const base = Number(likeBtn.dataset.count) || 0;
      likeBtn.disabled = true;
      try {
        await commentLike(aid, rpid, next);
        likeBtn.dataset.liked = next ? "1" : "0";
        likeBtn.dataset.count = base + (next ? 1 : -1);
        likeBtn.classList.toggle("active", next);
        if (countEl) countEl.textContent = formatCount(Math.max(0, base + (next ? 1 : -1)));
      } catch (error) {
        if (isLoginError(error)) ensureLogin("登录状态已失效，请重新登录");
        toast(errorText(error), "error");
      } finally {
        likeBtn.disabled = false;
      }
      return;
    }

    // 查看更多子回复
    const moreBtn = event.target.closest("[data-more-replies]");
    if (moreBtn) {
      const comment = moreBtn.closest(".comment");
      const rpid = Number(comment?.dataset.rpid) || 0;
      const aid = Number(comment?.dataset.oid) || info.aid;
      if (!rpid || moreBtn.disabled) return;
      const page = Number(moreBtn.dataset.page) || 1;
      moreBtn.disabled = true;
      moreBtn.textContent = "加载中…";
      try {
        const data = await commentReplies(aid, rpid, page);
        const wrap = comment.querySelector(".comment-replies");
        const fresh = (data.items || []).filter(
          (r) => !wrap || !wrap.querySelector(`[data-sub-rpid="${Number(r.rpid) || 0}"]`)
        );
        if (fresh.length) {
          const html = fresh.map(replyHtml).join("");
          if (wrap) wrap.insertAdjacentHTML("beforeend", html);
          else
            comment
              .querySelector(".comment-main")
              .insertAdjacentHTML("beforeend", `<div class="comment-replies">${html}</div>`);
        }
        if (data.has_more) {
          moreBtn.dataset.page = String(page + 1);
          moreBtn.disabled = false;
          moreBtn.textContent = `还有 ${formatCount(Math.max(0, (data.total || 0) - page * 20))} 条回复，点击查看`;
        } else {
          moreBtn.closest(".comment-more")?.remove();
        }
      } catch (error) {
        moreBtn.disabled = false;
        moreBtn.textContent = "加载失败，点击重试";
        if (isLoginError(error)) ensureLogin("登录状态已失效，请重新登录");
        else toast(errorText(error), "error");
      }
    }
  });

  commentSortEl?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sort]");
    if (!button || button.dataset.sort === commentSort) return;
    commentSort = button.dataset.sort;
    commentSortEl
      .querySelectorAll("[data-sort]")
      .forEach((item) => item.classList.toggle("active", item === button));
    loadFirstComments();
  });

  loadFirstComments();

  return cleanup;
}
