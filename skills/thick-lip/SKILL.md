---
name: thick-lip
description: A vase wall's top edge thickened into a rigid, optionally rolled rim.
---

# Thick lip

Thicken the terminal boundary of an existing [sleeve](../vase-wall/SKILL.md).
The source must be on the same part and have `endTransition: "level"`.
A raw rising spiral does not supply the required closed terminal boundary.

## Use

Add a rim record to `plan.slices.assignments`:

```json
{"id": "lip", "construction": "rim", "part": null, "filament": null,
 "process": null, "after": [], "source": "wall", "steps": [2, 3, 2], "minFeatureMm": 0.4}
```

The source provides its boundary, bead width and operation prerequisites. The
rim process provides added-loop spacing and layer height. With experimental
[substrate adaptation](../../GLOSSARY.md) off (default), the nominal terminal
section and declared layer gap determine the courses. When
`experimental.substrateAdaptation: true`, finalized source beads reconstruct a
modified terminal boundary and each course follows actual local contact,
including preceding rim courses. Missing contact or a disconnected terminal
boundary rejects that experimental construction; this does not create Supports.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `source` | Required | Source sleeve assignment ID. |
| `part` | `null` | Component ID in an assembly; null for a single part. |
| `steps` | `[2]` | Perimeter counts per layer, 1–50 layers; each count is positive. |
| `minFeatureMm` | `0.4` | Section feature scale, 0.05–5 mm. |

For `n` perimeters, offsets span `-(n-1)/2` through `+(n-1)/2` bead-width
spacings around the source centerline. One perimeter follows that centerline;
two straddle it. Larger counts can extend outside the modeled wall. Schedules
may rise, fall or repeat; `[2,3,2]` doubles, triples, then doubles the ring.
There is no automatic width-to-schedule calculation.

Nominal rings use ordinary planar operations and shared travel/connector
planning. Experimental adapted courses may become nonplanar and require a
compatible machine. All source operations precede the rim.

## Physical limits

The user reports the underlying rim technique demonstrated in prints
(2026-09-24); the experimental adaptation is not physically qualified. Shared
connectors are checked against the current ring band, not a structural model
of the hollow interior. Wide perimeter-count jumps and adhesion outside the
preceding wall remain unproven. Prefer small schedule changes and review the
actual path in Studio. [MAKERS](../../MAKERS.md) owns confirmation and delivery.
