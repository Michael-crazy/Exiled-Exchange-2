import { app, BrowserWindow, session } from "electron";
import type { ServerEvents } from "./server";
import type { Logger } from "./RemoteLogger";
import {
  TENCENT_HOST,
  TENCENT_ORIGIN,
  TOKEN_COOKIE,
  nextCheckDelayMs,
  refreshOutcome,
  sessionState,
  tokenValid,
  type RefreshOutcome,
  type SessionState,
} from "./tencent-session";

// Login to the Tencent trade site (poe.game.qq.com) for the price check (M02),
// PoB's Trader (M04) and the assistant's trade window (M09b).
// The user signs in themselves in a normal browser window (QR code or QQ).
// Everything lives in Electron's default session in the user data folder,
// which is also the session the trade proxy (proxy.ts) and PobTrade use.
// Only cookie names and expiry times are looked at (tencent-session.ts);
// credentials, cookie values and tokens are never read here.

const TRADE_PAGE = `${TENCENT_ORIGIN}/trade2`;
const TITLE = "登录国服市集 · 登录成功后本窗口会自动关闭";
const EXPIRED_TITLE =
  "国服登录已过期 · 请在助手弹出的这个窗口里登录（登录成功后自动关闭）";
const REFRESH_TIMEOUT_MS = 20_000;
// After the page has loaded, wait this long for it to write a new token.
const REFRESH_SETTLE_MS = 5000;
const POLL_MS = 500;
// The expired-login window pops up by itself at most this often.
const PROMPT_AGAIN_MS = 10 * 60_000;
const CLOSE_AFTER_LOGIN_MS = 1500;

export type TencentLoginState =
  | "closed"
  | "refreshed"
  | "logged-out"
  | "logged-in"
  | "expired";

function nowS() {
  return Date.now() / 1000;
}

