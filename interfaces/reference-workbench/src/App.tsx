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
type ExportResult = { files: Record<string, string>; warnings: { code: string; message: string }[] };

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

function ring(radius: number, z: number, count = 90): Point[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = ((Math.PI * 2) * i) / count;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius, z };
  });
}

function rectanglePreview(width: number, depth: number, z: number): Point[] {
  return [
    { x: -width / 2, y: -depth / 2, z },
    { x: width / 2, y: -depth / 2, z },
    { x: width / 2, y: depth / 2, z },
    { x: -width / 2, y: depth / 2, z },
    { x: -width / 2, y: -depth / 2, z },
  ];
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

function partSpan(part?: PartSpec): number {
  if (!part) return 60;
  const flat = Math.max(part.width ?? 0, part.depth ?? 0, part.outerDiameter ?? 0, 40);
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
        const { part } = plan;
        const h = part.height;
        if (part.shape === "box" || part.shape === "surface") {
          const w = part.width ?? 40;
          const d = part.depth ?? 40;
          [rectanglePreview(w, d, 0), rectanglePreview(w, d, h)].forEach((pts) =>
            drawLine(ctx, pts, rect.width, rect.height, "#8acbc3", rotation.yaw, rotation.pitch, centerY, span, filled ? 2 : 1, 0.85)
          );
        } else {
          const outer = (part.outerDiameter ?? 40) / 2;
          const inner = (part.innerDiameter ?? 0) / 2;
          [ring(outer, 0), ring(outer, h)].forEach((pts) =>
            drawLine(ctx, pts, rect.width, rect.height, "#8acbc3", rotation.yaw, rotation.pitch, centerY, span, filled ? 2 : 1, 0.9)
          );
          if (inner > 0) {
            [ring(inner, 0), ring(inner, h)].forEach((pts) =>
              drawLine(ctx, pts, rect.width, rect.height, "#739d99", rotation.yaw, rotation.pitch, centerY, span, 1, 0.75)
            );
          }
        }
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
  // Sticky once true, so the status line can say "connection lost"
  // rather than reusing the "never connected" message once the bridge
  // has actually been reachable at some point in this page's lifetime.
  const [everConnected, setEverConnected] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState(MACHINES[0].id);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [layer, setLayer] = useState(1);
  const [filled, setFilled] = useState(true);
  const [rotation, setRotation] = useState({ yaw: -0.72, pitch: 0.55 });
  const [viewports, setViewports] = useState<Record<ViewMode, Viewport>>({
    part: { ...DEFAULT_VIEWPORT },
    collective: { ...DEFAULT_VIEWPORT },
    current: { ...DEFAULT_VIEWPORT },
  });
  const [approverName, setApproverName] = useState("");
  const [approvalMessage, setApprovalMessage] = useState("");
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState("");
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
        setEverConnected(true);
        setPlan((current) => {
          if (!session) return current;
          if (current && current.revision === session.revision && current.machine.id === session.machine.id && JSON.stringify(current.approval) === JSON.stringify(session.approval)) {
            return current; // no real change — skip a state update and the resulting re-render/redraw
          }
          setActive(0);
          setLayer(1);
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

  const activeOp = plan?.operations[active] ?? null;
  const activeOpLayers = activeOp ? operationLayerCount(activeOp) : 1;
  const fraction = Math.max(1, layer) / activeOpLayers;

  const canExport = plan?.machine.id === KNOWN_MACHINE_ID && plan ? hasCurrentApproval(plan, "executable-export") : false;

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
    setApprovalMessage("");
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
      setActive(0);
      setLayer(1);
      resetViews();
    } catch (error) {
      setLoadErrors([error instanceof Error ? error.message : "The file is not valid JSON."]);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const clearPlan = () => {
    setPlan(null);
    setExportResult(null);
    setExportError("");
    setApprovalMessage("");
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // Best-effort only.
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
        setApprovalMessage("The plan file could not be saved. Please try again.");
      }
    }
  };

  // Live session: the approval is written back to the adapter's session
  // over the local bridge, so post_process can read it immediately — no
  // manual file hand-off. Standalone (no bridge, e.g. plain `npm run
  // dev` or a plan opened from a file): falls back to computing the
  // approval locally, same as before — still real, just not shared with
  // anything outside this browser tab.
  const approve = async (scope: "geometry" | "executable-export") => {
    if (!plan) return;
    if (!approverName.trim()) {
      setApprovalMessage("Enter who is approving this revision before approving it.");
      return;
    }
    try {
      if (liveConnected) {
        const res = await fetch("/api/session/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope, approvedBy: approverName }),
        });
        const body = (await res.json()) as { session?: ProcessPlan; error?: string };
        if (!res.ok || !body.session) throw new Error(body.error ?? "Approval failed.");
        setPlan(body.session);
      } else {
        const record = await buildApprovalRecord(plan, { scope, approvedBy: approverName });
        setPlan(applyApproval(plan, record));
      }
      setApprovalMessage(`Approved revision ${plan.revision} for ${scope} by ${approverName.trim()}.`);
      setExportResult(null);
    } catch (error) {
      setApprovalMessage(error instanceof Error ? error.message : "Approval failed.");
    }
  };

  const runExport = () => {
    if (!plan) return;
    setExportError("");
    try {
      const result = translateForDobot({ plan }) as ExportResult;
      setExportResult(result);
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

      <section className="status-strip">
        <span className={`status-dot${plan ? "" : " idle"}`} />
        {plan ? (
          <>
            <b>Revision {plan.revision}</b>
            <span>{plan.status}</span>
            {plan.approval && <span>· approved ({plan.approval.scope}) by {plan.approval.approvedBy}</span>}
          </>
        ) : (
          <span>Waiting for a compiled plan</span>
        )}
        <i className={`session-connection${liveConnected ? " connected" : everConnected ? " lost" : ""}`}>
          <span />
          {liveConnected
            ? "Live session — updates automatically"
            : everConnected
              ? "Connection lost — retrying…"
              : "Standalone — not served by the SAAM adapter"}
        </i>
      </section>

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

      <section className="workspace">
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

        <aside className="operation-rail">
          <header>
            <span>BUILD HISTORY</span>
            <b>{plan ? `${active + 1}/${plan.operations.length}` : "0/0"}</b>
          </header>
          {plan ? (
            <>
              <div className="rail-track">
                {plan.operations.map((op, i) => (
                  <button
                    key={op.invocationId}
                    onClick={() => {
                      setActive(i);
                      setLayer(operationLayerCount(op));
                    }}
                    className={i === active ? "active" : i < active ? "done" : ""}
                    aria-label={`Show ${operationDisplayName(op)}`}
                  >
                    <i style={{ background: operationColor(i) }} />
                    <span>{i + 1}</span>
                  </button>
                ))}
              </div>
              <input
                className="operation-range"
                aria-label="Operation history"
                type="range"
                min={0}
                max={Math.max(0, plan.operations.length - 1)}
                value={active}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setActive(i);
                  setLayer(operationLayerCount(plan.operations[i]));
                }}
              />
              <div className="rail-layer">
                <span>{activeOpLayers === 1 ? "PROGRESS" : "LAYER"}</span>
                <input aria-label="Active layer" type="range" min={1} max={activeOpLayers} value={Math.min(layer, activeOpLayers)} onChange={(e) => setLayer(Number(e.target.value))} />
                <b>
                  {Math.min(layer, activeOpLayers)}/{activeOpLayers}
                </b>
              </div>
            </>
          ) : (
            <div className="empty-history">EMPTY</div>
          )}
        </aside>

        <section className={`export-panel${plan ? "" : " empty"}`}>
          <header>
            <div>
              <span>HUMAN APPROVAL &amp; EXPORT</span>
              <h2>Review, approve, export</h2>
            </div>
            <i>
              <span />
              {plan ? plan.status : "No plan"}
            </i>
          </header>

          <div className="approval-row">
            <label>
              <span>Approved by</span>
              <input value={approverName} onChange={(e) => setApproverName(e.target.value)} placeholder="Your name" disabled={!plan} />
            </label>
            <button type="button" disabled={!plan} onClick={() => void approve("geometry")}>
              Approve geometry
            </button>
            <button type="button" disabled={!plan} onClick={() => void approve("executable-export")}>
              Approve for export
            </button>
          </div>
          {approvalMessage && <p className="approval-message">{approvalMessage}</p>}

          <hr className="export-divider" />

          {!plan ? (
            <p className="export-empty">No program.</p>
          ) : plan.machine.id !== KNOWN_MACHINE_ID ? (
            <p className="export-empty">No post-processor registered in this interface for machine "{plan.machine.id}" yet.</p>
          ) : !canExport ? (
            <p className="export-empty">Preview only — approve this revision for executable-export first.</p>
          ) : (
            <>
              <button type="button" className="export-action" onClick={runExport}>
                Generate Dobot Lua
              </button>
              {exportError && <p className="export-error">{exportError}</p>}
              {exportResult && (
                <div className="export-result">
                  {exportResult.warnings.length > 0 && (
                    <div className="export-warnings">
                      <b>
                        {exportResult.warnings.length} warning{exportResult.warnings.length === 1 ? "" : "s"}
                      </b>
                      <ul>
                        {exportResult.warnings.map((w, i) => (
                          <li key={i}>{w.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Object.entries(exportResult.files).map(([name, content]) => (
                    <div className="export-file" key={name}>
                      <div className="export-file-head">
                        <b>{name}</b>
                        <button type="button" onClick={() => void copyFile(name)}>
                          Copy
                        </button>
                      </div>
                      <pre>{content}</pre>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </section>
    </main>
  );
}
