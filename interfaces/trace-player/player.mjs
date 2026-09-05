// An animated player for a motion trace
// (../../schemas/motion-trace/motion-trace.schema.json).
//
// What this is for: watching what the machine was actually told to do,
// before it does it. A crash, a run at the wrong speed, or a purge landing
// on the part are all cheap to see here and expensive to discover on the
// machine.
//
// Two rules shape the whole renderer.
//
// Time is the only ordering. There is no layer slider and no grouping by
// height, because a SAAM toolpath is not necessarily built from planar
// layers — it may spiral, clad a slope, or double back. What it always has
// is a coherent order of deposition, so that is what the scrub bar runs on
// and what the drawing order follows: material appears when it was
// extruded.
//
// The preview never claims precision it does not have. Segments the reader
// marked `approximate` — a joint-interpolated move, whose real tool path
// bows away from the straight line between its endpoints — are drawn
// dashed and counted separately, rather than being shown as if they were
// measured.
//
// No dependencies, no framework, no build step.

import {
  sampleAtCursor,
  cursorAtTime,
  cursorAtDistance,
  cursorToTime,
  cursorToDistance,
  pathProfile,
  depositedAt,
  polylineOf,
  extrusionWindows,
} from "../../schemas/motion-trace/trace-lib.mjs";

// Kept in the same family as the reference workbench, so the two views read
// as one tool rather than two.
const COLORS = {
  bed: "#cfc9be",
  bedLine: "#bdb6aa",
  ghostPrint: "#c2bbb0",
  ghostTravel: "#d5cfc6",
  travel: "#9a9387",
  toolFill: "#1c6964",
  toolRing: "#ffffff",
  blob: "#a94321",
  // Slow (as commanded for printing) through to far too fast.
  speedRamp: ["#1c6964", "#3f8f74", "#f3c46e", "#e66d3f", "#a94321"],
};

const DEFAULTS = {
  yaw: -0.62,
  pitch: 0.92,
  zoom: 1,
  // 4x by default: at 1x a real program is mostly waiting, and the first
  // thing anyone wants is to see the whole path go down.
  playbackRate: 4,
  showGhost: true,
  showTravel: true,
  colorBy: "speed", // "speed" | "extrusion"
  // "machine" replays real elapsed time — what the machine will actually
  // do. "uniform" advances a constant distance per second, which makes the
  // shape of a path with a wide speed range legible. See trace-lib.
  timebase: "machine",
  uniformSpeedMmS: 25,
};

