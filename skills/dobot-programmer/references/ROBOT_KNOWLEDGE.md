# StruderBot Robot Knowledge

This is the canonical technical memory for programming and operating the Dobot MG400 as StruderBot. Preserve evidence labels when updating it. Physical robot results override IDE readouts, previews, and untested assumptions.

## Evidence status

- **ROBOT-CONFIRMED**: observed on the physical robot.
- **DOC-CONFIRMED**: supported by checked-in Dobot documentation.
- **EXPERIMENTAL**: proposed or implemented but not production-proven.
- **KNOWN FAILURE**: confirmed bad behavior.
- **NEEDS RETEST**: uncertain after a hardware, bed, frame, calibration, or software change.

## Iteration history

- **ROBOT-CONFIRMED / successful event iteration** — OpenSauce 2026 concluded
  successfully. The complete repository checkpoint is
  `iteration-opensauce-2026`.
- The event-level success confirms the integrated StruderBot demonstration and
  workflow outcome. It does not independently confirm every untracked or
  experimental variant preserved at the checkpoint.
- The permanent build-plate measurement, continuous-grid variants,
  double-density cube, continuous-infill diamond, independent-triangle work,
  and related approved previews are preserved as iteration artifacts. Their
  individual README evidence labels remain authoritative until future robot
  tests update them.

## Hardware and operating context

- **ROBOT-CONFIRMED** — Robot: Dobot MG400.
- **ROBOT-CONFIRMED** — The external Struder tool is relay-controlled through digital output 8 in the stable firmware.
- **ROBOT-CONFIRMED** — Illuminated selection buttons use DO1 and DO2; selections are read on DI1 and DI2.
- **ROBOT-CONFIRMED** — Approximate tool payload is 160 g. Removing/changing the end effector previously caused violent fourth-axis vibration, so load configuration is safety-critical.

## Mouse-ear adhesion and rounded-contour motion — 2026-08-15

- **KNOWN FAILURE** — Four 15 mm solid-filled mouse ears did not remain adhered
  during the first Gridfinity-bin attempt. The 0.20 mm nominal breakaway gap
  also did not create a clean separation from the goopy first part layer.
- **OPERATOR-SELECTED REVISION** — Increase ear diameter to 25 mm, keep all
  ordinary support paths at least 1.00 mm clear edge-to-edge from the part, and
  connect each ear only at three points: the exterior corner apex and the two
  nominal circle/side tangencies. Each contact is a V-shaped jog into the first
  perimeter and immediately back out, not a retraced bridge.
- **EXPERIMENTAL LOW-MASS PROCESS** — Command ear-only motion at 4.5 mm/s with
  1.80 mm sparse spacing. Inverse feed-per-length estimates a 0.553 mm bead and
  about 80% of the failed ear's total material despite the larger diameter.
  This width is calculated, not measured or robot-confirmed.
- **ROBOT OBSERVATION / STILL EXPERIMENTAL** — A subsequent 25 mm
  slow-squish mouse-ear test used `3.0 mm/s`, `2.70 mm` track spacing, and a
  lowered `BED_ZERO_Z + 0.55 mm` support plane. The ears were not dense enough.
  Do not promote those values; retain them as a lower-density experimental
  bound. The operator also observed that the foundation/support layer detracts
  from the cosmetic clarity of the omega pattern, motivating a raw no-base
  pattern stack as the next specimen.
- **ROBOT OBSERVATION** — Rounded Gridfinity box contours hesitated at their
  line/arc boundaries and accumulated goopy corner deposits.
- **EXPERIMENTAL CONTOUR COMPENSATION** — Preserve exact tangent native arcs,
  use contour-only CP 1.5, retain 3.0 mm/s on the straight sides, and command
  4.5 mm/s on corner arcs. Keep this motion class separate from purge, ear
  raster, tie jogs, infill, and fast repositioning.
- **ROBOT-CONFIRMED** — The current plexiglass bed is not flat. The stable demo temporarily uses `BED_Z = -7.00`; revisit bed height after the metal plate is installed.
- **OPERATOR DIMENSION CONVENTION — 2026-08-14** — Dimensions requested for a
  part are finished exterior dimensions unless explicitly labeled as guide,
  centerline, core, inside, or another derived dimension. Allocate perimeter
  beads and patterned-core clearance inward from that exterior envelope.
  Requested height likewise describes finished part height.

## Reliable execution and operator interaction

- **ROBOT-CONFIRMED LUA RUNTIME LIMIT — 2026-08-15:** the controller stopped
  the first beer-coozie program before motion with `attempt to call a nil value
  (field 'atan2')`. Do not call `math.atan2()` in Dobot Lua. Use a documented
  quadrant-specific expression built from the supported one-argument
  `math.atan(y / x)`, or a local quadrant-complete helper when inputs can cross
  quadrants.

- **OPERATOR WORKFLOW DECISION — 2026-08-14:** Remote I/O remains a preserved
  offline/demo capability, but normal iterative development should default to
  direct Online-mode execution from DobotStudio Pro. Do not impose button
  dispatch, hold qualification, selection lights, or multiple program slots on
  a development test unless explicitly requested.
- **ROBOT-CONFIRMED ONLINE-MODE LOAD TEST — 2026-08-14:** a newly saved,
  dependency-free, comments-only `src0.lua` launched from the DobotStudio Pro
  Online-mode Start control and reported `running complete`. It commanded no
  motion or I/O. Use this as the software-load baseline; it does not validate
  frames, shared globals, coordinates, kinematics, or extrusion.
- **ROBOT-CONFIRMED ONLINE-MODE RECOVERY — 2026-08-14:** staged tests proved
  Tool 1/User 1 point construction, live-pose-relative XYZ motion, a dry
  calibrated square, a deposited 20 mm square, and a calibrated 100 mm square
  spiral-vase wall 10 mm high. The vase wall printed visibly straight using
  the nonlinear XY correction; it did not use Z bed-warp compensation.
- **ROBOT-CONFIRMED START-POSTURE DEPENDENCE — 2026-08-14:** the unchanged
  successful vase program alarmed after the unlocked robot was manually moved
  substantially higher, then ran after it was returned near the bed-centered
  printing posture. For current Online development, manually park the nozzle
  roughly above User-frame X0/Y0 in the familiar posture before Start.
  Arbitrary-posture recovery is not required. Retest an immediate joint/IK
  alarm from this staging region before blaming print geometry.

- **ROBOT-CONFIRMED** — Remote I/O with physical buttons is the reliable execution path. The DobotStudio online/script runner behaved inconsistently during calibration.
- **ROBOT-CONFIRMED** — At startup, stable `src0.lua` calls `PenOff()` and `ReadyLights()` and does not move the robot.
- **ROBOT-CONFIRMED** — Waiting state: DO1 and DO2 on.
- **ROBOT-CONFIRMED** — DI1 rising edge selects program 1: DO1 on, DO2 off, then `RunCube()` in the stable milestone.
- **ROBOT-CONFIRMED** — DI2 rising edge selects program 2: DO1 off, DO2 on, then `RunDiamond()` in the stable milestone.
- **ROBOT-CONFIRMED** — After a program, `PenOff()` is enforced and both ready lights return on.
- **ROBOT-CONFIRMED** — A 10 ms polling wait provides responsive selection without a busy loop.

