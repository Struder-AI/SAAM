# Gusset fin

A triangular reinforcing rib in the corner between a vertical wall and the
face it stands on — the brace between a flange plate and the boss that
rises out of it, for instance.

## Why the layers are stacked the way they are

The obvious way to build a gusset is in ordinary constant-Z layers. That
puts the triangle on its base: the very first layer is the fin's whole
footprint, every layer after it is shorter, and the sloped face is a
staircase of overhangs.

This operation stacks layers along the perpendicular from the corner to
the hypotenuse instead. The first layer is a short segment right in the
corner, each one after it is a little longer, and the **final layer is the
hypotenuse itself, laid down in a single straight pass**. The triangle
stands on its tip, in the print's own frame of reference, and the long
sloped edge — the visible one — is one unbroken bead rather than a series
of pass ends.

The layers are still planar. The plane is just freely oriented rather than
horizontal, which means every pass changes Z continuously along its own
length. That is why this operation requires `coordinated-xyz-motion` and
sits under `3d/` rather than `planar/`.

## Frame of reference

Each fin is one continuous extrusion run. `Fin connection` paths join
consecutive strokes along the base or wall face, and the thickness sweep
reverses on successive layers so it never resets across the full width.
These connections are print geometry, not a distance-based travel filter.
Enabling `travelHopHeight` introduces no travel inside a fin; the plan still
uses travel to enter a fin and to move between separate fins.

The operation generates in its own frame, and knows nothing about where it
ends up:

- the origin is the corner — where the wall face meets the base face
- `+X` runs out along the base, for `length`
- `+Z` runs up the wall, for `height`
- `Y` is `thickness`, centered on zero

Placing the fin is the plan's job, via the `at` field on the operation
invocation (see `schemas/process-plan/process-plan.schema.json`). Five
identical fins around a boss are five invocations of this operation that
differ only by their `at`.

## Seating a straight fin against a curved wall

The fin's inner edge is a straight chord, but a boss or pipe wall is
round. At the thicknesses a gusset is normally printed at, the error is
small enough to ignore geometrically — but it is not zero, and the plan
should seat the fin on the **best-fit chord** rather than the nominal
radius, or the fin's corners stand slightly proud of the wall.

For wall radius `R` and fin thickness `T`, the chord sits at most

```
sagitta = R - sqrt(R^2 - (T/2)^2)
```

inside the surface at its center. Placing the fin's origin `sagitta / 2`
outside the nominal radius splits that error evenly: the middle of the
fin's back face sits that far proud, and its two corners that far shy,
instead of the whole error landing on one side. At `R = 25.5`, `T = 3.3`
that is about 0.03 mm — well under a bead, which is exactly why the
simplification holds.

## Known limitations

- **The steep-lean warning is a guideline, not a measurement.** When
  `height` exceeds `length` the build direction tips past 45 degrees from
  vertical and the operation warns. That threshold is the general FDM
  unsupported-overhang rule of thumb, not evidence from this project's
  hardware.
- **`coordinated-xyz-motion` is itself only EXPERIMENTAL on the reference
  Dobot machine**, whose manifest records a known problem with
  layer-boundary transitions producing pauses and blobs on long continuous
  runs. A fin is exactly a stack of short passes with a transition between
  each, so that concern applies here directly. This operation does not
  solve it.
- **No fillet where the fin meets the wall or base.** The corner is
  modelled as a clean right angle.
