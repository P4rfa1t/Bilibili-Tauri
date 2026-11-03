use tauri::{AppHandle, Manager, State};

use crate::api::types::*;
use crate::AppState;

fn login_of(state: &State<'_, AppState>) -> std::collections::BTreeMap<String, String> {
    state.cookies.lock().unwrap().snapshot()
}

fn cookie_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("cookies.json"))
}

fn save_cookies(state: &AppState, app: &AppHandle) {
    if let Some(path) = cookie_path(app) {
        let _ = state.cookies.lock().unwrap().save(&path);
    }
}

// ---------------- 发现 ----------------

#[tauri::command]
pub async fn home_feed(
    state: State<'_, AppState>,
    kind: String,
    pn: Option<u32>,
    rid: Option<i64>,
) -> Result<PageResult<VideoCard>, String> {
    let login = login_of(&state);
    match kind.as_str() {
        "ranking" => state.client.ranking(rid.unwrap_or(0), &login).await,
        "region" => {
            state
                .client
                .region(rid.unwrap_or(1), pn.unwrap_or(1), &login)
                .await
        }
        _ => state.client.popular(pn.unwrap_or(1), &login).await,
    }
}

#[tauri::command]
pub async fn recommend_feed(
    state: State<'_, AppState>,
    fresh_idx: Option<u32>,
) -> Result<PageResult<VideoCard>, String> {
    let login = login_of(&state);
    state
        .client
        .recommend(fresh_idx.unwrap_or(1), &login)
        .await
}

#[tauri::command]
pub async fn search(
    state: State<'_, AppState>,
    keyword: String,
    page: Option<u32>,
    kind: Option<String>,
    order: Option<String>,
) -> Result<SearchResult, String> {
    let login = login_of(&state);
    state
        .client
        .search(
            &keyword,
            page.unwrap_or(1),
            kind.as_deref().unwrap_or("video"),
            order.as_deref().unwrap_or("totalrank"),
            &login,
        )
        .await
}

#[tauri::command]
pub async fn search_suggest(
    state: State<'_, AppState>,
    keyword: String,
) -> Result<Vec<String>, String> {
    let login = login_of(&state);
    state.client.search_suggest(&keyword, &login).await
}

#[tauri::command]
pub async fn search_trending(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let login = login_of(&state);
    state.client.search_trending(&login).await
}

// ---------------- 视频 ----------------

#[tauri::command]
pub async fn video_detail(
    state: State<'_, AppState>,
    bvid: String,
) -> Result<VideoInfo, String> {
    let login = login_of(&state);
    state.client.video_detail(&bvid, &login).await
}

#[tauri::command]
pub async fn play_info(
    state: State<'_, AppState>,
    bvid: String,
    cid: i64,
    qn: Option<i32>,
    audio_qn: Option<i32>,
    codec: Option<String>,
    try_look: Option<bool>,
) -> Result<PlayInfo, String> {
    let login = login_of(&state);
    let mut info = state
        .client
        .play_info(
            &bvid,
            cid,
            qn.unwrap_or(80),
            audio_qn.unwrap_or(0),
            codec.as_deref().unwrap_or("auto"),
            try_look.unwrap_or(false),
            &login,
        )
        .await?;
    state.proxy.map_play_info(&mut info);
    Ok(info)
}

#[tauri::command]
pub async fn pgc_play_info(
    state: State<'_, AppState>,
    ep: i64,
    cid: i64,
    qn: Option<i32>,
    audio_qn: Option<i32>,
    codec: Option<String>,
) -> Result<PlayInfo, String> {
    let login = login_of(&state);
    let mut info = state
        .client
        .pgc_play_info(
            ep,
            cid,
            qn.unwrap_or(80),
            audio_qn.unwrap_or(0),
            codec.as_deref().unwrap_or("auto"),
            &login,
        )
        .await?;
    state.proxy.map_play_info(&mut info);
    Ok(info)
}

#[tauri::command]
pub async fn danmaku(
    state: State<'_, AppState>,
    cid: i64,
) -> Result<Vec<DanmakuItem>, String> {
    let login = login_of(&state);
    state.client.danmaku(cid, &login).await
}

#[tauri::command]
pub async fn video_subtitles(
    state: State<'_, AppState>,
    bvid: String,
    cid: i64,
) -> Result<Vec<SubtitleTrack>, String> {
    let login = login_of(&state);
    state.client.video_subtitles(&bvid, cid, &login).await
}

