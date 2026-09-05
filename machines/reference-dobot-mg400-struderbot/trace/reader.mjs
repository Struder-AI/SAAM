// Reads DobotStudio Pro Lua back into a machine-neutral motion trace
// (../../../schemas/motion-trace/motion-trace.schema.json).
//
// This is the inverse of ../postprocessor/generator.mjs and, like it, is
// the only layer allowed to know anything about this machine. It reads or
// refuses; it never repairs. If the Lua does something this reader cannot
// account for, the read fails with a file and line rather than producing a
// preview that is quietly wrong.
//
// The trace is ordered by execution, not by height. Nothing here assumes
// planar layers: a segment is whatever the controller was told to move
// next, and index order is deposition order.

import { LuaRuntime, LuaTable, standardLibrary, LuaSubsetError } from "./lua-subset.mjs";
import { motionProfile } from "../../../schemas/motion-trace/trace-lib.mjs";

export const TRACE_SCHEMA_VERSION = 1;
export const READER_ID = "dobot-lua-trace-reader";
export const READER_VERSION = "0.1.0";

// DobotStudio Pro expresses SpeedL/SpeedJ/AccL/AccJ as a percentage of the
// controller's configured maximum, not as mm/s. Turning a percentage into a
// wall-clock duration therefore needs the machine's actual limits, and this
// machine's manifest does not currently carry them (see
// schemas/manifests/machine-manifest.schema.json — modelConstraints has no
// velocity or acceleration fields).
//
// So the defaults below are declared, not discovered. Every trace records
// which kinematics it used and whether they were assumed, and durations are
// only as trustworthy as those numbers. Distances, ordering, and extrusion
// state do not depend on them at all.
export const ASSUMED_KINEMATICS = {
  maxLinearSpeedMmS: 1000,
  maxLinearAccelMmS2: 10000,
  maxJointSpeedMmS: 1000,
  maxJointAccelMmS2: 10000,
  sourceNote:
    "Dobot MG400 published max TCP speed is 1000 mm/s at rated payload. " +
    "Acceleration is not published; 10000 mm/s^2 is a placeholder. " +
    "Replace both with measured values before treating durations as real.",
  assumed: true,
};

const EPSILON_MM = 1e-6;

class TraceError extends Error {
  constructor(message, { file, line } = {}) {
    super(`${file ?? "<lua>"}:${line ?? "?"}: ${message}`);
    this.name = "TraceError";
    this.file = file ?? null;
    this.line = line ?? null;
  }
}

/**
 * Execute a Dobot Lua program and return the motion it commands.
 *
 * @param {object} args
 * @param {Record<string,string>} args.files - the program, keyed by filename
 *   ("global.lua", "src0.lua", "src1.lua"). Matches the shape returned by
 *   the post-processor's translate().
 * @param {string} [args.entry] - the global function that runs the plan.
 * @param {string} [args.extrusionOutput] - the DO port that drives extrusion.
 *   When omitted, taken from instanceProfile, then inferred (see
 *   resolveExtrusionOutput).
 * @param {object} [args.instanceProfile] - the same profile handed to the
 *   post-processor; only its io.extrusionRelayOutput is read.
 * @param {object} [args.kinematics] - overrides for ASSUMED_KINEMATICS.
 * @param {{x:number,y:number,z:number}} [args.origin] - where the tool starts.
 * @returns {object} a motion trace
 */
export function readDobotLua({
  files,
  entry = "RunPlan",
  extrusionOutput = null,
  instanceProfile = null,
  kinematics: kinematicsOverride = {},
  origin = { x: 0, y: 0, z: 0 },
} = {}) {
  if (!files || typeof files !== "object") {
    throw new TraceError("no Lua files were given to read");
  }

  const kinematics = { ...ASSUMED_KINEMATICS, ...kinematicsOverride };
  if (Object.keys(kinematicsOverride).length > 0) kinematics.assumed = false;

  const state = {
    position: { ...origin },
    time: 0,
    segments: [],
    events: [],
    warnings: [],
    kinematics,
  };

  const runtime = new LuaRuntime({ host: { ...standardLibrary(), ...controllerBindings(state) } });

  // Order matters: definitions, then the plan body, then the init chunk
  // (which calls PenOff before anything moves), then the plan itself.
  const loadOrder = ["global.lua", "src1.lua", "src0.lua"];
  const loaded = [];
  for (const name of loadOrder) {
    if (typeof files[name] !== "string") continue;
    runtime.load(files[name], name);
    loaded.push(name);
  }
  for (const name of Object.keys(files)) {
    if (loaded.includes(name)) continue;
    runtime.load(files[name], name);
    loaded.push(name);
  }

  if (!runtime.hasGlobal(entry)) {
    throw new TraceError(
      `the program defines no "${entry}" function, so there is nothing to preview. ` +
        `Loaded: ${loaded.join(", ") || "(nothing)"}.`
    );
  }
  runtime.call(entry);

  const extrusion = resolveExtrusionOutput({
    declared: extrusionOutput ?? instanceProfile?.io?.extrusionRelayOutput ?? null,
    events: state.events,
    warnings: state.warnings,
  });
  applyExtrusionState(state, extrusion.port);

  return finalize(state, { files: loaded, entry, extrusion });
}

