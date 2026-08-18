// Loopback-only local HTTP server: serves the reference workbench's
// built static files and a tiny same-origin session API so the workbench
// can watch and approve the current session without any manual file
// export/import. This is the one piece of this adapter with a network
// surface — see docs/architecture/agent-safety-boundary.md, which this
// file's behavior must stay consistent with:
//
// - binds to 127.0.0.1 only, never 0.0.0.0;
// - serves only interfaces/reference-workbench/dist (read-only) plus
//   the session endpoints below — no arbitrary filesystem access;
// - Two write paths, both narrow. POST /api/session/approve can only
//   ever produce a scoped, hashed approval record via plan-lib.mjs's
//   buildApprovalRecord — the exact same code path and the exact same
//   rules (non-empty approver, non-implying scopes) as a human clicking
//   the button would go through. It cannot be used to inject arbitrary
//   plan content — it only approves the session already held server-side.
//   POST /api/session/clear does exactly one thing: sets the session to
//   null. Neither endpoint accepts plan content from the request body.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { REPO_ROOT } from "../../../registry/discover.mjs";
import { buildApprovalRecord, applyApproval } from "../../../schemas/process-plan/plan-lib.mjs";
import { getSession, setSession } from "./session.mjs";

const WORKBENCH_DIST = join(REPO_ROOT, "interfaces", "reference-workbench", "dist");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  // normalize() collapses ".." segments so a crafted request path can't
  // escape WORKBENCH_DIST; this server has no other filesystem exposure.
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(WORKBENCH_DIST, safePath);
  if (!filePath.startsWith(WORKBENCH_DIST)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    const type = MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    try {
      // SPA fallback: unknown paths resolve to index.html.
      const data = await readFile(join(WORKBENCH_DIST, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(data);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end(
        `Not found, and the workbench hasn't been built yet. Run "npm run build" in interfaces/reference-workbench/ first.`
      );
    }
  }
}

export function startHttpBridge({ port = 4700 } = {}) {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/api/session") {
      const session = await getSession();
      sendJson(res, 200, { session });
      return;
    }
    if (req.method === "POST" && req.url === "/api/session/clear") {
      // The workbench's own "Clear" button needs this — without it, the
      // button only cleared the tab's local view while the adapter kept
      // serving the same plan from .saam/session.json, and the next poll
      // (every 1.5s) silently brought it right back. Clearing here is
      // exactly what setSession(null) already does for a fresh session:
      // getSession() reads a literal `null` back and returns it as-is.
      await setSession(null);
      sendJson(res, 200, { session: null });
      return;
    }
    if (req.method === "POST" && req.url === "/api/session/approve") {
      try {
        const { scope, approvedBy } = JSON.parse(await readBody(req));
        const session = await getSession();
        if (!session) {
          sendJson(res, 409, { error: "No current session to approve." });
          return;
        }
        const record = await buildApprovalRecord(session, { scope, approvedBy });
        const approved = applyApproval(session, record);
        await setSession(approved);
        sendJson(res, 200, { session: approved });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405).end("Method not allowed");
      return;
    }
    await serveStatic(req, res);
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, port, url: `http://127.0.0.1:${port}/` }));
  });
}
