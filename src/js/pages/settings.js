import { appVersion, openExternal } from "../api.js";
import {
  AUDIO_QUALITY_OPTIONS,
  CDN_OPTIONS,
  CODEC_OPTIONS,
  LIVE_QUALITY_OPTIONS,
  QUALITY_OPTIONS,
  SPEED_OPTIONS,
  THEME_OPTIONS,
} from "../constants.js";
import { icon } from "../icons.js";
import { logoutUser, openLoginModal, refreshUser } from "../login.js";
import { store } from "../store.js";
import {
  avatarTag,
  confirmDialog,
  pageHead,
  setButtonLoading,
  toast,
} from "../ui.js";
import { errorText, escapeAttr, escapeHtml } from "../utils.js";

const REPO_URL = "https://github.com/P4rfa1t/Bilibili-Tauri";
const BILIBILI_URL = "https://www.bilibili.com";

function accountHtml(user) {
  if (!user) {
    return `<div class="settings-account">
      <span class="avatar avatar-lg avatar-fallback">${icon("user", 24)}</span>
      <div class="settings-account-main">
        <div class="settings-account-name">未登录</div>
        <div class="settings-account-sub">扫码登录后可同步历史、收藏、稍后再看与观看进度。</div>
      </div>
      <button class="btn btn-primary" type="button" data-login>${icon(
        "qr-code",
        15
      )}扫码登录</button>
    </div>`;
  }
  return `<div class="settings-account">
    ${avatarTag(user.face, user.name, "avatar avatar-lg")}
    <div class="settings-account-main">
      <div class="settings-account-name">
        <span>${escapeHtml(user.name || "Bilibili 用户")}</span>
        ${user.vip_status ? `<span class="vip-badge">大会员</span>` : ""}
        ${user.level ? `<span class="level-badge">Lv${Number(user.level)}</span>` : ""}
      </div>
      <div class="settings-account-sub">UID ${Number(user.mid) || 0} · 硬币 ${Math.round(
    Number(user.coin) || 0
  )}</div>
    </div>
    <button class="btn btn-sm btn-soft" type="button" data-refresh-user>${icon(
      "refresh-cw",
      14
    )}刷新</button>
    <button class="btn btn-sm btn-danger-soft" type="button" data-logout>${icon(
      "log-out",
      14
    )}退出登录</button>
  </div>`;
}

function switchRow(label, desc, setting, checked) {
  return `<div class="set-row">
    <div class="set-label"><div class="t">${escapeHtml(label)}</div><div class="d">${escapeHtml(
    desc
  )}</div></div>
    <div class="set-control">
      <label class="switch">
        <input type="checkbox" data-setting="${setting}"${checked ? " checked" : ""}>
        <span class="switch-track"></span>
      </label>
    </div>
  </div>`;
}

function selectRow(label, desc, setting, options, value, numeric = true) {
  return `<div class="set-row">
    <div class="set-label"><div class="t">${escapeHtml(label)}</div><div class="d">${escapeHtml(
    desc
  )}</div></div>
    <div class="set-control">
      <select class="select" data-setting="${setting}"${numeric ? ' data-number="true"' : ""}>
        ${options
          .map(
            (option) =>
              `<option value="${option.value}"${
                String(option.value) === String(value) ? " selected" : ""
              }>${escapeHtml(option.label)}</option>`
          )
          .join("")}
      </select>
    </div>
  </div>`;
}

function rangeRow(label, desc, setting, value, { min, max, step = 1, scale = 1, format = "number" }) {
  const shown = scale === 100 ? Math.round(Number(value) * 100) : Number(value);
  const text =
    format === "percent"
      ? `${Math.round(Number(value) * 100)}%`
      : format === "px"
      ? `${Math.round(Number(value))}px`
      : format === "plain"
      ? `${Number(value)}`
      : format === "minute"
      ? `${Math.round(Number(value) / 60)} 分钟`
      : `${Number(value)}x`;
  return `<div class="set-row">
    <div class="set-label"><div class="t">${escapeHtml(label)}</div><div class="d">${escapeHtml(
    desc
  )}</div></div>
    <div class="set-control">
      <input class="range" type="range" min="${min}" max="${max}" step="${step}"
        value="${shown}" data-setting="${setting}" data-scale="${scale}" data-format="${format}">
      <span class="range-value" data-range-value>${text}</span>
    </div>
  </div>`;
}

