---
name: thick-lip
description: Extension for making a thickened or rolled edge with Slice or Trace.
metadata:
  saam-kind: extension
---

# Making a thick lip

The [extension preset](scripts/prepare.mjs) produces ordinary Slice data. Use
[Slice](../slice/SKILL.md) for a modeled thick edge or
[Trace](../trace/SKILL.md) for explicit rim curves. Both use the print's common
material, process, dependencies and review.

## Choose a construction

- **Slice:** model the added material and assign its band or volume more loops
  or solid fill. The geometry defines the outer extent. Keep ownership distinct
  from the wall below so the same material is not deposited twice.
- **Trace:** author closed curves around the edge, with bead width/height and
  course heights. Trace's `widthRule` can fit parallel paths to a requested width;
  explicit curves allow a different width on each course. Name the supporting
  operations as prerequisites and inspect every curve's contact.

For a vase ending, first supply a closed, level boundary. A raw rising spiral
does not supply one. A schedule such as two, three, then two neighboring paths
can make a rolled profile; paths may extend beyond the modeled wall. Width
changes must remain supported by preceding material.

## Follow a prepared boundary

Ordinary Slice can follow a source's prepared closed, level boundary:

```json
{"id":"lip","loops":[2,3,2],"fillDensity":0,"solidTop":0,"solidBottom":0,
 "surface":{"kind":"terminal","assignment":"wall","minFeatureMm":0.4},
 "contact":{"source":"wall"}}
```

Use the normal assignment tool to fill remaining defaults. Each loop count
selects one slice. Spacing and height use the assignment's process settings.
The source can be Slice or a closed Trace, including a level-ended vase.
A lip uses ordinary inward loops and no infill. Increasing the loop count does not enlarge the target region. Slice never reads finalized beads or performs substrate adaptation. The old `construction:'rim'` record
is read as these fields.

The underlying technique has user-reported physical prints; large width jumps remain unqualified. Follow the shared review
workflow; no strength or full-head clearance model is implied.
