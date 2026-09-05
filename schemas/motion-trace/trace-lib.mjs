// Machine-neutral helpers over a motion trace (motion-trace.schema.json).
//
// Nothing here knows about Lua, G-code, or any particular machine. A
// previewer and a test both call into this file so that what an operator
// watches and what CI asserts are computed the same way — a preview that
// disagreed with the check that gates it would be worse than no preview.
//
// No function here assumes planar layers or a build direction. Time is the
// only ordering; height is just a coordinate.

const EPSILON = 1e-9;

// ------------------------------------------------------------ validation

export function validateTraceShape(trace) {
  const errors = [];
  const fail = (message) => errors.push(message);

  if (!trace || typeof trace !== "object") {
    return { valid: false, errors: ["trace is not an object"] };
  }
  if (trace.traceSchemaVersion !== 1) fail("traceSchemaVersion must be 1");
  if (!trace.source?.machineId) fail("source.machineId is required");
  if (!trace.source?.readerId) fail("source.readerId is required");
  if (trace.units?.length !== "mm") fail('units.length must be "mm"');
  if (trace.units?.time !== "s") fail('units.time must be "s"');
  if (!Array.isArray(trace.segments)) return { valid: false, errors: [...errors, "segments must be an array"] };

  let previousEnd = 0;
  trace.segments.forEach((segment, index) => {
    const at = `segments[${index}]`;
    if (segment.index !== index) fail(`${at}.index must equal its position in the array`);
    if (!["linear", "joint", "arc", "dwell"].includes(segment.kind)) fail(`${at}.kind is not a known kind`);
    if (!isPoint(segment.from)) fail(`${at}.from is not a point`);
    if (!isPoint(segment.to)) fail(`${at}.to is not a point`);
    if (!(segment.lengthMm >= 0)) fail(`${at}.lengthMm must be a non-negative number`);
    if (!(segment.durationS >= 0)) fail(`${at}.durationS must be a non-negative number`);
    if (!["exact", "approximate"].includes(segment.pathFidelity)) fail(`${at}.pathFidelity must be stated`);
    if (typeof segment.extruding !== "boolean") fail(`${at}.extruding must be a boolean`);

    // The timeline has to be contiguous or an animation cannot seek on it.
    if (Math.abs(segment.tStartS - previousEnd) > 1e-6) {
      fail(`${at}.tStartS (${segment.tStartS}) does not continue from the previous segment's end (${previousEnd})`);
    }
    if (Math.abs(segment.tEndS - (segment.tStartS + segment.durationS)) > 1e-6) {
      fail(`${at}.tEndS does not equal tStartS + durationS`);
    }
    previousEnd = segment.tEndS;
  });

  return { valid: errors.length === 0, errors };
}

