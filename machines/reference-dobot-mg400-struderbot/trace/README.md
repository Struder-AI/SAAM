# Dobot Lua trace reader

Reads DobotStudio Pro Lua back into a machine-neutral
[motion trace](../../../schemas/motion-trace/motion-trace.schema.json).

This is the inverse of [`../postprocessor/`](../postprocessor/) and obeys
the same rule: it is the only layer allowed to know anything about this
machine, and it reads or refuses — never repairs. A G-code reader for
another machine would emit the same trace shape, so one previewer and one
set of checks serve both.

```js
import { readDobotLua } from "./reader.mjs";

const trace = readDobotLua({ files, instanceProfile });
```

## It executes the Lua

`J()` and `L()` are a project convention defined in `global.lua`, not
machine primitives. A reader that greps for `J(` has to assume what `J`
means — and would inherit whatever assumption the *generator* made about
it, which is precisely the class of bug a previewer exists to catch. So
`lua-subset.mjs` runs the program instead, with the controller primitives
(`MovL`, `MovJ`, `Arc3`, `Circle3`, `DO`, `Wait`, `Sync`) as its host
bindings. Helpers resolve the way the controller would resolve them.

It is a subset, deliberately, and it **refuses rather than guesses**: any
syntax it does not implement, and any call to a function nobody defined,
raises an error naming the file and line. A preview is never quietly wrong
about what the machine was told to do. The step limit exists for the same
reason — a runaway loop fails loudly instead of hanging the UI.

## Two things it cannot know on its own

**Which output means "extruding."** Pass `extrusionOutput`, or an
`instanceProfile` (the same one the post-processor takes). Failing both, it
infers: if exactly one digital output is driven both high and low across
the program, that is the extrusion window. Two candidates or none, and it
reports the ambiguity rather than picking. Every `DO` call is recorded
either way, so nothing is dropped.

**How fast a percentage is.** DobotStudio expresses `SpeedL`/`AccL` as a
percentage of a configured maximum, and
[`schemas/manifests/machine-manifest.schema.json`](../../../schemas/manifests/machine-manifest.schema.json)
has no velocity or acceleration fields — `modelConstraints` stops at reach
and payload. `ASSUMED_KINEMATICS` therefore declares limits rather than
reading them, every trace records `kinematics.assumed`, and durations are
indicative until real numbers are measured and passed in. Distances,
ordering and extrusion state do not depend on them at all.

**Known limitation:** `MovJ` interpolates in joint space, so the real tool
path bows away from the straight line between its endpoints. Modelling
MG400 kinematics is out of scope, so those segments are recorded straight
and marked `pathFidelity: "approximate"`, counted in
`totals.approximateSegments`, and drawn dashed. The alternative — drawing
them as if they were measured — is the one thing a previewer must not do.

## Motion model

Moves are timed rest-to-rest under a symmetric trapezoidal profile, because
the generated programs pass no `CP` (continuous-path) parameter and a
controller without one decelerates to zero at every waypoint. That is why a
path of many short segments takes far longer than its length suggests, and
— with a constant-rate extruder running — why it deposits more material per
millimetre near each waypoint. The profile itself lives in
[`trace-lib.mjs`](../../../schemas/motion-trace/trace-lib.mjs) so the
reader, the player and the tests all use one implementation.

Segments carry `source` (the call in the plan body, e.g. `src1.lua:14`) and
`emittedBy` (the primitive it bottomed out at, often inside a helper in
`global.lua`). Conflating the two would make every move in a program appear
to come from the same line.

## What the current export looks like when you read it back

`tests/golden/dobot-lua-trace.test.mjs` traces the committed golden fixture
and records three defects in the reference post-processor, asserted as they
stand today so they are documented rather than forgotten. Each will fail
when the generator is fixed; invert the assertion then, do not delete the
test.

- Every printing move after the first is emitted through `J()`, the travel
  helper, at 100% speed against the 1% print speed — a 100x range inside
  one extrusion window. Geometry is unaffected, which is why a geometric
  round-trip check cannot see it.
- `PenOn()` dwells 4 s with the relay open after descending to the first
  print point, so the pressure purge lands on the part.
- No move carries `CP`, so the tool comes to a full stop at every waypoint
  while material keeps flowing.

The blob behaviour described in [`../manifest.json`](../manifest.json) is
attributed there to the source project's last iteration, before this
post-processor existed. These findings are about the code as it stands now;
they are consistent with that report but are not evidence for it.