- **KNOWN CONFIGURATION/DEPLOYMENT FAILURE — 2026-08-14:** the post-calibration
  shared global/configuration used with straight walled-truss revisions R1–R3
  produced joint-limit and inverse-kinematics alarms before a reliable print
  path began. During diagnosis, Tool/User frames, ready coordinates, and Z
  values from incompatible configurations were mixed. This is not evidence of
  a truss-path failure; that geometry remains untested.
- **OPERATOR-CONFIRMED FRAME RULE:** centered bed geometry uses Tool 1/User 1.
  The compatible ready pose is `(0,0,100,180)` in that configuration.
- **CURRENT ONLINE Z PROVENANCE — ROBOT-CONFIRMED 2026-08-14:** the rebuilt
  Online project successfully deposited at `BED_ZERO_Z=-90.44` with a
  `0.70 mm` first-layer centerline offset. The earlier post-firmware
  `BED_Z=-7.22` value belongs to an incompatible project/configuration and must
  not be substituted into the clean Online baseline.

- **ROBOT-CONFIRMED CONTROLLER FILE-CACHE FAILURE — 2026-08-06** — DobotStudio
  Pro can display newly pasted source and report a successful upload while the
  controller continues executing an older version of that program file. This
  was confirmed when the non-planar ironing source visibly contained the new
  path but the robot executed the prior non-ironing ending. Saving the source
  under a new controller filename forced a refresh. The first attempt then
  reported `cannot load program`; returning to the editor, saving the new file
  again, and retrying successfully loaded and ran it.
- **ROBOT-CONFIRMED RECOVERY PROCEDURE — 2026-08-06** — When observed motion
  contradicts the visible source: stop testing the geometry, use **Save As** to
  create a genuinely new controller-side filename, update the selected program
  or slot reference, save again after any `cannot load program` response, then
  reload/reapply and verify an unmistakable revision marker before material
  testing. Power cycling or repeatedly uploading the same filename is not
  sufficient evidence that the controller refreshed its executable copy.

## DobotStudio Pro tab structure

- `global.lua`: shared constants, calibration, point construction, motion helpers, extrusion control, and lights.
- `src0.lua`: Remote I/O button loop or a one-shot diagnostic entry point.
- `src1.lua`, `src2.lua`, and later tabs: individual program functions.
- **ROBOT-CONFIRMED** — Load `global.lua` before program tabs.
- **ROBOT-CONFIRMED** — Program-local helpers should remain `local` so tabs do not overwrite each other.
- **ROBOT-CONFIRMED** — `InitialPose` is project-specific and is not a universal controller safe pose. The stable code uses explicit ready coordinates instead.

## Frames and coordinates

- **ROBOT-CONFIRMED** — `ACTIVE_TOOL = 1` and `ACTIVE_USER = 1` are used by stable print-path point tables.
- **ROBOT-CONFIRMED** — Tool Frame 1 is intended to represent the nozzle/tool-tip TCP.
- **ROBOT-CONFIRMED** — User Frame 1 is the bed/work coordinate system; desired `X0 Y0` is the chosen bed center.
- **ROBOT-CONFIRMED** — Positive Z is above the bed in the intended work frame.
- **ROBOT-CONFIRMED** — Frame edits may not take effect reliably until reconnecting or power cycling. After editing a frame: save, reconnect/power-cycle, run a small axis marker, then attempt a larger print.
- **ROBOT-CONFIRMED** — Ground truth is the physical motion/print, not the live IDE coordinate display.
- **ROBOT-CONFIRMED** — Tool Frame X/R and load-offset experiments changed center/readout but did not solve the observed skew.

### Software XY calibration

The practical working pipeline is:

```text
desired work-coordinate XY
-> CalibratedXY(x, y)
-> P(x, y, z, r)
-> Dobot motion command
```

**ROBOT-CONFIRMED** — Current stable coefficients:

```lua
XY_CALIBRATION_ENABLED = true
CAL_X_SCALE = 1.0000
CAL_Y_SCALE_AT_X0 = 0.8265
CAL_Y_SCALE_PER_X_MM = 0.000478
CAL_X_SHEAR_PER_Y = 0.0000
CAL_Y_SHEAR_PER_X = 0.0000
```

**ROBOT-CONFIRMED** — These values produced a centered 100 mm grid that was basically square within hand-measurement error.

**ROBOT-CONFIRMED** — Before correction, X scale was close to correct while Y was stretched and varied with X. One measured set of Y lengths at increasing X was 124.6, 120.7, 119.0, and 117.6 mm; corresponding X lengths were 100.39, 98.42, 99.58, and 100.26 mm, with roughly ±1 mm uncertainty.

Do not hide a bad frame setup with calibration coefficients. First confirm work origin, axis directions, and small dry motions.

### Post-firmware raw recalibration — 2026-08-12

- **OPERATOR-SUPPLIED HARDWARE CHANGE** — A firmware/servo upgrade path has
  been identified. The upgrade may invalidate earlier geometric correction
  factors and may alter continuous-path behavior or motion smoothness.
- **EXPERIMENTAL BASELINE** — Re-run the centered 100 × 100 mm grid using
  `firmware/dobotstudio/working_raw_100mm_post_firmware_calibration/src1.lua`.
  That program constructs raw point tables and deliberately bypasses `P()`,
  `CalibratedXY()`, and every `CAL_*` coefficient.
- Do not reuse or tune the prior `CAL_Y_SCALE_AT_X0` or
  `CAL_Y_SCALE_PER_X_MM` values until the new raw square, diagonals, third
  spans, and center offset are physically measured.
- **OPERATOR-MEASURED RAW RESULT — 2026-08-12** — Y-directed spans, ordered
  from the lowest-X vertical line to the highest-X vertical line, measured
  `126.30`, `122.62`, `120.38`, and `117.70 mm`. The strong monotonic decrease
  with X remains after the firmware upgrade.
- **OPERATOR OBSERVATION — 2026-08-12** — The lowest-Y horizontal line was
  visibly bowed outward in X. The highest-Y horizontal line was substantially
  straighter but retained slight outward bow. This is evidence of non-affine
  position-dependent geometry; a scale/shear correction alone cannot remove
  all path curvature.
- **OPERATOR-MEASURED RAW RESULT — 2026-08-12** — X-directed spans from
  lowest Y upward are confirmed as `101.47`, `99.12`, `99.10`, and
  `100.03 mm`; the earlier `11.47` entry was a data-entry error.
- **CALCULATED X RESULT — 2026-08-12** — The individual width corrections are
  `0.985513`, `1.008878`, `1.009082`, and `0.999700`. They are non-monotonic
  across Y. A linear fit, `scale_X(Y) = 1.00079323 + 0.000128290*Y`, leaves
  predicted width residuals near `-0.90`, `+1.01`, `+0.61`, and `-0.75 mm`
  and is therefore not an adequate correction model.
- **CALCULATED / NOT APPROVED FOR CONTROL — 2026-08-12** — A quadratic fit to
  the four width measurements is
  `scale_X(Y) = 1.01102753 + 0.000128290*Y - 0.00000736840*Y^2` and reduces
  fitted width residuals to about `-0.07`, `+0.20`, `-0.20`, and `+0.07 mm`.
  Four span measurements are insufficient to establish that this polynomial
  is repeatable, and a Y-dependent width scale would not by itself straighten
  the observed within-line X bow. Do not deploy it yet.
