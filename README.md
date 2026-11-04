# Bilibili-Tauri

![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

一个基于 **Tauri 2 + Rust + WebView2** 的轻量级哔哩哔哩桌面客户端。前端使用原生 HTML / CSS / ES Modules，没有框架运行时、没有打包步骤；后端负责 API 请求、Cookie 加密与本地媒体代理。安装包与内存占用都远小于同类的 Electron 方案。

![界面预览](assets/screenshot.png)

> 第三方非官方客户端，与哔哩哔哩官方无关。所有视频、番剧、直播、弹幕与评论内容的版权归原作者及平台所有，仅供学习与交流使用。

## 功能

### 浏览与发现

- **首页频道栏**：动态 / 直播 / 推荐 / 热门 / 追番 / 影视，频道内跳转不会丢失当前上下文。
- **热门**：全站热门、排行榜、分区精选；分区与排行榜分类以横向标签排列在频道栏下方。
- **推荐**：官方个性化推荐流，右下角浮动按钮刷新换一批，滚动自动续载。
- **搜索**：视频、UP 主、番剧三类结果；WBI 签名、搜索建议、热门搜索、最近搜索、排序与时长筛选。
- **用户空间**：UP 主资料、投稿视频与动态，动态入口不再跳到外部浏览器。

### 视频与播放

- DASH 视频流 + 独立音轨双元素同步播放，支持 8K / 4K / 1080P60 等清晰度档位。
- 分 P 切换、倍速、音量、全屏、字幕、画质与进度记忆；番剧支持片头 / 片尾跳过。
- 音质档位、编码偏好（AVC / HEVC / AV1）与 CDN 线路可选，不可用时自动降级。
- 播放页采用「左播放器 + 右信息栏」布局，右栏在简介与评论之间切换，相关推荐挂在下方。
- 视频卡片右上角提供稍后再看按钮；评论支持点赞、回复、发表情与查看全部回复。
- 视频与直播间支持在独立窗口中打开，重复点击复用同一窗口，窗口内可一键回到主界面。

### 弹幕

- Canvas 弹幕引擎，以媒体时间驱动，支持显示开关、不透明度、字号、速度与显示区域调节。
- 弹幕悬停时冻结并显示复制按钮，鼠标移开恢复滚动；直播弹幕同样支持。
- 高能进度条按弹幕密度绘制，可快速定位高能片段；空闲时自动降低重绘频率。

### 番剧与影视

- **追番**与**影视**分开展示：追番库把国创并入地区「中国」，影视包含电影、纪录片、电视剧与综艺。
- 支持官方「更多筛选」中的地区、风格、年份、版本、付费、配音、版权、完结状态等条件与排序。
- 详情页支持选季、选集、自动连播。

### 直播

- 直播推荐、分区浏览与搜索；直播间清晰度与线路切换。
- FLV 经 `mpegts.js` 转 MSE 播放，多线路自动回退，缓冲大小与低延迟追帧可调。
- WebSocket 实时弹幕 + deflate 解包；右侧「观众发言」同步显示弹幕、醒目留言、礼物与进场消息。
- 支持在直播间发送弹幕与官方表情；在线观看人数取自实时连接数据。
- 顶部只保留弹幕开关，不显示连接状态等冗余文字。

### 动态与消息

- **动态**：官方式三栏布局——左侧「有更新的 UP 主」、中间关注动态流、右侧「关注 UP 主正在直播」。
- 动态卡片支持点赞、评论、转发；评论与转发在原页面内完成。
- 发布图文动态，支持插入图片、B 站官方表情包（多系列）与 @好友。
- **消息**：回复我的、提到我的、收到的赞三类消息；视频类消息显示原视频封面，动态类消息在应用内窗口中打开。
- 消息页与动态页均使用右下角浮动刷新按钮。

### 个人内容

- **历史记录**：综合 / 视频 / 直播 / 专栏分类，按天分组，显示续播进度，支持单条移除与清空。
- **收藏夹**：收藏夹列表、内容分页、新建收藏夹。
- **稍后再看**：列表浏览与视频页添加 / 移除。
- **互动**：点赞、投币、收藏、分享、关注 UP 主。

### 账号与安全

- 二维码扫码登录，登录状态启动时自动恢复。
- Cookie 使用 Windows DPAPI 加密后保存为 `cookies.dat`，不以明文落盘；旧版明文 `cookies.json` 会在首次启动时自动迁移并删除。

### 桌面体验

- 无边框窗口与自定义标题栏，拖动标题空白处移动窗口，双击最大化。
- 可收起侧边栏、全局搜索、右键菜单屏蔽、快捷键与窗口内导航。
- 设置项覆盖主题、播放、弹幕、音视频与数据清理，全部自动保存在本地。

## 技术方案

| 层 | 实现 |
| --- | --- |
| 桌面壳 | Tauri 2 / WebView2 |
| 后端 | Rust、reqwest、tokio、axum |
| 前端 | 原生 HTML / CSS / ES Modules，无框架、无打包步骤 |
| 路由 | Hash 路由，按页面注册清理函数与 `AbortController` |
| 媒体 | 本地 `127.0.0.1` HTTP 代理，补 Referer 并转发 Range 请求 |
| 视频 | DASH 视频流 + 音频流双 `<video>` 同步，编码偏好优先 AVC 以兼容 WebView2 |
| 直播 | Live FLV 经 `mpegts.js` 转 MSE，多线路回退与延迟追帧 |
| 弹幕 | Canvas 渲染，媒体时间驱动，支持冻结与命中检测 |
| 数据 | 聚合接口 `web-dynamic/v1/feed/all`、`msgfeed/*` 与 PGC / WBI 接口 |
| 登录 | 二维码登录，Cookie 经 Windows DPAPI 加密保存 |

### 为什么需要本地媒体代理

哔哩哔哩 CDN 会校验 `Referer`，WebView2 直接加载音视频地址通常返回 403。应用启动时会在本机回环地址上启动轻量 HTTP 代理，把播放地址改写为代理地址，由 Rust 端补充请求头并转发 `Range`，从而支持拖动进度与分片加载。代理只监听 `127.0.0.1`，不对外网开放。

### 弹幕解包

B 站弹幕接口返回的是裸 deflate 压缩的 XML，而 `reqwest` 默认会按 zlib 处理 `Content-Encoding`。项目为弹幕请求单独使用关闭自动解压的 HTTP 客户端，再用 `flate2` 手动解压，避免 `invalid distance too far back` 一类的解码失败。

## 快速开始

### 环境要求

- Windows 10 / 11
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) stable（MSVC 工具链）
- WebView2 Runtime（Windows 11 自带，Windows 10 通常随 Edge 安装）
- Visual Studio Build Tools 的 C++ 桌面开发组件

