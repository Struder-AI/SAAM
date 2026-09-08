import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildStandalone, referenceTraces } from "../../interfaces/trace-player/build-standalone.mjs";

const committed = fileURLToPath(new URL("../../interfaces/trace-player/preview.html", import.meta.url));

// Same guard registry.json gets: rebuild it here and fail on any drift.
// The committed preview is the copy someone actually opens — a reviewer
// with no toolchain, or anyone reading the repo on the web — so it going
// stale against the sources it inlines is a real defect, not untidiness.
test("trace-player: the committed preview matches a fresh build", () => {
  const rebuilt = buildStandalone({ traces: referenceTraces() });
  assert.equal(
    rebuilt,
    readFileSync(committed, "utf8"),
    "interfaces/trace-player/preview.html is stale — run `npm run build-preview -- interfaces/trace-player/preview.html`"
  );
});

test("trace-player: the standalone carries no external requests", () => {
  const html = readFileSync(committed, "utf8");
  assert.equal(/<script[^>]+\bsrc=/i.test(html), false, "no external scripts");
  assert.equal(/<link[^>]+\bhref=/i.test(html), false, "no external stylesheets");
  assert.equal(/\bfetch\s*\(|XMLHttpRequest/.test(html), false, "nothing phones home");
});

test("trace-player: the standalone ships the reader, not just baked-in traces", () => {
  // What makes it a viewer rather than a slideshow: a visitor can drop
  // their own Lua on it and the page reads it with the same reader the
  // rest of this suite exercises.
  const html = readFileSync(committed, "utf8");
  for (const symbol of ["function readDobotLua", "class LuaRuntime", "function createTracePlayer"]) {
    assert.ok(html.includes(symbol), `expected the standalone to inline ${symbol}`);
  }
});
