# Project State

Last updated: 2026-08-11

## Multi-axis toolpath preview demo — 2026-08-11

The 13-operation flange-fitting dashboard under
`demos/3d-toolpath-generation/` is complete as an **EXPERIMENTAL MULTI-AXIS
CONCEPT · PREVIEW ONLY**. It demonstrates as-built dependency tracking,
filled-bead inspection, diagonal rib growth, buried fillets, and non-planar
cross-cladding for a future 6-axis printer.

This work is intentionally separate from the Dobot program track. It contains
no Dobot Lua, kinematics, calibration, safety claim, or robot-confirmed result.
The checkpoint and durable lessons are recorded in
`docs/iterations/MULTIAXIS_TOOLPATH_DEMO_2026-08-11.md`; the reusable rib skill
is `.agents/skills/multiaxis-diagonal-rib-growth/`, and axial cylinder cladding
is `.agents/skills/multiaxis-cross-layer-cylinder-cladding/`.

## Weekend conceptual development — 2026-08-02

Weekend work on the other laptop established the longer-term direction as an
AI-native 3D printing robot skills library rather than a conventional slicer
clone. Pattern generators are reusable mass-building kernels; optional
modifiers add skins or boundaries without becoming inseparable from the core.

New conceptual work now integrated with the robot-confirmed endpoint:

- `triangular`: one continuous truss path alternating circular boundary arcs
  and straight cross-wall touchback chords. The approved 60 mm guide / 8 mm
  envelope preview selects eight repeats for an approximately 89.8 degree apex.
- `tangent_triangle`: proposed explicit tangent arcs or measured CP compensation
  for smoother triangle necks. This remains conceptual.
- `bounding_perimeter`: optional `none`, `outer`, `inner`, `both`,
  `all_open_edges`, or `custom` skin scope, kept independent from the kernel.
- `omega` / `ribbon`: named conceptual future kernel, not yet previewed or
  robot-tested.

The approved unbounded triangular preview is
`generated_previews/triangular_circle_wall_60d_8w_touchback_2layer_approved.svg`.
The bounded two-layer preview is proposed, not yet approved. The next physical
triangular baseline should print only two unadjusted layers and measure the
actual touchback gap/overlap before adding compensation or tangent blends.
The corresponding paste-ready baseline is now implemented at
`firmware/dobotstudio/working_triangular_wall_60d_8w_2layer/src1.lua` and
remains **EXPERIMENTAL / NOT ROBOT-TESTED**.

The two-layer triangular baseline has now been physically tested: touchback
endpoints connected, but exact reversals produced blobs. Before applying the
planned tangent correction, the unchanged topology is extended to an 87-layer,
60 mm height test at
`firmware/dobotstudio/working_triangular_wall_60d_8w_60h/src1.lua` to evaluate
cumulative stability.

## Current experiment

### Non-planar cladding direction — 2026-08-03

The next new skill family is `non-planar cladding`. It is distinct from
conventional slicing and from the patterned-wall kernels. The intended workflow
is to generate a known support scaffold, grid, frame, or mass-building path
first, then clad that AI-authored support with a coordinated XYZ surface skin.

This is **EXPERIMENTAL**. Initial research suggests using simple 40 mm square
coupons with sparse support grids and shallow top skins before attempting
arbitrary curved solids. The first practical tests should compare a flat sparse
grid baseline, a single-slope top cladding pass, then dome or saddle surfaces.
The main observations to record are support contact, sag across cells, bead
thinning on true 3D path length, nozzle drag, blobs at turns, and motion
smoothness.

The project skill is preserved at
`.agents/skills/dobot-non-planar-cladding/SKILL.md`.

### End-of-day bounded triangular-wall checkpoint — 2026-08-03

The latest paste-ready program is
`firmware/dobotstudio/working_bounded_triangular_wall_60d_8w_10h_fillet/src1.lua`.
It is **EXPERIMENTAL / NEEDS RETEST**. It preserves one continuous extrusion
window, one solid annular foundation, fourteen patterned layers, alternating
outer-to-inner/inner-to-outer traversal, one inner skin, and two outer skins.

