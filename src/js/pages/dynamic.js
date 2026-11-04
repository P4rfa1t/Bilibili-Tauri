/**
 * 动态 —— 官方三栏布局：左侧「有更新的 UP 主」、中间动态流、右侧「关注 UP 主正在直播」。
 *
 * 后端把 B 站的动态结构拍平成 kind + archive/live/orig，
 * 这里只负责排版：正文、图文、视频卡片、直播卡片、转发。
 */

import {
  dynamicCommentAdd,
  dynamicComments,
  dynamicFeed,
  dynamicLike,
  dynamicPublish,
  dynamicRepost,
  dynamicUploadImage,
  dynamicUplist,
  liveFollowing,
  openExternal,
  search,
} from "../api.js";
import {
  insertIntoTextarea,
  insertNodeAtCursor,
  insertTextAtCursor,
  serializeEditor,
} from "../editor.js";
import { mountEmotePicker, renderEmoteText } from "../emotes.js";
import { icon } from "../icons.js";
import { ensureLogin } from "../login.js";
import { store } from "../store.js";
import {
  createInfiniteLoader,
  emptyState,
  errorState,
  loginRequiredHTML,
  openImageViewer,
  openModal,
  skeletonRows,
  toast,
} from "../ui.js";
import {
  avatarTag,
  errorText,
  escapeAttr,
  escapeHtml,
  formatCount,
  imgTag,
  timeAgo,
} from "../utils.js";

function authorHtml(item, { compact = false } = {}) {
  const mid = Number(item.author_mid) || 0;
  const name = String(item.author_name || "未知用户");
  const time = item.pub_time || timeAgo(item.pub_ts);
  const avatar = avatarTag(item.author_face, name, `avatar ${compact ? "avatar-xs" : "avatar-sm"}`);
  const inner = `${avatar}
    <div class="dyn-author-main">
      <span class="dyn-author-name">${escapeHtml(name)}</span>
      <span class="dyn-author-time">${escapeHtml(time)}</span>
    </div>`;
  return mid
    ? `<a class="dyn-author" href="#/space/${mid}">${inner}</a>`
    : `<div class="dyn-author">${inner}</div>`;
}

function archiveHtml(archive, { compact = false, external = "" } = {}) {
  if (!archive || !archive.title) return "";
  const bvid = String(archive.bvid || "");
  const cover = `<div class="dyn-archive-cover">
      ${imgTag(archive.cover, { w: 320, h: compact ? 180 : 200, alt: archive.title })}
      ${archive.duration ? `<span class="duration">${escapeHtml(archive.duration)}</span>` : ""}
    </div>
    <div class="dyn-archive-body">
      <div class="dyn-archive-title">${escapeHtml(archive.title)}</div>
      <div class="dyn-archive-meta">
        ${icon("play", 12)}${formatCount(archive.play)}
        ${archive.danmaku ? `${icon("message-square", 12)}${formatCount(archive.danmaku)}` : ""}
      </div>
    </div>`;
  if (bvid) {
    return `<a class="dyn-archive" href="#/video/${encodeURIComponent(bvid)}">${cover}</a>`;
  }
  // 番剧类没有 bvid，只能跳到 B 站页面
  if (external) {
    return `<button type="button" class="dyn-archive" data-open-url="${escapeAttr(
      external
    )}">${cover}</button>`;
  }
  return `<div class="dyn-archive">${cover}</div>`;
}

function liveHtml(live) {
  if (!live) return "";
  const roomId = Number(live.room_id) || 0;
  if (!roomId) return "";
  return `<a class="dyn-live" href="#/live/${roomId}">
    <div class="dyn-live-cover">${imgTag(live.cover, { w: 320, h: 180, alt: live.title })}
      <span class="live-card-badge"><i class="live-dot"></i>直播中</span>
    </div>
    <div class="dyn-live-body">
      <div class="dyn-live-title">${escapeHtml(live.title || "直播间")}</div>
      <div class="dyn-live-meta">
        ${live.area_name ? `<span>${escapeHtml(live.area_name)}</span>` : ""}
        ${live.uname ? `<span>${escapeHtml(live.uname)}</span>` : ""}
        <span>${icon("eye", 12)}${formatCount(live.online)}</span>
      </div>
    </div>
  </a>`;
}

