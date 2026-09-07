# Trace player

Animates a motion trace (`schemas/motion-trace/`) so a human can watch
what a program does before a machine runs it.

`preview.html` in this directory is a prebuilt, self-contained page — open
it in any browser, no server and no toolchain. Drop your own `global.lua`
and `src1.lua` onto it and it reads them in the page, using the same
reader the test suite uses.

To rebuild it after changing any source it inlines:

```bash
npm run build-preview -- interfaces/trace-player/preview.html
```

`tests/golden/trace-player-standalone.test.mjs` fails if the committed
copy is stale.

## Controls

| | |
|---|---|
| drag | rotate |
| shift-drag | pan |
| scroll | zoom |
| space | play/pause |
| arrows | step |

**constant speed** switches the clock from real machine time to a fixed
distance per second. Machine time shows dynamics — stalls, dwells,
deceleration into waypoints. Constant speed gives every millimetre equal
screen time, which is easier to read when a program has a wide speed
range. The real machine duration is shown in both.

There is no layer control. The scrub bar is deposition order, so
material appears when it was extruded. A toolpath here may spiral, clad a
slope, or double back.

## Reading the view

The projection is axonometric — no perspective, so a distance reads the
same anywhere on screen — but the scene is depth-sorted: every line is
painted back to front on its real distance from the eye and faded toward
the page with that distance. Rotating the view therefore changes what is
in front of what, which is what makes a spiral read as a spiral instead
of a flat coil. Deposition order decides only *whether* a line has been
laid down yet; that is what the scrub bar moves.

Lines are drawn narrower than a real bead, deliberately. Neighbouring
passes sit well under a millimetre apart, and drawn at true width they
fuse into one sheet — which is exactly the structure you opened a preview
to read. At this width you can count passes and see where fill meets a
perimeter. It is not a claim about how much material lands: a trace
carries no volumetric rate. The width follows the zoom like a real
object, so zooming in shows a pass rather than a hairline.

Extruding moves are coloured by speed relative to the slowest printing
move, on a log scale. Under a constant-rate extruder the bead
cross-section goes as `A = Q / v`, so a part meant to be uniform should
come out one colour.

- **purple dashed** — a travel move, independent of speed. New Dobot exports annotate intent explicitly, so travel stays purple even with the relay on. The Now panel reports intent and actual relay state separately. Unannotated Lua falls back to relay state.
- **dashed in print color** — a path the trace marked `approximate`
  (a joint-interpolated move, whose real tool path bows off the straight
  line drawn between its endpoints)
- **red dot with a seconds label** — the tool is stationary with the
  extrusion relay open

`* ` on the run time means durations rest on assumed machine limits; the
footer says which. Distances, ordering and extrusion state never depend
on them.

## API

```js
import { createTracePlayer } from "./player.mjs";

const player = createTracePlayer(canvas);
player.load(trace);
player.setTimebase("uniform");   // or "machine"
player.setPlaybackRate(4);
player.play();
player.on("frame", ({ sample }) => { /* sample.segment.source is file:line */ });
```

No dependencies and no build step. Everything it computes comes from
`schemas/motion-trace/trace-lib.mjs`, which is also what the checks in
`tests/golden/` call.

## Related

- `schemas/motion-trace/` — the trace format and library
- `machines/reference-dobot-mg400-struderbot/trace/` — the Lua reader
- `examples/verify-export.mjs` — the same checks, as a CLI report
