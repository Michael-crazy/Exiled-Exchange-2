// Routes of the local bridge PoB's Trader uses for the Tencent trade site (M04).
// Pure functions, kept apart from Electron so they can be tested.

export const TENCENT_ORIGIN = "https://poe.game.qq.com";
export const PREFIX = "/pob-trade/";

export type PobTradeRoute =
  | { kind: "login" }
  | { kind: "leagues"; url: string }
  | { kind: "search"; url: string }
  | { kind: "fetch"; url: string };

// "/pob-trade/<path>" with method -> the Tencent API URL it stands for, or null.
// Only these fixed endpoints are reachable; the league is one path segment as
// PoB encoded it, ids are plain tokens and the query id is base64url (the
// Tencent site returns the gzipped query itself as the id).
export function pobTradeRoute(
  method: string | undefined,
  url: string | undefined,
): PobTradeRoute | null {
  if (!url?.startsWith(PREFIX)) return null;
  const [path, search = ""] = url.slice(PREFIX.length).split("?", 2);
  const params = new URLSearchParams(search);
  if (path === "login" && (method === "POST" || method === "GET")) {
    return { kind: "login" };
  }
  if (path === "leagues" && method === "GET") {
    return {
      kind: "leagues",
      url: `${TENCENT_ORIGIN}/api/trade2/data/leagues`,
    };
  }
  let m = /^search\/([^/?#]+)$/.exec(path);
  if (m && method === "POST" && !/%2f|%5c|\.\./i.test(m[1])) {
    return {
      kind: "search",
      url: `${TENCENT_ORIGIN}/api/trade2/search/poe2/${m[1]}`,
    };
  }
  m = /^fetch\/([A-Za-z0-9]+(?:,[A-Za-z0-9]+){0,9})$/.exec(path);
  const query = params.get("query");
  if (m && method === "GET" && query && /^[A-Za-z0-9_-]+$/.test(query)) {
    return {
      kind: "fetch",
      url: `${TENCENT_ORIGIN}/api/trade2/fetch/${m[1]}?query=${query}&realm=poe2`,
    };
  }
  return null;
}

// Browsers send Origin on cross-site requests and cannot add the custom header
// without a preflight this server never answers; PoB (curl) sends no Origin.
export function isPobRequest(headers: Record<string, unknown>): boolean {
  return headers.origin === undefined && headers["x-pob-trade"] === "1";
}

// Response headers passed back to PoB: its rate limiter reads these.
export function passedHeaders(
  headers: Record<string, string | string[]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase();
    if (name.startsWith("x-rate-limit-") || name === "retry-after") {
      out[name] = Array.isArray(value) ? value.join(", ") : value;
    }
  }
  return out;
}
