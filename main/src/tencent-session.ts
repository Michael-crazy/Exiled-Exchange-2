// Login state of the Tencent trade site (poe.game.qq.com), from cookie names
// and expiry times only (PoE2 assistant M02, renewal in M09b). Pure functions,
// kept apart from Electron so they can be tested. Cookie values are never
// looked at.
//
// The site keeps three layers (handoff/M02.md, "登录续期"):
// - POESESSID: the server session (HttpOnly, 30 days). The trade API accepts
//   it alone (tested: a search with POETOKEN removed answers 200); once the
//   server drops it, /trade2 redirects to /login and the API answers 401.
// - __POESESSION / __POEREFRESH in the page's localStorage: JWTs from the
//   site's own OAuth (24 hours / 7 days).
// - POETOKEN: written when the user logs in (24 hours), so its appearance
//   marks a fresh login.
// A background load of /trade2 tells which case it is: a new POETOKEN or a
// trade page means the session is alive, the login page means it is gone.

export const TENCENT_ORIGIN = "https://poe.game.qq.com";
export const TENCENT_HOST = "poe.game.qq.com";
export const TOKEN_COOKIE = "POETOKEN";
export const SESSION_COOKIE = "POESESSID";
// A token this close to its end counts as expired already.
export const TOKEN_MARGIN_S = 60;

export interface CookieInfo {
  name: string;
  domain?: string;
  // Seconds since the epoch; absent for session cookies.
  expirationDate?: number;
}

export interface SessionState {
  // The server session cookie is there (logged in, or at least visited).
  hasServerSession: boolean;
  // Seconds since the epoch until the API token is good, or null.
  tokenUntil: number | null;
}

function onTencentHost(cookie: CookieInfo) {
  const domain = (cookie.domain ?? "").replace(/^\./, "");
  return domain === TENCENT_HOST;
}

export function sessionState(
  cookies: CookieInfo[],
  nowS: number,
): SessionState {
  let hasServerSession = false;
  let tokenUntil: number | null = null;
  for (const cookie of cookies) {
    if (!onTencentHost(cookie)) continue;
    if (cookie.name === SESSION_COOKIE) hasServerSession = true;
    if (cookie.name === TOKEN_COOKIE) {
      // A session cookie (no expiry) lives as long as the app.
      const until = cookie.expirationDate ?? Number.POSITIVE_INFINITY;
      if (until - TOKEN_MARGIN_S > nowS) tokenUntil = until;
    }
  }
  return { hasServerSession, tokenUntil };
}

export function tokenValid(state: SessionState) {
  return state.tokenUntil !== null;
}

// Where a background reload of /trade2 ended up.
export type RefreshOutcome =
  // A new API token was written.
  | "renewed"
  // The page went to the login page: the server session is gone.
  | "login-required"
  // The page loaded and nothing changed (token still the old one, or none).
  | "unchanged";

// Decides a background reload from what was seen; null = keep waiting.
export function refreshOutcome(
  before: SessionState,
  after: SessionState,
  url: string,
  settled: boolean,
): RefreshOutcome | null {
  // The OAuth round trip passes /oauth/authorize; only the login page itself
  // means the user has to sign in again.
  if (/\/login\b/.test(safePath(url))) return "login-required";
  if (
    after.tokenUntil !== null &&
    (before.tokenUntil === null || after.tokenUntil > before.tokenUntil)
  ) {
    return "renewed";
  }
  return settled ? "unchanged" : null;
}

function safePath(url: string) {
  try {
    const u = new URL(url);
    return u.host === TENCENT_HOST ? u.pathname : "";
  } catch {
    return "";
  }
}

// When to look at the session again in the background: one minute after the
// token's end, so the page can renew it before the next search; null = no
// token to watch.
export function nextCheckDelayMs(state: SessionState, nowS: number) {
  if (state.tokenUntil === null || !Number.isFinite(state.tokenUntil)) {
    return null;
  }
  // setTimeout is limited to about 24.8 days.
  return Math.min(
    Math.max(0, state.tokenUntil - nowS + 60) * 1000,
    2_000_000_000,
  );
}
