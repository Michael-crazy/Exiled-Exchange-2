import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import readline from "readline";
import { app } from "electron";
import type { ServerEvents } from "../server";
import type { Logger } from "../RemoteLogger";

// Long-running Python backend talking JSON lines over stdio.
// Protocol: sources/assistant-shell.md in PoE2-Build-Assistant.

const PROTOCOL = "assistant-shell/1";
const REQUEST_TIMEOUT_MS = 30_000;

interface BackendLaunch {
  command: string;
  args: string[];
  cwd: string;
}

type Reply =
  | { result: unknown }
  | { error: { code: string; message: string } };

// assistant-backend.json next to the executable, or the file named by
// POE2_ASSISTANT_BACKEND_CONFIG. Relative paths resolve against the file.
function readLaunchConfig(): { launch: BackendLaunch | null; file: string } {
  const file =
    process.env.POE2_ASSISTANT_BACKEND_CONFIG ??
    path.join(path.dirname(app.getPath("exe")), "assistant-backend.json");
  if (!fs.existsSync(file)) return { launch: null, file };

  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    command: string;
    args?: string[];
    cwd?: string;
  };
  const base = path.dirname(file);
  return {
    file,
    launch: {
      command: raw.command,
      args: raw.args ?? [],
      cwd: path.resolve(base, raw.cwd ?? "."),
    },
  };
}

export class AssistantBackend {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (reply: Reply) => void; timer: NodeJS.Timeout }
  >();

  constructor(
    private server: ServerEvents,
    private logger: Logger,
  ) {
    this.server.onEventAnyClient(
      "CLIENT->MAIN::assistant-request",
      async ({ id, method, params }) => {
        const reply = await this.request(method, params);
        this.server.sendEventTo("broadcast", {
          name: "MAIN->CLIENT::assistant-response",
          payload: { id, ...reply },
        });
      },
    );
    app.on("will-quit", () => this.proc?.kill());
  }

  start(): string | null {
    if (this.proc) return null;

    let config: ReturnType<typeof readLaunchConfig>;
    try {
      config = readLaunchConfig();
    } catch (err) {
      return `后端配置无法读取：${(err as Error).message}`;
    }
    if (!config.launch) {
      return `未找到后端配置 ${config.file}`;
    }

    const { command, args, cwd } = config.launch;
    this.logger.write(`info [Backend] start ${command} ${args.join(" ")}`);
    const proc = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });
    this.proc = proc;

    proc.on("error", (err) => {
      this.logger.write(`error [Backend] ${err.message}`);
      this.handleExit(proc, `后端无法启动：${err.message}`);
    });
    proc.on("exit", (code) => {
      this.logger.write(`warn [Backend] exited (${code})`);
      this.handleExit(proc, `后端已退出（${code}）`);
    });
    proc.stdin!.on("error", () => {});
    proc.stderr!.on("data", (chunk: Buffer) => {
      this.logger.write(`info [Backend] ${chunk.toString("utf8").trimEnd()}`);
    });
    readline.createInterface({ input: proc.stdout! }).on("line", (line) => {
      this.handleLine(line);
    });
    return null;
  }

  request(method: string, params: unknown): Promise<Reply> {
    const startError = this.start();
    if (startError) {
      return Promise.resolve({
        error: { code: "backend-unavailable", message: startError },
      });
    }

    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          error: { code: "backend-timeout", message: "后端响应超时" },
        });
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      this.proc!.stdin!.write(
        JSON.stringify({ protocol: PROTOCOL, id, method, params }) + "\n",
      );
    });
  }

  private handleLine(line: string) {
    let msg: {
      id?: number;
      result?: unknown;
      error?: { code: string; message: string };
    };
    try {
      msg = JSON.parse(line);
    } catch {
      this.logger.write(`error [Backend] not JSON: ${line.slice(0, 200)}`);
      return;
    }
    const waiting = msg.id != null ? this.pending.get(msg.id) : undefined;
    if (!waiting) {
      this.logger.write(`warn [Backend] unexpected: ${line.slice(0, 200)}`);
      return;
    }
    this.pending.delete(msg.id!);
    clearTimeout(waiting.timer);
    waiting.resolve(msg.error ? { error: msg.error } : { result: msg.result });
  }

  private handleExit(proc: ChildProcess, message: string) {
    if (this.proc !== proc) return;
    this.proc = null;
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.resolve({ error: { code: "backend-exited", message } });
      this.pending.delete(id);
    }
  }
}
