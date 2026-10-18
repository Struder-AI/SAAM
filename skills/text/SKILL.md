---
name: text
description: Raised or recessed lettering on a part, or standalone text, from an outline font; flat, along a spline, or bent onto a surface.
metadata:
  saam-kind: extension
---

# Text geometry

Use this extension for lettering, labels, stamps and text inserts. It
creates material geometry; choose toolpath skills afterward. Text changes
invalidate geometry and settings/toolpath confirmations, and the person reviews
the resulting solid in Studio as usual.

## Tools and edits

Start from an existing shell or mesh print, including an imported STL. MCP
`apply_text` takes `bundleId`, current `expectedRevision` and `request`. For an
assembly, select one component with a request-level `"part": "id"` beside
`feature`, `remove` or `standalone`; a single-part print omits it, and an unknown
id is rejected. Coordinates and references stay in that component's millimetres.

`fontPath` is an absolute font path on the SAAM computer; the tool saves the
font bytes and hash, so later edits don't depend on installed fonts. For a font
collection also supply its `postscriptName`. A portable starting font is
[Abel-Regular.ttf](tests/fixtures/Abel-Regular.ttf), resolved to an absolute path.

Use the selected face and ordinary Slice ownership for curved lettering.

A request for a 3 mm high part with a horizontal top:

```json
{
  "feature": {
    "id": "label", "text": "SAAM", "fontPath": "C:/fonts/MyFont.ttf",
    "mode": "raised", "sizeMm": 6, "positionMm": [2, 2], "depthMm": 0.6,
    "reference": {"kind": "plane", "origin": [0, 0, 3], "xAxis": [1, 0, 0], "yAxis": [0, 1, 0]}
  }
}
```

Reusing an id edits that feature, keeping omitted settings and its saved font:
`{"feature":{"id":"label","text":"NEW","mode":"recessed"}}`. `{"remove":"label"}`
removes it. Every edit rebuilds from the retained original part, and removing all
features restores it. Edit lettering only through this tool; `adjust_recipe` on
its baked recipe is rejected.

`standalone: true` replaces the selected target with standalone text; the
original body remains only as an editable surface reference, so named `part` references
remain available, with no backing plate. The first feature must be raised;
use zero `overlapMm` for a bottom exactly at the reference. Later features add
or subtract. A final removal that would leave no geometry is rejected.

## Reference and layout

Coordinates are in the selected part's local millimetres. A reference is:

- `plane`: `origin`, perpendicular `xAxis` and `yAxis`.
- `part`: `patch` names a spline patch on the original part, such as `top`.
  `sizeMm: [width,height]` is the flat rectangle mapped to it; optional
  `uvBounds: [[u0,u1],[v0,v1]]` selects a subregion.
- `spline`: an independent open guide with `degreeU`, `degreeV`, rectangular
  `controlPoints` (`[x,y,z]` or `[x,y,z,weight]`), `sizeMm` and optional full
  knots. It never becomes material; use it for another geometry's surface.

`normalSide: 1` or `-1` flips the side. For plane, part and spline references the
default follows the selected U × V orientation. `sizeMm` controls stretching from the flat layout to spline UV and does
not preserve distances on a doubly curved surface. Text must stay inside the
selected patch; move or resize it when the tool reports domain escape.

| Setting | Meaning / default |
|---|---|
| `text`, `fontPath` | Characters and outline font; missing glyphs are not replaced. |
| `sizeMm` | Font em size, 6 mm; capital height depends on the font. |
| `lineHeightMm`, `letterSpacingMm` | Baseline spacing 8 mm, added glyph spacing 0 mm. Newlines advance downward. |
| `outlineOffsetMm` | Stroke thickening (positive) or thinning (negative), 0 mm; holes shrink as strokes thicken. |
| `align` | `left`, `center` or `right`, by each line's advance width. |
| `direction`, `script`, `language`, `features`, `variation` | Fontkit shaping; defaults detect script and direction. Variation values use the font's named axes. |
| `positionMm`, `rotationDeg`, `mirror` | Flat placement `[0,0]`, rotation 0°, optional reflection for stamps. |
| `baseline` | Straight by default; a circle (`kind: circle`, `radiusMm`, optional `startAngleDeg`, `clockwise`) or a quadratic/cubic Bezier (three/four XY `controlPoints`, plus `startMm`). |
| `bendGlyphs` | `true` bends glyphs across the baseline and surface; `false` keeps each rigid on its tangent plane. |
| `depthMm`, `offsetMm`, `overlapMm` | Relief depth 0.6 mm, reference offset 0 mm, joining overlap 0.1 mm. |