export function createTracePlayer(canvas, options = {}) {
  const state = {
    canvas,
    ctx: canvas.getContext("2d"),
    trace: null,
    t: 0,
    playing: false,
    lastFrame: 0,
    ...DEFAULTS,
    ...options,
    pan: { x: 0, y: 0 },
    listeners: new Map(),
    raf: null,
  };

  const view = { scale: 1, cx: 0, cy: 0, centre: { x: 0, y: 0, z: 0 } };

  // ------------------------------------------------------------ geometry

  // Axonometric: rotate about the build axis, tilt, drop depth. No
  // perspective — a preview is for judging position and order, and
  // foreshortening makes distances harder to read, not easier.
  function project(p) {
    const dx = p.x - view.centre.x;
    const dy = p.y - view.centre.y;
    const dz = p.z - view.centre.z;
    const cy = Math.cos(state.yaw);
    const sy = Math.sin(state.yaw);
    const x1 = dx * cy - dy * sy;
    const y1 = dx * sy + dy * cy;
    const cp = Math.cos(state.pitch);
    const sp = Math.sin(state.pitch);
    const y2 = y1 * cp - dz * sp;
    return {
      x: view.cx + x1 * view.scale + state.pan.x,
      y: view.cy + y2 * view.scale + state.pan.y,
      depth: y1 * sp + dz * cp,
    };
  }

  function fitView() {
    const { width, height } = canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = width / dpr;
    const h = height / dpr;
    view.cx = w / 2;
    view.cy = h / 2;

    const bounds = state.trace?.bounds;
    if (!bounds) {
      view.scale = 1;
      view.centre = { x: 0, y: 0, z: 0 };
      return;
    }
    view.centre = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    };
    const span = Math.max(
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z,
      1
    );
    view.scale = (Math.min(w, h) / (span * 1.9)) * state.zoom;
  }

  // -------------------------------------------------------------- colour

  function rampColor(fraction) {
    const ramp = COLORS.speedRamp;
    const f = Math.max(0, Math.min(1, fraction)) * (ramp.length - 1);
    const i = Math.floor(f);
    if (i >= ramp.length - 1) return ramp[ramp.length - 1];
    return mixHex(ramp[i], ramp[i + 1], f - i);
  }

  function mixHex(a, b, t) {
    const pa = hexToRgb(a);
    const pb = hexToRgb(b);
    const c = (k) => Math.round(pa[k] + (pb[k] - pa[k]) * t);
    return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /**
   * Colour an extruding move by how fast it is relative to the slowest
   * printing move in the program.
   *
   * The slowest is taken as the intended print speed, because under a
   * constant-rate extruder the bead cross-section goes as 1/v: the slow
   * moves are the ones laying down a full bead. Anything much faster is
   * depositing proportionally less material over the same distance, and
   * that is what the warm end of the ramp is showing.
   */
  function beadColor(segment) {
    if (state.colorBy !== "speed" || !state.reference) return COLORS.speedRamp[0];
    const ratio = segment.speedMmS / state.reference;
    // log scale: a 2x overspeed should be visible, a 100x unmissable.
    return rampColor(Math.log10(Math.max(1, ratio)) / 2);
  }

  function computeReference(trace) {
    const printing = (trace.segments ?? []).filter(
      (s) => s.extruding && s.lengthMm > 1e-6 && s.kind !== "dwell" && s.speedMmS > 0
    );
    return printing.length ? Math.min(...printing.map((s) => s.speedMmS)) : null;
  }

  // ------------------------------------------------------------- drawing

  function strokePolyline(points, { color, width, dash = null, alpha = 1 }) {
    if (points.length < 2) return;
    const ctx = state.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    points.forEach((p, i) => {
      const s = project(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawBed() {
    const bounds = state.trace?.bounds;
    if (!bounds) return;
    const z = bounds.min.z;
    const pad = 8;
    const x0 = bounds.min.x - pad;
    const x1 = bounds.max.x + pad;
    const y0 = bounds.min.y - pad;
    const y1 = bounds.max.y + pad;

    const ctx = state.ctx;
    const corners = [
      { x: x0, y: y0, z }, { x: x1, y: y0, z }, { x: x1, y: y1, z }, { x: x0, y: y1, z },
    ].map(project);
    ctx.save();
    ctx.fillStyle = COLORS.bed;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // A grid on the build plane, so it rotates with the model rather than
    // sitting flat on the screen — otherwise it reads as a backdrop and
    // stops helping you judge the tilt.
    const step = niceStep((x1 - x0) / 6);
    strokeGrid(x0, x1, y0, y1, z, step);
  }

  function niceStep(raw) {
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
    const normalized = raw / magnitude;
    const snapped = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
    return snapped * magnitude;
  }

  function strokeGrid(x0, x1, y0, y1, z, step) {
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      strokePolyline([{ x, y: y0, z }, { x, y: y1, z }], { color: COLORS.bedLine, width: 1, alpha: 0.5 });
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      strokePolyline([{ x: x0, y, z }, { x: x1, y, z }], { color: COLORS.bedLine, width: 1, alpha: 0.5 });
    }
  }

  /** The whole program, faint, so you can see where it is going. */
  function drawGhost() {
    if (!state.showGhost) return;
    for (const segment of state.trace.segments) {
      if (segment.kind === "dwell") continue;
      if (!segment.extruding && !state.showTravel) continue;
      strokePolyline(polylineOf(segment), {
        color: segment.extruding ? COLORS.ghostPrint : COLORS.ghostTravel,
        width: segment.extruding ? 2 : 1,
        alpha: 0.55,
        dash: segment.pathFidelity === "approximate" ? [4, 4] : null,
      });
    }
  }

  /**
   * Everything laid down so far, in the order it was laid down.
   *
   * Drawing in deposition order is what makes this additively coherent: a
   * later pass covers an earlier one, which is what the material does. It
   * is a painter's approximation with no depth buffer, so a far segment
   * drawn late can paint over a near one; the depth shading below keeps
   * that readable without pretending to be a solid renderer.
   */
  function drawDeposited(cursor) {
    const laid = depositedAt(state.trace, cursor, { includeTravel: state.showTravel });
    for (const { segment, fraction } of laid) {
      const points = polylineOf(segment, fraction);
      if (segment.extruding) {
        strokePolyline(points, {
          color: beadColor(segment),
          width: 4,
          alpha: 0.95,
          dash: segment.pathFidelity === "approximate" ? [5, 4] : null,
        });
      } else {
        strokePolyline(points, {
          color: COLORS.travel,
          width: 1.25,
          alpha: 0.65,
          dash: segment.pathFidelity === "approximate" ? [3, 3] : [5, 4],
        });
      }
    }
  }

  /**
   * Stationary time with the extruder running, marked where it happens.
   *
   * A dwell has no length, so it would otherwise be invisible — yet it is
   * exactly the condition that piles material in one spot. The marker
   * grows with elapsed dwell so you can watch it happen, but it is
   * deliberately a marker and not a rendered pool: sizing an actual
   * deposit needs the volumetric rate, and a trace does not carry one.
   * The seconds are printed next to it so the number, not the blot, is
   * what you read.
   */
  function drawStationaryDeposits(cursor) {
    const ctx = state.ctx;
    for (const segment of state.trace.segments) {
      if (segment.kind !== "dwell" || !segment.extruding) continue;
      if (cursor.segmentIndex < segment.index) continue;
      // A dwell has no length, so on the uniform timebase there is no
      // partial state to show: it is either behind the cursor or ahead.
      const elapsed =
        state.timebase === "uniform" || cursor.segmentIndex > segment.index
          ? segment.durationS
          : Math.min(cursor.tS ?? segment.tEndS, segment.tEndS) - segment.tStartS;
      if (elapsed <= 0) continue;
      const radius = 4 + Math.min(9, Math.sqrt(elapsed) * 4.5);
      const p = project(segment.to);

      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = COLORS.blob;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = COLORS.blob;
      ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(`${elapsed.toFixed(1)} s still`, p.x + radius + 5, p.y);
      ctx.restore();
    }
  }

  function drawTool(sample) {
    if (!sample) return;
    const ctx = state.ctx;
    const p = project(sample.point);

    // A dropline to the build plane: without it, height is guesswork.
    const base = project({ ...sample.point, z: state.trace.bounds?.min.z ?? sample.point.z });
    ctx.save();
    ctx.strokeStyle = COLORS.toolFill;
    ctx.globalAlpha = 0.3;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(base.x, base.y);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = sample.extruding ? COLORS.blob : COLORS.toolFill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.toolRing;
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    const ctx = state.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    if (!state.trace) {
      ctx.restore();
      return;
    }

    fitView();
    const cursor = currentCursor();
    drawBed();
    drawGhost();
    drawDeposited(cursor);
    drawStationaryDeposits(cursor);
    const sample = sampleAtCursor(state.trace, cursor);
    drawTool(sample);
    ctx.restore();
    emit("frame", { clock: state.t, progress: progress(), sample, timebase: state.timebase });
  }

  /** The cursor for the playhead, read on whichever clock is active. */
  function currentCursor() {
    return state.timebase === "uniform"
      ? cursorAtDistance(state.trace, state.t * state.uniformSpeedMmS)
      : cursorAtTime(state.trace, state.t);
  }

  function progress() {
    const total = duration();
    return total > 0 ? state.t / total : 0;
  }

  // ------------------------------------------------------------ playback

  function tick(now) {
    state.raf = requestAnimationFrame(tick);
    if (!state.trace) return;
    if (state.playing) {
      const dt = Math.min(0.1, (now - state.lastFrame) / 1000);
      state.t += dt * state.playbackRate;
      if (state.t >= duration()) {
        state.t = duration();
        state.playing = false;
        emit("ended", {});
      }
    }
    state.lastFrame = now;
    render();
  }

  /** Length of the active clock, in seconds of playback. */
  function duration() {
    if (!state.trace) return 0;
    if (state.timebase === "uniform") {
      return pathProfile(state.trace).totalMm / state.uniformSpeedMmS;
    }
    return state.trace.totals?.durationS ?? 0;
  }

  function emit(name, payload) {
    for (const listener of state.listeners.get(name) ?? []) listener(payload);
  }

  // -------------------------------------------------------- interaction

  let dragging = null;
  const onPointerDown = (event) => {
    dragging = { x: event.clientX, y: event.clientY, shift: event.shiftKey };
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    if (dragging.shift) {
      state.pan.x += dx;
      state.pan.y += dy;
    } else {
      state.yaw += dx * 0.008;
      state.pitch = Math.max(0.05, Math.min(1.5, state.pitch + dy * 0.006));
    }
    dragging = { ...dragging, x: event.clientX, y: event.clientY };
  };
  const onPointerUp = () => { dragging = null; };
  const onWheel = (event) => {
    event.preventDefault();
    state.zoom = Math.max(0.15, Math.min(12, state.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  state.raf = requestAnimationFrame(tick);

  // ---------------------------------------------------------------- api

  return {
    load(trace) {
      state.trace = trace;
      state.reference = computeReference(trace);
      state.t = 0;
      state.playing = false;
      state.pan = { x: 0, y: 0 };
      pathProfile(trace);
      state.zoom = 1;
      fitView();
      emit("loaded", { trace });
      return this;
    },
    play() { state.playing = true; state.lastFrame = performance.now(); emit("play", {}); },
    pause() { state.playing = false; emit("pause", {}); },
    toggle() { state.playing ? this.pause() : this.play(); },
    seek(tS) { state.t = Math.max(0, Math.min(duration(), tS)); },
    seekSegment(index) {
      const segment = state.trace?.segments?.[index];
      if (segment) state.t = segment.tStartS;
    },
    setPlaybackRate(rate) { state.playbackRate = rate; },
    setOption(key, value) { state[key] = value; },

    /**
     * Switch between real machine time and constant speed along the path,
     * keeping the tool where it is.
     *
     * The playhead is converted through the cursor rather than rescaled,
     * so toggling mid-run does not make the tool jump — the two clocks
     * disagree about how long things take, not about where they happen.
     */
    setTimebase(timebase) {
      if (!state.trace || timebase === state.timebase) {
        state.timebase = timebase;
        return;
      }
      const cursor = currentCursor();
      state.timebase = timebase;
      state.t =
        timebase === "uniform"
          ? cursorToDistance(state.trace, cursor) / state.uniformSpeedMmS
          : cursorToTime(state.trace, cursor);
    },
    setUniformSpeed(mmPerSecond) {
      const cursor = state.trace ? currentCursor() : null;
      state.uniformSpeedMmS = mmPerSecond;
      if (cursor && state.timebase === "uniform") {
        state.t = cursorToDistance(state.trace, cursor) / mmPerSecond;
      }
    },

    get timebase() { return state.timebase; },
    get time() { return state.t; },
    get duration() { return duration(); },
    get progress() { return progress(); },
    get playing() { return state.playing; },
    get referenceSpeed() { return state.reference; },
    /** Real elapsed machine time at the playhead, whichever clock is running. */
    get machineTime() {
      return state.trace ? cursorToTime(state.trace, currentCursor()) : 0;
    },
    sample() { return state.trace ? sampleAtCursor(state.trace, currentCursor()) : null; },
    windows() { return state.trace ? extrusionWindows(state.trace) : []; },
    on(name, callback) {
      if (!state.listeners.has(name)) state.listeners.set(name, []);
      state.listeners.get(name).push(callback);
      return this;
    },
    destroy() {
      cancelAnimationFrame(state.raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    },
  };
}

export { COLORS };
