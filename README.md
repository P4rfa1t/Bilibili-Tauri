# Bilibili-Tauri

一个基于 **Tauri 2 + Rust + WebView2** 的轻量级哔哩哔哩桌面客户端。前端使用原生 ES Modules，没有打包步骤、没有前端框架运行时，安装包和内存占用都远小于 Electron 方案。

![界面预览](assets/screenshot.png)

> 本项目为第三方非官方客户端，与哔哩哔哩官方无关。所有视频、番剧、弹幕与评论内容的版权归原作者及平台所有，仅供学习与交流使用。

## 功能

- **发现**：首页顶部有「动态 / 直播 / 推荐 / 热门 / 追番 / 影视」频道栏，热门下再分全站热门、排行榜与分区精选，支持无限滚动。
- **推荐**：官方个性化推荐流（feed/rcmd），换一批与无限滚动，偶发风控自动退回热门。
- **动态**：官方式三栏布局——左侧「有更新的 UP 主」、中间关注动态流（图文、视频卡片、直播卡片、转发，按关注时间倒序无限加载）、右侧「关注 UP 主正在直播」。标题栏右侧的动态入口带未读数量提示。
- **消息**：回复我的、提到我的、收到的赞三类消息分页浏览，每条带原视频条目可直接进视频页，标题栏铃铛常驻未读红点。
- **直播**：直播推荐/分区/搜索，直播间详情、清晰度切换、实时弹幕（WebSocket + deflate 解包）、FLV 转 mpegts 播放、多线路自动切换、缓冲与低延迟追帧可调；右侧「观众发言」实时滚动显示弹幕、醒目留言、礼物与进场消息。
- **搜索**：视频、UP 主、番剧搜索；WBI 签名；搜索建议、热门搜索、最近搜索、排序切换。
- **视频**：DASH 播放、分 P 切换、清晰度/倍速/音量/全屏、字幕、画质与进度记忆；音质档位、编码偏好（AVC/HEVC/AV1）与 CDN 线路可选。播放页为「左播放器 + 右信息栏」布局，右栏可切换简介与评论，下方直接挂相关推荐。
- **独立播放窗口**：在主界面点任意视频或直播间会在单独的窗口里打开（重复点击复用同一窗口），窗口内可一键「回到主界面」。
- **弹幕**：Canvas 弹幕渲染，支持显示开关、透明度、字号、速度、显示区域调整。
- **评论**：最热/最新排序、分页加载、评论点赞、查看全部回复、评论图片查看。
- **历史记录**：综合/视频/直播/专栏分类 tab、按天分组、续播进度、单条移除与清空、直播与专栏记录可跳转。
- **番剧**：番剧/国创/电影/纪录片/综艺分类，详情、选季、选集、自动连播。
- **互动**：点赞、投币、收藏夹管理（含新建收藏夹）、稍后再看、分享、关注 UP 主。
- **账号**：二维码扫码登录，Cookie 持久化到应用数据目录，启动时自动恢复登录状态。
- **我的**：观看历史（分类 tab、按天分组、续播进度）、收藏夹、稍后再看、用户空间。
- **设置**：主题（浅色/深色/跟随系统）、默认清晰度、自动播放、记忆进度、默认倍速/音量、弹幕参数、音视频偏好、最近搜索与恢复默认。
- **桌面体验**：无边框窗口、自定义标题栏（拖动标题空白处可移动窗口、双击最大化）、窗口控制、可收起侧边栏、快捷键、全局搜索。

## 技术方案

| 层 | 实现 |
| --- | --- |
| 桌面壳 | Tauri 2 / WebView2 |
| 后端 | Rust、reqwest、tokio、axum |
| 前端 | 原生 HTML / CSS / ES Modules |
| 媒体 | 本地 `127.0.0.1` HTTP 代理，补 Referer 并转发 Range 请求 |
| 播放 | DASH 视频流 + 音频流双 `<video>` 元素同步，优先 AVC 编码以兼容 WebView2 |
| 直播 | Live FLV 经 `mpegts.js` 转 MSE 播放，多线路回退与延迟追帧可配置 |
| 动态 / 消息 | 聚合接口 `web-dynamic/v1/feed/all` 与 `msgfeed/*`，需登录 Cookie |
| 登录 | 二维码登录，Cookie 保存为 `app_data_dir/cookies.json` |