- **CALCULATED PROVISIONAL FIT — 2026-08-12** — Fitting `100/measured_Y`
  against nominal X = `-50`, `-16.67`, `+16.67`, `+50 mm` gives a provisional
  linear Y correction of intercept `0.82190343` at X0 and slope
  `0.0005661802 per X mm`. Predicted physical residuals are approximately
  `-0.29`, `+0.46`, `-0.09`, and `-0.08 mm`. Do not promote this fit until
  diagonals, center, repeatability, and the ambiguous X measurement are checked.

## Stable motion helpers and controller calls

The production baseline is `firmware/dobotstudio/milestone_struderbot_cube_diamond_stable/`.

- `P(x, y, z, r)`: applies XY calibration and returns a point table containing `coordinate`, `tool`, and `user`.
- `MovJ(P(...), {SpeedJ=..., AccJ=...})`: used for the initial approach and explicit ready moves when extrusion is off.
- `MovL(P(...), {SpeedL=..., AccL=...})`: used for print moves, lifted travel, and in-plane repositioning.
- `J(...)`: despite its historical name, stable code implements this as fast linear `MovL`, because extrusion may remain on.
- `LSpeed(...)`, `LThin(...)`, `LThick(...)`: calibrated linear print helpers.
- `DO(channel, value)`, `DI(channel)`, and `Wait(milliseconds)`: stable digital I/O and timing calls.

**ROBOT-CONFIRMED** — In-plane repositioning must remain linear when the extruder may still be on. Joint motion can sweep through the print.

**ROBOT-CONFIRMED** — The current stable motion parameter tables do not use `SYNC=1`. An older `firmware/dobotstudio/README.md` statement that J/L used `SYNC=1` was stale and has been corrected.

## Extrusion behavior and tuning

- **ROBOT-CONFIRMED CLEAN DEPOSITION STATE — 2026-08-14:** for the new Online
  workflow, use absolute `BED_ZERO_Z=-90.44`, calibrated
  `LAYER_HEIGHT_MM=0.70`, and robot motion speed `PRINT_SPEED_MM_S=3.0`.
  Under the established temperature/feed condition this produced an
  approximately `0.83 mm` wall. Adjacent solid lines use the separately
  calibrated `0.78 mm` centerline spacing.
- **OPERATOR PROCESS REQUIREMENT / EXPERIMENTAL GEOMETRY — 2026-08-15:** every
  new material-depositing program in the clean Online configuration must begin
  with a compact sacrificial purge path of at least 100 mm because filament
  left hot in the nozzle becomes discolored during idle periods. Begin with the
  current proposed geometry of a three-lane serpentine, 4 mm lane pitch,
  tangent 2 mm-radius turns, and 5 mm clear edge gap between the serpentine body
  and the complete part. Enable extrusion once at the purge start using the
  normal startup delay, then cross that gap once through a deliberate connector
  and continue directly into the model with no dwell, rapid, retract, or
  `PenOff()`/`PenOn()` cycle. These geometry values require physical validation;
  dry-motion and extrusion-off diagnostics are exempt.
- **OPERATOR-SPECIFIED DOG-EAR BASELINE / EXPERIMENTAL — 2026-08-15:** optional
  corner adhesion uses 15 mm-diameter circular tabs centered exactly on all
  eligible finished exterior corners. The finished part owns the disc/part
  intersection; ear-specific fill is clipped to the exterior. Add one
  breakaway skirt with an initial 0.20 mm clear gap and connect it into the
  ears with the standard 50% bead tie-in. Because the fixed-feed Struder must
  retain one extrusion window, use the continuous equivalent of “ears first”:
  alternate ear then adjacent skirt span until the complete adhesion scaffold
  is finished, then enter the first part perimeter at a shared corner. The ear
  diameter is operator-selected; the gap, fill path, and connection order still
  require physical validation.
- **WORKFLOW DEPRECATION:** the old `THIN_*`/`THICK_*` selector variables and
  generic `PRINT_HEIGHT_ABOVE_BED` alias belong to historical demo projects.
  Do not carry them into new Online-mode programs. Compute the intended layer
  centerline explicitly as `BED_ZERO_Z + layer_height`.

- **ROBOT-CONFIRMED** — `PenOn()` drives DO8 high once and waits 4000 ms for flow startup.
- **ROBOT-CONFIRMED** — `PenOff()` drives DO8 low and waits 500 ms.
- **ROBOT-CONFIRMED** — The older `FinishExtrusionPath()` waited 50 ms at the
  final point before stopping extrusion.
- **OPERATOR-SUPPLIED CURRENT ROBOT STATE** — As of 2026-07-30 the running
  globals use `BED_Z = -90.44`, `POST_JUMP_DWELL_MS = 20`, and
  `THIN_PRINT_SPEED = 2.0`.
- **EXPERIMENTAL END BEHAVIOR** — The current working program sets
  `FINAL_POINT_DWELL_MS = 0` and makes `FinishExtrusionPath()` switch DO8 off
  immediately without invoking the normal 500 ms `PenOff()` dwell. The lift is
  commanded immediately after the endpoint. Early in-stroke shutoff remains a
  separate tuning task.
- **EXPERIMENTAL END RETRACTION** — The short expanding-rim test uses
  `MovLIO` distance mode on its final side to switch DO8 off before the motion
  endpoint. `END_RETRACT_LEAD_MM` is global and starts at `3.0 mm`. The motion
  continues to the endpoint and immediately lifts without either finish dwell.
- **OPERATOR TUNING UPDATE** — `END_RETRACT_LEAD_MM` was increased from
  `3.0 mm` to `6.0 mm` on the robot.
- **ROBOT-CONFIRMED** — Struder feed is treated as fixed; print tuning is primarily robot speed, nozzle height, and path strategy.
- **ROBOT-CONFIRMED** — Stable thin settings: speed 2.5, Z offset 0.375 mm.
- **ROBOT-CONFIRMED** — Stable thick settings: speed 1.0, Z offset 0.90 mm.
- **KNOWN FAILURE** — Thick speeds of 0.8 and lower reached the start, enabled extrusion, and then stalled before continuing the thick move.
- **HISTORICAL ROBOT-CONFIRMED** — A roughly 20 mm external lead-in tag
  established flow before earlier features. This remains historical evidence,
  but is superseded for new Online material programs by the minimum-100-mm
  compact purge requirement above.
- **ROBOT-CONFIRMED / KNOWN FAILURE** — The first twisted-hex vase program
  placed its nominal lead-in inside the annular base because it blindly
  subtracted 20 mm from X. Lead-in direction must be derived from part geometry,
  not from a fixed axis sign.
- **ROBOT-CONFIRMED PLANNING REQUIREMENT** — A lead-in must begin outside the
  complete part envelope and meet the full multi-layer print only at its
  intended entry endpoint. For centered convex parts, extend outward from the
  boundary along its outward normal or radial direction and validate against
  all later rotations and offsets.