/**
 * Decide which digital output means "material is flowing".
 *
 * Declared beats inferred, always. Inference only fires when exactly one
 * port is driven both high and low across the program — an unambiguous
 * on/off window. Anything else is reported rather than guessed at, because
 * a preview that mislabels travel as extrusion is worse than one that says
 * it does not know.
 */
export function resolveExtrusionOutput({ declared, events, warnings = [] }) {
  const driven = new Map();
  for (const event of events) {
    if (event.kind !== "digital-output") continue;
    if (!driven.has(event.port)) driven.set(event.port, new Set());
    driven.get(event.port).add(event.value === 0 ? 0 : 1);
  }

  if (declared) {
    if (!driven.has(declared)) {
      warnings.push({
        code: "no-extrusion-output",
        message:
          `The program never drove digital output "${declared}", so every move in this preview is ` +
          `shown as travel. Ports it did drive: ${[...driven.keys()].join(", ") || "(none)"}.`,
      });
    }
    return { port: declared, determinedBy: "declared" };
  }

  const toggled = [...driven.entries()].filter(([, values]) => values.has(0) && values.has(1)).map(([port]) => port);
  if (toggled.length === 1) {
    return { port: toggled[0], determinedBy: "inferred" };
  }

  warnings.push({
    code: "ambiguous-extrusion-output",
    message:
      toggled.length === 0
        ? "No digital output was driven both on and off, so this preview cannot tell printing from " +
          "travel. Pass extrusionOutput (or an instanceProfile) to say which port drives extrusion."
        : `More than one digital output is switched on and off (${toggled.join(", ")}), so this preview ` +
          "cannot tell which one drives extrusion. Pass extrusionOutput to say which.",
    candidates: toggled,
  });
  return { port: null, determinedBy: "unknown" };
}

/**
 * Stamp extrusion state onto each segment, in execution order.
 *
 * Done as a pass over the finished trace rather than during execution so
 * that which port counts as "extruding" is a decision made once, with the
 * whole program in view, instead of being baked in as the Lua runs.
 */
function applyExtrusionState(state, port) {
  let extruding = false;
  const byIndex = new Map();
  for (const event of state.events) {
    if (event.kind !== "digital-output" || event.port !== port) continue;
    if (!byIndex.has(event.segmentIndex)) byIndex.set(event.segmentIndex, []);
    byIndex.get(event.segmentIndex).push(event);
  }

  state.segments.forEach((segment, index) => {
    for (const event of byIndex.get(index) ?? []) {
      const on = event.value !== 0;
      if (on !== extruding) {
        extruding = on;
        state.events.push({
          tS: segment.tStartS,
          kind: on ? "extrusion-on" : "extrusion-off",
          port,
          segmentIndex: index,
          source: event.source,
        });
      }
    }
    segment.extruding = extruding;
  });

  // Anything switched after the last segment still belongs on the timeline.
  for (const event of byIndex.get(state.segments.length) ?? []) {
    const on = event.value !== 0;
    if (on !== extruding) {
      extruding = on;
      state.events.push({
        tS: round(state.time, 6),
        kind: on ? "extrusion-on" : "extrusion-off",
        port,
        segmentIndex: state.segments.length,
        source: event.source,
      });
    }
  }

  state.events.sort((a, b) => a.segmentIndex - b.segmentIndex || a.tS - b.tS);
}

// -------------------------------------------------------- host bindings

