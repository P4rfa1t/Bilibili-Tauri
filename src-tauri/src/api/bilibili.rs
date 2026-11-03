use std::collections::{BTreeMap, HashMap};
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use md5::{Digest, Md5};
use serde_json::Value;

use super::types::*;

const API: &str = "https://api.bilibili.com";
const APP: &str = "https://app.bilibili.com";
const PASSPORT: &str = "https://passport.bilibili.com";
const LIVE_API: &str = "https://api.live.bilibili.com";
const SEARCH: &str = "https://search.bilibili.com";
const SPACE: &str = "https://space.bilibili.com";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const APP_UA: &str = "Mozilla/5.0 BiliDroid/8.43.0 (bbcallen@gmail.com) os/android model/android mobi_app/android build/8430300 channel/master innerVer/8430300 osVer/15 network/2";
const APP_KEY: &str = "dfca71928277209b";
const APP_SEC: &str = "b5475a8825547a4fc26c7d518eaaa02e";
const APP_STATISTICS: &str = r#"{"appId":1,"platform":3,"version":"8.43.0","abtest":""}"#;

/// 登录 cookie 不混入匿名 cookie 池
const LOGIN_COOKIES: &[&str] = &["SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5", "sid"];

/// WBI 混淆表（bilibili-API-collect 公开常量）
const WBI_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
    54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

pub type Cookies = BTreeMap<String, String>;

#[derive(Default, Clone)]
pub struct CookieStore(pub Cookies);

impl CookieStore {
    pub fn load(p: &std::path::Path) -> Option<Self> {
        let s = std::fs::read_to_string(p).ok()?;
        let m: Cookies = serde_json::from_str(&s).ok()?;
        Some(Self(m))
    }

    pub fn save(&self, p: &std::path::Path) -> Result<(), String> {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let s = serde_json::to_string_pretty(&self.0).map_err(|e| e.to_string())?;
        std::fs::write(p, s).map_err(|e| e.to_string())
    }

    pub fn merge(&mut self, other: &Cookies) {
        for (k, v) in other {
            self.0.insert(k.clone(), v.clone());
        }
    }

    pub fn clear(&mut self) {
        self.0.clear();
    }

    pub fn snapshot(&self) -> Cookies {
        self.0.clone()
    }

    pub fn is_login(&self) -> bool {
        self.0
            .get("SESSDATA")
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    }

    pub fn mid(&self) -> i64 {
        self.0
            .get("DedeUserID")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0)
    }

    pub fn csrf(&self) -> String {
        self.0.get("bili_jct").cloned().unwrap_or_default()
    }
}

pub struct BilibiliClient {
    http: reqwest::Client,
    /// 匿名 cookie（buvid3 等），nav 等接口会下发
    base: Arc<Mutex<Cookies>>,
    /// 缓存的 WBI 混淆后的 32 位 key（key, 获取时间）
    wbi: Arc<Mutex<Option<(String, u64)>>>,
    search_ready: Arc<Mutex<bool>>,
}

