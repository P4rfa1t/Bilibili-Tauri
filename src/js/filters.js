/**
 * 内容过滤规则。
 *
 * 设置页里的“推荐流设置”最终都落在这里：点赞率、时长、播放量、
 * 标题/分区关键词，以及“关注 UP 主豁免”。推荐流、首页热门与
 * 视频详情页的相关推荐共用同一套规则。
 */

import { store } from "./store.js";

/** "12:34" / "1:02:03" -> 秒 */
export function durationSeconds(text) {
  const parts = String(text || "")
    .split(":")
    .map((x) => Number(x));
  if (!parts.length || parts.some((x) => !Number.isFinite(x))) return 0;
  return parts.reduce((total, value) => total * 60 + value, 0);
}

function keywordHit(text, keywords) {
  if (!keywords?.length) return "";
  const target = String(text || "").toLowerCase();
  if (!target) return "";
  return (
    keywords.find((word) => target.includes(String(word).toLowerCase())) || ""
  );
}

export function readRules() {
  return {
    likeRateMin: Number(store.get("likeRateMin")) || 0,
    titleFilters: store.get("titleFilters") || [],
    partitionFilters: store.get("partitionFilters") || [],
    durationMin: Number(store.get("durationMin")) || 0,
    durationMax: Number(store.get("durationMax")) || 0,
    playMin: Number(store.get("playMin")) || 0,
    exemptFollowed: store.get("exemptFollowed") !== false,
  };
}

/**
 * 判断单条内容是否应被过滤。
 * @returns {string} 过滤原因，空字符串表示保留。
 */
export function filterReason(item, rules = readRules()) {
  if (!item) return "无效内容";
  if (rules.exemptFollowed && item.is_followed) return "";

  const title = item.title || "";
  const hitTitle = keywordHit(title, rules.titleFilters);
  if (hitTitle) return `标题包含“${hitTitle}”`;

  const tname = item.tname || "";
  if (tname) {
    const hitPartition = keywordHit(tname, rules.partitionFilters);
    if (hitPartition) return `分区包含“${hitPartition}”`;
  }

  const play = Number(item.play) || 0;
  const like = Number(item.like) || 0;
  if (rules.likeRateMin > 0) {
    const rate = play > 0 ? like / play : 0;
    if (rate < rules.likeRateMin) return "点赞率偏低";
  }

  if (rules.playMin > 0 && play < rules.playMin) return "播放量偏低";

  const seconds = durationSeconds(item.duration);
  if (seconds > 0) {
    if (rules.durationMin > 0 && seconds < rules.durationMin) return "时长过短";
    if (rules.durationMax > 0 && seconds > rules.durationMax) return "时长过长";
  }

  return "";
}

/**
 * 过滤一批内容。
 * @returns {{items: object[], filtered: number}}
 */
export function filterVideos(items, rules = readRules()) {
  const list = Array.isArray(items) ? items : [];
  const kept = [];
  let filtered = 0;
  for (const item of list) {
    if (filterReason(item, rules)) filtered += 1;
    else kept.push(item);
  }
  return { items: kept, filtered };
}

/** 相关推荐是否启用过滤（设置项 filterRelated）。 */
export function filterRelatedVideos(items, rules = readRules()) {
  const list = Array.isArray(items) ? items : [];
  if (store.get("filterRelated") === false) return list;
  return filterVideos(list, rules).items;
}

/** 规则是否全部处于默认值。 */
export function rulesAreDefault(rules = readRules()) {
  return (
    rules.likeRateMin === 0 &&
    rules.playMin === 0 &&
    rules.durationMin === 0 &&
    rules.durationMax === 0 &&
    rules.titleFilters.length === 0 &&
    rules.partitionFilters.length === 0
  );
}