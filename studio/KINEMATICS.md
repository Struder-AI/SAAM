# Machine presentation integration contract

**Status: v1 implemented in Studio and shared machine providers.**
The user selects a machine ghost plus a Machine view toggle, with ordinary zoom
in both modes. The visual language is Studio's simple lines, shapes and cones,
with careful color, transparency, framing and visibility. Photorealistic machine
assets, inset views, lenses and split windows are outside this implementation.
See [the recorded direction](../DECISIONS.md#d-028--simple-machine-ghost-and-machine-view).

This document owns the boundary between incremental machine models and Studio.
It does not prescribe a kinematic solver or a general machine-description format.
[Rendering](RENDERING.md) owns existing toolpath appearance;
[machine output](../core/export/README.md) owns source interpretation;
[print lifecycle](../core/print/README.md) owns review and delivery.

## Responsibilities and independent work

| Owner | Supplies | Does not supply |
|---|---|---|
| Kinematic-model task | A presentation provider: stable component IDs, simple local geometry, resolved world transforms at source time, availability and diagnostics | Camera, theme colors, transparency, UI or an alternative toolpath renderer |
| Studio task | Provider registration/transport, primitive drawing, ghost/Machine switch, camera and visibility behavior, synchronized playback and movies | Link lengths, joint coupling, IK branches, guessed frames or machine-specific motion equations |
| Shared source/playback owner | Interpretation of checked export bytes and the command-time interpolation used by both views | Motion reconstructed from comments or a separately replanned path |

**Studio delivers the complete presentation upgrade as one work package:**
ghost/Machine switching, camera behavior, links, rails and print carriages,
integrated with the bed and tool already displayed. It does not stop at a
bed/tool milestone, a fixture viewer or a partially implemented primitive set.
Only the model builder works incrementally. A deterministic synthetic provider
allows Studio to develop and verify the entire consumer while real model data
is still being built; it is test infrastructure, not the user-facing deliverable.

The model task can supply any subset of actual components.
A model-specific adapter translates its internal results into this contract;
Studio does not branch on machine IDs, axis counts, serial/parallel topology or
solver output shapes. A new machine registers a provider, not a new viewer.
Synthetic fixtures are development-only and never selected for an ordinary print.

The model task owns the provider implementation under `core/machine/`; Studio
owns its caller, renderer and UI under `studio/`. The shared contract is edited
here first when its semantics change. Neither task implements the other side's
missing behavior in its own layer. Module filenames, worker packaging and internal
solver APIs remain implementation choices; the data and behavior below are fixed
for v1. Only trusted, explicitly registered modules are loaded, not executable
paths supplied by a saved model or print.

Adding optional metadata is compatible with v1; consumers ignore unknown optional
fields. Changing transform semantics, required fields, role meanings or primitive
kinds requires a new schema version and coordinated producer/consumer support.
An unsupported schema returns a visible unavailable-model state, not a guessed
interpretation. Growing a model using the existing primitives only changes its
descriptor/model key, not the schema or Studio implementation.

## Visual and camera contract

There are two modes controlled by one **Machine view** switch:

- **Off: ghost (default).** Keep the current part framing and detailed toolpath.
  Draw the available machine in quiet neutral lines and simple translucent shapes.
  The person can orbit, pan and zoom out to see more machine, or zoom in to see
  less. Do not permanently crop, hide or omit distant components merely because
  the initial part view excludes them. Viewport clipping is sufficient.
- **On: machine.** Fit the machine on first entry and raise assembly visibility
  so its configuration and motion are easy to read. Keep the same toolpath,
  playback position, operation colors and material renderer. Subsequent visits
  restore this mode's last camera. Returning to ghost restores the prior ghost
  camera, including any manual zoom. Reset view fits the active mode explicitly.

Ordinary zoom never changes modes. New poses and arriving model data never
auto-fit the camera. The machine's size must not enter the default part fit or
the toolpath's level-of-detail calculation. An unavailable model leaves the
existing part/nozzle view working; disable the switch with a concise explanation.
A partial model permits Machine view and identifies its incomplete scope.

**Follow build plate is independent of this switch.** Preserve the person's
chosen reference frame on a mode change. Apply that reference transform to the
entire scene consistently. Remember reference-frame preference once, and camera
state per mode. Camera transitions, if included, are short, interruptible and
respect reduced motion; scrubbing does not initiate one.

Studio owns a small theme-driven palette by component role. Start with faint
structure, somewhat stronger moving links and a clear active tool/contact point.
Do not assign rainbow colors by joint or let the model set CSS colors or opacity.
Retain existing operation colors, layer fading, bead dimensions, holes, travel
visibility and line fallbacks. No new solid part mesh obscures deposition.

Simple primitives are enough: lines for rails/rods, small shapes for print
carriages and pivots, an outline or plane for a plate, a cone for the tool.
Reuse and integrate the existing bed/tool presentation rather than treating it
as a new first phase. Avoid decorative
mesh detail, strong machine shadows, permanent joint labels and new perspective
effects. Improve hierarchy and legibility before adding geometric sophistication.

In ghost mode, machine marks must not wash out the active toolpath or contact.
Use a deliberate compositing order and subdued fills; an opaque toolpath can
cover ghost context. In Machine mode, give overlaps consistent depth ordering
within the fidelity of the primitive renderer. Never imply that ghost visibility
establishes physical clearance. The current offscreen WebGL material plus 2D
canvas composition has no automatically shared machine depth buffer: choose
and verify an explicit compositing strategy rather than assuming one exists.

### Implemented consumer

[source-worker.mjs](source-worker.mjs) decodes source once and retains compact
motion for the provider. [machine-session.mjs](machine-session.mjs) owns bounded
requests, cancellation, stale-response rejection and the current-time cache.
Descriptor validation and primitive compilation happen once on receipt; poses
are validated in the worker. Invalid or unsupported model data disables its
overlay while preserving the decoded toolpath.

[machine-view.mjs](machine-view.mjs) compiles every v1 primitive, applies resolved
frames and supplies both WebGL and Canvas drawing. WebGL primitives share the
material projection and depth attachment. Ghost context is composited before
material color, with the tool depth-tested afterward; Machine mode depth-tests
all components against deposited material. Translucent component faces/edges
are ordered by camera depth. The Canvas fallback uses painter ordering with
the same geometry and palette; it does not claim per-pixel occlusion.

Ghost retains the existing part projection and material detail. Explicit Machine
fitting uses the declared envelope, or the current resolved components when no
envelope exists, with padding based on projected extents. Both modes retain
orbit, pan and ordinary zoom. New views follow the build plate; saved reference
preferences take precedence. Changing reference frame refits both saved camera
bounds without changing their orbit, pan or zoom. Grid, source, tool and assemblies
use the same part transform. Playback advances after the matching pose resolves;
paused seeks show loading until that exact time arrives. Movies await the same
sample and draw path for each output frame.

## Provider interface

Machine view also offers manual tool-position sliders when a provider supplies
`controls` (ordered `{label, unit, min, max, step}` records). These are model-owned
pose coordinates, not actuator commands. Fixed ranges conservatively bound the
model's workspace from mechanism dimensions and installation transforms; they do
not depend on loaded motion. Values within those scalar ranges are not necessarily
jointly reachable. `sample` accepts optional `manual: number[]` in that order and
`jog: {axis, from}` to prioritize one coordinate from a previous valid pose. It returns
the accepted `controlValues`, which may differ from the requested coordinates. A manual
snapshot echoes `manual`; its `seconds` anchors the frozen source/rotary state,
not a claim that the pose came from that source. The same solver and diagnostics
apply. Consumers distinguish manual requests in their cache and request identity.

Sliders appear only in Machine view and pause playback. Play, timeline seeks,
Return to playback, changing mode/stage/source, and movie export clear the manual
override. Manual posing is temporary simulation: source bytes, approvals and
machine delivery are unchanged. Studio renders the frozen source path with the
manually posed machine and does not add a deposition/contact marker at its tip.
While a manual solve is pending or fails, the view retains the last complete pose
at that source time. Diagnostics describe the requested pose; retained geometry
does not imply it succeeded. A source/model rebind clears that retained pose.

Rail endpoints are fixed working carriage limits in the machine definition
(`railMinMm`/`railMaxMm` for the delta models, with Tilty's three tilt-rail
starts in `tiltRailMinMm`), not a source-derived crop. They do
not stretch during manual control. This defines working center travel, not the
extra stock length needed to support the carriage body beyond its end position.

The model's [jog controller](../core/machine/jog.mjs) follows local feasible poses,
prioritizing the dragged coordinate and projecting small corrections to other
coordinates against model-owned signed boundary margins. Angular displacement is
weighted by the modeled tool/rear lever. It stops at a local boundary or solver
failure, rather than crossing an unsupported configuration. This is local numerical
continuation, not a globally shortest adjustment, global reach certification or
collision-aware motion planner. The UI displays accepted coordinates, retains
the last complete assembly while solving, and keeps source/jog cache identity
separate. Only the existing model limits are enforced; unspecified physical joint
and collision limits are not inferred.

The following TypeScript notation specifies a JavaScript interface, not a new
runtime dependency or persisted print format. Records use structured-cloneable
plain data and finite numbers. The public operations are asynchronous so Studio
does not depend on where computation runs.

```ts
type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3]; // row-major rotation
type Rigid = { translationMm: Vec3; rotation: Mat3 };
type Bounds = { min: Vec3; max: Vec3 };
type Binding = {
  printId: string;
  revision: string;   // opaque current review identity, normalized by the host
  exportHash: string; // identity of the checked export, including its inventory
  modelKey: string;   // see identity rules below
};
type Primitive =
  | { kind: 'line'; fromMm: Vec3; toMm: Vec3 }
  | { kind: 'polyline'; pointsMm: Vec3[]; closed: boolean }
  | { kind: 'sphere'; radiusMm: number }
  | { kind: 'box'; sizeMm: Vec3 }
  | { kind: 'cone'; lengthMm: number; radiusStartMm: number; radiusEndMm: number };
type Component = {
  id: string;
  label: string;
  role: 'structure' | 'rail' | 'link' | 'carriage' | 'joint' | 'bed' | 'tool';
  frameId: string;
  local: Rigid;
  shape: Primitive;
};
type Descriptor = {
  schema: 'saam-machine-presentation/1';
  binding: Binding;
  label: string;
  basis: string;        // e.g. nominal dimensions, measured installation, fixture
  frameIds: string[];   // includes reserved 'world', 'part', 'tcp'
  components: Component[];
  machineBoundsWorldMm: Bounds | null; // framing envelope, never a reach claim
  limitations: string[]; // modeled scope and omitted assemblies
};
type Request = {
  requestId: number;
  seconds: number;      // exact requested source-program time
};
type Diagnostic = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  componentIds?: string[];
};
type Snapshot = {
  schema: 'saam-machine-pose/1';
  binding: Binding;
  requestId: number;
  seconds: number;
  status: 'ready' | 'partial' | 'unavailable';
  worldFromFrame: Record<string, Rigid>;
  diagnostics: Diagnostic[];
};
type Provider = {
  descriptor: Descriptor;
  sample(request: Request, options?: { signal?: AbortSignal }): Promise<Snapshot>;
  dispose(): void;
};
```

The creation boundary is
`createMachinePresentation({ program, machine, setup, sourceIdentity, signal })`.
It returns `Promise<Provider | null>`; `null` means no registered model.
`program` is the existing immutable interpreted export with its move/event access,
not generated SAAMpath or a new serialized trajectory. Explicitly read-only
[machine studies](../tools/kinematics/README.md) also supply decoded authored
motion or unchanged Splitty preview source; these are labeled simulation and
cannot authorize machine delivery. `machine` and `setup` are
the resolved existing profile and job installation. `sourceIdentity` supplies
`printId`, `revision` and `exportHash`; the provider adds `modelKey`. The Studio
host owns passing these existing values and any worker bridge. Creation failures
produce a model-unavailable message while leaving ordinary source playback usable.

Every component ID is unique and stable within a model configuration. Multiple
components may attach to one frame. Rigid geometry is declared once; snapshots
carry poses rather than repeatedly copying shapes. Shape/dimension changes create
a new descriptor/model key. A rod can be one line in its own resolved frame;
Studio need not know how its endpoints are constrained.

Sphere and box shapes are centered at their local origin; box edges follow local
XYZ. Cones extend from Z=0 to Z=length, with the two radii at those ends. Equal
radii describe a cylinder; a zero end radius describes a point. Lengths and box
sizes are positive; radii are nonnegative, with at least one cone radius positive.
Polyline points number at least two. Zero-length lines may be skipped. Studio
controls screen stroke widths and may render shapes as simple shaded polygons
or outlines. All v1 primitive kinds have a visual implementation or explicit
fallback; a provider does not require detailed meshes for basic display.

## Coordinates and alignment

All lengths are mm, times seconds, and frames right-handed. A rigid transform
maps `p` to `rotation * p + translationMm`; matrices are orthonormal with
determinant +1. No scaling, reflection, Euler-order convention or camera transform
crosses this boundary. Numerical rigid-transform validation permits 1e-6 error
in orthonormality/determinant; this is not a mechanical tolerance.

`world` is the fixed display room, with +Z up. The provider resolves installation
and mounting transforms, including ceiling-mounted robots. It supplies:

- `world`: identity.
- `part`: world transform of the exact coordinate frame used by interpreted
  toolpath points, including configured placement/rotary motion exactly once.
  Do not reinterpret these points as raw CAD coordinates or reapply placement.
- `tcp`: nozzle-tip origin. For this **presentation** frame, local -Z points
  toward extrusion and +Y is `toolUp`; +X completes the right-handed basis.
  The provider converts any internal/vendor tool convention to this basis.
- Other frames: resolved world transforms for whichever components are known.

The same source pose must locate the existing toolpath nozzle and the presented
tool tip. Studio does not render two competing nozzle markers. Reuse one contact
marker and suppress the legacy tool glyph only when the provider actually supplies
a drawable tool at the current time. If orientation is unknown, do not invent a
wrist orientation merely to display a cone; retain the existing supported marker.

In room view, a toolpath point is `worldFromPart * point`. When following the
plate, apply `inverse(worldFromPart)` to every world-space machine component,
tool and bed as well as the material. Preserve existing camera/pan conventions
after that common mapping. Unknown part-to-world alignment prevents overlay:
return `unavailable` rather than guessing a mounting translation or rotation.

`machineBoundsWorldMm`, when present, covers the declared machine's configured
motion envelope and is used for explicit machine fitting only. If absent,
Studio can fit the currently available primitive bounds on explicit entry/reset.
It does not continuously refit moving bounds or treat either envelope as tested
reachability. With Follow build plate enabled, transform the framing envelope
into that display frame before fitting.

## Time, continuity and incremental availability

`sample` accepts any finite time from zero through program duration, including
reverse seeks and the final endpoint. Out-of-range requests fail explicitly;
the caller clamps UI time using the existing playback duration. Returned time
and request ID match the request exactly. A snapshot contains a complete set of
currently available frame transforms, not deltas from a prior call.

The provider consumes the same command-time interpolation as source playback,
including rotary motion, dwell and supported acceleration semantics. Factor or
extend that shared evaluator when needed; do not copy interpolation into the
new renderer or approximate it by linearly interpolating solved joint endpoints.
Any cached sampling/interpolation error policy belongs to the model provider.
The Studio task does not interpolate arbitrary link poses or repair solver output.

The result for a source time is independent of seek order and rendering speed.
Providers with seeded solvers own deterministic branch selection/checkpoints;
the previous screen frame is not the only seed. Unsupported branches, commands,
unresolved setup or a solve failure are explicit diagnostics. They never silently
select a different trajectory, clip a commanded pose, or relabel a stale pose.

- `ready`: all declared components have poses for this time. This says nothing
  about omitted components, calibration, collisions or physical feasibility.
- `partial`: alignment is known but some declared frames are unavailable. Draw
  only components whose frames are present, and show concise scope/diagnostics.
- `unavailable`: no usable aligned machine pose. Keep source toolpath playback
  and its existing supported marker; show the reason.

Missing frames are omitted, never replaced with identity or a previous pose.
A bed/tool-only descriptor can be ready while still listing the absent arm in
`limitations`. Additional links arrive through a new descriptor; no viewer
changes are needed. Failed moving frames can be omitted while known static
frames remain drawable as a partial result. No joint-state array is required by
Studio; numeric joint readouts and solver-specific metrics are later extensions.

## Identity, asynchronous work and lifecycle

`modelKey` changes with model dimensions, calibration, tool transforms, branch
policy, solver behavior or presentation geometry. The full binding associates
every descriptor, cached pose and response with one print/review/export/model.
Display preferences are separate and do not change manufacturing approvals.
No pose/trajectory cache becomes a required saved print artifact.

Studio gives requests increasing IDs, discards responses for obsolete bindings
or requests, and cancels work where supported. Disposal cancels provider work
and releases its resources; late responses after disposal are ignored. Model
changes replace the provider/descriptor without moving the part camera.

Never display a machine pose from a different time alongside the current nozzle.
While a new pose is pending, hide its moving assembly and indicate loading;
keep toolpath playback and controls responsive. Repeated drawing at the same
time reuses the resolved snapshot. Movie export awaits the snapshot for each
chosen output frame, using the same renderer and settings, rather than recording
an interactive cache lag. Solving and large model preparation stay out of the
UI drawing loop. Reduce optional machine detail before reducing toolpath quality.

Validate descriptor structure once per binding and response structure at the
provider/worker boundary; renderers consume that result. Reuse model diagnostics
instead of adding a second kinematic check in Studio. This interface adds no
manufacturing approval or feasibility gate and removes none from existing
workflow. Labels describe simulated motion, not live hardware telemetry.

## Complete Studio delivery and incremental model compatibility

**Studio work package:** deliver both modes, ordinary orbit/pan/zoom, remembered
cameras, the complete primitive/role renderer (including links, rails and print
carriages), existing bed/tool integration, source-time synchronization, missing
data handling and movie parity together. Exercise the whole contract with
synthetic data and connect available real providers. The model builder's pace
does not reduce this presentation scope. Missing model data is identified as
such; it is not replaced with made-up geometry or used to defer renderer work.

**Model work package:** implement the provider and grow the actual represented
mechanism incrementally. New links, rails, carriages and additional machines
arrive as descriptors/poses without new Studio rendering branches. Compare the
displayed tool tip against source playback and expose the model's actual scope.
DENSO-specific frames/branches stay with its adapter, not Studio.

**Shared boundary:** agree on and exercise the same small fixture so both tasks
can proceed concurrently. Partial/unavailable/delayed-model handling is part of
Studio's completed consumer, not a plan for incremental Studio delivery.

Acceptance is behavior-based, with focused checks reused by both tasks:

- A fixed and a moving-bed fixture agree between toolpath and machine TCP in
  both reference frames; a nonzero placement detects double-applied offsets.
- A line-based parallel mechanism and a box/cone serial mechanism use identical
  rendering code. Unsolved components disappear while known ones remain aligned.
- Reverse seek, dwell, final endpoint, speed changes and movie frames reproduce
  the same source-time pose. Delayed results and model changes cannot leak stale
  frames into the scene.
- Enabling context preserves the toolpath's fit, pixels-per-mm, material detail,
  colors and layer fading. Ghost zoom reveals more/less machine without a mode
  switch; returning from Machine restores the ghost camera.
- Visually inspect overlapping rods/wrist/part, an open bore, active deposition,
  and zoomed-out machine framing on a laptop viewport. The result remains clear
  with simple geometry; no screenshot of a photorealistic concept is a target.
- Measure representative dense-path interaction with and without machine drawing.
  Record any latency/frame-time regression and its cause; do not invent a universal
  FPS target or quietly trade away toolpath detail to hit one.

The first producer and consumer share one small conformance fixture at this
boundary. Its expected transforms come from analytical motions, not a copy of a
solver. Existing source, camera and material checks cover unchanged behavior;
do not repeat full machine/regression suites merely because another task starts.