function controllerBindings(state) {
  const point = (value, context, what) => readPoint(value, context, what);

  return {
    // Linear interpolation in Cartesian space: the tool follows the straight
    // line between the two points, so the preview can draw it exactly.
    MovL: (args, context) => {
      const target = point(args[0], context, "MovL");
      const options = readOptions(args[1]);
      addMove(state, {
        kind: "linear",
        to: target,
        speedPercent: options.SpeedL ?? options.Speed ?? null,
        accelPercent: options.AccL ?? options.Acc ?? null,
        blend: options.CP ?? null,
        maxSpeed: state.kinematics.maxLinearSpeedMmS,
        maxAccel: state.kinematics.maxLinearAccelMmS2,
        pathFidelity: "exact",
        context,
      });
    },

    // Joint interpolation: each axis moves independently, so the tool
    // sweeps a curve whose shape depends on the arm's kinematics. This
    // reader does not model MG400 kinematics, so the segment is recorded
    // as a straight line and flagged approximate rather than drawn as if
    // it were the real path.
    MovJ: (args, context) => {
      const target = point(args[0], context, "MovJ");
      const options = readOptions(args[1]);
      addMove(state, {
        kind: "joint",
        to: target,
        speedPercent: options.SpeedJ ?? options.Speed ?? null,
        accelPercent: options.AccJ ?? options.Acc ?? null,
        blend: options.CP ?? null,
        maxSpeed: state.kinematics.maxJointSpeedMmS,
        maxAccel: state.kinematics.maxJointAccelMmS2,
        pathFidelity: "approximate",
        note: "joint-interpolated; the real tool path bows away from this straight line",
        context,
      });
    },

    // Arc through an intermediate point to an end point.
    Arc3: (args, context) => {
      const via = point(args[0], context, "Arc3");
      const target = point(args[1], context, "Arc3");
      const options = readOptions(args[2]);
      addMove(state, {
        kind: "arc",
        to: target,
        via,
        speedPercent: options.SpeedL ?? options.Speed ?? null,
        accelPercent: options.AccL ?? options.Acc ?? null,
        blend: options.CP ?? null,
        maxSpeed: state.kinematics.maxLinearSpeedMmS,
        maxAccel: state.kinematics.maxLinearAccelMmS2,
        pathFidelity: "exact",
        context,
      });
    },

    // Full circle through two further points, repeated `count` times.
    Circle3: (args, context) => {
      const via = point(args[0], context, "Circle3");
      const through = point(args[1], context, "Circle3");
      const count = typeof args[2] === "number" ? args[2] : 1;
      const options = readOptions(args[3]);
      for (let turn = 0; turn < count; turn += 1) {
        addMove(state, {
          kind: "arc",
          to: { ...state.position },
          via,
          through,
          fullCircle: true,
          speedPercent: options.SpeedL ?? options.Speed ?? null,
          accelPercent: options.AccL ?? options.Acc ?? null,
          blend: options.CP ?? null,
          maxSpeed: state.kinematics.maxLinearSpeedMmS,
          maxAccel: state.kinematics.maxLinearAccelMmS2,
          pathFidelity: "exact",
          context,
        });
      }
    },

    // Every digital output is recorded. Which one means "extruding" is
    // decided afterwards, once the whole program has been seen.
    DO: (args, context) => {
      state.events.push({
        tS: round(state.time, 6),
        kind: "digital-output",
        port: String(args[0]),
        value: Number(args[1]),
        segmentIndex: state.segments.length,
        source: siteOf(context),
      });
    },

    // A dwell holds position while time — and, if the relay is on,
    // material — keeps running. Recorded as a zero-length segment so it
    // occupies real time on the animation's clock.
    Wait: (args, context) => {
      const ms = Number(args[0] ?? 0);
      if (!Number.isFinite(ms) || ms < 0) {
        throw new TraceError(`Wait() needs a non-negative number of milliseconds`, siteOf(context));
      }
      const seconds = ms / 1000;
      pushSegment(state, {
        kind: "dwell",
        from: { ...state.position },
        to: { ...state.position },
        lengthMm: 0,
        speedMmS: 0,
        accelMmS2: 0,
        peakSpeedMmS: 0,
        durationS: seconds,
        pathFidelity: "exact",
        blend: null,
        context,
      });
    },

    // Blocking sync: no motion, no modelled time.
    Sync: () => {},
  };
}

// ------------------------------------------------------------- geometry

function readPoint(value, context, caller) {
  if (!(value instanceof LuaTable)) {
    throw new TraceError(`${caller}() expects a point table`, siteOf(context));
  }
  const coordinate = value.get("coordinate");
  const source = coordinate instanceof LuaTable ? coordinate : value;
  const [x, y, z, r] = source.toArray();
  for (const [name, component] of [["x", x], ["y", y], ["z", z]]) {
    if (typeof component !== "number" || !Number.isFinite(component)) {
      throw new TraceError(
        `${caller}() was given a point whose ${name} is not a finite number`,
        siteOf(context)
      );
    }
  }
  return { x, y, z, r: typeof r === "number" ? r : null };
}

