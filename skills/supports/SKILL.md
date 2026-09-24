---
name: supports
description: Conventional supports under selected areas, or tree branches at placed contacts; placement trades support against surface contact and removal access.
---

# Assigned supports

For maker work, read [MAKERS.md](../../MAKERS.md). For development, start with the
[builder orientation](../../BUILDERS.md) and follow its task-specific references.
Use the [shared print tools](../../core/print/USAGE.md).
Enable `skills.supports.enabled` and supply `assignments` before toolpath generation.
The same export, final confirmation and delivery workflow applies. No hardware is run.

## Choosing the support

Discuss which surfaces need support using the geometry, material, span, printing
direction, desired finish and access for removal. Record a short reason for each
assignment and explain its contact area and removal tradeoff to the maker.
Do not scan the whole part and choose areas from an overhang-angle threshold.
[D-025](../../DECISIONS.md#d-025--support-areas-assigned-through-judgment) applies
even when a deterministic geometry tool could make that choice automatically.
Local sections may construct/check an already assigned support; they do not
authorize another support area. All assignments are part of the locked plan.

Two initial styles are implemented:

- **Standard:** a bed-rooted vertical footprint, with sparse straight-line fill,
  optional enclosing walls and denser top interface layers. Choose for broad,
  accessible flat undersides. Its footprint may contain holes or separate islands.
- **Tree:** explicitly placed trunks and branches, merged where they overlap,
  ending in circular contact tips. Choose for selected local contacts when branch
  placement and removal access are useful. The agent supplies the skeleton;
  automatic branch routing/merging decisions are not implemented.

Tree geometry consists of linearly interpolated horizontal circular sections
between parent/child nodes, including radius changes. This is an initial SAAM
construction, not Bambu's tree algorithm or a claim of equivalent print quality.
[Bambu Studio](https://github.com/bambulab/BambuStudio) provides normal/tree/custom
support features under AGPL-3.0. SAAM uses its own implementation and manual.

Rimming supports are separate experimental skills:
[rimming-planar](../rimming-planar/SKILL.md) and
[rimming-normal](../rimming-normal/SKILL.md). Use their edge/surface assignments
rather than adding a rimming style to this skill's standard/tree assignments.

## Assignments

Each assignment has exactly `id`, `style`, `reason`, `contactZMm`, `footprint`,
and `treeNodes`. IDs are unique lowercase names. XY values are millimeters
relative to the whole part's `placement`, not to an assembly component; Z is
millimeters above the bed. Changing placement moves all supports with the part.

For standard supports, `footprint` contains CCW outer/island loops and CW holes,
and `treeNodes` is empty. For example, a proposed assignment beneath a selected
flat ledge at Z=10 mm:

```json
{
  "id": "ledge",
  "style": "standard",
  "reason": "Support the selected free end of the ledge.",
  "contactZMm": 10,
  "footprint": [[[12, 2], [20, 2], [20, 8], [12, 8]]],
  "treeNodes": []
}
```

For a tree, `footprint` is empty. Each node has exactly `id`, `parent`, `point`
and `radiusMm`. A root has `parent: null` and Z=0; every other node names a
lower parent. Multiple children share a trunk. All terminal tips in one
assignment end at `contactZMm - topGapMm`. Use separate assignments for different
contact heights. Example skeleton for contact at Z=10 and a 0.2 mm top gap:

```json
[
  {"id":"root", "parent":null, "point":[16,5,0], "radiusMm":2},
  {"id":"fork", "parent":"root", "point":[16,5,6], "radiusMm":1.5},
  {"id":"left-tip", "parent":"fork", "point":[14,4,9.8], "radiusMm":1},
  {"id":"right-tip", "parent":"fork", "point":[18,6,9.8], "radiusMm":1}
]
```

These examples illustrate coordinates, not an approved or physically validated
support. Judge branch lean, section overlap between layers, root adhesion, tip
coverage and accessibility in the actual print. Node radii must be at least one
line width. Supports standing on the model, curved contact surfaces and automatic
obstacle routing are not implemented. A standard footprint must have a clear
vertical route to the bed; revise the assignment or use explicit branches when
the part obstructs it. Generation reports an intersection rather than silently
cutting the support into disconnected pieces.

## Shared settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Enable explicitly assigned supports; no assignments are inferred. |
| `assignments` | `[]` | Standard/tree assignments described above. |
| `density` | `0.15` | Approximate sparse support fill fraction. |
| `interfaceDensity` | `0.8` | Approximate fill fraction of top interface layers. |
| `interfaceLayers` | `2` | Last layers below each selected contact; zero disables the interface. |
| `topGapMm` | `0.2` | Minimum vertical gap below the assigned contact plane. |
| `xyGapMm` | `0.3` | Clearance to part sections at support slice planes. |
| `perimeters` | `1` | Support walls; zero allows only fill. Any whole count from zero up is accepted; more than about eight is rarely useful. |
| `fillAnglesDeg` | `[0, 90]` | Straight fill direction alternated by bed layer. |
| `treeChordMm` | `0.02` | Circle polygon approximation target. |

The last support layer is rounded down on the bed's shared layer grid, so the
actual top gap may exceed the requested minimum by less than one layer. The
generation summary reports each actual gap. Speeds, bead width, layer height,
flow, retraction and cooling use the shared process and selected tool/material.
This initial version uses the same material/tool as the part, not soluble or
multi-extruder supports.

## Composition and verification

`supportResults({plan, shells, modelResults})` returns `{results, dependencyChanges}`
through the existing full-fill producer. It leaves `modelResults` unchanged.
Each dependency change names `operationId`, an ordered `after` list and
`mode: 'append'`. Generation applies the changes with
`applyResultDependencies` from `core/print/generate.mjs` before composing the
returned support results with the updated model results. It consumes the plan already checked
by shared `validatePlan`; standalone developer callers validate their inputs at
that boundary (or with `validateSupports`) before invoking the producer. It does
not repeat settings validation while slicing. Shared Clipper union removes overlap
between assignments. Sparse and interface interiors are complementary; one owner
prints their walls. Supports use whole-plan travel and layer cooling, and required
support layers precede part operations even with layer batching. Supports are
sacrificial material outside `composition.regions`; do not assign them as a
material region of the part. They coexist with regional full-fill, infill, drape
and vase operations without changing those skills' geometry limits.

The part uses shared mesh/spline section queries for clearance comparisons at
support layer planes. Intersections with the requested part clearance produce
an actionable error. These are not full swept-volume/head collision checks or
proof that the contacts, unsupported branch growth, or support removal will work.
Studio displays the assignments in settings and the generated supports in the
exact export's toolpath. Intermediate motion remains transient.

Software coverage includes mesh/spline assemblies, S5/H2D and synthetic configured
Dobot, explicit selection, branch splits, interface gaps, merged assignments,
shared composition and export/review/delivery. Machine-specific experimental
limits still apply. No physical print or Bambu-equivalence validation is claimed.