function isPoint(value) {
  return (
    value &&
    typeof value === "object" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}

// -------------------------------------------------------------- sampling

/**
 * The symmetric trapezoidal velocity profile for a rest-to-rest move.
 *
 * Rest-to-rest is the honest default: a controller only carries speed
 * through a waypoint when the program asks it to (a CP or blend-radius
 * parameter). Absent that, it decelerates to zero at every point.
 *
 * A reader calls this to fill in a segment's duration; the sampler below
 * reads the same numbers back. Keeping one implementation is the reason a
 * preview and the checks that gate it cannot drift apart.
 */
export function motionProfile(lengthMm, speedMmS, accelMmS2) {
  if (!(lengthMm > EPSILON) || !(speedMmS > 0) || !(accelMmS2 > 0)) {
    return { durationS: 0, peakSpeedMmS: 0 };
  }
  const rampDistance = (speedMmS * speedMmS) / (2 * accelMmS2);
  if (2 * rampDistance <= lengthMm) {
    const cruise = (lengthMm - 2 * rampDistance) / speedMmS;
    return { durationS: (2 * speedMmS) / accelMmS2 + cruise, peakSpeedMmS: speedMmS };
  }
  // Too short to reach the commanded speed: accelerate, then brake.
  return { durationS: 2 * Math.sqrt(lengthMm / accelMmS2), peakSpeedMmS: Math.sqrt(accelMmS2 * lengthMm) };
}

/**
 * Distance travelled `t` seconds into a segment, under the symmetric
 * trapezoidal velocity profile implied by its peak speed and acceleration.
 *
 * This is what makes an animation worth watching: the tool visibly slows
 * into every waypoint the controller does not blend through. Interpolating
 * linearly would hide exactly the behaviour an operator is checking for.
 */
export function distanceInto(segment, t) {
  const { lengthMm, durationS, peakSpeedMmS, accelMmS2 } = segment;
  if (durationS <= EPSILON || lengthMm <= EPSILON) return lengthMm;
  const clamped = Math.max(0, Math.min(durationS, t));

  if (!(peakSpeedMmS > 0) || !(accelMmS2 > 0)) {
    return lengthMm * (clamped / durationS);
  }

  const ramp = peakSpeedMmS / accelMmS2;
  if (clamped <= ramp) return 0.5 * accelMmS2 * clamped * clamped;
  if (clamped >= durationS - ramp) {
    const remaining = durationS - clamped;
    return lengthMm - 0.5 * accelMmS2 * remaining * remaining;
  }
  return 0.5 * accelMmS2 * ramp * ramp + peakSpeedMmS * (clamped - ramp);
}

/**
 * The inverse of distanceInto: how long it takes to cover `distance`.
 *
 * Needed to move a cursor between the two timebases below without it
 * jumping — the position on the path has to survive the switch.
 */
export function timeInto(segment, distance) {
  const { lengthMm, durationS, peakSpeedMmS, accelMmS2 } = segment;
  if (durationS <= EPSILON || lengthMm <= EPSILON) return 0;
  const d = Math.max(0, Math.min(lengthMm, distance));
  if (!(peakSpeedMmS > 0) || !(accelMmS2 > 0)) return durationS * (d / lengthMm);

  const ramp = peakSpeedMmS / accelMmS2;
  const rampDistance = 0.5 * accelMmS2 * ramp * ramp;
  if (d <= rampDistance) return Math.sqrt((2 * d) / accelMmS2);
  if (d >= lengthMm - rampDistance) return durationS - Math.sqrt((2 * (lengthMm - d)) / accelMmS2);
  return ramp + (d - rampDistance) / peakSpeedMmS;
}

/** Speed at time `t` into a segment, for colouring or a readout. */
export function speedInto(segment, t) {
  const { durationS, peakSpeedMmS, accelMmS2 } = segment;
  if (durationS <= EPSILON || !(peakSpeedMmS > 0)) return 0;
  const clamped = Math.max(0, Math.min(durationS, t));
  if (!(accelMmS2 > 0)) return peakSpeedMmS;
  const ramp = peakSpeedMmS / accelMmS2;
  if (clamped <= ramp) return accelMmS2 * clamped;
  if (clamped >= durationS - ramp) return accelMmS2 * (durationS - clamped);
  return peakSpeedMmS;
}

/** A point a given fraction of the way along a segment's actual path. */
export function pointAlong(segment, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  if (segment.kind === "arc" && segment.via) {
    const arc = arcFrame(segment.from, segment.via, segment.to);
    if (arc) return arcPoint(arc, f);
  }
  return {
    x: segment.from.x + (segment.to.x - segment.from.x) * f,
    y: segment.from.y + (segment.to.y - segment.from.y) * f,
    z: segment.from.z + (segment.to.z - segment.from.z) * f,
  };
}

// ---------------------------------------------------------------- cursors
//
// A cursor is a position on the path: which segment, and how far into it.
// Everything that draws works from a cursor, so the same drawing code
// serves two different clocks.
//
// There are two, and the difference matters. The machine clock is real
// elapsed time, which is what you watch to judge dynamics: where the tool
// stalls, how long a dwell lasts, how much of the run is spent decelerating
// into waypoints. But it is a poor way to read the *shape* of a path,
// because a program with a hundredfold speed range spends almost all of its
// time on a handful of moves and flashes through the rest. Advancing at a
// constant distance per second instead gives every millimetre of the path
// equal screen time. Neither is the "true" view; they answer different
// questions, so the viewer offers both and says which is showing.

const PATH_PROFILES = new WeakMap();

/** Cumulative path length, so a distance can be turned into a cursor. */
export function pathProfile(trace) {
  let profile = PATH_PROFILES.get(trace);
  if (profile) return profile;
  const cumulative = [0];
  for (const segment of trace.segments ?? []) {
    cumulative.push(cumulative[cumulative.length - 1] + segment.lengthMm);
  }
  profile = { cumulative, totalMm: cumulative[cumulative.length - 1] };
  PATH_PROFILES.set(trace, profile);
  return profile;
}

export function cursorAtTime(trace, tS) {
  const segments = trace.segments ?? [];
  if (!segments.length) return null;
  const total = segments[segments.length - 1].tEndS;
  const t = Math.max(0, Math.min(total, tS));
  const index = search(segments.length, (i) => segments[i].tEndS >= t);
  const segment = segments[index];
  const into = t - segment.tStartS;
  const travelled = distanceInto(segment, into);
  return {
    segmentIndex: index,
    fraction: segment.lengthMm > EPSILON ? travelled / segment.lengthMm : 1,
    tS: t,
  };
}

export function cursorAtDistance(trace, distanceMm) {
  const segments = trace.segments ?? [];
  if (!segments.length) return null;
  const { cumulative, totalMm } = pathProfile(trace);
  const d = Math.max(0, Math.min(totalMm, distanceMm));
  const index = search(segments.length, (i) => cumulative[i + 1] >= d);
  const segment = segments[index];
  const into = d - cumulative[index];
  return {
    segmentIndex: index,
    fraction: segment.lengthMm > EPSILON ? into / segment.lengthMm : 1,
    distanceMm: d,
  };
}

/** Where a cursor sits on the machine clock, for switching timebases. */
export function cursorToTime(trace, cursor) {
  const segment = trace.segments[cursor.segmentIndex];
  return segment.tStartS + timeInto(segment, cursor.fraction * segment.lengthMm);
}

/** Where a cursor sits along the path, for switching timebases. */
export function cursorToDistance(trace, cursor) {
  const { cumulative } = pathProfile(trace);
  const segment = trace.segments[cursor.segmentIndex];
  return cumulative[cursor.segmentIndex] + cursor.fraction * segment.lengthMm;
}

function search(count, predicate) {
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (predicate(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** What the tool is doing at a cursor: position, speed, and which move. */
export function sampleAtCursor(trace, cursor) {
  if (!cursor) return null;
  const segment = trace.segments[cursor.segmentIndex];
  const tS = cursor.tS ?? cursorToTime(trace, cursor);
  return {
    tS,
    segmentIndex: cursor.segmentIndex,
    segment,
    fraction: cursor.fraction,
    point: pointAlong(segment, cursor.fraction),
    speedMmS: speedInto(segment, tS - segment.tStartS),
    extruding: segment.extruding,
  };
}

/**
 * Where the tool is at time `tS`, and what it is doing.
 *
 * Returns the segment in progress rather than only a position, so a caller
 * can show the operator which line of the program is running right now.
 */
export function sampleAt(trace, tS) {
  const cursor = cursorAtTime(trace, tS);
  return cursor ? sampleAtCursor(trace, cursor) : null;
}

/**
 * Everything deposited up to time `tS`, in the order it was laid down.
 *
 * The last entry is partial: it stops where the tool currently is. Callers
 * draw this list in order, which is what makes the result additively
 * coherent for a non-planar path — material appears when it was extruded,
 * not when it reaches a given height.
 */
export function depositedThrough(trace, tS, options = {}) {
  return depositedAt(trace, cursorAtTime(trace, tS), options);
}

/** As depositedThrough, but from a cursor — so it serves either timebase. */
export function depositedAt(trace, cursor, { includeTravel = false } = {}) {
  if (!cursor) return [];
  const out = [];
  for (let i = 0; i <= cursor.segmentIndex; i += 1) {
    const segment = trace.segments[i];
    if (segment.kind === "dwell") continue;
    if (!segment.extruding && !includeTravel) continue;
    const fraction = i < cursor.segmentIndex ? 1 : cursor.fraction;
    if (fraction <= EPSILON) continue;
    out.push({ segment, fraction, polyline: polylineOf(segment, fraction) });
  }
  return out;
}

/** A segment as drawable points; arcs are flattened, straight moves are not. */
export function polylineOf(segment, fraction = 1, { arcSegmentsPerRadian = 8 } = {}) {
  const f = Math.max(0, Math.min(1, fraction));
  if (segment.kind !== "arc" || !segment.via) {
    return [segment.from, pointAlong(segment, f)];
  }
  const arc = arcFrame(segment.from, segment.via, segment.to);
  if (!arc) return [segment.from, pointAlong(segment, f)];
  const steps = Math.max(2, Math.ceil(Math.abs(arc.theta) * f * arcSegmentsPerRadian));
  const points = [];
  for (let i = 0; i <= steps; i += 1) points.push(arcPoint(arc, (i / steps) * f));
  return points;
}

// -------------------------------------------------------------- arc math

/** Circle through three points, as a centre plus two orthogonal unit axes. */
export function arcFrame(start, via, end) {
  const ab = sub(via, start);
  const ac = sub(end, start);
  const normal = cross(ab, ac);
  const normalLength = length(normal);
  if (normalLength < 1e-9) return null;

  const centre = circumcentre(start, via, end, normal, normalLength);
  if (!centre) return null;

  const u = sub(start, centre);
  const radius = length(u);
  if (!(radius > 1e-9)) return null;

  const unitU = scale(u, 1 / radius);
  const unitN = scale(normal, 1 / normalLength);
  const unitV = cross(unitN, unitU);

  const angleOf = (p) => {
    const d = sub(p, centre);
    return Math.atan2(dot(d, unitV), dot(d, unitU));
  };
  const wrap = (a) => (a < 0 ? a + 2 * Math.PI : a);
  const viaAngle = wrap(angleOf(via));
  let endAngle = wrap(angleOf(end));
  // Go the way round that actually passes through the via point.
  if (endAngle < viaAngle) endAngle += 2 * Math.PI;

  return { centre, radius, unitU, unitV, theta: endAngle };
}

function arcPoint(arc, fraction) {
  const angle = arc.theta * fraction;
  return add(
    arc.centre,
    add(scale(arc.unitU, arc.radius * Math.cos(angle)), scale(arc.unitV, arc.radius * Math.sin(angle)))
  );
}

function circumcentre(a, b, c, normal, normalLength) {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const denominator = 2 * normalLength * normalLength;
  if (Math.abs(denominator) < 1e-12) return null;
  const term1 = scale(cross(normal, ab), dot(ac, ac));
  const term2 = scale(cross(ac, normal), dot(ab, ab));
  return add(a, scale(add(term1, term2), 1 / denominator));
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(v, k) { return { x: v.x * k, y: v.y * k, z: v.z * k }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function length(v) { return Math.hypot(v.x, v.y, v.z); }
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

// ---------------------------------------------------------------- checks

/**
 * Every extruding move within one extrusion window should be commanded at
 * the same speed.
 *
 * This is not a style rule. Under a constant-rate extruder — a relay-driven
 * one has no other mode — the deposited cross-section is A = Q / v. Two
 * extruding moves whose commanded speeds differ by a factor of k lay down
 * beads whose cross-sections differ by the same factor. A part meant to be
 * uniform therefore cannot be printed at two different speeds, and a
 * program that does so is describing a part nobody asked for.
 *
 * The check is deliberately blind to *which* speed is right: it reports the
 * disagreement and the lines responsible, and leaves the choice to whoever
 * reads it.
 */
export function checkExtrusionSpeedConsistency(trace, { toleranceRatio = 1.05 } = {}) {
  const findings = [];
  for (const window of extrusionWindows(trace)) {
    const moving = window.segments.filter((s) => s.lengthMm > 1e-6 && s.kind !== "dwell");
    if (moving.length < 2) continue;

    const speeds = moving.map((s) => s.speedMmS);
    const min = Math.min(...speeds);
    const max = Math.max(...speeds);
    if (min <= 0 || max / min <= toleranceRatio) continue;

    const slowest = moving.filter((s) => s.speedMmS <= min * toleranceRatio);
    const fastest = moving.filter((s) => s.speedMmS >= max / toleranceRatio);
    findings.push({
      code: "inconsistent-extrusion-speed",
      windowStartS: window.startS,
      windowEndS: window.endS,
      minSpeedMmS: min,
      maxSpeedMmS: max,
      ratio: Number((max / min).toFixed(3)),
      beadAreaRatio: Number((max / min).toFixed(3)),
      slowest: summarize(slowest),
      fastest: summarize(fastest),
      message:
        `Extrusion is on across moves commanded between ${min} and ${max} mm/s — a factor of ` +
        `${(max / min).toFixed(1)}. With a constant-rate extruder the bead cross-section goes as 1/v, so ` +
        `the fast moves lay down about ${(max / min).toFixed(1)}x less material per millimetre than the ` +
        `slow ones. ${describeSplit(slowest, fastest)}`,
    });
  }
  return findings;
}

function describeSplit(slowest, fastest) {
  const slowLines = uniqueCalls(slowest);
  const fastLines = uniqueCalls(fastest);
  return `Slow moves come from ${slowLines}; fast moves from ${fastLines}.`;
}

function uniqueCalls(segments) {
  const calls = new Map();
  for (const segment of segments) {
    const call = segment.source?.call ?? "?";
    calls.set(call, (calls.get(call) ?? 0) + 1);
  }
  return [...calls.entries()].map(([call, count]) => `${count}x ${call}()`).join(", ");
}

function summarize(segments) {
  return segments.slice(0, 8).map((s) => ({
    index: s.index,
    speedMmS: s.speedMmS,
    lengthMm: s.lengthMm,
    source: s.source ?? null,
  }));
}

/** The stretches of the timeline during which material is flowing. */
export function extrusionWindows(trace) {
  const windows = [];
  let current = null;
  for (const segment of trace.segments ?? []) {
    if (segment.extruding) {
      if (!current) current = { startS: segment.tStartS, endS: segment.tEndS, segments: [] };
      current.segments.push(segment);
      current.endS = segment.tEndS;
    } else if (current) {
      windows.push(current);
      current = null;
    }
  }
  if (current) windows.push(current);
  return windows;
}

/**
 * Does the trace actually deposit where the plan said to deposit?
 *
 * Compares the ordered sequence of extruding endpoints against the plan's
 * print-intent points. This catches a post-processor that drops, reorders,
 * or transforms geometry on the way out — but it says nothing about how
 * fast those points are traversed, which is why it is not sufficient on its
 * own. Pair it with checkExtrusionSpeedConsistency.
 */
export function comparePlanToTrace(plan, trace, { toleranceMm = 1e-3 } = {}) {
  const findings = [];
  const planPoints = [];
  for (const operation of plan.operations ?? []) {
    for (const path of operation.paths ?? []) {
      if (path.intent !== "print") continue;
      for (const point of path.points ?? []) {
        planPoints.push({ ...point, family: path.family, layer: path.layer, operationId: operation.operationId });
      }
    }
  }

  const tracePoints = (trace.segments ?? [])
    .filter((segment) => segment.extruding && segment.lengthMm > toleranceMm && segment.kind !== "dwell")
    .map((segment) => ({ ...segment.to, index: segment.index, source: segment.source }));

  if (planPoints.length !== tracePoints.length) {
    findings.push({
      code: "print-point-count-mismatch",
      planPoints: planPoints.length,
      tracePoints: tracePoints.length,
      message:
        `The plan has ${planPoints.length} print-intent points but the exported program deposits at ` +
        `${tracePoints.length}. The export is not a faithful translation of the plan.`,
    });
    return findings;
  }

  for (let i = 0; i < planPoints.length; i += 1) {
    const expected = planPoints[i];
    const actual = tracePoints[i];
    const drift = Math.hypot(expected.x - actual.x, expected.y - actual.y, expected.z - actual.z);
    if (drift > toleranceMm) {
      findings.push({
        code: "print-point-moved",
        at: i,
        driftMm: Number(drift.toFixed(6)),
        expected: { x: expected.x, y: expected.y, z: expected.z },
        actual: { x: actual.x, y: actual.y, z: actual.z },
        source: actual.source,
        message:
          `Print point ${i} (${expected.family}, layer ${expected.layer}) is ${drift.toFixed(4)} mm away ` +
          "from where the plan put it.",
      });
    }
  }
  return findings;
}

/** Stationary time with material flowing: every second of it is a deposit. */
export function checkStationaryExtrusion(trace, { maxSecondsS = 0 } = {}) {
  const findings = [];
  for (const segment of trace.segments ?? []) {
    if (!segment.extruding || segment.kind !== "dwell") continue;
    if (segment.durationS <= maxSecondsS) continue;
    findings.push({
      code: "stationary-extrusion",
      index: segment.index,
      durationS: segment.durationS,
      at: { x: segment.to.x, y: segment.to.y, z: segment.to.z },
      source: segment.source ?? null,
      message:
        `The tool holds position for ${segment.durationS} s with extrusion on. All of that material ` +
        "goes into one spot.",
    });
  }
  return findings;
}