async function sleep(ms: number) {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

export class TencentLogin {
  private window: BrowserWindow | null = null;
  private refreshing: Promise<RefreshOutcome> | null = null;
  // Set when the session could not be renewed; cleared by a new token.
  private expired = false;
  private promptedAt = 0;
  private checkTimer: NodeJS.Timeout | null = null;
  // M09b: the assistant's Tencent trade window, when open, is where the user
  // logs in; no second login window is opened next to it.
  private loginSurface: (() => BrowserWindow | null) | null = null;

  constructor(
    private server: ServerEvents,
    private logger: Logger,
  ) {
    // Closing the login or the background window must not end the app:
    // without a listener Electron quits once no window is left (the overlay
    // window is the only other one, and is absent with --no-overlay).
    app.on("window-all-closed", () => {});
    this.server.onEventAnyClient(
      "CLIENT->MAIN::tencent-login",
      async ({ action }) => {
        if (action === "open") {
          this.open();
          return;
        }
        if (action === "logout") {
          await this.logout();
          this.broadcast("logged-out");
          return;
        }
        const outcome = await this.refresh();
        if (outcome === "login-required") this.requireLogin();
        this.broadcast("refreshed");
      },
    );
    app.whenReady().then(
      () => {
        this.watchCookies();
        setTimeout(() => {
          void this.backgroundCheck();
        }, 10_000);
      },
      () => {},
    );
  }

  get isExpired() {
    return this.expired;
  }

  setLoginSurface(surface: () => BrowserWindow | null) {
    this.loginSurface = surface;
  }

  open(expired = false) {
    const surface = this.loginSurface?.();
    const win = surface ?? this.window;
    if (win && !win.isDestroyed()) {
      if (expired && win === this.window) win.setTitle(EXPIRED_TITLE);
      bringToFront(win);
      return;
    }
    const created = new BrowserWindow({
      width: 1100,
      height: 800,
      title: expired ? EXPIRED_TITLE : TITLE,
      autoHideMenuBar: true,
      webPreferences: { sandbox: true },
    });
    this.window = created;
    created.on("page-title-updated", (e) => {
      e.preventDefault();
    });
    // QQ login may open a popup; it stays in the same session.
    created.webContents.setWindowOpenHandler(() => ({
      action: "allow",
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: { sandbox: true },
      },
    }));
    created.on("closed", () => {
      this.window = null;
      this.logger.write("info [TencentLogin] login window closed");
      this.broadcast("closed");
    });
    void created.loadURL(TRADE_PAGE);
    bringToFront(created);
  }

  // The session could not be renewed: show the login window once (and again
  // only after a while), and tell the price check and PoB.
  requireLogin() {
    const first = !this.expired;
    this.expired = true;
    const now = Date.now();
    if (first || now - this.promptedAt > PROMPT_AGAIN_MS) {
      this.promptedAt = now;
      this.logger.write(
        "info [TencentLogin] session expired, asking to log in",
      );
      this.open(true);
    }
    this.broadcast("expired");
  }

  async refresh(): Promise<RefreshOutcome> {
    if (!this.refreshing) {
      this.refreshing = this.loadHidden().finally(() => {
        this.refreshing = null;
      });
    }
    return await this.refreshing;
  }

  private async state(): Promise<SessionState> {
    const cookies = await session.defaultSession.cookies.get({
      domain: TENCENT_HOST,
    });
    // Names, domains and expiry only.
    return sessionState(
      cookies.map(({ name, domain, expirationDate }) => ({
        name,
        domain,
        expirationDate,
      })),
      nowS(),
    );
  }

  private async loadHidden(): Promise<RefreshOutcome> {
    const before = await this.state();
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, backgroundThrottling: false },
    });
    let outcome: RefreshOutcome = "unchanged";
    try {
      win.loadURL(TRADE_PAGE).catch(() => {
        // Redirects and aborted loads; the URL check below decides.
      });
      const started = Date.now();
      let loadedAt: number | null = null;
      win.webContents.once("did-finish-load", () => {
        loadedAt = Date.now();
      });
      for (;;) {
        await sleep(POLL_MS);
        if (win.isDestroyed()) break;
        const now = Date.now();
        const settled =
          now - started > REFRESH_TIMEOUT_MS ||
          (loadedAt !== null && now - loadedAt > REFRESH_SETTLE_MS);
        const found = refreshOutcome(
          before,
          await this.state(),
          win.webContents.getURL(),
          settled,
        );
        if (found) {
          outcome = found;
          break;
        }
      }
    } catch (err) {
      this.logger.write(
        `warn [TencentLogin] reload failed: ${(err as Error).message}`,
      );
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
    this.logger.write(`info [TencentLogin] background reload: ${outcome}`);
    if (outcome === "renewed") {
      await this.loggedIn();
    } else if (outcome === "login-required") {
      this.expired = true;
    }
    return outcome;
  }

  // Background renewal before the user searches: at start and one minute
  // after the token ends. Never opens a window.
  private async backgroundCheck() {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = null;
    let state = await this.state();
    if (!tokenValid(state) && state.hasServerSession && !this.expired) {
      await this.refresh();
      state = await this.state();
    }
    this.schedule(state);
  }

  private schedule(state: SessionState) {
    const delay = nextCheckDelayMs(state, nowS());
    if (delay === null) return;
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      void this.backgroundCheck();
    }, delay);
  }

  private watchCookies() {
    session.defaultSession.cookies.on(
      "changed",
      (_event, cookie, _cause, removed) => {
        if (removed || cookie.name !== TOKEN_COOKIE) return;
        if ((cookie.domain ?? "").replace(/^\./, "") !== TENCENT_HOST) return;
        void this.loggedIn();
      },
    );
  }

  // A new API token appeared: from a login in a window or a renewal.
  private async loggedIn() {
    const state = await this.state();
    if (!tokenValid(state)) return;
    const wasExpired = this.expired;
    this.expired = false;
    this.schedule(state);
    // Cookies reach the disk about every 30 s; do not lose a fresh login to
    // the app being closed right away.
    await session.defaultSession.cookies.flushStore().catch(() => {});
    if (!wasExpired && !this.window) return;
    this.logger.write("info [TencentLogin] logged in");
    this.broadcast("logged-in");
    const win = this.window;
    if (win && !win.isDestroyed()) {
      setTimeout(() => {
        // Still on the trade page (the login page itself sets no token).
        if (!win.isDestroyed()) win.close();
      }, CLOSE_AFTER_LOGIN_MS);
    }
  }

  private broadcast(state: TencentLoginState) {
    this.server.sendEventTo("broadcast", {
      name: "MAIN->CLIENT::tencent-login",
      payload: { state },
    });
  }

  private async logout() {
    this.window?.destroy();
    const ses = session.defaultSession;
    await ses.clearStorageData({ origin: TENCENT_ORIGIN });
    // The QQ sign-in keeps its own cookies on *.qq.com; drop those too so the
    // next login asks again. Only names and domains are looked at.
    const cookies = await ses.cookies.get({});
    for (const cookie of cookies) {
      const domain = (cookie.domain ?? "").replace(/^\./, "");
      if (domain === "qq.com" || domain.endsWith(".qq.com")) {
        const url = `https://${domain}${cookie.path ?? "/"}`;
        await ses.cookies.remove(url, cookie.name);
      }
    }
    await ses.cookies.flushStore().catch(() => {});
    this.expired = true;
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = null;
    this.logger.write("info [TencentLogin] logged out");
  }
}

export function bringToFront(win: BrowserWindow) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.moveTop();
  win.focus();
  if (process.platform === "win32") win.flashFrame(true);
}