impl BilibiliClient {
    pub fn new() -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::REFERER,
            reqwest::header::HeaderValue::from_static("https://www.bilibili.com/"),
        );
        headers.insert(
            reqwest::header::ORIGIN,
            reqwest::header::HeaderValue::from_static("https://www.bilibili.com"),
        );
        headers.insert(
            reqwest::header::ACCEPT_LANGUAGE,
            reqwest::header::HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.8"),
        );
        let http = reqwest::Client::builder()
            .user_agent(UA)
            .default_headers(headers)
            .build()
            .expect("build reqwest client");
        Self {
            http,
            base: Arc::new(Mutex::new(Cookies::new())),
            wbi: Arc::new(Mutex::new(None)),
            search_ready: Arc::new(Mutex::new(false)),
        }
    }

    // ---------- HTTP 基础层 ----------

    fn merged(&self, login: &Cookies) -> Cookies {
        let mut m = self.base.lock().unwrap().clone();
        for (k, v) in login {
            m.insert(k.clone(), v.clone());
        }
        m
    }

    fn cookie_header(cookies: &Cookies) -> String {
        cookies
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ")
    }

    /// 吸收响应里的 set-cookie 到匿名池（登录 cookie 除外）
    fn absorb(&self, resp: &reqwest::Response) {
        let mut base = self.base.lock().unwrap();
        for sc in resp.headers().get_all(reqwest::header::SET_COOKIE) {
            let Ok(s) = sc.to_str() else { continue };
            let pair = s.split(';').next().unwrap_or("");
            if let Some((k, val)) = pair.split_once('=') {
                let k = k.trim();
                if LOGIN_COOKIES.contains(&k) {
                    continue;
                }
                base.insert(k.to_string(), val.trim().to_string());
            }
        }
    }

    async fn finish(&self, req: reqwest::RequestBuilder) -> Result<Value, String> {
        let resp = req.send().await.map_err(|e| e.to_string())?;
        self.absorb(&resp);
        let status = resp.status();
        let body = resp.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!("HTTP {status}: {}", truncate(&body, 200)));
        }
        serde_json::from_str(&body).map_err(|e| format!("JSON 解析失败: {e}"))
    }

    async fn send_json(
        &self,
        req: reqwest::RequestBuilder,
        login: &Cookies,
    ) -> Result<Value, String> {
        let cookie = Self::cookie_header(&self.merged(login));
        let req = if cookie.is_empty() {
            req
        } else {
            req.header("cookie", cookie)
        };
        self.finish(req).await
    }

    async fn api_get_at(
        &self,
        path: &str,
        params: &[(&str, String)],
        login: &Cookies,
        referer: &str,
        origin: &str,
    ) -> Result<Value, String> {
        let mut req = self
            .http
            .get(format!("{API}{path}"))
            .header("referer", referer)
            .header("origin", origin);
        if !params.is_empty() {
            req = req.query(params);
        }
        let v = self.send_json(req, login).await?;
        check(&v)
    }

    async fn api_get(
        &self,
        path: &str,
        params: &[(&str, String)],
        login: &Cookies,
    ) -> Result<Value, String> {
        self.api_get_at(path, params, login, "https://www.bilibili.com/", "https://www.bilibili.com")
            .await
    }

    async fn api_get_raw_at(
        &self,
        path: &str,
        params: &[(&str, String)],
        login: &Cookies,
        referer: &str,
        origin: &str,
    ) -> Result<Value, String> {
        let mut req = self
            .http
            .get(format!("{API}{path}"))
            .header("referer", referer)
            .header("origin", origin);
        if !params.is_empty() {
            req = req.query(params);
        }
        self.send_json(req, login).await
    }

    async fn api_get_raw(
        &self,
        path: &str,
        params: &[(&str, String)],
        login: &Cookies,
    ) -> Result<Value, String> {
        self.api_get_raw_at(path, params, login, "https://www.bilibili.com/", "https://www.bilibili.com")
            .await
    }

    async fn post_form_at(
        &self,
        path: &str,
        form: Vec<(String, String)>,
        login: &Cookies,
        referer: &str,
    ) -> Result<Value, String> {
        let req = self
            .http
            .post(format!("{API}{path}"))
            .header("referer", referer)
            .header("origin", "https://www.bilibili.com")
            .form(&form);
        let v = self.send_json(req, login).await?;
        check(&v)
    }

    async fn get_text(&self, url: &str, login: &Cookies) -> Result<String, String> {
        let cookie = Self::cookie_header(&self.merged(login));
        let mut req = self.http.get(url);
        if !cookie.is_empty() {
            req = req.header("cookie", cookie);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        self.absorb(&resp);
        resp.text().await.map_err(|e| e.to_string())
    }

    async fn get_json_url_at(
        &self,
        url: &str,
        login: &Cookies,
        referer: &str,
        origin: &str,
    ) -> Result<Value, String> {
        let cookie = Self::cookie_header(&self.merged(login));
        let mut req = self
            .http
            .get(url)
            .header("referer", referer)
            .header("origin", origin);
        if !cookie.is_empty() {
            req = req.header("cookie", cookie);
        }
        self.finish(req).await
    }

    async fn get_json_url(
        &self,
        url: &str,
        login: &Cookies,
        referer: &str,
    ) -> Result<Value, String> {
        self.get_json_url_at(url, login, referer, "https://www.bilibili.com")
            .await
    }

    // ---------- 匿名 cookie / 风控前置 ----------

    async fn ensure_buvid(&self, login: &Cookies) {
        if self.base.lock().unwrap().contains_key("buvid3") {
            return;
        }
        if let Ok(resp) = self
            .http
            .get("https://www.bilibili.com/")
            .header("referer", "https://www.bilibili.com/")
            .send()
            .await
        {
            self.absorb(&resp);
        }
        let has = self.base.lock().unwrap().contains_key("buvid3");
        if !has {
            if let Ok(v) = self
                .api_get_raw("/x/frontend/finger/spi", &[], &Cookies::new())
                .await
            {
                let b3 = v["data"]["b_3"].as_str().unwrap_or("");
                let b4 = v["data"]["b_4"].as_str().unwrap_or("");
                if !b3.is_empty() {
                    let mut base = self.base.lock().unwrap();
                    base.insert("buvid3".into(), b3.to_string());
                    if !b4.is_empty() {
                        base.insert("buvid4".into(), b4.to_string());
                    }
                }
            }
        }
        let mut base = self.base.lock().unwrap();
        if !base.contains_key("b_nut") {
            base.insert("b_nut".into(), now_secs().to_string());
        }
        drop(base);
        let _ = login;
    }

    /// 搜索接口需要先在 search.bilibili.com 上拿到 buvid3 / b_nut，否则会返回 v_voucher
    async fn ensure_search_cookies(&self, login: &Cookies) {
        self.ensure_buvid(login).await;
        let ready = *self.search_ready.lock().unwrap();
        let has_nut = self.base.lock().unwrap().contains_key("b_nut");
        if ready && has_nut {
            return;
        }
        if let Ok(resp) = self
            .http
            .get(SEARCH)
            .header("referer", "https://www.bilibili.com/")
            .send()
            .await
        {
            self.absorb(&resp);
        }
        let mut base = self.base.lock().unwrap();
        if !base.contains_key("b_nut") {
            base.insert("b_nut".into(), now_secs().to_string());
        }
        drop(base);
        *self.search_ready.lock().unwrap() = true;
    }

    // ---------- WBI 签名 ----------

    async fn wbi_key(&self, login: &Cookies) -> Result<String, String> {
        if let Some((k, t)) = self.wbi.lock().unwrap().clone() {
            if now_secs().saturating_sub(t) < 6 * 3600 {
                return Ok(k);
            }
        }
        let v = self.api_get_raw("/x/web-interface/nav", &[], login).await?;
        let img = key_from_url(v["data"]["wbi_img"]["img_url"].as_str().unwrap_or(""));
        let sub = key_from_url(v["data"]["wbi_img"]["sub_url"].as_str().unwrap_or(""));
        if img.is_empty() || sub.is_empty() {
            return Err("获取 WBI key 失败".into());
        }
        let k = mixin_key(&img, &sub);
        *self.wbi.lock().unwrap() = Some((k.clone(), now_secs()));
        Ok(k)
    }

    async fn wbi_get_at(
        &self,
        path: &str,
        mut params: BTreeMap<String, String>,
        login: &Cookies,
        referer: &str,
        origin: &str,
    ) -> Result<Value, String> {
        let key = self.wbi_key(login).await?;
        params.insert("wts".into(), now_secs().to_string());
        let filtered: BTreeMap<String, String> = params
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    v.chars().filter(|c| !"'!*()".contains(*c)).collect(),
                )
            })
            .collect();
        let q = filtered
            .iter()
            .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
            .collect::<Vec<_>>()
            .join("&");
        let w_rid = hex_md5(&format!("{q}{key}"));
        let req = self
            .http
            .get(format!("{API}{path}?{q}&w_rid={w_rid}"))
            .header("referer", referer)
            .header("origin", origin);
        let v = self.send_json(req, login).await?;
        check(&v)
    }

    // ---------- App API（无需登录，签名后调用） ----------

    async fn app_get(
        &self,
        path: &str,
        mut params: BTreeMap<String, String>,
        login: &Cookies,
    ) -> Result<Value, String> {
        params.insert("appkey".into(), APP_KEY.into());
        params.insert("ts".into(), now_secs().to_string());
        let q = params
            .iter()
            .map(|(k, v)| format!("{}={}", dart_encode(k), dart_encode(v)))
            .collect::<Vec<_>>()
            .join("&");
        let sign = hex_md5(&format!("{q}{APP_SEC}"));
        let req = self
            .http
            .get(format!("{APP}{path}?{q}&sign={sign}"))
            .header("user-agent", APP_UA);
        let v = self.send_json(req, login).await?;
        check(&v)
    }

    // ---------- 发现 ----------

    /// 综合热门
    pub async fn popular(&self, pn: u32, login: &Cookies) -> Result<PageResult<VideoCard>, String> {
        self.ensure_buvid(login).await;
        let d = self
            .api_get(
                "/x/web-interface/popular",
                &[("ps", "20".into()), ("pn", pn.to_string())],
                login,
            )
            .await?;
        let items = videos_from(&d["list"]);
        let has_more = !d["no_more"].as_bool().unwrap_or(false);
        Ok(PageResult {
            items,
            page: pn,
            has_more,
            total: num_of(&d["total"]),
        })
    }

    /// 官方首页推荐流。
    ///
    /// 与热门不同，推荐接口会结合登录 Cookie 给出更贴近个人偏好的内容；
    /// 匿名状态下也能返回官方推荐。`fresh_idx` 递增即可获得下一批内容。
    pub async fn recommend(
        &self,
        fresh_idx: u32,
        login: &Cookies,
    ) -> Result<PageResult<VideoCard>, String> {
        self.ensure_buvid(login).await;
        let idx = fresh_idx.max(1);
        let params = [
            ("ps", "24".to_string()),
            ("fresh_type", "3".to_string()),
            ("feed_version", "V8".to_string()),
            ("fresh_idx", idx.to_string()),
            ("fresh_idx_1h", idx.to_string()),
            ("brush", idx.saturating_sub(1).to_string()),
            ("homepage_ver", "1".to_string()),
            ("screen", "1920-1080".to_string()),
            ("web_location", "1430654".to_string()),
        ];
        match self
            .api_get("/x/web-interface/index/top/feed/rcmd", &params, login)
            .await
        {
            Ok(d) => {
                let mut items = Vec::new();
                if let Some(arr) = d["item"].as_array() {
                    for item in arr {
                        if item["goto"].as_str() != Some("av") {
                            continue;
                        }
                        let Some(mut card) = parse_video_card(item) else {
                            continue;
                        };
                        if card.aid <= 0 {
                            card.aid = num_of(&item["id"]);
                        }
                        if card.recommend_reason.is_empty() {
                            card.recommend_reason =
                                plain_text(&text_of(&item["rcmd_reason"]["content"]));
                        }
                        items.push(card);
                    }
                }
                if items.is_empty() {
                    return Err("暂时没有获取到推荐内容，请稍后重试".into());
                }
                Ok(PageResult {
                    items,
                    page: idx,
                    has_more: idx < 60,
                    total: 0,
                })
            }
            Err(error) => {
                // 推荐接口偶发风控时退回热门，保证页面仍可浏览
                let mut fallback = self.popular(1, login).await.map_err(|_| error)?;
                fallback.page = idx;
                Ok(fallback)
            }
        }
    }

    /// 排行榜
    pub async fn ranking(&self, rid: i64, login: &Cookies) -> Result<PageResult<VideoCard>, String> {
        let d = self
            .api_get(
                "/x/web-interface/ranking/v2",
                &[("rid", rid.to_string()), ("type", "all".into())],
                login,
            )
            .await?;
        let items = videos_from(&d["list"]);
        Ok(PageResult {
            items,
            page: 1,
            has_more: false,
            total: 0,
        })
    }

    /// 分区最新投稿
    pub async fn region(&self, rid: i64, pn: u32, login: &Cookies) -> Result<PageResult<VideoCard>, String> {
        let d = self
            .api_get(
                "/x/web-interface/newlist",
                &[
                    ("rid", rid.to_string()),
                    ("pn", pn.to_string()),
                    ("ps", "20".into()),
                ],
                login,
            )
            .await?;
        let items = videos_from(&d["archives"]);
        Ok(PageResult {
            items,
            page: pn,
            has_more: false,
            total: 0,
        })
    }

    /// 分类搜索（video / user / bangumi）
    pub async fn search(
        &self,
        keyword: &str,
        page: u32,
        kind: &str,
        order: &str,
        login: &Cookies,
    ) -> Result<SearchResult, String> {
        self.ensure_search_cookies(login).await;
        let (search_type, page_name) = match kind {
            "user" => ("bili_user", "bili_user"),
            "bangumi" => ("media_bangumi", "bangumi"),
            _ => ("video", "video"),
        };
        let mut params = BTreeMap::new();
        params.insert("search_type".into(), search_type.into());
        params.insert("keyword".into(), keyword.into());
        params.insert("page".into(), page.to_string());
        params.insert("page_size".into(), "20".into());
        params.insert("platform".into(), "pc".into());
        params.insert("web_location".into(), "1430654".into());
        if kind == "video" && !order.is_empty() {
            params.insert("order".into(), order.into());
        }
        let referer = format!(
            "{SEARCH}/{page_name}?keyword={}",
            urlencode(keyword)
        );
        let mut d = self
            .wbi_get_at(
                "/x/web-interface/wbi/search/type",
                params,
                login,
                &referer,
                SEARCH,
            )
            .await?;

        // 极少数情况下会下发风控凭证，刷新一次搜索 cookie 后重试
        if d.get("v_voucher").is_some() {
            *self.search_ready.lock().unwrap() = false;
            self.ensure_search_cookies(login).await;
            let mut params = BTreeMap::new();
            params.insert("search_type".into(), search_type.into());
            params.insert("keyword".into(), keyword.into());
            params.insert("page".into(), page.to_string());
            params.insert("page_size".into(), "20".into());
            params.insert("platform".into(), "pc".into());
            params.insert("web_location".into(), "1430654".into());
            if kind == "video" && !order.is_empty() {
                params.insert("order".into(), order.into());
            }
            d = self
                .wbi_get_at(
                    "/x/web-interface/wbi/search/type",
                    params,
                    login,
                    &referer,
                    SEARCH,
                )
                .await?;
            if d.get("v_voucher").is_some() {
                return Err("搜索触发 B 站风控，请登录账号后再试，或稍后重试".into());
            }
        }

        let total = num_of(&d["numResults"]);
        let pages = num_of(&d["numPages"]);
        let has_more = pages > 0 && (page as i64) < pages;
        let mut result = SearchResult {
            kind: kind.to_string(),
            page,
            has_more,
            total,
            ..Default::default()
        };
        let Some(arr) = d["result"].as_array() else {
            return Ok(result);
        };
        match kind {
            "user" => {
                result.users = arr.iter().filter_map(parse_user_card).collect();
            }
            "bangumi" => {
                result.bangumi = arr.iter().filter_map(parse_bangumi_card).collect();
            }
            _ => {
                result.videos = arr.iter().filter_map(parse_search_video).collect();
            }
        }
        Ok(result)
    }

    pub async fn search_suggest(&self, keyword: &str, login: &Cookies) -> Result<Vec<String>, String> {
        self.ensure_search_cookies(login).await;
        let d = self
            .api_get_at(
                "/x/web-interface/suggest",
                &[("term", keyword.to_string())],
                login,
                &format!("{SEARCH}/"),
                SEARCH,
            )
            .await?;
        let mut out = Vec::new();
        if let Some(tags) = d["result"]["tag"].as_array() {
            for t in tags {
                let v = t["value"].as_str().unwrap_or("").to_string();
                if !v.is_empty() && !out.contains(&v) {
                    out.push(v);
                }
                if out.len() >= 8 {
                    break;
                }
            }
        }
        Ok(out)
    }

    pub async fn search_trending(&self, login: &Cookies) -> Result<Vec<String>, String> {
        let d = self
            .api_get_at(
                "/x/v2/search/trending/ranking",
                &[("limit", "20".into())],
                login,
                &format!("{SEARCH}/"),
                SEARCH,
            )
            .await?;
        let mut out = Vec::new();
        if let Some(list) = d["list"].as_array() {
            for it in list {
                let v = it["show_name"]
                    .as_str()
                    .or_else(|| it["keyword"].as_str())
                    .unwrap_or("");
                if !v.is_empty() && !out.contains(&v.to_string()) {
                    out.push(v.to_string());
                }
            }
        }
        Ok(out)
    }

    // ---------- 视频详情 ----------

    pub async fn video_detail(&self, bvid: &str, login: &Cookies) -> Result<VideoInfo, String> {
        self.ensure_buvid(login).await;
        let detail = self
            .api_get(
                "/x/web-interface/view/detail",
                &[("bvid", bvid.to_string())],
                login,
            )
            .await;
        let (view, tags, related) = match detail {
            Ok(d) if d.get("View").map(|v| !v.is_null()).unwrap_or(false) => {
                let tags = d["Tags"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|t| t["tag_name"].as_str().map(|s| s.to_string()))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let related = d["Related"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(parse_video_card)
                            .filter(|v| !v.bvid.is_empty())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                (d["View"].clone(), tags, related)
            }
            _ => {
                let view = self
                    .api_get(
                        "/x/web-interface/view",
                        &[("bvid", bvid.to_string())],
                        login,
                    )
                    .await?;
                (view, Vec::new(), Vec::new())
            }
        };

        let pages: Vec<VideoPage> = view["pages"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|p| VideoPage {
                cid: num_of(&p["cid"]),
                page: num_of(&p["page"]) as i32,
                part: text_of(&p["part"]),
                duration: num_of(&p["duration"]),
            })
            .collect();
        let cid = if num_of(&view["cid"]) > 0 {
            num_of(&view["cid"])
        } else {
            pages.first().map(|p| p.cid).unwrap_or(0)
        };
        Ok(VideoInfo {
            bvid: text_of(&view["bvid"]),
            aid: num_of(&view["aid"]),
            title: text_of(&view["title"]),
            desc: text_of(&view["desc"]),
            cover: fix_url(&text_of(&view["pic"])),
            duration: num_of(&view["duration"]),
            pubdate: num_of(&view["pubdate"]),
            ctime: num_of(&view["ctime"]),
            tname: text_of(&view["tname"]),
            videos: num_of(&view["videos"]) as i32,
            owner: VideoOwner {
                mid: num_of(&view["owner"]["mid"]),
                name: text_of(&view["owner"]["name"]),
                face: fix_url(&text_of(&view["owner"]["face"])),
            },
            stat: VideoStat {
                view: num_of(&view["stat"]["view"]),
                danmaku: num_of(&view["stat"]["danmaku"]),
                reply: num_of(&view["stat"]["reply"]),
                favorite: num_of(&view["stat"]["favorite"]),
                coin: num_of(&view["stat"]["coin"]),
                share: num_of(&view["stat"]["share"]),
                like: num_of(&view["stat"]["like"]),
            },
            pages,
            cid,
            width: num_of(&view["dimension"]["width"]) as i32,
            height: num_of(&view["dimension"]["height"]) as i32,
            tags,
            related,
        })
    }

    // ---------- 播放 ----------

    pub async fn play_info(
        &self,
        bvid: &str,
        cid: i64,
        qn: i32,
        audio_qn: i32,
        codec: &str,
        try_look: bool,
        login: &Cookies,
    ) -> Result<PlayInfo, String> {
        self.ensure_buvid(login).await;
        let mut params = BTreeMap::new();
        params.insert("bvid".into(), bvid.into());
        params.insert("cid".into(), cid.to_string());
        params.insert("qn".into(), qn.to_string());
        params.insert("fnval".into(), "4048".into());
        params.insert("fourk".into(), "1".into());
        params.insert("platform".into(), "pc".into());
        params.insert("high_quality".into(), "1".into());
        if try_look {
            // 匿名状态下开启“免登录 1080P”
            params.insert("try_look".into(), "1".into());
        }
        let referer = format!("https://www.bilibili.com/video/{bvid}");
        let res = self
            .wbi_get_at(
                "/x/player/wbi/playurl",
                params,
                login,
                &referer,
                "https://www.bilibili.com",
            )
            .await;
        let d = match res {
            Ok(v) => v,
            Err(e) => {
                let mut fallback_params = vec![
                    ("bvid", bvid.to_string()),
                    ("cid", cid.to_string()),
                    ("qn", qn.to_string()),
                    ("fnval", "4048".into()),
                    ("fourk", "1".into()),
                    ("platform", "pc".into()),
                    ("high_quality", "1".into()),
                ];
                if try_look {
                    fallback_params.push(("try_look", "1".into()));
                }
                let fallback = self
                    .api_get("/x/player/playurl", &fallback_params, login)
                    .await;
                fallback.map_err(|_| e)?
            }
        };
        build_play_info(&d, false, audio_qn, codec)
    }

    /// 番剧 / 影视播放地址
    pub async fn pgc_play_info(
        &self,
        ep_id: i64,
        cid: i64,
        qn: i32,
        audio_qn: i32,
        codec: &str,
        login: &Cookies,
    ) -> Result<PlayInfo, String> {
        let referer = format!("https://www.bilibili.com/bangumi/play/ep{ep_id}");
        let v = self
            .api_get_raw_at(
                "/pgc/player/web/playurl",
                &[
                    ("ep_id", ep_id.to_string()),
                    ("cid", cid.to_string()),
                    ("qn", qn.to_string()),
                    ("fnval", "4048".into()),
                    ("fourk", "1".into()),
                    ("platform", "pc".into()),
                ],
                login,
                &referer,
                "https://www.bilibili.com",
            )
            .await?;
        let code = v["code"].as_i64().unwrap_or(0);
        if code != 0 {
            return Err(text_of(&v["message"]));
        }
        let d = if v.get("result").is_some() {
            v["result"].clone()
        } else {
            v["data"].clone()
        };
        if d.is_null() {
            return Err("未获取到番剧播放信息（可能受地区或版权限制）".into());
        }
        build_play_info(&d, true, audio_qn, codec)
    }

    pub async fn danmaku(&self, cid: i64, login: &Cookies) -> Result<Vec<DanmakuItem>, String> {
        let xml = self
            .get_text(&format!("https://comment.bilibili.com/{cid}.xml"), login)
            .await?;
        Ok(parse_danmaku(&xml))
    }

    pub async fn video_subtitles(
        &self,
        bvid: &str,
        cid: i64,
        login: &Cookies,
    ) -> Result<Vec<SubtitleTrack>, String> {
        let d = self
            .api_get(
                "/x/player/v2",
                &[("bvid", bvid.to_string()), ("cid", cid.to_string())],
                login,
            )
            .await
            .unwrap_or(Value::Null);
        let mut out = Vec::new();
        if let Some(arr) = d["subtitle"]["subtitles"].as_array() {
            for s in arr {
                let url = fix_url(&text_of(&s["subtitle_url"]));
                if url.is_empty() {
                    continue;
                }
                out.push(SubtitleTrack {
                    lan: text_of(&s["lan"]),
                    lan_doc: text_of(&s["lan_doc"]),
                    url,
                });
            }
        }
        Ok(out)
    }

    pub async fn subtitle_cues(
        &self,
        url: &str,
        login: &Cookies,
    ) -> Result<Vec<SubtitleCue>, String> {
        let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
        if parsed.scheme() != "https" {
            return Err("字幕地址不合法".into());
        }
        let host = parsed.host_str().unwrap_or("");
        if !host.ends_with("hdslb.com") && !host.ends_with("bilibili.com") {
            return Err("字幕地址不合法".into());
        }
        let v = self
            .get_json_url(url, login, "https://www.bilibili.com/")
            .await?;
        let mut out = Vec::new();
        if let Some(arr) = v["body"].as_array() {
            for c in arr {
                out.push(SubtitleCue {
                    from: c["from"].as_f64().unwrap_or(0.0),
                    to: c["to"].as_f64().unwrap_or(0.0),
                    content: text_of(&c["content"]),
                });
            }
        }
        Ok(out)
    }

    // ---------- 评论 ----------

    pub async fn comments(
        &self,
        aid: i64,
        page: u32,
        sort: &str,
        login: &Cookies,
    ) -> Result<CommentPage, String> {
        self.ensure_buvid(login).await;
        let sort = if sort == "time" { "0" } else { "2" };
        let d = self
            .api_get(
                "/x/v2/reply",
                &[
                    ("type", "1".into()),
                    ("oid", aid.to_string()),
                    ("pn", page.to_string()),
                    ("ps", "20".into()),
                    ("sort", sort.into()),
                ],
                login,
            )
            .await?;
        let items = d["replies"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| parse_comment(v, 0)).collect())
            .unwrap_or_default();
        let total = num_of(&d["page"]["acount"]);
        let pages = num_of(&d["page"]["count"]);
        Ok(CommentPage {
            items,
            page,
            has_more: pages > 0 && (page as i64) < pages,
            total,
        })
    }

    /// 评论点赞 / 取消点赞（action: true=赞 false=取消）。
    pub async fn comment_like(
        &self,
        aid: i64,
        rpid: i64,
        action: bool,
        login: &Cookies,
    ) -> Result<i64, String> {
        let csrf = Self::require_login(login)?;
        let d = self
            .post_form_at(
                "/x/v2/reply/action",
                vec![
                    ("type".to_string(), "1".to_string()),
                    ("oid".to_string(), aid.to_string()),
                    ("rpid".to_string(), rpid.to_string()),
                    (
                        "action".to_string(),
                        if action { "1" } else { "0" }.to_string(),
                    ),
                    ("csrf".to_string(), csrf),
                ],
                login,
                &format!("https://www.bilibili.com/video/av{aid}"),
            )
            .await?;
        Ok(num_of(&d["action"]))
    }

    /// 评论的子回复列表（查看更多回复）。
    pub async fn comment_replies(
        &self,
        aid: i64,
        rpid: i64,
        page: u32,
        login: &Cookies,
    ) -> Result<CommentPage, String> {
        self.ensure_buvid(login).await;
        let d = self
            .api_get(
                "/x/v2/reply/reply",
                &[
                    ("type", "1".into()),
                    ("oid", aid.to_string()),
                    ("root", rpid.to_string()),
                    ("pn", page.to_string()),
                    ("ps", "20".into()),
                    ("nohot", "0".into()),
                ],
                login,
            )
            .await?;
        let items = d["replies"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| parse_comment(v, 0)).collect())
            .unwrap_or_default();
        let total = num_of(&d["page"]["count"]);
        let pages = (total + 19) / 20;
        Ok(CommentPage {
            items,
            page,
            has_more: pages > 0 && (page as i64) < pages,
            total,
        })
    }

    /// 发表评论。`root` 非 0 时是回复某条评论（子回复）。
    pub async fn comment_add(
        &self,
        aid: i64,
        message: &str,
        root: i64,
        login: &Cookies,
    ) -> Result<CommentItem, String> {
        let csrf = Self::require_login(login)?;
        self.ensure_buvid(login).await;
        let text = message.trim();
        if text.is_empty() {
            return Err("评论内容不能为空".into());
        }
        let mut form = vec![
            ("type".to_string(), "1".to_string()),
            ("oid".to_string(), aid.to_string()),
            ("message".to_string(), text.to_string()),
            ("plat".to_string(), "1".to_string()),
            ("csrf".to_string(), csrf),
        ];
        if root > 0 {
            form.push(("root".to_string(), root.to_string()));
            form.push(("parent".to_string(), root.to_string()));
        }
        let d = self
            .post_form_at(
                "/x/v2/reply/add",
                form,
                login,
                &format!("https://www.bilibili.com/video/av{aid}"),
            )
            .await?;
        let rpid = num_of(&d["rpid"]);
        let mut item = parse_comment(&d["reply"], if root > 0 { 1 } else { 0 }).unwrap_or_default();
        if item.rpid <= 0 {
            item.rpid = rpid;
        }
        item.oid = aid;
        item.message = text.to_string();
        Ok(item)
    }

    // ---------- 登录 ----------

    pub async fn login_state(&self, login: &Cookies) -> Result<UserInfo, String> {
        let v = self.api_get_raw("/x/web-interface/nav", &[], login).await?;
        let d = &v["data"];
        Ok(UserInfo {
            is_login: d["isLogin"].as_bool().unwrap_or(false),
            mid: num_of(&d["mid"]),
            name: text_of(&d["uname"]),
            face: fix_url(&text_of(&d["face"])),
            level: num_of(&d["level_info"]["current_level"]) as i32,
            vip_status: num_of(&d["vipStatus"]) as i32,
            coin: d["money"].as_f64().unwrap_or(0.0),
        })
    }

    pub async fn qr_generate(&self) -> Result<QrCode, String> {
        // 二维码接口挂在 passport 域，不能复用 api.bilibili.com。
        let url = format!("{PASSPORT}/x/passport-login/web/qrcode/generate");
        let v = self
            .get_json_url_at(
                &url,
                &Cookies::new(),
                "https://passport.bilibili.com/",
                "https://passport.bilibili.com",
            )
            .await?;
        let d = check(&v)?;
        let url = text_of(&d["url"]);
        let key = text_of(&d["qrcode_key"]);
        if url.is_empty() || key.is_empty() {
            return Err("二维码生成失败".into());
        }
        Ok(QrCode {
            qr: make_qr_png(&url)?,
            key,
        })
    }

    pub async fn qr_poll(&self, key: &str) -> Result<QrPoll, String> {
        let url = format!("{PASSPORT}/x/passport-login/web/qrcode/poll");
        let cookie = Self::cookie_header(&self.merged(&Cookies::new()));
        let mut req = self
            .http
            .get(url)
            .query(&[("qrcode_key", key)])
            .header("referer", "https://passport.bilibili.com/")
            .header("origin", "https://passport.bilibili.com");
        if !cookie.is_empty() {
            req = req.header("cookie", cookie);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        self.absorb(&resp);
        let http_status = resp.status();
        let mut cookies = Cookies::new();
        for sc in resp.headers().get_all(reqwest::header::SET_COOKIE) {
            let Ok(s) = sc.to_str() else { continue };
            let pair = s.split(';').next().unwrap_or("");
            if let Some((k, val)) = pair.split_once('=') {
                cookies.insert(k.trim().to_string(), val.trim().to_string());
            }
        }
        let body = resp.text().await.map_err(|e| e.to_string())?;
        if !http_status.is_success() {
            return Err(format!("HTTP {http_status}: {}", truncate(&body, 200)));
        }
        let v: Value = serde_json::from_str(&body).map_err(|e| format!("JSON 解析失败: {e}"))?;
        let d = check(&v)?;
        let status = num_of(&d["code"]);
        let message = text_of(&d["message"]);
        if status == 0 {
            // 部分情况下 cookie 只在返回 URL 的查询参数里
            if let Some(u) = d["url"].as_str() {
                if let Ok(parsed) = url::Url::parse(u) {
                    for (k, val) in parsed.query_pairs() {
                        if LOGIN_COOKIES.contains(&k.as_ref()) {
                            cookies.insert(k.to_string(), val.to_string());
                        }
                    }
                }
            }
        }
        let cookies = if status == 0 && !cookies.is_empty() {
            Some(cookies)
        } else {
            None
        };
        Ok(QrPoll {
            status,
            message,
            cookies,
        })
    }

    // ---------- 互动 ----------

    fn require_login(login: &Cookies) -> Result<String, String> {
        if !login
            .get("SESSDATA")
            .map(|s| !s.is_empty())
            .unwrap_or(false)
        {
            return Err("请先登录".into());
        }
        let csrf = login.get("bili_jct").cloned().unwrap_or_default();
        if csrf.is_empty() {
            return Err("登录状态已失效，请重新登录".into());
        }
        Ok(csrf)
    }

    pub async fn like_video(
        &self,
        aid: i64,
        like: bool,
        login: &Cookies,
    ) -> Result<String, String> {
        let csrf = Self::require_login(login)?;
        let form = vec![
            ("aid".to_string(), aid.to_string()),
            ("like".to_string(), if like { "1" } else { "0" }.to_string()),
            ("csrf".to_string(), csrf),
        ];
        let d = self
            .post_form_at(
                "/x/web-interface/archive/like",
                form,
                login,
                &format!("https://www.bilibili.com/video/av{aid}"),
            )
            .await?;
        Ok(text_of(&d["toast"]))
    }

    pub async fn coin_video(
        &self,
        aid: i64,
        count: i32,
        also_like: bool,
        login: &Cookies,
    ) -> Result<(), String> {
        let csrf = Self::require_login(login)?;
        let form = vec![
            ("aid".to_string(), aid.to_string()),
            ("multiply".to_string(), count.clamp(1, 2).to_string()),
            (
                "select_like".to_string(),
                if also_like { "1" } else { "0" }.to_string(),
            ),
            ("csrf".to_string(), csrf),
        ];
        self.post_form_at(
            "/x/web-interface/coin/add",
            form,
            login,
            &format!("https://www.bilibili.com/video/av{aid}"),
        )
        .await?;
        Ok(())
    }

    pub async fn favorite_video(
        &self,
        aid: i64,
        add: &[i64],
        del: &[i64],
        login: &Cookies,
    ) -> Result<(), String> {
        let csrf = Self::require_login(login)?;
        let join = |ids: &[i64]| {
            ids.iter()
                .map(|i| i.to_string())
                .collect::<Vec<_>>()
                .join(",")
        };
        let form = vec![
            ("rid".to_string(), aid.to_string()),
            ("type".to_string(), "2".to_string()),
            ("add_media_ids".to_string(), join(add)),
            ("del_media_ids".to_string(), join(del)),
            ("csrf".to_string(), csrf),
        ];
        self.post_form_at(
            "/x/v3/fav/resource/deal",
            form,
            login,
            &format!("https://www.bilibili.com/video/av{aid}"),
        )
        .await?;
        Ok(())
    }

    pub async fn favorite_folders(
        &self,
        mid: i64,
        login: &Cookies,
    ) -> Result<Vec<FavoriteFolder>, String> {
        Self::require_login(login)?;
        let mid = if mid > 0 { mid } else { mid_of(login) };
        if mid <= 0 {
            return Err("无法获取用户 ID".into());
        }
        let d = self
            .api_get(
                "/x/v3/fav/folder/created/list-all",
                &[("up_mid", mid.to_string())],
                login,
            )
            .await?;
        let mut out = Vec::new();
        if let Some(arr) = d["list"].as_array() {
            for f in arr {
                out.push(FavoriteFolder {
                    id: num_of(&f["id"]),
                    title: text_of(&f["title"]),
                    media_count: num_of(&f["media_count"]),
                    attr: num_of(&f["attr"]) as i32,
                });
            }
        }
        Ok(out)
    }

    pub async fn create_favorite_folder(
        &self,
        title: &str,
        login: &Cookies,
    ) -> Result<i64, String> {
        let csrf = Self::require_login(login)?;
        let form = vec![
            ("title".to_string(), title.to_string()),
            ("privacy".to_string(), "0".to_string()),
            ("csrf".to_string(), csrf),
        ];
        let d = self
            .post_form_at(
                "/x/v3/fav/folder/add",
                form,
                login,
                "https://www.bilibili.com/",
            )
            .await?;
        Ok(num_of(&d["id"]))
    }

    pub async fn favorite_list(
        &self,
        media_id: i64,
        page: u32,
        login: &Cookies,
    ) -> Result<PageResult<FavoriteItem>, String> {
        Self::require_login(login)?;
        let d = self
            .api_get(
                "/x/v3/fav/resource/list",
                &[
                    ("media_id", media_id.to_string()),
                    ("pn", page.to_string()),
                    ("ps", "20".into()),
                    ("platform", "web".into()),
                    ("order", "mtime".into()),
                    ("type", "0".into()),
                    ("tid", "0".into()),
                ],
                login,
            )
            .await?;
        let mut items = Vec::new();
        if let Some(arr) = d["medias"].as_array() {
            for m in arr {
                let bvid = text_of(&m["bvid"]);
                if bvid.is_empty() {
                    continue;
                }
                items.push(FavoriteItem {
                    aid: num_of(&m["id"]),
                    bvid,
                    title: text_of(&m["title"]),
                    cover: fix_url(&text_of(&m["cover"])),
                    author: text_of(&m["upper"]["name"]),
                    mid: num_of(&m["upper"]["mid"]),
                    duration: fmt_dur(num_of(&m["duration"])),
                    play: num_of(&m["cnt_info"]["play"]),
                    fav_time: num_of(&m["fav_time"]),
                    pubtime: num_of(&m["pubtime"]),
                });
            }
        }
        Ok(PageResult {
            items,
            page,
            has_more: d["has_more"].as_bool().unwrap_or(false),
            total: num_of(&d["info"]["media_count"]),
        })
    }

    pub async fn favorite_ids(&self, aid: i64, login: &Cookies) -> Vec<i64> {
        if Self::require_login(login).is_err() {
            return Vec::new();
        }
        for (key, params) in [
            (
                "rid",
                vec![("rid", aid.to_string()), ("type", "2".into())],
            ),
            (
                "res_id",
                vec![("res_id", aid.to_string()), ("type", "2".into())],
            ),
        ] {
            let _ = key;
            if let Ok(d) = self
                .api_get("/x/v3/fav/resource/ids", &params, login)
                .await
            {
                if let Some(arr) = d.as_array() {
                    return arr.iter().map(num_of).collect();
                }
                if let Some(arr) = d["ids"].as_array() {
                    return arr.iter().map(num_of).collect();
                }
            }
        }
        Vec::new()
    }

    pub async fn interaction_state(
        &self,
        bvid: &str,
        aid: i64,
        login: &Cookies,
    ) -> InteractionState {
        if Self::require_login(login).is_err() {
            return InteractionState::default();
        }
        let like_params = [("bvid", bvid.to_string())];
        let coin_params = [("bvid", bvid.to_string())];
        let liked_fut = self.api_get(
            "/x/web-interface/archive/has/like",
            &like_params,
            login,
        );
        let coin_fut = self.api_get(
            "/x/web-interface/archive/coins",
            &coin_params,
            login,
        );
        let fav_fut = self.favorite_ids(aid, login);
        let (liked, coin, fav_folders) = tokio::join!(liked_fut, coin_fut, fav_fut);
        InteractionState {
            liked: liked.map(|v| num_of(&v) == 1).unwrap_or(false),
            coin: coin
                .map(|v| num_of(&v["multiply"]) as i32)
                .unwrap_or(0),
            fav_folders,
        }
    }

    pub async fn follow_user(
        &self,
        fid: i64,
        follow: bool,
        login: &Cookies,
    ) -> Result<(), String> {
        let csrf = Self::require_login(login)?;
        let form = vec![
            ("fid".to_string(), fid.to_string()),
            ("act".to_string(), if follow { "1" } else { "2" }.to_string()),
            ("re_src".to_string(), "11".to_string()),
            ("csrf".to_string(), csrf),
        ];
        self.post_form_at(
            "/x/relation/modify",
            form,
            login,
            &format!("https://space.bilibili.com/{fid}"),
        )
        .await?;
        Ok(())
    }

    pub async fn watch_later(&self, login: &Cookies) -> Result<Vec<WatchLaterItem>, String> {
        Self::require_login(login)?;
        let d = self.api_get("/x/v2/history/toview", &[], login).await?;
        let mut out = Vec::new();
        if let Some(arr) = d["list"].as_array() {
            for v in arr {
                out.push(WatchLaterItem {
                    aid: num_of(&v["aid"]),
                    bvid: text_of(&v["bvid"]),
                    title: text_of(&v["title"]),
                    cover: fix_url(&text_of(&v["pic"])),
                    author: text_of(&v["owner"]["name"]),
                    mid: num_of(&v["owner"]["mid"]),
                    duration: fmt_dur(num_of(&v["duration"])),
                    progress: num_of(&v["progress"]),
                    cid: num_of(&v["cid"]),
                    add_at: num_of(&v["add_at"]),
                });
            }
        }
        Ok(out)
    }

    pub async fn watch_later_add(
        &self,
        aid: i64,
        add: bool,
        login: &Cookies,
    ) -> Result<(), String> {
        let csrf = Self::require_login(login)?;
        let form = vec![
            ("aid".to_string(), aid.to_string()),
            ("csrf".to_string(), csrf),
        ];
        let path = if add {
            "/x/v2/history/toview/add"
        } else {
            "/x/v2/history/toview/del"
        };
        self.post_form_at(
            path,
            form,
            login,
            &format!("https://www.bilibili.com/video/av{aid}"),
        )
        .await?;
        Ok(())
    }

    pub async fn report_progress(
        &self,
        aid: i64,
        cid: i64,
        progress: i64,
        login: &Cookies,
    ) -> Result<(), String> {
        let csrf = Self::require_login(login)?;
        let form = vec![
            ("aid".to_string(), aid.to_string()),
            ("cid".to_string(), cid.to_string()),
            ("progress".to_string(), progress.max(0).to_string()),
            ("csrf".to_string(), csrf),
        ];
        self.post_form_at(
            "/x/v2/history/report",
            form,
            login,
            &format!("https://www.bilibili.com/video/av{aid}"),
        )
        .await?;
        Ok(())
    }

    pub async fn history(
        &self,
        max: i64,
        view_at: i64,
        kind: &str,
        login: &Cookies,
    ) -> Result<HistoryPage, String> {
        Self::require_login(login)?;
        let mut params: Vec<(&str, String)> = vec![
            ("max", max.to_string()),
            ("view_at", view_at.to_string()),
            ("ps", "30".to_string()),
        ];
        // 综合 / archive=视频 / live=直播 / article=专栏
        match kind {
            "archive" | "live" | "article" => params.push(("type", kind.to_string())),
            _ => {}
        }
        let d = self.api_get("/x/web-interface/history/cursor", &params, login).await?;
        let mut items = Vec::new();
        if let Some(arr) = d["list"].as_array() {
            for v in arr {
                let bvid = text_of(&v["history"]["bvid"]);
                let business = text_of(&v["history"]["business"]);
                let uri = text_of(&v["uri"]);
                // 直播/专栏没有 bvid：直播直接带 roomid，专栏前端拼 /read/cv<oid>
                if bvid.is_empty() && business != "live" && business != "article" {
                    continue;
                }
                if bvid.is_empty() && uri.is_empty() && business == "archive" {
                    continue;
                }
                let cover = {
                    let c = fix_url(&text_of(&v["cover"]));
                    if c.is_empty() {
                        v["covers"]
                            .as_array()
                            .and_then(|a| a.first())
                            .map(|x| fix_url(&text_of(x)))
                            .unwrap_or_default()
                    } else {
                        c
                    }
                };
                items.push(HistoryItem {
                    aid: num_of(&v["history"]["oid"]),
                    bvid,
                    business: if business.is_empty() { "archive".into() } else { business },
                    kid: num_of(&v["kid"]),
                    title: text_of(&v["title"]),
                    cover,
                    author: text_of(&v["author_name"]),
                    author_mid: num_of(&v["author_mid"]),
                    cid: num_of(&v["history"]["cid"]),
                    progress: num_of(&v["progress"]),
                    duration: num_of(&v["duration"]),
                    view_at: num_of(&v["view_at"]),
                    videos: num_of(&v["videos"]) as i32,
                    page: num_of(&v["history"]["page"]) as i32,
                    badge: text_of(&v["badge"]),
                    live_status: num_of(&v["live_status"]) as i32,
                });
            }
        }
        let cursor = &d["cursor"];
        let has_more = !cursor.is_null() && cursor["max"].as_i64().is_some();
        Ok(HistoryPage {
            items,
            max: num_of(&cursor["max"]),
            view_at: num_of(&cursor["view_at"]),
            has_more,
        })
    }

    /// 清空全部历史记录（需要登录，危险操作）。
    pub async fn history_clear(&self, login: &Cookies) -> Result<(), String> {
        let csrf = Self::require_login(login)?;
        self.post_form_at(
            "/x/v2/history/clear",
            vec![("csrf".to_string(), csrf)],
            login,
            "https://www.bilibili.com/account/history",
        )
        .await?;
        Ok(())
    }

    // ---------- 用户空间 ----------

    pub async fn space_info(&self, mid: i64, login: &Cookies) -> Result<SpaceInfo, String> {
        let mut name = String::new();
        let mut face = String::new();
        let mut sign = String::new();
        let mut level = 0;
        let mut fans = 0;
        if let Ok(d) = self
            .api_get_at(
                "/x/web-interface/card",
                &[("mid", mid.to_string()), ("photo", "true".into())],
                login,
                &format!("{SPACE}/{mid}"),
                SPACE,
            )
            .await
        {
            let card = &d["card"];
            name = text_of(&card["name"]);
            face = fix_url(&text_of(&card["face"]));
            sign = text_of(&card["sign"]);
            level = num_of(&card["level_info"]["current_level"]) as i32;
            fans = num_of(&card["fans"]);
        }
        if name.is_empty() {
            if let Ok(d) = self
                .api_get(
                    "/x/space/acc/info",
                    &[("mid", mid.to_string())],
                    login,
                )
                .await
            {
                name = text_of(&d["name"]);
                face = fix_url(&text_of(&d["face"]));
                sign = text_of(&d["sign"]);
                level = num_of(&d["level"]) as i32;
            }
        }
        let following = self
            .api_get(
                "/x/relation/stat",
                &[("vmid", mid.to_string())],
                login,
            )
            .await
            .map(|d| num_of(&d["following"]))
            .unwrap_or(0);
        if fans == 0 {
            fans = self
                .api_get(
                    "/x/relation/stat",
                    &[("vmid", mid.to_string())],
                    login,
                )
                .await
                .map(|d| num_of(&d["follower"]))
                .unwrap_or(0);
        }
        if name.is_empty() {
            return Err("用户不存在或空间接口触发风控".into());
        }
        Ok(SpaceInfo {
            mid,
            name,
            face,
            banner: String::new(),
            sign,
            level,
            fans,
            following,
            archive_count: 0,
            likes: 0,
        })
    }

    pub async fn space_videos(
        &self,
        mid: i64,
        page: u32,
        login: &Cookies,
    ) -> Result<PageResult<SpaceVideo>, String> {
        let mut params = BTreeMap::new();
        params.insert("vmid".into(), mid.to_string());
        params.insert("pn".into(), page.to_string());
        params.insert("ps".into(), "20".into());
        params.insert("order".into(), "pubdate".into());
        params.insert("qn".into(), "80".into());
        params.insert("include_cursor".into(), "true".into());
        params.insert("build".into(), "8430300".into());
        params.insert("version".into(), "8.43.0".into());
        params.insert("channel".into(), "master".into());
        params.insert("mobi_app".into(), "android".into());
        params.insert("platform".into(), "android".into());
        params.insert("c_locale".into(), "zh_CN".into());
        params.insert("s_locale".into(), "zh_CN".into());
        params.insert("statistics".into(), APP_STATISTICS.into());
        let d = self.app_get("/x/v2/space/archive/cursor", params, login).await?;
        let mut items = Vec::new();
        if let Some(arr) = d["item"].as_array() {
            for v in arr {
                let bvid = text_of(&v["bvid"]);
                if bvid.is_empty() {
                    continue;
                }
                let aid = {
                    let p = text_of(&v["param"]);
                    p.parse::<i64>().unwrap_or_else(|_| num_of(&v["aid"]))
                };
                items.push(SpaceVideo {
                    bvid,
                    aid,
                    title: text_of(&v["title"]),
                    cover: fix_url(&text_of(&v["cover"])),
                    play: num_of(&v["play"]),
                    danmaku: num_of(&v["danmaku"]),
                    duration: fmt_dur(num_of(&v["duration"])),
                    created: num_of(&v["ctime"]),
                    description: text_of(&v["desc"]),
                });
            }
        }
        Ok(PageResult {
            items,
            page,
            has_more: d["has_next"].as_bool().unwrap_or(false),
            total: num_of(&d["count"]),
        })
    }

    // ---------- 番剧 ----------

    pub async fn bangumi_list(
        &self,
        page: u32,
        season_type: i32,
        login: &Cookies,
    ) -> Result<PageResult<BangumiCard>, String> {
        let d = self
            .api_get(
                "/pgc/season/index/result",
                &[
                    ("st", "1".into()),
                    ("order", "3".into()),
                    ("season_version", "-1".into()),
                    ("spoken_language_type", "-1".into()),
                    ("area", "-1".into()),
                    ("is_finish", "-1".into()),
                    ("copyright", "-1".into()),
                    ("season_status", "-1".into()),
                    ("season_month", "-1".into()),
                    ("year", "-1".into()),
                    ("style_id", "-1".into()),
                    ("sort", "0".into()),
                    ("page", page.to_string()),
                    ("season_type", season_type.to_string()),
                    ("pagesize", "20".into()),
                    ("type", "1".into()),
                ],
                login,
            )
            .await?;
        let mut items = Vec::new();
        if let Some(arr) = d["list"].as_array() {
            for b in arr {
                let mut card = parse_bangumi_card(b).unwrap_or_default();
                if card.season_id == 0 {
                    card.season_id = num_of(&b["season_id"]);
                }
                if card.season_id == 0 {
                    continue;
                }
                items.push(card);
            }
        }
        Ok(PageResult {
            items,
            page,
            has_more: d["has_next"].as_bool().unwrap_or(false),
            total: num_of(&d["total"]),
        })
    }

    pub async fn bangumi_detail(
        &self,
        season_id: i64,
        login: &Cookies,
    ) -> Result<BangumiDetail, String> {
        let v = self
            .api_get_raw_at(
                "/pgc/view/web/season",
                &[("season_id", season_id.to_string())],
                login,
                &format!("https://www.bilibili.com/bangumi/play/ss{season_id}"),
                "https://www.bilibili.com",
            )
            .await?;
        let code = v["code"].as_i64().unwrap_or(0);
        if code != 0 {
            return Err(text_of(&v["message"]));
        }
        let r = if v.get("result").is_some() {
            v["result"].clone()
        } else {
            v["data"].clone()
        };
        if r.is_null() {
            return Err("未获取到番剧信息".into());
        }
        let mut episodes = Vec::new();
        if let Some(arr) = r["episodes"].as_array() {
            for e in arr {
                episodes.push(Episode {
                    id: num_of(&e["id"]),
                    ep_id: num_of(&e["ep_id"]),
                    aid: num_of(&e["aid"]),
                    bvid: text_of(&e["bvid"]),
                    cid: num_of(&e["cid"]),
                    title: text_of(&e["title"]),
                    long_title: text_of(&e["long_title"]),
                    cover: fix_url(&text_of(&e["cover"])),
                    duration: num_of(&e["duration"]),
                    badge: text_of(&e["badge"]),
                });
            }
        }
        let mut seasons = Vec::new();
        if let Some(arr) = r["seasons"].as_array() {
            for s in arr {
                let card = BangumiCard {
                    season_id: num_of(&s["season_id"]),
                    title: text_of(&s["season_title"]),
                    cover: fix_url(&text_of(&s["cover"])),
                    badge: text_of(&s["badge"]),
                    ..Default::default()
                };
                if card.season_id > 0 {
                    seasons.push(card);
                }
            }
        }
        let areas = r["areas"]
            .as_array()
            .map(|a| a.iter().map(|x| text_of(&x["name"])).collect())
            .unwrap_or_default();
        let styles = r["styles"]
            .as_array()
            .map(|a| a.iter().map(|x| text_of(&x["name"])).collect())
            .unwrap_or_default();
        Ok(BangumiDetail {
            season_id: num_of(&r["season_id"]).max(season_id),
            season_title: text_of(&r["season_title"]),
            title: text_of(&r["title"]),
            cover: fix_url(&text_of(&r["cover"])),
            evaluate: text_of(&r["evaluate"]),
            summary: text_of(&r["summary"]),
            badge: text_of(&r["badge"]),
            index_show: text_of(&r["index_show"]),
            score: text_or_num(&r["rating"]["score"]),
            total_ep: num_of(&r["total"]) as i32,
            pub_time: text_of(&r["publish"]["pub_time"]),
            areas,
            styles,
            up_name: text_of(&r["up_info"]["uname"]),
            stat_views: num_of(&r["stat"]["views"]),
            stat_follows: num_of(&r["stat"]["favorites"]),
            episodes,
            seasons,
        })
    }

    // ---------- 直播 ----------

    /// 直播首页：推荐房间 + 各内容分区模块
    pub async fn live_feed(&self, login: &Cookies) -> Result<LiveFeed, String> {
        let main_url = format!("{LIVE_API}/xlive/web-interface/v1/index/getList?platform=web");
        let more_url =
            format!("{LIVE_API}/xlive/web-interface/v1/webMain/getMoreRecList?platform=web");
        let (main, more) = tokio::join!(
            self.get_json_url_at(
                &main_url,
                login,
                "https://live.bilibili.com/",
                "https://live.bilibili.com",
            ),
            self.get_json_url_at(
                &more_url,
                login,
                "https://live.bilibili.com/",
                "https://live.bilibili.com",
            )
        );
        let d = check(&main?)?;

        let mut recommend = parse_live_rooms(&d["recommend_room_list"]);
        if let Ok(v) = more {
            if let Ok(m) = check(&v) {
                merge_live_rooms(&mut recommend, parse_live_rooms(&m["recommend_room_list"]));
            }
        }

        let mut modules = Vec::new();
        if let Some(arr) = d["room_list"].as_array() {
            for m in arr {
                let id = num_of(&m["module_info"]["id"]);
                // 模块 3 是“推荐直播”，与顶部推荐重复
                if id == 3 {
                    continue;
                }
                let rooms = parse_live_rooms(&m["list"]);
                if rooms.is_empty() {
                    continue;
                }
                modules.push(LiveModule {
                    id,
                    title: text_of(&m["module_info"]["title"]),
                    link: text_of(&m["module_info"]["link"]),
                    cover: fix_url(&text_of(&m["module_info"]["pic"])),
                    rooms,
                });
            }
        }

        Ok(LiveFeed { recommend, modules })
    }

    /// 直播分区目录
    pub async fn live_areas(&self, login: &Cookies) -> Result<Vec<LiveAreaGroup>, String> {
        let url = format!("{LIVE_API}/xlive/web-interface/v1/index/getWebAreaList?source_id=2");
        let value = self
            .get_json_url_at(
                &url,
                login,
                "https://live.bilibili.com/",
                "https://live.bilibili.com",
            )
            .await;

        // 新接口偶发不可用时回退到旧版分区目录
        let groups_value = match value {
            Ok(v) => {
                let d = check(&v)?;
                if d["data"].is_array() {
                    d["data"].clone()
                } else {
                    d
                }
            }
            Err(_) => {
                let fallback = format!("{LIVE_API}/room/v1/Area/getList?parent_id=0");
                let v = self
                    .get_json_url_at(
                        &fallback,
                        login,
                        "https://live.bilibili.com/",
                        "https://live.bilibili.com",
                    )
                    .await?;
                check(&v)?
            }
        };

        let mut groups = Vec::new();
        if let Some(arr) = groups_value.as_array() {
            for g in arr {
                let mut areas = Vec::new();
                if let Some(list) = g["list"].as_array() {
                    for a in list {
                        let id = num_of(&a["id"]);
                        if id <= 0 {
                            continue;
                        }
                        areas.push(LiveArea {
                            id,
                            name: text_of(&a["name"]),
                            parent_id: num_of(&a["parent_id"]),
                            pic: fix_url(&text_of(&a["pic"])),
                            hot: num_of(&a["hot_status"]) == 1,
                        });
                    }
                }
                if !areas.is_empty() {
                    groups.push(LiveAreaGroup {
                        id: num_of(&g["id"]),
                        name: text_of(&g["name"]),
                        areas,
                    });
                }
            }
        }
        Ok(groups)
    }

    /// 分区房间列表。
    ///
    /// 官方的 `second/getList` 目前对匿名请求（包含真实浏览器）返回 -352，
    /// 这里使用直播搜索按分区名取房间，作为稳定的替代数据源。
    pub async fn live_rooms(
        &self,
        _area_id: i64,
        area_name: &str,
        page: u32,
        login: &Cookies,
    ) -> Result<PageResult<LiveRoom>, String> {
        self.ensure_search_cookies(login).await;
        let keyword = {
            let k = area_name.trim();
            if k.is_empty() {
                "直播".to_string()
            } else {
                k.to_string()
            }
        };

        let mut params = BTreeMap::new();
        params.insert("search_type".into(), "live_room".into());
        params.insert("keyword".into(), keyword.clone());
        params.insert("page".into(), page.to_string());
        params.insert("page_size".into(), "30".into());
        params.insert("platform".into(), "pc".into());
        params.insert("order".into(), "online".into());
        params.insert("web_location".into(), "1430654".into());
        let referer = format!("{SEARCH}/live?keyword={}", urlencode(&keyword));
        let d = self
            .wbi_get_at(
                "/x/web-interface/wbi/search/type",
                params,
                login,
                &referer,
                SEARCH,
            )
            .await?;

        if d.get("v_voucher").is_some() {
            return Err("直播分区搜索触发 B 站风控，请登录账号后再试，或稍后重试".into());
        }

        let mut rooms: Vec<LiveRoom> = d["result"]
            .as_array()
            .map(|a| a.iter().filter_map(parse_live_search_room).collect())
            .unwrap_or_default();

        // 搜索会混入相近分区，优先保留精确匹配的同分区房间
        let area_clean = plain_text(area_name);
        if !area_clean.is_empty() {
            let matched: Vec<LiveRoom> = rooms
                .iter()
                .filter(|r| r.area_name == area_clean)
                .cloned()
                .collect();
            if matched.len() >= 4 {
                rooms = matched;
            }
        }

        let total = num_of(&d["numResults"]);
        let pages = num_of(&d["numPages"]);
        Ok(PageResult {
            items: rooms,
            page,
            has_more: pages > 0 && (page as i64) < pages,
            total,
        })
    }

    /// 直播间详情
    pub async fn live_room_detail(
        &self,
        room_id: i64,
        login: &Cookies,
    ) -> Result<LiveRoomDetail, String> {
        let info_url = format!("{LIVE_API}/room/v1/Room/get_info?room_id={room_id}");
        let anchor_url =
            format!("{LIVE_API}/live_user/v1/UserInfo/get_anchor_in_room?roomid={room_id}");
        let (info, anchor) = tokio::join!(
            self.get_json_url_at(
                &info_url,
                login,
                "https://live.bilibili.com/",
                "https://live.bilibili.com",
            ),
            self.get_json_url_at(
                &anchor_url,
                login,
                "https://live.bilibili.com/",
                "https://live.bilibili.com",
            )
        );
        let d = check(&info?)?;
        let anchor_data = anchor
            .ok()
            .and_then(|v| check(&v).ok())
            .unwrap_or(Value::Null);
        let anchor_info = &anchor_data["info"];

        let mut uname = text_of(&anchor_info["uname"]);
        if uname.is_empty() {
            uname = text_of(&d["uname"]);
        }
        let mut face = fix_url(&text_of(&anchor_info["face"]));
        if face.is_empty() {
            face = fix_url(&text_of(&d["face"]));
        }
        let tags = text_of(&d["tags"])
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Ok(LiveRoomDetail {
            room_id: num_of(&d["room_id"]).max(room_id),
            uid: num_of(&d["uid"]),
            title: text_of(&d["title"]),
            cover: fix_url(&text_of(&d["user_cover"])),
            keyframe: fix_url(&text_of(&d["keyframe"])),
            description: plain_text(&text_of(&d["description"])),
            uname,
            face,
            online: num_of(&d["online"]),
            attention: num_of(&d["attention"]),
            live_status: num_of(&d["live_status"]) as i32,
            area_id: num_of(&d["area_id"]),
            area_name: text_of(&d["area_name"]),
            parent_area_id: num_of(&d["parent_area_id"]),
            parent_area_name: text_of(&d["parent_area_name"]),
            live_time: text_of(&d["live_time"]),
            tags,
        })
    }

    /// 直播播放地址（优先 FLV + AVC，适配 mpegts.js）
    pub async fn live_play_info(
        &self,
        room_id: i64,
        qn: i32,
        login: &Cookies,
    ) -> Result<LivePlayInfo, String> {
        let url = format!(
            "{LIVE_API}/xlive/web-room/v2/index/getRoomPlayInfo?room_id={room_id}&no_playurl=0&mask=1&qn={}&platform=web&protocol=0,1&format=0,1,2&codec=0,1&special_scenario=2",
            qn.max(0)
        );
        let v = self
            .get_json_url_at(
                &url,
                login,
                "https://live.bilibili.com/",
                "https://live.bilibili.com",
            )
            .await?;
        let d = check(&v)?;

        let mut out = LivePlayInfo {
            room_id: num_of(&d["room_id"]).max(room_id),
            live_status: num_of(&d["live_status"]) as i32,
            format: "flv".into(),
            ..Default::default()
        };

        let Some(playurl) = d
            .get("playurl_info")
            .and_then(|x| x.get("playurl"))
            .filter(|x| !x.is_null())
        else {
            return Ok(out);
        };

        if let Some(arr) = playurl["g_qn_desc"].as_array() {
            for q in arr {
                let qn = num_of(&q["qn"]) as i32;
                let desc = text_of(&q["desc"]);
                if qn > 0 && !desc.is_empty() {
                    out.qualities.push(LiveQuality { qn, desc });
                }
            }
        }

        let mut picked: Option<&Value> = None;
        let mut fallback: Option<&Value> = None;
        if let Some(streams) = playurl["stream"].as_array() {
            for stream in streams {
                if stream["protocol_name"].as_str() != Some("http_stream") {
                    continue;
                }
                let Some(formats) = stream["format"].as_array() else {
                    continue;
                };
                for format in formats {
                    if format["format_name"].as_str() != Some("flv") {
                        continue;
                    }
                    let Some(codecs) = format["codec"].as_array() else {
                        continue;
                    };
                    for codec in codecs {
                        if codec["codec_name"].as_str() == Some("avc") {
                            picked = Some(codec);
                            break;
                        }
                        if fallback.is_none() {
                            fallback = Some(codec);
                        }
                    }
                    if picked.is_some() {
                        break;
                    }
                }
                if picked.is_some() {
                    break;
                }
            }
        }

        let Some(codec) = picked.or(fallback) else {
            return Ok(out);
        };
        let base = text_of(&codec["base_url"]);
        if let Some(urls) = codec["url_info"].as_array() {
            for (index, item) in urls.iter().enumerate() {
                let host = text_of(&item["host"]);
                let extra = text_of(&item["extra"]);
                let full = if base.starts_with("http") {
                    format!("{base}{extra}")
                } else {
                    format!("{host}{base}{extra}")
                };
                if full.is_empty() {
                    continue;
                }
                if index == 0 {
                    out.url = full;
                } else {
                    out.backup_urls.push(full);
                }
            }
        }
        out.quality = num_of(&codec["current_qn"]) as i32;
        out.accept_qn = codec["accept_qn"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|x| num_of(x) as i32)
                    .filter(|q| *q > 0)
                    .collect()
            })
            .unwrap_or_default();
        out.quality_desc = out
            .qualities
            .iter()
            .find(|q| q.qn == out.quality)
            .map(|q| q.desc.clone())
            .unwrap_or_else(|| {
                if out.quality > 0 {
                    format!("清晰度 {}", out.quality)
                } else {
                    String::new()
                }
            });

        if out.url.is_empty() {
            return Err("未获取到直播播放地址（可能未开播或受地区限制）".into());
        }
        Ok(out)
    }

    // ---------------- 动态 ----------------

    /// 关注动态流（需要登录）。`kind` 为 all / video / article 等，
    /// 首次不传 offset，之后把上一页返回的 offset 带回来即可翻页。
    pub async fn dynamic_feed(
        &self,
        kind: &str,
        offset: &str,
        login: &Cookies,
    ) -> Result<DynamicPage, String> {
        self.ensure_buvid(login).await;
        let mut params = vec![
            ("timezone_offset", "-480".to_string()),
            ("type", if kind.is_empty() { "all" } else { kind }.to_string()),
            ("page", "1".to_string()),
            ("features", "itemOpusStyle".to_string()),
        ];
        if !offset.is_empty() {
            params.push(("offset", offset.to_string()));
        }
        let d = self
            .api_get_at(
                "/x/polymer/web-dynamic/v1/feed/all",
                &params,
                login,
                "https://t.bilibili.com/",
                "https://t.bilibili.com",
            )
            .await?;
        let mut items = Vec::new();
        if let Some(arr) = d["items"].as_array() {
            for item in arr {
                if let Some(parsed) = parse_dynamic(item) {
                    items.push(parsed);
                }
            }
        }
        Ok(DynamicPage {
            items,
            offset: text_of(&d["offset"]),
            has_more: d["has_more"].as_bool().unwrap_or(false),
            update_num: num_of(&d["update_num"]),
        })
    }

    // ---------------- 消息中心 ----------------

    /// 消息列表。`kind` 为 reply（回复我的）/ at（@我的）/ like（收到的赞）。
    pub async fn msg_feed(
        &self,
        kind: &str,
        cursor_id: i64,
        cursor_time: i64,
        login: &Cookies,
    ) -> Result<MessagePage, String> {
        let (path, time_key) = match kind {
            "at" => ("/x/msgfeed/at", "at_time"),
            "like" => ("/x/msgfeed/like", "like_time"),
            _ => ("/x/msgfeed/reply", "reply_time"),
        };
        let mut params = vec![
            ("platform", "web".to_string()),
            ("build", "0".to_string()),
            ("mobi_app", "web".to_string()),
        ];
        if cursor_id > 0 && cursor_time > 0 {
            params.push(("id", cursor_id.to_string()));
            params.push((time_key, cursor_time.to_string()));
        }
        let d = self
            .api_get_at(
                path,
                &params,
                login,
                "https://message.bilibili.com/",
                "https://message.bilibili.com",
            )
            .await?;
        // like 接口把列表放在 data.total 里，其余直接是 data
        let bucket = if kind == "like" { d["total"].clone() } else { d.clone() };
        let mut items = Vec::new();
        if let Some(arr) = bucket["items"].as_array() {
            for item in arr {
                if let Some(parsed) = parse_message(item, kind) {
                    items.push(parsed);
                }
            }
        }
        let cursor = &bucket["cursor"];
        Ok(MessagePage {
            items,
            cursor_id: num_of(&cursor["id"]),
            cursor_time: num_of(&cursor["time"]),
            has_more: !cursor["is_end"].as_bool().unwrap_or(true),
        })
    }

    /// 未读消息数（需要登录）。
    pub async fn msg_unread(&self, login: &Cookies) -> Result<UnreadCount, String> {
        let d = self
            .api_get_at(
                "/x/msgfeed/unread",
                &[],
                login,
                "https://message.bilibili.com/",
                "https://message.bilibili.com",
            )
            .await?;
        let reply = num_of(&d["reply"]);
        let at = num_of(&d["at"]);
        let like = num_of(&d["like"]);
        let sys_msg = num_of(&d["sys_msg"]);
        let chat = num_of(&d["chat"]);
        Ok(UnreadCount {
            reply,
            at,
            like,
            sys_msg,
            chat,
            danmu: num_of(&d["danmu"]),
            favorite: num_of(&d["favorite"]),
            coin: num_of(&d["coin"]),
            up: num_of(&d["up"]),
            total: reply + at + like + sys_msg + chat,
        })
    }

    // ---------------- 动态页左右栏 ----------------

    /// 有更新的 UP 主（动态页左栏，需要登录）。
    pub async fn dynamic_uplist(&self, login: &Cookies) -> Result<Vec<DynUp>, String> {
        self.ensure_buvid(login).await;
        let url = "https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/w_dyn_uplist?last_dyn_id=&last_update_time=&size=20";
        let d = self
            .get_json_url_at(
                url,
                login,
                "https://t.bilibili.com/",
                "https://t.bilibili.com",
            )
            .await?;
        let mut out = Vec::new();
        if let Some(arr) = d["items"].as_array() {
            for item in arr {
                let info = &item["user_profile"]["info"];
                let mid = num_of(&info["uid"]);
                if mid <= 0 {
                    continue;
                }
                out.push(DynUp {
                    mid,
                    name: text_of(&info["uname"]),
                    face: fix_url(&text_of(&info["face"])),
                });
            }
        }
        Ok(out)
    }

    /// 关注的 UP 主正在直播（动态页右栏，需要登录）。
    pub async fn live_following(&self, login: &Cookies) -> Result<Vec<FollowingLive>, String> {
        self.ensure_buvid(login).await;
        let url = format!(
            "{LIVE_API}/xlive/web-ucenter/v1/xfetter/FeedList?page=1&page_size=20&platform=web"
        );
        let d = self
            .get_json_url_at(
                &url,
                login,
                "https://live.bilibili.com/",
                "https://live.bilibili.com",
            )
            .await?;
        let mut out = Vec::new();
        if let Some(arr) = d["list"].as_array() {
            for item in arr {
                let room_id = num_of(&item["roomid"]);
                if room_id <= 0 {
                    continue;
                }
                let area = text_of(&item["area_name"]);
                let parent = text_of(&item["parent_area_name"]);
                out.push(FollowingLive {
                    room_id,
                    uid: num_of(&item["uid"]),
                    name: text_of(&item["uname"]),
                    face: fix_url(&text_of(&item["face"])),
                    cover: fix_url(&text_of(&item["pic"])),
                    title: plain_text(&text_of(&item["title"])),
                    area: if area.is_empty() { parent } else { area },
                    online: num_of(&item["online"]),
                });
            }
        }
        Ok(out)
    }

    /// 直播弹幕服务器凭据。
    pub async fn live_danmu_conf(&self, room_id: i64, login: &Cookies) -> Result<DanmuConf, String> {
        self.ensure_buvid(login).await;
        let url = format!(
            "{LIVE_API}/room/v1/Danmu/getConf?room_id={room_id}&platform=pc&player=web"
        );
        let d = self
            .get_json_url_at(
                &url,
                login,
                &format!("https://live.bilibili.com/{room_id}"),
                "https://live.bilibili.com",
            )
            .await?;
        let mut servers = Vec::new();
        if let Some(arr) = d["host_server_list"].as_array() {
            for s in arr {
                let host = text_of(&s["host"]);
                if host.is_empty() {
                    continue;
                }
                let mut wss_port = num_of(&s["wss_port"]);
                if wss_port <= 0 {
                    wss_port = 443;
                }
                servers.push(DanmuServer { host, wss_port });
            }
        }
        let mut host = text_of(&d["host"]);
        if host.is_empty() {
            host = servers
                .first()
                .map(|s| s.host.clone())
                .unwrap_or_else(|| "broadcastlv.chat.bilibili.com".to_string());
        }
        let mut wss_port = num_of(&d["wss_port"]);
        if wss_port <= 0 {
            wss_port = 443;
        }
        Ok(DanmuConf {
            token: text_of(&d["token"]),
            host,
            wss_port,
            servers,
        })
    }

    /// 历史弹幕（作为连上 WS 之前的垫场内容）。
    pub async fn live_danmu_history(
        &self,
        room_id: i64,
        login: &Cookies,
    ) -> Result<DanmuHistory, String> {
        self.ensure_buvid(login).await;
        let url = format!(
            "{LIVE_API}/xlive/web-room/v1/dM/gethistory?roomid={room_id}&room_type=0"
        );
        let d = self
            .get_json_url_at(
                &url,
                login,
                &format!("https://live.bilibili.com/{room_id}"),
                "https://live.bilibili.com",
            )
            .await?;
        let mut items = Vec::new();
        if let Some(arr) = d["room"].as_array() {
            for m in arr {
                let text = plain_text(&text_of(&m["text"]));
                if text.is_empty() {
                    continue;
                }
                let color = m["color"].as_u64().unwrap_or(0xffffff) as u32;
                items.push(DanmuHistoryItem {
                    text,
                    uname: text_of(&m["nickname"]),
                    uid: num_of(&m["uid"]),
                    timeline: text_of(&m["timeline"]),
                    color,
                    mode: num_of(&m["mode"]) as i32,
                });
            }
        }
        Ok(DanmuHistory { items })
    }
}

