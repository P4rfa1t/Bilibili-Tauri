mod api;
mod commands;
mod proxy;

use std::sync::Mutex;

use api::bilibili::{BilibiliClient, CookieStore};
use proxy::ProxyHandle;
use tauri::Manager;

pub struct AppState {
    pub client: BilibiliClient,
    pub cookies: Mutex<CookieStore>,
    pub proxy: ProxyHandle,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let _ = std::fs::create_dir_all(&dir);
            let store = CookieStore::load(&dir.join("cookies.json")).unwrap_or_default();
            let proxy = proxy::start().expect("启动本地媒体代理失败");
            app.manage(AppState {
                client: BilibiliClient::new(),
                cookies: Mutex::new(store),
                proxy,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::home_feed,
            commands::recommend_feed,
            commands::search,
            commands::search_suggest,
            commands::search_trending,
            commands::video_detail,
            commands::play_info,
            commands::pgc_play_info,
            commands::danmaku,
            commands::video_subtitles,
            commands::subtitle_cues,
            commands::comments,
            commands::qr_generate,
            commands::qr_poll,
            commands::login_state,
            commands::logout,
            commands::like_video,
            commands::coin_video,
            commands::favorite_video,
            commands::favorite_folders,
            commands::create_favorite_folder,
            commands::favorite_list,
            commands::interaction_state,
            commands::follow_user,
            commands::watch_later,
            commands::watch_later_add,
            commands::report_progress,
            commands::history,
            commands::space_info,
            commands::space_videos,
            commands::bangumi_list,
            commands::bangumi_detail,
            commands::live_feed,
            commands::live_areas,
            commands::live_rooms,
            commands::live_room_detail,
            commands::live_play_info,
            commands::open_url,
            commands::app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
