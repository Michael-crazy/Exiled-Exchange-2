"use strict";

import { app, systemPreferences } from "electron";
import { uIOhook } from "uiohook-napi";
import os from "node:os";
import fs from "fs";
import path from "path";
import { startServer, eventPipe, server } from "./server";
import { Logger } from "./RemoteLogger";
import { GameWindow } from "./windowing/GameWindow";
import { OverlayWindow } from "./windowing/OverlayWindow";
import { GameConfig } from "./host-files/GameConfig";
import { Shortcuts } from "./shortcuts/Shortcuts";
import { AppUpdater } from "./AppUpdater";
import { AppTray } from "./AppTray";
import { OverlayVisibility } from "./windowing/OverlayVisibility";
import { GameLogWatcher } from "./host-files/GameLogWatcher";
import { HttpProxy } from "./proxy";
import { installExtension, VUEJS_DEVTOOLS } from "electron-devtools-installer";
import { FileWriter } from "./host-files/FileWriter";
import { GameDetector } from "./host-files/GameDetector";
import { AssistantBackend } from "./backend/AssistantBackend";
import { TencentLogin } from "./TencentLogin";
import { PobTrade } from "./PobTrade";
import { TradeWindow } from "./TradeWindow";
import { followPathOfBuilding } from "./PathOfBuildingParent";
import { PobSettingsBridge } from "./host-files/PobSettingsBridge";
import type { HostConfig } from "../../ipc/types";

