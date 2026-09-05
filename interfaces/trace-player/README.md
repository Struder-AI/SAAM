# Trace player

Replays a motion trace — what a machine was told to do — so a human can
watch it before the machine runs it. A crash, a run at the wrong speed, or
a purge landing on the part are all cheap to catch here and expensive to
discover on the robot.

```bash
npm run build-preview -- preview.html   # one self-contained file, open it anywhere
```

The build inlines the trace library, the Lua reader and the player into a
single HTML file with no external requests. Drop your own `global.lua` and
`src1.lua` onto that page and it reads them in your browser, using the same
reader the test suite runs.

## Two clocks, and why

**Machine time** is real elapsed time. It is what you watch to judge
dynamics: where the tool stalls, how long a dwell lasts, how much of a run
goes into decelerating in and out of waypoints.

**Constant speed** advances a fixed distance per second instead. A program
with a hundredfold speed range spends nearly all its machine time on a
handful of moves and flashes through everything else, which makes the
*shape* of the path hard to read. This clock gives every millimetre equal
screen time.

Neither is the true view — they answer different questions. The real
machine duration stays on screen in both, because losing it is the obvious
way to mislead someone with this view.

## What it does not assume

**There are no layers.** Not a layer slider, not a height grouping, not a
z-sort. A SAAM toolpath may spiral, clad a slope, or double back on itself;
what it always has is a coherent order of deposition. That order is the
scrub bar, and it is also the drawing order, so material appears when it
was extruded rather than when it reaches a given height.

**It does not claim precision it lacks.** Segments the reader marked
`approximate` — a joint-interpolated `MovJ`, whose real tool path bows away
from the straight line between its endpoints — are drawn dashed and counted
separately. Stationary extrusion is marked and labelled with its duration
rather than drawn as a sized pool, because sizing a real deposit needs a
volumetric rate and a trace does not carry one.

**Durations may rest on assumed limits.** Where a machine commands speed as
a percentage of its maximum, turning that into seconds needs the maximum.
When the reader had to declare one rather than read it from a manifest, the
trace says so and the page repeats it. Distances, ordering and extrusion
state never depend on those numbers.

## Colour

Extruding moves are coloured by speed relative to the slowest printing move
in the program, on a log scale. The slowest is taken as the intended print
speed because under a constant-rate extruder the deposited cross-section
goes as `A = Q / v`: the slow moves are the ones laying a full bead, and
anything much faster is laying proportionally less material over the same
distance. A part meant to be uniform should therefore be one colour, and a
program that comes out two colours is describing a part nobody asked for.

## Using the player directly

```js
import { createTracePlayer } from "./player.mjs";

const player = createTracePlayer(canvas);
player.load(trace);
player.setTimebase("uniform");   // or "machine"
player.setPlaybackRate(4);
player.play();
player.on("frame", ({ sample }) => { /* sample.segment.source is file:line */ });
```

No dependencies, no framework, no build step. `player.mjs` draws to a plain
canvas and everything it computes comes from
[`schemas/motion-trace/trace-lib.mjs`](../../schemas/motion-trace/trace-lib.mjs),
which is also what the checks in `tests/golden/` call — a preview that
disagreed with the tests gating it would be worse than no preview.

## Related

- [`schemas/motion-trace/`](../../schemas/motion-trace/) — the trace format and library
- [`machines/reference-dobot-mg400-struderbot/trace/`](../../machines/reference-dobot-mg400-struderbot/trace/) — the Lua reader
