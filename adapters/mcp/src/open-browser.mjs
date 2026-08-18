// Opens the platform default browser to a local URL. Fire-and-forget by
// design: if it fails (headless environment, unusual platform), the
// caller still has the URL to hand the operator directly — this is a
// convenience, not something correctness depends on.

import { spawn } from "node:child_process";

export function openBrowser(url) {
  // Escape hatch for automated tests/CI, so they don't pop a real
  // browser window on whatever machine runs them.
  if (process.env.SAAM_NO_AUTO_OPEN) return false;
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const args = platform === "win32" ? ["", url] : [url];
  try {
    const child = spawn(command, args, { shell: platform === "win32", stdio: "ignore", detached: true });
    child.on("error", () => {
      // Swallowed on purpose — see module comment.
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
