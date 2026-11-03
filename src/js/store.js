/**
 * Tiny shared state store with localStorage persistence for preferences.
 * User session is kept in memory only; the backend persists cookies.
 */

const STORAGE_KEY = "bilibili-tauri:settings";

const DEFAULTS = {
  theme: "system",
  quality: 80,
  audioQuality: 30280,
  codecPreference: "auto",
  cdnPreference: "auto",
  noLogin1080: true,
  liveQuality: 250,
  liveCdnPreference: "auto",
  liveBufferSize: 4,
  liveLatency: 3,
  autoplay: true,
  resume: true,
  speed: 1,
  volume: 0.82,
  danmaku: true,
  danmakuOpacity: 0.9,
  danmakuSize: 25,
  danmakuSpeed: 8,
  danmakuArea: 0.75,
  recommendKeepRefresh: false,
  recommendLastSeen: true,
  recommendLastBvid: "",
  recommendFreshIdx: 1,
  likeRateMin: 0,
  titleFilters: [],
  partitionFilters: [],
  durationMin: 0,
  durationMax: 0,
  playMin: 0,
  exemptFollowed: true,
  filterRelated: true,
  sidebarCollapsed: false,
  recentSearches: [],
};

const state = {
  user: null,
  ...DEFAULTS,
};

const listeners = new Set();
let systemMedia = null;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeKeywords(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    ),
  ].slice(0, 30);
}

