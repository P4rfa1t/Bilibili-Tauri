/** Static option tables shared by pages and settings. */

export const QUALITY_OPTIONS = [
  { value: 127, label: "8K 超高清" },
  { value: 126, label: "杜比视界" },
  { value: 125, label: "HDR 真彩" },
  { value: 120, label: "4K 超清" },
  { value: 116, label: "1080P 60帧" },
  { value: 112, label: "1080P 高码率" },
  { value: 80, label: "1080P 高清" },
  { value: 74, label: "720P 60帧" },
  { value: 64, label: "720P 准高清" },
  { value: 32, label: "480P 清晰" },
  { value: 16, label: "360P 流畅" },
];

export const SPEED_OPTIONS = [2, 1.75, 1.5, 1.25, 1, 0.75, 0.5];

/** 音质：B 站 DASH 音频码率（qn）。 */
export const AUDIO_QUALITY_OPTIONS = [
  { value: 30280, label: "192K 高码率" },
  { value: 30232, label: "132K 标准" },
  { value: 30216, label: "64K 流畅" },
];

/** 编码偏好：auto 按兼容性排序，其余强制优先。 */
export const CODEC_OPTIONS = [
  { value: "auto", label: "自动（兼容优先）" },
  { value: "avc", label: "AVC / H.264" },
  { value: "hevc", label: "HEVC / H.265" },
  { value: "av1", label: "AV1" },
];

/** CDN 线路偏好：auto 用官方首选，backup 优先备用线路。 */
export const CDN_OPTIONS = [
  { value: "auto", label: "自动（首选线路）" },
  { value: "backup", label: "备用线路优先" },
];

/** 直播清晰度：qn 值与直播间 getRoomPlayInfo 一致。 */
export const LIVE_QUALITY_OPTIONS = [
  { value: 10000, label: "原画（尽量）" },
  { value: 400, label: "蓝光" },
  { value: 250, label: "超清" },
  { value: 150, label: "高清" },
  { value: 80, label: "流畅" },
];

export const SEARCH_ORDERS = [
  { value: "totalrank", label: "综合排序" },
  { value: "click", label: "最多播放" },
  { value: "pubdate", label: "最新发布" },
  { value: "dm", label: "最多弹幕" },
  { value: "stow", label: "最多收藏" },
];

export const RANKING_CATEGORIES = [
  { rid: 0, label: "全站" },
  { rid: 1, label: "动画" },
  { rid: 13, label: "番剧" },
  { rid: 168, label: "国创" },
  { rid: 3, label: "音乐" },
  { rid: 129, label: "舞蹈" },
  { rid: 4, label: "游戏" },
  { rid: 36, label: "知识" },
  { rid: 188, label: "科技" },
  { rid: 234, label: "运动" },
  { rid: 223, label: "汽车" },
  { rid: 160, label: "生活" },
  { rid: 211, label: "美食" },
  { rid: 210, label: "动物" },
  { rid: 119, label: "鬼畜" },
  { rid: 155, label: "时尚" },
  { rid: 202, label: "资讯" },
  { rid: 181, label: "影视" },
];

export const REGION_CATEGORIES = [
  { rid: 1, label: "动画" },
  { rid: 3, label: "音乐" },
  { rid: 4, label: "游戏" },
  { rid: 36, label: "知识" },
  { rid: 188, label: "科技" },
  { rid: 160, label: "生活" },
  { rid: 211, label: "美食" },
  { rid: 210, label: "动物" },
  { rid: 129, label: "舞蹈" },
  { rid: 119, label: "鬼畜" },
  { rid: 155, label: "时尚" },
  { rid: 202, label: "资讯" },
  { rid: 181, label: "影视" },
];

export const BANGUMI_TYPES = [
  { value: 1, label: "番剧" },
  { value: 4, label: "国创" },
  { value: 2, label: "电影" },
  { value: 3, label: "纪录片" },
  { value: 5, label: "电视剧" },
  { value: 7, label: "综艺" },
];

export const SEARCH_TYPES = [
  { value: "video", label: "视频" },
  { value: "user", label: "UP主" },
  { value: "bangumi", label: "番剧" },
];

export const THEME_OPTIONS = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

export function qualityLabel(value) {
  return QUALITY_OPTIONS.find((x) => x.value === Number(value))?.label || `${value}P`;
}

export function bangumiTypeLabel(value) {
  return BANGUMI_TYPES.find((x) => x.value === Number(value))?.label || "番剧";
}
