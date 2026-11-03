use serde::{Deserialize, Serialize};

/// 分页结果
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PageResult<T> {
    pub items: Vec<T>,
    pub page: u32,
    pub has_more: bool,
    pub total: i64,
}

/// 通用视频卡片（首页、排行榜、分区、相关推荐、稍后再看等）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoCard {
    pub bvid: String,
    pub aid: i64,
    pub title: String,
    pub cover: String,
    pub author: String,
    pub mid: i64,
    pub play: i64,
    pub danmaku: i64,
    pub like: i64,
    /// 视频分区名（部分接口返回）
    pub tname: String,
    /// 官方推荐接口标记的“已关注 UP 主”
    pub is_followed: bool,
    /// 已格式化的时长，如 12:34 / 1:02:03
    pub duration: String,
    pub pubdate: i64,
    pub description: String,
    /// 推荐理由（仅官方推荐接口返回，例如“15万点赞”）
    pub recommend_reason: String,
}

/// 用户卡片（搜索结果）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserCard {
    pub mid: i64,
    pub name: String,
    pub avatar: String,
    pub fans: i64,
    pub videos: i64,
    pub sign: String,
    pub level: i32,
}

/// 番剧卡片
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BangumiCard {
    pub season_id: i64,
    pub title: String,
    pub cover: String,
    pub badge: String,
    pub index_show: String,
    pub score: String,
    pub order: String,
    pub subtitle: String,
    pub link: String,
}