### 为什么需要本地媒体代理

哔哩哔哩 CDN 会校验 `Referer`，WebView2 直接加载音视频地址通常会返回 403。应用启动时会在本机回环地址上启动一个轻量 HTTP 代理，将播放地址改写为代理地址，由 Rust 端补充请求头并转发 `Range`，从而支持拖动进度条和分片加载。

## 开发

### 环境要求

- Windows 10/11
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) stable
- WebView2 Runtime（Windows 11 自带，Windows 10 通常已随 Edge 安装）
- Tauri 的 Windows 构建依赖：MSVC 工具链（Visual Studio Build Tools 的 C++ 组件）

### 启动

```bash
npm install
npm run dev
```

### 构建安装包

```bash
npm run build
```

构建产物位于 `src-tauri/target/release/bundle/`。默认生成 NSIS 安装包。

### 工具链说明

仓库根目录的 `rust-toolchain.toml` 把工具链固定在 `stable-x86_64-pc-windows-msvc`，因此 `npm run dev` / `npm run build` 不需要额外设置 PATH 或 `CC`。

不要切回 `x86_64-pc-windows-gnu`：GNU 工具链的 bfd `ld` 在链接 Tauri 的 cdylib 时会报 `error: export ordinal too large`，导出符号数量超出了 PE 序号空间，debug 构建必然触发。确实要用 GNU 工具链时，得把链接器换成 LLVM 的 `lld`：

```powershell
$env:PATH = "C:\path\to\llvm-mingw\bin;" + $env:PATH
npm run build
```

从 GNU 切到 MSVC 后首次构建要重新编译全部依赖，`src-tauri/target` 里的旧产物不会被复用。

## 项目结构

```text
.
├─ src/                      # 前端静态资源（Tauri frontendDist）
│  ├─ index.html
│  ├─ styles/
│  └─ js/
│     ├─ main.js             # 应用壳：标题栏、侧边栏、搜索、账号菜单
│     ├─ router.js           # Hash 路由与页面生命周期
│     ├─ api.js              # Tauri 命令封装
│     ├─ store.js            # 本地偏好与登录状态
│     ├─ media.js            # 音视频取流偏好：音质/编码/CDN/直播缓冲
│     ├─ login.js            # 二维码登录
│     ├─ channels.js         # 首页频道栏定义与频道内链接改写
│     ├─ pages/              # 首页频道容器、动态、消息、搜索、视频、番剧、直播、空间、历史、收藏、稍后再看、设置
│     ├─ player/             # 播放器与 Canvas 弹幕
│     └─ ...
├─ src-tauri/
│  ├─ src/
│  │  ├─ api/                # Bilibili API 客户端与数据模型
│  │  ├─ commands.rs         # Tauri 命令
│  │  ├─ proxy.rs            # 本地媒体代理
│  │  └─ lib.rs
│  ├─ capabilities/
│  ├─ icons/
│  └─ tauri.conf.json
├─ assets/
├─ package.json
└─ README.md
```

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl + K` | 聚焦全局搜索 |
| `Alt + ←` / `Alt + →` | 后退 / 前进 |
| `空格` / `K` | 播放 / 暂停 |
| `←` / `→` | 快退 / 快进 5 秒 |
| `J` / `L` | 快退 / 快进 10 秒 |
| `↑` / `↓` | 调节音量 |
| `M` | 静音 |
| `F` | 全屏 |
| `D` | 弹幕开关 |
| `C` | 字幕开关 |

## 已知限制

- 未登录时清晰度通常最高为 480P，登录后可解锁更高清晰度（取决于账号与视频本身）。
- 未登录状态下直播清晰度通常最高为超清（qn 250），原画/蓝光需要登录。
- 动态与消息中心依赖登录状态，未登录时只显示登录引导。系统消息没有公开接口，页面只同步未读数并提供跳转 B 站消息中心的入口。
- 部分版权内容、付费内容或地区限制内容无法播放。
- 弹幕仅支持滚动弹幕的基础渲染，未实现完整的高级弹幕样式。
- 本项目依赖哔哩哔哩非公开接口，接口变更可能导致部分功能失效。

## License

[MIT](LICENSE)
