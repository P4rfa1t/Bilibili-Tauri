/**
 * 首页频道容器：动态 / 直播 / 热门 / 追番 / 影视。
 *
 * 频道本身不产出内容，只负责在顶部放一条频道栏，
 * 然后把渲染交给对应页面模块（动态、直播、首页、番剧）。
 */

import {
  bindChannelLinks,
  channelBarHtml,
  channelLabel,
  channelOf,
  channelQuery,
} from "../channels.js";
import * as bangumiPage from "./bangumi.js";
import * as dynamicPage from "./dynamic.js";
import * as homePage from "./home.js";
import * as livePage from "./live.js";
import * as recommendPage from "./recommend.js";

/** 追番默认番剧，影视默认电影。 */
const BANGUMI_DEFAULT_TYPE = 1;
const FILM_DEFAULT_TYPE = 2;

function routeFor(channel, query) {
  if (channel === "dynamic") return { module: dynamicPage, query: new URLSearchParams() };
  if (channel === "live") return { module: livePage, query: channelQuery(query) };
  if (channel === "recommend") return { module: recommendPage, query: new URLSearchParams() };
  if (channel === "bangumi") {
    const next = channelQuery(query);
    if (!next.get("type")) next.set("type", String(BANGUMI_DEFAULT_TYPE));
    return { module: bangumiPage, query: next };
  }
  if (channel === "film") {
    const next = channelQuery(query);
    if (!next.get("type")) next.set("type", String(FILM_DEFAULT_TYPE));
    return { module: bangumiPage, query: next };
  }
  return { module: homePage, query: channelQuery(query) };
}

export async function render(root, ctx) {
  const channel = ctx.params.channel || channelOf(ctx.query);
  const { module, query } = routeFor(channel, ctx.query);

  root.innerHTML = `<div class="channel-shell">
    ${channelBarHtml(channel)}
    <div class="channel-body" data-channel-body aria-label="${channelLabel(channel)}"></div>
  </div>`;

  const body = root.querySelector("[data-channel-body]");
  const unbind = bindChannelLinks(root, channel);

  const subCtx = {
    ...ctx,
    params: {},
    query,
    refresh: () => ctx.refresh(),
  };

  let cleanup = null;
  try {
    cleanup = await module.render(body, subCtx);
  } catch (error) {
    unbind();
    throw error;
  }

  return () => {
    unbind();
    if (typeof cleanup === "function") cleanup();
  };
}
