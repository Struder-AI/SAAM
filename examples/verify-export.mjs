#!/usr/bin/env node
// Reads an exported program back and checks it against the plan it came
// from — step 7 of docs/authoring/process-plan-workflow.md.
//
// Why this exists as its own step: everything a human approves is the
// *plan*. The post-processor's output is the thing that actually runs,
// and until something reads it back, nothing has looked at it. The
// coordinates can be perfect and the program still wrong — see the
// speed check below.
//
// Run:
//   node examples/verify-export.mjs <approved-plan.json> [instance-profile.json]
//   node examples/verify-export.mjs --lua <dir-with-global.lua-and-src1.lua>
//
// Exits non-zero when anything is flagged, so it can gate a script.

import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

import { translate } from "../machines/reference-dobot-mg400-struderbot/postprocessor/generator.mjs";
import { readDobotLua } from "../machines/reference-dobot-mg400-struderbot/trace/reader.mjs";
import {
  validateTraceShape,
  comparePlanToTrace,
  checkExtrusionSpeedConsistency,
  checkStationaryExtrusion,
} from "../schemas/motion-trace/trace-lib.mjs";

const args = process.argv.slice(2);

if (!args.length || args.includes("--help") || args.includes("-h")) {
  console.log(
    [
      "Usage:",
      "  node examples/verify-export.mjs <approved-plan.json> [instance-profile.json]",
      "  node examples/verify-export.mjs --lua <directory>",
      "",
      "The first form post-processes the plan and checks the result against it.",
      "The second reads Lua you already have, and checks what it can without a plan.",
    ].join("\n")
  );
  process.exit(args.length ? 0 : 1);
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

let plan = null;
let files;
let instanceProfile = null;

if (args[0] === "--lua") {
  const directory = args[1];
  if (!directory) {
    console.error("--lua needs a directory containing global.lua and src1.lua");
    process.exit(1);
  }
  files = Object.fromEntries(
    readdirSync(directory)
      .filter((name) => extname(name) === ".lua")
      .map((name) => [name, readFileSync(join(directory, name), "utf8")])
  );
  if (!Object.keys(files).length) {
    console.error(`no .lua files in ${directory}`);
    process.exit(1);
  }
} else {
  const loaded = readJson(args[0]);
  // A post-processor example fixture wraps both in `input`; accept it
  // directly so there is something to point at that needs no setup.
  plan = loaded.input?.plan ?? loaded;
  instanceProfile = args[1] ? readJson(args[1]) : loaded.input?.instanceProfile ?? null;
  files = translate({ plan, instanceProfile }).files;
}

const trace = readDobotLua({ files, instanceProfile });

const shape = validateTraceShape(trace);
if (!shape.valid) {
  console.error("The trace is malformed, which is a bug in the reader, not in the plan:");
  for (const error of shape.errors) console.error(`  ${error}`);
  process.exit(2);
}

const findings = [
  // Geometry first: if the export moved a point, nothing else matters.
  ...(plan ? comparePlanToTrace(plan, trace) : []),
  // Then how it gets there, which geometry alone cannot show.
  ...checkExtrusionSpeedConsistency(trace),
  ...checkStationaryExtrusion(trace),
];

const t = trace.totals;
console.log(`Read ${t.segments} moves from ${trace.source.files.join(", ")}\n`);
console.log(`  extruding        ${t.extrudingLengthMm.toFixed(1)} mm over ${t.extrudingSegments} moves`);
console.log(`  travel           ${t.travelLengthMm.toFixed(1)} mm over ${t.travelSegments} moves`);
console.log(`  still, relay on  ${t.extrudingDwellS.toFixed(2)} s`);
console.log(`  run time         ${t.durationS.toFixed(2)} s${trace.kinematics?.assumed ? "  (on assumed machine limits)" : ""}`);
console.log(`  approximate      ${t.approximateSegments} moves drawn straight that are not straight`);
console.log(`  extrusion relay  ${trace.source.extrusionOutput ?? "unknown"} (${trace.source.extrusionOutputDeterminedBy})`);

if (!plan) {
  console.log("\nNo plan given, so geometry was not compared — only the motion was checked.");
}

for (const warning of trace.warnings) {
  console.log(`\n[${warning.code}] ${warning.message}`);
}

if (!findings.length) {
  console.log("\nNothing flagged.");
  console.log(
    "This says the exported program commands what the plan described. It does not say the " +
      "machine can run it safely — see docs/authoring/evidence-labels.md."
  );
  process.exit(0);
}

console.log(`\n${findings.length} finding${findings.length === 1 ? "" : "s"}:\n`);
for (const finding of findings) {
  console.log(`  [${finding.code}] ${finding.message}`);
  const at = finding.source ?? finding.slowest?.[0]?.source;
  if (at?.file) console.log(`    first seen at ${at.file}:${at.line}`);
  console.log("");
}

console.log(
  "These describe the post-processor's output, not the plan. Report them; do not hand-edit " +
    "the generated program — an edited export is a file no plan corresponds to."
);
process.exit(1);