#[tauri::command]
pub async fn subtitle_cues(
    state: State<'_, AppState>,
    url: String,
) -> Result<Vec<SubtitleCue>, String> {
    let login = login_of(&state);
    state.client.subtitle_cues(&url, &login).await
}

#[tauri::command]
pub async fn comments(
    state: State<'_, AppState>,
    aid: i64,
    page: Option<u32>,
    sort: Option<String>,
) -> Result<CommentPage, String> {
    let login = login_of(&state);
    state
        .client
        .comments(
            aid,
            page.unwrap_or(1),
            sort.as_deref().unwrap_or("hot"),
            &login,
        )
        .await
}

// ---------------- 登录 ----------------

#[tauri::command]
pub async fn qr_generate(state: State<'_, AppState>) -> Result<QrCode, String> {
    state.client.qr_generate().await
}

#[tauri::command]
pub async fn qr_poll(
    state: State<'_, AppState>,
    app: AppHandle,
    key: String,
) -> Result<QrPoll, String> {
    let poll = state.client.qr_poll(&key).await?;
    if let Some(c) = &poll.cookies {
        {
            let mut store = state.cookies.lock().unwrap();
            store.merge(c);
        }
        save_cookies(&state, &app);
    }
    Ok(poll)
}

#[tauri::command]
pub async fn login_state(state: State<'_, AppState>) -> Result<UserInfo, String> {
    let login = login_of(&state);
    state.client.login_state(&login).await
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    {
        let mut store = state.cookies.lock().unwrap();
        store.clear();
        if let Some(path) = cookie_path(&app) {
            let _ = store.save(&path);
        }
    }
    Ok(())
}

// ---------------- 互动 ----------------

#[tauri::command]
pub async fn like_video(
    state: State<'_, AppState>,
    aid: i64,
    like: bool,
) -> Result<String, String> {
    let login = login_of(&state);
    state.client.like_video(aid, like, &login).await
}

#[tauri::command]
pub async fn coin_video(
    state: State<'_, AppState>,
    aid: i64,
    count: i32,
    also_like: bool,
) -> Result<(), String> {
    let login = login_of(&state);
    state
        .client
        .coin_video(aid, count, also_like, &login)
        .await
}

#[tauri::command]
pub async fn favorite_video(
    state: State<'_, AppState>,
    aid: i64,
    add: Vec<i64>,
    del: Vec<i64>,
) -> Result<(), String> {
    let login = login_of(&state);
    state.client.favorite_video(aid, &add, &del, &login).await
}

#[tauri::command]
pub async fn favorite_folders(
    state: State<'_, AppState>,
    mid: Option<i64>,
) -> Result<Vec<FavoriteFolder>, String> {
    let login = login_of(&state);
    state.client.favorite_folders(mid.unwrap_or(0), &login).await
}

#[tauri::command]
pub async fn create_favorite_folder(
    state: State<'_, AppState>,
    title: String,
) -> Result<i64, String> {
    let login = login_of(&state);
    state.client.create_favorite_folder(&title, &login).await
}

#[tauri::command]
pub async fn favorite_list(
    state: State<'_, AppState>,
    media: i64,
    page: Option<u32>,
) -> Result<PageResult<FavoriteItem>, String> {
    let login = login_of(&state);
    state
        .client
        .favorite_list(media, page.unwrap_or(1), &login)
        .await
}

#[tauri::command]
pub async fn interaction_state(
    state: State<'_, AppState>,
    bvid: String,
    aid: i64,
) -> Result<InteractionState, String> {
    let login = login_of(&state);
    Ok(state.client.interaction_state(&bvid, aid, &login).await)
}

#[tauri::command]
pub async fn follow_user(
    state: State<'_, AppState>,
    mid: i64,
    follow: bool,
) -> Result<(), String> {
    let login = login_of(&state);
    state.client.follow_user(mid, follow, &login).await
}

#[tauri::command]
pub async fn watch_later(state: State<'_, AppState>) -> Result<Vec<WatchLaterItem>, String> {
    let login = login_of(&state);
    state.client.watch_later(&login).await
}

#[tauri::command]
pub async fn watch_later_add(
    state: State<'_, AppState>,
    aid: i64,
    add: bool,
) -> Result<(), String> {
    let login = login_of(&state);
    state.client.watch_later_add(aid, add, &login).await
}