function sanitize(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return out;

  if (["light", "dark", "system"].includes(raw.theme)) out.theme = raw.theme;
  out.quality = [127, 126, 125, 120, 116, 112, 80, 74, 64, 32, 16].includes(
    Number(raw.quality)
  )
    ? Number(raw.quality)
    : DEFAULTS.quality;
  out.audioQuality = [30280, 30232, 30216].includes(Number(raw.audioQuality))
    ? Number(raw.audioQuality)
    : DEFAULTS.audioQuality;
  out.codecPreference = ["auto", "avc", "hevc", "av1"].includes(raw.codecPreference)
    ? raw.codecPreference
    : DEFAULTS.codecPreference;
  out.cdnPreference = ["auto", "backup"].includes(raw.cdnPreference)
    ? raw.cdnPreference
    : DEFAULTS.cdnPreference;
  out.noLogin1080 = raw.noLogin1080 !== false;
  out.liveQuality = [10000, 400, 250, 150, 80].includes(Number(raw.liveQuality))
    ? Number(raw.liveQuality)
    : DEFAULTS.liveQuality;
  out.liveCdnPreference = ["auto", "backup"].includes(raw.liveCdnPreference)
    ? raw.liveCdnPreference
    : DEFAULTS.liveCdnPreference;
  out.liveBufferSize = clampNumber(raw.liveBufferSize, 1, 16, DEFAULTS.liveBufferSize);
  out.liveLatency = clampNumber(raw.liveLatency, 1, 12, DEFAULTS.liveLatency);
  out.autoplay = raw.autoplay !== false;
  out.resume = raw.resume !== false;
  out.speed = clampNumber(raw.speed, 0.5, 2, DEFAULTS.speed);
  out.volume = clampNumber(raw.volume, 0, 1, DEFAULTS.volume);
  out.danmaku = raw.danmaku !== false;
  out.danmakuOpacity = clampNumber(raw.danmakuOpacity, 0.1, 1, DEFAULTS.danmakuOpacity);
  out.danmakuSize = clampNumber(raw.danmakuSize, 14, 40, DEFAULTS.danmakuSize);
  out.danmakuSpeed = clampNumber(raw.danmakuSpeed, 4, 14, DEFAULTS.danmakuSpeed);
  out.danmakuArea = clampNumber(raw.danmakuArea, 0.2, 1, DEFAULTS.danmakuArea);
  out.recommendKeepRefresh = raw.recommendKeepRefresh === true;
  out.recommendLastSeen = raw.recommendLastSeen !== false;
  out.recommendLastBvid =
    typeof raw.recommendLastBvid === "string" ? raw.recommendLastBvid.slice(0, 32) : "";
  out.recommendFreshIdx = Math.round(
    clampNumber(raw.recommendFreshIdx, 1, 9999, 1)
  );
  out.likeRateMin = clampNumber(raw.likeRateMin, 0, 0.5, 0);
  out.titleFilters = sanitizeKeywords(raw.titleFilters);
  out.partitionFilters = sanitizeKeywords(raw.partitionFilters);
  out.durationMin = clampNumber(raw.durationMin, 0, 7200, 0);
  out.durationMax = clampNumber(raw.durationMax, 0, 7200, 0);
  if (out.durationMax > 0 && out.durationMax < out.durationMin) {
    out.durationMax = out.durationMin;
  }
  out.playMin = clampNumber(raw.playMin, 0, 1_000_000_000, 0);
  out.exemptFollowed = raw.exemptFollowed !== false;
  out.filterRelated = raw.filterRelated !== false;
  out.sidebarCollapsed = raw.sidebarCollapsed === true;
  out.recentSearches = Array.isArray(raw.recentSearches)
    ? raw.recentSearches
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim())
        .slice(0, 10)
    : [];
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function persist() {
  try {
    const { user: _user, ...rest } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch (_) {
    /* quota or private mode: preferences are non-critical */
  }
}

function emit(detail) {
  listeners.forEach((fn) => {
    try {
      fn(state, detail);
    } catch (error) {
      console.error("store listener failed", error);
    }
  });
  window.dispatchEvent(new CustomEvent("app:store", { detail }));
}

export function resolveTheme(mode = state.theme) {
  if (mode === "light" || mode === "dark") return mode;
  if (systemMedia && systemMedia.matches) return "dark";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme() {
  const resolved = resolveTheme();
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#0f1115" : "#f6f7f9");
  window.dispatchEvent(
    new CustomEvent("app:theme", { detail: { mode: state.theme, resolved } })
  );
}

function watchSystem() {
  if (!window.matchMedia) return;
  try {
    systemMedia = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (state.theme === "system") applyTheme();
    };
    if (systemMedia.addEventListener) systemMedia.addEventListener("change", handler);
    else if (systemMedia.addListener) systemMedia.addListener(handler);
  } catch (_) {
    /* ignore */
  }
}

export const store = {
  get(key) {
    return state[key];
  },
  set(key, value) {
    if (key === "user") {
      this.setUser(value);
      return value;
    }
    state[key] = value;
    persist();
    if (key === "theme") applyTheme();
    emit({ key, value });
    return value;
  },
  patch(values) {
    Object.assign(state, values);
    persist();
    if (Object.prototype.hasOwnProperty.call(values, "theme")) applyTheme();
    emit({ patch: values });
  },
  resetPreferences() {
    Object.keys(DEFAULTS).forEach((key) => {
      state[key] = Array.isArray(DEFAULTS[key])
        ? [...DEFAULTS[key]]
        : DEFAULTS[key];
    });
    persist();
    applyTheme();
    emit({ reset: true });
  },
  get user() {
    return state.user;
  },
  setUser(user) {
    state.user = user && user.is_login ? user : null;
    emit({ user: state.user });
    window.dispatchEvent(new CustomEvent("app:auth", { detail: state.user }));
    return state.user;
  },
  isLoggedIn() {
    return Boolean(state.user && state.user.is_login);
  },
  addRecentSearch(keyword) {
    const word = String(keyword || "").trim();
    if (!word) return;
    const list = [word, ...state.recentSearches.filter((x) => x !== word)].slice(0, 10);
    state.recentSearches = list;
    persist();
    emit({ recentSearches: list });
  },
  removeRecentSearch(keyword) {
    state.recentSearches = state.recentSearches.filter((x) => x !== keyword);
    persist();
    emit({ recentSearches: state.recentSearches });
  },
  clearRecentSearches() {
    state.recentSearches = [];
    persist();
    emit({ recentSearches: [] });
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  defaults() {
    return { ...DEFAULTS };
  },
};

state.sidebarCollapsed = load().sidebarCollapsed;
Object.assign(state, load());
watchSystem();
applyTheme();

export function initSidebarState() {
  return state.sidebarCollapsed;
}