function readOptions(value) {
  if (!(value instanceof LuaTable)) return {};
  const options = {};
  for (const [key, entry] of value.map.entries()) {
    if (typeof key === "string" && typeof entry === "number") options[key] = entry;
  }
  return options;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Arc length through three points in 3D. Returns null when the points are
 * collinear or coincident, in which case the caller falls back to a chord.
 */
export function arcLength(start, via, end, { fullCircle = false } = {}) {
  const ab = subtract(via, start);
  const ac = subtract(end, start);
  const cross = crossProduct(ab, ac);
  const crossLength = magnitude(cross);
  if (crossLength < 1e-9) return null;

  const a = distance(via, end);
  const b = distance(start, end);
  const c = distance(start, via);
  const radius = (a * b * c) / (2 * crossLength);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  if (fullCircle) return 2 * Math.PI * radius;

  // Chord -> central angle, taking the long way round when the via point
  // lies outside the minor arc.
  const half = Math.min(1, b / (2 * radius));
  let theta = 2 * Math.asin(half);
  if (dot(subtract(via, midpoint(start, end)), subtract(midpoint(start, end), circumcenter(start, via, end))) > 0) {
    theta = 2 * Math.PI - theta;
  }
  return radius * theta;
}

function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function magnitude(v) { return Math.hypot(v.x, v.y, v.z); }
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; }
function crossProduct(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function circumcenter(a, b, c) {
  const ac = subtract(c, a);
  const ab = subtract(b, a);
  const abXac = crossProduct(ab, ac);
  const denominator = 2 * dot(abXac, abXac);
  if (Math.abs(denominator) < 1e-12) return midpoint(a, c);
  const term1 = scale(crossProduct(abXac, ab), dot(ac, ac));
  const term2 = scale(crossProduct(ac, abXac), dot(ab, ab));
  const offset = scale(add(term1, term2), 1 / denominator);
  return add(a, offset);
}

function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(v, k) { return { x: v.x * k, y: v.y * k, z: v.z * k }; }

// ------------------------------------------------------------ kinematics

function resolvePercent(percent, max, fallbackPercent) {
  const value = typeof percent === "number" && Number.isFinite(percent) ? percent : fallbackPercent;
  return (Math.max(0, Math.min(100, value)) / 100) * max;
}

// --------------------------------------------------------------- segments

function addMove(state, move) {
  const from = { ...state.position };
  const to = { x: move.to.x, y: move.to.y, z: move.to.z, r: move.to.r ?? null };

  let lengthMm = distance(from, to);
  let via = null;
  if (move.kind === "arc") {
    via = move.via;
    const computed = arcLength(from, move.via, move.through ?? to, { fullCircle: Boolean(move.fullCircle) });
    if (computed === null) {
      state.warnings.push({
        code: "degenerate-arc",
        message: "An arc's three points are collinear or coincident; measured as a straight chord instead.",
        source: siteOf(move.context),
      });
    } else {
      lengthMm = computed;
    }
  }

  const speedMmS = resolvePercent(move.speedPercent, move.maxSpeed, 100);
  const accelMmS2 = resolvePercent(move.accelPercent, move.maxAccel, 100);
  const { durationS, peakSpeedMmS } = motionProfile(lengthMm, speedMmS, accelMmS2);

  pushSegment(state, {
    kind: move.kind,
    from,
    to,
    via,
    lengthMm,
    speedPercent: move.speedPercent,
    accelPercent: move.accelPercent,
    speedMmS,
    accelMmS2,
    peakSpeedMmS,
    durationS,
    blend: move.blend,
    pathFidelity: move.pathFidelity,
    note: move.note ?? null,
    context: move.context,
  });

  state.position = { x: to.x, y: to.y, z: to.z };
}

function pushSegment(state, segment) {
  // Round the timeline first and take the duration from it, rather than
  // rounding all three independently. A sampler seeking to a segment's end
  // must land exactly on it; a stray fraction of a microsecond of
  // disagreement shows up as a non-zero speed at a full stop.
  const tStartS = round(state.time, 6);
  const tEndS = round(state.time + segment.durationS, 6);
  const durationS = tEndS - tStartS;
  state.segments.push({
    index: state.segments.length,
    kind: segment.kind,
    from: roundPoint(segment.from),
    to: roundPoint(segment.to),
    via: segment.via ? roundPoint(segment.via) : null,
    lengthMm: round(segment.lengthMm, 6),
    speedPercent: segment.speedPercent ?? null,
    accelPercent: segment.accelPercent ?? null,
    speedMmS: round(segment.speedMmS, 6),
    accelMmS2: round(segment.accelMmS2, 6),
    peakSpeedMmS: round(segment.peakSpeedMmS, 6),
    durationS,
    tStartS,
    tEndS,
    extruding: false, // stamped by applyExtrusionState once the port is known
    blend: segment.blend ?? null,
    pathFidelity: segment.pathFidelity,
    note: segment.note ?? null,
    ...sourceOf(segment.context),
  });
  state.time = tEndS;
}

/**
 * Where a segment came from, in two useful senses.
 *
 * `source` is the call in the plan body — the line an operator would point
 * at to say "this move". `emittedBy` is the controller primitive that
 * actually produced it, which may sit inside a helper in global.lua. The
 * two differ exactly when the plan calls a project helper rather than a
 * primitive, which is the normal case here, and conflating them would make
 * every move in the program appear to come from the same line of
 * global.lua.
 */
function sourceOf(context) {
  if (!context) return { source: null, emittedBy: null };
  const innermost = { file: context.file ?? null, line: context.line ?? null, call: context.name ?? null };
  const site = siteOf(context);
  const sameFrame = site.file === innermost.file && site.line === innermost.line;
  return { source: site, emittedBy: sameFrame ? null : innermost };
}

/** The outermost frame with a real source line: the call in the plan body. */
function siteOf(context) {
  if (!context) return { file: null, line: null, call: null };
  const frames = (context.stack ?? []).filter((frame) => frame.line !== null && frame.line !== undefined);
  if (frames.length) return { ...frames[0] };
  return { file: context.file ?? null, line: context.line ?? null, call: context.name ?? null };
}

function round(value, places) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function roundPoint(point) {
  return {
    x: round(point.x, 6),
    y: round(point.y, 6),
    z: round(point.z, 6),
    ...(point.r === null || point.r === undefined ? {} : { r: round(point.r, 6) }),
  };
}

// ---------------------------------------------------------------- output

function finalize(state, { files, entry, extrusion }) {
  const extruding = state.segments.filter((s) => s.extruding && s.lengthMm > EPSILON_MM);
  const travel = state.segments.filter((s) => !s.extruding && s.lengthMm > EPSILON_MM);
  const dwells = state.segments.filter((s) => s.kind === "dwell");
  const extrudingDwellS = dwells
    .filter((s) => s.extruding)
    .reduce((total, s) => total + s.durationS, 0);

  // Without a CP (continuous-path) parameter the controller decelerates to
  // zero at every waypoint. With a constant-rate extruder that is not a
  // timing detail, it is a deposit, so it is counted rather than left for
  // the operator to infer from the speed column.
  const unblended = extruding.filter((s) => s.blend === null);
  if (unblended.length) {
    state.warnings.push({
      code: "unblended-extruding-moves",
      count: unblended.length,
      message:
        `${unblended.length} extruding moves carry no CP (continuous-path) parameter, so the ` +
        "controller decelerates to a full stop at each of their endpoints while material keeps " +
        "flowing. Expect a deposit at every one of those waypoints.",
    });
  }

  const bounds = boundsOf(state.segments);

  return {
    traceSchemaVersion: TRACE_SCHEMA_VERSION,
    source: {
      machineId: "reference-dobot-mg400-struderbot",
      readerId: READER_ID,
      readerVersion: READER_VERSION,
      files,
      entry,
      extrusionOutput: extrusion.port,
      extrusionOutputDeterminedBy: extrusion.determinedBy,
    },
    units: { length: "mm", time: "s", speed: "mm/s", acceleration: "mm/s^2" },
    kinematics: state.kinematics,
    bounds,
    totals: {
      segments: state.segments.length,
      durationS: round(state.time, 6),
      extrudingLengthMm: round(extruding.reduce((t, s) => t + s.lengthMm, 0), 4),
      travelLengthMm: round(travel.reduce((t, s) => t + s.lengthMm, 0), 4),
      extrudingSegments: extruding.length,
      travelSegments: travel.length,
      dwellS: round(dwells.reduce((t, s) => t + s.durationS, 0), 6),
      extrudingDwellS: round(extrudingDwellS, 6),
      approximateSegments: state.segments.filter((s) => s.pathFidelity !== "exact").length,
    },
    segments: state.segments,
    events: state.events,
    warnings: state.warnings,
  };
}

function boundsOf(segments) {
  const points = [];
  for (const segment of segments) {
    points.push(segment.from, segment.to);
    if (segment.via) points.push(segment.via);
  }
  if (!points.length) return null;
  const axis = (key) => points.map((p) => p[key]);
  return {
    min: { x: Math.min(...axis("x")), y: Math.min(...axis("y")), z: Math.min(...axis("z")) },
    max: { x: Math.max(...axis("x")), y: Math.max(...axis("y")), z: Math.max(...axis("z")) },
  };
}

export { TraceError, LuaSubsetError };