Raised material spans `offsetMm - overlapMm` to `offsetMm + depthMm` along the
reference normal; recess cutters span `offsetMm - depthMm` to `offsetMm + overlapMm`.
A guide away from the body needs an offset or depth that reaches it: a disjoint
cutter leaves the body unchanged and a disjoint addition prints separately.

Compare strokes with the bead width, then inspect the toolpath: a valid text
solid can lose narrow strokes when perimeters inset. Use a heavier font, larger
lettering or a positive `outlineOffsetMm` (6 mm Abel needs about 0.15 mm with a
0.4 mm bead); these change the reviewed geometry.

## Material selections and toolpath skills

Each edit exposes its material through `plan.slices.assignments[].part`:

| Selection | Material |
|---|---|
| `null` (single part), or the assembly component id | The whole final solid. |
| `base` | The original body after recessed cuts; absent for standalone text. |
| `text/label` | Material added by raised feature `label`, excluding earlier material and later cuts. |
| `nameplate/base`, `nameplate/text/label` | The same within assembly component `nameplate`. |

Recessed features are cutters; empty selections are omitted. Earlier raised
features own overlaps, so disjoint partitions deposit the solid once. Changing
assignments keeps the geometry; avoid overlapping whole-solid/partition claims.

Assign each raised feature deliberately. To remove/change a feature and its
selectors atomically, supply request-level `assignments` (the complete common
`plan.slices.assignments`) with `feature` or `remove`. Selections expose material,
not pattern compatibility; a sleeve can fail at glyph contour transitions.

## Lettering on a selected surface

Reference the actual named part face with `kind:"part"`, `patch`, `sizeMm` and
optional `uvBounds`. Slice the resulting text material through ordinary ownership.
Downstream manufactured-surface references derive their slice prerequisites; an
independently authored surface leaves placement to Scheduling.

## Circular lettering

A circular baseline uses the same explicit surface reference:

```json
{
  "feature": {
    "id": "circular-name", "text": "groucho", "sizeMm": 12, "align": "center",
    "positionMm": [50, 30], "letterSpacingMm": 0.4, "outlineOffsetMm": 0.18, "depthMm": 0.8,
    "baseline": {"kind": "circle", "radiusMm": 15}, "reference": {"kind": "part", "patch": "top", "sizeMm": [100,100]}
  }
}
```

`positionMm` is the circle centre. `startAngleDeg` defaults to 90 (the top; zero
points along +X) and clockwise to true, so text centred at the top reads left to
right. Advance is arc length at `radiusMm`; glyph Y follows the baseline's left
normal. Font spacing stays intact: adjust spacing, radius or size instead of
stretching a word around a turn. Avoid overlapping turns and keep glyphs away
from the centre. Surface mapping can change physical arc length; inspect distortion on curved faces.

### Circular underside lettering

Use the same baseline with a downward-facing plane at the underside height:
choose axes whose cross product faces down and lay out the centre in that plane.
Recessed lettering cuts inward. Mirror only for a stamp.

## Supported scope and quality

TTF, OTF, WOFF/WOFF2 and collections need vector outlines; bitmap/color-only glyphs reject. Mixed-script or bidirectional paragraphs
need separately placed features with explicit shaping; added spacing can break
connected scripts. Saved solids retain native targets and editable features; mapped
lettering uses meshes through shared Geometry. Lettering can make sections nonconvex
or surface regions with disconnected material.

`toleranceMm` (0.02 mm) and `maxEdgeMm` (1 mm) are request-level construction
controls, not a certified error bound. Tight folds, offset self-intersections,
singular surfaces and mismatched seams can fail, as can a reference that
refinement cannot resolve; errors leave the print unchanged. Revise the geometry
or these settings rather than treating a failed mesh as printable. The
[geometry reference](../../core/geom/README.md#text-and-solid-modifiers) owns the
algorithms and precision limits.
