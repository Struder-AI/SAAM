# Dobot Lua trace reader

Reads DobotStudio Pro Lua back into a machine-neutral
[motion trace](../../../schemas/motion-trace/motion-trace.schema.json).
The inverse of [`../postprocessor/`](../postprocessor/), and bound by the
same rule from the other side: it reads or rejects, never repairs.

```js
import { readDobotLua } from "./reader.mjs";

const trace = readDobotLua({ files, instanceProfile });
```

`files` is the map the post-processor's `translate()` returns —
`global.lua`, `src0.lua`, `src1.lua`. For a CLI report over the same
data, use `node examples/verify-export.mjs`.

## Arguments

| | |
|---|---|
| `files` | the program, keyed by filename |
| `entry` | global function to run, default `RunPlan` |
| `instanceProfile` | same profile the post-processor takes; supplies the extrusion relay port |
| `extrusionOutput` | the relay port directly, overriding the profile |
| `kinematics` | real machine limits, replacing `ASSUMED_KINEMATICS` |
| `origin` | where the tool starts, default `0,0,0` |

## It executes the Lua

`J()` and `L()` are a project convention defined in `global.lua`, not
machine primitives, so `lua-subset.mjs` runs the program with the
controller primitives (`MovL`, `MovJ`, `Arc3`, `Circle3`, `DO`, `Wait`,
`Sync`) as host bindings rather than matching call sites by name.

It is a subset and refuses rather than guesses: unimplemented syntax, or
a call to a function nobody defined, raises an error naming the file and
line. A runaway loop hits a step limit and fails instead of hanging.

## What it cannot determine on its own

**Which output means extruding.** Pass `extrusionOutput` or an
`instanceProfile`. With neither, it infers: exactly one digital output
driven both high and low is taken as the extrusion window; two or none
and it reports the ambiguity rather than picking. Every `DO` call is
recorded either way. `source.extrusionOutputDeterminedBy` says which
happened.

**How fast a percentage is.** DobotStudio expresses `SpeedL`/`AccL` as a
percentage of a configured maximum, and
[`machine-manifest.schema.json`](../../../schemas/manifests/machine-manifest.schema.json)
has no velocity or acceleration fields. `ASSUMED_KINEMATICS` declares
limits instead; every trace carries `kinematics.assumed`. Pass measured
values via `kinematics` to clear it. Distances, ordering and extrusion
state don't depend on them.

## Known limitations

- `MovJ` interpolates in joint space, so the real tool path bows off the
  straight line between its endpoints. MG400 kinematics aren't modelled;
  those segments are recorded straight, marked `pathFidelity:
  "approximate"`, and counted in `totals.approximateSegments`.
- Moves are timed rest-to-rest under a trapezoidal profile, because the
  generated programs pass no `CP` parameter. A program that used `CP`
  would be timed pessimistically.

## Segment provenance

`source` is the call in the plan body (e.g. `src1.lua:14`). `emittedBy`
is the primitive it bottomed out at, usually inside a helper in
`global.lua`.

## Reading the current export back

`tests/golden/dobot-lua-trace.test.mjs` traces the committed golden
fixture and records three defects in the post-processor as they stand
today, so the suite stays green while they're documented. Each fails when
the generator is fixed — invert the assertion then, don't delete the
test.

- Every printing move after the first is emitted through `J()`, the
  travel helper, at 100% against the 1% print speed. Geometry is
  unaffected.
- `PenOn()` dwells 4 s with the relay open after descending to the first
  print point.
- No move carries `CP`, so the tool stops at every waypoint.

The blob behaviour in [`../manifest.json`](../manifest.json) is
attributed there to the source project's last iteration, before this
post-processor existed. These findings are about the current code and are
not evidence for that report.
