import { AppConfig } from "@/web/Config";
import { Host } from "@/web/background/IPC";

// Tencent trade site (poe.game.qq.com, M02). Same trade2 API as the
// international site, but every search and fetch needs the user's login;
// without it the API answers 401.

export const TENCENT_LOGIN_REQUIRED = "tencent-login-required";

export function isTencent() {
  return AppConfig().realm === "pc-tencent";
}

// League ids are Chinese; the site wants them under the `poe2` realm.
export function tradeLeaguePath(leagueId: string) {
  return isTencent() ? `poe2/${encodeURIComponent(leagueId)}` : leagueId;
}

// Fetch needs the realm on Tencent (`/api/trade2/fetch/<ids>?query=…&realm=poe2`).
export function fetchRealmParam() {
  return isTencent() ? "&realm=poe2" : "";
}

// Set after a background reload did not bring the session back, so later
// requests ask for login at once instead of reloading the page every time.
let loginNeeded = false;

function waitForLogin(state: "refreshed" | "closed" | "logged-out") {
  return new Promise<void>((resolve) => {
    const listener = Host.onEvent("MAIN->CLIENT::tencent-login", (e) => {
      if (e.state === state) {
        listener.abort();
        resolve();
      }
    });
  });
}

export function openTencentLogin() {
  Host.sendEvent({
    name: "CLIENT->MAIN::tencent-login",
    payload: { action: "open" },
  });
  return waitForLogin("closed").then(() => {
    loginNeeded = false;
  });
}

export async function logoutTencent() {
  const done = waitForLogin("logged-out");
  Host.sendEvent({
    name: "CLIENT->MAIN::tencent-login",
    payload: { action: "logout" },
  });
  await done;
  loginNeeded = true;
}

async function refreshTencentLogin() {
  const done = waitForLogin("refreshed");
  Host.sendEvent({
    name: "CLIENT->MAIN::tencent-login",
    payload: { action: "refresh" },
  });
  await done;
}

// Sends a trade API request; on Tencent a 401 first lets the trade page renew
// the session in the background and retries once, then asks for login.
export async function withTencentLogin(
  send: () => Promise<Response>,
): Promise<Response> {
  if (!isTencent()) return await send();
  if (loginNeeded) throw new Error(TENCENT_LOGIN_REQUIRED);
  let response = await send();
  if (response.status !== 401) return response;
  await refreshTencentLogin();
  response = await send();
  if (response.status === 401) {
    loginNeeded = true;
    throw new Error(TENCENT_LOGIN_REQUIRED);
  }
  return response;
}