- **ROBOT-CONFIRMED** — Finish by stopping extrusion, lifting in place, then moving toward center/high Z to avoid dragging across the print.
- **ROBOT-CONFIRMED** — Struder does not retract well mid-pattern. Prefer continuous paths and rare tool-state changes.
- **KNOWN FAILURE** — The first 20 mm continuous square-tower test collapsed
  inward. The operator identified excessive heat as the cause; the exact
  material temperature was not recorded.
- **ROBOT-CONFIRMED** — The first square-tower test visibly paused at each
  corner when consecutive `MovL` extrusion moves omitted a CP value.
- **KNOWN FAILURE** — `CP = 50` made the 50 mm square-tower motion fluid but
  rounded the corners so severely that the path printed almost like a cylinder.
- **ROBOT-CONFIRMED / UNCALIBRATED REFERENCE** — The Struder's standard
  displayed extrusion-speed setting reads 0.4 mm/second. The physical feed has
  not been calibrated, so this is a reference setting rather than a trusted
  flow rate.
- **ROBOT-CONFIRMED EXPERIMENTAL BASELINE** — At temperature 211, robot
  movement speed 3, and 0.70 mm spiral layer height, the 50 mm square tower
  produced consistent walls that did not become progressively sloppy or
  over-extruded toward the top. Calipers measured approximately 0.83 mm wall
  width.
- **ROBOT-CONFIRMED** — CP values around 1.0-1.5 retained the square geometry
  while improving fluidity. Some corner over-extrusion remained. Larger CP
  values increasingly rounded the corners and became unacceptable.
- **ROBOT-CONFIRMED PLANNING REQUIREMENT** — With the fixed-feed Struder,
  motion continuity is part of effective flow control. Any jerk, slowdown, or
  pause increases local deposition and effective layer thickness even when
  commanded robot speed and extrusion setting are unchanged.
- **ROBOT-CONFIRMED / KNOWN FAILURE** — The first patterned-wall trochoid used
  thousands of short `MovL` chords at speed 3 and `CP=1`. It ran staccato and
  massively overfilled; the operator determined that an emergency stop was
  necessary. The physical path looked like short arcs rather than the intended
  crossing loops with hollow cells.
- **ROBOT-CONFIRMED PLANNING REQUIREMENT** — Do not infer physical smoothness
  from a continuous equation or rendered preview. New high-frequency patterns
  require an extrusion-off circuit test and must use a small number of native
  arcs or robot-proven blended primitives before material testing.
- **ROBOT-CONFIRMED / PARTIAL SUCCESS** — The corrected cellular loop-chain
  made from two native `Arc3` moves per loop, `CP=1`, and no `SYNC` moved
  nicely. This validates the native-arc direction while leaving dimensions and
  structural behavior experimental.
- **ROBOT-CONFIRMED / KNOWN FAILURE** — Starting the recirculating loop pattern
  directly on the bed allowed a poorly adhered section to be pulled loose by
  the returning motion. Patterned walls require conventional spiral or
  parallel-path foundation layers across their complete envelope.
- **ROBOT-CONFIRMED / KNOWN FAILURE** — Closing each patterned ring at constant
  Z and joining the next 50%-shifted ring with a short rising transition made
  a visible Z seam. Vase-mode patterned walls must increase Z and phase
  continuously through the loops rather than stepping at a layer boundary.
- **ROBOT-CONFIRMED / CORRECTED DIAGNOSIS** — The apparent high first layer on
  the first 60 mm seamless test was not evidence that `ThickPrintZ()` was
  wrong. The preceding overfilled trochoid had physically pushed the toolhead
  upward. After the toolhead was restored, the temporary 0.375 mm and 0.20 mm
  offset reductions made the first layer excessively compressed. Restore the
  prior Z procedure and verify mechanical tool position before changing Z.
- **ROBOT-CONFIRMED SAFETY SIGNAL** — The preceding loop-chain test accumulated
  enough excess material to push the toolhead upward. Treat any unexplained Z
  shift after a patterned-wall run as possible evidence of overfill or nozzle
  interference; inspect the tool mechanically before the next print.
- **ROBOT-CONFIRMED / SUCCESSFUL ENDPOINT** — The open-top 60 mm
  guide-diameter touchback ring worked nicely. It uses a 10 mm envelope,
  approximately 8 mm repeat, one solid annular spiral foundation, continuous
  helical Z, native `Arc3` loops with `CP=1` and no `SYNC`, and no top cap.
- **ROBOT-CONFIRMED GEOMETRY** — In the successful touchback revision, forward
  and return nodes straddle the wall centerline by `+0.39 mm` and `-0.39 mm`.
  Their 0.78 mm centerline separation gives approximately 0.05 mm deposited
  overlap for the measured 0.83 mm bead and deliberately ties neighboring
  cellular loops together.

## Curves

### Triangular patterned wall

- **ROBOT-CONFIRMED / PARTIAL SUCCESS** — The first two-layer, unbounded
  triangular wall printed and its intended touchback endpoints connected.
- **ROBOT-CONFIRMED / DIAGNOSIS** — Sharp forward-to-touchback direction changes
  at the triangular points created visible blobs. A later tangent or CP-compensated
  variant should address this, but the next controlled test preserves the
  geometry and extends it to 60 mm to observe cumulative wall behavior first.
- **ROBOT-CONFIRMED / DIAGNOSIS** — The 60 mm wall printed successfully with
  connected apexes, but the stacked-ring half-repeat connector created a
  migrating missing-touchback feature. This is programmed transition geometry,
  not a controller-skipped command. Replace it with continuous Z rise through
  the entire triangular path.
- **ROBOT-CONFIRMED / DIAGNOSIS** — `CP=1` did not prevent slowdown at the sharp
  triangular direction changes. Higher blending may improve speed but risks
  shortening the intended contact. Develop an explicit tangent or teardrop
  turnaround before relying on CP-only compensation.
- **OBSERVED / UNRESOLVED** — Double-filled regions were slightly under-filled.
  Defer overlap correction until transition and turnaround behavior are
  isolated.
- **PROGRAMMING INVARIANT** — Struder model paths must not use intermediate
  extrusion stop/start cycles to move between patterned cores and bounding
  perimeters. Enable extrusion once at the external lead-in, connect all
  contours with deliberate printed transitions, and shut off only during the
  calibrated final lead-out.
- **ROBOT-CONFIRMED / KNOWN FAILURE — 2026-08-03** — The first bounded
  triangular-wall program incorrectly stopped and restarted the Struder between
  contours. The operator ran it and the behavior jammed the system. Never emit
  intermediate extrusion cycling unless the operator explicitly requests that
  experiment. `tools/validate_struder_lua.py` now blocks programs that violate
  the single-extrusion-window invariant.
- **ROBOT-CONFIRMED / KNOWN FAILURE — 2026-08-03** — Ordinary 0.566 mm tangent
  fillets in the bounded triangular core trimmed the near-reversing legs so far
  back that paired inner couching vertices were measured 6–7 mm apart. Rounded
  touchbacks must compensate the calculated fillet-apex setback so the arc
  itself passes through the shared nominal vertex; a fixed 0.20 mm bias is not
  geometrically valid.