function picsHtml(pics) {
  const list = (pics || []).filter(Boolean).slice(0, 9);
  if (!list.length) return "";
  const cols = list.length === 1 ? 1 : list.length === 2 || list.length === 4 ? 2 : 3;
  return `<div class="dyn-pics" data-cols="${cols}">
    ${list
      .map(
        (url) =>
          `<button type="button" class="dyn-pic" data-view-image="${escapeAttr(url)}">${imgTag(
            url,
            { w: 320, h: 320, alt: "" }
          )}</button>`
      )
      .join("")}
  </div>`;
}

function bodyHtml(item, { forward = false } = {}) {
  const text = String(item.text || "").trim();
  const parts = [];
  if (text) parts.push(`<p class="dyn-text">${renderEmoteText(text)}</p>`);
  if (item.kind === "live") parts.push(liveHtml(item.live));
  else if (item.archive) parts.push(archiveHtml(item.archive, { compact: forward, external: item.jump_url }));
  else if (item.pics?.length) parts.push(picsHtml(item.pics));
  if (item.jump_url && item.kind === "opus") {
    parts.push(
      `<button type="button" class="dyn-more" data-open-url="${escapeAttr(
        item.jump_url
      )}">查看全文${icon("external-link", 12)}</button>`
    );
  }
  return parts.join("");
}

function forwardHtml(orig) {
  if (!orig) return "";
  return `<div class="dyn-forward">
    ${authorHtml(orig, { compact: true })}
    ${bodyHtml(orig, { forward: true })}
  </div>`;
}

function cardHtml(item) {
  const id = escapeAttr(item.id || "");
  const stats = `<div class="dyn-stats">
      <button type="button" data-dyn-act="forward" data-dyn-id="${id}" title="转发">${icon(
    "repeat-2",
    13
  )}<span class="count">${formatCount(item.forward)}</span></button>
      <button type="button" data-dyn-act="comment" data-dyn-id="${id}" data-comment-id="${escapeAttr(
    item.comment_id || item.id || ""
  )}" data-comment-type="${Number(item.comment_type) || 17}" title="评论">${icon(
    "message-square",
    13
  )}<span class="count">${formatCount(item.comment)}</span></button>
      <button type="button" class="dyn-like${item.liked ? " active" : ""}" data-dyn-act="like" data-dyn-id="${id}" data-liked="${
    item.liked ? "1" : "0"
  }" data-count="${Number(item.like) || 0}" title="${item.liked ? "取消点赞" : "点赞"}">${icon(
    "thumbs-up",
    13
  )}<span class="count">${formatCount(item.like)}</span></button>
    </div>`;
  return `<article class="dyn-card" data-dyn-id="${escapeAttr(item.id)}">
    ${authorHtml(item)}
    ${bodyHtml(item)}
    ${forwardHtml(item.orig)}
    ${stats}
  </article>`;
}

export function dynamicCardHtml(item) {
  return cardHtml(item);
}

export async function handleDynamicClick(event) {
  const likeBtn = event.target.closest('[data-dyn-act="like"]');
  if (likeBtn) {
    event.preventDefault();
    if (!ensureLogin("登录后才能点赞动态")) return;
    const id = likeBtn.dataset.dynId || "";
    if (!id || likeBtn.disabled) return;
    const liked = likeBtn.dataset.liked === "1";
    likeBtn.disabled = true;
    try {
      const result = await dynamicLike(id, !liked);
      const nextLiked = Boolean(result.liked);
      likeBtn.dataset.liked = nextLiked ? "1" : "0";
      likeBtn.classList.toggle("active", nextLiked);
      likeBtn.title = nextLiked ? "取消点赞" : "点赞";
      const count = Number(result.count) || Math.max(0, Number(likeBtn.dataset.count) + (nextLiked ? 1 : -1));
      likeBtn.dataset.count = String(count);
      const countEl = likeBtn.querySelector(".count");
      if (countEl) countEl.textContent = formatCount(count);
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      likeBtn.disabled = false;
    }
    return;
  }

  const action = event.target.closest("[data-dyn-act]");
  if (action) {
    event.preventDefault();
    const act = action.dataset.dynAct;
    if (act === "comment") {
      openDynamicComments(
        action.dataset.dynId,
        action.dataset.commentId,
        Number(action.dataset.commentType) || 17
      );
    } else if (act === "forward") {
      openDynamicRepost(action.dataset.dynId);
    }
    return;
  }

  const pic = event.target.closest("[data-view-image]");
  if (pic) {
    event.preventDefault();
    openImageViewer(pic.dataset.viewImage, "");
    return;
  }
  const opener = event.target.closest("[data-open-url]");
  if (opener) {
    event.preventDefault();
    const ok = await openExternal(opener.dataset.openUrl);
    if (!ok) toast("无法打开浏览器", "error");
  }
}

