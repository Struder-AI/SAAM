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

There is no layer control. The scrub bar is deposition order, which is
also the drawing order, so material appears when it was extruded. A
toolpath here may spiral, clad a slope, or double back.

## Reading the view

Extruding moves are coloured by speed relative to the slowest printing
move, on a log scale. Under a constant-rate extruder the bead
cross-section goes as `A = Q / v`, so a part meant to be uniform should
come out one colour.

- **dashed** — a travel move, or a path the trace marked `approximate`
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
