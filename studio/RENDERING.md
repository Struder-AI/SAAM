# Studio rendering and playback

Display geometry, material rendering, playback and performance. See [Studio](README.md) for launch and review behavior.

## Studio performance and display detail

Studio uses a right-handed orthographic camera: top view shows +X right and
+Y up (toward the back of the bed), with +Z toward the viewer. Orbit, side and
top views share this projection without perspective scaling. Playback has a
1×–30× slider, initially 10×; inactive toolpath layers draw at 50% opacity with
one-third of the original color lightening. Current material uses shaded oval
beads in WebGL2, with physical dimensions that scale with viewport zoom. Width
comes from commanded volume per distance divided by the nominal layer thickness,
falling back to the plan's line width. Planar and bounded wedge beads sit below
the nozzle; pipe cladding uses radial thickness around its commanded bead center.
Lighting distinguishes adjacent current tracks without an artificial gap.
This is a nominal display cross-section, not measured filament spread.

### Visually verified toolpath colors

The user verified sky blue, orange, teal and lavender as visibly distinct with
Studio's shaded bead rendering on 2026-09-10. These are the preferred visible
color set; agents may use other colors when more are needed. This records visual
feedback, not physical print validation or contributor consensus.

| Color | Display value | Current assignment |
|---|---|---|
| Sky blue | `#5b9fd3` | Body / planar paths |
| Orange | `#c65b19` | Circumferential / skin paths |
| Teal | `#53b8af` | Axial cladding |
| Lavender | `#a799dc` | Available for another operation |

Sky blue was reviewed at `#62a9df`; the current value applies the user's requested
slight darkening. Named pipe-view buttons seek to the body, axial and
circumferential samples without changing camera or speed. The shared
`TOOLPATH_COLORS` palette and style function apply to lines, material and movies.

### Material geometry and playback

Completed material uses rectangular swept sections with every source curve
segment retained. Compact instance buffers, shared cross-section templates and
cached geometry reduce storage and drawing cost without voxelizing curves.
Layers and operations remain separately colored; unprinted bores remain empty.
A depth prepass prevents hidden internal surfaces from accumulating opacity.
Draped skin and normal rimming currently lack source surface normals and retain
an explicitly labeled line fallback. Browsers without WebGL2 also use lines.
Fallback line width scales with the same camera, with a 0.04 mm current-layer
inset. Canvas device-pixel scaling applies once; travel stays a thin screen-space
guide. Display geometry does not modify deposition spacing, volume or export.

Studio displays material estimates in grams using a fixed 1.2 g/cm³ density
for all materials. Robot relay estimates and commanded material intent remain
separate and labeled; internal volumes and machine flow rates retain their units.
Outgoing layers normally ease color and opacity over two seconds of wall-clock
time, including when paused. At accelerated playback, shorten the fade only when
the next layer begins sooner, using its source timeline and the selected speed.
A new layer transition completes any preceding fade, so only one outgoing layer
can fade at a time. Changing speed or pausing never reverses fade progress.
Scrubbing, replay and opening a print reset fade history.
**Export movie** renders the whole interpreted program into a separate canvas
with the same renderer, selected speed, camera/zoom/framing, travel visibility,
rotary view, display detail and layer fade. The viewer stays paused at its current
position. Export uses 30 fps and a deterministic video clock, including two final
seconds to finish fades; it does not wait through real-time playback. WebCodecs
encodes VP9 with VP8 fallback into a seekable, silent WebM download. The browser
must support one of these encoders. Render/encode time depends on the computer;
compressed frames remain in memory until download. Progress and cancellation
keep the page usable, while view controls are locked for consistent frames.
Canvas dimensions and device-pixel ratio at export start determine resolution.
The background is painted by the shared renderer so the movie keeps Studio's
appearance. Same-tab view settings survive refresh in session storage; tabs
opened before this feature must have their settings reselected once. Movie
export does not generate machine code, approve a job, or modify its bundle.

S5 and H2D profiles supply new shell and wedge plans with 40/20/24 mm/s
planar/skin/first-layer targets, 120 mm/s XY travel and 10 mm/s Z travel.
Existing locked plans, material flow limits, retraction and firmware service
speeds are unchanged; actual deposition remains capped by flow and axis limits.

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
Geometry buffers are cached until the source changes. These operations affect
display only: source coordinates, tessellation and manufacturing data remain
unchanged. Without WebGL2, Studio labels its flat-surface fallback. Toolpath view
draws no part mesh or outline; the current phase/layer is darker, opaque and
drawn after the faded prior layers. At shutdown it retains emphasis on the last
deposition layer. Source geometry, output and approval data are unchanged.

Studio uses the shared [bundle identity and reuse contract](../core/print/README.md#print-bundle-and-current-formats).
Its display cache does not replace source verification or approval identity.

Studio's state response contains geometry, review records and a small program
summary/source manifest, never move/event arrays. It fetches the checked machine
source separately: plain Griffin G-code, the exact G-code member of an H2D 3MF,
or each actual Dobot Lua file (global, definitions and entry). Requests bind the
print, review revision and export hash; the browser checks each source digest.
Archive and H2D firmware-envelope checks remain on the server. Delivery retains
the original archive bytes, not a repacked or regenerated program.

A browser worker runs the same modal G-code interpreter or bounded Lua runtime
as export checks. Lua helpers and entry code are executed; annotations cannot
substitute for actual motion commands. H2D playback retains its checked print-body
scope, with firmware service motion explicitly not simulated. The worker stores
decoded moves in chunked typed arrays and transfers their ownership inside the
browser. These are local drawing/timeline data, not another persisted path or
server transport format. No motion JSON is sent to the browser. Timeline, layer,
travel and robot acceleration controls share the existing renderer. Browsers
still decode all moves before playback; fully paged playback is not implemented.
Machine profile loading stays in the Node wrapper; pure machine rules and source
interpreters are shared with the browser through an explicit module allowlist.

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

The initial browser cap sweep used 23,953 and 383,248 interpreted moves, with
10k, 20k, 40k, 80k and 160k endpoint budgets and 15 camera frames per case.
At 40k the larger repeated-path stress fixture drew 21,446 endpoints in about
2.9 ms median / 4.9 ms maximum in the isolated canvas loop; whole-layer selection
can leave the budget partly unused. Its initial detail preparation was about
148 ms. The 160k budget drew 84,694 endpoints in 10.4 / 12.9 ms. The 40k default
leaves room for Studio's other frame work and slower hardware; it is a local
empirical default, not a universal frame-rate guarantee. Raw local results are
in `.local/studio-fast/cap-results.json`; the original Studio baseline is in
`.local/studio-bench/findings.md`. Keep browser drawing measurements distinct
from server generation, cold verification, JSON transfer and UI-ready time.
