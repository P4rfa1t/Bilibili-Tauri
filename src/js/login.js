/** QR-code login flow and small auth helpers. */

import { loginState, logout, qrGenerate, qrPoll } from "./api.js";
import { store } from "./store.js";
import { openModal, toast } from "./ui.js";
import { errorText } from "./utils.js";

const POLL_MS = 2000;
let activeModal = null;

export async function refreshUser() {
  try {
    const user = await loginState();
    store.setUser(user);
    return store.user;
  } catch (error) {
    if (!store.isLoggedIn()) return null;
    throw error;
  }
}

export async function logoutUser() {
  await logout();
  store.setUser(null);
}

export function openLoginModal({ onSuccess = null } = {}) {
  if (activeModal) return activeModal;
  if (store.isLoggedIn()) {
    toast("你已经登录啦", "info");
    if (typeof onSuccess === "function") onSuccess(store.user);
    return null;
  }

  let stopped = false;
  let timer = 0;
  let key = "";
  let busy = false;

  let handle = null;
  handle = openModal({
    title: "扫码登录",
    small: true,
    body: `<div class="login-modal-body">
      <div class="qr-frame">
        <img alt="哔哩哔哩登录二维码" data-qr>
        <div class="qr-mask" data-mask>
          <span class="spinner"></span>
          <span data-mask-text>正在生成二维码…</span>
        </div>
      </div>
      <div class="login-title">扫描二维码登录</div>
      <div class="login-sub">打开哔哩哔哩手机客户端，使用“扫一扫”<br>登录后可同步历史、收藏与稍后再看</div>
      <div class="login-status" data-status>
        <span class="dot"></span>
        <span data-status-text>正在生成二维码…</span>
      </div>
    </div>`,
    onClose: () => {
      stopped = true;
      clearTimeout(timer);
      if (activeModal === handle) activeModal = null;
    },
  });
  const modal = handle;

  const img = modal.body.querySelector("[data-qr]");
  const mask = modal.body.querySelector("[data-mask]");
  const status = modal.body.querySelector("[data-status]");
  const statusText = modal.body.querySelector("[data-status-text]");

  const setStatus = (text, type = "") => {
    status.classList.remove("success", "error");
    if (type) status.classList.add(type);
    statusText.textContent = text;
  };

  const showMask = (text, { spinner = false, retry = false } = {}) => {
    mask.classList.remove("hidden");
    mask.innerHTML = `${spinner ? '<span class="spinner"></span>' : ""}<span>${text}</span>${
      retry ? '<button class="btn btn-sm btn-primary" type="button" data-refresh-qr>刷新二维码</button>' : ""
    }`;
  };

  const hideMask = () => mask.classList.add("hidden");

  const stopPolling = () => {
    stopped = true;
    clearTimeout(timer);
  };

  const succeed = async () => {
    stopPolling();
    showMask("登录成功");
    setStatus("登录成功，正在同步账号信息…", "success");
    try {
      await refreshUser();
    } catch (_) {
      /* cookie was persisted by the backend even if nav failed */
    }
    toast("登录成功", "success");
    if (modal.wrap.isConnected) {
      setTimeout(() => {
        if (modal.wrap.isConnected) modal.close();
      }, 850);
    }
    if (typeof onSuccess === "function") {
      try {
        onSuccess(store.user);
      } catch (error) {
        console.error("login callback failed", error);
      }
    }
  };

  const poll = async () => {
    if (stopped || !key) return;
    if (busy) {
      timer = setTimeout(poll, POLL_MS);
      return;
    }
    busy = true;
    try {
      const result = await qrPoll(key);
      if (stopped) return;
      const code = Number(result.status);
      if (code === 0) {
        await succeed();
        return;
      }
      if (code === 86038) {
        stopPolling();
        showMask("二维码已过期", { retry: true });
        setStatus("二维码已过期，请刷新后重试", "error");
        return;
      }
      if (code === 86090) {
        showMask("已扫码，请在手机上确认登录");
        setStatus("已扫码，请在手机上确认", "success");
      } else if (code === 86101) {
        hideMask();
        setStatus("等待扫码…");
      } else {
        hideMask();
        setStatus(result.message || "等待扫码…");
      }
    } catch (error) {
      if (stopped) return;
      hideMask();
      setStatus(`网络异常：${errorText(error)}`, "error");
    } finally {
      busy = false;
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    }
  };

  const generate = async () => {
    if (stopped) return;
    clearTimeout(timer);
    key = "";
    img.removeAttribute("src");
    showMask("正在生成二维码…", { spinner: true });
    setStatus("正在生成二维码…");
    try {
      const result = await qrGenerate();
      if (stopped) return;
      if (!result?.qr || !result?.key) throw new Error("二维码数据为空");
      key = result.key;
      img.src = result.qr;
      hideMask();
      setStatus("等待扫码…");
      timer = setTimeout(poll, 600);
    } catch (error) {
      if (stopped) return;
      showMask("二维码加载失败", { retry: true });
      setStatus(`二维码加载失败：${errorText(error)}`, "error");
    }
  };

  modal.body.addEventListener("click", (event) => {
    if (event.target.closest("[data-refresh-qr]")) {
      stopped = false;
      generate();
    }
  });

  activeModal = modal;
  generate();

  // Keep the handle available so callers can close it deliberately.
  modal.stop = stopPolling;
  return modal;
}

export function ensureLogin(message = "请先登录后再操作") {
  if (store.isLoggedIn()) return true;
  toast(message, "warning");
  openLoginModal();
  return false;
}