The previous physical test showed that fillet compensation shifted the
triangular-core boundary endpoints off their nominal circles. The replacement
regenerates the bounded geometry from scratch: 8 mm total envelope, 0.78 mm
spacing, 5.66 mm remaining core, 13 recalculated repeats, and exact concentric
radii of 26.00/26.78/32.44/33.22/34.00 mm. Its vertex arcs pass through the
nominal couching points without moving the concentric boundary endpoints.

Next action: paste and physically test the replacement `src1.lua`. Verify inner
and outer concentricity, skin/core contact, couching continuity, corner blobs,
motion smoothness, and whether the 0.78 mm spacing produces the expected
approximately 0.05 mm physical bead overlap.

The corrected 60 mm across-flats, 100 mm tall twisted-hex pencil holder is
preserved as the stable reference waypoint
`firmware/dobotstudio/milestone_hex_pencil_holder_60af_100mm/`. It includes
the corrected first-layer Z, 25% physical solid-infill tie-in, fast linear
perimeter-to-raster transition, side-parallel base raster families, 4-3-2
inner chamfer, continuous wall, and standardized 3 mm rounded lip. The full
corrected program remains **NEEDS RETEST** on the robot.

The next design investigation is a generalized semi-continuous thick-wall
strategy that oscillates or loops around a 2D guide path. The first physical
trochoid implementation is a **KNOWN FAILURE**: dense short `MovL` chords ran
staccato, massively over-deposited, and did not express the intended crossing
loops or hollow wall cells. Do not rerun it. Redesign it as an explicit loop
chain built from a small number of smoothly blended native primitives, first
as an extrusion-off single-circuit motion test. Sinusoidal-weave feedback is
still pending and must be recorded separately.

The replacement native-`Arc3` cellular loop chain is a partial robot success:
motion was smooth, but a poorly adhered first-layer section was pulled loose
by the returning loop and the discrete layer transition left a visible seam.
The next specimen uses conventional configurable spiral foundation/cap
layers and a continuously rising, continuously phase-drifting body. Its revised
target is a 60 mm guide diameter, 10 mm deposited envelope, and approximately
8 mm loop repeat.

The apparent high-Z start on that 60 mm test was later traced to the preceding
overfilled trochoid physically pushing the toolhead upward. Temporary first-
layer offset reductions over-compressed the layer once the toolhead was fixed;
they have been reverted. Inspect mechanical tool position after overfill before
changing the established Z procedure.

The final open-top touchback revision worked nicely and is preserved at
`firmware/dobotstudio/milestone_touchback_loop_ring_60d_10w_20h/`. This is the
current stable reference for patterned thick-wall development. It combines one
solid spiral foundation with a seamless native-arc cellular body and ties each
return node beside the previous forward node at the calibrated 0.78 mm
centerline spacing. No top cap is printed, leaving the internal structure open
for inspection. Continue future conceptual work from this milestone while
preserving the earlier dense-polyline and untied-loop variants as evidence.

The first staged top-lip test on the twisted-hex vase failed: the lip lines
separated. Path review found an unsupported extrusion-on chord from the
partial-side end of the spiral to a fixed corner start for the first closed
lip contour. Replace this with a phase-preserving, inward-growing rim test.
Do not reuse the speed-2.5 wide-foundation strategy without separate flow
validation.

The replacement 1 mm clipped-corner support behavior was robot-confirmed to
work without unusual stringing. The next test grows the frozen rim from one to
four inward perimeters, repeats four once, then tapers through three, two, and
one. Its base is corrected to spiral only from a 30 mm hex to the 50 mm vase
wall, with no external lead-in.

The successful centered rounded-lip behavior is now standardized as
`.agents/skills/dobot-spiral-lip/`. It converts requested physical lip width
to calibrated perimeter count, derives the clipped-corner support ramp, and
samples a circular upper cross-section for centered crown layers.

## Iteration status

OpenSauce 2026 is complete and was successful.

