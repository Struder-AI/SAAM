---
name: rimming-normal
description: Experiment with two-bead rimming supports offset along the full 3D normal of an assigned bivariate spline surface. Compare against rimming-planar on the same reference surface; motion can be nonplanar.
---

# Rimming with surface-normal offsets

This is the experimental comparison requested by the user. Read the
[rimming-planar manual](../rimming-planar/SKILL.md) for edge selection, exact
surface fields, sampling settings, base-on-edge behavior, tools and shared limits.
Use the same surface/control net and process, but enable `skills.rimming-normal`
instead of `skills.rimming-planar` in a separate print bundle.

The only geometric difference is the offset vector: the two curves are at
0.5 and 1.5 line widths **along the full 3D surface normal**, with the assigned
outward sign. The source curves are still sections of the reference surface at
the shared layer heights. Offsetting their points can change both XY and Z,
creating nonplanar printing paths. The tool refines the actual offset curves
through the same shared native spline evaluation and section-offset function.

The whole-base and whole-rim dependencies in the planar manual apply here too:
all of the base edge prints before this rim starts, and this rim finishes before
any supported feature starts. The composer compares actual path heights across
ready skills; an original horizontal section is only a construction curve and
does not override those dependencies. Within the rim, the current paired paths
still follow increasing original section height.

A vertical reference wall gives the same centerlines as rimming-planar. An
inclined wall changes path heights and horizontal spacing. In particular, the
first paths may be higher/lower than the horizontal version and the final paths
may extend above/below the assigned edge. The generation summary reports minimum
and maximum Z shift and printed top height. **No automatic bed clipping, top
trimming, interface gap or endpoint correction is applied.** The same nominal
reference-layer bead-volume model is retained for the comparison, so this is
not a claim of a physically solid 0.8 mm wall under all inclinations. Inspect
first-layer contact, spacing between beads/layers, and edge anchorage before
choosing a physical experiment. Actual below-bed/out-of-bounds moves still fail
the shared machine checks.

Support assignment stays judgment-based under
[D-025](../../DECISIONS.md#d-025--support-areas-assigned-through-judgment).
Prefer less than roughly 45 degrees of lean from vertical when convenient;
there is no lean-angle gate. The selected machine must declare nonplanar XYZ
deposition. That capability is not measured head clearance. The S5/H2D and
configured Dobot software exports use the same composer and reviewed machine
source as every other skill; normal offsets do not add a pipeline or approval.

Use [MAKERS.md](../../MAKERS.md) for maker work and
[DEVELOP.md](../../DEVELOP.md) for development. The public callable is
`rimmingNormalResults({plan, modelResults})` in `scripts/rimming.mjs`, delegating
to the shared rimming producer. The paired tests live in
[rimming.test.mjs](../rimming-planar/tests/rimming.test.mjs). They compare offsets,
curve refinement, barbell ordering and machine round trips. Physical comparison
printing remains to be performed by the maker through the existing approvals.
