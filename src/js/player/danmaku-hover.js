/**
 * Shared danmaku hover UI: freeze the hovered danmaku, show a copy button,
 * and resume it when the pointer leaves.
 */

import { copyText } from "../utils.js";

export class DanmakuHover {
  constructor({
    engine,
    container,
    button,
    onCopied,
    ignoreSelector = "",
    bottomInset = 0,
  }) {
    this.engine = engine;
    this.container = container;
    this.button = button;
    this.onCopied = typeof onCopied === "function" ? onCopied : null;
    this.ignoreSelector = ignoreSelector;
    this.bottomInset = bottomInset;
    this.entry = null;
    this.text = "";
    this.hideTimer = 0;

    this.onMove = (event) => this.handleMove(event);
    this.onLeave = () => this.hide();
    this.onButtonDown = (event) => event.stopPropagation();
    this.onButtonClick = (event) => this.handleCopy(event);

    container.addEventListener("pointermove", this.onMove);
    container.addEventListener("pointerleave", this.onLeave);
    button?.addEventListener("pointerdown", this.onButtonDown);
    button?.addEventListener("click", this.onButtonClick);
  }

  hoverElement() {
    return this.button?.closest("[data-danmaku-hover]") || this.button || null;
  }

  handleMove(event) {
    if (!this.engine || !this.button) return;
    if (this.ignoreSelector && event.target?.closest?.(this.ignoreSelector)) {
      this.scheduleHide();
      return;
    }
    if (event.target?.closest?.("[data-danmaku-hover]")) {
      clearTimeout(this.hideTimer);
      return;
    }

    const canvas = this.engine.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (
      x < 0 ||
      y < 0 ||
      x > rect.width ||
      y > rect.height ||
      (this.bottomInset > 0 && y > rect.height - this.bottomInset)
    ) {
      this.scheduleHide();
      return;
    }

    const hit = this.engine.hitTest(event.clientX, event.clientY);
    if (!hit || !hit.entry) {
      this.scheduleHide();
      return;
    }

    if (this.entry && this.entry !== hit.entry) this.engine.unfreeze(this.entry);
    this.entry = hit.entry;
    this.engine.freeze(hit.entry);
    this.text = hit.content;
    clearTimeout(this.hideTimer);

    const containerRect = this.container.getBoundingClientRect();
    const centerX = rect.left - containerRect.left + hit.x + hit.width / 2;
    const top = rect.top - containerRect.top + hit.y - 8;
    const hoverEl = this.hoverElement();
    if (!hoverEl) return;
    hoverEl.hidden = false;
    hoverEl.style.left = `${Math.min(
      Math.max(centerX, 40),
      Math.max(40, containerRect.width - 40)
    )}px`;
    hoverEl.style.top = `${Math.max(30, top)}px`;
  }

  scheduleHide() {
    if (!this.entry) {
      this.hideElement();
      return;
    }
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = 0;
      this.hide();
    }, 200);
  }

  hideElement() {
    const hoverEl = this.hoverElement();
    if (hoverEl) hoverEl.hidden = true;
  }

  hide() {
    clearTimeout(this.hideTimer);
    this.hideTimer = 0;
    if (this.entry) {
      this.engine?.unfreeze(this.entry);
      this.entry = null;
    }
    this.text = "";
    this.hideElement();
  }

  async handleCopy(event) {
    event.stopPropagation();
    const text = this.text;
    if (!text) return;
    const ok = await copyText(text);
    this.onCopied?.(ok, text);
    this.hide();
  }

  destroy() {
    clearTimeout(this.hideTimer);
    if (this.entry) this.engine?.unfreeze(this.entry);
    this.entry = null;
    this.text = "";
    this.container.removeEventListener("pointermove", this.onMove);
    this.container.removeEventListener("pointerleave", this.onLeave);
    this.button?.removeEventListener("pointerdown", this.onButtonDown);
    this.button?.removeEventListener("click", this.onButtonClick);
    this.hideElement();
  }
}