- Immutable checkpoint: `iteration-opensauce-2026`
- Detailed handoff: `docs/iterations/OPENSAUCE_2026.md`
- Repository: `tkeller-inventopia/ai-native-3d-printer`
- `main` contains the completed event checkpoint and is ready for subsequent
  maintenance.

The event is closed as an iteration so new projects can branch from a known,
documented state without rewriting the OpenSauce history.

## Production baseline at iteration close

`firmware/dobotstudio/milestone_struderbot_cube_diamond_stable/`

Robot-confirmed baseline behavior:

- Remote I/O physical-button execution.
- DI1 runs the 40 mm cube net.
- DI2 runs the 40 mm diamond/octahedron net.
- Both use 4 mm gaps and 20 mm flow lead-ins.
- End behavior stops extrusion, lifts in place, then moves toward X0/Y0 at high
  Z.
- Cube was the best print at the prior stable checkpoint; diamond ran and
  printed.

The OpenSauce-era working directories and approved previews are preserved in
the iteration, but their own README evidence labels control whether they are
robot-confirmed, experimental, or need retesting. Overall event success must
not be used to silently promote every variant.

## Preserved OpenSauce-era work

- `milestone_cube_net_40mm_separate_connectors/`
- `working_cube_net_continuous_grid/`
- `working_cube_net_double_density/`
- `working_diamond_continuous_infill_first/`
- `working_independent_triangles/`
- `working_permanent_buildplate_test/`
- Approved HTML path previews under `generated_previews/`
- Proposed StruderBot Demo 2 dreamcatcher SVG and PNG concepts

## Durable technical state

- Canonical robot knowledge: `docs/ROBOT_KNOWLEDGE.md`
- Operator/Codex workflow: `docs/PROGRAM_CREATION_WORKFLOW.md`
- Repository guidance: `AGENTS.md`
- Reusable project skill: `.agents/skills/dobot-programmer/`
- Focused layer skill: `.agents/skills/dobot-layer-filling/`
- Interim layer-filling handoff:
  `docs/iterations/LAYER_FILLING_INTERIM_2026-07-29.md`
- OpenSauce handoff: `docs/iterations/OPENSAUCE_2026.md`

## Next-development rules

1. Create a new descriptive branch for each next project.
2. Branch from `iteration-opensauce-2026` when the new project should start
   from the exact event state.
3. Branch from `main` when the new project should include later maintenance.
4. Create new working and milestone directories; do not overwrite the tagged
   OpenSauce artifacts.
5. Continue using deterministic preview approval and evidence-labeled robot
   results.

## Open work carried forward

1. Robot-test and classify the preserved OpenSauce-era working variants.
2. Reconfirm the permanent build-plate Z value and calibration before reusing
   it in a new production baseline.
3. Standardize future preview and Lua generation around one shared path
   specification.
4. Refine travel routing so repositioning stays within safe, intentional
   envelopes.
5. Hardware-test filling, vase-mode, and new Demo 2 concepts before promotion.
6. Continue from the square-tower experimental baseline: temperature 211,
   movement speed 3, layer height 0.70 mm, measured wall width about 0.83 mm,
   and CP 1.0-1.5. Reduce corner over-extrusion without reintroducing severe
   pauses or unacceptable rounding.
7. Calibrate the Struder's physical filament-feed rate; its displayed standard
   setting of 0.4 mm/second is currently only an uncalibrated reference.
8. Use the robot-confirmed 0.780 mm solid-fill spacing as the current baseline.
   Test infill-to-wall compensation next: 0.1245 mm extension for sparse
   infill and 0.2075 mm extension for solid top/bottom infill.
9. Develop the first conventional 20 mm cube artifact with two perimeters,
   three solid bottom layers, three solid top layers, and 30% rectilinear
   infill between them.
10. Replace the flange demo's row-first bolt-hole avoidance with region-first
    filling. Complete each connected side region, make one intentional fast
    transition around each relevant hole boundary, and distinguish transition
    speed from structural perimeter speed.
11. Robot-test the continuous two-revolution bolt-hole spirals. Confirm that
    removing inter-ring repositioning eliminates the observed pauses without
    shrinking the clear holes or creating excess material at the spiral ends.