export function bindDynamicList(container) {
  container.addEventListener("click", handleDynamicClick);
  return () => container.removeEventListener("click", handleDynamicClick);
}

// ------------------------------------------------------------ 左栏：有更新的 UP 主

function upListHtml(list) {
  if (!list.length) {
    return `<div class="dyn-side-empty">关注的 UP 主暂时没有新动态</div>`;
  }
  return list
    .map(
      (up) => `<a class="dyn-up" href="#/space/${Number(up.mid) || 0}" title="${escapeAttr(
        up.name || ""
      )}">
        <span class="dyn-up-avatar">${avatarTag(up.face, up.name, "avatar avatar-sm")}<i class="dyn-up-dot"></i></span>
        <span class="dyn-up-name">${escapeHtml(up.name || "")}</span>
      </a>`
    )
    .join("");
}

// ------------------------------------------------------------ 右栏：关注 UP 主正在直播

function followingLiveHtml(list) {
  if (!list.length) {
    return `<div class="dyn-side-empty">关注的 UP 主都没在直播</div>`;
  }
  return list
    .map(
      (room) => `<a class="dyn-following" href="#/live/${Number(room.room_id) || 0}">
        ${avatarTag(room.face, room.name, "avatar avatar-md")}
        <span class="dyn-following-body">
          <span class="dyn-following-top">
            <span class="dyn-following-name">${escapeHtml(room.name || "未知主播")}</span>
            <span class="dyn-following-badge"><i class="live-dot"></i>直播中</span>
          </span>
          <span class="dyn-following-title">${escapeHtml(room.title || "直播间")}</span>
          ${room.area ? `<span class="dyn-following-area">${escapeHtml(room.area)}</span>` : ""}
        </span>
      </a>`
    )
    .join("");
}

