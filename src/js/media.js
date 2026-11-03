/**
 * Playback preference helpers.
 *
 * Every page that starts media reads its options here so the settings page
 * stays the single source of truth: video DASH preferences, CDN routing and
 * live (FLV/mpegts) buffering all come from the store.
 */

import { store } from "./store.js";

/** 视频播放参数：音质、编码偏好与未登录高清晰度。 */
export function videoPlayOptions() {
  return {
    audioQn: Number(store.get("audioQuality")) || 0,
    codec: store.get("codecPreference") || "auto",
    tryLook: store.get("noLogin1080") !== false,
  };
}

/** 番剧（PGC）音视频参数。 */
export function pgcPlayOptions() {
  return {
    audioQn: Number(store.get("audioQuality")) || 0,
    codec: store.get("codecPreference") || "auto",
  };
}

/**
 * 按 CDN 偏好调整流的主备地址顺序。
 * auto：保持后端顺序；backup：优先备用线路，首选线路退到后面。
 */
export function orderStream(stream) {
  if (!stream || store.get("cdnPreference") !== "backup") return stream;
  const backups = Array.isArray(stream.video_backups) ? stream.video_backups : [];
  if (!stream.video_url || !backups.length) return stream;
  const [first, ...rest] = backups;
  return {
    ...stream,
    video_url: first,
    video_backups: [...rest, stream.video_url],
    audio_url: stream.audio_url,
    audio_backups: stream.audio_backups,
  };
}

export function orderStreams(streams) {
  if (!Array.isArray(streams)) return [];
  return streams.map(orderStream);
}

/** 直播线路顺序：backup 偏好时把备用线路提到前面。 */
export function orderLiveUrls(play) {
  const primary = String(play?.url || "");
  const backups = Array.isArray(play?.backup_urls)
    ? play.backup_urls.filter(Boolean)
    : [];
  const list = [primary, ...backups].filter(Boolean);
  if (store.get("liveCdnPreference") !== "backup") return list;
  return [...list.slice(1), list[0]].filter(Boolean);
}

/**
 * mpegts.js 配置。
 *
 * liveLatency 决定追赶延迟的上限：越小越实时，越大越抗卡顿；
 * liveBufferSize 用作 stash 缓冲的初始尺寸（KB 级），缓冲越小起播越快。
 */
export function mpegtsConfig() {
  const latency = Math.min(12, Math.max(1, Number(store.get("liveLatency")) || 3));
  const bufferSize = Math.min(16, Math.max(1, Number(store.get("liveBufferSize")) || 4));
  return {
    enableWorker: true,
    enableStashBuffer: bufferSize > 2,
    stashInitialSize: bufferSize * 128,
    lazyLoad: false,
    autoCleanupSourceBuffer: true,
    liveBufferLatencyChasing: true,
    liveBufferLatencyMaxLatency: latency,
    liveBufferLatencyMinRemain: Math.max(0.5, latency - 2),
  };
}