function numberRow(
  label,
  desc,
  setting,
  value,
  { min = 0, max = 1000, step = 1, scale = 1, unit = "" } = {}
) {
  const shown = Math.round(Number(value) * Number(scale) * 100) / 100;
  return `<div class="set-row">
    <div class="set-label"><div class="t">${escapeHtml(label)}</div><div class="d">${escapeHtml(
    desc
  )}</div></div>
    <div class="set-control">
      <input class="input input-sm num-input" type="number" min="${min}" max="${max}" step="${step}"
        value="${shown}" data-setting="${setting}" data-scale="${scale}">
      ${unit ? `<span class="range-value">${escapeHtml(unit)}</span>` : ""}
    </div>
  </div>`;
}

function kwChipHtml(setting, word) {
  return `<span class="kw-chip">${escapeHtml(word)}<button type="button" class="kw-remove"
    data-kw-remove="${setting}" data-kw-word="${escapeAttr(word)}"
    aria-label="删除 ${escapeAttr(word)}">${icon("x", 12)}</button></span>`;
}

function kwListHtml(setting) {
  const words = store.get(setting) || [];
  if (!words.length) return '<span class="kw-empty">尚未添加</span>';
  return words.map((word) => kwChipHtml(setting, word)).join("");
}

function keywordEditor(label, desc, setting) {
  return `<div class="set-row">
    <div class="set-label"><div class="t">${escapeHtml(label)}</div><div class="d">${escapeHtml(
    desc
  )}</div></div>
    <div class="set-control kw-control">
      <div class="kw-list" data-kw-list="${setting}">${kwListHtml(setting)}</div>
      <div class="kw-input-row">
        <input class="input input-sm" type="text" placeholder="输入后回车添加" data-kw-input="${setting}">
        <button class="btn btn-sm btn-soft" type="button" data-kw-add="${setting}">添加</button>
      </div>
    </div>
  </div>`;
}

const SHORTCUTS = [
  ["空格 / K", "播放 / 暂停"],
  ["← / →", "快退 / 快进 5 秒"],
  ["J / L", "快退 / 快进 10 秒"],
  ["↑ / ↓", "调节音量"],
  ["M", "静音切换"],
  ["F", "全屏切换"],
  ["D", "弹幕开关"],
  ["C", "字幕开关"],
  ["Ctrl + K", "聚焦全局搜索"],
  ["Alt + ← / →", "后退 / 前进"],
];

