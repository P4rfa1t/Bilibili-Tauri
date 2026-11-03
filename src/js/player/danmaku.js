/**
 * Canvas danmaku renderer.
 *
 * The animation clock is the media currentTime, not wall time. That keeps the
 * danmaku perfectly frozen while paused and aligned after seeking.
 */

import { clamp } from "../utils.js";

const FIXED_DURATION = 4.5;
const LANE_GAP = 16;
const MAX_ACTIVE = 220;

function validColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#ffffff";
}

export class DanmakuEngine {
  constructor(canvas, { getTime } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.getTime = typeof getTime === "function" ? getTime : () => 0;

    this.items = [];
    this.index = 0;
    this.active = [];
    this.scrollLanes = [];
    this.topLanes = [];
    this.bottomLanes = [];

    this.enabled = true;
    this.opacity = 0.9;
    this.fontSize = 25;
    this.speed = 8;
    this.area = 0.75;

    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.fontPx = 25;
    this.fontScale = 1;
    this.lineHeight = 36;
    this.maxLanes = 8;
    this.lastTime = -1;
    this.raf = 0;
    this.destroyed = false;

    this.loop = this.loop.bind(this);
    this.handleResize = this.handleResize.bind(this);

    this.ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(this.handleResize) : null;
    this.ro?.observe(canvas);
    window.addEventListener("resize", this.handleResize, { passive: true });

    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  font() {
    return `600 ${this.fontPx}px -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif`;
  }

  recalcLanes() {
    this.fontPx = Math.max(13, this.fontSize * this.fontScale);
    this.lineHeight = Math.max(24, Math.round(this.fontPx * 1.42));
    const available = Math.max(this.height * this.area, this.lineHeight);
    this.maxLanes = Math.max(1, Math.floor(available / this.lineHeight));
    this.scrollLanes = new Array(this.maxLanes).fill(null);
    this.topLanes = new Array(this.maxLanes).fill(0);
    this.bottomLanes = new Array(this.maxLanes).fill(0);
    if (this.ctx) this.ctx.font = this.font();
  }

  resize() {
    const width = Math.max(0, Math.round(this.canvas.clientWidth));
    const height = Math.max(0, Math.round(this.canvas.clientHeight));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.max(1, Math.round(width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.fontScale = clamp(width / 1280, 0.58, 1.2);
    this.recalcLanes();
    this.seek(this.getTime());
  }

  handleResize() {
    if (this.destroyed) return;
    this.resize();
  }

  configure({ opacity, size, speed, area } = {}) {
    let reset = false;
    if (opacity !== undefined) {
      this.opacity = clamp(Number(opacity) || 0.9, 0.1, 1);
    }
    if (size !== undefined) {
      const next = clamp(Number(size) || 25, 14, 40);
      if (next !== this.fontSize) reset = true;
      this.fontSize = next;
    }
    if (speed !== undefined) {
      const next = clamp(Number(speed) || 8, 4, 14);
      if (next !== this.speed) reset = true;
      this.speed = next;
    }
    if (area !== undefined) {
      const next = clamp(Number(area) || 0.75, 0.2, 1);
      if (next !== this.area) reset = true;
      this.area = next;
    }
    this.fontScale = clamp(this.width / 1280, 0.58, 1.2);
    this.recalcLanes();
    if (reset) this.seek(this.getTime());
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (this.enabled) this.seek(this.getTime());
    else {
      this.active = [];
      this.clear();
    }
  }

  setData(items) {
    const queue = (Array.isArray(items) ? items : [])
      .map((item) => {
        const content = String(item?.content ?? "").trim();
        if (!content) return null;
        return {
          time: clamp(Number(item?.time) || 0, 0, 24 * 3600),
          mode: Number(item?.mode) || 1,
          color: validColor(item?.color),
          content: content.slice(0, 120),
          size: Number(item?.size) || 25,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);

    this.items = queue;
    this.seek(this.getTime());
  }

  clear() {
    if (this.width && this.height) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  }

  seek(time) {
    const t = Math.max(0, Number(time) || 0);
    this.active = [];
    this.scrollLanes = new Array(this.maxLanes).fill(null);
    this.topLanes = new Array(this.maxLanes).fill(0);
    this.bottomLanes = new Array(this.maxLanes).fill(0);
    this.lastTime = t;
    this.index = this.lowerBound(t - 0.12);
    this.clear();
  }

  lowerBound(time) {
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.items[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  loop() {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);

    if (!this.enabled || !this.width || !this.height) {
      if (!this.enabled) this.clear();
      return;
    }

    const t = Math.max(0, Number(this.getTime()) || 0);
    if (this.lastTime < 0 || t < this.lastTime - 0.35 || t - this.lastTime > 2.5) {
      this.seek(t);
    }

    if (t > this.lastTime) {
      while (this.index < this.items.length && this.items[this.index].time <= t + 0.08) {
        const item = this.items[this.index];
        this.index += 1;
        this.spawn(item, t);
      }
      this.lastTime = t;
    }

    this.draw(t);
  }

  spawn(item, time) {
    if (this.active.length >= MAX_ACTIVE) return;
    const mode = item.mode === 4 ? 4 : item.mode === 5 ? 5 : 1;
    const width = this.ctx.measureText(item.content).width;
    if (!Number.isFinite(width) || width <= 0) return;

    if (mode === 1) {
      const travel = clamp(14 - this.speed, 4.5, 11);
      let lane = -1;
      for (let i = 0; i < this.scrollLanes.length; i += 1) {
        const last = this.scrollLanes[i];
        if (!last) {
          lane = i;
          break;
        }
        const elapsed = time - last.spawnAt;
        if (elapsed >= last.travel + 0.4) {
          lane = i;
          break;
        }
        const lastX = this.width - (elapsed / last.travel) * (this.width + last.width);
        if (lastX + last.width + LANE_GAP <= this.width) {
          lane = i;
          break;
        }
      }
      if (lane < 0) return;
      const entry = {
        mode,
        content: item.content,
        color: item.color,
        lane,
        width,
        travel,
        spawnAt: time,
        expires: time + travel + 1,
      };
      this.scrollLanes[lane] = entry;
      this.active.push(entry);
      return;
    }

    const lanes = mode === 5 ? this.topLanes : this.bottomLanes;
    let lane = -1;
    for (let i = 0; i < lanes.length; i += 1) {
      if (time >= lanes[i]) {
        lane = i;
        break;
      }
    }
    if (lane < 0) return;
    lanes[lane] = time + FIXED_DURATION;
    this.active.push({
      mode,
      content: item.content,
      color: item.color,
      lane,
      width,
      travel: FIXED_DURATION,
      spawnAt: time,
      expires: time + FIXED_DURATION,
    });
  }

  draw(time) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.font = this.font();
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.lineJoin = "round";
    ctx.globalAlpha = this.opacity;

    const next = [];
    for (const entry of this.active) {
      if (time > entry.expires + 0.5) continue;
      let x = 0;
      let y = 0;
      if (entry.mode === 1) {
        const elapsed = time - entry.spawnAt;
        x = this.width - (elapsed / entry.travel) * (this.width + entry.width);
        if (x + entry.width < 0) continue;
        y = entry.lane * this.lineHeight + 4;
      } else {
        const elapsed = time - entry.spawnAt;
        if (elapsed > FIXED_DURATION) continue;
        x = (this.width - entry.width) / 2;
        y =
          entry.mode === 5
            ? entry.lane * this.lineHeight + 4
            : this.height - (entry.lane + 1) * this.lineHeight - 2;
      }

      ctx.strokeStyle = "rgba(0,0,0,0.58)";
      ctx.lineWidth = Math.max(2, this.fontPx / 8);
      ctx.strokeText(entry.content, x, y);
      ctx.fillStyle = entry.color;
      ctx.fillText(entry.content, x, y);
      next.push(entry);
    }

    this.active = next;
    ctx.globalAlpha = 1;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    window.removeEventListener("resize", this.handleResize);
    this.clear();
  }
}
