import { app } from "electron";
import fs from "fs";
import path from "path";
import type { ServerEvents } from "../server";
import type { Logger } from "../RemoteLogger";

// Settings changed in Path of Building's Options window (PoE2 assistant U03).
// PoB writes the changed config entries to apt-data/pob-settings-request.json
// ({"protocol":"pob-settings/1","seq":N,"set":{"<path>":value}}); paths are
// top-level config keys or "widget:<wmType>.<key>". Once the overlay has
// loaded its config, the request goes to it and it applies the entries the
// way the settings window saves; config.json stays the only source of truth.
// assistant-status.json, rewritten every 2 seconds, tells PoB the assistant
// runs and which entries of the last request it rejected.

const REQUEST_PROTOCOL = "pob-settings/1";
const STATUS_PROTOCOL = "assistant-status/1";
const POLL_MS = 500;
const STATUS_MS = 2000;

export class PobSettingsBridge {
  private dir = path.join(app.getPath("userData"), "apt-data");
  private requestPath = path.join(this.dir, "pob-settings-request.json");
  private statusPath = path.join(this.dir, "assistant-status.json");
  private overlayReady = false;
  // Local server port for PoB's Trader on the Tencent site (M04).
  serverPort: number | null = null;
  private logShortcuts = false;
  private applied: { seq: number; rejected: Record<string, string> } | null =
    null;

  constructor(
    private server: ServerEvents,
    private logger: Logger,
  ) {
    server.onEventAnyClient("CLIENT->MAIN::update-host-config", (cfg) => {
      this.overlayReady = true;
      if (this.logShortcuts) {
        // The hotkeys now registered, after a request from PoB.
        this.logShortcuts = false;
        const keys = cfg.shortcuts.map((s) =>
          "target" in s.action
            ? `${s.shortcut} = ${s.action.type}:${s.action.target}`
            : `${s.shortcut} = ${s.action.type}`,
        );
        this.logger.write(`info [PoB settings] hotkeys: ${keys.join("; ")}`);
      }
    });
    server.onEventAnyClient("CLIENT->MAIN::pob-settings-applied", (e) => {
      this.applied = e;
      const rejected = Object.keys(e.rejected);
      this.logger.write(
        `info [PoB settings] request ${e.seq} applied` +
          (rejected.length ? `, rejected ${rejected.join(", ")}` : ""),
      );
      this.writeStatus();
    });
    setInterval(() => {
      this.poll();
    }, POLL_MS);
    setInterval(() => {
      this.writeStatus();
    }, STATUS_MS);
    this.writeStatus();
    app.on("will-quit", () => {
      try {
        fs.rmSync(this.statusPath, { force: true });
      } catch {}
    });
  }

  private poll() {
    if (!this.overlayReady || !fs.existsSync(this.requestPath)) return;
    let request: { protocol?: unknown; seq?: unknown; set?: unknown };
    try {
      request = JSON.parse(fs.readFileSync(this.requestPath, "utf8"));
      fs.rmSync(this.requestPath, { force: true });
    } catch (err) {
      this.logger.write(
        `warn [PoB settings] cannot read the request: ${(err as Error).message}`,
      );
      fs.rmSync(this.requestPath, { force: true });
      return;
    }
    if (
      request.protocol !== REQUEST_PROTOCOL ||
      typeof request.seq !== "number" ||
      typeof request.set !== "object" ||
      request.set === null
    ) {
      this.logger.write("warn [PoB settings] ignoring a malformed request");
      return;
    }
    this.logShortcuts = true;
    this.server.sendEventTo("broadcast", {
      name: "MAIN->CLIENT::pob-settings",
      payload: {
        seq: request.seq,
        set: request.set as Record<string, unknown>,
      },
    });
  }

  private writeStatus() {
    const status = {
      protocol: STATUS_PROTOCOL,
      pid: process.pid,
      time: Date.now() / 1000,
      version: app.getVersion(),
      applied: this.applied,
      port: this.serverPort,
    };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.statusPath + ".tmp", JSON.stringify(status));
      fs.renameSync(this.statusPath + ".tmp", this.statusPath);
    } catch {}
  }
}