/// 搜索结果（根据 kind 返回不同字段）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchResult {
    pub kind: String,
    pub page: u32,
    pub has_more: bool,
    pub total: i64,
    pub videos: Vec<VideoCard>,
    pub users: Vec<UserCard>,
    pub bangumi: Vec<BangumiCard>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoPage {
    pub cid: i64,
    pub page: i32,
    pub part: String,
    pub duration: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoOwner {
    pub mid: i64,
    pub name: String,
    pub face: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoStat {
    pub view: i64,
    pub danmaku: i64,
    pub reply: i64,
    pub favorite: i64,
    pub coin: i64,
    pub share: i64,
    pub like: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoInfo {
    pub bvid: String,
    pub aid: i64,
    pub title: String,
    pub desc: String,
    pub cover: String,
    pub duration: i64,
    pub pubdate: i64,
    pub ctime: i64,
    pub tname: String,
    pub videos: i32,
    pub owner: VideoOwner,
    pub stat: VideoStat,
    pub pages: Vec<VideoPage>,
    pub cid: i64,
    pub width: i32,
    pub height: i32,
    pub tags: Vec<String>,
    pub related: Vec<VideoCard>,
}

/// 单条清晰度流。DASH 时 video/audio 分离，durl 时 audio 为空。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlayStream {
    pub quality: i32,
    pub label: String,
    pub video_url: String,
    pub video_backups: Vec<String>,
    pub audio_url: String,
    pub audio_backups: Vec<String>,
    pub is_dash: bool,
    pub height: i32,
    pub frame_rate: String,
    pub codec: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlayInfo {
    pub streams: Vec<PlayStream>,
    pub default_quality: i32,
    pub last_play_time: i64,
    pub duration: i64,
    pub is_pgc: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SubtitleTrack {
    pub lan: String,
    pub lan_doc: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SubtitleCue {
    pub from: f64,
    pub to: f64,
    pub content: String,
}

/// 弹幕条目
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DanmakuItem {
    pub id: i64,
    /// 视频内出现时间（秒）
    pub time: f64,
    /// 1-3=滚动 4=底部 5=顶部
    pub mode: i32,
    /// #RRGGBB
    pub color: String,
    pub content: String,
    pub size: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommentItem {
    pub rpid: i64,
    pub mid: i64,
    pub name: String,
    pub avatar: String,
    pub level: i32,
    pub message: String,
    pub like: i64,
    pub ctime: i64,
    pub reply_count: i64,
    pub pictures: Vec<String>,
    pub replies: Vec<CommentItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommentPage {
    pub items: Vec<CommentItem>,
    pub page: u32,
    pub has_more: bool,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HistoryItem {
    pub aid: i64,
    pub bvid: String,
    pub title: String,
    pub cover: String,
    pub author: String,
    pub author_mid: i64,
    pub cid: i64,
    pub progress: i64,
    pub duration: i64,
    pub view_at: i64,
    pub videos: i32,
    pub page: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HistoryPage {
    pub items: Vec<HistoryItem>,
    pub max: i64,
    pub view_at: i64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FavoriteFolder {
    pub id: i64,
    pub title: String,
    pub media_count: i64,
    pub attr: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FavoriteItem {
    pub aid: i64,
    pub bvid: String,
    pub title: String,
    pub cover: String,
    pub author: String,
    pub mid: i64,
    pub duration: String,
    pub play: i64,
    pub fav_time: i64,
    pub pubtime: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WatchLaterItem {
    pub aid: i64,
    pub bvid: String,
    pub title: String,
    pub cover: String,
    pub author: String,
    pub mid: i64,
    pub duration: String,
    pub progress: i64,
    pub cid: i64,
    pub add_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpaceInfo {
    pub mid: i64,
    pub name: String,
    pub face: String,
    pub banner: String,
    pub sign: String,
    pub level: i32,
    pub fans: i64,
    pub following: i64,
    pub archive_count: i64,
    pub likes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpaceVideo {
    pub bvid: String,
    pub aid: i64,
    pub title: String,
    pub cover: String,
    pub play: i64,
    pub danmaku: i64,
    pub duration: String,
    pub created: i64,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Episode {
    pub id: i64,
    pub ep_id: i64,
    pub aid: i64,
    pub bvid: String,
    pub cid: i64,
    pub title: String,
    pub long_title: String,
    pub cover: String,
    pub duration: i64,
    pub badge: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BangumiDetail {
    pub season_id: i64,
    pub season_title: String,
    pub title: String,
    pub cover: String,
    pub evaluate: String,
    pub summary: String,
    pub badge: String,
    pub index_show: String,
    pub score: String,
    pub total_ep: i32,
    pub pub_time: String,
    pub areas: Vec<String>,
    pub styles: Vec<String>,
    pub up_name: String,
    pub stat_views: i64,
    pub stat_follows: i64,
    pub episodes: Vec<Episode>,
    pub seasons: Vec<BangumiCard>,
}

/// 当前登录用户（来自 nav 接口）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserInfo {
    pub is_login: bool,
    pub mid: i64,
    pub name: String,
    pub face: String,
    pub level: i32,
    pub vip_status: i32,
    pub coin: f64,
}

/// 二维码生成结果（qr 为 PNG data URL，可直接 <img src>）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QrCode {
    pub qr: String,
    pub key: String,
}

/// 二维码轮询结果：0=成功 86038=过期 86090=已扫未确认 86101=未扫
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QrPoll {
    pub status: i64,
    pub message: String,
    /// 登录成功时携带返回的全部 Cookie
    pub cookies: Option<std::collections::BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InteractionState {
    pub liked: bool,
    pub coin: i32,
    pub fav_folders: Vec<i64>,
}

// ---------------- 动态 ----------------

/// 动态里的视频卡片（投稿 / 番剧）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DynamicArchive {
    pub bvid: String,
    pub title: String,
    pub cover: String,
    pub duration: String,
    pub play: i64,
    pub danmaku: i64,
}

/// 动态里被推荐的直播间
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DynamicLive {
    pub room_id: i64,
    pub title: String,
    pub cover: String,
    pub area_name: String,
    pub online: i64,
    pub uname: String,
}

/// 一条关注动态
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DynamicItem {
    pub id: String,
    /// av / opus / draw / live / pgc / forward / text
    pub kind: String,
    pub author_mid: i64,
    pub author_name: String,
    pub author_face: String,
    pub pub_time: String,
    pub pub_ts: i64,
    pub text: String,
    pub pics: Vec<String>,
    pub jump_url: String,
    pub forward: i64,
    pub comment: i64,
    pub like: i64,
    pub archive: Option<DynamicArchive>,
    pub live: Option<DynamicLive>,
    /// 转发时被转发的原动态
    pub orig: Option<Box<DynamicItem>>,
}

/// 动态分页
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DynamicPage {
    pub items: Vec<DynamicItem>,
    pub offset: String,
    pub has_more: bool,
    pub update_num: i64,
}

// ---------------- 消息 ----------------

/// 消息里的用户（收到的赞可能有多人）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MessageUser {
    pub mid: i64,
    pub name: String,
    pub face: String,
}

/// 一条消息（回复 / @ / 点赞）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MessageItem {
    pub id: i64,
    /// reply / at / like
    pub kind: String,
    pub users: Vec<MessageUser>,
    pub title: String,
    pub business: String,
    pub content: String,
    pub uri: String,
    pub image: String,
    pub time: i64,
    pub count: i64,
}

/// 消息分页
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MessagePage {
    pub items: Vec<MessageItem>,
    pub cursor_id: i64,
    pub cursor_time: i64,
    pub has_more: bool,
}

/// 未读消息计数
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UnreadCount {
    pub reply: i64,
    pub at: i64,
    pub like: i64,
    pub sys_msg: i64,
    pub chat: i64,
    pub danmu: i64,
    pub favorite: i64,
    pub coin: i64,
    pub up: i64,
    pub total: i64,
}

// ---------------- 直播 ----------------

/// 直播房间卡片
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveRoom {
    pub room_id: i64,
    pub uid: i64,
    pub title: String,
    pub cover: String,
    pub uname: String,
    pub face: String,
    pub online: i64,
    pub area_id: i64,
    pub area_name: String,
    pub parent_area_id: i64,
    pub parent_area_name: String,
    pub live_status: i32,
}

/// 直播首页的一个分区模块
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveModule {
    pub id: i64,
    pub title: String,
    pub link: String,
    pub cover: String,
    pub rooms: Vec<LiveRoom>,
}

/// 直播首页聚合数据
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveFeed {
    pub recommend: Vec<LiveRoom>,
    pub modules: Vec<LiveModule>,
}

/// 直播子分区
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveArea {
    pub id: i64,
    pub name: String,
    pub parent_id: i64,
    pub pic: String,
    pub hot: bool,
}

/// 直播父分区
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveAreaGroup {
    pub id: i64,
    pub name: String,
    pub areas: Vec<LiveArea>,
}

/// 直播间详情
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveRoomDetail {
    pub room_id: i64,
    pub uid: i64,
    pub title: String,
    pub cover: String,
    pub keyframe: String,
    pub description: String,
    pub uname: String,
    pub face: String,
    pub online: i64,
    pub attention: i64,
    pub live_status: i32,
    pub area_id: i64,
    pub area_name: String,
    pub parent_area_id: i64,
    pub parent_area_name: String,
    pub live_time: String,
    pub tags: Vec<String>,
}

/// 直播清晰度
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveQuality {
    pub qn: i32,
    pub desc: String,
}

/// 直播播放地址（FLV + mpegts.js）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LivePlayInfo {
    pub room_id: i64,
    pub live_status: i32,
    pub url: String,
    pub backup_urls: Vec<String>,
    pub format: String,
    pub quality: i32,
    pub quality_desc: String,
    pub qualities: Vec<LiveQuality>,
    pub accept_qn: Vec<i32>,
}

/// 动态页左栏：有更新的 UP 主
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DynUp {
    pub mid: i64,
    pub name: String,
    pub face: String,
}

/// 动态页右栏：关注的 UP 主正在直播
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FollowingLive {
    pub room_id: i64,
    pub uid: i64,
    pub name: String,
    pub face: String,
    pub cover: String,
    pub title: String,
    pub area: String,
    pub online: i64,
}

/// 直播弹幕服务器
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DanmuServer {
    pub host: String,
    pub wss_port: i64,
}

/// 直播弹幕连接凭据
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DanmuConf {
    pub token: String,
    pub host: String,
    pub wss_port: i64,
    pub servers: Vec<DanmuServer>,
}

/// 历史弹幕
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DanmuHistoryItem {
    pub text: String,
    pub uname: String,
    pub uid: i64,
    pub timeline: String,
    pub color: u32,
    pub mode: i32,
}

/// 历史弹幕分页
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DanmuHistory {
    pub items: Vec<DanmuHistoryItem>,
}
