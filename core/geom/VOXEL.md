# Volumetric scalar fields

[voxel.mjs](voxel.mjs) represents a scalar field over a bounded, axis-aligned
millimeter domain. Material is the set `value > isoValue` intersected with that
box. A threshold surface supplies the boundary; material can contain holes,
cavities and disconnected components without changing a boundary control net.
The [voxel task](../../skills/voxel-tools/SKILL.md) owns creation and editing tools.

## Representation

`saam-voxel-field/1` stores `originMm`, `sizeMm`, `counts`, `degrees`, `knots`,
`values`, `weights` and `isoValue`. All XYZ arrays have three entries. Controls
use `x + nx * (y + ny * z)`, with X fastest. Domain coordinates map affinely
to normalized spline parameters `[0,1]` in each direction. This is a scalar
field in physical space, not a deformed parametric solid requiring inversion.

Each axis has a full, nondecreasing, clamped knot vector of length
`count + degree + 1`. Degrees 1–3 are supported; interior multiplicity cannot
exceed degree so the field stays continuous. `uniformKnots(count, degree)`
constructs open uniform knots. Values are finite scalars; weights are `null`
for ordinary B-splines or positive finite values for a rational field.

The field is the weighted sum of control values divided by the sum of weights,
using the tensor product of the three B-spline bases. Degree one with uniform
knots and null weights is trilinear interpolation of lattice-node samples.
Higher-degree control coefficients generally are not values at lattice nodes.
They control a smooth field. This distinction prevents accidental smoothing of
an imported voxel grid. Cell-centered occupied cubes, sparse tiles, OpenVDB
import, warped parameter domains and vector/tensor channel storage are not
implemented. The current JSON layout suits bounded prototypes; dense storage
grows as the product of the control counts for schema `/1`.

`saam-voxel-field/2` adds sparse hierarchical refinement. Root `counts` and
`knots` describe the base lattice; `values` and positive `weights` correspond to
`hierarchy.controls`, each `{level,index}` using X-fast indexing in that level.
`hierarchy.levels` contains `{knots,regions}`; regions are normalized `{min,max}`
3D boxes nested inside the preceding level's region union. Level zero covers
the whole domain. Each subsequent level bisects every nonzero knot span, but
only basis functions within its local regions become active. Coarse functions
whose support is fully covered by the next level are replaced with children.
Positive homogeneous weights preserve both numerator and denominator exactly
under refinement. These weighted hierarchical B-splines use no THB truncation.
Validation checks nested dyadic knots, active support completeness, coefficient
sizes and positive weights. Limits are six levels, 100 regions per level,
100,000 active controls and a million traversed basis functions for validation.

A complete constant-filled 12 × 12 × 2 mm request is:

```json
{
  "field": {
    "schema": "saam-voxel-field/1",
    "originMm": [0, 0, 0],
    "sizeMm": [12, 12, 2],
    "counts": [2, 2, 2],
    "degrees": [1, 1, 1],
    "knots": [[0, 0, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1]],
    "values": [1, 1, 1, 1, 1, 1, 1, 1],
    "weights": null,
    "isoValue": 0.5
  },
  "extraction": {"edgeMm": 1, "maxEvaluations": 2000000}
}
```

`createVoxelEvaluator(field)` owns an independent snapshot and returns an
evaluator for XYZ millimeters. Queries outside the domain return `null`.
`{derivatives: true}` returns the physical gradient in scalar units/mm;
`{influences: true}` returns each local control index and its rational basis
weight, the derivative with respect to that control value with fixed spline
weights. Knot/weight derivatives are not exposed. The evaluator reuses the
shared NURBS basis algorithms A2.2/A2.3 in [nurbs.mjs](nurbs.mjs).

## Extraction, slicing and identity

