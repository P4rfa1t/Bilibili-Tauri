/**
 * Tauri command bridge. All data fields use the backend's snake_case JSON;
 * command arguments use camelCase as Tauri expects.
 */

const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
const invokeFn =
  tauri?.core?.invoke ||
  tauri?.tauri?.invoke ||
  (typeof window !== "undefined" ? window.__TAURI_INTERNALS__?.invoke : null);

export function isTauri() {
  return typeof invokeFn === "function";
}

export async function call(command, args = {}) {
  if (typeof invokeFn !== "function") {
    throw new Error(
      "未检测到 Tauri 运行环境。请使用 `npm run dev` 或 `npm run build` 启动桌面应用。"
    );
  }
  return invokeFn(command, args);
}

// ---------------- Discovery ----------------

export function homeFeed(kind = "popular", pn = 1, rid = 0) {
  return call("home_feed", { kind, pn, rid });
}

export function search(keyword, page = 1, kind = "video", order = "totalrank") {
  return call("search", { keyword, page, kind, order });
}

export function searchSuggest(keyword) {
  return call("search_suggest", { keyword });
}

export function searchTrending() {
  return call("search_trending");
}

// ---------------- Video ----------------

export function videoDetail(bvid) {
  return call("video_detail", { bvid });
}

/**
 * 播放地址。audioQn/codec 决定音轨与视频编码偏好，
 * tryLook 让未登录状态也能拿到更高的清晰度。
 */
export function playInfo(bvid, cid, qn = 80, options = {}) {
  const { audioQn = 0, codec = "auto", tryLook = false } = options;
  return call("play_info", { bvid, cid, qn, audioQn, codec, tryLook });
}

export function pgcPlayInfo(ep, cid, qn = 80, options = {}) {
  const { audioQn = 0, codec = "auto" } = options;
  return call("pgc_play_info", { ep, cid, qn, audioQn, codec });
}

export function danmaku(cid) {
  return call("danmaku", { cid });
}

export function videoSubtitles(bvid, cid) {
  return call("video_subtitles", { bvid, cid });
}

export function subtitleCues(url) {
  return call("subtitle_cues", { url });
}

export function comments(aid, page = 1, sort = "hot") {
  return call("comments", { aid, page, sort });
}

// ---------------- Auth ----------------

export function qrGenerate() {
  return call("qr_generate");
}

export function qrPoll(key) {
  return call("qr_poll", { key });
}

export function loginState() {
  return call("login_state");
}

export function logout() {
  return call("logout");
}

// ---------------- Interactions ----------------

export function likeVideo(aid, like) {
  return call("like_video", { aid, like });
}

export function coinVideo(aid, count = 1, alsoLike = false) {
  return call("coin_video", { aid, count, alsoLike });
}

export function favoriteVideo(aid, add = [], del = []) {
  return call("favorite_video", { aid, add, del });
}

export function favoriteFolders(mid = 0) {
  return call("favorite_folders", { mid });
}

export function createFavoriteFolder(title) {
  return call("create_favorite_folder", { title });
}

export function favoriteList(media, page = 1) {
  return call("favorite_list", { media, page });
}

export function interactionState(bvid, aid) {
  return call("interaction_state", { bvid, aid });
}

export function followUser(mid, follow) {
  return call("follow_user", { mid, follow });
}

export function watchLater() {
  return call("watch_later");
}

export function watchLaterAdd(aid, add = true) {
  return call("watch_later_add", { aid, add });
}

export function reportProgress(aid, cid, progress) {
  return call("report_progress", { aid, cid, progress });
}

// ---------------- History & space ----------------

export function recommendFeed(freshIdx = 1) {
  return call("recommend_feed", { freshIdx });
}

export function history(max = 0, viewAt = 0, kind = "all") {
  return call("history", { max, viewAt, kind });
}

export function historyClear() {
  return call("history_clear", {});
}

export function commentLike(aid, rpid, action = true) {
  return call("comment_like", { aid, rpid, action });
}

export function commentReplies(aid, rpid, page = 1) {
  return call("comment_replies", { aid, rpid, page });
}

export function commentAdd(aid, message, root = 0) {
  return call("comment_add", { aid, message, root });
}

export function spaceInfo(mid) {
  return call("space_info", { mid });
}

export function spaceVideos(mid, page = 1) {
  return call("space_videos", { mid, page });
}

// ---------------- Bangumi ----------------

export function bangumiList(page = 1, seasonType = 1) {
  return call("bangumi_list", { page, seasonType });
}

export function bangumiDetail(seasonId) {
  return call("bangumi_detail", { seasonId });
}

// ---------------- Live ----------------

export function liveFeed() {
  return call("live_feed");
}

export function liveAreas() {
  return call("live_areas");
}

export function liveRooms(areaId, areaName, page = 1) {
  return call("live_rooms", { areaId, areaName, page });
}

export function liveRoomDetail(roomId) {
  return call("live_room_detail", { roomId });
}

export function livePlayInfo(roomId, qn = 0) {
  return call("live_play_info", { roomId, qn });
}

// ---------------- Dynamic & messages ----------------

/** 关注动态流（需要登录）。offset 传上一页返回值即可继续翻。 */
export function dynamicFeed(kind = "all", offset = "") {
  return call("dynamic_feed", { kind, offset });
}

/** 消息列表。kind 为 reply（回复我的）/ at（@我的）/ like（收到的赞）。 */
export function msgFeed(kind = "reply", cursorId = 0, cursorTime = 0) {
  return call("msg_feed", { kind, cursorId, cursorTime });
}

export function msgUnread() {
  return call("msg_unread");
}

/** 动态页左栏：有更新的 UP 主（需要登录）。 */
export function dynamicUplist() {
  return call("dynamic_uplist");
}

/** 动态页右栏：关注的 UP 主正在直播（需要登录）。 */
export function liveFollowing() {
  return call("live_following");
}

/** 直播弹幕服务器凭据。 */
export function liveDanmuConf(roomId) {
  return call("live_danmu_conf", { roomId });
}

/** 直播间历史弹幕。 */
export function liveDanmuHistory(roomId) {
  return call("live_danmu_history", { roomId });
}

// ---------------- Misc ----------------

export function openUrl(url) {
  return call("open_url", { url });
}

export function appVersion() {
  return call("app_version");
}

export async function openExternal(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  if (isTauri()) {
    try {
      await openUrl(url);
      return true;
    } catch (_) {
      /* fall through to window.open */
    }
  }
  try {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  } catch (_) {
    return false;
  }
}

export function bilibiliVideoUrl(bvid) {
  return `https://www.bilibili.com/video/${bvid}`;
}

export function bilibiliBangumiUrl(epId) {
  return `https://www.bilibili.com/bangumi/play/ep${epId}`;
}

export function bilibiliSpaceUrl(mid) {
  return `https://space.bilibili.com/${mid}`;
}

let trendingCache = null;

export async function cachedTrending() {
  if (trendingCache && Date.now() - trendingCache.at < 5 * 60_000) {
    return trendingCache.data;
  }
  const data = await searchTrending();
  trendingCache = { at: Date.now(), data };
  return data;
}