// ---------- 动态解析 ----------

fn parse_dynamic(v: &Value) -> Option<DynamicItem> {
    let id = text_of(&v["id_str"]);
    if id.is_empty() {
        return None;
    }
    let modules = &v["modules"];
    let author = &modules["module_author"];
    let dynamic = &modules["module_dynamic"];
    let major = &dynamic["major"];
    let major_type = text_of(&major["type"]);

    let mut out = DynamicItem {
        id,
        kind: "text".into(),
        author_mid: num_of(&author["mid"]),
        author_name: text_of(&author["name"]),
        author_face: fix_url(&text_of(&author["face"])),
        pub_time: text_of(&author["pub_time"]),
        pub_ts: num_of(&author["pub_ts"]),
        text: plain_text(&text_of(&dynamic["desc"]["text"])),
        ..Default::default()
    };
    let stat = &modules["module_stat"];
    out.forward = num_of(&stat["forward"]["count"]);
    out.comment = num_of(&stat["comment"]["count"]);
    out.like = num_of(&stat["like"]["count"]);

    // major 内容：视频 / 图文(opus) / 直播推荐 / 番剧
    if let Some(archive) = major["archive"].as_object() {
        out.kind = "av".into();
        out.jump_url = fix_url(&text_of(&archive["jump_url"]));
        out.archive = Some(DynamicArchive {
            bvid: text_of(&archive["bvid"]),
            title: plain_text(&text_of(&archive["title"])),
            cover: fix_url(&text_of(&archive["cover"])),
            duration: text_of(&archive["duration_text"]),
            play: num_of(&archive["stat"]["play"]),
            danmaku: num_of(&archive["stat"]["danmaku"]),
        });
    } else if let Some(opus) = major["opus"].as_object() {
        out.kind = "opus".into();
        out.jump_url = fix_url(&text_of(&opus["jump_url"]));
        if out.text.is_empty() {
            out.text = plain_text(&text_of(&opus["summary"]["text"]));
        }
        if let Some(pics) = opus["pics"].as_array() {
            for pic in pics {
                let url = fix_url(&text_of(&pic["url"]));
                if !url.is_empty() {
                    out.pics.push(url);
                }
            }
        }
    } else if major_type == "MAJOR_TYPE_LIVE_RCMD" {
        out.kind = "live".into();
        out.live = parse_dynamic_live(&major["live_rcmd"]["content"]);
    } else if let Some(pgc) = major["pgc"].as_object() {
        out.kind = "pgc".into();
        out.jump_url = fix_url(&text_of(&pgc["jump_url"]));
        out.archive = Some(DynamicArchive {
            bvid: String::new(),
            title: plain_text(&text_of(&pgc["title"])),
            cover: fix_url(&text_of(&pgc["cover"])),
            duration: text_of(&pgc["duration_text"]),
            play: 0,
            danmaku: 0,
        });
    } else if let Some(draw) = major["draw"].as_object() {
        out.kind = "draw".into();
        if let Some(pics) = draw["items"].as_array() {
            for pic in pics {
                let url = fix_url(&text_of(&pic["src"]));
                if !url.is_empty() {
                    out.pics.push(url);
                }
            }
        }
    }

    // 转发：被转内容挂在 orig 上，转发理由在 desc 里
    if let Some(orig) = v["orig"].as_object() {
        out.kind = if out.kind == "text" { "forward".into() } else { out.kind };
        out.orig = parse_dynamic(&Value::Object(orig.clone())).map(Box::new);
    }

    if out.kind == "text" && out.text.is_empty() && out.pics.is_empty() {
        return None;
    }
    Some(out)
}

