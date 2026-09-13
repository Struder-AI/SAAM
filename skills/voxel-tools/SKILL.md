---
name: voxel-tools
description: Create and edit volumetric parts from scalar voxel samples or smooth B-spline control lattices. Extract at an explicit resolution for shared planar slicing and Studio review; no optimization or physical solver is included.
metadata:
  saam-kind: task
---

# Volumetric geometry

Use this task for a scalar value throughout a bounded 3D design space. Material
occupies values above `isoValue`, clipped to the design box. Degree-one fields
interpolate node samples; higher-degree B-spline fields use control coefficients.
These are smooth implicit solids, not a collection of occupied cube primitives.

Read [MAKERS](../../MAKERS.md) for part-making and
[DEVELOP](../../DEVELOP.md) for development. The
[field contract](../../core/geom/VOXEL.md) owns coordinates, interpolation,
derivatives and extraction limits. Explain dimensions, threshold and extraction
resolution as proposed geometry choices before review. The threshold changes the
shape; it does not select printing infill density or establish physical porosity.

## Create and edit

The request contains `field` and `extraction: {edgeMm, maxEvaluations?}`.
`edgeMm` is required. `maxEvaluations` defaults to 2000000 and can be increased
explicitly. The field contract includes a complete constant-field JSON example.

```sh
node core/print/cli.mjs voxel-create Prints/my-volume voxel-request.json ultimaker-s5
node studio/server.mjs Prints/my-volume
node core/print/cli.mjs voxel-update Prints/my-volume voxel-request.json --revision CURRENT_REVISION
```

The agent prepares the JSON; the person describes their changes in conversation.
Updates replace the complete field and extraction settings. Obtain the revision
from `shell check` or MCP `get_print`. Existing printing settings and placement
persist through updates. Creation proposes solid planar full-fill, disables
draped skin, and places the domain's XY origin at (20,20) mm. Z is preserved;
choose a domain and material boundary that start on the intended build surface.

MCP `voxel` takes `printId`, `action: "create" | "update"` and `request`.
Creation requires `machineId`; updating requires `expectedRevision`, with
optional `part` for an existing voxel assembly component. Both use the shared
print lifecycle. Use `request_review` to open Studio afterward.

Creation and updates compile the field into a checked manufacturing mesh and
retain both in the native geometry asset. Editing a compiled record's field or
mesh directly fails its integrity check. Use these tools to rebuild. All geometry
changes invalidate the three approvals. Ordinary [shared tools](../../core/print/USAGE.md)
handle settings, checking, generation and delivery. Use [full-fill](../full-fill/SKILL.md)
for a solid body or [planar-infill](../planar-infill/SKILL.md) for patterned interiors.
The printing skills consume the extracted mesh; they do not interpret density
values as extrusion rates. Other mesh consumers retain their existing limits.

## Development example

```sh
node skills/voxel-tools/scripts/demo.mjs Prints/voxel-field-demo
node studio/server.mjs Prints/voxel-field-demo
```

The example builds a 24 × 24 × 4.8 mm design domain containing a smooth ring
with a lobed through-hole, using a cubic XY control lattice and linear Z.
Extraction uses `edgeMm: 0.6`. The shape is illustrative, not an optimized result.
It creates an unapproved development export through shared full-fill and the S5
interpreter. It does not supply synthetic approvals or execute a machine.

Inspect outer contours, the hole, layer coverage and travel in Studio. Decrease
`edgeMm` and rebuild when needed to assess convergence. Smaller sampling distance
does not certify that all thin features are present. Empty extraction reports an
error instead of creating a printable empty part. Existing mesh complexity limits
apply. No solver, manufacturing feature filter or physical validation is included.