- **ROBOT-CONFIRMED / KNOWN FAILURE — 2026-08-03** — The compensated bounded
  triangular test did not keep its triangular-core boundary arcs concentric
  with the inner and outer skins. Although the five nominal radii were derived
  correctly, the fillet compensation shifted the core-boundary endpoints off
  their circles, producing irregular arc and tie-in behavior.
- **ROBOT-CONFIRMED PLANNING REQUIREMENT — 2026-08-03** — Any change to guide
  radius, wall envelope, line spacing, or perimeter allocation invalidates all
  downstream patterned-wall geometry. Recalculate the remaining core radii,
  core width, integer triangle count, apex angles, turnback geometry, couching
  points, transitions, preview, and Lua from scratch.
- **EXPERIMENTAL CORRECTION — 2026-08-03** — The replacement bounded program
  uses concentric centerline radii `26.00`, `26.78`, `32.44`, `33.22`, and
  `34.00 mm`; regenerates 13 repeats from the final 5.66 mm core; and commands
  rounded `Arc3` transitions through nominal couching vertices without shifting
  the core-boundary endpoints. Adjacent skin/core centerlines remain 0.78 mm
  apart, giving about 0.05 mm physical overlap for the measured 0.83 mm bead.
  This correction still requires a physical retest.

### Non-planar cladding

- **EXPERIMENTAL CONCEPT — 2026-08-03** — Treat this family as
  `non-planar cladding`, not conventional slicing. Codex should start from a
  support scaffold, grid, frame, or mass-building path that it generated and
  therefore understands, then add a coordinated XYZ surface skin over that
  known structure from manufacturing intent.
- **EXPERIMENTAL PLANNING REQUIREMENT — 2026-08-03** — Do not default to STL or
  G-code coordinate transformations as the first method. For early coupons,
  define the surface explicitly as a heightfield such as `z_surface(x, y)`,
  generate the cladding bead layout directly, and validate the support-contact
  relationship against the scaffold below.
- **EXPERIMENTAL TEST PLAN — 2026-08-03** — Begin with 40 mm square coupons:
  a flat loose-grid scaffold baseline, then a shallow single-slope top skin,
  then dome or saddle skins. Record support contact, sag, bead thinning from
  true 3D path length, nozzle drag, turn blobs, and motion smoothness.

- **ROBOT-CONFIRMED / SUCCESSFUL — 2026-08-06** — The 40 × 40 mm symmetric
  gable coupon printed successfully. Each roof face rises at 20 degrees from
  the Y eaves to an X-aligned ridge at Y0. The support uses a solid first
  layer followed by alternating 25% X/Y scaffold, and the finishing paths
  traverse uphill and downhill in coordinated Y/Z motion. Preserve the
  non-ironed program at
  `firmware/dobotstudio/milestone_nonplanar_gable_cladding_40mm_20deg/`.
- **EXPERIMENTAL IRONING PLAN — 2026-08-06** — Develop dry ironing as a
  separate coupon. Start at zero Z offset from the final surface with extrusion
  off, 0.25 mm X stepover, and two Y/Z passes staggered by 0.125 mm. Keep these
  parameters exposed because dry ironing transfers heat without the low flow
  used by conventional slicers.

- **ROBOT-CONFIRMED / KNOWN COLLISION — 2026-08-06** — The first 30-degree
  cross-ironing coupon commanded the second ironing pass directly from one
  gable eave to the other. `MovL` interpolated at low eave Z and drove through
  the built gable. A non-planar heightfield path must include every slope
  breakpoint; endpoints on the surface are insufficient when the straight
  chord between them lies inside the part. Every gable-crossing ironing row
  must explicitly command `eave → ridge → opposite eave`. Do not reuse the
  original 30-degree cross-ironing source.

### Arc3

- **ROBOT-CONFIRMED** — Prefer `Arc3` for production curves.
- **ROBOT-CONFIRMED** — Move to the arc start first. `Arc3(P_mid, P_end, params)` uses current position as the start.
- **ROBOT-CONFIRMED** — `P_mid` must be a real point on the intended arc, not a Bezier/control handle.
- **KNOWN FAILURE** — Using square-corner midpoint coordinates for quarter circles produced a four-leaf-clover shape.
- **ROBOT-CONFIRMED** — Removing `SYNC=1` from arc parameters reduced visible pauses and blobs.
- **ROBOT-CONFIRMED** — The first region-first flange test showed noticeably
  jerky motion around the bolt-hole `Arc3` sequences when no CP value was
  supplied.
- **DOC-CONFIRMED / EXPERIMENTAL** — Dobot documents `CP` as an optional
  `Arc3` continuous-path parameter in the range 0-100. Start testing arc
  blending at `CP=1.0`; do not assume the linear-path CP result transfers
  unchanged to small arcs.
- **ROBOT-CONFIRMED / EXPERIMENTAL** — Adding `CP=1.0` made the bolt-hole
  arcs smoother within each concentric ring, but the robot still paused while
  repositioning between separate rings. The next diagnostic replaces the
  three rings with one continuous two-revolution outward spiral.
- **ROBOT-CONFIRMED** — The continuous bolt-hole spirals otherwise printed
  well, but a long pause persisted at the `+X/+Y` hole. Because removing the
  concentric-ring repositioning did not remove this pause, the remaining
  region-boundary reposition before the fill transition is the leading cause.
- **EXPERIMENTAL FIX** — Begin each region-boundary `Arc3` directly from the
  preceding clipped rung endpoint, which already lies on the avoidance circle.
  Do not issue a redundant move to the circle's leftmost point first.
- **ROBOT-CONFIRMED DIAGNOSIS** — The persistent pause was localized after the
  short strokes beside the positive/positive hole, immediately before the
  rapid move across to start the uninterrupted outer fill band. On the rotated
  second layer, the equivalent pause occurred before the rapid negative-Y
  return from the most-positive-X edge. This identifies the region-to-band
  rapid reposition, rather than the bolt-hole spiral or avoidance arc, as the
  pause junction.
- **EXPERIMENTAL FIX** — After completing the right-side short-stroke region,
  continue at print speed along the prioritized outer wall into the first
  full-width band stroke. Start the band from the current right side instead
  of issuing an unblended rapid move to its left side.
- **ROBOT-CONFIRMED** — The twisted-hex vase paused after completing the second
  circular through-hole contour before jogging to the base fill on at least
  layer three; earlier layers may have shown the same pause.
- **EXPERIMENTAL FIX** — For extrusion-on in-plane repositioning after `Arc3`,
  test a CP-smoothed speed-20 `MovL` rather than changing immediately from
  print speed 3 to an unblended full jump-speed move.
- **ROBOT-CONFIRMED / KNOWN FAILURE** — The first staged lip on the twisted-hex
  vase did not form a coherent rim; its lines separated near the top. The
  program ended the continuous wall partway along a hex side, then used a
  straight extrusion-on move to the fixed first corner of the next closed
  contour. That move crosses the open mouth as an unsupported rising chord.
  The slower speed-2.5 foundation also increased material and heat per unit
  length with the fixed Struder feed, so it is not a validated way to create a
  wider supporting bead.
- **EXPERIMENTAL PLANNING REQUIREMENT** — A thin-wall-to-lip transition must
  preserve path phase: begin each added contour from the current wall location
  or finish the spiral at a deliberately aligned seam. Do not jump to a fixed
  contour start while extrusion remains on. Grow added thickness inward over
  multiple supported layers, keep the established exterior wall path, and
  avoid relying on a single over-extruded foundation bead.
