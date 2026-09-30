---
name: supports
description: Tree branches at placed contacts; placement trades support against surface contact and removal access. Area supports under a footprint are slices with the support preset.
---

# Tree supports

For maker work, read [MAKERS.md](../../MAKERS.md) and use the
[shared print tools](../../core/print/USAGE.md). An area support under a broad,
accessible flat underside is a [slice assignment with the support preset](../slice/SKILL.md#presets);
this skill places explicit tree branches for local contacts. Enable
`skills.supports.enabled` and supply `assignments` before generation. No
hardware is run.

## Choosing the support

Discuss which surfaces need support using the geometry, material, span, printing
direction, desired finish and access for removal. Record a short reason for each
assignment and explain its contact and removal tradeoff to the maker. Do not scan
the whole part and choose areas from an overhang-angle threshold, even when a
tool could: [D-025](../../DECISIONS.md#d-025--support-areas-assigned-through-judgment).
All assignments are part of the locked plan.

## Assignments

Each assignment has exactly `id`, `reason`, `contactZMm` and `treeNodes`.
Each node has exactly `id`, `parent`, `point` and `radiusMm`: XY in millimetres
relative to the print's `placement`, Z above the bed. A root has `parent: null`
and Z 0; every other node names a lower parent, and children share its trunk.
Every terminal tip ends at `contactZMm - topGapMm`; use separate assignments for
different contact heights. Radii are at least one bead width. For a contact at
Z 10 with the default 0.2 mm gap:

```json
[
  {"id":"root", "parent":null, "point":[16,5,0], "radiusMm":2},
  {"id":"fork", "parent":"root", "point":[16,5,6], "radiusMm":1.5},
  {"id":"left-tip", "parent":"fork", "point":[14,4,9.8], "radiusMm":1},
  {"id":"right-tip", "parent":"fork", "point":[18,6,9.8], "radiusMm":1}
]
```

These illustrate coordinates, not an approved support. Judge branch lean,
section overlap between layers, root adhesion, tip coverage and access in the
actual print. Each layer is the union of circles interpolated between nodes and
parents; it is SAAM's own construction, not Bambu's tree algorithm.

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Tree supports on; none are inferred. |
| `assignments` | `[]` | Branch skeletons above. |
| `topGapMm` | `0.2` | Minimum gap below the contact. |
| `xyGapMm` | `0.3` | Clearance to part sections on every layer. |
| `treeChordMm` | `0.02` | Circle polygon tolerance. |

Branches are sliced with the support preset (one loop, 15% rows, two interface
layers at 0.8 density); the last layer is rounded down on the grid and the
summary reports each actual gap. Supports print before every part operation
reaching above them, including nonplanar ones, even with layer batching. They use
the print's material/tool unless [routed elsewhere](../../core/print/USAGE.md#nozzle-selection). A branch meeting the part clearance is reported,
not trimmed or rerouted; supports on the model, curved contacts and automatic
routing are not implemented. No physical validation is claimed.
