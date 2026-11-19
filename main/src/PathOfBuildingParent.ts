import { app } from "electron";
import type { Logger } from "./RemoteLogger";

// Path of Building starts the assistant with --pob-pid=<its pid>. The
// assistant quits once every PoB that started it (or tried to start a
// second copy) has exited. The argument survives the restart as
// administrator and the restart on realm switch, which reuse argv.
const ARG = "--pob-pid=";
const POLL_MS = 2000;

function pobPid(argv: string[]): number | null {
  const arg = argv.find((a) => a.startsWith(ARG));
  const pid = arg ? Number(arg.slice(ARG.length)) : NaN;
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function followPathOfBuilding(logger: Logger) {
  const first = pobPid(process.argv);
  if (!first) return;
  const pids = new Set([first]);
  app.on("second-instance", (_event, argv) => {
    const pid = pobPid(argv);
    if (pid) pids.add(pid);
  });
  logger.write(`info [PoB] following Path of Building (pid ${first})`);
  setInterval(() => {
    for (const pid of pids) {
      if (!isRunning(pid)) pids.delete(pid);
    }
    if (!pids.size) {
      logger.write("info [PoB] Path of Building exited, quitting");
      app.quit();
    }
  }, POLL_MS);
}