- **ROBOT-CONFIRMED** — The short twisted-hex test's 1 mm clipped-corner
  support layer successfully transitioned into the connected double-wall rim
  without unusual stringing. Preserve the rule that each new inner-perimeter
  vertex lands at the midpoint of the clipped chord directly below it.
- **ROBOT-CONFIRMED / DIAGNOSIS** — Extra manual cooling improved the expanded
  rim, but it still appeared somewhat over-extruded. A 1 mm setback along each
  adjacent hex edge moves the chord midpoint only 0.433 mm inward in the
  edge-normal direction. With the measured 0.83 mm bead, adjacent rim paths
  therefore overlap by about 0.397 mm (48% of bead width), much more than the
  calibrated 0.780 mm solid spacing or 0.679779 mm perimeter spacing.
- **EXPERIMENTAL CORRECTION** — A clipped-corner setback of approximately
  1.57 mm produces 0.679779 mm normal spacing between successive regular hex
  paths while preserving midpoint anchoring. Test this geometry before
  changing extrusion flow or speed.
- Quarter-circle midpoint factor: `k = 0.70710678`.

For a circle centered at `(cx, cy)` with radius `r`, right-to-top midpoint and endpoint are:

```lua
Arc3(
    P(cx + r * k, cy + r * k, z, r0),
    P(cx, cy + r, z, r0),
    params
)
```

Repeat with signs rotated for the other quadrants.

### Circle3

- **EXPERIMENTAL** — Do not use `Circle3` as the production default.
- **KNOWN FAILURE** — Duplicate start/end data produced `Duplicated data in JUMP or ARC or Circles instruction`.
- **KNOWN FAILURE** — A start/90-degree/180-degree test produced overlapping ellipses stretched along Y.
- **EXPERIMENTAL** — Controller-generated circle interpolation may bypass enough point-by-point correction that it does not cooperate with the current XY calibration layer.

### Spiral and helix patterns

- **ROBOT-CONFIRMED** — A shrinking planar spiral worked using 28 native `Arc3` chunks of 72 degrees, from radius 30 mm to 2 mm over 5.6 turns with 5 mm radial reduction per turn.
- **EXPERIMENTAL** — `milestone_vase_tube_20mm/` contains an untested 20 mm-diameter, 20 mm-high continuous helix using 36 linear segments per revolution and 1 mm pitch.

## Solid filling

- **EXPERIMENTAL** — `firmware/dobotstudio/filling/` is separate from the stable demo.
- Use a perimeter followed by continuous rectilinear/raster infill.
- Start with line spacing near nozzle/extrusion width; the first 1 mm nozzle test uses 1.0 mm spacing.
- Keep the Struder on through continuous nearby paths; avoid relying on retraction.
- **ROBOT-CONFIRMED / KNOWN FAILURE** — The first 20 x 20 mm solid-block
  stepover test, using 0.70 mm layers and 0.658 mm even-fit raster spacing,
  was definitely over-extruded. The operator estimated the excess build-up
  as roughly the thickness of one or two layers.
- For the solid-fill calibration series, hold temperature, movement speed,
  layer height, perimeter count, and footprint constant while increasing
  stepover. Decreasing stepover increases deposited material per unit area
  and therefore moves in the wrong direction for this observed failure.
- **ROBOT-CONFIRMED** — A 0.780 mm line spacing produced the right solid-fill
  density at the established temperature 211, movement speed 3, approximately
  0.70 mm layer height, and approximately 0.83 mm measured line width.
- **ROBOT-CONFIRMED** — At 0.780 mm spacing, the fill lines only barely touched
  the inner perimeter. Additional infill-to-wall overlap is required.
- **DOC-CONFIRMED / EXPERIMENTAL COMPENSATION** — OrcaSlicer defines
  infill-wall overlap as a percentage of infill line width and recommends
  approximately 10-15% for sparse infill and 25-30% for top/bottom solid
  infill. For the measured 0.83 mm line, the proposed conservative starting
  values are 15% = 0.1245 mm for sparse infill and 25% = 0.2075 mm for solid
  top/bottom infill. These values require robot testing.
- **ROBOT-CONFIRMED / KNOWN FAILURE** — The first flange planner reacted to
  each scanline/bolt-hole intersection independently. It repeatedly traced
  normal-speed arcs around the same hole while preserving an unbroken raster.
- **ROBOT-CONFIRMED PLANNING REQUIREMENT** — Decompose layers containing holes
  or openings into connected regions before generating scanlines. Finish one
  side completely, make one intentional transition around the feature, then
  finish the other side. Repeated per-row feature detours are not the default.

## Preserved milestones

- **STABLE REFERENCE / MIXED EVIDENCE** —
  `milestone_hex_pencil_holder_60af_100mm/`: self-contained 60 mm across-flats,
  100 mm twisted pencil-holder program with three side-parallel solid base
  layers, a 4-3-2 inner chamfer, continuous spiral wall, and standardized 3 mm
  rounded lip. The code preserves corrections for first-layer Z, physical
  25% infill-wall overlap, fast perimeter-to-raster transition, and hex-side
  raster orientation. The full corrected object still needs a physical retest.

- **ROBOT-CONFIRMED / production baseline** — `milestone_struderbot_cube_diamond_stable/`: best cube print and a working diamond/octahedron print; 4 mm gaps, 20 mm lead-ins, stable thin/thick settings, and lift-before-center end behavior.
- **ROBOT-CONFIRMED / demo-ready** — `milestone_cube_net_40mm_demo/`: six 40 mm square faces, subdivision lines, connectors, and calibrated Remote I/O execution; described as having worked beautifully.
- **ROBOT-CONFIRMED** — `milestone_square_100mm_calibrated/`: first basically square calibrated 100 mm grid.
- **ROBOT-CONFIRMED diagnostic fallback** — `last_good_100mm_print/`: printed successfully but preserves pre-correction Y distortion.
- **EXPERIMENTAL** — `filling/`: solid planar surface tests.
- **EXPERIMENTAL** — `milestone_vase_tube_20mm/`: untested 3D helix/tube.
- **EXPERIMENTAL / known failures** — `arc_circle_test/`: native `Circle3` learning project.

- **MIXED EVIDENCE / ADHESION-BLOCKED** —
  `milestone_layer_filling_interim_2026_07_29/`: preserves the
  robot-confirmed `0.780 mm` fill baseline and region-first planner plus the
  experimental final pause fix, three-layer flange, and square spiral pipe.

## Known open issues

- **ROBOT-CONFIRMED TEST CONSTRAINT** — Large solid parts currently develop
  bed-adhesion failures before further layer-path refinements can be evaluated
  reliably. Pause large-solid calibration at the 2026-07-29 interim waypoint;
  do not misclassify adhesion-driven failures as spacing or region-order
  failures.

- **NEEDS RETEST** — Re-establish `BED_Z` after replacing the plexiglass bed with the metal plate.
- **EXPERIMENTAL** — Refine diamond travel routing so diagonal jumps remain inside the finished model envelope.
- **NEEDS RETEST** — Re-evaluate online/script-runner reliability only after controller/software behavior is better understood; do not use it as the default now.
- **EXPERIMENTAL** — Validate filling and vase-mode programs on hardware before promoting them.

