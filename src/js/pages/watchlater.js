import { watchLater, watchLaterAdd } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import {
  confirmDialog,
  emptyState,
  errorState,
  loginRequiredHTML,
  pageHead,
  skeletonGrid,
  toast,
  useRefreshFab,
  videoCard,
} from "../ui.js";
import {
  durationToSeconds,
  errorText,
  isLoginError,
  reactionFor,
} from "../utils.js";

export async function render(root, ctx) {
  const onAuth = () => ctx.refresh();
  window.addEventListener("app:auth", onAuth);

  if (!store.isLoggedIn()) {
    root.innerHTML = `
      ${pageHead({
        title: "稍后再看",
        subtitle: "登录后把想看的视频集中到这里。",
      })}
      ${loginRequiredHTML("登录后即可使用稍后再看，随时继续未看完的视频。")}`;
    return () => window.removeEventListener("app:auth", onAuth);
  }

  root.innerHTML = `
    ${pageHead({
      title: "稍后再看",
      subtitle: "正在读取列表…",
    })}
    ${skeletonGrid(12)}`;

  let disposed = false;
  let count = 0;

  const stopRefreshFab = useRefreshFab(() => ctx.refresh());
  const cleanup = () => {
    disposed = true;
    stopRefreshFab();
    window.removeEventListener("app:auth", onAuth);
  };

  let items;
  try {
    items = await watchLater();
  } catch (error) {
    if (disposed || ctx.signal.aborted) return cleanup;
    root.innerHTML = `
      ${pageHead({ title: "稍后再看" })}
      ${
        isLoginError(error)
          ? loginRequiredHTML("登录状态已失效，请重新登录。")
          : errorState(error, { title: "稍后再看加载失败" })
      }`;
    root.querySelector("[data-retry]")?.addEventListener("click", () => ctx.refresh());
    return cleanup;
  }
  if (disposed || ctx.signal.aborted) return cleanup;

  items = [...items].sort((a, b) => (Number(b.add_at) || 0) - (Number(a.add_at) || 0));
  if (!items.length) {
    root.innerHTML = `
      ${pageHead({
        title: "稍后再看",
        subtitle: "还没有添加任何视频。",
      })}
      ${emptyState(
        "稍后再看是空的",
        "在视频页点击“稍后再看”，视频就会出现在这里。",
        `<a class="btn btn-primary" href="#/home">${icon("home", 15)}去首页看看</a>`,
        "clock"
      )}`;
    return cleanup;
  }

  count = items.length;
  const subtitle = () => `共 ${count} 个视频，按添加时间排序。`;

  const cardFor = (item) => {
    const seconds = durationToSeconds(item.duration);
    const percent = reactionFor(item.progress, seconds);
    return videoCard(item, {
      showDanmaku: false,
      showStat: false,
      showDate: false,
      progress: percent,
      startAt: item.progress,
      remove: true,
    });
  };

  root.innerHTML = `
    ${pageHead({
      title: "稍后再看",
      subtitle: subtitle(),
    })}
    <div class="video-grid" data-wl-grid>${items.map(cardFor).join("")}</div>`;

  const grid = root.querySelector("[data-wl-grid]");
  const subtitleEl = root.querySelector(".page-subtitle");

  const removeItem = async (button) => {
    const aid = Number(button.dataset.removeAid);
    if (!aid) return;
    const ok = await confirmDialog({
      title: "移出稍后再看",
      message: "确定将这条视频从稍后再看中移除吗？",
      okText: "移除",
      danger: true,
    });
    if (!ok || disposed) return;
    button.disabled = true;
    try {
      await watchLaterAdd(aid, false);
      button.closest(".video-card")?.remove();
      count = Math.max(0, count - 1);
      if (subtitleEl) subtitleEl.textContent = subtitle();
      toast("已移出稍后再看", "success");
      if (!grid.children.length) {
        root.innerHTML = `
          ${pageHead({ title: "稍后再看", subtitle: "还没有添加任何视频。" })}
          ${emptyState(
            "稍后再看是空的",
            "在视频页点击“稍后再看”，视频就会出现在这里。",
            `<a class="btn btn-primary" href="#/home">${icon("home", 15)}去首页看看</a>`,
            "clock"
          )}`;
      }
    } catch (error) {
      button.disabled = false;
      if (isLoginError(error)) {
        toast("登录状态已失效，请重新登录", "warning");
      }
      toast(errorText(error), "error");
    }
  };

  grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-aid]");
    if (button) {
      event.preventDefault();
      removeItem(button);
    }
  });

  return cleanup;
}
