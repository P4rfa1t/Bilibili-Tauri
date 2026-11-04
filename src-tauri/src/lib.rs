mod api;
mod commands;
mod proxy;
mod secure;

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
            let store = CookieStore::load(&dir.join("cookies.dat")).unwrap_or_default();
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
            commands::history_clear,
            commands::comment_like,
            commands::comment_replies,
            commands::comment_add,
            commands::space_info,
            commands::space_videos,
            commands::space_dynamics,
            commands::bangumi_list,
            commands::bangumi_filters,
            commands::bangumi_detail,
            commands::live_feed,
            commands::live_areas,
            commands::live_rooms,
            commands::live_room_detail,
            commands::live_play_info,
            commands::dynamic_feed,
            commands::dynamic_like,
            commands::dynamic_detail,
            commands::dynamic_comments,
            commands::dynamic_comment_add,
            commands::dynamic_repost,
            commands::dynamic_uplist,
            commands::msg_feed,
            commands::msg_unread,
            commands::live_following,
            commands::dynamic_emotes,
            commands::dynamic_upload_image,
            commands::dynamic_publish,
            commands::live_danmu_conf,
            commands::live_danmu_history,
            commands::live_danmu_send,
            commands::open_url,
            commands::open_web_window,
            commands::app_version,
            commands::open_player_window,
            commands::show_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
