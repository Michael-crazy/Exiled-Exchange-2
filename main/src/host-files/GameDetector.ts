import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";
import readline from "readline";
import ini from "ini";
import { app } from "electron";
import type { DetectedGame } from "../../../ipc/types";
import type { Logger } from "../RemoteLogger";

// Executable name -> realm. International standalone and Steam builds use
// PathOfExile.exe / PathOfExileSteam.exe; the Tencent (WeGame) build uses
// PathOfExile_x64.exe.
const PROCESS_REALM: Record<string, DetectedGame["realm"]> = {
  pathofexile: "pc-ggg",
  pathofexilesteam: "pc-ggg",
  pathofexile_x64: "pc-tencent",
};

const WINDOW_TITLE: Record<DetectedGame["realm"], string> = {
  "pc-ggg": "Path of Exile 2",
  "pc-tencent": "流放之路：降临",
};

const CONFIG_FILE: Record<DetectedGame["realm"], string> = {
  "pc-ggg": "poe2_production_Config.ini",
  "pc-tencent": "poe2_production_tc_Config.ini",
};

// [LANGUAGE] language= in the international game config -> EE2 language.
const GAME_LANGUAGE: Record<string, string> = {
  "en": "en",
  "zh-TW": "cmn-Hant",
  "ru": "ru",
  "ko": "ko",
  "ja": "ja",
  "de": "de",
  "es": "es",
  "pt": "pt",
  "pt-BR": "pt",
  "fr": "fr",
};

// Polls running processes once every 2 seconds from a single long-lived
// PowerShell. QueryFullProcessImageName with PROCESS_QUERY_LIMITED_INFORMATION
// also works for a game started as administrator.
const PROBE_SCRIPT = `
param([int]$ParentPid)
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Poe2Probe {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr h, int flags, StringBuilder buf, ref int size);
  public static string ImagePath(int pid) {
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h == IntPtr.Zero) return null;
    try {
      var sb = new StringBuilder(1024);
      int size = sb.Capacity;
      return QueryFullProcessImageNameW(h, 0, sb, ref size) ? sb.ToString() : null;
    } finally { CloseHandle(h); }
  }
}
'@
$names = 'PathOfExile','PathOfExileSteam','PathOfExile_x64'
$last = $null
while ($true) {
  if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit }
  $found = @(Get-Process -Name $names -ErrorAction SilentlyContinue | Sort-Object Id | ForEach-Object {
    [ordered]@{ name = $_.ProcessName; pid = $_.Id; path = [Poe2Probe]::ImagePath($_.Id) }
  })
  $line = ConvertTo-Json -Compress -InputObject $found
  if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }
  Start-Sleep -Seconds 2
}
`;

interface ProbeEntry {
  name: string;
  pid: number;
  path: string | null;
}

export interface GameDetector {
  on: (event: "change", listener: (game: DetectedGame | null) => void) => this;
}
export class GameDetector extends EventEmitter {
  private proc: ChildProcess | null = null;
  private _current: DetectedGame | null = null;
  get current() {
    return this._current;
  }

  constructor(private logger: Logger) {
    super();
  }

  start() {
    if (process.platform !== "win32") return;

    const encoded = Buffer.from(
      `& {${PROBE_SCRIPT}} ${process.pid}`,
      "utf16le",
    ).toString("base64");
    this.proc = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.proc.on("error", (err) => {
      this.logger.write(`error [GameDetector] ${err.message}`);
    });
    this.proc.on("exit", (code) => {
      this.logger.write(`warn [GameDetector] probe exited (${code})`);
      this.proc = null;
    });
    this.proc.stderr!.on("data", (chunk: Buffer) => {
      this.logger.write(`error [GameDetector] ${chunk.toString("utf8")}`);
    });
    readline
      .createInterface({ input: this.proc.stdout! })
      .on("line", (line) => {
        let entries: ProbeEntry[];
        try {
          entries = JSON.parse(line) as ProbeEntry[];
        } catch {
          this.logger.write(`error [GameDetector] bad probe output: ${line}`);
          return;
        }
        this.update(entries).catch((err: Error) => {
          this.logger.write(`error [GameDetector] ${err.message}`);
        });
      });
    app.on("will-quit", () => this.proc?.kill());
  }

  private async update(entries: ProbeEntry[]) {
    const entry = entries.find((e) => PROCESS_REALM[e.name.toLowerCase()]);
    let game: DetectedGame | null = null;
    if (entry) {
      const realm = PROCESS_REALM[entry.name.toLowerCase()];
      const gameConfig = path.join(
        app.getPath("documents"),
        "My Games",
        "Path of Exile 2",
        CONFIG_FILE[realm],
      );
      game = {
        realm,
        process: `${entry.name}.exe`,
        pid: entry.pid,
        exePath: entry.path,
        windowTitle: WINDOW_TITLE[realm],
        clientLog: entry.path
          ? path.join(path.dirname(entry.path), "logs", "Client.txt")
          : null,
        gameConfig,
        language:
          realm === "pc-tencent"
            ? "cmn-Hans"
            : await readGameLanguage(gameConfig),
      };
    }

    if (JSON.stringify(game) === JSON.stringify(this._current)) return;
    this._current = game;
    this.logger.write(
      game
        ? `info [GameDetector] ${game.process} (${game.realm}, ${game.language ?? "?"}) ${game.exePath ?? "path unavailable"}`
        : "info [GameDetector] no game running",
    );
    this.emit("change", game);
  }
}

async function readGameLanguage(configPath: string): Promise<string | null> {
  let contents: string;
  try {
    contents = await fs.readFile(configPath, "utf-8");
  } catch {
    return null;
  }
  const parsed = ini.parse(contents.trimStart());
  const code = (parsed.LANGUAGE?.language as string | undefined) ?? "en";
  return GAME_LANGUAGE[code] ?? null;
}