[voxel-compile.mjs](voxel-compile.mjs) uses pinned `manifold-3d@3.5.3` through
the [shared solid runtime](solid.mjs). Its level-set extraction uses upstream
body-centered-cubic marching tetrahedra, preserving its topology construction.
SAAM supplies `value - isoValue`, positive inside. Scalar values are not assumed
to be signed distances. Extraction uses upstream linear crossing interpolation
(`tolerance: -1`); no signed-distance error guarantee is claimed for this field.
See the [upstream API](https://manifoldcad.org/docs/jsuser/classes/Manifold.html#levelset).

The field is extended by clamping evaluation coordinates into the domain.
Extraction runs in a padded box, with its lattice shifted by fixed fractions
`[0.173,0.317,0.419] * edgeMm` away from coincident clipping planes. The solid intersects
the exact design box. This removes upstream grid closure surfaces from domain
faces and produces planar domain caps, including a bed-flush base. Domain
clipping is part of the shape definition, not an inferred printable modification.
Compiler `level-set-linear/2` also exports position residuals in property channels
to retain precision beyond Float32 coordinates and honors the kernel's explicit
seam merge indices. It does not weld by proximity. Stored `/1` compiler records
remain readable; explicit rebuilding uses `/2`.

`edgeMm` controls extraction grid/triangle scale in millimeters. It is neither
a certified surface deviation nor a minimum printable feature guarantee.
Thin components and topology below the sampling scale can be missed. Assess
convergence by rebuilding at smaller values. `maxEvaluations` bounds callback
work; a lower-bound grid-size estimate rejects oversized work before allocation.
Existing mesh vertex, triangle and intersection-check budgets also apply.
Empty extraction fails explicitly. No automatic repair or detail reduction runs.
`previewVoxel` performs the same extraction without the manufacturing mesh
checker, solely for asynchronous simulation display. `compileVoxel` always runs
that checker; display output is never used as an authorization to manufacture.

The result is a `shape: "voxel"` geometry record containing the original field,
extraction settings and compiler identity, checked indexed triangles, and a
content digest. [voxel-record.mjs](voxel-record.mjs) owns validation. Compilation
is explicit at creation/edit time. Reopening checks stored identity and mesh
validity without re-extracting unchanged data. A digest detects a changed
record; it is not proof of equivalence to the continuous field or authenticity.

The native `model.mesh.json` retains the complete record. Geometry review,
planar sections, roof queries and Studio all consume its manufacturing mesh.
This is an additional source geometry type behind the existing mesh query
backend, not direct continuous-field sectioning. Spline sources keep their
existing native slicing. Voxel components can join mixed assemblies and material
regions through the common interfaces. Other mesh skills retain their limits;
for example, an arbitrary topology does not imply an accessible roof for drape.

## Local refinement and field consumers

[voxel-refine.mjs](voxel-refine.mjs) inserts knots exactly in homogeneous form,
preserving scalar values and gradients, including rational weights. This adds
design freedom without changing the current field. Those tensor-product
insertions extend across planes. [voxel-hierarchy.mjs](voxel-hierarchy.mjs)
instead refines a bounded 3D support region and stores only active coefficients
in schema `/2`.

The field foundation supplies a bounded design
domain, editable controls, scalar evaluation, spatial gradients, local control
sensitivities and deterministic stored input/output identities. A solver can
evaluate the field on its own analysis grid; analysis resolution, control spacing
and manufacturing extraction resolution are separate choices.

Physical analysis and optimization are separate consumers of the geometry.
Shared SAAM does not provide a structural solver. Scalar values are geometric
coefficients, not effective material properties or printing infill settings.

Tensor-product B-spline density representations have published topology
optimization precedent ([Qian, topology optimization in B-spline space](https://cdm.me.wisc.edu/pub/BtopCMAME13.pdf)).
Adaptive B-spline level sets also support optimization; the authors distinguish
smoothness from explicit feature control ([Noël et al.](https://arxiv.org/abs/1909.10607)).
[OpenVDB](https://www.openvdb.org/) is a potential sparse volumetric storage
backend, separate from the choice of field interpolation. No external format
compatibility is claimed by this implementation.

## Verification scope

[voxel tests](../tests/voxel.test.mjs) cover affine and quadratic reference fields,
physical derivatives, rational sensitivities, knot validation, section-area
convergence, clipping, holes/islands, mixed assembly slicing and native identity,
approval invalidation and exact-byte delivery. The
[MCP tests](../tests/mcp.test.mjs) cover discovery and create/edit access.
[DEVLOG](../../DEVLOG.md) records performed checks and preview observations.
These are software checks; no physical optimization or print is validated.
