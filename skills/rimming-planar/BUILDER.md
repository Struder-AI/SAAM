# Rimming design

Shared construction contract for [planar](SKILL.md) and
[normal](../rimming-normal/SKILL.md) rimming. Read the selected manual for its
implemented limits.

## Rimming support specification

[Rimming-planar](SKILL.md) and [rimming-normal](../rimming-normal/SKILL.md)
implement this specification within their manuals' limits. The
[development record](../../DEVLOG.md#br-032--infill-choices-and-judgment-assigned-supports)
preserves the request and ordering clarifications.
A rimming support applies to a selected edge or edge portion. Its reference
geometry is a bivariate spline surface: the top boundary matches the supported
edge, the base boundary rests on the bed or on another selected edge, and side
boundaries complete the surface. Top and base edges may curve; a slightly curved
base is generally preferred for strength. The base may lean away to avoid other
part geometry. Staying less than roughly 45 degrees from vertical is guidance,
not a numerical gate or check.

Two extrusion paths lie 0.5 and 1.5 line widths outward from the reference
surface, away from the part. For 0.4 mm beads this makes an approximately
0.8 mm solid wall with its inner material boundary on the reference surface,
sharing the exact supported edge. Do not silently apply conventional support's
top separation gap. The user describes supported edges as bridge anchors: a
vertical barbell can use an edge of its lower end as the base of a rim reaching
the lower edge of its upper end, enabling a bridge across that upper end.
This is the requested process behavior, not physical validation.

The two skills expose separate offset metrics for comparison. The shared
`core/geom/support-surface.mjs` authors an open, nonrational, uniform-clamped
bivariate spline and uses existing native sectioning. `core/region/section-offset.mjs`
offsets its sections horizontally or along the full normal with adaptive chord
refinement. This extends shared ambient section offsets; it is distinct from the
existing intrinsic/geodesic region offset on a surface. The current control net
must rise strictly in V for the section refinement's bracketed height solves.
No lean-angle threshold is imposed.

A reference slice means a horizontal intersection curve on the original
unoffset surface; it is not a separate geometry object. The implementation uses
these curves as its starting family. Normal offsets can alter Z. Whole-edge
dependencies apply to both skills: every part of the base edge
prints before any rim starts; the whole rim finishes before anything it supports
starts. Among ready operations, keep heights similar across all mixed skills.
Horizontal boundaries are the degenerate case of these same rules. The shared
composer prefers lower maximum actual deposition Z, respecting dependencies and
selected batches. The rimming producer conservatively binds base operations
crossing the base control edge's height range and all named supported-component
operations; see the manual for single-part binding and atomic-operation limits.
Within each rim, inner/outer pairs retain increasing original section height.
This does not split continuous operations or optimize intra-rim path families.
Height shifts are reported, not silently repaired. Reference edges are assigned by the agent;
arbitrary CAD edge matching, continuous top trimming, self-intersection cleanup
and a proof of physical contact/clearance remain unimplemented. Edge assignment
stays judgment-based under D-025, with final settings/toolpath confirmation.
