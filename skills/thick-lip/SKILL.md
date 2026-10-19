---
name: thick-lip
description: Guidance for thickened or rolled edges made with ordinary Slice or Trace.
metadata:
  saam-kind: guidance
---

# Making a thick lip

Use
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

A vase must supply a closed boundary; a raw rising spiral alone does not.
Two, three, then two neighboring paths
can make a rolled profile; paths may extend beyond the modeled wall. Width
changes must remain supported by preceding material.

## Follow a prepared boundary

Ordinary Slice follows a prepared surface and its bounded region:

```json
{"id":"lip","loops":[2,3,2],"fillDensity":0,"solidTop":0,"solidBottom":0,
 "surface":{"kind":"slice","assignment":"wall"},
 "contact":{"source":"wall"}}
```

Use the normal assignment tool to fill remaining defaults. Each loop count
selects one slice. Spacing and height use the assignment's process settings.
The source publishes prepared surfaces, as Slice and a closed vase ending do.
Omitting `index` selects the last prepared surface in declared sequence. Its native
slice or producer completion is attached automatically; later lip slices require their predecessor.
A lip uses ordinary inward loops and no infill. Increasing the loop count does not enlarge the target region. Slice never reads finalized beads or performs substrate adaptation. The old `construction:'rim'` record
is read as these fields.

The underlying technique has user-reported physical prints; large width jumps remain unqualified. Follow the shared review
workflow; no strength or full-head clearance model is implied.
