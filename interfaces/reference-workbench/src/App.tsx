import { ReactNode, useEffect, useRef, useState } from "react";
import {
  validatePlanShape,
  buildApprovalRecord,
  applyApproval,
  hasCurrentApproval,
} from "../../../schemas/process-plan/plan-lib.mjs";
// Same deterministic code the CLI and tests/golden use — not a copy. See
// vite.config.ts for why the dev server needs `server.fs.allow` to reach
// outside this package's own directory for it.
import { translate as translateForDobot } from "../../../machines/reference-dobot-mg400-struderbot/postprocessor/generator.mjs";

type Point = { x: number; y: number; z: number };
type PathEntry = { family: string; layer: number; points: Point[]; intent: "print" | "travel" };
type OperationInvocation = {
  invocationId: string;
  operationId: string;
  operationVersion?: string;
  strategy?: string;
  paths: PathEntry[];
  evidence?: string;
};
type PartSpec = {
  shape: string;
  width?: number;
  depth?: number;
  outerDiameter?: number;
  baseOuterDiameter?: number;
  innerDiameter?: number;
  height: number;
};
type ApprovalRecord = {
  revision: number;
  contentHash: string;
  approvedAt: string;
  approvedBy: string;
  scope: "geometry" | "executable-export" | "machine-control";
};
type ProcessPlan = {
  schemaVersion: 1;
  revision: number;
  part: PartSpec;
  machine: { id: string; profileRevision: string };
  settings: { layerHeight: number; beadWidth: number; spacing?: number };
  operations: OperationInvocation[];
  status: "draft" | "preview-only" | "approved" | "superseded";
  approval: ApprovalRecord | null;
};

// A saved file is either a bare plan, or wrapped with a format tag — kept
// for compatibility with files saved by earlier builds and by other
// tools; this workbench only ever reads and writes the `plan` field.
type WorkbenchFile = ProcessPlan | { format: "saam-workbench-file"; schemaVersion: 1; plan: ProcessPlan };

type ViewMode = "part" | "collective" | "current";
type Viewport = { zoom: number; panX: number; panY: number };
type ExportWarning = { code: string; message: string; gapMm?: number };
type ExportResult = { files: Record<string, string>; warnings: ExportWarning[] };
type Page = "workbench" | "output";
// A gap at or above this is a real, likely-visible defect (a dragged
// line across the part) worth the human's attention before printing;
// below it, this is the ordinary small transition between adjacent fill
// passes — see layer-filling/README.md's "Known limitation" note for
// why these exist at all and aren't just noise to hide.
const LARGE_GAP_MM = 5;

const PALETTE = ["#e66d3f", "#f3c46e", "#1c6964", "#a94321", "#69a9d1", "#c68af2"];
const DEFAULT_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };
const LOCAL_STORAGE_KEY = "saam-reference-workbench-file";
const KNOWN_MACHINE_ID = "reference-dobot-mg400-struderbot";

// Selecting a machine constrains which capabilities are available before
// anything is composed — see machines/*/manifest.json `capabilities` and
// docs/authoring/machine-definitions.md. Only the reference Dobot install
// has a real manifest today; the rest are the roadmap's named placeholders
// (see ROADMAP.md) and are shown, not hidden, but can't be selected yet.
const MACHINES: { id: string; name: string; available: boolean }[] = [
  { id: "reference-dobot-mg400-struderbot", name: "Dobot MG400 · StruderBot", available: true },
  { id: "tormach-pcnc-pathpilot", name: "Tormach PCNC · PathPilot (planned)", available: false },
  { id: "avid-cnc-mach3", name: "Avid CNC · Mach3 (planned)", available: false },
  { id: "ultimaker-s5", name: "Ultimaker S5 (planned)", available: false },
  { id: "bambulab-h2d", name: "BambuLab H2D (planned)", available: false },
];

function operationColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

function operationDisplayName(op: OperationInvocation): string {
  return op.strategy ? `${op.operationId} · ${op.strategy}` : op.operationId;
}

function operationLayerCount(op: OperationInvocation): number {
  const maxLayer = op.paths.reduce((max, p) => Math.max(max, p.layer), -1);
  return Math.max(1, maxLayer + 1);
}