function openComposer(root, ctx) {
  const modal = openModal({
    title: "发布动态",
    className: "dyn-compose-modal",
    body: `<div class="dyn-compose">
      <div class="dyn-compose-text" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="有什么想和大家分享的？" data-compose-text></div>
      <div class="dyn-compose-preview" data-compose-preview></div>
      <div class="dyn-compose-tools">
        <button type="button" data-compose-image title="插入图片" aria-label="插入图片">${icon("image", 18)}</button>
        <button type="button" data-compose-emoji title="官方表情" aria-label="官方表情">${icon("smile", 18)}</button>
        <button type="button" data-compose-at title="@好友" aria-label="@好友">${icon("at-sign", 18)}</button>
        <span class="dyn-compose-count" data-compose-count>0/2000</span>
      </div>
      <div class="dyn-emoji-panel emote-picker" data-emoji-panel hidden></div>
      <div class="dyn-at-panel" data-at-panel hidden>
        <input class="input" type="search" placeholder="搜索要 @ 的好友" autocomplete="off" data-at-input />
        <div class="dyn-at-results" data-at-results></div>
      </div>
      <input type="file" accept="image/*" multiple hidden data-compose-file />
    </div>`,
    footer: `<span class="dyn-compose-status" data-compose-status></span><button class="btn btn-primary" type="button" data-compose-submit>发布</button>`,
  });

  const body = modal.body;
  const textarea = body.querySelector("[data-compose-text]");
  const preview = body.querySelector("[data-compose-preview]");
  const fileInput = body.querySelector("[data-compose-file]");
  const emojiPanel = body.querySelector("[data-emoji-panel]");
  const atPanel = body.querySelector("[data-at-panel]");
  const atInput = body.querySelector("[data-at-input]");
  const atResults = body.querySelector("[data-at-results]");
  const count = body.querySelector("[data-compose-count]");
  const status = modal.wrap.querySelector("[data-compose-status]");
  const submit = modal.wrap.querySelector("[data-compose-submit]");

  const pics = [];
  const atUsers = new Map();
  let uploading = 0;
  let submitting = false;
  let atSeq = 0;

  const updateCount = () => {
    const text = serializeEditor(textarea);
    count.textContent = `${text.length}/2000`;
    textarea.classList.toggle("is-empty", !text);
  };
  const updateStatus = (text = "") => {
    status.textContent = text;
  };
  const syncSubmit = () => {
    submit.disabled = submitting || uploading > 0;
    submit.textContent = submitting ? "发布中…" : "发布";
  };
  const renderPics = () => {
    preview.innerHTML = pics
      .map(
        (url, index) => `<div class="dyn-compose-pic">
          <img src="${escapeAttr(url)}" alt="" referrerpolicy="no-referrer">
          <button type="button" data-remove-pic="${index}" title="移除" aria-label="移除">${icon("x", 12)}</button>
        </div>`
      )
      .join("");
  };

  textarea.addEventListener("input", updateCount);
  textarea.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") || "";
    insertTextAtCursor(textarea, text);
  });
  body.querySelector("[data-compose-image]")?.addEventListener("click", () => fileInput.click());
  body.querySelector("[data-compose-emoji]")?.addEventListener("click", () => {
    atPanel.hidden = true;
    emojiPanel.hidden = !emojiPanel.hidden;
    if (emojiPanel.hidden || emojiPanel.dataset.ready === "1") return;
    emojiPanel.dataset.ready = "1";
    mountEmotePicker(emojiPanel, (emote) => {
      const image = document.createElement("img");
      image.className = "dyn-editor-emote";
      image.src = emote.url;
      image.alt = emote.text;
      image.dataset.emoteCode = emote.text;
      image.referrerPolicy = "no-referrer";
      insertNodeAtCursor(textarea, image);
    });
  });

  body.querySelector("[data-compose-at]")?.addEventListener("click", () => {
    emojiPanel.hidden = true;
    atPanel.hidden = !atPanel.hidden;
    if (!atPanel.hidden) atInput.focus();
  });
  atInput.addEventListener("input", () => {
    const keyword = atInput.value.trim();
    const token = ++atSeq;
    if (!keyword) {
      atResults.innerHTML = "";
      return;
    }
    atResults.innerHTML = '<span class="hint">搜索中…</span>';
    search(keyword, 1, "user")
      .then((data) => {
        if (token !== atSeq) return;
        const users = (data.users || []).slice(0, 8);
        if (!users.length) {
          atResults.innerHTML = '<span class="hint">没有找到用户</span>';
          return;
        }
        atResults.innerHTML = users
          .map(
            (user) => `<button type="button" class="dyn-at-item" data-at-mid="${Number(
              user.mid
            ) || 0}" data-at-name="${escapeAttr(user.name || "")}">
              ${avatarTag(user.avatar, user.name, "avatar avatar-xs")}
              <span>@${escapeHtml(user.name || "")}</span>
            </button>`
          )
          .join("");
      })
      .catch(() => {
        if (token === atSeq) atResults.innerHTML = '<span class="hint">搜索失败</span>';
      });
  });
  atResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-at-mid]");
    if (!button) return;
    const mid = Number(button.dataset.atMid) || 0;
    const name = button.dataset.atName || "";
    if (mid) atUsers.set(mid, name);
    insertTextAtCursor(textarea, `@${name} `);
    atPanel.hidden = true;
    atResults.innerHTML = "";
    atInput.value = "";
  });

  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []).slice(0, Math.max(0, 9 - pics.length));
    fileInput.value = "";
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 12 * 1024 * 1024) {
        toast(`${file.name} 超过 12MB，已跳过`, "warning");
        continue;
      }
      uploading += 1;
      syncSubmit();
      updateStatus("图片上传中…");
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("读取图片失败"));
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
        const result = await dynamicUploadImage(base64, file.name, file.type || "image/jpeg");
        pics.push(result.url);
        renderPics();
      } catch (error) {
        toast(errorText(error), "error");
      } finally {
        uploading -= 1;
        syncSubmit();
        updateStatus(uploading > 0 ? "图片上传中…" : "");
      }
    }
  });

  preview.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-pic]");
    if (!button) return;
    pics.splice(Number(button.dataset.removePic), 1);
    renderPics();
  });

  submit.addEventListener("click", async () => {
    if (submitting) return;
    if (uploading > 0) {
      toast("图片还在上传，请稍等", "warning");
      return;
    }
    const content = serializeEditor(textarea);
    if (!content && !pics.length) {
      toast("写点什么再发布吧", "info");
      return;
    }
    submitting = true;
    syncSubmit();
    updateStatus("");
    try {
      await dynamicPublish(content, pics, Array.from(atUsers.keys()));
      toast("动态已发布", "success");
      modal.close();
      ctx.refresh();
    } catch (error) {
      toast(errorText(error), "error");
      updateStatus("");
    } finally {
      submitting = false;
      syncSubmit();
    }
  });

  syncSubmit();
  updateCount();
  renderPics();
  setTimeout(() => textarea.focus(), 120);
}

