import assert from "node:assert/strict";
import test from "node:test";

import {
  validateTraceShape,
  motionProfile,
  distanceInto,
  speedInto,
  sampleAt,
  pointAlong,
  polylineOf,
  arcFrame,
  depositedThrough,
  extrusionWindows,
  checkExtrusionSpeedConsistency,
  checkStationaryExtrusion,
  comparePlanToTrace,
} from "../../schemas/motion-trace/trace-lib.mjs";

// Duration and peak speed are derived, never hand-written: a fixture whose
// length, speed and acceleration do not agree with its duration is not a
// move any machine could make, and asserting against one proves nothing.
function segment(overrides = {}) {
  const base = {
    index: 0,
    kind: "linear",
    from: { x: 0, y: 0, z: 0 },
    to: { x: 100, y: 0, z: 0 },
    via: null,
    lengthMm: 100,
    speedPercent: null,
    accelPercent: null,
    speedMmS: 100,
    accelMmS2: 1000,
    extruding: false,
    blend: null,
    pathFidelity: "exact",
    note: null,
    source: null,
  };
  const merged = { ...base, ...overrides };
  const profile = motionProfile(merged.lengthMm, merged.speedMmS, merged.accelMmS2);
  return {
    ...merged,
    peakSpeedMmS: overrides.peakSpeedMmS ?? profile.peakSpeedMmS,
    durationS: overrides.durationS ?? profile.durationS,
    tStartS: 0,
    tEndS: overrides.durationS ?? profile.durationS,
  };
}

function trace(segments, extra = {}) {
  let t = 0;
  const timed = segments.map((s, index) => {
    const withTime = { ...s, index, tStartS: t, tEndS: t + s.durationS };
    t += s.durationS;
    return withTime;
  });
  return {
    traceSchemaVersion: 1,
    source: { machineId: "test-machine", readerId: "test-reader", readerVersion: "0.0.0" },
    units: { length: "mm", time: "s", speed: "mm/s", acceleration: "mm/s^2" },
    segments: timed,
    events: [],
    warnings: [],
    totals: { segments: timed.length, durationS: t },
    ...extra,
  };
}