12. Retest the `+X/+Y` fill transition with its redundant start reposition
    removed. The first full follow-up restores three alternating solid flange
    layers and the approved 50 mm square spiral pipe.
13. Retest the more precisely identified region-to-outer-band junction. The
    rapid cross-part return is removed; the raster now continues from the
    current right edge at print speed in both horizontal and rotated layers.
14. Large-solid calibration is paused at the 2026-07-29 interim waypoint
    because bed adhesion is now the dominant constraint. Continue with
    low-contact-area tests, then return to the latest pause fix and full flange
    after adhesion improves.
15. Retest the twisted-hex vase with its lead-in extended radially outside the
    complete part envelope. Also test whether CP-smoothed speed-20 in-plane
    repositioning removes the pause after the circular hole contours.

## Starting the next project

Choose a descriptive branch name, for example:

```text
project/dreamcatcher
project/vase-mode
project/continuous-grid
```

Open a fresh Codex task from that branch and ask it to read `AGENTS.md`,
`docs/ROBOT_KNOWLEDGE.md`, `docs/PROGRAM_CREATION_WORKFLOW.md`,
`docs/PROJECT_STATE.md`, and the OpenSauce iteration summary before proposing
changes.

## Current bounded triangular-wall checkpoint — 2026-08-04

- The physical alarm near Y0 was traced to three near-degenerate calibrated
  seam `Arc3` commands. All three were removed by correcting the seam direction
  and reusing ordinary repeat geometry.
- Every generated arc table now passes controller-coordinate geometry gates;
  the complete test suite passes 24 tests.
- Do not run the regenerated Lua yet. The observed approximately 2 mm apex gap
  still requires the comprehensive virtual-apex overlap/tangent-cap
  recalculation and a newly approved preview.
- The bounded loop-back direction has now been retired instead of receiving
  another material test. `triangular_touchback` is perimeterless only. The next
  bounded patterned-wall experiment should use the new `walled_truss` kernel.

## Patterned-wall pause checkpoint — 2026-08-04

- Patterned-wall development is paused for later revisiting.
- The successful bounded reference is
  `working_walled_truss_ring_60d_8w`: 60 mm guide diameter, 8 mm envelope,
  one inner/outer wall, 8 repeats, 2 mm turns, 0.415 mm overlap, and forward
  half-repeat seam progression.
- The larger `working_walled_truss_cup_80od_12w_80h` is generated and
  software-validated but untested. It remains experimental.
- Durable routing lives in `.agents/skills/dobot-patterned-wall/`; canonical
  geometry/export/preview scripts and regression tests are checked in beside
  the preserved Lua programs.

## Non-planar cladding checkpoint — 2026-08-04

- The first 20 mm, 10 degree coupon validated simultaneous axis/Z cladding
  motion uphill and downhill.
- Pauses at raster reversals, scaffold corners, and layer transitions created
  blobs. The next revision must improve motion continuity rather than simply
  scaling the original commands.
- The paper substrate lifted from the bed and remains an independent test
  constraint.
- Next coupon: 40 mm square, 10 degree slope along Y, with the same alternating
  up/down-slope and cross-slope cladding schedule.
- The 40 mm, 10 degree Y-slope coupon printed successfully. The next coupon is
  20 degrees. It replaces jump-speed layer starts with continuous speed-3
  structural connectors and uses rising corner loops for pure vertical layer
  shifts.
- The 40 mm, 20 degree Y-slope coupon also printed successfully, and its top
  cladding layer was especially clean. This establishes 20 degrees as a
  robot-confirmed successful surface angle for this coupon geometry.
- Long layer-shift pauses persisted despite speed-3 structural connectors and
  rising square loops, so that transition method is a known incomplete fix.
- Resume by holding the successful geometry fixed and replacing only the
  layer-boundary motion with tangent-continuous deposited transitions.

## Non-planar gable and ironing checkpoint — 2026-08-06

- The symmetric 40 × 40 mm, 20-degree gable coupon is robot-confirmed
  successful and preserved at
  `firmware/dobotstudio/milestone_nonplanar_gable_cladding_40mm_20deg/`.