export function openDynamicComments(dynId, commentId, commentType) {
  const oid = Number(commentId) || Number(dynId) || 0;
  const type = Number(commentType) || 17;
  if (!oid) return;

  const modal = openModal({
    title: "评论",
    className: "dyn-comments-modal",
    body: `<div class="dyn-comments">
      <div class="dyn-comment-list" data-dyn-comment-list>${skeletonRows(3)}</div>
      <div data-dyn-comment-more></div>
      <div class="dyn-comment-compose">
        <textarea class="comment-input" rows="2" maxlength="1000" placeholder="发一条友善的评论" data-dyn-comment-input></textarea>
        <div class="dyn-comment-compose-foot">
          <button type="button" class="btn btn-sm btn-ghost" data-dyn-comment-emoji>${icon(
            "smile",
            16
          )}表情</button>
          <span class="dyn-comment-reply-target" data-dyn-comment-reply-target hidden>回复 <b></b><button type="button" data-dyn-comment-reply-cancel>取消</button></span>
          <span class="dyn-comment-count" data-dyn-comment-count>0/1000</span>
          <button class="btn btn-sm btn-primary" type="button" data-dyn-comment-submit>发表评论</button>
        </div>
        <div class="emote-picker dyn-comment-emotes" data-dyn-comment-emotes hidden></div>
      </div>
    </div>`,
  });

  const list = modal.body.querySelector("[data-dyn-comment-list]");
  const more = modal.body.querySelector("[data-dyn-comment-more]");
  const input = modal.body.querySelector("[data-dyn-comment-input]");
  const count = modal.body.querySelector("[data-dyn-comment-count]");
  const emojiPanel = modal.body.querySelector("[data-dyn-comment-emotes]");
  const replyTarget = modal.body.querySelector("[data-dyn-comment-reply-target]");
  const submit = modal.body.querySelector("[data-dyn-comment-submit]");

  let page = 0;
  let replyRoot = 0;
  let loading = false;

  const rowHtml = (comment) => {
    const rpid = Number(comment.rpid) || 0;
    const replies = (comment.replies || []).slice(0, 3);
    return `<div class="dyn-comment" data-dyn-comment-rpid="${rpid}">
      ${avatarTag(comment.avatar, comment.name, "avatar avatar-sm")}
      <div class="dyn-comment-main">
        <div class="dyn-comment-head">
          <a href="#/space/${Number(comment.mid) || 0}">${escapeHtml(
      comment.name || "匿名用户"
    )}</a>
          <span>${escapeHtml(timeAgo(comment.ctime))}</span>
        </div>
        <div class="dyn-comment-text">${renderEmoteText(comment.message)}</div>
        <div class="dyn-comment-actions">
          <span>${icon("thumbs-up", 12)}${formatCount(comment.like)}</span>
          <button type="button" data-dyn-comment-reply="${rpid}" data-dyn-comment-name="${escapeAttr(
      comment.name || ""
    )}">回复</button>
        </div>
        ${
          replies.length
            ? `<div class="dyn-comment-subs">${replies
                .map(
                  (reply) =>
                    `<div class="dyn-comment-sub">${avatarTag(
                      reply.avatar,
                      reply.name,
                      "avatar avatar-xs"
                    )}<span class="dyn-comment-sub-body"><b>${escapeHtml(
                      reply.name || ""
                    )}</b>：${renderEmoteText(reply.message)}</span></div>`
                )
                .join("")}</div>`
            : ""
        }
      </div>
    </div>`;
  };

  const load = async (next = 1) => {
    if (loading) return;
    loading = true;
    try {
      const data = await dynamicComments(oid, type, next, "hot");
      const items = data.items || [];
      if (next === 1) {
        list.innerHTML = items.length
          ? items.map(rowHtml).join("")
          : emptyState("还没有评论", "来抢沙发吧。", "", "message-square");
      } else {
        list.insertAdjacentHTML("beforeend", items.map(rowHtml).join(""));
      }
      page = next;
      if (data.total) modal.setTitle(`评论 ${formatCount(data.total)}`);
      more.innerHTML =
        data.has_more && items.length
          ? `<button class="btn btn-sm btn-soft" type="button" data-dyn-comment-more>加载更多评论</button>`
          : "";
    } catch (error) {
      if (next === 1) {
        list.innerHTML = errorState(error);
        list.querySelector("[data-retry]")?.addEventListener("click", () => load(1));
      } else {
        toast(errorText(error), "error");
      }
    } finally {
      loading = false;
    }
  };

  const resetReply = () => {
    replyRoot = 0;
    replyTarget.hidden = true;
    input.placeholder = "发一条友善的评论";
    submit.textContent = "发表评论";
  };

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dyn-comment-reply]");
    if (!button) return;
    replyRoot = Number(button.dataset.dynCommentReply) || 0;
    const name = button.dataset.dynCommentName || "该用户";
    replyTarget.hidden = false;
    replyTarget.querySelector("b").textContent = `@${name}`;
    input.placeholder = `回复 @${name}`;
    submit.textContent = "发表回复";
    input.focus();
  });
  modal.body.querySelector("[data-dyn-comment-reply-cancel]")?.addEventListener("click", resetReply);
  more.addEventListener("click", (event) => {
    if (event.target.closest("[data-dyn-comment-more]")) load(page + 1);
  });
  input.addEventListener("input", () => {
    count.textContent = `${input.value.length}/1000`;
  });
  modal.body.querySelector("[data-dyn-comment-emoji]")?.addEventListener("click", () => {
    emojiPanel.hidden = !emojiPanel.hidden;
    if (emojiPanel.hidden || emojiPanel.dataset.ready === "1") return;
    emojiPanel.dataset.ready = "1";
    mountEmotePicker(emojiPanel, (emote) => insertIntoTextarea(input, emote.text));
  });
  submit.addEventListener("click", async () => {
    if (!ensureLogin("发表评论需要先登录")) return;
    const text = input.value.trim();
    if (!text) {
      toast("评论内容不能为空", "error");
      return;
    }
    submit.disabled = true;
    submit.textContent = "发送中…";
    try {
      await dynamicCommentAdd(oid, type, text, replyRoot);
      input.value = "";
      count.textContent = "0/1000";
      resetReply();
      toast("评论成功", "success");
      await load(1);
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      submit.disabled = false;
      submit.textContent = replyRoot > 0 ? "发表回复" : "发表评论";
    }
  });

  load(1);
}

