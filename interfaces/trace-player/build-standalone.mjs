// Bundles the trace player into a single self-contained HTML file, with
// one or more traces baked in.
//
// The point is handing someone a preview they can open. Reviewing a
// toolpath should not require cloning a repo and installing a toolchain,
// and a reviewer who cannot easily look is a reviewer who signs off on
// what they were told rather than on what they saw.
//
//   node interfaces/trace-player/build-standalone.mjs [out.html]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { translate } from "../../machines/reference-dobot-mg400-struderbot/postprocessor/generator.mjs";
import { readDobotLua } from "../../machines/reference-dobot-mg400-struderbot/trace/reader.mjs";
import {
  checkExtrusionSpeedConsistency,
  checkStationaryExtrusion,
  comparePlanToTrace,
} from "../../schemas/motion-trace/trace-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const read = (relativePath) => readFileSync(resolve(repo, relativePath), "utf8");

/** Strip ESM syntax so the modules can be concatenated into one script. */
function inlineModule(source) {
  return source
    .replace(/^\s*import\s+[^;]*?;\s*$/gm, "")
    .replace(/^export\s+\{[^}]*\};\s*$/gm, "")
    .replace(/^export\s+/gm, "");
}

// The Lua reader is plain ES modules with no Node APIs, so the same code
// that runs in CI runs in the page. That is what makes the standalone file
// a viewer rather than a slideshow: you can drop your own global.lua and
// src1.lua onto it and watch those, and what you watch is byte-for-byte
// the reader the tests exercise.
export function buildStandalone({ traces, title = "SAAM toolpath preview" }) {
  const sources = [
    "schemas/motion-trace/trace-lib.mjs",
    "machines/reference-dobot-mg400-struderbot/trace/lua-subset.mjs",
    "machines/reference-dobot-mg400-struderbot/trace/reader.mjs",
  ]
    .map((path) => `// ---- ${path}\n${inlineModule(read(path))}`)
    .join("\n\n");

  const player = inlineModule(read("interfaces/trace-player/player.mjs"));
  const shell = read("interfaces/trace-player/shell.html");

  // Replacer functions, not strings: "$&" and friends are special in a
  // string replacement, and this source is full of template literals.
  const put = (haystack, token, value) => haystack.replace(token, () => value);

  let html = put(shell, "/*__TRACE_LIB__*/", sources);
  html = put(html, "/*__PLAYER__*/", player);
  html = put(html, "/*__TRACES__*/", `const TRACES = ${JSON.stringify(traces)};`);
  return html.replace(/__TITLE__/g, () => title);
}

/** The reference plans, traced, with their findings attached. */
export function referenceTraces() {
  const fixture = JSON.parse(
    read("machines/reference-dobot-mg400-struderbot/postprocessor/examples/approved-box-plan.json")
  );
  const { plan, instanceProfile } = fixture.input;
  const generated = translate({ plan, instanceProfile });

  const box = readDobotLua({ files: generated.files, instanceProfile });

  // A helix: one continuous extrusion window whose height changes through
  // every move. Included because it is the case a layer-based previewer
  // cannot show, and the case SAAM's operations are meant to produce.
  const helix = readDobotLua({
    files: { "global.lua": generated.files["global.lua"], "src1.lua": HELIX_SRC },
    instanceProfile,
  });

  return [
    {
      id: "reference-box",
      name: "Reference box — as the post-processor emits it today",
      note:
        "The plan this comes from is the committed golden fixture. Geometry matches the plan exactly; " +
        "watch the speed instead.",
      trace: box,
      findings: [
        ...comparePlanToTrace(plan, box),
        ...checkExtrusionSpeedConsistency(box),
        ...checkStationaryExtrusion(box),
      ],
    },
    {
      id: "helix",
      name: "Helical wall — non-planar, no layers at all",
      note:
        "Height rises through every move, so there is no layer to group by. Time is the only ordering " +
        "a preview can use.",
      trace: helix,
      findings: [...checkExtrusionSpeedConsistency(helix), ...checkStationaryExtrusion(helix)],
    },
  ];
}

const HELIX_SRC = `
function RunPlan()
  local r0 = 180
  MovJ(P(34, 0, 26, r0), { SpeedJ = JUMP_SPEED, AccJ = JUMP_ACCEL })
  J(14, 0, 6, r0)
  PenOn()
  for i = 0, 288 do
    local a = i * 0.0873
    L(14 * math.cos(a), 14 * math.sin(a), 1 + i * 0.0625, r0)
  end
  PenOff()
  J(34, 0, 26, r0)
end
`;

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("build-standalone.mjs")) {
  const out = resolve(process.cwd(), process.argv[2] ?? "saam-toolpath-preview.html");
  mkdirSync(dirname(out), { recursive: true });
  const html = buildStandalone({ traces: referenceTraces() });
  writeFileSync(out, html, "utf8");
  console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} kB)`);
}