- Ridge direction is X at Y0; final surface strokes climb and descend in Y/Z.
- The successful reference remains non-ironed and must not be overwritten.
- The next separate experiment adds two extrusion-off Y/Z ironing passes at
  the same nominal surface Z, using 0.25 mm spacing and a 0.125 mm stagger.
- Validate heat accumulation, nozzle drag, ridge behavior, surface smoothing,
  and whether a small positive Z offset is needed after the first physical run.
- The apparent omission of the first ironing pass was traced to DobotStudio
  executing a stale program despite the updated source/upload display. Saving
  under a new filename forced a refresh; after one `cannot load program`
  response, saving the new file again allowed it to run. Treat controller-side
  filename caching as a robot-confirmed deployment fault, not a toolpath fault.
- The first 30-degree cross-ironing test exposed a separate real toolpath
  failure: second-pass eave-to-eave `MovL` chords stayed at eave Z and collided
  with the gable. The source now inserts the ridge point in every Y/Z row, but
  this correction needs a fresh physical retest under a new controller filename.

## Pre-firmware-upgrade checkpoint and raw recalibration — 2026-08-12

- The current 30-degree cosmetic gable/cross-ironing source is preserved at
  `firmware/dobotstudio/working_nonplanar_gable_40mm_30deg_cosmetic_base_cross_ironing/`
  as an experimental pre-upgrade checkpoint.
- The operator located a firmware/servo upgrade path that may change raw XY
  geometry, blending, smoothness, frames, and the validity of earlier software
  correction factors.
- The next physical test is the centered raw 100 mm grid at
  `firmware/dobotstudio/working_raw_100mm_post_firmware_calibration/`.
- Its `src1.lua` bypasses `P()`, `CalibratedXY()`, and all `CAL_*` coefficients
  by constructing raw Tool/User-frame point tables locally.
- Measure four outer sides, both diagonals, internal third spans, and origin
  offset before deriving any new compensation.
- First raw result: Y spans from low X to high X are 126.30/122.62/120.38/
  117.70 mm. Horizontal paths bow outward in X, much more strongly at low Y.
- Provisional Y fit is `scale(X) = 0.82190343 + 0.0005661802*X`; this is not
  yet approved for use because the bow is non-affine and measurements remain
  incomplete.
- X spans are confirmed as 101.47/99.12/99.10/100.03 mm; `11.47` was a
  data-entry error. Their non-monotonic variation across Y and the visible
  within-line bow make a linear X correction inadequate. A quadratic width fit
  has been calculated for diagnosis but is not approved for robot control.
- The raw 180 x 240 mm diagnostic exceeded safe reach at X-98/Y-120 and caused
  a joint-limit alarm. Its reduced 140 x 180 mm replacement completed.
- The reduced lattice's commanded 140 mm X width measured 141.9 mm at both top
  and bottom. Each commanded 90 mm Y half-span measured 113.13 mm at nominal
  X=-70 and about 105 mm at nominal X=+70. Straight tape seams make the strong
  low-X bow and its reduction toward high X visually clear.
- Next measurement priority: record upper and lower 90 mm half-spans separately
  at all nine X columns, then measure each 17.5 mm X cell width at the bottom,
  center, and top rows. Fit a 2D warp only after those measurements.
- Nine-column upper/lower half-span measurements are now recorded in canonical
  robot knowledge. They support a candidate linear Y correction
  `0.82792485 + 0.000476289593*X`; its worst in-sample total-height residual is
  about 1.29 mm. A quadratic reduces that to about 0.67 mm but risks fitting
  measurement/local-path noise. Next step should compare a compensated lattice
  using the linear candidate before adding higher-order terms.
- The compensated lattice has now been robot-tested. Total heights are within
  -0.58/+1.90 mm of 180 mm and within about 0.58 mm from X=-35 through X=+70,
  confirming that the linear Y model largely solves scale. Low-X lateral bow
  remains visually almost unchanged because no X-as-a-function-of-Y correction
  was applied. Next collect lateral offsets at multiple Y rows for selected X
  columns and fit the missing X/Y cross-warp before another print.