export async function render(root, ctx) {
  const qualityOptions = QUALITY_OPTIONS.map((item) => ({
    value: item.value,
    label: item.label,
  }));
  const speedOptions = SPEED_OPTIONS.map((value) => ({
    value,
    label: `${value}x`,
  }));
  const audioOptions = AUDIO_QUALITY_OPTIONS.map((item) => ({
    value: item.value,
    label: item.label,
  }));
  const codecOptions = CODEC_OPTIONS.map((item) => ({
    value: item.value,
    label: item.label,
  }));
  const cdnOptions = CDN_OPTIONS.map((item) => ({ value: item.value, label: item.label }));
  const liveQualityOptions = LIVE_QUALITY_OPTIONS.map((item) => ({
    value: item.value,
    label: item.label,
  }));
  const user = store.user;

  root.innerHTML = `<div class="settings-wrap">
    ${pageHead({
      title: "设置",
      subtitle: "调整外观、播放偏好与弹幕样式。设置会自动保存在本地。",
    })}

    <section class="settings-card">
      <div class="settings-card-head">${icon("user", 18)}账号</div>
      <div class="settings-card-sub">登录状态由本地安全保存的 Cookie 维护。</div>
      <div data-account-area>${accountHtml(user)}</div>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">${icon("palette", 18)}外观</div>
      <div class="settings-card-sub">选择界面主题与侧边栏显示方式。</div>
      <div class="set-row">
        <div class="set-label"><div class="t">界面主题</div><div class="d">跟随系统会自动响应 Windows 的深浅色模式。</div></div>
        <div class="set-control">
          <div class="segmented" data-theme-group>
            ${THEME_OPTIONS.map(
              (option) =>
                `<button type="button" data-theme-value="${option.value}"${
                  store.get("theme") === option.value ? ' class="active"' : ""
                }>${escapeHtml(option.label)}</button>`
            ).join("")}
          </div>
        </div>
      </div>
      ${switchRow(
        "收起侧边栏",
        "在桌面端只显示图标，给内容留出更多空间。",
        "sidebarCollapsed",
        store.get("sidebarCollapsed")
      )}
    </section>

    <section class="settings-card">
      <div class="settings-card-head">${icon("play-circle", 18)}播放</div>
      <div class="settings-card-sub">这些选项会作为新打开视频的默认值。</div>
      ${selectRow(
        "默认清晰度",
        "未登录时通常最高只能播放 480P，登录后可解锁更高清晰度。",
        "quality",
        qualityOptions,
        store.get("quality")
      )}
      ${switchRow(
        "自动播放",
        "打开视频或切换分P后自动开始播放。",
        "autoplay",
        store.get("autoplay")
      )}
      ${switchRow(
        "记忆播放进度",
        "有观看记录时，从上次停止的位置继续播放。",
        "resume",
        store.get("resume")
      )}
      ${selectRow(
        "默认倍速",
        "新打开的视频使用该播放速度。",
        "speed",
        speedOptions,
        store.get("speed")
      )}
      ${rangeRow("默认音量", "播放器初始音量。", "volume", store.get("volume"), {
        min: 0,
        max: 100,
        step: 1,
        scale: 100,
        format: "percent",
      })}
    </section>

    <section class="settings-card">
      <div class="settings-card-head">${icon("message-square", 18)}弹幕</div>
      <div class="settings-card-sub">调整弹幕的显示数量、透明度与滚动速度。</div>
      ${switchRow(
        "显示弹幕",
        "播放视频时默认显示弹幕。也可以在播放器内按 D 切换。",
        "danmaku",
        store.get("danmaku")
      )}
      ${rangeRow(
        "不透明度",
        "弹幕文字的不透明度。",
        "danmakuOpacity",
        store.get("danmakuOpacity"),
        { min: 10, max: 100, step: 1, scale: 100, format: "percent" }
      )}
      ${rangeRow("字号", "弹幕文字大小。", "danmakuSize", store.get("danmakuSize"), {
        min: 14,
        max: 40,
        step: 1,
        format: "px",
      })}
      ${rangeRow(
        "滚动速度",
        "数值越大，弹幕移动越快。",
        "danmakuSpeed",
        store.get("danmakuSpeed"),
        { min: 4, max: 14, step: 1, format: "x" }
      )}
      ${rangeRow(
        "显示区域",
        "弹幕占据画面高度的比例，数值越小越集中。",
        "danmakuArea",
        store.get("danmakuArea"),
        { min: 20, max: 100, step: 1, scale: 100, format: "percent" }
      )}
    </section>

    <section class="settings-card">
      <div class="settings-card-head">${icon("compass", 18)}推荐流</div>
      <div class="settings-card-sub">推荐内容来自哔哩哔哩官方首页推荐接口，过滤规则只影响本地显示。</div>
      ${switchRow(
        "继续上次刷新批次",
        "重新打开应用时从上次的推荐批次继续，而不是从头刷新。",
        "recommendKeepRefresh",
        store.get("recommendKeepRefresh")
      )}
      ${switchRow(
        "标记上次浏览位置",
        "在推荐流里显示“上次看到这里”的分隔线。",
        "recommendLastSeen",
        store.get("recommendLastSeen")
      )}
      ${switchRow(
        "关注 UP 主豁免",
        "过滤时跳过已关注的 UP 主，避免把常看的内容滤掉。",
        "exemptFollowed",
        store.get("exemptFollowed")
      )}
      ${switchRow(
        "同时过滤相关推荐",
        "视频页右侧的相关推荐也套用同一套过滤规则。",
        "filterRelated",
        store.get("filterRelated")
      )}
      ${rangeRow("最低点赞率", "点赞数与播放量的比值低于该值时隐藏。", "likeRateMin", store.get("likeRateMin"), {
        min: 0,
        max: 20,
        step: 0.5,
        scale: 100,
        format: "percent",
      })}
      ${numberRow("最低播放量", "播放量低于该值时隐藏，0 表示不限。", "playMin", store.get("playMin"), {
        min: 0,
        max: 100000000,
        step: 1000,
        unit: "次",
      })}
      ${numberRow("最短时长", "时长低于该值时隐藏，0 表示不限。", "durationMin", store.get("durationMin"), {
        min: 0,
        max: 120,
        step: 1,
        scale: 1 / 60,
        unit: "分钟",
      })}
      ${numberRow("最长时长", "时长高于该值时隐藏，0 表示不限。", "durationMax", store.get("durationMax"), {
        min: 0,
        max: 120,
        step: 1,
        scale: 1 / 60,
        unit: "分钟",
      })}
      ${keywordEditor("标题关键词", "标题命中任一关键词时隐藏，回车或逗号分隔。", "titleFilters")}
      ${keywordEditor("分区关键词", "分区或标签命中任一关键词时隐藏。", "partitionFilters")}
    </section>

    <section class="settings-card">
      <div class="settings-card-head">${icon("play-circle", 18)}音视频</div>
      <div class="settings-card-sub">影响取流参数；目标档位不可用时会自动回退到可用的最高档。</div>
      ${switchRow(
        "免登录尝试 1080P",
        "未登录时也请求 1080P，取不到就自动降级。",
        "noLogin1080",
        store.get("noLogin1080")
      )}
      ${selectRow(
        "音质偏好",
        "DASH 音轨的码率档位，源视频没有对应档位时降级。",
        "audioQuality",
        audioOptions,
        store.get("audioQuality")
      )}
      ${selectRow(
        "视频编码偏好",
        "自动模式按 WebView2 的兼容性排序选择。",
        "codecPreference",
        codecOptions,
        store.get("codecPreference"),
        false
      )}
      ${selectRow(
        "CDN 线路",
        "备用线路优先时改用视频的备用地址，主线路慢可以切换。",
        "cdnPreference",
        cdnOptions,
        store.get("cdnPreference"),
        false
      )}
      ${selectRow(
        "直播清晰度",
        "匿名状态通常最高只能到超清档位。",
        "liveQuality",
        liveQualityOptions,
        store.get("liveQuality")
      )}
      ${selectRow(
        "直播线路",
        "备用线路优先时在主线路之前尝试备用地址。",
        "liveCdnPreference",
        cdnOptions,
        store.get("liveCdnPreference"),
        false
      )}
      ${rangeRow("直播缓冲", "缓冲越大越抗抖，起播时间也会变长。", "liveBufferSize", store.get("liveBufferSize"), {
        min: 1,
        max: 16,
        step: 1,
        format: "plain",
      })}
      ${rangeRow("低延迟追帧", "秒。越小越贴近直播，网络差时更容易卡顿。", "liveLatency", store.get("liveLatency"), {
        min: 1,
        max: 12,
        step: 1,
        format: "plain",
      })}
      <p class="hint">硬件解码、音画同步与画中画由 WebView2 直接处理，这里不另设开关。</p>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">${icon("database", 18)}数据与隐私</div>
      <div class="settings-card-sub">清除只会影响本地数据，不会删除 B 站账号内容。</div>
      <div class="set-row">
        <div class="set-label"><div class="t">最近搜索</div><div class="d">
          当前保存了 <span data-recent-count>${(store.get("recentSearches") || []).length}</span> 条搜索记录。
        </div></div>
        <div class="set-control">
          <button class="btn btn-sm btn-soft" type="button" data-clear-recent>清除记录</button>
        </div>
      </div>
      <div class="set-row">
        <div class="set-label"><div class="t">恢复默认设置</div><div class="d">主题、播放、弹幕、推荐流与音视频偏好都会恢复默认值。</div></div>
        <div class="set-control">
          <button class="btn btn-sm btn-danger-soft" type="button" data-reset>恢复默认</button>
        </div>
      </div>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">${icon("keyboard", 18)}快捷键</div>
      <div class="settings-card-sub">播放器获得焦点时生效。</div>
      <div class="shortcut-grid">
        ${SHORTCUTS.map(
          ([key, desc]) =>
            `<div class="shortcut-item"><span>${escapeHtml(desc)}</span><span class="kbd">${escapeHtml(
              key
            )}</span></div>`
        ).join("")}
      </div>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">${icon("info", 18)}关于</div>
      <div class="settings-account">
        <div class="settings-account-main">
          <div class="settings-account-name">
            <span>Bilibili-Tauri</span>
            <span class="about-version" data-version>v0.1.0</span>
          </div>
          <div class="settings-account-sub">基于 Tauri 2、Rust 与 WebView2 构建的轻量级哔哩哔哩桌面客户端。</div>
        </div>
      </div>
      <div class="about-grid">
        <span class="tag">Tauri 2</span>
        <span class="tag">Rust</span>
        <span class="tag">WebView2</span>
        <span class="tag">原生 ES Modules</span>
        <span class="tag">MIT License</span>
      </div>
      <div class="settings-actions">
        <button class="btn btn-sm btn-soft" type="button" data-url="${REPO_URL}">${icon(
    "github",
    15
  )}GitHub 仓库</button>
        <button class="btn btn-sm btn-soft" type="button" data-url="${BILIBILI_URL}">${icon(
    "external-link",
    15
  )}哔哩哔哩</button>
      </div>
      <p class="hint" style="margin-top:12px">本项目与哔哩哔哩官方无关，仅供学习与交流使用。视频版权归原作者及平台所有。</p>
    </section>
  </div>`;

  let disposed = false;
  const authHandler = () => {
    if (!disposed) ctx.refresh();
  };
  window.addEventListener("app:auth", authHandler);
  const unsubscribe = store.subscribe(() => {
    if (!disposed) syncControls();
  });

  const cleanup = () => {
    disposed = true;
    window.removeEventListener("app:auth", authHandler);
    unsubscribe();
  };

  const rangeLabel = (input) => {
    const scale = Number(input.dataset.scale) || 1;
    const raw = Number(input.value) / scale;
    const format = input.dataset.format;
    if (format === "percent") return `${Math.round(raw * 100)}%`;
    if (format === "px") return `${Math.round(raw)}px`;
    if (format === "plain") return `${Math.round(raw * 100) / 100}`;
    return `${raw}x`;
  };

  function syncControls() {
    root.querySelectorAll("[data-setting]").forEach((input) => {
      const key = input.dataset.setting;
      const value = store.get(key);
      if (input.type === "checkbox") {
        input.checked = Boolean(value);
      } else if (input.type === "range") {
        const scale = Number(input.dataset.scale) || 1;
        input.value = String(scale === 100 ? Math.round(Number(value) * 100) : value);
        const label = input.nextElementSibling;
        if (label?.hasAttribute("data-range-value")) label.textContent = rangeLabel(input);
      } else if (input.type === "number") {
        const scale = Number(input.dataset.scale) || 1;
        input.value = String(Math.round(Number(value) * scale * 100) / 100);
      } else {
        input.value = String(value);
      }
    });
    root
      .querySelectorAll("[data-theme-value]")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.themeValue === store.get("theme"))
      );
  }

  root.addEventListener("input", (event) => {
    const range = event.target.closest('input[type="range"][data-setting]');
    if (!range) return;
    const label = range.nextElementSibling;
    if (label?.hasAttribute("data-range-value")) label.textContent = rangeLabel(range);
  });

  root.addEventListener("change", (event) => {
    const input = event.target.closest("[data-setting]");
    if (!input) return;
    const key = input.dataset.setting;
    let value;
    if (input.type === "checkbox") {
      value = input.checked;
    } else if (input.type === "range") {
      const scale = Number(input.dataset.scale) || 1;
      value = Number(input.value) / scale;
    } else if (input.type === "number") {
      const scale = Number(input.dataset.scale) || 1;
      const raw = Number(input.value);
      if (!Number.isFinite(raw)) return;
      value = scale === 1 ? raw : raw / scale;
    } else if (input.dataset.number === "true") {
      value = Number(input.value);
    } else {
      value = input.value;
    }
    store.set(key, value);
  });

  root.querySelector("[data-theme-group]")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme-value]");
    if (!button) return;
    store.set("theme", button.dataset.themeValue);
  });

  const refreshKeywordList = (setting) => {
    const list = root.querySelector(`[data-kw-list="${setting}"]`);
    if (list) list.innerHTML = kwListHtml(setting);
  };

  const addKeywords = (setting) => {
    const input = root.querySelector(`[data-kw-input="${setting}"]`);
    const raw = String(input?.value || "").trim();
    if (!raw) return;
    const words = raw.split(/[,，;；\s]+/).filter(Boolean);
    const list = [...(store.get(setting) || [])];
    words.forEach((word) => {
      if (!list.includes(word)) list.push(word);
    });
    store.set(setting, list.slice(0, 30));
    if (input) input.value = "";
    refreshKeywordList(setting);
  };

  root.addEventListener("keydown", (event) => {
    const input = event.target.closest("[data-kw-input]");
    if (!input) return;
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      addKeywords(input.dataset.kwInput);
    }
  });

  root.addEventListener("click", (event) => {
    const add = event.target.closest("[data-kw-add]");
    if (add) {
      addKeywords(add.dataset.kwAdd);
      return;
    }
    const remove = event.target.closest("[data-kw-remove]");
    if (!remove) return;
    const setting = remove.dataset.kwRemove;
    const word = remove.dataset.kwWord;
    store.set(
      setting,
      (store.get(setting) || []).filter((item) => item !== word)
    );
    refreshKeywordList(setting);
  });

  root.querySelector("[data-login]")?.addEventListener("click", () => openLoginModal());

  root.querySelector("[data-logout]")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "退出登录",
      message: "退出后将无法同步历史、收藏与稍后再看。确定继续吗？",
      okText: "退出登录",
      danger: true,
    });
    if (!ok) return;
    try {
      await logoutUser();
      toast("已退出登录", "success");
    } catch (error) {
      toast(errorText(error), "error");
    }
  });

  root.querySelector("[data-refresh-user]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setButtonLoading(button, true);
    try {
      await refreshUser();
      toast("账号信息已更新", "success");
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      if (button.isConnected) setButtonLoading(button, false);
    }
  });

  root.querySelector("[data-clear-recent]")?.addEventListener("click", () => {
    store.clearRecentSearches();
    const counter = root.querySelector("[data-recent-count]");
    if (counter) counter.textContent = "0";
    toast("最近搜索已清除", "success");
  });

  root.querySelector("[data-reset]")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "恢复默认设置",
      message: "主题、播放、弹幕、音量、推荐流与音视频偏好都会恢复默认，确定继续吗？",
      okText: "恢复默认",
      danger: true,
    });
    if (!ok) return;
    store.resetPreferences();
    toast("已恢复默认设置", "success");
    ctx.refresh();
  });

  root.querySelectorAll("[data-url]").forEach((button) => {
    button.addEventListener("click", async () => {
      const ok = await openExternal(button.dataset.url);
      if (!ok) toast("无法打开浏览器", "error");
    });
  });

  appVersion()
    .then((version) => {
      if (disposed) return;
      const el = root.querySelector("[data-version]");
      if (el) el.textContent = `v${version}`;
    })
    .catch(() => {});

  syncControls();
  return cleanup;
}
