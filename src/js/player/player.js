/**
 * DASH player built on a plain <video> + <audio> pair.
 *
 * The backend rewrites every CDN URL to a local 127.0.0.1 proxy that adds the
 * Referer header and forwards Range requests, so the native WebView2 media
 * pipeline can seek normally.
 */

import { icon } from "../icons.js";
import { store } from "../store.js";
import { SPEED_OPTIONS } from "../constants.js";
import { clamp, escapeHtml, formatDuration, errorText } from "../utils.js";
import { DanmakuEngine } from "./danmaku.js";

const IDLE_MS = 2600;
const REPORT_MS = 15_000;

function qualityShort(label, quality) {
  const text = String(label || "");
  const match = text.match(/^(\d+P)/);
  if (match) return match[1];
  if (/8K/i.test(text)) return "8K";
  if (/4K/i.test(text)) return "4K";
  if (/HDR/i.test(text)) return "HDR";
  if (/杜比/.test(text)) return "杜比";
  return text || `${quality}P`;
}

export class Player {
  constructor(mount, options = {}) {
    this.mount = mount;
    this.options = options;
    this.root = null;
    this.video = null;
    this.audio = null;
    this.danmaku = null;

    this.streams = [];
    this.stream = null;
    this.info = null;
    this.hasAudio = false;
    this.videoBackups = [];
    this.audioBackups = [];
    this.backupTries = 0;

    this.preferredQuality = Number(options.quality ?? store.get("quality")) || 80;
    this.volume = clamp(Number(store.get("volume")) || 0.82, 0, 1);
    this.muted = false;
    this.danmakuEnabled = store.get("danmaku") !== false;

    this.subtitleTracks = [];
    this.subtitleLoader = null;
    this.activeSubtitle = "";
    this.cues = [];

    this.popup = null;
    this.popupAnchor = null;
    this.settingsPanel = null;

    this.destroyed = false;
    this.errorVisible = false;
    this.isDragging = false;
    this.idleTimer = 0;
    this.toastTimer = 0;
    this.lastReportAt = 0;
    this.pendingStart = null;
    this.pendingAutoplay = false;

    this.build();
    this.bind();
    mount.replaceChildren(this.root);

    this.danmaku = new DanmakuEngine(this.root.querySelector(".danmaku-canvas"), {
      getTime: () => this.video.currentTime,
    });
    this.configureDanmaku();

    this.video.playbackRate = Number(store.get("speed")) || 1;
    this.applyVolume();
    this.updateDanmakuButton();
    this.updatePlayIcons();
  }

  // ---------------------------------------------------------------- markup

  build() {
    const root = document.createElement("div");
    root.className = "player";
    root.tabIndex = 0;
    root.innerHTML = `
      <div class="player-stage">
        <video class="player-video" playsinline preload="auto"></video>
        <audio class="player-audio" preload="auto"></audio>
        <canvas class="danmaku-canvas"></canvas>
        <div class="subtitle-layer"></div>
      </div>
      <div class="player-top"><div class="pt-title"></div></div>
      <button class="player-bigplay" type="button" data-act="play" aria-label="播放">
        ${icon("play", 30)}
      </button>
      <div class="player-loading hidden"><span class="spinner"></span></div>
      <div class="player-error hidden"></div>
      <div class="player-toast hidden"></div>
      <div class="player-controls">
        <div class="progress" data-progress role="slider" aria-label="播放进度" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
          <div class="progress-track">
            <div class="progress-buffer"></div>
            <div class="progress-played"></div>
          </div>
          <div class="progress-thumb"></div>
          <div class="progress-tooltip">00:00</div>
        </div>
        <div class="controls-row">
          <button class="pbtn" type="button" data-act="play" title="播放 / 暂停 (空格)" aria-label="播放或暂停">${icon(
            "play",
            19
          )}</button>
          <button class="pbtn" type="button" data-act="back" title="快退 10 秒 (J)" aria-label="快退 10 秒">${icon(
            "rotate-ccw",
            19
          )}</button>
          <button class="pbtn" type="button" data-act="forward" title="快进 10 秒 (L)" aria-label="快进 10 秒">${icon(
            "refresh-cw",
            19
          )}</button>
          <span class="player-time">
            <span class="current">00:00</span><span class="sep">/</span><span class="duration">00:00</span>
          </span>
          <span class="controls-spacer"></span>
          <button class="pbtn" type="button" data-act="danmaku" title="弹幕开关 (D)" aria-label="弹幕开关">${icon(
            "message-square",
            19
          )}</button>
          <button class="pbtn hidden" type="button" data-act="captions" title="字幕 (C)" aria-label="字幕">${icon(
            "captions",
            19
          )}</button>
          <div class="pmenu-wrap">
            <button class="pbtn" type="button" data-act="settings" title="播放设置" aria-label="播放设置">${icon(
              "settings-2",
              19
            )}</button>
          </div>
          <button class="pbtn text" type="button" data-act="speed" title="播放速度"><span class="pbtn-label">1x</span></button>
          <button class="pbtn text" type="button" data-act="quality" title="清晰度"><span class="pbtn-label">1080P</span></button>
          <div class="volume-group">
            <button class="pbtn" type="button" data-act="mute" title="静音 (M)" aria-label="静音">${icon(
              "volume-2",
              19
            )}</button>
            <div class="volume-slider">
              <input type="range" min="0" max="1" step="0.01" value="${this.volume}" data-volume aria-label="音量">
            </div>
          </div>
          <button class="pbtn" type="button" data-act="fullscreen" title="全屏 (F)" aria-label="全屏">${icon(
            "maximize",
            19
          )}</button>
        </div>
      </div>`;

    this.root = root;
    this.video = root.querySelector(".player-video");
    this.audio = root.querySelector(".player-audio");
    this.progress = root.querySelector("[data-progress]");
    this.progressBuffer = root.querySelector(".progress-buffer");
    this.progressPlayed = root.querySelector(".progress-played");
    this.progressThumb = root.querySelector(".progress-thumb");
    this.progressTooltip = root.querySelector(".progress-tooltip");
    this.timeCurrent = root.querySelector(".player-time .current");
    this.timeDuration = root.querySelector(".player-time .duration");
    this.playBtn = root.querySelector('.controls-row [data-act="play"]');
    this.bigPlay = root.querySelector(".player-bigplay");
    this.loadingEl = root.querySelector(".player-loading");
    this.errorEl = root.querySelector(".player-error");
    this.toastEl = root.querySelector(".player-toast");
    this.danmakuBtn = root.querySelector('[data-act="danmaku"]');
    this.captionsBtn = root.querySelector('[data-act="captions"]');
    this.settingsBtn = root.querySelector('[data-act="settings"]');
    this.speedBtn = root.querySelector('[data-act="speed"] .pbtn-label');
    this.qualityBtn = root.querySelector('[data-act="quality"] .pbtn-label');
    this.volumeBtn = root.querySelector('[data-act="mute"]');
    this.volumeInput = root.querySelector("[data-volume]");
    this.fullscreenBtn = root.querySelector('[data-act="fullscreen"]');
    this.subtitleEl = root.querySelector(".subtitle-layer");
    this.topTitle = root.querySelector(".pt-title");
    this.updateSpeedLabel();
  }