fn parse_dynamic_live(content: &Value) -> Option<DynamicLive> {
    let raw = content.as_str()?;
    let parsed: Value = serde_json::from_str(raw).ok()?;
    let info = &parsed["live_play_info"];
    let room_id = num_of(&info["room_id"]);
    if room_id <= 0 {
        return None;
    }
    Some(DynamicLive {
        room_id,
        title: plain_text(&text_of(&info["title"])),
        cover: fix_url(&text_of(&info["cover"])),
        area_name: text_of(&info["area_name"]),
        online: num_of(&info["online"]),
        uname: text_of(&info["uname"]),
    })
}

// ---------- 消息解析 ----------

fn parse_message(v: &Value, kind: &str) -> Option<MessageItem> {
    let id = num_of(&v["id"]);
    if id <= 0 {
        return None;
    }
    let mut users = Vec::new();
    if let Some(arr) = v["users"].as_array() {
        for u in arr {
            users.push(MessageUser {
                mid: num_of(&u["mid"]),
                name: text_of(&u["nickname"]),
                face: fix_url(&text_of(&u["avatar"])),
            });
        }
    }
    if let Some(u) = v["user"].as_object() {
        users.push(MessageUser {
            mid: num_of(&u["mid"]),
            name: text_of(&u["nickname"]),
            face: fix_url(&text_of(&u["avatar"])),
        });
    }

    let item = &v["item"];
    let (time, count) = match kind {
        "at" => (num_of(&v["at_time"]), 1),
        "like" => (num_of(&v["like_time"]), num_of(&v["counts"])),
        _ => (num_of(&v["reply_time"]), num_of(&v["counts"])),
    };

    let content = {
        let source = plain_text(&text_of(&item["source_content"]));
        if !source.is_empty() {
            source
        } else {
            plain_text(&text_of(&item["root_reply_content"]))
        }
    };

    Some(MessageItem {
        id,
        kind: kind.to_string(),
        users,
        title: plain_text(&text_of(&item["title"])),
        business: text_of(&item["business"]),
        content: truncate(&content, 220),
        uri: text_of(&item["uri"]),
        image: fix_url(&text_of(&item["image"])),
        time,
        count,
    })
}

