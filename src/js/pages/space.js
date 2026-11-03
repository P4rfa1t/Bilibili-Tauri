import {
  bilibiliSpaceUrl,
  followUser,
  openExternal,
  spaceInfo,
  spaceVideos,
} from "../api.js";
import { icon } from "../icons.js";
import { ensureLogin } from "../login.js";
import { store } from "../store.js";
import {
  avatarTag,
  createInfiniteLoader,
  emptyState,
  errorState,
  skeletonGrid,
  toast,
  videoCard,
} from "../ui.js";
import {
  errorText,
  escapeHtml,
  formatCount,
  imgTag,
  isLoginError,
} from "../utils.js";

export async function render(root, ctx) {
  const mid = Number(ctx.params.mid) || 0;
  if (!mid) {
    root.innerHTML = errorState("用户 ID 无效", { retry: false });
    return () => {};
  }

  root.innerHTML = `
    <div class="skeleton" style="height:220px;border-radius:17px"></div>
    <div style="margin-top:22px">${skeletonGrid(12)}</div>`;

  let disposed = false;
  let loader = null;
  const onAuth = () => {
    if (!disposed) ctx.refresh();
  };
  window.addEventListener("app:auth", onAuth);

  const cleanup = () => {
    disposed = true;
    loader?.remove();
    loader = null;
    window.removeEventListener("app:auth", onAuth);
  };

  const [infoResult, videoResult] = await Promise.allSettled([
    spaceInfo(mid),
    spaceVideos(mid, 1),
  ]);
  if (disposed || ctx.signal.aborted) return cleanup;

  if (infoResult.status === "rejected") {
    root.innerHTML = errorState(infoResult.reason, { title: "用户空间加载失败" });
    root.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
    return cleanup;
  }

  const info = infoResult.value;
  const firstPage =
    videoResult.status === "fulfilled" ? videoResult.value : null;
  const videos = firstPage?.items || [];
  const total = Number(firstPage?.total) || Number(info.archive_count) || videos.length;
  const isSelf = Boolean(store.user && Number(store.user.mid) === mid);
  let followed = false;

  root.innerHTML = `
    <section class="space-hero">
      ${info.banner ? imgTag(info.banner, { w: 1600, h: 400, alt: "", className: "space-banner" }) : ""}
      <div class="space-hero-content">
        ${avatarTag(info.face, info.name, "space-avatar")}
        <div class="space-info">
          <div class="space-name">
            <span>${escapeHtml(info.name || "未知用户")}</span>
            ${info.level ? `<span class="level-badge">Lv${Number(info.level)}</span>` : ""}
          </div>
          <div class="space-sign">${escapeHtml(
            info.sign || "这个人很神秘，什么都没有写。"
          )}</div>
          <div class="space-stats">
            <span><b>${formatCount(info.fans)}</b> 粉丝</span>
            <span><b>${formatCount(info.following)}</b> 关注</span>
            <span><b>${formatCount(total)}</b> 投稿</span>
            ${Number(info.likes) ? `<span><b>${formatCount(info.likes)}</b> 获赞</span>` : ""}
            <span>UID ${mid}</span>
          </div>
        </div>
        <div class="space-actions">
          ${
            isSelf
              ? ""
              : `<button class="btn btn-primary" type="button" data-follow>${icon(
                  "plus",
                  15
                )}关注</button>`
          }
          <button class="btn btn-soft" type="button" data-external>${icon(
            "external-link",
            15
          )}在浏览器打开</button>
        </div>
      </div>
    </section>

    <div class="space-section-head">
      <h2>${icon("list-video", 18)}投稿 <span class="sub">共 ${formatCount(total)} 个视频</span></h2>
      <button class="btn btn-sm btn-outline" type="button" data-refresh>${icon(
        "refresh-cw",
        14
      )}刷新</button>
    </div>
    <div data-space-results></div>`;

  document.title = `${info.name || "用户空间"} - Bilibili-Tauri`;

  const results = root.querySelector("[data-space-results]");
  const followBtn = root.querySelector("[data-follow]");

  root.querySelector("[data-refresh]")?.addEventListener("click", () => ctx.refresh());
  root.querySelector("[data-external]")?.addEventListener("click", async () => {
    const ok = await openExternal(bilibiliSpaceUrl(mid));
    if (!ok) toast("无法打开浏览器", "error");
  });

  followBtn?.addEventListener("click", async () => {
    if (!ensureLogin("关注 UP 主需要先登录")) return;
    followBtn.disabled = true;
    try {
      await followUser(mid, !followed);
      followed = !followed;
      followBtn.classList.toggle("btn-primary", !followed);
      followBtn.classList.toggle("btn-soft", followed);
      followBtn.innerHTML = followed
        ? `${icon("check", 15)}已关注`
        : `${icon("plus", 15)}关注`;
      toast(followed ? "已关注" : "已取消关注", "success");
    } catch (error) {
      if (isLoginError(error)) ensureLogin("登录状态已失效，请重新登录");
      toast(errorText(error), "error");
    } finally {
      followBtn.disabled = false;
    }
  });

  if (videoResult.status === "rejected") {
    results.innerHTML = errorState(videoResult.reason, { title: "投稿加载失败" });
    results.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
    return cleanup;
  }

  if (!videos.length) {
    results.innerHTML = emptyState(
      "还没有投稿",
      "这位 UP 主暂时没有公开视频。",
      "",
      "list-video"
    );
    return cleanup;
  }

  const grid = document.createElement("div");
  grid.className = "video-grid";
  results.append(grid);

  const cardFor = (item) =>
    videoCard(
      {
        ...item,
        author: info.name,
        mid,
        pubdate: item.created,
      },
      { showDanmaku: true, showDate: true }
    );

  grid.innerHTML = videos.map(cardFor).join("");

  if (firstPage?.has_more) {
    let page = Number(firstPage.page) || 1;
    loader = createInfiniteLoader(results, async () => {
      const data = await spaceVideos(mid, page + 1);
      if (disposed) return false;
      page = Number(data.page) || page + 1;
      grid.insertAdjacentHTML("beforeend", (data.items || []).map(cardFor).join(""));
      return Boolean(data.has_more);
    });
  }

  return cleanup;
}