// The server in the saved config, for when no renderer has sent its host
// config yet (e.g. --no-overlay): PoB's "打开市集" still opens the right site.
function savedRealm(): string | null {
  try {
    const file = path.join(app.getPath("userData"), "apt-data", "config.json");
    const realm = (
      JSON.parse(fs.readFileSync(file, "utf-8")) as { realm?: unknown }
    ).realm;
    return typeof realm === "string" ? realm : null;
  } catch {
    return null;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.exit();
}

if (process.platform !== "darwin") {
  app.disableHardwareAcceleration();
}
app.enableSandbox();
let tray: AppTray;

(async () => {
  if (process.platform === "darwin") {
    async function ensureAccessibilityPermission(): Promise<boolean> {
      if (systemPreferences.isTrustedAccessibilityClient(false)) return true;

      // Trigger the system prompt
      systemPreferences.isTrustedAccessibilityClient(true);

      const maxWaitTime = 15000; // 15 seconds
      const startTime = Date.now();

      return await new Promise((resolve) => {
        const interval = setInterval(() => {
          if (systemPreferences.isTrustedAccessibilityClient(false)) {
            clearInterval(interval);
            resolve(true);
          }

          // Stop waiting if time runs out
          if (Date.now() - startTime > maxWaitTime) {
            clearInterval(interval);
            resolve(false);
          }
        }, 1000);
      });
    }
    const hasPermission = await ensureAccessibilityPermission();
    if (!hasPermission) {
      console.warn("Accessibility permission not granted, exiting");
      app.quit();
      return;
    }
    console.log("Accessibility permission granted, starting app");
  }

  app.on("ready", async () => {
    tray = new AppTray(eventPipe);
    const logger = new Logger(eventPipe);
    const gameConfig = new GameConfig(eventPipe, logger);
    const poeWindow = new GameWindow();
    const appUpdater = new AppUpdater(eventPipe);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _httpProxy = new HttpProxy(server, logger);
    const fileWriter = new FileWriter(eventPipe, logger);
    const gameLogWatcher = new GameLogWatcher(eventPipe, logger, fileWriter);
    const gameDetector = new GameDetector(logger);
    const backend = new AssistantBackend(eventPipe, logger);
    followPathOfBuilding(logger);
    const pobSettings = new PobSettingsBridge(eventPipe, logger);
    const tencentLogin = new TencentLogin(eventPipe, logger);
    // The server the renderer works with (settings, or the running game).
    let currentRealm: string | null = null;
    const tradeWindow = new TradeWindow(
      backend,
      tencentLogin,
      logger,
      () => currentRealm ?? savedRealm() ?? gameDetector.current?.realm,
    );
    tray.openTradeWindow = () => tradeWindow.open();
    // eslint-disable-next-line no-new
    new PobTrade(server, backend, tencentLogin, tradeWindow, logger);

    if (process.env.VITE_DEV_SERVER_URL) {
      try {
        await installExtension(VUEJS_DEVTOOLS);
        logger.write("info Vue Devtools installed");
      } catch (error) {
        logger.write(`error installing Vue Devtools: ${error}`);
        console.log(`error installing Vue Devtools: ${error}`);
      }
    }
    process.addListener("uncaughtException", (err) => {
      logger.write(`error [uncaughtException] ${err.message}, ${err.stack}`);
    });
    process.addListener("unhandledRejection", (reason) => {
      logger.write(`error [unhandledRejection] ${(reason as Error).stack}`);
    });

    setTimeout(
      async () => {
        const overlay = new OverlayWindow(eventPipe, logger, poeWindow);
        // eslint-disable-next-line no-new
        new OverlayVisibility(eventPipe, overlay, gameConfig);
        const shortcuts = await Shortcuts.create(
          logger,
          overlay,
          poeWindow,
          gameConfig,
          eventPipe,
        );
        // Settings entered by the user win; empty ones follow the game
        // that is currently running.
        let hostCfg: HostConfig | null = null;
        const applyGameSettings = () => {
          if (!hostCfg) return;
          const game = gameDetector.current;
          const title = hostCfg.windowTitle || game?.windowTitle || null;
          if (
            title &&
            poeWindow.attachedTitle &&
            title !== poeWindow.attachedTitle &&
            !hostCfg.windowTitle
          ) {
            // The other realm started. The native window hook cannot switch
            // titles, so restart with the same privileges.
            logger.write(`info [GameDetector] switching to "${title}"`);
            app.relaunch();
            app.quit();
            return;
          }
          overlay.updateOpts(
            hostCfg.overlayKey,
            title,
            hostCfg.hideOverlayOnBlur,
          );
          gameLogWatcher.restart(
            hostCfg.clientLog || game?.clientLog || "",
            hostCfg.readClientLog,
          );
          gameConfig.readConfig(hostCfg.gameConfig || game?.gameConfig || "");
          eventPipe.sendEventTo("broadcast", {
            name: "MAIN->CLIENT::game-detected",
            payload: { game },
          });
        };
        gameDetector.on("change", applyGameSettings);
        eventPipe.onEventAnyClient(
          "CLIENT->MAIN::update-host-config",
          (cfg) => {
            hostCfg = cfg;
            currentRealm = cfg.realm;
            applyGameSettings();
            shortcuts.updateActions(
              cfg.shortcuts,
              cfg.stashScroll,
              cfg.logKeys,
              cfg.restoreClipboard,
              cfg.language,
            );
            shortcuts.updateDelay(cfg.initialDelay);
            shortcuts.updateClipboardWatch(cfg.assistantWatchClipboard);
            appUpdater.checkAtStartup();
            tray.overlayKey = cfg.overlayKey;
            fileWriter.restart(cfg.libraryAlpha, cfg.libraryOutputPath);
          },
        );
        gameDetector.start();
        const backendError = backend.start();
        if (backendError) logger.write(`warn [Backend] ${backendError}`);
        uIOhook.start();
        console.log("uIOhook started");
        const port = await startServer(appUpdater, logger);
        // TODO: move up (currently crashes)
        logger.write(`info ${os.type()} ${os.release} / v${app.getVersion()}`);
        overlay.loadAppPage(port);
        tray.serverPort = port;
        pobSettings.serverPort = port;
      },
      // fixes(linux): window is black instead of transparent
      process.platform === "linux" ? 1000 : 0,
    );
  });
})();
