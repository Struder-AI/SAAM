// The "current session" plan shared between MCP tool handlers and the
// local HTTP bridge that serves the workbench. One process holds this in
// memory; it's also written to .saam/session.json so it survives if the
// adapter process restarts mid-session. This is deliberately not a
// general-purpose store — one adapter process holds exactly one current
// session, matching one workbench tab watching it.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "../../../registry/discover.mjs";

const SESSION_PATH = join(REPO_ROOT, ".saam", "session.json");

let cached = null;

export async function getSession() {
  if (cached) return cached;
  try {
    cached = JSON.parse(await readFile(SESSION_PATH, "utf8"));
  } catch {
    cached = null;
  }
  return cached;
}

export async function setSession(plan) {
  cached = plan;
  await mkdir(dirname(SESSION_PATH), { recursive: true });
  await writeFile(SESSION_PATH, JSON.stringify(plan, null, 2) + "\n", "utf8");
  return plan;
}
