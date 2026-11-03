/**
 * 直播弹幕客户端。
 *
 * 连接 B 站直播的广播 WebSocket（broadcastlv.chat.bilibili.com/sub），
 * 解出 DANMU_MSG 后喂给 DanmakuEngine 滚动显示。时钟用单调递增的
 * performance.now() 折算成秒，和录播那边用 video.currentTime 的思路一致。
 */

import { liveDanmuConf, liveDanmuHistory } from "../api.js";
import { store } from "../store.js";
import { DanmakuEngine } from "./danmaku.js";

const HEADER = 16;
const OP_HEARTBEAT = 2;
const OP_POPULARITY = 3;
const OP_MESSAGE = 5;
const OP_AUTH = 7;
const OP_AUTH_REPLY = 8;
const HEARTBEAT_MS = 30000;
const MAX_QUEUE = 4000;

function encodePacket(op, payload) {
  const body = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const buffer = new Uint8Array(HEADER + body.length);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, HEADER + body.length);
  view.setUint16(4, HEADER);
  view.setUint16(6, 1);
  view.setUint32(8, op);
  view.setUint32(12, 1);
  buffer.set(body, HEADER);
  return buffer;
}

/** 把拼接的 16 字节头数据包拆开，返回 [{ver, op, body}]。 */
function splitPackets(buffer) {
  const out = [];
  const view = new DataView(buffer);
  let offset = 0;
  while (offset + HEADER <= buffer.byteLength) {
    const total = view.getUint32(offset);
    const headLength = view.getUint16(offset + 4);
    const ver = view.getUint16(offset + 6);
    const op = view.getUint32(offset + 8);
    if (total < HEADER || headLength < HEADER || offset + total > buffer.byteLength) break;
    out.push({ ver, op, body: buffer.slice(offset + headLength, offset + total) });
    offset += total;
  }
  return out;
}

function hexColor(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 0xffffff) return "#ffffff";
  return `#${n.toString(16).padStart(6, "0")}`;
}

export class LiveDanmaku {
  constructor(canvas, { roomId, onStatus } = {}) {
    this.canvas = canvas;
    this.roomId = Number(roomId) || 0;
    this.onStatus = typeof onStatus === "function" ? onStatus : null;

    this.startedAt = performance.now();
    this.engine = new DanmakuEngine(canvas, { getTime: () => this.now() });
    this.engine.configure({
      opacity: store.get("danmakuOpacity"),
      size: store.get("danmakuSize"),
      speed: store.get("danmakuSpeed"),
      area: store.get("danmakuArea"),
    });

    this.enabled = store.get("danmaku") !== false;
    this.engine.setEnabled(this.enabled);

    this.socket = null;
    this.heartbeat = 0;
    this.retryTimer = 0;
    this.attempt = 0;
    this.chain = Promise.resolve();
    this.destroyed = false;
    this.status = "idle";
    this.count = 0;

    this.start();
  }

  now() {
    return Math.max(0, (performance.now() - this.startedAt) / 1000);
  }

  setStatus(status, detail) {
    this.status = status;
    this.onStatus?.(status, detail);
  }

  refreshConfig() {
    this.engine.configure({
      opacity: store.get("danmakuOpacity"),
      size: store.get("danmakuSize"),
      speed: store.get("danmakuSpeed"),
      area: store.get("danmakuArea"),
    });
    this.enabled = store.get("danmaku") !== false;
    this.engine.setEnabled(this.enabled);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.engine.setEnabled(this.enabled);
  }

  /** 往引擎里塞一条弹幕。实时弹幕时间单调递增，直接追加即可。 */
  push(text, { mode = 1, color = "#ffffff", size = 25 } = {}) {
    const content = String(text || "").trim();
    if (!content) return;
    const items = this.engine.items;
    const item = {
      time: this.now(),
      mode: mode === 4 ? 4 : mode === 5 ? 5 : 1,
      color,
      content: content.slice(0, 120),
      size: Number(size) || 25,
    };
    if (!items.length || items[items.length - 1].time <= item.time) {
      items.push(item);
    } else {
      items.splice(this.engine.lowerBound(item.time), 0, item);
    }
    this.count += 1;
    if (items.length > MAX_QUEUE) {
      items.splice(0, items.length - MAX_QUEUE);
      this.engine.seek(this.now());
    }
  }