### 从源码运行

```bash
npm install
npm run dev
```

### 构建安装包

```bash
npm run build
```

默认生成 NSIS 安装包，产物位于 `src-tauri/target/release/bundle/nsis/`。若设置了 `CARGO_TARGET_DIR`，则以该目录下的 `release/bundle/nsis/` 为准。

### 工具链说明

仓库根目录的 `rust-toolchain.toml` 将工具链固定在 `stable-x86_64-pc-windows-msvc`，因此 `npm run dev` / `npm run build` 不需要额外设置 PATH 或 `CC`。

不要切回 `x86_64-pc-windows-gnu`：GNU 工具链的 bfd `ld` 在链接 Tauri 的 cdylib 时会报 `error: export ordinal too large`。确实要用 GNU 工具链时，需要把链接器换成 LLVM 的 `lld`：

```powershell
$env:PATH = "C:\path\to\llvm-mingw\bin;" + $env:PATH
npm run build
```

从 GNU 切到 MSVC 后首次构建会重新编译全部依赖，旧产物不会复用。

## 项目结构

```text
.
├─ src/                          # 前端静态资源（Tauri frontendDist）
│  ├─ index.html                 # 应用壳与标题栏 / 侧边栏骨架
│  ├─ styles/                    # base / layout / components / pages / player
│  ├─ vendor/                    # mpegts.js
│  └─ js/
│     ├─ main.js                 # 壳层：标题栏、侧边栏、搜索、账号菜单、FAB
│     ├─ router.js               # Hash 路由与页面生命周期
│     ├─ api.js                  # Tauri 命令封装
│     ├─ store.js                # 本地偏好与登录状态
│     ├─ channels.js             # 首页频道定义与频道内链接改写
│     ├─ media.js                # 音质 / 编码 / CDN / 直播缓冲偏好
│     ├─ login.js                # 二维码登录
│     ├─ emotes.js               # 官方表情包加载与选择器
│     ├─ editor.js               # 富文本输入与 @ 插入
│     ├─ ui.js / utils.js        # 通用组件、缩略图、时间与格式化
│     ├─ icons.js                # 内联 SVG 图标
│     ├─ pages/                  # 首页频道、动态、消息、搜索、视频、番剧、直播、空间、历史、收藏、稍后再看、设置
│     └─ player/                 # 播放器、Canvas 弹幕、直播弹幕、悬停冻结
├─ src-tauri/
│  ├─ src/
│  │  ├─ api/                    # Bilibili API 客户端与数据模型
│  │  ├─ commands.rs             # Tauri 命令
│  │  ├─ proxy.rs                # 本地媒体代理
│  │  ├─ secure.rs               # DPAPI Cookie 加密
│  │  └─ lib.rs
│  ├─ capabilities/
│  ├─ icons/
│  └─ tauri.conf.json
├─ assets/
├─ package.json
├─ rust-toolchain.toml
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

播放器快捷键在播放器获得焦点时生效；输入框与可编辑区域内不会拦截按键。

## 安全与隐私

- 登录 Cookie 通过 Windows DPAPI（`CryptProtectData`）以当前用户密钥加密后写入 `%APPDATA%/io.github.bilitauri.desktop/cookies.dat`，文件带版本魔数，无法在其他账户或机器上直接解开。
- 应用不会上传 Cookie、观看记录或本地偏好；所有请求直接发往哔哩哔哩官方接口。
- 本地媒体代理仅绑定回环地址，只转发媒体请求所需的请求头与 Range。
- 「恢复默认设置」与「清除最近搜索」只影响本地数据，不会修改账号内容。

## 已知限制

- 未登录时清晰度通常最高为 480P，直播通常最高为超清（qn 250）；登录后视账号与内容而定。
- 动态与消息中心依赖登录状态，未登录时只显示登录引导。
- 系统消息没有公开接口，页面不提供该系统分类。
- 部分版权内容、付费内容或地区限制内容无法播放。
- 弹幕仅实现滚动弹幕的基础渲染，未覆盖完整的高级弹幕样式。
- 动态发布、点赞、转发等写操作依赖账号状态与接口风控，失败时会给出提示。
- 本项目依赖哔哩哔哩非公开接口，接口变更可能导致部分功能失效。

## 免责声明

本项目仅用于学习与技术交流，不提供任何视频、番剧、直播或弹幕内容，也不绕过平台的付费与版权限制。使用者应遵守哔哩哔哩用户协议与相关法律法规，因使用本项目产生的任何后果由使用者自行承担。

## License

[MIT](LICENSE)
