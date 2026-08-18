# Non-Planar Cladding

A genuinely spatial operation: within a single pass, X, Y, *and* Z change
together, following a heightfield rather than stacking flat layers. This is
what separates SAAM's additive-3d family from a conventional slicer, which
never moves Z except between discrete layers.

This operation deposits the **skin only**. It does not generate the
structure beneath it — it takes that structure's footprint and the Z
height it already reaches (`baseZ`) as given inputs. See
`manifest.json` &rarr; `dependencyNotes` for why: a plan composes this
with a separate scaffold-producing operation (`layer-filling`, run with a
wide sparse spacing) rather than duplicating scaffold logic here. Keeping
"known structure" and "coordinated skin" as two operations, connected
through the process plan's `dependencies`, is what lets either one be
swapped independently later.

## Surfaces

- **`single_slope`** — height rises linearly along Y. Each pass needs only
  its two endpoints; no curvature to sample.
- **`dome`** — height falls off from center by `1 - (x/halfWidth)² -
  (y/halfDepth)²`, clamped at zero, so a dome never dips below `baseZ` at
  its footprint edges.
- **`saddle`** — height varies with `(x/halfWidth)² - (y/halfDepth)²`,
  rising along X and falling along Y from the center.

`dome` and `saddle` sample 20 points across each pass to represent their
curvature; `single_slope` needs none.

## Coverage pattern

Passes run parallel to Y, spaced by `settings.spacing` across the
footprint's X extent, alternating Y direction each pass (a boustrophedon
sweep) so the whole footprint is covered by one connected back-and-forth
path rather than many disconnected segments.

## Inputs, outputs, and evidence

See `manifest.json`. `rise` can be given directly, or derived from
`angle` (degrees) over the footprint's `depth`. `generator.mjs` has no
dependencies and is deterministic — see `../../../../tests/golden/` for
the fixture this is checked against.

Its `maturity` is `experimental`; see
`../../../../docs/authoring/evidence-labels.md`.