// ---------- 构造播放信息 ----------

fn build_play_info(
    d: &Value,
    is_pgc: bool,
    audio_qn: i32,
    codec: &str,
) -> Result<PlayInfo, String> {
    let mut support: HashMap<i32, String> = HashMap::new();
    if let Some(arr) = d["support_formats"].as_array() {
        for f in arr {
            let q = num_of(&f["quality"]) as i32;
            if q > 0 {
                let label = text_of(&f["new_description"]);
                support.insert(
                    q,
                    if label.is_empty() {
                        quality_label(q)
                    } else {
                        label
                    },
                );
            }
        }
    }
    let default_quality = num_of(&d["quality"]) as i32;
    let last_play_time = num_of(&d["last_play_time"]);
    let duration = num_of(&d["timelength"]) / 1000;

    let audios = d["dash"]["audio"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let audio = pick_audio(&audios, audio_qn);
    let audio_url = audio.map(|a| text_of(&a["baseUrl"])).unwrap_or_default();
    let audio_backups = audio.map(backup_urls).unwrap_or_default();

    let videos = d["dash"]["video"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut best: BTreeMap<i32, Value> = BTreeMap::new();
    for v in &videos {
        let q = num_of(&v["id"]) as i32;
        if q <= 0 {
            continue;
        }
        let bandwidth = num_of(&v["bandwidth"]);
        let score = codec_preference_score(num_of(&v["codecid"]) as i32, codec) * 1_000_000_000
            + bandwidth;
        match best.get(&q) {
            Some(old)
                if codec_preference_score(num_of(&old["codecid"]) as i32, codec) * 1_000_000_000
                    + num_of(&old["bandwidth"])
                    >= score => {}
            _ => {
                best.insert(q, v.clone());
            }
        }
    }

    let mut streams = Vec::new();
    for (q, v) in &best {
        let base = text_of(&v["baseUrl"]);
        if base.is_empty() {
            continue;
        }
        let codecid = num_of(&v["codecid"]) as i32;
        streams.push(PlayStream {
            quality: *q,
            label: support
                .get(q)
                .cloned()
                .unwrap_or_else(|| quality_label(*q)),
            video_url: base,
            video_backups: backup_urls(v),
            audio_url: audio_url.clone(),
            audio_backups: audio_backups.clone(),
            is_dash: true,
            height: num_of(&v["height"]) as i32,
            frame_rate: text_of(&v["frameRate"]),
            codec: codec_name(codecid),
        });
    }

    // 少数老视频 / 番剧没有 DASH，退化为 durl（整段 mp4 或 flv）
    if streams.is_empty() {
        if let Some(arr) = d["durl"].as_array() {
            let mut i = 0;
            for seg in arr {
                let url = text_of(&seg["url"]);
                if url.is_empty() {
                    continue;
                }
                i += 1;
                streams.push(PlayStream {
                    quality: default_quality,
                    label: if d["quality"].is_null() {
                        "默认清晰度".into()
                    } else {
                        quality_label(default_quality)
                    },
                    video_url: url,
                    video_backups: backup_urls(seg),
                    audio_url: String::new(),
                    audio_backups: Vec::new(),
                    is_dash: false,
                    height: 0,
                    frame_rate: String::new(),
                    codec: String::new(),
                });
            }
            if i > 1 {
                // 多段 durl 无法在纯 <video> 中连续播放，只保留第一段
                streams.truncate(1);
            }
        }
    }

    if streams.is_empty() {
        return Err("未获取到可播放的视频流（可能需要登录、付费或受地区限制）".into());
    }
    streams.sort_by(|a, b| b.quality.cmp(&a.quality));
    let default_quality = if streams.iter().any(|s| s.quality == default_quality) {
        default_quality
    } else {
        streams[0].quality
    };
    Ok(PlayInfo {
        streams,
        default_quality,
        last_play_time,
        duration,
        is_pgc,
    })
}

fn backup_urls(v: &Value) -> Vec<String> {
    let arr = v["backupUrl"]
        .as_array()
        .or_else(|| v["backup_url"].as_array());
    arr.map(|a| {
        a.iter()
            .filter_map(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect()
    })
    .unwrap_or_default()
}

fn codec_score(codecid: i32) -> i64 {
    match codecid {
        7 => 5,   // AVC，WebView2 兼容性最好
        12 => 4,  // HEVC
        13 => 3,  // AV1
        _ => 1,
    }
}

fn codec_preference_score(codecid: i32, preferred: &str) -> i64 {
    let name = codec_name(codecid);
    match preferred {
        "avc" => match name.as_str() {
            "AVC" => 5,
            "HEVC" => 4,
            "AV1" => 3,
            _ => 1,
        },
        "hevc" => match name.as_str() {
            "HEVC" => 5,
            "AVC" => 4,
            "AV1" => 3,
            _ => 1,
        },
        "av1" => match name.as_str() {
            "AV1" => 5,
            "HEVC" => 4,
            "AVC" => 3,
            _ => 1,
        },
        _ => codec_score(codecid),
    }
}

fn is_standard_audio(id: i32) -> bool {
    matches!(id, 30216 | 30232 | 30280)
}

/// 按音质偏好选择音轨；偏好不可用时回退到最高码率的标准音轨。
fn pick_audio<'a>(audios: &'a [Value], preferred: i32) -> Option<&'a Value> {
    let by_bandwidth = |a: &&Value| num_of(&a["bandwidth"]);
    if preferred > 0 {
        if let Some(found) = audios
            .iter()
            .find(|a| num_of(&a["id"]) as i32 == preferred)
        {
            return Some(found);
        }
        if let Some(found) = audios
            .iter()
            .filter(|a| is_standard_audio(num_of(&a["id"]) as i32))
            .filter(|a| (num_of(&a["id"]) as i32) <= preferred)
            .max_by_key(|a| num_of(&a["id"]))
        {
            return Some(found);
        }
    }
    audios
        .iter()
        .filter(|a| is_standard_audio(num_of(&a["id"]) as i32))
        .max_by_key(by_bandwidth)
        .or_else(|| audios.iter().max_by_key(by_bandwidth))
}

fn codec_name(codecid: i32) -> String {
    match codecid {
        7 => "AVC",
        12 => "HEVC",
        13 => "AV1",
        _ => "",
    }
    .to_string()
}

fn quality_label(q: i32) -> String {
    match q {
        127 => "8K 超高清",
        126 => "杜比视界",
        125 => "HDR 真彩",
        120 => "4K 超清",
        116 => "1080P 60帧",
        112 => "1080P 高码率",
        80 => "1080P 高清",
        74 => "720P 60帧",
        64 => "720P 准高清",
        32 => "480P 清晰",
        16 => "360P 流畅",
        _ => return format!("清晰度 {q}"),
    }
    .to_string()
}

// ---------- 解析 ----------

fn check(v: &Value) -> Result<Value, String> {
    let code = v["code"].as_i64().unwrap_or(-1);
    if code == 0 {
        Ok(if v.get("data").is_some() {
            v["data"].clone()
        } else {
            v.clone()
        })
    } else {
        let msg = text_of(&v["message"]);
        Err(if msg.is_empty() {
            format!("接口错误 (code {code})")
        } else {
            msg
        })
    }
}

fn videos_from(v: &Value) -> Vec<VideoCard> {
    v.as_array()
        .map(|a| a.iter().filter_map(parse_video_card).collect())
        .unwrap_or_default()
}

fn parse_video_card(v: &Value) -> Option<VideoCard> {
    let bvid = text_of(&v["bvid"]);
    if bvid.is_empty() {
        return None;
    }
    Some(VideoCard {
        bvid,
        aid: num_of(&v["aid"]),
        title: plain_text(&text_of(&v["title"])),
        cover: fix_url(&text_of(&v["pic"])),
        author: text_of(&v["owner"]["name"]),
        mid: num_of(&v["owner"]["mid"]),
        play: num_of(&v["stat"]["view"]),
        danmaku: num_of(&v["stat"]["danmaku"]),
        like: num_of(&v["stat"]["like"]),
        tname: plain_text(&text_of(&v["tname"])),
        is_followed: num_of(&v["is_followed"]) == 1,
        duration: fmt_dur(num_of(&v["duration"])),
        pubdate: num_of(&v["pubdate"]),
        description: text_of(&v["desc"]),
        recommend_reason: text_of(&v["rcmd_reason"]["content"]),
    })
}

fn parse_search_video(v: &Value) -> Option<VideoCard> {
    let bvid = text_of(&v["bvid"]);
    if bvid.is_empty() {
        return None;
    }
    Some(VideoCard {
        bvid,
        aid: num_of(&v["aid"]),
        title: plain_text(&text_of(&v["title"])),
        cover: fix_url(&text_of(&v["pic"])),
        author: plain_text(&text_of(&v["author"])),
        mid: num_of(&v["mid"]),
        play: num_of(&v["play"]),
        danmaku: num_of(&v["video_review"]),
        like: num_of(&v["like"]),
        tname: plain_text(&text_of(&v["typename"])),
        is_followed: false,
        duration: text_or_num(&v["duration"]),
        pubdate: num_of(&v["pubdate"]),
        description: plain_text(&text_of(&v["description"])),
        recommend_reason: String::new(),
    })
}

fn parse_live_rooms(v: &Value) -> Vec<LiveRoom> {
    v.as_array()
        .map(|a| a.iter().filter_map(parse_live_room).collect())
        .unwrap_or_default()
}

fn parse_live_room(v: &Value) -> Option<LiveRoom> {
    let mut room_id = num_of(&v["roomid"]);
    if room_id <= 0 {
        room_id = num_of(&v["room_id"]);
    }
    if room_id <= 0 {
        room_id = num_of(&v["id"]);
    }
    if room_id <= 0 {
        return None;
    }

    let mut cover = fix_url(&text_of(&v["cover"]));
    if cover.is_empty() {
        cover = fix_url(&text_of(&v["keyframe"]));
    }
    if cover.is_empty() {
        cover = fix_url(&text_of(&v["user_cover"]));
    }
    if cover.is_empty() {
        cover = fix_url(&text_of(&v["pic"]));
    }

    let mut uname = text_of(&v["uname"]);
    if uname.is_empty() {
        uname = text_of(&v["author"]);
    }
    let mut face = fix_url(&text_of(&v["face"]));
    if face.is_empty() {
        face = fix_url(&text_of(&v["uface"]));
    }

    let live_status = if v.get("live_status").is_some() {
        num_of(&v["live_status"]) as i32
    } else {
        1
    };

    Some(LiveRoom {
        room_id,
        uid: num_of(&v["uid"]),
        title: plain_text(&text_of(&v["title"])),
        cover,
        uname: plain_text(&uname),
        face,
        online: num_of(&v["online"]),
        area_id: num_of(&v["area_v2_id"]),
        area_name: plain_text(&text_of(&v["area_v2_name"])),
        parent_area_id: num_of(&v["area_v2_parent_id"]),
        parent_area_name: plain_text(&text_of(&v["area_v2_parent_name"])),
        live_status,
    })
}

fn parse_live_search_room(v: &Value) -> Option<LiveRoom> {
    let mut room = parse_live_room(v)?;
    if room.area_name.is_empty() {
        room.area_name = plain_text(&text_of(&v["cate_name"]));
    }
    if room.parent_area_id <= 0 {
        room.parent_area_id = num_of(&v["area"]);
    }
    Some(room)
}

fn merge_live_rooms(dst: &mut Vec<LiveRoom>, src: Vec<LiveRoom>) {
    for room in src {
        if !dst.iter().any(|r| r.room_id == room.room_id) {
            dst.push(room);
        }
    }
}


fn parse_user_card(v: &Value) -> Option<UserCard> {
    let mid = num_of(&v["mid"]);
    if mid <= 0 {
        return None;
    }
    Some(UserCard {
        mid,
        name: plain_text(&text_of(&v["uname"])),
        avatar: fix_url(&text_of(&v["upic"])),
        fans: num_of(&v["fans"]),
        videos: num_of(&v["videos"]),
        sign: plain_text(&text_of(&v["usign"])),
        level: num_of(&v["level"]) as i32,
    })
}

fn parse_bangumi_card(v: &Value) -> Option<BangumiCard> {
    let season_id = num_of(&v["season_id"]);
    if season_id <= 0 {
        return None;
    }
    let score = if !v["media_score"]["score"].is_null() {
        text_or_num(&v["media_score"]["score"])
    } else {
        text_or_num(&v["score"])
    };
    Some(BangumiCard {
        season_id,
        title: plain_text(&text_of(&v["title"])),
        cover: fix_url(&text_of(&v["cover"])),
        badge: text_of(&v["badge"]),
        index_show: text_of(&v["index_show"]),
        score,
        order: text_of(&v["order"]),
        subtitle: text_of(&v["subTitle"]),
        link: text_of(&v["link"]),
    })
}

fn parse_comment(v: &Value, depth: i32) -> Option<CommentItem> {
    if v.is_null() {
        return None;
    }
    let pictures = v["content"]["pictures"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|p| fix_url(&text_of(&p["img_src"])))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let mut replies = Vec::new();
    if depth == 0 {
        if let Some(arr) = v["replies"].as_array() {
            for r in arr.iter().take(3) {
                if let Some(c) = parse_comment(r, depth + 1) {
                    replies.push(c);
                }
            }
        }
    }
    Some(CommentItem {
        rpid: num_of(&v["rpid"]),
        mid: num_of(&v["member"]["mid"]),
        name: text_of(&v["member"]["uname"]),
        avatar: fix_url(&text_of(&v["member"]["avatar"])),
        level: num_of(&v["member"]["level_info"]["current_level"]) as i32,
        message: text_of(&v["content"]["message"]),
        like: num_of(&v["like"]),
        // 1 = 当前用户已点赞（登录后接口返回）
        like_action: num_of(&v["action"]) as i32,
        oid: num_of(&v["oid"]),
        ctime: num_of(&v["ctime"]),
        reply_count: num_of(&v["rcount"]),
        pictures,
        replies,
    })
}

fn parse_danmaku(xml: &str) -> Vec<DanmakuItem> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<d ") {
        let after = &rest[start..];
        let tag_end = match after.find('>') {
            Some(i) => i,
            None => break,
        };
        let tag = &after[3..tag_end];
        let body_start = tag_end + 1;
        let end = match after[body_start..].find("</d>") {
            Some(i) => body_start + i,
            None => break,
        };
        let content = &after[body_start..end];
        if let Some(p) = attr_of(tag, "p") {
            let parts: Vec<&str> = p.split(',').collect();
            if parts.len() >= 4 {
                out.push(DanmakuItem {
                    id: parts.get(7).and_then(|s| s.parse().ok()).unwrap_or(0),
                    time: parts[0].parse().unwrap_or(0.0),
                    mode: parts[1].parse().unwrap_or(1),
                    color: rgb_hex(parts[3]),
                    content: decode_entities(content),
                    size: parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(25),
                });
            }
        }
        rest = &after[end + 4..];
        if out.len() >= 6000 {
            break;
        }
    }
    out.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));
    out
}