function openDynamicRepost(dynId) {
  const id = String(dynId || "");
  if (!id) return;
  const modal = openModal({
    title: "转发动态",
    className: "dyn-repost-modal",
    body: `<div class="dyn-repost">
      <textarea class="dyn-repost-text" rows="3" maxlength="2000" placeholder="说点什么…" data-repost-text></textarea>
      <div class="dyn-repost-foot">
        <button type="button" class="btn btn-sm btn-ghost" data-repost-emoji>${icon(
          "smile",
          16
        )}表情</button>
        <span class="dyn-compose-count" data-repost-count>0/2000</span>
        <button class="btn btn-sm btn-primary" type="button" data-repost-submit>转发</button>
      </div>
      <div class="emote-picker" data-repost-emotes hidden></div>
    </div>`,
  });
  const textarea = modal.body.querySelector("[data-repost-text]");
  const count = modal.body.querySelector("[data-repost-count]");
  const emojiPanel = modal.body.querySelector("[data-repost-emotes]");
  const submit = modal.body.querySelector("[data-repost-submit]");
  textarea.addEventListener("input", () => {
    count.textContent = `${textarea.value.length}/2000`;
  });
  modal.body.querySelector("[data-repost-emoji]")?.addEventListener("click", () => {
    emojiPanel.hidden = !emojiPanel.hidden;
    if (emojiPanel.hidden || emojiPanel.dataset.ready === "1") return;
    emojiPanel.dataset.ready = "1";
    mountEmotePicker(emojiPanel, (emote) => insertIntoTextarea(textarea, emote.text));
  });
  submit.addEventListener("click", async () => {
    if (!ensureLogin("转发动态需要先登录")) return;
    submit.disabled = true;
    submit.textContent = "转发中…";
    try {
      await dynamicRepost(id, textarea.value.trim());
      toast("已转发", "success");
      modal.close();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      submit.disabled = false;
      submit.textContent = "转发";
    }
  });
}

