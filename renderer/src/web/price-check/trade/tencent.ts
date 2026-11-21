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

// The site searches unique and base names in Simplified Chinese, while EE2
// works with the English names of the translated item. translate-item gives
// the pairs from the copied item (`names`).
const zhNames = new Map<string, string>();

export function rememberTencentNames(pairs: Array<[string, string]>) {
  for (const [en, zh] of pairs) zhNames.set(en, zh);
}

export function tradeName(name: string) {
  return isTencent() ? (zhNames.get(name) ?? name) : name;
}

// Set after a background reload did not bring the session back, so later
// requests ask for login at once instead of reloading the page every time.
let loginNeeded = false;

type LoginState =
  | "refreshed"
  | "closed"
  | "logged-out"
  | "logged-in"
  | "expired";

function waitForLogin(...states: LoginState[]) {
  return new Promise<void>((resolve) => {
    const listener = Host.onEvent("MAIN->CLIENT::tencent-login", (e) => {
      if (states.includes(e.state)) {
        listener.abort();
        resolve();
      }
    });
  });
}

// A login anywhere (the login window, the assistant's trade window or the
// background renewal) lets requests go out again.
Host.onEvent("MAIN->CLIENT::tencent-login", (e) => {
  if (e.state === "logged-in") loginNeeded = false;
  if (e.state === "expired") loginNeeded = true;
});

// Opens (or brings to front) the assistant's login window; whenTencentLoggedIn
// tells when the user is done there.
export function openTencentLogin() {
  Host.sendEvent({
    name: "CLIENT->MAIN::tencent-login",
    payload: { action: "open" },
  });
}

// When the session expired the assistant shows its login window by itself;
// this resolves once the user logged in there or closed it.
export function whenTencentLoggedIn() {
  return waitForLogin("logged-in", "closed").then(() => {
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
// the session in the background and retries once, then asks for login (the
// assistant has then shown its login window, see main/src/TencentLogin.ts).
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
