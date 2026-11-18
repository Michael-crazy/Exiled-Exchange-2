import { spawn } from "child_process";
import { app } from "electron";
import type { Logger } from "../RemoteLogger";

// Starts an elevated copy of this app through UAC and quits this one.
// If the user declines the UAC prompt, this instance keeps running.
export function relaunchAsAdmin(logger: Logger) {
  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const args = process.argv.slice(1);
  let command = `Start-Process -FilePath ${quote(process.execPath)} -Verb RunAs`;
  if (args.length) {
    command += ` -ArgumentList ${args.map(quote).join(",")}`;
  }

  // The elevated instance must be able to take the single instance lock.
  app.releaseSingleInstanceLock();
  const ps = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, stdio: "ignore" },
  );
  ps.on("exit", (code) => {
    if (code === 0) {
      app.quit();
    } else {
      logger.write("warn [Elevation] restart as administrator was cancelled");
      app.requestSingleInstanceLock();
    }
  });
}
