import {
  bilibiliSpaceUrl,
  followUser,
  openExternal,
  spaceDynamics,
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
  skeletonRows,
  toast,
  useRefreshFab,
  videoCard,
} from "../ui.js";
import { dynamicCardHtml, bindDynamicList } from "./dynamic.js";
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
  let dynamicLoader = null;

  const stopRefreshFab = useRefreshFab(() => ctx.refresh());

  const onAuth = () => {
    if (!disposed) ctx.refresh();
  };
  window.addEventListener("app:auth", onAuth);

  const cleanup = () => {
    disposed = true;
    loader?.remove();
    loader = null;
    dynamicLoader?.remove();
    dynamicLoader = null;
    window.removeEventListener("app:auth", onAuth);
    stopRefreshFab();
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

    <div class="tabs-line space-tabs" data-space-tabs>
      <button class="tab active" type="button" data-space-tab="video">
        ${icon("list-video", 15)}投稿 <span class="sub">${formatCount(total)}</span>
      </button>
      <button class="tab" type="button" data-space-tab="dynamic">${icon("activity", 15)}动态</button>
    </div>
    <div data-space-video></div>
    <div data-space-dynamic hidden></div>`;

  document.title = `${info.name || "用户空间"} - Bilibili-Tauri`;

  const videoPane = root.querySelector("[data-space-video]");
  const dynamicPane = root.querySelector("[data-space-dynamic]");
  const followBtn = root.querySelector("[data-follow]");

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

  let videoRendered = false;
  const renderVideo = () => {
    if (videoRendered) return;
    videoRendered = true;
    if (videoResult.status === "rejected") {
      videoPane.innerHTML = errorState(videoResult.reason, { title: "投稿加载失败" });
      videoPane.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
      return;
    }
    if (!videos.length) {
      videoPane.innerHTML = emptyState(
        "还没有投稿",
        "这位 UP 主暂时没有公开视频。",
        "",
        "list-video"
      );
      return;
    }
    const grid = document.createElement("div");
    grid.className = "video-grid";
    videoPane.append(grid);
    grid.innerHTML = videos.map(cardFor).join("");
    if (firstPage?.has_more) {
      let page = Number(firstPage.page) || 1;
      loader = createInfiniteLoader(videoPane, async () => {
        const data = await spaceVideos(mid, page + 1);
        if (disposed) return false;
        page = Number(data.page) || page + 1;
        grid.insertAdjacentHTML("beforeend", (data.items || []).map(cardFor).join(""));
        return Boolean(data.has_more);
      });
    }
  };

  let activeTab = ctx.query.get("tab") === "dynamic" ? "dynamic" : "video";
  let dynamicLoaded = false;

  const loadDynamic = async () => {
    if (dynamicLoaded) return;
    dynamicLoaded = true;
    dynamicLoader?.remove();
    dynamicLoader = null;
    dynamicPane.innerHTML = skeletonRows(4);
    try {
      const data = await spaceDynamics(mid, "");
      if (disposed || ctx.signal.aborted) return;
      const items = data.items || [];
      dynamicPane.innerHTML = "";
      if (!items.length) {
        dynamicPane.innerHTML = emptyState(
          "还没有动态",
          "这位 UP 主暂时没有公开动态。",
          "",
          "activity"
        );
        return;
      }
      const list = document.createElement("div");
      list.className = "dyn-list";
      list.innerHTML = items.map(dynamicCardHtml).join("");
      dynamicPane.append(list);
      bindDynamicList(list);
      let offset = String(data.offset || "");
      if (data.has_more && offset) {
        dynamicLoader = createInfiniteLoader(dynamicPane, async () => {
          const next = await spaceDynamics(mid, offset);
          if (disposed || ctx.signal.aborted) return false;
          offset = String(next.offset || "");
          list.insertAdjacentHTML("beforeend", (next.items || []).map(dynamicCardHtml).join(""));
          return Boolean(next.has_more) && Boolean(offset);
        });
      }
    } catch (error) {
      if (disposed) return;
      dynamicLoaded = false;
      dynamicPane.innerHTML = errorState(error);
      dynamicPane.querySelector("[data-retry]")?.addEventListener("click", () => loadDynamic());
    }
  };

  const setTab = (tab, { replace = true } = {}) => {
    activeTab = tab === "dynamic" ? "dynamic" : "video";
    videoPane.hidden = activeTab !== "video";
    dynamicPane.hidden = activeTab !== "dynamic";
    root.querySelectorAll("[data-space-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.spaceTab === activeTab);
    });
    if (replace) {
      history.replaceState(
        null,
        "",
        `#/space/${mid}${activeTab === "dynamic" ? "?tab=dynamic" : ""}`
      );
    }
    if (activeTab === "video") renderVideo();
    else loadDynamic();
  };

  root.querySelector("[data-space-tabs]")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-space-tab]");
    if (!button) return;
    setTab(button.dataset.spaceTab, { replace: true });
  });

  renderVideo();
  setTab(activeTab, { replace: false });

  return cleanup;
}