- Centerline X measurements and top/bottom widths now provide the missing bow
  sample. Relative to the average endpoint chord, Y0 lateral offsets across
  the nine X columns are +2.260/+1.583/+0.646/+0.279/+0.203/-0.424/-0.631/
  -0.708/-0.965 mm. Next generate a local experimental 2D correction using
  piecewise X-amplitude interpolation and a zero-at-endpoints parabolic Y
  envelope; do not yet replace global calibration.
- First 2D counter-arc test residuals show the old amplitude table crossed sign
  incorrectly. The next candidate amplitudes are 3.330/3.033125/2.396250/
  2.159375/1.882500/1.815625/1.408750/1.471875/1.255000 mm, all toward +X
  before command inversion. The next revision must also replace every segmented
  X row with one long `MovL`; keep the smooth Y `Arc3` paths.
- The R2 continuous-X / native-Y-arc lattice is robot-confirmed adequate within
  manual measurement limits. Its coefficients are promoted into shared
  `firmware/dobotstudio/global.lua`; the evidence program remains preserved at
  `working_compensated_2d_warp_140x180_r2_continuous_x/` and the checkpoint is
  documented at `milestone_post_firmware_2d_calibration_2026_08_14/`.
- Future programs should express desired centered coordinates through `P()`.
  For long Y lines requiring physical straightness, use one `Arc3` through the
  corrected Y0 midpoint; endpoint-only `MovL` transformation cannot express
  the nonlinear interior warp.
- Straight-segment `walled_truss` geometry is now defined in the patterned-wall
  skill. It selects an integer diagonal-leg count that terminates at a far
  corner, reconstructs tangent arcs to the actual wall-overlap target, and
  automatically scales turn radius from `min(2 mm, 0.30 * H_touch)` with bead-
  width and controller-arc rejection gates. The proposed 30 x 5 mm example
  uses experimental 1 mm turns and seven legs. With the clarified default that
  30 x 5 mm means finished exterior dimensions, the usable inside-corner span
  is 28.34 mm and the reconstructed apex is 87.44 degrees.

## Online-mode development pivot — 2026-08-14

- **OPERATOR WORKFLOW DECISION:** normal development is moving away from
  Remote I/O/button dispatch and toward direct Online-mode execution from
  DobotStudio Pro. Remote I/O remains preserved only for future offline/demo
  use.
- **KNOWN CONFIGURATION/DEPLOYMENT FAILURE:** the post-calibration shared
  global/configuration used with straight walled-truss revisions R1–R3 did not
  reach a reliable print path. Tests produced target-position joint-limit and
  inverse-kinematics alarms while frame, ready-pose, Z, and approach assumptions
  were being mixed. The truss geometry itself remains experimental and untested.
- **SUPERSEDED CONFIGURATION NOTE:** the attempted `(0,0,100,180)` ready pose
  and `BED_Z=-7.22` configuration were not the recovered Online baseline.
  Preserve them only with the failed deployment history.
- Full boundary and preserved references:
  `docs/iterations/REMOTE_IO_TO_ONLINE_PIVOT_2026-08-14.md`.
- **ROBOT-CONFIRMED ONLINE BASELINE:** the dependency-free, comments-only
  `working_online_mode_noop/src0.lua` executed from the Online-mode Start
  control and reported `running complete`. This validates only source loading
  and direct execution; frames, globals, points, motion, I/O, and extrusion
  remain intentionally untested in the new workflow.
- **CLEAN GLOBAL DECISION:** new Online programs use
  `BED_ZERO_Z=-90.44`, `LAYER_HEIGHT_MM=0.70`, and
  `PRINT_SPEED_MM_S=3.0`. Demo-era thin/thick variables and the generic height-
  above-bed alias are deprecated outside preserved historical projects.
- **ROBOT-CONFIRMED ONLINE BASELINE:** the clean global, calibrated deposited
  20 mm square, and calibrated 100 mm square spiral-vase wall 10 mm high ran
  successfully from Online mode using Tool 1/User 1. The vase confirms the
  nonlinear XY correction on a continuous 3D path; no Z bed-warp map was used.
