# Program Creation Workflow

This is the collaboration contract for turning an operator request into reviewed DobotStudio Pro Lua.

```text
Feature description
-> clarify material unknowns
-> exact path specification
-> deterministic preview
-> operator approval
-> Lua generation
-> conservative robot test
-> results recorded
```

## 1. Capture the requested behavior

Record what the robot should make and the operator's intent. Determine only the details that materially affect the result:

- feature geometry and dimensions;
- desired placement or work origin;
- orientation relative to X/Y and the robot;
- thin versus thick extrusion behavior;
- gaps, connectors, fills, holes, the mandatory material-print purge lead-in,
  optional dog ears/corner-adhesion scaffold, and finishing behavior;
- whether this is a new program or a modification of a known-good milestone;
- applicable bed, tool, and safety constraints.

If the operator describes the result visually rather than numerically, propose reasonable dimensions and label them clearly as assumptions.

## 2. Build one path specification

Represent the program as ordered motion primitives with at least:

- desired work-coordinate X/Y/Z;
- motion type: approach, travel, thin extrusion, thick extrusion, arc, lift, or finish;
- tool state;
- speed class;
- important grouping such as face, seam, perimeter, or infill.

For non-planar cladding, also record:

- the support scaffold or mass-building path already printed below the surface;
- the intended surface model, such as `z_surface(x, y)`;
- cladding contact targets and unsupported spans;
- true 3D segment length and maximum local slope;
- whether the path is a baseline constant-speed test or a speed-compensated
  extrusion test.

Before creating scanlines for a layer with holes or openings, decompose the
fillable material into connected regions. Complete each region before making
one intentional transition to the next region. Do not repeatedly jog around
the same feature once per intersecting scanline.

Derive the preview and Lua from the same path data whenever practical. Do not independently redraw the preview and hand-write unrelated coordinates into Lua.

## 3. Generate the approval preview

Use deterministic geometry rendering such as SVG or a plotted PNG. Do not use a generative illustration as the approval artifact because coordinates and path order must be exact.

The preview must show, as applicable:

- equal-scale X/Y axes, units, origin, and orientation;
- overall dimensions and bounding box;
- start and end positions;
- arrows or numbering for motion order;
- extrusion paths distinguished by thin/thick mode;
- travel, approach, lead-in, lift, and tool-off moves distinguished from print paths;
- purge-path length, serpentine-body clearance from the complete model and bed,
  and the one deliberate purge-to-model connector;
- dog-ear diameter/centers, part-owned overlap, breakaway-skirt gap, and the
  continuous support-to-part transition when corner adhesion is enabled;
- key coordinates labeled directly or in an accompanying move table;
- fill-region boundaries, region order, and feature-transition count;
- work envelope or known exclusion zones when relevant;
- a note stating that coordinates are desired User Frame/work coordinates before `CalibratedXY` correction.

For three-dimensional parts, default to a four-view engineering drawing:

- top view;
- front view;
- right-side view; and
- isometric view.

All four views must be derived from the same dimensions and path specification.
Use the orthographic views for coordinate and dimension approval and the
isometric view to make the overall 3D relationship easy to inspect.

Run geometry checks before presenting it:

- bounds and reach assumptions;
- continuity and unintended gaps;
- duplicate points or zero-length arc data;
- arc midpoint validity;
- tool-state transitions;
- safe start and finish order;
- whether travel crosses an unfinished or printed feature.
- whether the lead-in begins outside the complete part envelope and intersects
  the full multi-layer print only at its intended entry endpoint.

Save the proposed preview under `generated_previews/`. Mark it proposed until approved.

## 4. Obtain explicit approval

Ask the operator to approve or revise geometry, dimensions, placement, orientation, and motion ordering.

Do not generate final paste-ready Lua before approval unless the operator explicitly requests a diagnostic shortcut. If the design changes, regenerate the preview and obtain approval again.

Preview approval validates intent and coordinates; it is not authorization to assume the physical run is safe.

## 5. Generate DobotStudio Pro Lua

Start from `firmware/dobotstudio/milestone_struderbot_cube_diamond_stable/` unless another preserved milestone is clearly more appropriate.

- Keep shared settings and helpers in `global.lua`.
- Keep Remote I/O selection in `src0.lua`.
- Put program functions in `src1.lua`, `src2.lua`, or a clearly named additional tab.
- Use desired User Frame/work coordinates; let `P()` apply calibration.
- Use the stable `PenOn`, `PenOff`, `FinishExtrusionPath`, `J`, `LThin`, and `LThick` behavior.
- Use `MovJ` only for safe approaches/ready motion with extrusion off.
- Use linear travel for in-plane repositioning when extrusion may remain on.
- For every material print, use `dobot-prime-lead-in`: deposit at least 100 mm
  in a compact purge path, normally keep its serpentine body 5 mm clear of the
  complete part, then enter the model through one deliberate printed connector
  without a dwell or extrusion restart. Omit only for an explicit dry-motion
  or extrusion-off diagnostic.
- When corner adhesion is requested, use `dobot-dog-ears`. Generate the
  ear-only region by subtracting the finished part footprint from each corner
  disc, connect ears with the breakaway-skirt spans, and finish the complete
  support scaffold before beginning the part's first perimeter.
- Stop extrusion, lift in place, then travel away.
- Preserve the thick speed floor of 1.0 unless explicitly running a controlled tuning experiment.
- Prefer `Arc3` over `Circle3` for production curves.

Create a new working directory or milestone; do not overwrite the stable milestone.

## 6. Validate before handoff

- Compare all Lua path coordinates against the approved path specification.
- Verify function/block balance and tab dependencies.
- Confirm no program-local helper leaks globally without intent.
- Confirm I/O mapping, tool/user frame IDs, bed Z, and calibration source.
- Re-render from final path data and compare with the approved preview if generation changed.
- Run relevant automated tests and `git diff --check`.

Provide paste instructions by DobotStudio tab and a plain-language first-run checklist.

## 7. First physical run

For a new or materially changed path:

1. verify the real bed, tool, fixtures, frames, and stop controls;
2. reconnect or power-cycle after frame edits;
3. test a small marker or safe-height/dry motion when practical;
4. use conservative speed and maintain stop access;
5. observe the lead-in, first print move, all repositioning, and final lift closely.

## 8. Capture results

After the run, record:

- what program and revision was tested;
- bed/tool/frame configuration;
- what physically worked;
- measurements and tolerances;
- stalls, alarms, blobs, dragging, skew, or unsafe routing;
- tuning changes;
- whether the result is ROBOT-CONFIRMED, KNOWN FAILURE, or NEEDS RETEST.

Promote a successful program by copying it into a descriptively named milestone directory with a README. Update `docs/ROBOT_KNOWLEDGE.md` and `docs/PROJECT_STATE.md` before saving progress.