test("motion-trace: validation accepts a well-formed trace", () => {
  const result = validateTraceShape(trace([segment(), segment({ from: { x: 100, y: 0, z: 0 } })]));
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test("motion-trace: validation rejects a timeline with a hole in it", () => {
  const broken = trace([segment(), segment()]);
  broken.segments[1].tStartS += 0.5; // a gap an animation could not seek across
  const result = validateTraceShape(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => /does not continue from the previous/.test(message)));
});

test("motion-trace: the trapezoidal profile covers exactly the segment's length", () => {
  const s = segment();
  assert.equal(distanceInto(s, 0), 0);
  assert.ok(Math.abs(distanceInto(s, s.durationS) - s.lengthMm) < 1e-9);
  assert.ok(Math.abs(distanceInto(s, s.durationS * 2) - s.lengthMm) < 1e-9, "clamps past the end");
});

test("motion-trace: the tool is slower near a segment's ends than in its middle", () => {
  // This is the behaviour an operator is watching for: without CP blending
  // the machine stops dead at every waypoint, and material keeps flowing.
  const s = segment();
  const start = speedInto(s, 0.01);
  const middle = speedInto(s, s.durationS / 2);
  const end = speedInto(s, s.durationS - 0.01);
  assert.ok(start < middle, "accelerating at the start");
  assert.ok(end < middle, "decelerating into the end");
  assert.equal(middle, s.peakSpeedMmS);
});

test("motion-trace: a segment too short to reach its commanded speed is symmetric", () => {
  // Triangular profile: the move ends before acceleration finishes, so the
  // peak falls below the commanded speed and half the distance takes half
  // the time. Short segments are the common case in a dense toolpath.
  const s = segment({ lengthMm: 1, speedMmS: 1000, accelMmS2: 1000 });
  assert.ok(s.peakSpeedMmS < 1000, "never reaches the commanded speed");
  assert.ok(Math.abs(s.peakSpeedMmS - Math.sqrt(1000 * 1)) < 1e-9);
  assert.ok(Math.abs(distanceInto(s, s.durationS / 2) - 0.5) < 1e-9);
  assert.ok(Math.abs(distanceInto(s, s.durationS) - 1) < 1e-9);
});

test("motion-trace: sampleAt reports the segment in progress, not just a point", () => {
  const t = trace([
    segment({ to: { x: 10, y: 0, z: 0 }, lengthMm: 10 }),
    segment({ from: { x: 10, y: 0, z: 0 }, to: { x: 10, y: 10, z: 0 }, lengthMm: 10, extruding: true }),
  ]);
  const midwayThroughSecond = t.segments[1].tStartS + t.segments[1].durationS / 2;
  const sample = sampleAt(t, midwayThroughSecond);
  assert.equal(sample.segmentIndex, 1);
  assert.equal(sample.extruding, true);
  assert.ok(sample.point.y > 0 && sample.point.y < 10);
  assert.equal(sampleAt(t, -5).segmentIndex, 0, "clamps before the start");
  assert.equal(sampleAt(t, 99).segmentIndex, 1, "clamps past the end");
});

test("motion-trace: a quarter-circle arc measures and interpolates as a circle, not a chord", () => {
  const from = { x: 10, y: 0, z: 0 };
  const via = { x: Math.SQRT1_2 * 10, y: Math.SQRT1_2 * 10, z: 0 };
  const to = { x: 0, y: 10, z: 0 };
  const frame = arcFrame(from, via, to);

  assert.ok(Math.abs(frame.radius - 10) < 1e-9);
  assert.ok(Math.abs(frame.theta - Math.PI / 2) < 1e-9);

  const arcSegment = segment({ kind: "arc", from, to, via, lengthMm: 10 * (Math.PI / 2) });
  const middle = pointAlong(arcSegment, 0.5);
  assert.ok(Math.abs(Math.hypot(middle.x, middle.y) - 10) < 1e-9, "midpoint sits on the circle, not the chord");

  const points = polylineOf(arcSegment);
  assert.ok(points.length > 4, "arcs are flattened for drawing");
  for (const point of points) assert.ok(Math.abs(Math.hypot(point.x, point.y) - 10) < 1e-6);
});

test("motion-trace: an arc out of the XY plane is still a circle", () => {
  const from = { x: 10, y: 0, z: 5 };
  const via = { x: 0, y: 0, z: 15 };
  const to = { x: -10, y: 0, z: 5 };
  const frame = arcFrame(from, via, to);
  assert.ok(Math.abs(frame.radius - 10) < 1e-9);
  assert.ok(Math.abs(frame.theta - Math.PI) < 1e-9);
});

test("motion-trace: deposited material accumulates in deposition order, not by height", () => {
  // A path that goes up, then back down, then up again — the shape a
  // non-planar or spiral toolpath makes. Sorting by z would reorder it.
  const t = trace([
    segment({ from: { x: 0, y: 0, z: 0 }, to: { x: 10, y: 0, z: 5 }, lengthMm: 11.18, extruding: true }),
    segment({ from: { x: 10, y: 0, z: 5 }, to: { x: 20, y: 0, z: 1 }, lengthMm: 10.77, extruding: true }),
    segment({ from: { x: 20, y: 0, z: 1 }, to: { x: 30, y: 0, z: 9 }, lengthMm: 12.81, extruding: true }),
  ]);

  const midwayThroughSecond = t.segments[1].tStartS + t.segments[1].durationS / 2;
  const early = depositedThrough(t, midwayThroughSecond);
  assert.equal(early.length, 2);
  assert.equal(early[1].segment.index, 1);
  assert.ok(early[1].fraction > 0 && early[1].fraction < 1, "the last entry is partial");

  const all = depositedThrough(t, 99);
  assert.deepEqual(all.map((entry) => entry.segment.index), [0, 1, 2]);
});

test("motion-trace: travel moves are excluded from deposited material unless asked for", () => {
  const t = trace([
    segment({ lengthMm: 10, extruding: false }),
    segment({ lengthMm: 10, extruding: true }),
  ]);
  assert.equal(depositedThrough(t, 99).length, 1);
  assert.equal(depositedThrough(t, 99, { includeTravel: true }).length, 2);
});

test("motion-trace: extrusion windows are the stretches where material flows", () => {
  const t = trace([
    segment({ durationS: 1, extruding: false }),
    segment({ durationS: 1, extruding: true }),
    segment({ durationS: 1, extruding: true }),
    segment({ durationS: 1, extruding: false }),
    segment({ durationS: 1, extruding: true }),
  ]);
  const windows = extrusionWindows(t);
  assert.equal(windows.length, 2);
  assert.deepEqual(windows.map((w) => w.segments.length), [2, 1]);
});

test("motion-trace: a uniform extrusion window raises nothing", () => {
  const t = trace([
    segment({ lengthMm: 10, speedMmS: 10, extruding: true }),
    segment({ lengthMm: 10, speedMmS: 10, extruding: true }),
  ]);
  assert.deepEqual(checkExtrusionSpeedConsistency(t), []);
});

test("motion-trace: extruding at two different speeds is reported, with the bead ratio", () => {
  const t = trace([
    segment({ lengthMm: 10, speedMmS: 10, extruding: true, source: { file: "src1.lua", line: 12, call: "L" } }),
    segment({ lengthMm: 10, speedMmS: 1000, extruding: true, source: { file: "src1.lua", line: 13, call: "J" } }),
  ]);
  const findings = checkExtrusionSpeedConsistency(t);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "inconsistent-extrusion-speed");
  assert.equal(findings[0].ratio, 100);
  assert.match(findings[0].message, /1x L\(\)/);
  assert.match(findings[0].message, /1x J\(\)/);
});

