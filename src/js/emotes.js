import { dynamicEmotes } from "./api.js";
import { escapeAttr, escapeHtml } from "./utils.js";

let packageCache = null;
let packageLoading = null;
let emoteMapCache = null;

export function loadEmotePackages() {
  if (packageCache) return Promise.resolve(packageCache);
  if (!packageLoading) {
    packageLoading = dynamicEmotes()
      .then((packages) => {
        packageCache = Array.isArray(packages) ? packages : [];
        emoteMapCache = null;
        return packageCache;
      })
      .catch((error) => {
        packageLoading = null;
        throw error;
      });
  }
  return packageLoading;
}

export function emoteMap() {
  if (emoteMapCache) return emoteMapCache;
  emoteMapCache = new Map();
  for (const pkg of packageCache || []) {
    for (const emote of pkg.emotes || []) {
      if (emote?.text && emote?.url) emoteMapCache.set(emote.text, emote.url);
    }
  }
  return emoteMapCache;
}

/** 把评论/弹幕里的 [表情] 文本替换成官方表情图片。 */
export function renderEmoteText(text) {
  const escaped = escapeHtml(text ?? "");
  const map = emoteMap();
  if (!map.size) return escaped;
  return escaped.replace(/\[[^\[\]]{1,24}\]/g, (code) =>
    map.has(code)
      ? `<img class="emote-inline" src="${escapeAttr(map.get(code))}" alt="${escapeAttr(
          code
        )}" title="${escapeAttr(code)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : code
  );
}

export function emoteImageHtml(emote) {
  return `<img class="emote-inline" src="${escapeAttr(emote.url)}" alt="${escapeAttr(
    emote.text
  )}" title="${escapeAttr(emote.text)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

let pickerSeq = 0;

/** 在一个容器里渲染「系列 tab + 表情网格」，选中时回调 emote。 */
export function mountEmotePicker(panel, onPick) {
  if (!panel) return;
  const token = ++pickerSeq;
  panel.dataset.pickerToken = String(token);
  panel.innerHTML = '<div class="emote-picker-loading"><span class="spinner"></span>正在加载表情…</div>';
  loadEmotePackages()
    .then((packages) => {
      if (panel.dataset.pickerToken !== String(token)) return;
      const valid = packages.filter((pkg) => (pkg.emotes || []).length);
      if (!valid.length) {
        panel.innerHTML = '<div class="emote-picker-loading">暂时没有可用表情</div>';
        return;
      }
      const tabs = valid
        .map(
          (pkg, index) =>
            `<button class="emote-tab${index === 0 ? " active" : ""}" type="button" data-emote-pkg="${index}">${escapeHtml(
              pkg.name || `表情 ${index + 1}`
            )}</button>`
        )
        .join("");
      const grid = (pkg) =>
        `<div class="emote-grid">${(pkg.emotes || [])
          .map(
            (emote) =>
              `<button class="emote-item" type="button" data-emote-index="${valid.indexOf(
                pkg
              )}" data-emote-code="${escapeAttr(emote.text)}" title="${escapeAttr(
                emote.text
              )}"><img src="${escapeAttr(emote.url)}" alt="${escapeAttr(
                emote.text
              )}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></button>`
          )
          .join("")}</div>`;
      panel.innerHTML = `<div class="emote-tabs">${tabs}</div><div class="emote-panel" data-emote-grid>${grid(
        valid[0]
      )}</div>`;
      const gridEl = panel.querySelector("[data-emote-grid]");
      panel.querySelector(".emote-tabs")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-emote-pkg]");
        if (!button) return;
        const index = Number(button.dataset.emotePkg) || 0;
        panel.querySelectorAll(".emote-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
        if (gridEl) gridEl.innerHTML = grid(valid[index]);
      });
      panel.querySelector("[data-emote-grid]")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-emote-code]");
        if (!button) return;
        const index = Number(button.dataset.emoteIndex) || 0;
        const code = button.dataset.emoteCode || "";
        const emote = (valid[index]?.emotes || []).find((item) => item.text === code);
        if (emote) onPick?.(emote);
      });
    })
    .catch((error) => {
      if (panel.dataset.pickerToken !== String(token)) return;
      panel.innerHTML = `<div class="emote-picker-loading">${escapeHtml(
        String(error?.message || error || "表情加载失败")
      )}</div>`;
    });
}
