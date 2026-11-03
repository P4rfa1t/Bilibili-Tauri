import {
  createFavoriteFolder,
  favoriteFolders,
  favoriteList,
  favoriteVideo,
} from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import {
  confirmDialog,
  createInfiniteLoader,
  emptyState,
  errorState,
  loginRequiredHTML,
  pageHead,
  promptDialog,
  skeletonGrid,
  toast,
  videoCard,
} from "../ui.js";
import {
  errorText,
  escapeHtml,
  formatCount,
  isLoginError,
} from "../utils.js";

function folderHtml(folder, active) {
  return `<a class="fav-folder${active ? " active" : ""}" href="#/favorites?fid=${
    folder.id
  }">
    ${icon("folder", 16)}
    <span class="fname">${escapeHtml(folder.title || "未命名收藏夹")}</span>
    <span class="fcount">${formatCount(folder.media_count)}</span>
  </a>`;
}

export async function render(root, ctx) {
  const onAuth = () => ctx.refresh();
  window.addEventListener("app:auth", onAuth);

  if (!store.isLoggedIn()) {
    root.innerHTML = `
      ${pageHead({
        title: "收藏夹",
        subtitle: "登录后查看你收藏的视频与收藏夹。",
      })}
      ${loginRequiredHTML("登录后即可查看收藏夹内容，并在视频页管理收藏。")}`;
    return () => window.removeEventListener("app:auth", onAuth);
  }

  root.innerHTML = skeletonGrid(12);

  let disposed = false;
  let loader = null;
  const cleanup = () => {
    disposed = true;
    loader?.remove();
    loader = null;
    window.removeEventListener("app:auth", onAuth);
  };

  let folders;
  try {
    folders = await favoriteFolders();
  } catch (error) {
    if (disposed || ctx.signal.aborted) return cleanup;
    root.innerHTML = isLoginError(error)
      ? `${pageHead({ title: "收藏夹" })}${loginRequiredHTML("登录状态已失效，请重新登录。")}`
      : `${pageHead({ title: "收藏夹" })}${errorState(error, { title: "收藏夹加载失败" })}`;
    root.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
    return cleanup;
  }
  if (disposed || ctx.signal.aborted) return cleanup;

  const createFolder = async () => {
    const title = await promptDialog({
      title: "新建收藏夹",
      label: "收藏夹名称",
      placeholder: "例如：稍后学习",
      okText: "创建",
      maxLength: 40,
    });
    if (!title || disposed) return;
    try {
      const id = await createFavoriteFolder(title);
      toast("收藏夹已创建", "success");
      if (id > 0) ctx.navigate(`/favorites?fid=${id}`);
      else ctx.refresh();
    } catch (error) {
      if (isLoginError(error)) ensureReLogin();
      toast(errorText(error), "error");
    }
  };

  const ensureReLogin = () => {
    toast("登录状态已失效，请重新登录", "warning");
  };

  if (!folders.length) {
    root.innerHTML = `
      ${pageHead({
        title: "收藏夹",
        subtitle: "创建你的第一个收藏夹，把喜欢的视频收进来。",
      })}
      ${emptyState(
        "还没有收藏夹",
        "在视频页点击收藏，或在 B 站创建收藏夹后刷新。",
        `<button class="btn btn-primary" type="button" data-new-folder>${icon(
          "plus",
          15
        )}新建收藏夹</button>`,
        "folder"
      )}`;
    root.querySelector("[data-new-folder]")?.addEventListener("click", createFolder);
    return cleanup;
  }

  const requested = Number(ctx.query.get("fid")) || 0;
  const selected = folders.find((folder) => Number(folder.id) === requested) || folders[0];
  let mediaTotal = Number(selected.media_count) || 0;

  root.innerHTML = `<div class="fav-layout">
    <aside class="fav-sidebar">
      <div class="fav-sidebar-head">
        <span>收藏夹</span>
        <button class="icon-btn" type="button" data-new-folder title="新建收藏夹" aria-label="新建收藏夹">
          ${icon("plus", 17)}
        </button>
      </div>
      ${folders.map((folder) => folderHtml(folder, folder.id === selected.id)).join("")}
    </aside>
    <section class="fav-main">
      <div class="fav-main-head">
        <div>
          <h1 class="fav-main-title">${escapeHtml(selected.title || "未命名收藏夹")}</h1>
          <div class="fav-main-sub" data-fav-sub>正在读取收藏内容…</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-sm btn-outline" type="button" data-new-folder>
            ${icon("plus", 14)}新建收藏夹
          </button>
        </div>
      </div>
      <div data-fav-results>${skeletonGrid(8)}</div>
    </section>
  </div>`;

  const results = root.querySelector("[data-fav-results]");
  const sub = root.querySelector("[data-fav-sub]");
  root.querySelectorAll("[data-new-folder]").forEach((button) => {
    button.addEventListener("click", createFolder);
  });

  const updateSub = () => {
    if (sub) sub.textContent = `共 ${formatCount(mediaTotal)} 个内容，按收藏时间排序。`;
  };

  const gridFor = (items) => {
    const grid = document.createElement("div");
    grid.className = "video-grid";
    grid.innerHTML = items
      .map((item) =>
        videoCard(
          { ...item, danmaku: 0 },
          { showDanmaku: false, showStat: true, remove: true }
        )
      )
      .join("");
    return grid;
  };

  let grid = null;
  let page = 0;

  const removeItem = async (button) => {
    const aid = Number(button.dataset.removeAid);
    if (!aid) return;
    const ok = await confirmDialog({
      title: "取消收藏",
      message: "确定将这条视频从当前收藏夹移除吗？",
      okText: "移除",
      danger: true,
    });
    if (!ok || disposed) return;
    button.disabled = true;
    try {
      await favoriteVideo(aid, [], [selected.id]);
      button.closest(".video-card")?.remove();
      mediaTotal = Math.max(0, mediaTotal - 1);
      const folderCount = root.querySelector(
        `.fav-folder[href="#/favorites?fid=${selected.id}"] .fcount`
      );
      if (folderCount) folderCount.textContent = formatCount(mediaTotal);
      updateSub();
      toast("已取消收藏", "success");
      if (grid && !grid.children.length && !loader) {
        results.innerHTML = emptyState(
          "这个收藏夹还是空的",
          "在视频页点击收藏即可添加内容。",
          "",
          "folder"
        );
      }
    } catch (error) {
      button.disabled = false;
      if (isLoginError(error)) ensureReLogin();
      toast(errorText(error), "error");
    }
  };

  results.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-aid]");
    if (button) {
      event.preventDefault();
      removeItem(button);
    }
  });

  try {
    const data = await favoriteList(selected.id, 1);
    if (disposed || ctx.signal.aborted) return cleanup;
    page = Number(data.page) || 1;
    mediaTotal = Number(data.total) || mediaTotal;
    updateSub();
    results.innerHTML = "";
    const items = data.items || [];
    if (!items.length) {
      results.innerHTML = emptyState(
        "这个收藏夹还是空的",
        "在视频页点击收藏即可添加内容。",
        "",
        "folder"
      );
      return cleanup;
    }
    grid = gridFor(items);
    results.append(grid);
    if (data.has_more) {
      loader = createInfiniteLoader(results, async () => {
        const next = await favoriteList(selected.id, page + 1);
        if (disposed) return false;
        page = Number(next.page) || page + 1;
        if (next.total) {
          mediaTotal = Number(next.total);
          updateSub();
        }
        grid.insertAdjacentHTML(
          "beforeend",
          (next.items || [])
            .map((item) =>
              videoCard(
                { ...item, danmaku: 0 },
                { showDanmaku: false, showStat: true, remove: true }
              )
            )
            .join("")
        );
        return Boolean(next.has_more);
      });
    }
  } catch (error) {
    if (disposed || ctx.signal.aborted) return cleanup;
    if (isLoginError(error)) {
      results.innerHTML = loginRequiredHTML("登录状态已失效，请重新登录。");
      if (sub) sub.textContent = "需要重新登录";
    } else {
      results.innerHTML = errorState(error, { title: "收藏内容加载失败" });
      results.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
      if (sub) sub.textContent = "加载失败";
    }
  }

  return cleanup;
}