// ---------- 工具函数 ----------

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn hex_md5(s: &str) -> String {
    let digest = Md5::digest(s.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Dart `Uri.encodeComponent` 的等价实现，供 App 接口签名使用
fn dart_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(*b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn mixin_key(img: &str, sub: &str) -> String {
    let raw = format!("{img}{sub}");
    WBI_TAB
        .iter()
        .take(32)
        .filter_map(|&i| raw.as_bytes().get(i).map(|&b| b as char))
        .collect()
}

fn key_from_url(u: &str) -> String {
    let name = u.rsplit('/').next().unwrap_or("");
    name.split('.').next().unwrap_or("").to_string()
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

fn plain_text(s: &str) -> String {
    decode_entities(&strip_tags(s))
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n).collect::<String>())
    }
}

fn fmt_dur(secs: i64) -> String {
    let s = secs.max(0);
    let (h, m, ss) = (s / 3600, (s % 3600) / 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{ss:02}")
    } else {
        format!("{m:02}:{ss:02}")
    }
}

fn text_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn text_or_num(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn num_of(v: &Value) -> i64 {
    match v {
        Value::Number(n) => n.as_i64().unwrap_or(0),
        Value::String(s) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

fn fix_url(s: &str) -> String {
    let s = s.trim();
    if s.starts_with("//") {
        format!("https:{s}")
    } else if let Some(rest) = s.strip_prefix("http://") {
        format!("https://{rest}")
    } else {
        s.to_string()
    }
}

fn attr_of(tag: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=\"");
    let i = tag.find(&needle)? + needle.len();
    let rest = &tag[i..];
    let j = rest.find('"')?;
    Some(rest[..j].to_string())
}

fn rgb_hex(v: &str) -> String {
    let n = u32::from_str_radix(v.trim(), 10).unwrap_or(0xFFFFFF);
    format!("#{n:06x}")
}

fn decode_entities(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

fn mid_of(login: &Cookies) -> i64 {
    login
        .get("DedeUserID")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

#[allow(dead_code)]
fn random_b64(bytes: usize) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(1);
    let mut x = now_secs() ^ (nanos << 20) ^ 0x9e37_79b9_7f4a_7c15;
    let mut buf = Vec::with_capacity(bytes);
    for _ in 0..bytes {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        buf.push((x & 0xff) as u8);
    }
    base64::engine::general_purpose::STANDARD.encode(buf)
}

/// 生成二维码 PNG data URL（本地渲染，无外部依赖服务）
fn make_qr_png(data: &str) -> Result<String, String> {
    let code = qrcode::QrCode::with_error_correction_level(data.as_bytes(), qrcode::EcLevel::M)
        .map_err(|e| e.to_string())?;
    let width = code.width();
    let colors = code.to_colors();
    let quiet = 4usize;
    let scale = 8usize;
    let size = (width + quiet * 2) * scale;
    let mut img = image::GrayImage::from_pixel(size as u32, size as u32, image::Luma([255u8]));
    for (i, color) in colors.iter().enumerate() {
        if *color == qrcode::Color::Dark {
            let x = (i % width + quiet) * scale;
            let y = (i / width + quiet) * scale;
            for dy in 0..scale {
                for dx in 0..scale {
                    img.put_pixel((x + dx) as u32, (y + dy) as u32, image::Luma([0u8]));
                }
            }
        }
    }
    let mut cursor = Cursor::new(Vec::new());
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(cursor.get_ref());
    Ok(format!("data:image/png;base64,{b64}"))
}