test("motion-trace: holding position with extrusion on is reported", () => {
  const t = trace([
    segment({ kind: "dwell", lengthMm: 0, speedMmS: 0, accelMmS2: 0, durationS: 4, speedMmS: 0, peakSpeedMmS: 0, extruding: true, to: { x: 1, y: 2, z: 3 } }),
  ]);
  const findings = checkStationaryExtrusion(t);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].durationS, 4);
  assert.deepEqual(findings[0].at, { x: 1, y: 2, z: 3 });
});

test("motion-trace: a plan and a faithful trace agree point for point", () => {
  const plan = {
    operations: [
      {
        operationId: "layer-filling",
        paths: [
          { family: "perimeter", layer: 0, intent: "print", points: [{ x: 0, y: 0, z: 1 }, { x: 10, y: 0, z: 1 }] },
        ],
      },
    ],
  };
  const t = trace([
    segment({ from: { x: 5, y: 5, z: 1 }, to: { x: 0, y: 0, z: 1 }, lengthMm: 7.07, extruding: true }),
    segment({ from: { x: 0, y: 0, z: 1 }, to: { x: 10, y: 0, z: 1 }, lengthMm: 10, extruding: true }),
  ]);
  assert.deepEqual(comparePlanToTrace(plan, t), []);
});

test("motion-trace: a trace that moves a print point is caught", () => {
  const plan = {
    operations: [
      { paths: [{ family: "perimeter", layer: 0, intent: "print", points: [{ x: 0, y: 0, z: 1 }] }] },
    ],
  };
  const t = trace([
    segment({ from: { x: 5, y: 0, z: 1 }, to: { x: 0, y: 0.5, z: 1 }, lengthMm: 5, extruding: true }),
  ]);
  const findings = comparePlanToTrace(plan, t);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "print-point-moved");
  assert.ok(Math.abs(findings[0].driftMm - 0.5) < 1e-6);
});
