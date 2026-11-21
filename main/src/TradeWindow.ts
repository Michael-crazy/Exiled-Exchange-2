import fs from "fs";
import path from "path";
import { BrowserWindow, ipcMain, session, shell } from "electron";
import type { AssistantBackend } from "./backend/AssistantBackend";
import type { Logger } from "./RemoteLogger";
import { bringToFront, type TencentLogin } from "./TencentLogin";
import {
  PREVIEW_CHANNEL,
  PREVIEW_WORLD_ID,
  TRADE_SITES,
  browserUserAgent,
  isTradePage,
  previewRequest,
  staysInWindow,
  tradeRealm,
  type TradeRealm,
  type TradeSite,
} from "./trade-window-rules";

// The assistant's own trade window (PoE2 assistant M09b). Opens the trade
// site of the current server and shows the assistant's evaluation next to each
// result, with the page script of the browser extension (poe-trade2text,
// assistant/preview.js, M09a) run unchanged in an isolated world. Evaluations
// go to the backend over stdio (method trade-preview), not over the
// extension's 127.0.0.1 endpoint.
// Tencent uses the default session, i.e. the login of the price check and
// PoB's Trader; the international site has its own persistent partition, in
// which the user passes Cloudflare's check and logs in themselves.
// Cookies, tokens and page contents other than the result rows the page
// script reads are not looked at.

// Copied from the extension at build time (build/script.mjs); see
// trade-preview/SOURCE.md.
const SCRIPTS = ["content.js", "assistant/preview.js"];
const STYLES = ["styles.css", "assistant/preview.css"];

interface Job {
  params: Record<string, unknown>;
  resolve: (reply: unknown) => void;
}

export class TradeWindow {
  private windows = new Map<TradeRealm, BrowserWindow>();
  private assets: { scripts: string[]; css: string } | null = null;
  // One evaluation at a time, like the extension's background script; the
  // backend's own timeout only starts once a request is sent.
  private queue: Job[] = [];
  private busy = false;

  constructor(
    private backend: AssistantBackend,
    login: TencentLogin,
    private logger: Logger,
    private currentRealm: () => string | null | undefined,
  ) {
    ipcMain.handle(PREVIEW_CHANNEL, async (event, message: unknown) => {
      const site = this.siteOf(event.sender.id);
      const frameUrl = event.senderFrame?.url ?? "";
      if (!site || !isTradePage(frameUrl, site)) {
        return {
          ok: false,
          code: "forbidden",
          message: "只接受助手市集窗口的请求",
        };
      }
      const params = previewRequest(message, site);
      if (!params) {
        return { ok: false, code: "bad-request", message: "请求格式不对" };
      }
      return await this.evaluate({ ...params });
    });
    // The Tencent login prompt uses this window when it is open, so only one
    // login window is ever shown.
    login.setLoginSurface(() => this.windows.get("pc-tencent") ?? null);
  }

  private siteOf(webContentsId: number): TradeSite | null {
    for (const [realm, win] of this.windows) {
      if (!win.isDestroyed() && win.webContents.id === webContentsId) {
        return TRADE_SITES[realm];
      }
    }
    return null;
  }

  // Opens (or brings to front) the window of the given or current server.
  open(realm?: string | null): TradeRealm {
    const site = TRADE_SITES[tradeRealm(realm ?? this.currentRealm())];
    const existing = this.windows.get(site.realm);
    if (existing && !existing.isDestroyed()) {
      bringToFront(existing);
      return site.realm;
    }
    const partition = site.partition ?? undefined;
    const ses = partition
      ? session.fromPartition(partition)
      : session.defaultSession;
    const webPreferences = {
      sandbox: true,
      contextIsolation: true,
      partition,
      preload: path.join(__dirname, "trade-preload.js"),
    };
    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      title: site.title,
      autoHideMenuBar: true,
      webPreferences,
    });
    this.windows.set(site.realm, win);
    win.webContents.setUserAgent(browserUserAgent(ses.getUserAgent()));
    win.on("page-title-updated", (e) => {
      e.preventDefault();
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (staysInWindow(url, site)) {
        // QQ / WeChat sign-in popups; same session, no page script.
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: { sandbox: true, partition },
          },
        };
      }
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, url) => {
      if (!staysInWindow(url, site)) {
        e.preventDefault();
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      }
    });
    win.webContents.on("dom-ready", () => {
      void this.inject(win, site);
    });
    win.on("closed", () => {
      this.windows.delete(site.realm);
      this.logger.write(`info [TradeWindow] ${site.realm} closed`);
    });
    this.logger.write(`info [TradeWindow] opening ${site.url}`);
    void win.loadURL(site.url);
    bringToFront(win);
    return site.realm;
  }

  private loadAssets() {
    if (!this.assets) {
      const dir = path.join(__dirname, "trade-preview");
      const read = (name: string) =>
        fs.readFileSync(path.join(dir, name), "utf-8");
      this.assets = {
        scripts: SCRIPTS.map(read),
        css: STYLES.map(read).join("\n"),
      };
    }
    return this.assets;
  }

  private async inject(win: BrowserWindow, site: TradeSite) {
    const url = win.webContents.getURL();
    if (!isTradePage(url, site)) return;
    try {
      const { scripts, css } = this.loadAssets();
      await win.webContents.insertCSS(css);
      await win.webContents.executeJavaScriptInIsolatedWorld(
        PREVIEW_WORLD_ID,
        scripts.map((code) => ({ code })),
      );
    } catch (err) {
      this.logger.write(
        `error [TradeWindow] page script: ${(err as Error).message}`,
      );
    }
  }

  private async evaluate(params: Record<string, unknown>) {
    return await new Promise<unknown>((resolve) => {
      this.queue.push({ params, resolve });
      void this.next();
    });
  }

  private async next() {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    try {
      const reply = await this.backend.request("trade-preview", job.params);
      if ("error" in reply) {
        job.resolve({
          ok: false,
          code: reply.error.code,
          message: reply.error.message,
        });
      } else {
        job.resolve(reply.result);
      }
    } catch (err) {
      job.resolve({
        ok: false,
        code: "internal",
        message: (err as Error).message,
      });
    } finally {
      this.busy = false;
      void this.next();
    }
  }
}