export async function render(root, ctx) {
  const onAuth = () => ctx.refresh();
  window.addEventListener("app:auth", onAuth);
  const detachAuth = () => window.removeEventListener("app:auth", onAuth);

  if (!store.isLoggedIn()) {
    root.innerHTML = loginRequiredHTML("登录后即可查看关注的 UP 主动态。");
    return detachAuth;
  }

  root.innerHTML = `<div class="dyn-page">
      <aside class="dyn-side dyn-side-left">
        <div class="dyn-side-title">有更新</div>
        <div class="dyn-up-list" data-dyn-uplist>
          <div class="dyn-side-empty">加载中…</div>
        </div>
      </aside>
      <div class="dyn-main">
        <div class="dyn-toolbar">
          <span class="rec-hint">按关注时间排序，下拉自动加载更多</span>
        </div>
        <div class="dyn-list" data-dyn-list>${skeletonRows(5)}</div>
      </div>
      <aside class="dyn-side dyn-side-right">
        <div class="dyn-side-title"><i class="live-dot"></i>关注直播</div>
        <div class="dyn-following-list" data-dyn-following>
          <div class="dyn-side-empty">加载中…</div>
        </div>
      </aside>
      <div class="dyn-fabs">
        <button class="search-fab" type="button" data-dyn-publish title="发布动态" aria-label="发布动态">
          ${icon("edit-3", 20)}
        </button>
        <button class="search-fab" type="button" data-dyn-refresh-fab title="刷新" aria-label="刷新">
          ${icon("refresh-cw", 20)}
        </button>
      </div>
    </div>`;

  root.querySelector("[data-dyn-refresh-fab]")?.addEventListener("click", () => ctx.refresh());
  root.querySelector("[data-dyn-publish]")?.addEventListener("click", () => openComposer(root, ctx));

  const list = root.querySelector("[data-dyn-list]");
  const upList = root.querySelector("[data-dyn-uplist]");
  const liveList = root.querySelector("[data-dyn-following]");

  // 左栏、右栏与主列表各自加载，任一失败都不影响其余两栏
  dynamicUplist()
    .then((items) => {
      if (ctx.signal.aborted || !upList) return;
      upList.innerHTML = upListHtml(Array.isArray(items) ? items : []);
    })
    .catch(() => {
      if (ctx.signal.aborted || !upList) return;
      upList.innerHTML = `<div class="dyn-side-empty">暂时取不到更新列表</div>`;
    });

  liveFollowing()
    .then((items) => {
      if (ctx.signal.aborted || !liveList) return;
      liveList.innerHTML = followingLiveHtml(Array.isArray(items) ? items : []);
    })
    .catch(() => {
      if (ctx.signal.aborted || !liveList) return;
      liveList.innerHTML = `<div class="dyn-side-empty">暂时取不到关注直播</div>`;
    });

  // 图片查看与「查看全文」都以事件委托处理，动态插入的卡片也能用
  bindDynamicList(list);

  let disposed = false;
  let offset = "";
  let loader = null;
  let count = 0;

  const append = (items) => {
    if (!items.length) return;
    list.insertAdjacentHTML("beforeend", items.map(cardHtml).join(""));
    count += items.length;
  };

  const loadMore = async () => {
    if (disposed) return false;
    const data = await dynamicFeed("all", offset);
    if (disposed || ctx.signal.aborted) return false;
    offset = String(data.offset || "");
    append(data.items || []);
    return Boolean(data.has_more) && Boolean(offset);
  };

  try {
    const data = await dynamicFeed("all", "");
    if (disposed || ctx.signal.aborted) return () => {};
    offset = String(data.offset || "");
    const items = data.items || [];
    list.innerHTML = "";
    if (!items.length) {
      list.innerHTML = emptyState(
        "还没有动态",
        "关注一些 UP 主后，这里会出现他们的最新动态。",
        `<a class="btn btn-primary" href="#/home?channel=hot">去首页看看</a>`,
        "at-sign"
      );
    } else {
      append(items);
      if (data.has_more && offset) loader = createInfiniteLoader(list, loadMore);
    }
  } catch (error) {
    if (disposed || ctx.signal.aborted) return () => {};
    list.innerHTML = errorState(error);
    list.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
  }

  return () => {
    disposed = true;
    loader?.remove();
    loader = null;
    detachAuth();
  };
}