## Source documents

Detailed session history remains in calibration notes and milestone READMEs. This file is the canonical conclusion layer; those files provide provenance and measurements.

## Bounded triangular-wall physical result — 2026-08-04

- **ROBOT-CONFIRMED / KNOWN FAILURE** — The controller-exact bounded test
  alarmed near Y0 during Pattern A before completing its final triangle. A
  complete calibrated-`Arc3` audit found three near-degenerate seam arcs, with
  calibrated twice-triangle areas of approximately `0.0147`, `0.0163`, and
  `0.0052`. The seam used the opposite half-step direction instead of replaying
  the ordinary repeat geometry.
- **EXPERIMENTAL CORRECTION** — Pattern A now reuses the normal forward
  boundary/turnback/diagonal sequence toward the preceding inner half-step.
  The canonical builder and Lua exporter reject `Arc3` triples with inadequate
  calibrated area or chord length, extreme reconstructed radius, unsafe sweep,
  or path discontinuity. Foundation, Pattern A, Pattern B, final split
  perimeter, and both rising transitions pass the expanded audit.
- **ROBOT-CONFIRMED / GEOMETRY REFINEMENT REQUIRED** — The same physical test
  showed an approximately 2 mm gap between rounded triangular apexes. Preserve
  the speed-maintaining cap arcs. Extend the virtual sharp triangle endpoints
  past one another by the calculated tangent setback plus commanded couching
  overlap, and recalculate apex angle and repeat count before the next test.
- **OPERATOR DESIGN DECISION — 2026-08-04** — Stop developing bounded
  loop-back triangles. Preserve `triangular_touchback` only as the
  perimeterless closed-cell kernel that worked before perimeters were added.
  When skins are requested, use the separate experimental `walled_truss`
  kernel: requested inner/outer walls plus a single alternating zig-zag core,
  2 mm tangent turnarounds, half-repeat layer phase progression, normal/fast
  first patterned layer, and half-speed later patterned layers.

## Walled-truss endpoint — 2026-08-04

- **ROBOT-CONFIRMED / KNOWN FAILURE** — The initial `0.05 mm` tangent-to-skin
  overlap was insufficient; the zig-zag turns did not attach to the perimeter
  walls reliably.
- **ROBOT-CONFIRMED / SUCCESSFUL ENDPOINT** — The revised 60 mm guide-diameter,
  8 mm inclusive-envelope ring printed successfully with one inner and one
  outer perimeter, 8 repeats, 2 mm tangent turns, `0.415 mm` physical overlap
  (50% of the measured 0.83 mm bead), and an `89.18 degree` executed outer
  apex.
- **ROBOT-CONFIRMED PATH BEHAVIOR** — Advancing the seam forward by half a
  repeat each layer removed the short perimeter backtrack. Two same-side wall
  circuits may still occur consecutively across a layer boundary because one
  ends the previous layer and the next begins the following layer.
- **EXPERIMENTAL / SOFTWARE-VALIDATED** — The 80 mm OD, 56 mm ID, 12 mm wall,
  80 mm tall closed-bottom cup is preserved for a future test. Its nine-layer
  base uses five solid raster layers, three 25% raster layers with three outer
  perimeters, and one concentric solid floor; 106 patterned layers complete
  the height. It is not robot-confirmed.
- **ROBOT-CONFIRMED / KNOWN FAILURE — 2026-08-14:** straight walled-truss
  `80 x 10 x 20 mm` R1 reversed traversal direction but did not invert the
  upper/lower node phase. Adjacent layers therefore retraced the same physical
  diagonals instead of crossing. A complementary layer requires both traversal
  reversal and vertical phase inversion. R2 also classifies the short
  end-boundary layer connectors as quick repositioning moves; extrusion remains
  continuously enabled through the connected model.

## First non-planar cladding coupon — 2026-08-04

- **ROBOT-CONFIRMED / PARTIAL SUCCESS** — The 20 mm coupon executed and its
  roof paths established simultaneous planar-axis/Z printing in both ascending
  and descending directions.
- **ROBOT-CONFIRMED / DIAGNOSIS** — The controller paused at raster endpoints,
  scaffold corners, and layer-shift junctions. Fixed Struder feed turned these
  pauses into blobs. Do not scale the exact-stop sequencing unchanged; develop
  continuous turnarounds and boundary-following layer transitions.
- **ROBOT-CONFIRMED TEST CONSTRAINT** — The paper substrate lifted away from
  the bed. Treat substrate restraint separately from non-planar geometry.
- **OPERATOR DIRECTION** — Rotate the next coupon so its 10 degree rise is on
  Y for filming, and increase its footprint to 40 mm.
- **ROBOT-CONFIRMED / SUCCESSFUL ANGLE** — The 40 mm coupon with its 10 degree
  rise along Y printed successfully. Long pauses remained at the beginning of
  some layers; audit showed repeated long jump-speed repositioning followed by
  print-speed extrusion.
- **EXPERIMENTAL PAUSE CORRECTION** — Replace those layer-start jumps with
  speed-3 structural connectors. Replace same-XY vertical layer changes with a
  small rising square loop directed into the footprint. The next coupon raises
  the roof angle to 20 degrees while holding the other cladding strategy fixed.
- **ROBOT-CONFIRMED / SUCCESSFUL 20 DEGREE SURFACE** — The 40 mm, 20 degree
  Y-slope coupon printed a notably good top cladding layer. Simultaneous Y/Z
  travel and the increased slope are viable at this coupon scale.
- **ROBOT-CONFIRMED / KNOWN FAILURE** — Long, visually damaging pauses still
  occurred at some layer shifts. Speed-3 structural connectors and rising
  square loops did not eliminate controller dwell. Preserve the successful
  surface geometry, but do not promote this transition method as a pause fix.
- **NEXT EXPERIMENT** — Rebuild layer changes as tangent-continuous deposited
  transitions. Audit exact-stop vertices, speed boundaries, pure-Z moves, and
  redundant first points before the next robot test.

## Reduced raw metrology lattice result - 2026-08-12

- **KNOWN FAILURE / REACH LIMIT** - The proposed raw 180 x 240 mm lattice
  alarmed on a joint limit immediately after its first startup move toward raw
  X-98/Y-120. Do not reuse that corner approach or infer safe robot reach from
  physical bed dimensions alone.
- **ROBOT-CONFIRMED** - The reduced raw 140 x 180 mm lattice completed. Its
  commanded 140 mm X span measured 141.9 mm at both top and bottom. The
  provisional uniform X command factor is `140/141.9 = 0.986610`.
- **ROBOT-CONFIRMED** - At nominal X=-70, each commanded 90 mm Y half-span
  measured 113.13 mm, implying about 226.26 mm total height and a local Y
  command factor of `90/113.13 = 0.795545`. At nominal X=+70, the comparable
  half-span measured about 105 mm, implying about 210 mm total height and a
  local Y command factor of `90/105 = 0.857143`.