- **START CONDITION:** before Online Start, manually park the nozzle roughly
  above User-frame X0/Y0 in the familiar printing posture. The unchanged vase
  program alarmed after a large manual displacement and recovered after the
  nozzle was returned near this staging region.
- **NEXT ACTION:** retest the preserved experimental straight 30 x 5 x 10 mm
  walled-truss geometry using the clean Online baseline, without its failed
  Remote-I/O/shared-global approach wrapper.

## Mandatory prime lead-in — 2026-08-15

- **OPERATOR PROCESS REQUIREMENT:** every future material print in the clean
  Online-mode configuration begins with at least 100 mm of sacrificial purge
  path to clear heat-discolored filament left in the nozzle during idle time.
- The durable workflow is captured in
  `.agents/skills/dobot-prime-lead-in/`. Its initial experimental default is a
  compact three-lane serpentine at normal print speed, 4 mm lane pitch,
  tangent 2 mm turns, and 5 mm clear edge gap between the serpentine body and
  the full part envelope, followed by one printed connector into the model.
- The purge receives the normal startup delay at its first point and connects
  continuously into the model under the same single extrusion window. It must
  not add a dwell, rapid, retract, or extrusion restart at the model entry.
- `online_mode_clean_baseline/global.lua` now exposes the planning defaults;
  actual purge geometry remains program-local because it depends on the full
  part and bed envelopes.
- **NEXT PHYSICAL TEST:** add this purge to a small known-good part and verify
  that 100 mm clears the discoloration, the serpentine does not bond to the
  model, and the native tangent turns remain smooth.

## Mouse-ear corner adhesion — 2026-08-15

- The new `.agents/skills/dobot-dog-ears/` captures optional rounded
  corner-adhesion tabs and their connecting breakaway skirt.
- **KNOWN FAILURE:** the first 15 mm solid-filled ears did not adhere and the
  0.20 mm brim separation fused into the goopy first part layer.
- **EXPERIMENTAL REVISION:** use 25 mm ears at 4.5 mm/s with 1.80 mm sparse
  spacing. The provisional inverse-speed width is 0.553 mm. This distributes
  an estimated 80% of the former total ear material over 2.78 times the area.
- Keep ordinary ear/brim paths at least 1.00 mm clear edge-to-edge from the
  finished part. Each ear connects only through three narrow V jogs: one at
  the corner apex and one at each side-tangent location.
- Box contours also showed fixed-flow corner blobs. The proposed correction is
  contour-only CP 1.5, 3.0 mm/s tangent straights, and 4.5 mm/s native corner
  arcs. Do not apply these settings to purge, infill, ties, or repositioning.
- Strictly printing four disconnected ears before any skirt segment conflicts
  with the no-restart extrusion invariant. The durable continuous equivalent
  alternates ear and adjacent skirt span, completes all adhesion support before
  the part, and enters the first perimeter through the final shared corner.
- **NEXT PHYSICAL TEST:** approve and print the 25 mm sparse three-tie revision;
  inspect adhesion, tie breakaway, ear curl, and contour corner blobs.
- **LATEST OBSERVATION:** the 25 mm slow-squish revision at 3.0 mm/s,
  2.70 mm spacing, and +0.55 mm support Z was not dense enough and remains
  experimental. The next omega specimen intentionally omits all foundation
  and mouse-ear paths to isolate a raw 10 mm fixed-phase ribbon stack.

## Beer-coozie trochoidal print — 2026-08-15

- **KNOWN FAILURE:** `BEER_COOZIE_TROCHOID_CHAMFER_R1` stopped before motion
  because the Dobot Lua runtime has no `math.atan2()` field.
- **EXPERIMENTAL R2 READY FOR RETEST:** the fixed program uses the equivalent
  quadrant-III expression `-math.pi + math.atan(y / x)`. Approved geometry,
  tool state, speeds, purge, trochoid, and chamfer are otherwise unchanged.