  // --------------------------------------------------------------- binding

  bind() {
    this.onDocPointer = (event) => {
      if (!this.popup && !this.settingsPanel) return;
      if (this.popup?.contains(event.target) || this.settingsPanel?.contains(event.target)) return;
      if (this.popupAnchor?.contains(event.target) || this.settingsBtn.contains(event.target)) return;
      this.closeFloating();
    };
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.onFullscreenChange = () => this.updateFullscreenState();
    this.onVideoTime = () => this.handleTimeUpdate();
    this.onVideoPlay = () => this.handleVideoPlay();
    this.onVideoPause = () => this.handleVideoPause();
    this.onVideoEnded = () => this.handleEnded();
    this.onVideoError = () => this.handleVideoError();
    this.onAudioError = () => this.handleAudioError();
    this.onVideoSeeking = () => {
      this.danmaku?.seek(this.video.currentTime);
      this.syncAudio(true);
    };
    this.onVideoRate = () => {
      this.audio.playbackRate = this.video.playbackRate;
    };
    this.onVideoMeta = () => this.handleMetadata();
    this.onAudioMeta = () => {
      if (this.hasAudio) this.syncAudio(true);
    };
    this.onVideoProgress = () => this.updateBuffer();
    this.onVideoCanPlay = () => this.hideLoading();
    this.onVideoLoadedData = () => this.hideLoading();
    this.onVideoWaiting = () => {
      if (!this.video.paused) this.showLoading();
    };

    this.root.addEventListener("pointermove", () => this.resetIdle());
    this.root.addEventListener("pointerdown", () => this.resetIdle());
    this.root.addEventListener("dblclick", (event) => {
      if (this.isControlTarget(event.target)) return;
      this.toggleFullscreen();
    });
    this.root.addEventListener("click", (event) => {
      if (this.isControlTarget(event.target)) return;
      this.togglePlay();
    });

    this.root.querySelectorAll('[data-act="play"]').forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.togglePlay();
      });
    });
    this.root.querySelector('[data-act="back"]').addEventListener("click", () => this.seekBy(-10));
    this.root.querySelector('[data-act="forward"]').addEventListener("click", () => this.seekBy(10));
    this.danmakuBtn.addEventListener("click", () => this.toggleDanmaku());
    this.captionsBtn.addEventListener("click", () => this.openSubtitleMenu());
    this.settingsBtn.addEventListener("click", () => this.toggleSettings());
    this.root.querySelector('[data-act="speed"]').addEventListener("click", () => this.openSpeedMenu());
    this.root.querySelector('[data-act="quality"]').addEventListener("click", () => this.openQualityMenu());
    this.volumeBtn.addEventListener("click", () => this.toggleMute());
    this.fullscreenBtn.addEventListener("click", () => this.toggleFullscreen());
    this.volumeInput.addEventListener("input", () => {
      this.setVolume(Number(this.volumeInput.value), false);
    });
    this.volumeInput.addEventListener("change", () => {
      store.set("volume", this.volume);
    });

    this.video.addEventListener("loadedmetadata", this.onVideoMeta);
    this.video.addEventListener("timeupdate", this.onVideoTime);
    this.video.addEventListener("play", this.onVideoPlay);
    this.video.addEventListener("pause", this.onVideoPause);
    this.video.addEventListener("ended", this.onVideoEnded);
    this.video.addEventListener("error", this.onVideoError);
    this.video.addEventListener("seeking", this.onVideoSeeking);
    this.video.addEventListener("ratechange", this.onVideoRate);
    this.video.addEventListener("progress", this.onVideoProgress);
    this.video.addEventListener("canplay", this.onVideoCanPlay);
    this.video.addEventListener("loadeddata", this.onVideoLoadedData);
    this.video.addEventListener("waiting", this.onVideoWaiting);
    this.audio.addEventListener("error", this.onAudioError);
    this.audio.addEventListener("loadedmetadata", this.onAudioMeta);
    this.audio.addEventListener("ended", () => {
      if (this.hasAudio && !this.video.ended) this.syncAudio(true);
    });

    this.bindProgress();

    document.addEventListener("pointerdown", this.onDocPointer, true);
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    window.addEventListener("keydown", this.onKeyDown);
  }

  bindProgress() {
    const ratioAt = (event) => {
      const rect = this.progress.getBoundingClientRect();
      if (!rect.width) return 0;
      return clamp((event.clientX - rect.left) / rect.width, 0, 1);
    };

    const preview = (event) => {
      const duration = Number(this.video.duration) || 0;
      if (duration <= 0) return;
      const ratio = ratioAt(event);
      const time = ratio * duration;
      const percent = (ratio * 100).toFixed(3);
      this.progressPlayed.style.width = `${percent}%`;
      this.progressThumb.style.left = `${percent}%`;
      this.progressTooltip.style.left = `${percent}%`;
      this.progressTooltip.textContent = formatDuration(time);
    };

    this.progress.addEventListener("pointerdown", (event) => {
      if (!Number(this.video.duration)) return;
      event.preventDefault();
      this.isDragging = true;
      this.root.classList.add("is-dragging");
      this.resetIdle();
      try {
        this.progress.setPointerCapture(event.pointerId);
      } catch (_) {
        /* pointer capture is best-effort */
      }
      preview(event);
    });

    this.progress.addEventListener("pointermove", (event) => {
      if (this.isDragging) preview(event);
    });

    const finish = (event) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.root.classList.remove("is-dragging");
      const duration = Number(this.video.duration) || 0;
      if (duration > 0) this.seek(ratioAt(event) * duration);
      try {
        this.progress.releasePointerCapture(event.pointerId);
      } catch (_) {
        /* ignore */
      }
      this.resetIdle();
    };

    this.progress.addEventListener("pointerup", finish);
    this.progress.addEventListener("pointercancel", finish);
  }

  isControlTarget(target) {
    return Boolean(
      target.closest(
        "button, input, select, textarea, a, .progress, .player-menu, .player-settings, .player-controls"
      )
    );
  }

  // -------------------------------------------------------------- sources

  setSource(info, { title = "", startTime = 0, autoplay = undefined } = {}) {
    if (!info || !Array.isArray(info.streams) || !info.streams.length) {
      this.showError("没有获取到可播放的视频流。");
      return false;
    }
    this.info = info;
    this.streams = [...info.streams].sort((a, b) => b.quality - a.quality);
    if (title) this.setTitle(title);
    const stream = this.chooseStream(this.preferredQuality);
    if (!stream) {
      this.showError("没有获取到可播放的视频流。");
      return false;
    }
    const auto = autoplay === undefined ? store.get("autoplay") !== false : Boolean(autoplay);
    this.applyStream(stream, { startTime, autoplay: auto });
    this.updateQualityLabel();
    return true;
  }

  chooseStream(preferred) {
    const list = this.streams;
    if (!list.length) return null;
    const exact = list.find((stream) => stream.quality === Number(preferred));
    if (exact) return exact;
    const lower = list.find((stream) => stream.quality <= Number(preferred));
    return lower || list[0];
  }

  applyStream(stream, { startTime = 0, autoplay = false } = {}) {
    if (!stream?.video_url) {
      this.showError("视频地址无效。");
      return;
    }
    this.stream = stream;
    this.videoBackups = Array.isArray(stream.video_backups) ? [...stream.video_backups] : [];
    this.audioBackups = Array.isArray(stream.audio_backups) ? [...stream.audio_backups] : [];
    this.backupTries = 0;
    this.hasAudio = Boolean(stream.audio_url);
    this.pendingStart = Math.max(0, Number(startTime) || 0);
    this.pendingAutoplay = Boolean(autoplay);
    this.lastReportAt = 0;
    this.clearError();
    this.showLoading();
    this.updateQualityLabel();
    this.updateSubtitle("");

    this.video.pause();
    this.audio.pause();

    if (this.hasAudio) {
      this.audio.src = stream.audio_url;
      this.audio.load();
    } else {
      this.audio.removeAttribute("src");
      this.audio.load();
    }

    this.applyVolume();
    this.video.src = stream.video_url;
    this.video.load();
  }

  handleMetadata() {
    if (this.destroyed) return;
    this.hideLoading();
    const duration = Number(this.video.duration) || 0;
    if (this.pendingStart && this.pendingStart > 0.2) {
      const start = clamp(this.pendingStart, 0, Math.max(0, duration - 0.4));
      try {
        this.video.currentTime = start;
      } catch (_) {
        /* ignore */
      }
      this.syncAudio(true);
      this.danmaku?.seek(start);
    }
    this.pendingStart = null;
    this.updateDuration();
    this.updateProgressUI();
    const wantPlay = this.pendingAutoplay;
    this.pendingAutoplay = false;
    if (wantPlay) this.play();
    else {
      this.video.pause();
      this.updatePlayIcons();
      if (this.stream) this.bigPlay.classList.remove("hidden");
    }
  }

  /** Public: switch quality without asking the backend again. */
  setQuality(quality) {
    const next = this.streams.find((stream) => stream.quality === Number(quality));
    if (!next || next === this.stream) {
      this.updateQualityLabel();
      return;
    }
    const time = this.video.currentTime;
    const playing = !this.video.paused;
    this.preferredQuality = next.quality;
    store.set("quality", next.quality);
    this.applyStream(next, { startTime: time, autoplay: playing });
  }

  setPlaybackRate(rate) {
    const value = clamp(Number(rate) || 1, 0.25, 3);
    this.video.playbackRate = value;
    this.audio.playbackRate = value;
    store.set("speed", value);
    this.updateSpeedLabel();
    this.showToast(`播放速度 ${value}x`);
  }

  setVolume(value, persist = true) {
    this.volume = clamp(Number(value) || 0, 0, 1);
    if (this.volume > 0) this.muted = false;
    this.applyVolume();
    if (this.volumeInput) this.volumeInput.value = String(this.volume);
    if (persist) store.set("volume", this.volume);
    this.updateVolumeIcon();
  }

  applyVolume() {
    this.video.volume = this.volume;
    this.audio.volume = this.volume;
    this.audio.muted = this.muted;
    this.video.muted = this.hasAudio ? true : this.muted;
    this.updateVolumeIcon();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (!this.muted && this.volume <= 0) this.volume = 0.5;
    this.applyVolume();
    if (this.volumeInput) this.volumeInput.value = String(this.volume);
    this.showToast(this.muted ? "已静音" : `音量 ${Math.round(this.volume * 100)}%`);
  }

  updateVolumeIcon() {
    if (!this.volumeBtn) return;
    const muted = this.muted || this.volume <= 0.001;
    const name = muted ? "volume-x" : this.volume < 0.5 ? "volume-1" : "volume-2";
    this.volumeBtn.innerHTML = icon(name, 19);
    this.volumeBtn.title = muted ? "取消静音 (M)" : "静音 (M)";
  }

  updateSpeedLabel() {
    if (this.speedBtn) {
      const rate = Number(this.video?.playbackRate) || Number(store.get("speed")) || 1;
      this.speedBtn.textContent = `${rate}x`;
    }
  }

  updateQualityLabel() {
    if (this.qualityBtn) {
      const stream = this.stream;
      this.qualityBtn.textContent = stream
        ? qualityShort(stream.label, stream.quality)
        : qualityShort("", this.preferredQuality);
      this.qualityBtn.title = stream?.label || "清晰度";
    }
  }

  // --------------------------------------------------------------- play

  play() {
    if (!this.stream || this.destroyed) return;
    this.clearError();
    const promise = this.video.play();
    if (this.hasAudio) {
      try {
        this.syncAudio(true);
        this.audio.play().catch(() => {});
      } catch (_) {
        /* audio will be corrected by timeupdate */
      }
    }
    if (promise && typeof promise.catch === "function") {
      promise.catch((error) => {
        if (error?.name === "NotAllowedError") {
          this.showToast("点击播放按钮开始播放");
        } else if (error?.name !== "AbortError") {
          this.showError(errorText(error));
        }
        this.updatePlayIcons();
      });
    }
    this.resetIdle();
  }

  pause() {
    this.video.pause();
    this.audio.pause();
    clearTimeout(this.idleTimer);
    this.root.classList.remove("idle");
    this.updatePlayIcons();
  }

  togglePlay() {
    if (!this.stream) {
      this.showToast("视频还在加载中…");
      return;
    }
    if (this.video.paused) this.play();
    else this.pause();
  }

  seek(time) {
    const duration = Number(this.video.duration) || 0;
    const target = clamp(Number(time) || 0, 0, duration > 0 ? duration : Number(time) || 0);
    try {
      this.video.currentTime = target;
    } catch (_) {
      /* ignore */
    }
    this.syncAudio(true);
    this.danmaku?.seek(target);
    this.updateProgressUI(target);
  }

  seekBy(delta) {
    if (!this.stream) return;
    const target = clamp(
      (Number(this.video.currentTime) || 0) + delta,
      0,
      Number(this.video.duration) || 0
    );
    this.seek(target);
    this.showToast(`${delta > 0 ? "快进" : "快退"} ${Math.abs(delta)} 秒`);
  }

  syncAudio(force = false) {
    if (!this.hasAudio || !this.audio.src) return;
    const drift = Math.abs((Number(this.audio.currentTime) || 0) - (Number(this.video.currentTime) || 0));
    if (force || drift > 0.35) {
      try {
        this.audio.currentTime = Number(this.video.currentTime) || 0;
      } catch (_) {
        /* metadata may not be ready yet */
      }
    }
    this.audio.playbackRate = this.video.playbackRate;
    if (!this.video.paused && this.audio.paused) {
      this.audio.play().catch(() => {});
    }
  }

  handleVideoPlay() {
    this.hideLoading();
    this.updatePlayIcons();
    this.bigPlay.classList.add("hidden");
    this.syncAudio(true);
    this.resetIdle();
  }

  handleVideoPause() {
    this.audio.pause();
    this.updatePlayIcons();
    clearTimeout(this.idleTimer);
    this.root.classList.remove("idle");
    if (!this.video.ended && !this.errorVisible && this.stream) {
      this.bigPlay.classList.remove("hidden");
    }
  }

  handleEnded() {
    this.audio.pause();
    this.updatePlayIcons();
    this.bigPlay.classList.remove("hidden");
    this.root.classList.remove("idle");
    if (typeof this.options.onEnded === "function") {
      try {
        this.options.onEnded();
      } catch (error) {
        console.error("player ended handler failed", error);
      }
    }
  }

  handleTimeUpdate() {
    this.updateProgressUI();
    this.updateSubtitleByTime();

    if (this.hasAudio && !this.video.paused) {
      const drift = Math.abs(this.audio.currentTime - this.video.currentTime);
      if (drift > 0.4) this.syncAudio(true);
    }

    if (
      !this.video.paused &&
      typeof this.options.onProgress === "function" &&
      this.video.currentTime > 2
    ) {
      const now = Date.now();
      if (now - this.lastReportAt >= REPORT_MS) {
        this.lastReportAt = now;
        try {
          this.options.onProgress(this.video.currentTime, Number(this.video.duration) || 0);
        } catch (error) {
          console.error("progress callback failed", error);
        }
      }
    }

    if (
      typeof this.options.onTime === "function" &&
      Number.isFinite(this.video.currentTime)
    ) {
      try {
        this.options.onTime(this.video.currentTime);
      } catch (_) {
        /* ignore */
      }
    }
  }

  handleVideoError() {
    if (!this.stream || this.destroyed) return;
    const wasPlaying =
      this.pendingAutoplay || (!this.video.paused && this.video.currentTime > 0);
    if (this.videoBackups.length && this.backupTries < 3) {
      const next = this.videoBackups.shift();
      this.backupTries += 1;
      const time = this.video.currentTime;
      this.showToast("正在尝试备用线路…");
      this.video.src = next;
      this.video.load();
      this.pendingStart = time;
      this.pendingAutoplay = wasPlaying;
      return;
    }
    this.showError(
      "视频加载失败。可能是网络中断、CDN 限制或版权原因。",
      () => this.applyStream(this.stream, { startTime: this.video.currentTime, autoplay: true })
    );
  }

  handleAudioError() {
    if (!this.hasAudio || this.destroyed) return;
    if (this.audioBackups.length) {
      const next = this.audioBackups.shift();
      this.showToast("正在切换备用音频线路…");
      const time = this.video.currentTime;
      this.audio.src = next;
      try {
        this.audio.currentTime = time;
      } catch (_) {
        /* metadata not ready */
      }
      if (!this.video.paused) this.audio.play().catch(() => {});
      return;
    }
    this.hasAudio = false;
    this.video.muted = this.muted;
    this.showToast("音频加载失败，已尝试使用视频自带音轨");
  }

  // ------------------------------------------------------------- progress

  updateProgressUI(time = this.video.currentTime) {
    const duration = Number(this.video.duration) || 0;
    const current = clamp(Number(time) || 0, 0, duration > 0 ? duration : Number(time) || 0);
    const percent = duration > 0 ? (current / duration) * 100 : 0;
    if (!this.isDragging) {
      this.progressPlayed.style.width = `${percent.toFixed(3)}%`;
      this.progressThumb.style.left = `${percent.toFixed(3)}%`;
      this.progressTooltip.style.left = `${percent.toFixed(3)}%`;
    }
    this.timeCurrent.textContent = formatDuration(current);
    this.progress.setAttribute("aria-valuenow", String(Math.round(current)));
    this.progress.setAttribute("aria-valuemax", String(Math.round(duration)));
    this.updateBuffer();
  }

  updateDuration() {
    this.timeDuration.textContent = formatDuration(Number(this.video.duration) || 0);
  }

  updateBuffer() {
    const duration = Number(this.video.duration) || 0;
    if (!duration || !this.video.buffered?.length) {
      this.progressBuffer.style.width = "0%";
      return;
    }
    let end = 0;
    for (let i = 0; i < this.video.buffered.length; i += 1) {
      if (this.video.buffered.start(i) <= this.video.currentTime + 0.5) {
        end = this.video.buffered.end(i);
      }
    }
    this.progressBuffer.style.width = `${clamp((end / duration) * 100, 0, 100).toFixed(3)}%`;
  }

  // --------------------------------------------------------------- menus

  openPopup(anchor, html, kind) {
    this.closeFloating();
    const menu = document.createElement("div");
    menu.className = "player-menu";
    menu.dataset.anchor = kind;
    menu.innerHTML = html;
    this.root.append(menu);
    const rootRect = this.root.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    menu.style.right = `${Math.max(6, rootRect.right - anchorRect.right)}px`;
    menu.style.bottom = `${Math.max(6, rootRect.bottom - anchorRect.top + 8)}px`;
    this.popup = menu;
    this.popupAnchor = anchor;
    this.resetIdle();
    return menu;
  }

  openQualityMenu() {
    const anchor = this.root.querySelector('[data-act="quality"]');
    if (this.popup?.dataset.anchor === "quality") {
      this.closeFloating();
      return;
    }
    if (!this.streams.length) {
      this.showToast("清晰度信息加载中…");
      return;
    }
    const items = this.streams
      .map(
        (stream) => `<button class="menu-item${
          stream.quality === this.stream?.quality ? " active" : ""
        }" type="button" data-quality="${stream.quality}">
          <span>${escapeHtml(stream.label || `${stream.quality}P`)}</span>
          ${
            stream.quality === this.stream?.quality
              ? `<span class="menu-check">${icon("check", 14)}</span>`
              : ""
          }
        </button>`
      )
      .join("");
    const menu = this.openPopup(
      anchor,
      `<div class="player-menu-title">清晰度</div>${items}`,
      "quality"
    );
    menu.addEventListener("click", (event) => {
      const button = event.target.closest("[data-quality]");
      if (!button) return;
      this.setQuality(Number(button.dataset.quality));
      this.closeFloating();
    });
  }

  openSpeedMenu() {
    const anchor = this.root.querySelector('[data-act="speed"]');
    if (this.popup?.dataset.anchor === "speed") {
      this.closeFloating();
      return;
    }
    const current = Number(this.video.playbackRate) || 1;
    const items = SPEED_OPTIONS.map(
      (rate) => `<button class="menu-item${rate === current ? " active" : ""}" type="button" data-speed="${rate}">
        <span>${rate}x</span>${rate === current ? `<span class="menu-check">${icon("check", 14)}</span>` : ""}
      </button>`
    ).join("");
    const menu = this.openPopup(anchor, `<div class="player-menu-title">播放速度</div>${items}`, "speed");
    menu.addEventListener("click", (event) => {
      const button = event.target.closest("[data-speed]");
      if (!button) return;
      this.setPlaybackRate(Number(button.dataset.speed));
      this.closeFloating();
    });
  }

  openSubtitleMenu() {
    const anchor = this.captionsBtn;
    if (!this.subtitleTracks.length) {
      this.showToast("此视频没有可用字幕");
      return;
    }
    if (this.popup?.dataset.anchor === "subtitles") {
      this.closeFloating();
      return;
    }
    const items = [
      `<button class="menu-item${!this.activeSubtitle ? " active" : ""}" type="button" data-subtitle="">
        <span>关闭字幕</span>${!this.activeSubtitle ? `<span class="menu-check">${icon("check", 14)}</span>` : ""}
      </button>`,
      ...this.subtitleTracks.map(
        (track) => `<button class="menu-item${this.activeSubtitle === track.lan ? " active" : ""}" type="button" data-subtitle="${escapeHtml(
          track.lan
        )}">
          <span>${escapeHtml(track.lan_doc || track.lan)}</span>
          ${
            this.activeSubtitle === track.lan
              ? `<span class="menu-check">${icon("check", 14)}</span>`
              : ""
          }
        </button>`
      ),
    ].join("");
    const menu = this.openPopup(
      anchor,
      `<div class="player-menu-title">字幕</div>${items}`,
      "subtitles"
    );
    menu.addEventListener("click", (event) => {
      const button = event.target.closest("[data-subtitle]");
      if (!button) return;
      this.selectSubtitle(button.dataset.subtitle);
      this.closeFloating();
    });
  }

  toggleSettings() {
    if (this.settingsPanel) {
      this.closeFloating();
      return;
    }
    this.closeFloating();
    const panel = document.createElement("div");
    panel.className = "player-settings";
    panel.innerHTML = `
      <div class="player-settings-head">
        <span>播放设置</span>
        <button class="pbtn" type="button" data-close-settings aria-label="关闭">${icon("x", 16)}</button>
      </div>
      <div class="player-settings-section">
        <div class="player-settings-row">
          <label class="switch">
            <input type="checkbox" data-setting="danmaku" ${this.danmakuEnabled ? "checked" : ""}>
            <span class="switch-track"></span>
            <span class="switch-label">弹幕</span>
          </label>
          <span class="range-value">${this.danmakuEnabled ? "开启" : "关闭"}</span>
        </div>
      </div>
      <div class="player-settings-section">
        <div class="player-settings-row">
          <span>不透明度</span>
          <input class="range" type="range" min="10" max="100" step="5" value="${Math.round(
            (store.get("danmakuOpacity") || 0.9) * 100
          )}" data-dm="opacity">
          <span class="range-value" data-dm-out="opacity">${Math.round(
            (store.get("danmakuOpacity") || 0.9) * 100
          )}%</span>
        </div>
        <div class="player-settings-row">
          <span>字号</span>
          <input class="range" type="range" min="14" max="40" step="1" value="${Number(
            store.get("danmakuSize")
          ) || 25}" data-dm="size">
          <span class="range-value" data-dm-out="size">${Number(store.get("danmakuSize")) || 25}px</span>
        </div>
        <div class="player-settings-row">
          <span>速度</span>
          <input class="range" type="range" min="4" max="14" step="1" value="${Number(
            store.get("danmakuSpeed")
          ) || 8}" data-dm="speed">
          <span class="range-value" data-dm-out="speed">${Number(store.get("danmakuSpeed")) || 8}</span>
        </div>
        <div class="player-settings-row">
          <span>显示区域</span>
          <input class="range" type="range" min="20" max="100" step="5" value="${Math.round(
            (store.get("danmakuArea") || 0.75) * 100
          )}" data-dm="area">
          <span class="range-value" data-dm-out="area">${Math.round(
            (store.get("danmakuArea") || 0.75) * 100
          )}%</span>
        </div>
      </div>
      <div class="player-settings-section">
        <div class="player-settings-row">
          <label class="switch">
            <input type="checkbox" data-setting="autoplay" ${
              store.get("autoplay") !== false ? "checked" : ""
            }>
            <span class="switch-track"></span>
            <span class="switch-label">自动播放</span>
          </label>
        </div>
      </div>
      <div class="player-settings-hint">设置会自动保存，并应用到之后打开的视频。</div>`;
    this.root.append(panel);
    this.settingsPanel = panel;
    this.resetIdle();

    panel.querySelector("[data-close-settings]").addEventListener("click", () => this.closeFloating());
    panel.querySelector('[data-setting="danmaku"]').addEventListener("change", (event) => {
      this.setDanmakuEnabled(event.target.checked);
      panel.querySelector('[data-setting="danmaku"]').nextElementSibling?.classList.toggle("on");
    });
    panel.querySelector('[data-setting="autoplay"]').addEventListener("change", (event) => {
      store.set("autoplay", event.target.checked);
    });
    panel.querySelectorAll("[data-dm]").forEach((input) => {
      const key = input.dataset.dm;
      const output = panel.querySelector(`[data-dm-out="${key}"]`);
      input.addEventListener("input", () => {
        const value = Number(input.value);
        if (key === "opacity" || key === "area") {
          const ratio = value / 100;
          this.danmaku.configure({ [key]: ratio });
          if (output) output.textContent = `${value}%`;
        } else {
          this.danmaku.configure({ [key]: value });
          if (output) output.textContent = key === "size" ? `${value}px` : String(value);
        }
      });
      input.addEventListener("change", () => {
        const value = Number(input.value);
        store.set(
          key === "opacity"
            ? "danmakuOpacity"
            : key === "size"
            ? "danmakuSize"
            : key === "speed"
            ? "danmakuSpeed"
            : "danmakuArea",
          key === "opacity" || key === "area" ? value / 100 : value
        );
      });
    });
  }

  closeFloating() {
    this.popup?.remove();
    this.settingsPanel?.remove();
    this.popup = null;
    this.popupAnchor = null;
    this.settingsPanel = null;
    this.resetIdle();
  }

  // ------------------------------------------------------------- danmaku

  setDanmaku(items) {
    this.danmaku?.setData(items);
  }

  configureDanmaku() {
    if (!this.danmaku) return;
    this.danmaku.configure({
      opacity: store.get("danmakuOpacity"),
      size: store.get("danmakuSize"),
      speed: store.get("danmakuSpeed"),
      area: store.get("danmakuArea"),
    });
    this.danmaku.setEnabled(this.danmakuEnabled);
    this.updateDanmakuButton();
  }

  setDanmakuEnabled(enabled) {
    this.danmakuEnabled = Boolean(enabled);
    this.danmaku?.setEnabled(this.danmakuEnabled);
    store.set("danmaku", this.danmakuEnabled);
    this.updateDanmakuButton();
  }

  toggleDanmaku() {
    this.setDanmakuEnabled(!this.danmakuEnabled);
    this.showToast(this.danmakuEnabled ? "弹幕已开启" : "弹幕已关闭");
  }

  updateDanmakuButton() {
    if (!this.danmakuBtn) return;
    this.danmakuBtn.classList.toggle("active", this.danmakuEnabled);
    this.danmakuBtn.title = this.danmakuEnabled ? "关闭弹幕 (D)" : "开启弹幕 (D)";
  }

  // ------------------------------------------------------------ subtitles

  setSubtitles(tracks, loader) {
    this.subtitleTracks = Array.isArray(tracks) ? tracks.filter((track) => track?.url) : [];
    this.subtitleLoader = typeof loader === "function" ? loader : null;
    this.captionsBtn.classList.toggle("hidden", !this.subtitleTracks.length);
    if (!this.subtitleTracks.length) {
      this.activeSubtitle = "";
      this.cues = [];
      this.updateSubtitle("");
    }
  }

  async selectSubtitle(lan) {
    if (!lan) {
      this.activeSubtitle = "";
      this.cues = [];
      this.updateSubtitle("");
      this.captionsBtn.classList.remove("active");
      return;
    }
    const track = this.subtitleTracks.find((item) => item.lan === lan);
    if (!track || !this.subtitleLoader) return;
    this.showToast("正在加载字幕…");
    try {
      const cues = await this.subtitleLoader(track);
      if (this.destroyed) return;
      this.activeSubtitle = lan;
      this.cues = Array.isArray(cues) ? cues : [];
      this.captionsBtn.classList.add("active");
      this.updateSubtitleByTime();
      this.showToast("字幕已开启");
    } catch (error) {
      this.showToast(`字幕加载失败：${errorText(error)}`);
    }
  }

  updateSubtitleByTime() {
    if (!this.cues.length) return;
    const time = Number(this.video.currentTime) || 0;
    const cue = this.cues.find((item) => time >= Number(item.from) && time <= Number(item.to));
    this.updateSubtitle(cue ? String(cue.content || "") : "");
  }

  updateSubtitle(text) {
    if (!this.subtitleEl) return;
    this.subtitleEl.textContent = text;
  }

  // --------------------------------------------------------------- misc

  setTitle(title) {
    const text = String(title || "");
    this.topTitle.textContent = text;
    this.root.setAttribute("aria-label", text || "视频播放器");
    if (this.info) this.info.title = text;
  }

  showLoading() {
    this.loadingEl.classList.remove("hidden");
  }

  hideLoading() {
    this.loadingEl.classList.add("hidden");
  }

  showError(message, retry = null) {
    this.errorVisible = true;
    this.hideLoading();
    this.bigPlay.classList.add("hidden");
    this.errorEl.innerHTML = `
      <div class="pe-icon">${icon("alert-circle", 26)}</div>
      <p>${escapeHtml(message)}</p>
      ${retry ? `<button class="btn btn-primary" type="button" data-retry>${icon("refresh-cw", 15)}重新加载</button>` : ""}`;
    this.errorEl.classList.remove("hidden");
    if (retry) {
      this.errorEl.querySelector("[data-retry]")?.addEventListener("click", () => {
        this.clearError();
        retry();
      });
    }
  }

  clearError() {
    this.errorVisible = false;
    this.errorEl.classList.add("hidden");
    this.errorEl.innerHTML = "";
  }

  showToast(message) {
    const text = String(message || "").trim();
    if (!text) return;
    this.toastEl.textContent = text;
    this.toastEl.classList.remove("hidden");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.add("hidden"), 1800);
  }

  updatePlayIcons() {
    const paused = !this.video || this.video.paused;
    const name = paused ? "play" : "pause";
    if (this.playBtn) this.playBtn.innerHTML = icon(name, 19);
    if (this.bigPlay) {
      this.bigPlay.innerHTML = icon("play", 30);
      this.bigPlay.classList.toggle(
        "hidden",
        !paused || !this.stream || this.errorVisible
      );
    }
  }

  resetIdle() {
    if (this.destroyed) return;
    clearTimeout(this.idleTimer);
    this.root.classList.remove("idle");
    if (this.video.paused || this.isDragging || this.popup || this.settingsPanel) return;
    this.idleTimer = setTimeout(() => {
      if (!this.video.paused && !this.isDragging && !this.popup && !this.settingsPanel) {
        this.root.classList.add("idle");
      }
    }, IDLE_MS);
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (this.root.requestFullscreen) {
        await this.root.requestFullscreen();
        return;
      }
      this.root.classList.toggle("is-fullscreen");
      this.updateFullscreenState();
    } catch (_) {
      this.root.classList.toggle("is-fullscreen");
      this.updateFullscreenState();
    }
  }

  updateFullscreenState() {
    const full = document.fullscreenElement === this.root || this.root.classList.contains("is-fullscreen");
    this.fullscreenBtn.innerHTML = icon(full ? "minimize" : "maximize", 19);
    this.fullscreenBtn.title = full ? "退出全屏 (F)" : "全屏 (F)";
    this.resetIdle();
  }

  handleKeyDown(event) {
    if (this.destroyed) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.closest("input, textarea, select, [contenteditable='true']") ||
        target.closest(".modal-backdrop"))
    ) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      if (this.popup || this.settingsPanel) {
        event.preventDefault();
        this.closeFloating();
      }
      return;
    }
    const key = event.key.toLowerCase();
    if (event.code === "Space" || key === "k") {
      event.preventDefault();
      this.togglePlay();
    } else if (key === "arrowleft") {
      event.preventDefault();
      this.seekBy(-5);
    } else if (key === "arrowright") {
      event.preventDefault();
      this.seekBy(5);
    } else if (key === "j") {
      event.preventDefault();
      this.seekBy(-10);
    } else if (key === "l") {
      event.preventDefault();
      this.seekBy(10);
    } else if (key === "arrowup") {
      event.preventDefault();
      this.setVolume(this.volume + 0.05);
    } else if (key === "arrowdown") {
      event.preventDefault();
      this.setVolume(this.volume - 0.05);
    } else if (key === "m") {
      event.preventDefault();
      this.toggleMute();
    } else if (key === "f") {
      event.preventDefault();
      this.toggleFullscreen();
    } else if (key === "d") {
      event.preventDefault();
      this.toggleDanmaku();
    } else if (key === "c") {
      if (this.subtitleTracks.length) {
        event.preventDefault();
        this.selectSubtitle(this.activeSubtitle ? "" : this.subtitleTracks[0].lan);
      }
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.toastTimer);
    this.closeFloating();
    this.danmaku?.destroy();
    document.removeEventListener("pointerdown", this.onDocPointer, true);
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    window.removeEventListener("keydown", this.onKeyDown);

    this.video.pause();
    this.audio.pause();
    this.video.removeAttribute("src");
    this.audio.removeAttribute("src");
    try {
      this.video.load();
      this.audio.load();
    } catch (_) {
      /* ignore */
    }

    if (document.fullscreenElement === this.root) {
      document.exitFullscreen().catch(() => {});
    }
    this.root.remove();
  }
}
