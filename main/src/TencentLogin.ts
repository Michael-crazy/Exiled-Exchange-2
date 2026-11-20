import { app, BrowserWindow, session } from "electron";
import type { ServerEvents } from "./server";
import type { Logger } from "./RemoteLogger";

// Login to the Tencent trade site (poe.game.qq.com) for the price check (M02).
// The user signs in themselves in a normal browser window (QR code or QQ).
// The site keeps its tokens in the page's localStorage and the API accepts the
// session cookie, both stored by Electron's default session in the user data
// folder, which is also the session the trade proxy (proxy.ts) uses.
// Credentials, cookies and tokens are never read here.

const ORIGIN = "https://poe.game.qq.com";
const TRADE_PAGE = `${ORIGIN}/trade2`;
const TITLE = "登录国服市集 · 登录完成后关闭此窗口";
// After a restart the session cookie can be gone while the page's refresh
// token is still in localStorage; loading the page lets the site renew it.
const REFRESH_SETTLE_MS = 3000;
const REFRESH_TIMEOUT_MS = 20_000;

export class TencentLogin {
  private window: BrowserWindow | null = null;
  private refreshing: Promise<void> | null = null;

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
        } else {
          await this.refresh();
        }
        this.server.sendEventTo("broadcast", {
          name: "MAIN->CLIENT::tencent-login",
          payload: { state: action === "logout" ? "logged-out" : "refreshed" },
        });
      },
    );
  }

  open() {
    if (this.window) {
      this.window.show();
      this.window.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 1100,
      height: 800,
      title: TITLE,
      autoHideMenuBar: true,
      webPreferences: { sandbox: true },
    });
    this.window = win;
    win.on("page-title-updated", (e) => {
      e.preventDefault();
    });
    // QQ login may open a popup; it stays in the same session.
    win.webContents.setWindowOpenHandler(() => ({
      action: "allow",
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: { sandbox: true },
      },
    }));
    win.on("closed", () => {
      this.window = null;
      this.logger.write("info [TencentLogin] login window closed");
      this.server.sendEventTo("broadcast", {
        name: "MAIN->CLIENT::tencent-login",
        payload: { state: "closed" },
      });
    });
    void win.loadURL(TRADE_PAGE);
  }

  async refresh() {
    if (!this.refreshing) {
      this.refreshing = this.loadHidden().finally(() => {
        this.refreshing = null;
      });
    }
    await this.refreshing;
  }

  private async loadHidden() {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true },
    });
    try {
      await Promise.race([
        win.loadURL(TRADE_PAGE),
        new Promise((resolve) => setTimeout(resolve, REFRESH_TIMEOUT_MS)),
      ]);
      await new Promise((resolve) => setTimeout(resolve, REFRESH_SETTLE_MS));
      this.logger.write("info [TencentLogin] trade page reloaded");
    } catch (err) {
      this.logger.write(
        `warn [TencentLogin] reload failed: ${(err as Error).message}`,
      );
    } finally {
      win.destroy();
    }
  }

  private async logout() {
    this.window?.destroy();
    const ses = session.defaultSession;
    await ses.clearStorageData({ origin: ORIGIN });
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
    this.logger.write("info [TencentLogin] logged out");
  }
}
