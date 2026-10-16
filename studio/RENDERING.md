# Studio rendering and playback

Display geometry, material rendering, playback and performance. See [Studio](./README.md) for launch and review behavior.

Stationary extrusion has source-decoded duration and volume at a fixed nozzle
position. Playback holds that position and draws an injection ring, with volume
and nozzle setpoint while the action is active. It does not invent a bead
direction or simulate molten cavity filling. The ring remains at the commanded
location afterward; the final CAD model still describes the intended finished
part. Thermal wait time is not simulated.

The [machine contract](./KINEMATICS.md#implemented-consumer) owns ghost/Machine views and their providers.
**Nozzle clearance** replaces the schematic tool with the scheduler's shared cone: dashed nominal, orange after surface allowance, clipped for display. It follows playback/manual pose, persists per tab and appears in movies; this overlay does not change collision rules or programs.
Toolpath colors, bead detail and part framing remain independent of machine presentation.

## Studio performance and display detail

Studio times interactive redraws. A burst is one continuous orbit, pan, zoom or
playback run; when it ends the browser posts a summary to
`POST /api/view-performance`, and `GET /api/view-performance` returns the last 20
from server memory. Each report carries frame spacing, main-thread draw time,
material-pass time, per-quality-level timings, canvas size, the material
renderer's draw statistics and the WebGL renderer string. A renderer named
Microsoft Basic Render Driver, SwiftShader or llvmpipe means the browser is
rasterizing on the CPU. Read these reports before instrumenting a page by hand.

While the toolpath view moves, motion quality follows the measured frame cost:
above 50 ms it lowers the material render resolution (half, then a third with
square sections), and returns after sustained frames under 25 ms. A step that
saves under a fifth is undone and not retried, which is the usual outcome on a
CPU rasterizer where bead geometry, not pixels, dominates. About a quarter second
after motion stops Studio redraws at full detail; still frames, exports and movies
never use a reduced level. `?motion-quality=0|1|2` pins a level for inspection.

Shared work activity fades the viewport canvas to 28% opacity, using the same
state as the agent dots. It clears without a delayed transition when the requested
result is ready, or work pauses, fails or is interrupted. This presentation does
not alter geometry, source playback, exports or exported movies. The tour's step-3
attention fade is independent and lasts until a print is selected or the lesson
is left; step 4 gives both continuation choices equal arrows, colors and blinking.
The toolpath pane uses the same 28% opacity for its placeholder whenever it has no
current program: the retained previous toolpath when there is one, otherwise the
part geometry. That placeholder is independent of agent activity, so it also covers
a first generation, a reload during one and a failed generation.

The optional Evolve pane can reveal enclosed cavities through a translucent shell.
It flood-fills empty cells in the saved analysis grid: regions reaching a domain
face are exterior, while the remaining regions are enclosed cavities. It reports
their count and total volume and colors only their bounding faces purple.
The shell-opacity control and deformation magnification affect display only.
Cavity classification is cached per saved candidate and uses its undeformed grid;
open recesses and through holes retain displacement colors. Disable **Reveal
enclosed cavities** to return to the opaque displacement view.

The right-handed orthographic camera shows top +X right, +Y back/up, +Z toward
the viewer; orbit/side/top share it without perspective. Playback spans 1×–30×,
starting 10×. Layer emphasis uses inspection identity or motion's `layerId`/index;
legacy paths use distinct chronological runs. Inactive layers default 50% opacity
with one-third color lightening. **Previous layer opacity** spans 50%–100%; 100% matches active color/opacity.
Changes apply immediately, persist in same-tab settings and affect exported movies.
Current material uses shaded oval
beads in WebGL2, with physical dimensions that scale with viewport zoom. Width
comes from commanded volume per distance divided by the nominal layer thickness,
falling back to the plan's line width. Planar beads sit below
the nozzle; pipe cladding uses radial thickness around its commanded bead center.
Lighting distinguishes adjacent current tracks without an artificial gap.
This is a nominal display cross-section, not measured filament spread.

### Tour previews

The [guided tour](../examples/prints/README.md) uses this same renderer and machine
presentation. Its fin block initializes from its source recipe and shows
geometry before toolpath generation. At toolpath review, the normal worker
supplies playback and material instances from the SAAMpath. Generated display
caches and machine programs are not bundled in the repository.
The browser owns one presentation model keyed by `printId`, `geometryId`,
`editRevision`, `outputId` and path id. `planPresentation(previous, response)` returns
that model plus explicit program effects: replace or clear. A tour may
therefore return to geometry-only lessons while retaining one decoded playback
and material scene, then reuse those buffers when the identity matches. Changed
identity replaces or clears them; metadata-only changes rebind the machine
session. This does not skip the server's current-source checks or fetch program
data during an initial geometry lesson.

### Phase colours

Lines, beads, movies, legend and sample buttons use the resolved `phasePalette`
([precedence](../core/print/USAGE.md#phase-colours)); [phase-colours.mjs](../core/print/phase-colours.mjs)
owns defaults. Multi-material moves use filament colour. Inspection/modulation
comes from the drawn path's summary; shaded beads do not require a machine program.

### Material geometry and playback

Completed material uses rectangular swept sections with every source curve
segment retained. Compact instance buffers, shared cross-section templates and
cached geometry reduce storage and drawing cost without voxelizing curves.
Layers and operations remain separately colored; unprinted bores remain empty.
Material preparation reads selected compact move columns into one local scratch
row, reusing vectors instead of allocating a complete move for every pass.
Retained group representatives remain independent copies. This preserves every
source segment and the same instance buffers; it does not reduce display detail.
One depth-tested, unblended pass draws the nearest material surface, so hidden
internal surfaces cannot accumulate opacity; the ghost machine composites
underneath afterwards. Bead templates are indexed and wound outward, back faces
are culled, and a layer/operation group whose projected bounds miss the viewport
is skipped. These match the earlier two-pass image to rounding (DEVLOG 2026-09-18).
Material frames and bead dimensions shade paths independently of machine selection
or tool tilt. Legacy unframed paths and browsers without WebGL2 use lines, scaled
with the same camera and a 0.04 mm current-layer inset. Canvas device-pixel scaling applies once; travel stays a thin screen-space
guide. Display geometry does not modify deposition spacing, volume or export.

Studio displays material estimates in grams using a fixed 1.2 g/cm³ density
for all materials. Robot relay estimates and commanded material intent remain
separate and labeled; internal volumes and machine flow rates retain their units.
Inspection reads `report.depositionFamily`; operation plus exported `layer` selects
the slice or Trace repetition index. Spiral paths retain turn identity without
splitting deposition. Trace retains repetition groups and its reference sleeve name;
Inject numbers points independently of height. Reference geometry is not drawn.
Substrate adaptation is agent-controlled through the recipe/API; settings only
report its current value.
Outgoing layers fade over two wall-clock seconds, shortened when the next layer
arrives sooner. A transition completes the previous fade; pausing/changing speed
never reverses it. Scrubbing, replay and opening a print reset fade history.
**Export movie** renders the whole SAAMpath into a separate canvas
with the same renderer, selected speed, camera/zoom/framing, travel visibility,
followed plate, display detail and layer fade. The viewer stays paused at its current
position. Export uses 30 fps and a deterministic video clock, including two final
seconds to finish fades; it does not wait through real-time playback. WebCodecs
encodes VP9 with VP8 fallback into a seekable, silent WebM download. The browser
must support one of these encoders. Render/encode time depends on the computer;
compressed frames remain in memory until download. Progress and cancellation
keep the page usable, while view controls are locked for consistent frames.
Canvas dimensions and device-pixel ratio at export start determine resolution.
The shared renderer preserves Studio's appearance. Same-tab view settings survive
refresh. Movie export neither generates machine code nor edits a bundle.

S5 and H2D profiles supply new shell plans with 40/20/24 mm/s
planar/skin/first-layer targets, 120 mm/s XY travel and 10 mm/s Z travel.
Existing locked plans, retraction and firmware service
speeds are unchanged; actual deposition remains capped by axis feed limits.

Geometry view uses opaque, depth-tested WebGL2 sky-blue surfaces, camera-relative
lighting and a subtle blurred ground shadow projected from the actual mesh.
Angle-weighted corner normals smooth curved tessellation below a 35-degree
crease threshold; named feature boundaries and sharper corners remain crisp.
Coincident patch vertices share display normals only within the same feature.
Quiet depth-tested crease/rim lines replace triangle outlines. Selection adds
a restrained tint and stronger boundary lines; pointer picking interpolates
depth at the clicked location, leaving real holes empty. The grid retains its
original contrast, with an orientation indicator in the corner instead of axes
over the part.
Clicks within six CSS pixels of a visible crease or boundary select an edge
before a surface. Connected segments join through degree-two vertices; junctions
split edges and closed rims remain whole. Names use the adjacent source feature
labels plus a per-group number, stable within the geometry revision. Internal
coplanar tessellation and the roof's illustrative grid are not selectable edges.
Picking compares edge depth with the front surface, and an orange depth-tested
line highlights selection. The flat fallback samples visibility along that line.
Geometry buffers are cached until the source changes. These operations affect
display only: source coordinates, tessellation and manufacturing data remain
unchanged. Without WebGL2, Studio labels its flat-surface fallback. Toolpath view
draws no part mesh or outline; the current phase/layer is darker, opaque and
drawn after the faded prior layers. At shutdown it retains emphasis on the last
deposition layer. Source geometry and output are unchanged.

Studio uses the shared [bundle identity and reuse contract](../core/print/README.md#print-bundle-and-current-formats).

Studio's state response contains geometry, review records and the adapter's
stored report, never move/event arrays. Studio draws the SAAMpath, not the machine
program (owner, 2026-10-11: "just show saampath in viewer, without priming/etc."):
`/api/path` returns the completed output's SAAMpath, else the saved one, at its
placement, bound to print, revision and path id. Playback times are the path's
own speeds; startup, priming and material-change motion exist only in the
program. Delivery retains the checked program bytes. A browser worker decodes
the path into chunked typed arrays it owns; these are local drawing data, not a
persisted path. Browsers decode all moves before playback; paged playback is not
implemented. Pure machine rules are shared with the browser through an explicit
module allowlist.

Studio computes bounds/layout/camera transforms once per frame and coalesces
redraw requests. It preserves segment order, colour and transparency. The
fallback line viewer has a **40,000 drawn-endpoint budget** (two endpoints per line,
including reserved space for the active move); this is a drawing budget, not an
input/file limit or a manufacturing-path simplification. Geometry proxy and
camera decorations are separate. Full interpreted moves remain available for
playback timing, nozzle position, checks and export.

Below the budget, the viewer draws the original segments. Above it,
`studio/toolpath-view.mjs` simplifies only continuous same-operation strokes
within one phase/layer, with 0.02 mm chord deviation. It retains bends exceeding
that tolerance and never joins across travel/extrusion or operation boundaries.
If that is insufficient, it keeps representative whole layers, preferentially
retaining the latest layer. A single oversized layer gets a detailed window at
playback, preference for walls/non-planar moves and distributed older samples.
Omitted edges remain omitted, never connected into invented extrusion. Studio
labels simplified curves or a layer overview; detail follows the playback
position. This overview does not show every older segment simultaneously.

The 40k default is a local empirical budget, not a universal frame-rate guarantee.
The [initial cap sweep](../DEVLOG.md#undated--studio-browser-cap-measurements)
records the fixtures, endpoint counts and timings behind it. Keep browser drawing
measurements distinct from server generation, cold verification, transfer and
UI-ready time.
