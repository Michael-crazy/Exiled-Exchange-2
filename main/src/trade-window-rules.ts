// The assistant's own trade window (PoE2 assistant M09b): which site to open
// for which server, and which requests from it are accepted. Pure functions,
// kept apart from Electron so they can be tested.

export type TradeRealm = "pc-ggg" | "pc-tencent";

export interface TradeSite {
  realm: TradeRealm;
  host: string;
  url: string;
  // Electron session partition; null = the default session, which holds the
  // Tencent login of the price check and PoB's Trader (TencentLogin.ts).
  partition: string | null;
  title: string;
}

export const TRADE_SITES: Record<TradeRealm, TradeSite> = {
  "pc-ggg": {
    realm: "pc-ggg",
    host: "www.pathofexile.com",
    url: "https://www.pathofexile.com/trade2",
    // Cloudflare's check and the GGG login stay here between starts.
    partition: "persist:trade-ggg",
    title: "PoE2 助手 · 国际服市集（每条结果旁显示试算）",
  },
  "pc-tencent": {
    realm: "pc-tencent",
    host: "poe.game.qq.com",
    url: "https://poe.game.qq.com/trade2",
    partition: null,
    title: "PoE2 助手 · 国服市集（每条结果旁显示试算）",
  },
};

// Isolated world the page script runs in, like an extension's content
// script: it sees the page's DOM but not the page's JavaScript, and only it
// gets the assistant's evaluate function.
export const PREVIEW_WORLD_ID = 1717;
export const PREVIEW_CHANNEL = "poe2-assistant:trade-preview";
export const MAX_ITEM_TEXT = 20_000;

// Garena and other realms have no trade window; they use the international one.
export function tradeRealm(realm: string | undefined | null): TradeRealm {
  return realm === "pc-tencent" ? "pc-tencent" : "pc-ggg";
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// A trade2 page of the window's own site, where the page script runs.
export function isTradePage(url: string, site: TradeSite): boolean {
  const u = parse(url);
  return (
    u !== null &&
    u.protocol === "https:" &&
    u.host === site.host &&
    /^\/trade2(\/|$)/.test(u.pathname)
  );
}

// Pages the window itself may show: the site, and on Tencent the QQ / WeChat
// sign-in. Everything else opens in the user's browser.
export function staysInWindow(url: string, site: TradeSite): boolean {
  const u = parse(url);
  if (!u || u.protocol !== "https:") return false;
  if (u.host === site.host) return true;
  if (site.realm === "pc-tencent") {
    return (
      u.host === "qq.com" ||
      u.host.endsWith(".qq.com") ||
      u.host.endsWith(".weixin.qq.com") ||
      u.host === "open.weixin.qq.com"
    );
  }
  return (
    u.host === "pathofexile.com" ||
    u.host.endsWith(".pathofexile.com") ||
    u.host === "challenges.cloudflare.com"
  );
}

export interface PreviewRequest {
  item_text: string;
  price: unknown;
  language: "en" | "zh_hans";
  realm: TradeRealm;
}

// The page script's message -> backend params, or null when it is not one.
// The language follows the site, not the page (only Tencent is Chinese).
export function previewRequest(
  message: unknown,
  site: TradeSite,
): PreviewRequest | null {
  if (typeof message !== "object" || message === null) return null;
  const m = message as Record<string, unknown>;
  if (
    typeof m.item_text !== "string" ||
    !m.item_text.trim() ||
    m.item_text.length > MAX_ITEM_TEXT
  ) {
    return null;
  }
  const price = m.price ?? null;
  if (price !== null && typeof price !== "object") return null;
  return {
    item_text: m.item_text,
    price,
    language: site.realm === "pc-tencent" ? "zh_hans" : "en",
    realm: site.realm,
  };
}

// Electron's default user agent names Electron and the app; Cloudflare is
// stricter with unusual browsers, so the window looks like plain Chrome.
export function browserUserAgent(ua: string): string {
  return ua
    .replace(/\s+Electron\/\S+/g, "")
    .replace(/\s+exiled-exchange-2\/\S+/gi, "");
}
