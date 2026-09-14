---
name: mesh-tools
description: Diagnose rejected meshes or perform requested STL cleanup and solid reconstruction so usable geometry can return to import and review. Preserves the original for comparison; reconstruction can change small features and requires closed, consistently oriented input.
metadata:
  saam-kind: task
---

# Mesh tools

Use the load diagnostic or requested geometry change to choose the operation.
This manual owns mesh-processing choices and tool use. The resulting geometry
returns to the [shared import and review workflow](../../core/print/USAGE.md);
mesh processing is a preparation task, separate from a plan's deposition skills.

## Diagnose a rejected mesh

Preserve the original diagnostic: different failures call for different work.

| Finding | Useful next step |
|---|---|
| Invalid STL structure, missing coordinates or malformed triangle indices | Obtain a complete export or correct the source geometry. Reconstruction needs readable triangles. |
| Degenerate or duplicate facets | The repair entry performs exact cleanup before considering reconstruction. |
| Intersecting closed shells or folds within a consistently oriented closed shell | Assess solid reconstruction, including intended cavities and the feature sizes that must survive. |
| Open boundaries, inconsistent winding or nonmanifold edge incidence | Resolve the intended solid in the source model or an appropriate authoring tool. The current reconstruction requires unambiguous closed, oriented surfaces. |
| Triangle or computation limit | Review the requested detail and available processing budget. Reconstruction can simplify its output, but may alter small features. |

A failed check identifies a problem; it does not establish which geometric change
the maker intends. Explain the material effect of a proposed repair and use the
person's requested outcome to settle consequential choices. For a saved native
mesh, use its retained STL source when available; the current processing command
accepts STL bytes. Native indexing errors may instead need correction by the
geometry producer.

## Cleanup and reconstruction

From the repository root:

```text
node core/print/cli.mjs repair-stl <new-repair-directory> <source.stl> <mm|inch> <resolution-mm> [options.json]
```

The destination must be new and its parent must exist. The command retains the
source and writes three files after successful validation:

- `original.stl`: unchanged input bytes.
- `repaired.stl`: output in millimeters.
- `repair.json`: source/output hashes, bounds, processing results, sampled
  distances and validation evidence.

Exact cleanup removes duplicate/degenerate facets and unused vertices. If that
geometry passes validation, it is returned without resampling. Otherwise the
command reconstructs material on a grid and simplifies the reconstructed surface
when it exceeds the selected triangle target. Simplification is part of this
reconstruction path; there is no separate simplification command yet.

Choose resolution from the features, gaps and wall thicknesses that matter to
the part. Grid spacing controls reconstruction detail and cost; it is not a
guaranteed surface-error bound. Small features can disappear and nearby surfaces
can join. Finer grids consume more memory and time.

The optional JSON file accepts:

| Option | Meaning |
|---|---|
| `fillRule` | `nonzero` (default) treats any nonzero winding as material; `evenodd` makes even overlaps empty. Select the interpretation that matches the intended solid. Oppositely wound surfaces can express cavities or cancel. |
| `maxGridPoints` | Grid budget: 16,000,000 by default, up to 64,000,000. |
| `maxOutputTriangles` | Reconstruction budget before simplification: 2,000,000 by default and at most. |
| `targetTriangles` | Simplification target for reconstructed output: 80,000 by default; accepted range 4–100,000. |
| `maxPlaneErrorMm` | Simplification's accumulated plane-residual limit: 0.05 mm by default. This is not a bound on maximum surface displacement. |

An exhausted budget or failed final validation produces no repaired STL.
Reconsider the reported constraint and relevant settings before another attempt.
The command reports stage progress on stderr and its final report on stdout.

## Inspect and return to the print workflow

Compare input/output bounds and the repair report with the intended shape.
`sampledDistanceMm` contains vertex-distance samples in both directions, including
source surfaces removed inside overlaps. These samples help locate changes but
do not certify the complete surface or topology.

Import `repaired.stl` with units **mm** using the [shared import tool](../../core/print/USAGE.md).
Show the resulting geometry and consequential changes for the maker's review.
Repair and successful import create no approvals. The selected printing pattern's
shape limits still apply to the repaired geometry.

With MCP-only access, `read_skill` can retrieve this manual and `import_stl_print`
can import an available result. Repair currently runs through the local CLI;
the connector has no repair tool. Arrange local execution when repair is needed.

## Implementation

[The repair entry](../../core/print/repair-stl.mjs) owns the operation and artifacts;
[the geometry reference](../../core/geom/README.md#explicit-mesh-repair) owns
reconstruction, predicates and numerical assumptions. Add supported mesh operations
to this task package as the tooling develops, with their actual inputs, outputs
and limits.
