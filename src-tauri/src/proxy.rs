//! 本地媒体代理。
//!
//! B 站 CDN 会校验 Referer，并且需要 Range 支持才能拖动进度条。
//! 这里在 127.0.0.1 上启动一个只允许 B 站域名的流式代理，
//! 把 Referer 补上后原样转发 Range / 206 响应。

use std::net::TcpListener;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;

use crate::api::types::PlayInfo;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const ALLOWED_SUFFIXES: &[&str] = &[
    "hdslb.com",
    "bilivideo.com",
    "bilivideo.cn",
    "bilibili.com",
    "akamaized.net",
    "szbdyd.com",
    "biliapi.net",
    "biliapi.com",
];

#[derive(Clone)]
pub struct ProxyHandle {
    base: String,
    token: String,
}

impl ProxyHandle {
    /// 把原始 CDN 地址包装成本地代理地址
    pub fn url(&self, raw: &str) -> String {
        if raw.is_empty() {
            return String::new();
        }
        let encoded: String =
            url::form_urlencoded::byte_serialize(raw.as_bytes()).collect();
        format!(
            "{}/stream?token={}&url={}",
            self.base, self.token, encoded
        )
    }

    pub fn map_play_info(&self, info: &mut PlayInfo) {
        for stream in &mut info.streams {
            stream.video_url = self.url(&stream.video_url);
            stream.audio_url = self.url(&stream.audio_url);
            stream.video_backups = stream
                .video_backups
                .iter()
                .map(|u| self.url(u))
                .filter(|u| !u.is_empty())
                .collect();
            stream.audio_backups = stream
                .audio_backups
                .iter()
                .map(|u| self.url(u))
                .filter(|u| !u.is_empty())
                .collect();
        }
    }

    pub fn is_allowed(raw: &str) -> bool {
        let Ok(u) = url::Url::parse(raw) else {
            return false;
        };
        if u.scheme() != "https" && u.scheme() != "http" {
            return false;
        }
        let host = u.host_str().unwrap_or("").to_ascii_lowercase();
        ALLOWED_SUFFIXES
            .iter()
            .any(|s| host == *s || host.ends_with(&format!(".{s}")))
    }
}

struct ProxyState {
    http: reqwest::Client,
    token: String,
}

#[derive(Deserialize)]
struct ProxyQuery {
    token: String,
    url: String,
}

pub fn start() -> Result<ProxyHandle, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = random_token();
    let http = reqwest::Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let state = Arc::new(ProxyState {
        http,
        token: token.clone(),
    });
    let app = Router::new()
        .route("/stream", get(stream_handler))
        .with_state(state);

    std::thread::Builder::new()
        .name("bilibili-media-proxy".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(_) => return,
            };
            rt.block_on(async move {
                let listener = match tokio::net::TcpListener::from_std(listener) {
                    Ok(l) => l,
                    Err(_) => return,
                };
                let _ = axum::serve(listener, app).await;
            });
        })
        .map_err(|e| e.to_string())?;

    Ok(ProxyHandle {
        base: format!("http://127.0.0.1:{port}"),
        token,
    })
}

async fn stream_handler(
    State(state): State<Arc<ProxyState>>,
    Query(q): Query<ProxyQuery>,
    method: Method,
    req_headers: HeaderMap,
) -> Response {
    if q.token != state.token {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    if !ProxyHandle::is_allowed(&q.url) {
        return (StatusCode::BAD_REQUEST, "url not allowed").into_response();
    }

    let upstream_method = if method == Method::HEAD {
        Method::HEAD
    } else {
        Method::GET
    };
    let mut req = state
        .http
        .request(upstream_method, &q.url)
        .header(header::REFERER, "https://www.bilibili.com/")
        .header(header::ORIGIN, "https://www.bilibili.com")
        .header(header::USER_AGENT, UA);
    if let Some(range) = req_headers.get(header::RANGE) {
        req = req.header(header::RANGE, range);
    }
    if let Some(if_range) = req_headers.get(header::IF_RANGE) {
        req = req.header(header::IF_RANGE, if_range);
    }
    if let Some(if_none_match) = req_headers.get(header::IF_NONE_MATCH) {
        req = req.header(header::IF_NONE_MATCH, if_none_match);
    }

    let upstream = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, format!("upstream error: {e}")).into_response();
        }
    };

    let status = upstream.status();
    let mut builder = Response::builder().status(status);
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::ETAG,
        header::LAST_MODIFIED,
        header::CACHE_CONTROL,
        header::EXPIRES,
    ] {
        if let Some(v) = upstream.headers().get(&name) {
            builder = builder.header(&name, v.clone());
        }
    }
    if upstream.headers().get(header::ACCEPT_RANGES).is_none() {
        builder = builder.header(header::ACCEPT_RANGES, "bytes");
    }
    builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");

    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from_stream(upstream.bytes_stream())
    };
    builder.body(body).unwrap_or_else(|_| {
        (StatusCode::INTERNAL_SERVER_ERROR, "proxy response error").into_response()
    })
}

fn random_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(1);
    let mut x = nanos ^ 0x9e37_79b9_7f4a_7c15;
    let mut out = String::with_capacity(32);
    for _ in 0..32 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        out.push(char::from_digit((x % 16) as u32, 16).unwrap());
    }
    out
}
