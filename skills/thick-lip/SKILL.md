---
name: thick-lip
description: Guidance for making a thickened or rolled edge with Slice or Trace.
metadata:
  saam-kind: guidance
---

# Making a thick lip

A lip is a shape and deposition choice, not a separate skill. Use
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

## Follow a finished boundary

Ordinary Slice can follow a source's closed, level terminal curve:

```json
{"id":"lip","loops":[2,3,2],"fillDensity":0,"solidTop":0,"solidBottom":0,
 "surface":{"kind":"terminal","assignment":"wall","minFeatureMm":0.4},
 "contact":{"source":"wall"}}
```

Use the normal assignment tool to fill remaining defaults. Each loop count
selects one course. Spacing and height use the assignment's process settings.
The source can be Slice or a closed Trace, including a level-ended vase.
With substrate adaptation enabled, finalized source beads and preceding courses
supply contact; missing contact rejects. The old `construction:'rim'` record
requires explicit migration to these fields.

The underlying technique has user-reported physical prints; experimental contact
adaptation and large width jumps remain unqualified. Follow the shared review
workflow; no strength or full-head clearance model is implied.