/** Total build steps across every operation combined — this is what the
 * single progress slider scrubs, rather than a separate "which
 * operation" control plus a separate "which layer within it" control. */
function totalBuildSteps(plan: ProcessPlan | null): number {
  if (!plan || plan.operations.length === 0) return 1;
  return plan.operations.reduce((sum, op) => sum + operationLayerCount(op), 0);
}

/** Maps one global step (1-indexed, spanning the whole build) back to
 * which operation it falls in and which local layer within that
 * operation — the shape ToolCanvas's `activeIndex`/`fraction` props
 * already expect, so the canvas rendering logic doesn't need to change,
 * only what feeds it. */
function resolveBuildStep(plan: ProcessPlan | null, globalStep: number): { activeIndex: number; layer: number } {
  if (!plan || plan.operations.length === 0) return { activeIndex: 0, layer: 1 };
  let remaining = Math.max(1, globalStep);
  for (let i = 0; i < plan.operations.length; i += 1) {
    const count = operationLayerCount(plan.operations[i]);
    if (remaining <= count || i === plan.operations.length - 1) {
      return { activeIndex: i, layer: Math.min(remaining, count) };
    }
    remaining -= count;
  }
  return { activeIndex: plan.operations.length - 1, layer: 1 };
}

function projected(p: Point, width: number, height: number, yaw: number, pitch: number, centerY: number, span: number) {
  const x1 = p.x * Math.cos(yaw) - p.y * Math.sin(yaw);
  const y1 = p.x * Math.sin(yaw) + p.y * Math.cos(yaw);
  const y2 = y1 * Math.cos(pitch) - p.z * Math.sin(pitch);
  const scale = Math.min(width / span, height / (span * 0.75));
  return { x: width * 0.5 + x1 * scale, y: centerY + y2 * scale };
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  w: number,
  h: number,
  color: string,
  yaw: number,
  pitch: number,
  centerY: number,
  span: number,
  width = 2,
  alpha = 1
) {
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach((point, i) => {
    const p = projected(point, w, h, yaw, pitch, centerY, span);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  });
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(96,112,121,.13)";
  ctx.lineWidth = 1;
  for (let x = 22; x < w; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 20; y < h; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

// "Finished Part" is the target we're building toward, not a replay of
// however many toolpaths happen to exist yet — so this draws a clean
// idealized solid straight from the plan's own declared `part` envelope
// (shape/width/depth/outerDiameter/innerDiameter/height), never from
// operation path data. A round part (outerDiameter given, or shape is
// "cylinder"/"ring") gets a faceted cylinder/tube; anything else gets a
// box from width × depth × height, centered at the origin the same way
// every operation's own points already are.
function drawTargetPart(
  ctx: CanvasRenderingContext2D,
  part: PartSpec,
  w: number,
  h: number,
  yaw: number,
  pitch: number,
  centerY: number,
  span: number
) {
  const project = (p: Point) => projected(p, w, h, yaw, pitch, centerY, span);
  const SKIN = "#8acbc3";
  const SKIN_SHADE = "#5fa89e";
  const OUTLINE = "#3f7f76";
  const height = Math.max(part.height, 0.01);

  const fillQuad = (a: Point, b: Point, c: Point, d: Point, color: string) => {
    const pa = project(a);
    const pb = project(b);
    const pc = project(c);
    const pd = project(d);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.lineTo(pc.x, pc.y);
    ctx.lineTo(pd.x, pd.y);
    ctx.closePath();
    ctx.fill();
  };

  const fillCap = (ring: Point[], color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ring.forEach((p, i) => {
      const pt = project(p);
      i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y);
    });
    ctx.closePath();
    ctx.fill();
  };

  const isRound = part.shape === "cylinder" || part.shape === "ring" || part.outerDiameter != null;

  if (isRound) {
    // baseOuterDiameter only appears when a part genuinely tapers (see
    // process-plan.schema.json's `part` field) — absent, the base is
    // just the same radius as the top, a straight cylinder as before.
    const topR = (part.outerDiameter ?? Math.max(part.width ?? 40, part.depth ?? 40)) / 2;
    const baseR = part.baseOuterDiameter != null ? part.baseOuterDiameter / 2 : topR;
    const innerR = part.innerDiameter ? part.innerDiameter / 2 : 0;
    const SEGMENTS = 40;
    const ring = (r: number, z: number): Point[] =>
      Array.from({ length: SEGMENTS + 1 }, (_, i) => {
        const a = (i / SEGMENTS) * Math.PI * 2;
        return { x: Math.cos(a) * r, y: Math.sin(a) * r, z };
      });
    const bottomOuter = ring(baseR, 0);
    const topOuter = ring(topR, height);
    for (let i = 0; i < SEGMENTS; i += 1) {
      fillQuad(bottomOuter[i], bottomOuter[i + 1], topOuter[i + 1], topOuter[i], i % 2 === 0 ? SKIN : SKIN_SHADE);
    }
    if (innerR > 0) {
      const bottomInner = ring(innerR, 0);
      const topInner = ring(innerR, height);
      for (let i = 0; i < SEGMENTS; i += 1) {
        fillQuad(topInner[i], topInner[i + 1], bottomInner[i + 1], bottomInner[i], i % 2 === 0 ? SKIN_SHADE : SKIN);
      }
      // Top cap is the annulus between outer and inner — approximated as
      // a fan of quads rather than a single path with a hole, since
      // canvas fill-rule handles that unreliably at this segment count.
      for (let i = 0; i < SEGMENTS; i += 1) {
        fillQuad(topOuter[i], topOuter[i + 1], topInner[i + 1], topInner[i], SKIN);
      }
      drawLine(ctx, topInner, w, h, OUTLINE, yaw, pitch, centerY, span, 1.1, 0.6);
    } else {
      fillCap(topOuter, SKIN);
    }
    drawLine(ctx, topOuter, w, h, OUTLINE, yaw, pitch, centerY, span, 1.2, 0.8);
    drawLine(ctx, bottomOuter, w, h, OUTLINE, yaw, pitch, centerY, span, 1.1, 0.5);
    return;
  }

  const hw = (part.width ?? 40) / 2;
  const hd = (part.depth ?? 40) / 2;
  const corners = (z: number): Point[] => [
    { x: -hw, y: -hd, z },
    { x: hw, y: -hd, z },
    { x: hw, y: hd, z },
    { x: -hw, y: hd, z },
    { x: -hw, y: -hd, z },
  ];
  const bottom = corners(0);
  const top = corners(height);
  for (let i = 0; i < 4; i += 1) {
    fillQuad(bottom[i], bottom[i + 1], top[i + 1], top[i], i % 2 === 0 ? SKIN : SKIN_SHADE);
  }
  fillCap(top, SKIN);
  drawLine(ctx, top, w, h, OUTLINE, yaw, pitch, centerY, span, 1.2, 0.8);
  drawLine(ctx, bottom, w, h, OUTLINE, yaw, pitch, centerY, span, 1.1, 0.5);
}

function partSpan(part?: PartSpec): number {
  if (!part) return 60;
  const flat = Math.max(part.width ?? 0, part.depth ?? 0, part.outerDiameter ?? 0, part.baseOuterDiameter ?? 0, 40);
  return Math.max(40, flat, part.height) * 1.3;
}

function ToolCanvas({
  mode,
  plan,
  activeIndex,
  fraction,
  rotation,
  filled,
  viewport,
  onRotate,
  onViewportChange,
}: {
  mode: ViewMode;
  plan: ProcessPlan | null;
  activeIndex: number;
  fraction: number;
  rotation: { yaw: number; pitch: number };
  filled: boolean;
  viewport: Viewport;
  onRotate: (dx: number, dy: number) => void;
  onViewportChange: (v: Viewport) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const projectionCenter = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, rect.width * ratio);
      canvas.height = Math.max(1, rect.height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawGrid(ctx, rect.width, rect.height);

      if (!plan) {
        projectionCenter.current = { x: rect.width * 0.5, y: rect.height * 0.5 };
        return;
      }

      const span = partSpan(plan.part);
      const centerY = rect.height * 0.58;
      projectionCenter.current = { x: rect.width * 0.5, y: centerY };
      ctx.save();
      ctx.translate(projectionCenter.current.x + viewport.panX, centerY + viewport.panY);
      ctx.scale(viewport.zoom, viewport.zoom);
      ctx.translate(-projectionCenter.current.x, -centerY);

      if (mode === "part") {
        // The target being built toward, not a replay of the toolpaths —
        // fixed regardless of the build-progress slider and unaffected by
        // however many operations have been composed so far.
        drawTargetPart(ctx, plan.part, rect.width, rect.height, rotation.yaw, rotation.pitch, centerY, span);
      } else if (mode === "current") {
        const op = plan.operations[activeIndex];
        if (op) {
          const visibleLayers = Math.max(1, Math.ceil(operationLayerCount(op) * fraction));
          op.paths
            .filter((p) => p.layer < visibleLayers)
            .forEach((p) =>
              drawLine(ctx, p.points, rect.width, rect.height, operationColor(activeIndex), rotation.yaw, rotation.pitch, centerY, span, filled ? 3.5 : 1.05, 0.95)
            );
        }
      } else {
        plan.operations.forEach((op, i) => {
          if (i > activeIndex) return;
          const localFraction = i === activeIndex ? fraction : 1;
          const visibleLayers = Math.max(1, Math.ceil(operationLayerCount(op) * localFraction));
          const alpha = i === activeIndex ? 0.96 : 0.46;
          const width = i === activeIndex ? (filled ? 3.5 : 1.05) : filled ? 2.5 : 0.8;
          op.paths
            .filter((p) => p.layer < visibleLayers)
            .forEach((p) => drawLine(ctx, p.points, rect.width, rect.height, operationColor(i), rotation.yaw, rotation.pitch, centerY, span, width, alpha));
        });
      }

      ctx.restore();
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [mode, plan, activeIndex, fraction, rotation, filled, viewport]);

  // React binds JSX `onWheel` passively by default (a React 17+ change for
  // scroll performance), so `event.preventDefault()` inside it silently
  // fails and logs "Unable to preventDefault inside passive event listener
  // invocation." A manually-attached listener with `{ passive: false }` is
  // the documented way around that. `latest` sidesteps re-attaching the
  // listener on every viewport change while still reading current values.
  const latest = useRef({ viewport, onViewportChange });
  latest.current = { viewport, onViewportChange };
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { viewport, onViewportChange } = latest.current;
      const rect = canvas.getBoundingClientRect();
      const oldZoom = viewport.zoom;
      const newZoom = Math.max(0.35, Math.min(5, oldZoom * Math.exp(-e.deltaY * 0.0015)));
      if (newZoom === oldZoom) return;
      const ratio = newZoom / oldZoom;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cx = projectionCenter.current.x;
      const cy = projectionCenter.current.y;
      onViewportChange({
        zoom: newZoom,
        panX: px - cx - (px - cx - viewport.panX) * ratio,
        panY: py - cy - (py - cy - viewport.panY) * ratio,
      });
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <canvas
      ref={ref}
      aria-label="Interactive 3D preview. Drag to rotate; scroll or pinch to zoom."
      onDoubleClick={() => onViewportChange(DEFAULT_VIEWPORT)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        const dy = e.clientY - drag.current.y;
        drag.current = { x: e.clientX, y: e.clientY };
        onRotate(dx, dy);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    />
  );
}

function ViewerCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="viewer-card">
      <header>
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function isWrapped(file: WorkbenchFile): file is Extract<WorkbenchFile, { format: string }> {
  return typeof file === "object" && file !== null && "format" in file && (file as { format?: unknown }).format === "saam-workbench-file";
}

export default function App() {
  const [plan, setPlan] = useState<ProcessPlan | null>(null);
  // Whether /api/session answered at all — i.e. whether this page is
  // being served by the MCP adapter's local bridge (see
  // adapters/mcp/src/http-bridge.mjs) rather than opened standalone
  // (`npm run dev`, or a static export). Standalone mode still works —
  // Open plan… and local-only approval — but only a live session polls
  // for updates and can write an approval back to it.
  const [liveConnected, setLiveConnected] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState(MACHINES[0].id);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  // One slider spans the whole build (every operation's layers, back to
  // back) instead of a separate "which operation" control plus a
  // separate "which layer" control — see resolveBuildStep().
  const [globalStep, setGlobalStep] = useState(1);
  const [filled, setFilled] = useState(true);
  const [rotation, setRotation] = useState({ yaw: -0.72, pitch: 0.55 });
  const [viewports, setViewports] = useState<Record<ViewMode, Viewport>>({
    part: { ...DEFAULT_VIEWPORT },
    collective: { ...DEFAULT_VIEWPORT },
    current: { ...DEFAULT_VIEWPORT },
  });
  const [activePage, setActivePage] = useState<Page>("workbench");
  const [exportFileName, setExportFileName] = useState("");
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState("");
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll the adapter's local session bridge. Polling (rather than a
  // WebSocket) is deliberate: an agent composes operations no faster
  // than a couple of seconds apart, so a ~1.5s poll is indistinguishable
  // from "live" here while staying far simpler to get right. A failed
  // first attempt means this page isn't being served by the bridge —
  // fall back to standalone mode (Open plan…, local-only approval) and
  // stop polling.
  useEffect(() => {
    let cancelled = false;
    let sawFirstResponse = false;
    let consecutiveFailures = 0;
    const poll = async () => {
      try {
        const res = await fetch("/api/session");
        if (!res.ok) throw new Error(`status ${res.status}`);
        const { session } = (await res.json()) as { session: ProcessPlan | null };
        if (cancelled) return;
        consecutiveFailures = 0;
        if (!sawFirstResponse) {
          sawFirstResponse = true;
        }
        setLiveConnected(true); // (re)confirms the connection on every successful poll, not just the first
        setPlan((current) => {
          if (!session) return current;
          if (current && current.revision === session.revision && current.machine.id === session.machine.id && JSON.stringify(current.approval) === JSON.stringify(session.approval)) {
            return current; // no real change — skip a state update and the resulting re-render/redraw
          }
          setGlobalStep(totalBuildSteps(session)); // show the build as fully composed so far, by default
          return session;
        });
        if (session && MACHINES.some((m) => m.id === session.machine.id)) setSelectedMachineId(session.machine.id);
      } catch {
        if (cancelled) return;
        if (!sawFirstResponse) {
          // Not served by the bridge — try a standalone local save instead, once.
          try {
            const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (saved) {
              const parsed = JSON.parse(saved) as WorkbenchFile;
              setPlan(isWrapped(parsed) ? parsed.plan : parsed);
            }
          } catch {
            // Starting empty is fine.
          }
          return;
        }
        // Was connected, now failing repeatedly (server restarted, network
        // blip, etc.) — say so rather than silently keep showing what
        // might now be stale data under a "Live session" badge.
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) setLiveConnected(false);
      }
    };
    void poll();
    const interval = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Standalone-mode persistence only — a live session is already durable
  // server-side (adapters/mcp writes .saam/session.json), so mirroring it
  // to localStorage too would just be a second, potentially stale copy.
  useEffect(() => {
    if (liveConnected) return;
    try {
      if (plan) {
        const file: WorkbenchFile = { format: "saam-workbench-file", schemaVersion: 1, plan };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(file));
      }
    } catch {
      // Local persistence is a convenience, not a guarantee.
    }
  }, [plan, liveConnected]);

  const totalSteps = totalBuildSteps(plan);
  const { activeIndex: active, layer } = resolveBuildStep(plan, globalStep);
  const activeOp = plan?.operations[active] ?? null;
  const activeOpLayers = activeOp ? operationLayerCount(activeOp) : 1;
  const fraction = Math.max(1, layer) / activeOpLayers;


  const resetViews = () => {
    setRotation({ yaw: -0.72, pitch: 0.55 });
    setViewports({ part: { ...DEFAULT_VIEWPORT }, collective: { ...DEFAULT_VIEWPORT }, current: { ...DEFAULT_VIEWPORT } });
  };

  // Loading a file is for the cases outside a live session: inspecting a
  // plan a teammate sent you, or reopening an archived revision. A live
  // session's own plan arrives via polling, not this.
  const loadPlanFile = async (file: File) => {
    setExportResult(null);
    setExportError("");
    setActivePage("workbench");
    setShowAllWarnings(false);
    try {
      const parsed = JSON.parse(await file.text()) as WorkbenchFile;
      const candidatePlan = isWrapped(parsed) ? parsed.plan : parsed;
      const { valid, errors } = validatePlanShape(candidatePlan);
      if (!valid) {
        setLoadErrors(errors);
        return;
      }
      setLoadErrors([]);
      setPlan(candidatePlan as ProcessPlan);
      if (MACHINES.some((m) => m.id === (candidatePlan as ProcessPlan).machine.id)) {
        setSelectedMachineId((candidatePlan as ProcessPlan).machine.id);
      }
      setGlobalStep(totalBuildSteps(candidatePlan as ProcessPlan));
      resetViews();
    } catch (error) {
      setLoadErrors([error instanceof Error ? error.message : "The file is not valid JSON."]);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Clearing the local view isn't enough in live mode: the adapter keeps
  // serving the same plan from .saam/session.json, and the next poll tick
  // (every 1.5s) would silently bring it right back. Telling the bridge
  // to clear its session too is what actually makes Clear stick.
  const clearPlan = () => {
    setPlan(null);
    setExportResult(null);
    setExportError("");
    setActivePage("workbench");
    setShowAllWarnings(false);
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // Best-effort only.
    }
    if (liveConnected) {
      void fetch("/api/session/clear", { method: "POST" }).catch(() => {
        // If this fails (server restarted, network blip), the local view
        // is still cleared; the next successful poll may bring the old
        // plan back, which is the honest behavior for a session we
        // couldn't actually reach — not silently pretending it worked.
      });
    }
  };

  // A durable, portable copy of what was approved — this project's
  // evidence culture treats that as worth keeping, independent of
  // whatever the live session does next. Not part of the main loop
  // anymore now that approval writes back to the session directly.
  const savePlanFile = async () => {
    if (!plan) return;
    const file: WorkbenchFile = { format: "saam-workbench-file", schemaVersion: 1, plan };
    const suggestedName = `saam-plan-revision-${plan.revision}${plan.approval ? "-approved" : ""}.json`;
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    try {
      const picker = (
        window as Window & {
          showSaveFilePicker?: (options: {
            suggestedName: string;
            types: { description: string; accept: Record<string, string[]> }[];
          }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
        }
      ).showSaveFilePicker;
      if (picker) {
        const handle = await picker({ suggestedName, types: [{ description: "SAAM plan", accept: { "application/json": [".json"] } }] });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = suggestedName;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setExportError("The plan file could not be saved. Please try again.");
      }
    }
  };

  // Approving and exporting used to be presented as separate deliberate
  // steps — a named approver, a choice of approval scope, then a second
  // button to actually export. In practice this workbench only ever
  // does one thing with an approval: use it immediately to export. That
  // split added ceremony (a name field, a scope no one here chose
  // between) without adding a real second decision point, so this one
  // action now does both: get (or reuse) an executable-export approval
  // for the current revision, then translate it. The click itself is
  // still the one real gate — a human, here, in this UI — the same
  // guarantee the old two-step flow had, just without asking them to
  // type their name to get it. Live session: the approval writes back to
  // the adapter over the local bridge so post_process can read it
  // immediately. Standalone: computed locally, same as before.
  const exportPlan = async () => {
    if (!plan) return;
    setExportError("");
    try {
      let current = plan;
      if (!hasCurrentApproval(current, "executable-export")) {
        if (liveConnected) {
          const res = await fetch("/api/session/approve", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ scope: "executable-export", approvedBy: "workbench" }),
          });
          const body = (await res.json()) as { session?: ProcessPlan; error?: string };
          if (!res.ok || !body.session) throw new Error(body.error ?? "Approval failed.");
          current = body.session;
          setPlan(current);
        } else {
          const record = await buildApprovalRecord(current, { scope: "executable-export", approvedBy: "workbench" });
          current = applyApproval(current, record);
          setPlan(current);
        }
      }
      const result = translateForDobot({ plan: current }) as ExportResult;
      setExportResult(result);
      setShowAllWarnings(false);
      setActivePage("output");
    } catch (error) {
      setExportResult(null);
      setExportError(error instanceof Error ? error.message : "Export failed.");
    }
  };

  const copyFile = async (name: string) => {
    if (!exportResult) return;
    try {
      await navigator.clipboard.writeText(exportResult.files[name]);
    } catch {
      // Clipboard access can be denied by the browser; the text is still visible to copy manually.
    }
  };

  // Same File System Access API / download-link fallback pattern as
  // savePlanFile — a real save to the human's own disk, not a copy
  // living only in this tab. `name` keeps the extension the
  // post-processor actually emitted (global.lua, src0.lua, src1.lua);
  // the human's own project name, if given, becomes a readable prefix
  // rather than replacing that name outright.
  const saveOutputFile = async (name: string, content: string) => {
    const prefix = exportFileName.trim();
    const suggestedName = prefix ? `${prefix}-${name}` : name;
    const blob = new Blob([content], { type: "text/plain" });
    try {
      const picker = (
        window as Window & {
          showSaveFilePicker?: (options: {
            suggestedName: string;
            types: { description: string; accept: Record<string, string[]> }[];
          }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
        }
      ).showSaveFilePicker;
      if (picker) {
        const handle = await picker({ suggestedName, types: [{ description: "Lua script", accept: { "text/plain": [".lua"] } }] });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = suggestedName;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setExportError(`"${name}" could not be saved. Please try again.`);
      }
    }
  };

  const rotateHandler = (dx: number, dy: number) =>
    setRotation((r) => ({ yaw: r.yaw + dx * 0.009, pitch: Math.max(-1.25, Math.min(1.25, r.pitch + dy * 0.009)) }));

  const currentMachine = MACHINES.find((m) => m.id === (plan?.machine.id ?? selectedMachineId));

  return (
    <main className="app-shell">
      <input
        ref={fileInputRef}
        className="visually-hidden-file"
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void loadPlanFile(file);
        }}
      />
      <header className="topbar">
        <div className="brand">
          <b>SAAM</b>
          <span>Reference Workbench</span>
        </div>
        <div className="file-actions">
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            Open plan…
          </button>
          <button type="button" onClick={() => void savePlanFile()} disabled={!plan}>
            Save plan…
          </button>
          <button type="button" onClick={clearPlan} disabled={!plan}>
            Clear
          </button>
        </div>
        <div className="render-toggle">
          <button type="button" aria-pressed={!filled} onClick={() => setFilled(false)} className={!filled ? "selected" : ""}>
            Toolpath lines
          </button>
          <button type="button" aria-pressed={filled} onClick={() => setFilled(true)} className={filled ? "selected" : ""}>
            Filled beads
          </button>
        </div>
        <div className="machine-readout">
          <span>Machine</span>
          <b>{currentMachine?.name ?? selectedMachineId}</b>
        </div>
      </header>

      <nav className="page-tabs">
        <button type="button" className={activePage === "workbench" ? "selected" : ""} onClick={() => setActivePage("workbench")}>
          Workbench
        </button>
        <button
          type="button"
          className={activePage === "output" ? "selected" : ""}
          disabled={!exportResult}
          onClick={() => exportResult && setActivePage("output")}
        >
          Output
        </button>
      </nav>

      {loadErrors.length > 0 && (
        <div className="load-errors" role="alert">
          <b>The selected file isn't a plan this workbench can read:</b>
          <ul>
            {loadErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {activePage === "workbench" && (
        <section className="workspace">
          <div className="current-view">
            <ViewerCard title="Current operation">
              <ToolCanvas mode="current" plan={plan} activeIndex={active} fraction={fraction} rotation={rotation} filled={filled} viewport={viewports.current} onViewportChange={(v) => setViewports((c) => ({ ...c, current: v }))} onRotate={rotateHandler} />
              {activeOp ? (
                <div className="active-operation-summary">
                  <span>
                    OPERATION {active + 1} OF {plan?.operations.length}
                  </span>
                  <b>{operationDisplayName(activeOp)}</b>
                  <small>{activeOp.evidence ?? "EXPERIMENTAL"} · {activeOpLayers === 1 ? "Spatial pass" : `Layer ${layer} of ${activeOpLayers}`}</small>
                </div>
              ) : (
                <div className="empty-preview">Open a process plan to begin</div>
              )}
            </ViewerCard>
          </div>
          <div className="part-view">
            <ViewerCard title="Finished part">
              <ToolCanvas mode="part" plan={plan} activeIndex={active} fraction={fraction} rotation={rotation} filled={filled} viewport={viewports.part} onViewportChange={(v) => setViewports((c) => ({ ...c, part: v }))} onRotate={rotateHandler} />
              {!plan && <div className="empty-preview">Open a process plan to begin</div>}
            </ViewerCard>
          </div>
          <div className="collective-view">
            <ViewerCard title="Collective toolpath">
              <ToolCanvas mode="collective" plan={plan} activeIndex={active} fraction={fraction} rotation={rotation} filled={filled} viewport={viewports.collective} onViewportChange={(v) => setViewports((c) => ({ ...c, collective: v }))} onRotate={rotateHandler} />
              {!plan && <div className="empty-preview">No toolpaths yet</div>}
            </ViewerCard>
          </div>

          <aside className="operation-rail">
            <header>
              <span>BUILD PROGRESS</span>
            </header>
            {plan ? (
              <div className="rail-layer">
                <input
                  aria-label="Build progress"
                  type="range"
                  min={1}
                  max={totalSteps}
                  value={Math.min(globalStep, totalSteps)}
                  onChange={(e) => setGlobalStep(Number(e.target.value))}
                />
                <b>
                  {Math.min(globalStep, totalSteps)}/{totalSteps}
                </b>
              </div>
            ) : (
              <div className="empty-history">EMPTY</div>
            )}
          </aside>

          <section className={`export-panel${plan ? "" : " empty"}`}>
            <header>
              <span>EXPORT</span>
            </header>
            {!plan ? (
              <p className="export-empty">No program.</p>
            ) : plan.machine.id !== KNOWN_MACHINE_ID ? (
              <p className="export-empty">No post-processor registered in this interface for machine "{plan.machine.id}" yet.</p>
            ) : (
              <>
                <label className="export-name">
                  <span>File name</span>
                  <input value={exportFileName} onChange={(e) => setExportFileName(e.target.value)} placeholder="e.g. shot-glass" />
                </label>
                <button type="button" className="export-action" onClick={() => void exportPlan()}>
                  Export
                </button>
                {exportError && <p className="export-error">{exportError}</p>}
              </>
            )}
          </section>
        </section>
      )}

      {activePage === "output" && exportResult && (
        <section className="output-page">
          {exportResult.warnings.length > 0 &&
            (() => {
              const large = exportResult.warnings.filter((w) => (w.gapMm ?? Infinity) >= LARGE_GAP_MM);
              const small = exportResult.warnings.filter((w) => (w.gapMm ?? Infinity) < LARGE_GAP_MM);
              return (
                <div className="output-warnings">
                  {large.length > 0 && (
                    <div className="warning-group large">
                      <b>
                        {large.length} large gap{large.length === 1 ? "" : "s"} (&ge;{LARGE_GAP_MM}mm)
                      </b>
                      <p>
                        The nozzle would travel this far with extrusion still on — a real, likely-visible
                        defect, not a cosmetic warning. Worth reviewing before printing.
                      </p>
                    </div>
                  )}
                  {small.length > 0 && (
                    <div className="warning-group small">
                      <b>
                        {small.length} small transition{small.length === 1 ? "" : "s"} (&lt;{LARGE_GAP_MM}mm)
                      </b>
                      <p>Expected gaps between adjacent fill passes — not evidence of a routing error.</p>
                    </div>
                  )}
                  <button type="button" className="warnings-toggle" onClick={() => setShowAllWarnings((v) => !v)}>
                    {showAllWarnings ? "Hide" : "Show"} all {exportResult.warnings.length} warnings
                  </button>
                  {showAllWarnings && (
                    <ul className="warnings-detail">
                      {exportResult.warnings.map((w, i) => (
                        <li key={i}>{w.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}
          {Object.entries(exportResult.files).map(([name, content]) => (
            <div className="output-file" key={name}>
              <div className="output-file-head">
                <b>{name}</b>
                <div className="output-file-actions">
                  <button type="button" onClick={() => void copyFile(name)}>
                    Copy
                  </button>
                  <button type="button" onClick={() => void saveOutputFile(name, content)}>
                    Save
                  </button>
                </div>
              </div>
              <pre>{content}</pre>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
