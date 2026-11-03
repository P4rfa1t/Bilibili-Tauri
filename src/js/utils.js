/** Shared helpers used across pages and player. */

const TRANSPARENT =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="none"/></svg>'
  );

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const escapeAttr = escapeHtml;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function formatCount(value) {
  const n = Number(value) || 0;
  if (n >= 100_000_000) {
    return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, "")}亿`;
  }
  if (n >= 10_000) {
    return `${(n / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  }
  return String(Math.round(n));
}

export function formatNumber(value) {
  return (Number(value) || 0).toLocaleString("zh-CN");
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(m)}:${pad2(s)}`;
}

/** Parse a formatted duration (12:34 / 1:02:03) back into seconds. */
export function durationToSeconds(value) {
  if (typeof value === "number") return Math.max(0, Math.floor(value));
  const text = String(value || "").trim();
  if (!text) return 0;
  const parts = text.split(":").map((part) => Number(part) || 0);
  if (parts.length === 1) return Math.max(0, Math.floor(parts[0]));
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function formatDurationText(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

function toDate(ts) {
  const n = Number(ts) || 0;
  if (!n) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(ts, withTime = true) {
  const d = toDate(ts);
  if (!d) return "";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return withTime ? `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : date;
}

export function formatDateTimeFull(ts) {
  const d = toDate(ts);
  if (!d) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function dayKey(ts) {
  const d = toDate(ts);
  if (!d) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function dayLabel(ts) {
  const d = toDate(ts);
  if (!d) return "";
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start - target) / 86_400_000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff < 7) return `${diff} 天前`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function timeAgo(ts) {
  const d = toDate(ts);
  if (!d) return "";
  const diff = Math.max(0, Date.now() / 1000 - Number(ts));
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86_400 * 30) return `${Math.floor(diff / 86_400)} 天前`;
  return formatDate(ts, false);
}

export function debounce(fn, wait = 250) {
  let timer = 0;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function throttle(fn, wait = 120) {
  let last = 0;
  let timer = 0;
  return (...args) => {
    const now = Date.now();
    const remain = wait - (now - last);
    if (remain <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = 0;
        last = Date.now();
        fn(...args);
      }, remain);
    }
  };
}

export function normalizeUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("//")) return `https:${u}`;
  return u;
}

export function thumb(url, w = 480, h = 270) {
  const u = normalizeUrl(url);
  if (!u) return "";
  if (!/hdslb\.com/i.test(u) || u.includes("@")) return u;
  const [base, query] = u.split("?");
  return `${base}@${w}w_${h}h_1c.webp${query ? `?${query}` : ""}`;
}

export function avatarUrl(url, size = 96) {
  return thumb(url, size, size);
}

export function imgTag(
  url,
  { w = 480, h = 270, alt = "", className = "", eager = false, size = "" } = {}
) {
  const original = normalizeUrl(url);
  const src = original ? thumb(original, w, h) : TRANSPARENT;
  const style = size ? ` style="width:${size}px;height:${size}px"` : "";
  return `<img src="${escapeAttr(src)}" data-original="${escapeAttr(
    original
  )}" alt="${escapeAttr(alt)}" class="${escapeAttr(className)}" loading="${
    eager ? "eager" : "lazy"
  }" decoding="async" referrerpolicy="no-referrer"${style}>`;
}

export function avatarTag(url, name = "", className = "avatar avatar-md") {
  const src = avatarUrl(url, 96);
  if (!src) {
    return `<span class="${escapeAttr(className)} avatar-fallback">${iconFallback(
      name
    )}</span>`;
  }
  return `<img src="${escapeAttr(src)}" data-original="${escapeAttr(
    normalizeUrl(url)
  )}" alt="${escapeAttr(name)}" class="${escapeAttr(
    className
  )}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

function iconFallback(name) {
  return escapeHtml(String(name || "?").slice(0, 1).toUpperCase());
}

export function initialOf(name) {
  return String(name || "?").trim().slice(0, 1).toUpperCase();
}

export function highlight(text, keyword) {
  const source = String(text ?? "");
  const key = String(keyword ?? "").trim();
  if (!key) return escapeHtml(source);
  const lower = source.toLowerCase();
  const needle = key.toLowerCase();
  let from = 0;
  let out = "";
  while (from < source.length) {
    const at = lower.indexOf(needle, from);
    if (at === -1) {
      out += escapeHtml(source.slice(from));
      break;
    }
    out += escapeHtml(source.slice(from, at));
    out += `<mark class="hit">${escapeHtml(source.slice(at, at + key.length))}</mark>`;
    from = at + key.length;
  }
  return out;
}

export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }
}

export function errorText(error) {
  if (typeof error === "string") return error;
  if (error && typeof error.message === "string") return error.message;
  if (error && typeof error.error === "string") return error.error;
  try {
    return JSON.stringify(error);
  } catch (_) {
    return "未知错误";
  }
}

export function isLoginError(message) {
  const text = errorText(message);
  return (
    text.includes("请先登录") ||
    text.includes("登录状态已失效") ||
    text.includes("无法获取用户 ID") ||
    text.includes("账号未登录") ||
    text.includes("-101")
  );
}

export function isAbortError(error) {
  return error && (error.name === "AbortError" || error.code === 20);
}

export function reactionFor(progress, duration) {
  const p = Number(progress) || 0;
  const d = Number(duration) || 0;
  if (d <= 0) return 0;
  return clamp((p / d) * 100, 0, 100);
}

export function uid(prefix = "u") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomId(len = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function parseQuery(query) {
  return query instanceof URLSearchParams ? query : new URLSearchParams(query || "");
}

export function queryString(params) {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      sp.set(key, String(value));
    }
  });
  return sp.toString();
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function truncate(text, length = 80) {
  const s = String(text || "");
  return s.length > length ? `${s.slice(0, length)}…` : s;
}