  async loadHistory() {
    try {
      const history = await liveDanmuHistory(this.roomId);
      const list = Array.isArray(history?.items) ? history.items.slice(-14) : [];
      if (!list.length || this.destroyed) return;
      // 历史弹幕排在接下来 6 秒里依次滚出，一进直播间就不用干等第一条
      const span = 6;
      const step = span / list.length;
      const start = this.now();
      const seeded = list.map((item, index) => ({
        time: start + index * step,
        mode: Number(item.mode) === 4 || Number(item.mode) === 5 ? Number(item.mode) : 1,
        color: hexColor(item.color),
        content: String(item.text || "").slice(0, 120),
        size: 25,
      }));
      const merged = [...this.engine.items, ...seeded]
        .filter((item) => item.content)
        .sort((a, b) => a.time - b.time);
      // setData 会重置播放指针，所以只在补历史这一下用
      this.engine.setData(merged);
    } catch (_) {
      /* 历史弹幕只是补充，失败了实时弹幕照样能用 */
    }
  }

  async inflate(body) {
    if (typeof DecompressionStream === "undefined") return null;
    try {
      const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream("deflate"));
      return await new Response(stream).arrayBuffer();
    } catch (_) {
      return null;
    }
  }

  async handleFrame(buffer) {
    for (const packet of splitPackets(buffer)) {
      if (packet.op === OP_MESSAGE) {
        if (packet.ver === 2) {
          const inflated = await this.inflate(packet.body);
          if (inflated) await this.handleFrame(inflated);
        } else if (packet.ver === 0) {
          this.handleJson(new TextDecoder().decode(packet.body));
        }
      } else if (packet.op === OP_AUTH_REPLY) {
        let code = -1;
        try {
          code = Number(JSON.parse(new TextDecoder().decode(packet.body)).code);
        } catch (_) {}
        if (code === 0) {
          this.attempt = 0;
          this.setStatus("live");
          this.loadHistory();
        } else {
          this.setStatus("error", `鉴权失败（${code}）`);
        }
      } else if (packet.op === OP_POPULARITY) {
        const view = new DataView(packet.body);
        if (packet.body.byteLength >= 4) this.onPopularity?.(view.getUint32(0));
      }
    }
  }

  handleJson(text) {
    let message = null;
    try {
      message = JSON.parse(text);
    } catch (_) {
      return;
    }
    const cmd = String(message.cmd || "");
    if (cmd.startsWith("DANMU_MSG")) {
      const info = message.info || [];
      const meta = Array.isArray(info[0]) ? info[0] : [];
      this.push(info[1], {
        mode: Number(meta[1]) || 1,
        color: hexColor(meta[3]),
        size: Number(meta[2]) || 25,
      });
      return;
    }
    if (cmd === "SUPER_CHAT_MESSAGE" && message.data) {
      const price = Number(message.data.price) || 0;
      const name = message.data.user_info?.uname || "";
      this.push(`【${name} ¥${price}】${message.data.message || ""}`, {
        mode: 1,
        color: "#ffd166",
        size: 26,
      });
    }
  }

  send(op, payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(encodePacket(op, payload));
    } catch (_) {}
  }

  async start() {
    if (this.destroyed) return;
    this.setStatus("connecting");
    let conf = null;
    try {
      conf = await liveDanmuConf(this.roomId);
    } catch (error) {
      this.setStatus("error", "弹幕服务器信息获取失败");
      this.scheduleRetry();
      return;
    }
    if (this.destroyed) return;
    const host = conf?.host || "broadcastlv.chat.bilibili.com";
    const port = Number(conf?.wss_port) || 443;
    const token = conf?.token || "";

    let socket = null;
    try {
      socket = new WebSocket(`wss://${host}:${port}/sub`);
    } catch (_) {
      this.setStatus("error", "无法建立弹幕连接");
      this.scheduleRetry();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.destroyed) return;
      const uid = Number(store.user?.mid) || 0;
      this.send(
        OP_AUTH,
        JSON.stringify({
          uid,
          roomid: this.roomId,
          protover: 2,
          platform: "web",
          type: 2,
          key: token,
        })
      );
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => this.send(OP_HEARTBEAT, "[object Object]"), HEARTBEAT_MS);
    });

    socket.addEventListener("message", (event) => {
      if (this.destroyed || !(event.data instanceof ArrayBuffer)) return;
      const data = event.data;
      // 按到达顺序串行解压，避免包序错乱
      this.chain = this.chain.then(() => this.handleFrame(data)).catch(() => {});
    });

    socket.addEventListener("error", () => {
      if (this.destroyed) return;
      this.setStatus("error", "弹幕连接中断");
    });

    socket.addEventListener("close", () => {
      clearInterval(this.heartbeat);
      this.heartbeat = 0;
      if (this.destroyed) return;
      this.setStatus("closed");
      this.scheduleRetry();
    });
  }

  scheduleRetry() {
    if (this.destroyed || this.retryTimer) return;
    const delay = Math.min(15000, 2000 * 2 ** Math.min(this.attempt, 3));
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = 0;
      this.start();
    }, delay);
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retryTimer);
    this.heartbeat = 0;
    this.retryTimer = 0;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (_) {}
      this.socket = null;
    }
    this.engine.destroy();
  }
}