#[tauri::command]
pub async fn report_progress(
    state: State<'_, AppState>,
    aid: i64,
    cid: i64,
    progress: i64,
) -> Result<(), String> {
    let login = login_of(&state);
    state.client.report_progress(aid, cid, progress, &login).await
}

#[tauri::command]
pub async fn history(
    state: State<'_, AppState>,
    max: Option<i64>,
    view_at: Option<i64>,
) -> Result<HistoryPage, String> {
    let login = login_of(&state);
    state
        .client
        .history(max.unwrap_or(0), view_at.unwrap_or(0), &login)
        .await
}

// ---------------- 用户空间 ----------------

#[tauri::command]
pub async fn space_info(
    state: State<'_, AppState>,
    mid: i64,
) -> Result<SpaceInfo, String> {
    let login = login_of(&state);
    state.client.space_info(mid, &login).await
}

#[tauri::command]
pub async fn space_videos(
    state: State<'_, AppState>,
    mid: i64,
    page: Option<u32>,
) -> Result<PageResult<SpaceVideo>, String> {
    let login = login_of(&state);
    state
        .client
        .space_videos(mid, page.unwrap_or(1), &login)
        .await
}

// ---------------- 番剧 ----------------

#[tauri::command]
pub async fn bangumi_list(
    state: State<'_, AppState>,
    page: Option<u32>,
    season_type: Option<i32>,
) -> Result<PageResult<BangumiCard>, String> {
    let login = login_of(&state);
    state
        .client
        .bangumi_list(page.unwrap_or(1), season_type.unwrap_or(1), &login)
        .await
}

#[tauri::command]
pub async fn bangumi_detail(
    state: State<'_, AppState>,
    season_id: i64,
) -> Result<BangumiDetail, String> {
    let login = login_of(&state);
    state.client.bangumi_detail(season_id, &login).await
}

// ---------------- 直播 ----------------

#[tauri::command]
pub async fn live_feed(state: State<'_, AppState>) -> Result<LiveFeed, String> {
    let login = login_of(&state);
    state.client.live_feed(&login).await
}

#[tauri::command]
pub async fn live_areas(state: State<'_, AppState>) -> Result<Vec<LiveAreaGroup>, String> {
    let login = login_of(&state);
    state.client.live_areas(&login).await
}

#[tauri::command]
pub async fn live_rooms(
    state: State<'_, AppState>,
    area_id: i64,
    area_name: String,
    page: Option<u32>,
) -> Result<PageResult<LiveRoom>, String> {
    let login = login_of(&state);
    state
        .client
        .live_rooms(area_id, &area_name, page.unwrap_or(1), &login)
        .await
}

#[tauri::command]
pub async fn live_room_detail(
    state: State<'_, AppState>,
    room_id: i64,
) -> Result<LiveRoomDetail, String> {
    let login = login_of(&state);
    state.client.live_room_detail(room_id, &login).await
}

#[tauri::command]
pub async fn live_play_info(
    state: State<'_, AppState>,
    room_id: i64,
    qn: Option<i32>,
) -> Result<LivePlayInfo, String> {
    let login = login_of(&state);
    let mut info = state
        .client
        .live_play_info(room_id, qn.unwrap_or(0), &login)
        .await?;
    state.proxy.map_live_play_info(&mut info);
    Ok(info)
}

// ---------------- 动态 ----------------

#[tauri::command]
pub async fn dynamic_feed(
    state: State<'_, AppState>,
    kind: Option<String>,
    offset: Option<String>,
) -> Result<DynamicPage, String> {
    let login = login_of(&state);
    state
        .client
        .dynamic_feed(
            kind.as_deref().unwrap_or("all"),
            offset.as_deref().unwrap_or(""),
            &login,
        )
        .await
}

// ---------------- 消息 ----------------

#[tauri::command]
pub async fn msg_feed(
    state: State<'_, AppState>,
    kind: Option<String>,
    cursor_id: Option<i64>,
    cursor_time: Option<i64>,
) -> Result<MessagePage, String> {
    let login = login_of(&state);
    state
        .client
        .msg_feed(
            kind.as_deref().unwrap_or("reply"),
            cursor_id.unwrap_or(0),
            cursor_time.unwrap_or(0),
            &login,
        )
        .await
}

#[tauri::command]
pub async fn msg_unread(state: State<'_, AppState>) -> Result<UnreadCount, String> {
    let login = login_of(&state);
    state.client.msg_unread(&login).await
}

// ---------------- 其他 ----------------

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("只允许打开 http/https 链接".into());
    }
    open::that(url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}