- **ROBOT-CONFIRMED VISUAL RESULT** - Straight blue-tape edges and gaps in the
  operator photograph provide external references. The lattice is strongly
  bowed at low X and progressively less bowed toward high X. A single affine
  transform cannot fully correct this geometry.
- **CALCULATED / NOT APPROVED FOR CONTROL** - Interpolating only the two edge
  half-spans gives `scaleY(X) = 0.826344 + 0.000439985*X`. This describes edge
  span variation only and cannot straighten the visible within-line bow.
- **ROBOT-CONFIRMED NINE-COLUMN DATA** - For nominal X values
  `-70,-52.5,-35,-17.5,0,17.5,35,52.5,70`, the measured upper 90 mm
  half-spans were `114.08,112.17,111.23,109.70,109.38,107.18,107.16,105.88,
  104.57 mm`; lower half-spans were `113.74,111.78,110.29,109.36,107.97,
  106.89,106.19,105.45,105.03 mm`.
- **CALCULATED RESULT** - Total measured heights across those columns are
  `227.82,223.95,221.52,219.06,217.35,214.07,213.35,211.33,209.60 mm`.
  Upper minus lower half-span averages `+0.517 mm` and ranges from `-0.46` to
  `+1.41 mm`; upper/lower asymmetry is present but substantially smaller than
  the X-dependent Y stretch.
- **CALCULATED / CANDIDATE RETEST MODEL** - Fitting `180/totalHeight` gives
  linear scale `scaleY(X) = 0.82792485 + 0.000476289593*X`. Its fitted physical
  height residual has RMSE `0.67 mm` and maximum magnitude `1.29 mm`.
- **CALCULATED / NOT YET PREFERRED** - A quadratic fit gives
  `scaleY(X) = 0.830228614 + 0.000476289593*X - 0.00000112837446*X^2`, reducing
  fitted physical-height RMSE to `0.39 mm` and maximum residual to `0.67 mm`.
  Do not adopt the quadratic solely on this in-sample improvement; first test
  the simpler linear model on a fresh raw/compensated comparison lattice.
- **ROBOT-CONFIRMED COMPENSATED RETEST** - The linearly compensated 140 x 180
  mm lattice printed with upper half-spans `89.94,89.33,89.36,89.54,89.63,
  89.64,89.90,90.01,90.014 mm` and lower half-spans `91.96,91.96,90.88,
  90.23,89.79,89.94,90.05,90.04,90.08 mm`, ordered from X=-70 to X=+70.
  Total heights were `181.90,181.29,180.24,179.77,179.42,179.58,179.95,
  180.05,180.094 mm`. Total-height RMSE from 180 mm was `0.81 mm`; maximum
  error was `+1.90 mm` at X=-70.
- **ROBOT-CONFIRMED DIAGNOSIS** - The Y correction fixed overall height very
  effectively, especially from X=-35 through X=+70, but the low-X sideways
  curvature changed little. This corrects an earlier inference: X-dependent Y
  scaling can correct height and trapezoidal Y stretch, but a vertical path
  still commands constant X. Sideways bow requires an additional X correction
  varying with Y (and likely with X), i.e. a genuine 2D warp.
- **CALCULATED / HOLD FOR LATER** - The upper halves now average `89.707 mm`
  and lower halves `90.548 mm`. Most remaining half-height asymmetry is
  concentrated at low X: lower-half error is `+1.96 mm` at both X=-70 and
  X=-52.5 while the corresponding upper errors are `-0.06` and `-0.67 mm`.
  Do not tune separate positive/negative Y scales until lateral bow samples are
  collected, because changing one mapping component can affect the next fit.
- **ROBOT-CONFIRMED CENTERLINE X DATA** - On the compensated lattice, Y0
  positions measured from the low-X endpoint-chord datum were `2.26,19.00,
  35.48,52.53,69.87,86.66,103.87,121.21,138.37 mm`. The same print measured
  `138.83 mm` across X at the top and `139.84 mm` at the bottom.
- **CALCULATED BOW PROFILE** - Using the mean endpoint width `139.335 mm` as
  the chord reference, the Y0 lateral offsets from low X to high X are
  `+2.260,+1.583,+0.646,+0.279,+0.203,-0.424,-0.631,-0.708,-0.965 mm`.
  These offsets cross direction across X and explain why an X-dependent Y
  scale could not straighten the vertical paths.
- **EXPERIMENTAL NEXT MODEL** - Apply the measured X-amplitude profile at Y0
  with zero correction at Y=+/-90 using an initial parabolic envelope
  `1-(Y/90)^2`. Prefer piecewise interpolation of the nine measured amplitudes
  over a high-order global polynomial. Retest before making the 2D warp global.
- **CALCULATED X SCALE UPDATE / NOT YET GLOBAL** - Mean endpoint width suggests
  revising the local X command scale from `0.986610` to about `0.991319`.
  However, top and bottom widths differ by `1.01 mm`; retain that difference as
  evidence of a separate Y-dependent X term rather than hiding it in one scale.
- **ROBOT-CONFIRMED 2D-WARP RETEST** - The first counter-arc lattice left the
  low-X line under-compensated and the high-X line over-compensated. Y0
  positions from the midpoint datum at the low-X endpoint chord were
  `1.07,18.95,36.75,54.38,71.68,89.74,107.04,124.68,142.22 mm`.
- **CALCULATED RESIDUAL** - Against ideal 17.5 mm Y0 spacing, residual physical
  +X offsets are `1.07,1.45,1.75,1.88,1.68,2.24,2.04,2.18,2.22 mm`. Adding
  these residuals to the prior bow-amplitude estimate gives the next candidate
  table `3.330,3.033125,2.396250,2.159375,1.882500,1.815625,1.408750,
  1.471875,1.255000 mm` from X=-70 to X=+70. This update assumes approximately
  linear local response and requires another physical test.
- **ROBOT-CONFIRMED MOTION FAILURE** - Segmenting each X-direction row at all
  nine lookup nodes produced short pauses and visible fixed-flow blobs. For the
  next lattice, keep each X row as one uninterrupted `MovL`; retain one native
  `Arc3` per Y line. Prefer smooth continuous deposition over sub-millimeter
  lookup conformance when command boundaries visibly damage the print.
- **ROBOT-CONFIRMED / PROMOTED SHARED CALIBRATION - 2026-08-14** - The
  operator judged the R2 compensated lattice adequate; further improvement is
  constrained by manual measurement accuracy. The R2 X scale, linear
  X-dependent Y scale, nine bow amplitudes, and parabolic Y envelope are now
  implemented in shared `global.lua` through `CalibratedXY()` and `P()`.
- **DURABLE NONLINEAR-PATH RULE** - Shared `P()` corrects each commanded point,
  but the controller still interpolates the interior of one `MovL` as a
  straight command-space line. For long Y-oriented paths where physical
  straightness matters, author one native `Arc3` through the corrected Y0
  midpoint. Keep long X paths as a single `MovL`; do not restore lookup-node
  segmentation.
- **CALIBRATION VALIDITY LIMIT** - The promoted lateral-bow model is measured
  only across desired X=-70..+70 and Y=-90..+90. X amplitude is clamped outside
  the measured X range and the bow envelope becomes zero at/beyond Y=+/-90.
  This is a conservative implementation boundary, not proof of accuracy or
  safe reach outside the calibration field.
