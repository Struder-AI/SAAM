---
name: text
description: Raised or recessed lettering on a part, or standalone text, from an outline font; flat, along a spline, or bent onto a surface.
metadata:
  saam-kind: geometry
---

# Text geometry

Use this geometry skill for lettering, labels, stamps and text inserts. It
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

For ordinary planar lettering, disable draped-skin on a fresh shell template:
small glyph roofs are not one continuous drape surface. Raised letters interrupt
a wavy roof; to keep the curved finish, use the
[curved lettering composition](#curved-lettering-above-a-draped-roof) rather than
silently substituting planar top layers.

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
original body remains only as an editable surface reference, so `top` and `part`
references still work, with no backing plate. The first feature must be raised;
use zero `overlapMm` for a bottom exactly at the reference. Later features add
or subtract. A final removal that would leave no geometry is rejected.

## Reference and layout

Coordinates are in the selected part's local millimetres. A reference is:

- `top`: local XY projected onto the original part's upper surface, following
  wavy roofs directly. It needs an original part and takes no `sizeMm` or UV
  fields. Raised material follows the local normal.
- `plane`: `origin`, perpendicular `xAxis` and `yAxis`.
- `part`: `patch` names a spline patch on the original part, such as `top`.
  `sizeMm: [width,height]` is the flat rectangle mapped to it; optional
  `uvBounds: [[u0,u1],[v0,v1]]` selects a subregion.
- `spline`: an independent open guide with `degreeU`, `degreeV`, rectangular
  `controlPoints` (`[x,y,z]` or `[x,y,z,weight]`), `sizeMm` and optional full
  knots. It never becomes material; use it for another geometry's surface.

`normalSide: 1` or `-1` flips the side. For plane, part and spline references the
default follows U × V, not an inferred outward normal; `top` uses the upward
normal. `sizeMm` controls stretching from the flat layout to spline UV and does
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

Each edit exposes its material through `composition.regions[].part`:

| Selection | Material |
|---|---|
| `null` (single part), or the assembly component id | The whole final solid. |
| `base` | The original body after recessed cuts; absent for standalone text. |
| `text/label` | Material added by raised feature `label`, excluding earlier material and later cuts. |
| `nameplate/base`, `nameplate/text/label` | The same within assembly component `nameplate`. |

Recessed features are cutters, not regions; empty selections are omitted. Earlier
raised features own overlaps, so selecting all partitions deposits the solid
once. Selecting a whole solid and its partitions together needs an explicit
lower-surface relationship. Changing only region assignments keeps the geometry.

On a regional plan, assign each new raised feature deliberately; removing a
feature needs its assignments updated. Supply request-level `regions` (the
complete `composition.regions`) with `feature` or `remove` to save both at once.
Selections expose material, not pattern compatibility: supports, cladding, wave
slices and plastic welds keep their global settings, and continuous vase walls
can fail at glyph contour transitions.

<!-- requires: nonplanar -->
## Curved lettering above a draped roof

The lettering shape and its layers are separate choices: assign `draped-skin` to
the lettering for curved layers (slices still emit horizontal ones). Apply
raised text to the original roof with `reference: {"kind":"top"}`, then give the
slice assignments `part: 'base'`, the draped finish to a region selecting `base`, and only
`draped-skin` to a region selecting `text/label` with `lowerSurfaceFrom` naming
the roof region. For 0.8 mm lettering, four 0.2 mm skins form the relief.

All roof operations precede the lettering, and later skins follow the letter tops
with the selected normal spacing; the first gap is approximate. Check every
letter's counters and thin strokes with a survey step smaller than them.
Disconnected letter tops are separate islands with travel between them, and their
steep sides can appear in the excluded-surface survey. Missing support and a
skin stack extending into the roof are rejected. This composition has software
coverage, not physical or nozzle-clearance validation.

## Circular lettering

Use a circular baseline with `reference: {"kind":"top"}` on flat, sloped or wavy
tops; don't rebuild the roof as an annular reference:

```json
{
  "feature": {
    "id": "circular-name", "text": "groucho", "sizeMm": 12, "align": "center",
    "positionMm": [50, 30], "letterSpacingMm": 0.4, "outlineOffsetMm": 0.18, "depthMm": 0.8,
    "baseline": {"kind": "circle", "radiusMm": 15}, "reference": {"kind": "top"}
  }
}
```

`positionMm` is the circle centre. `startAngleDeg` defaults to 90 (the top; zero
points along +X) and clockwise to true, so text centred at the top reads left to
right. Advance is arc length at `radiusMm`; glyph Y follows the baseline's left
normal. Font spacing stays intact: adjust spacing, radius or size instead of
stretching a word around a turn. Avoid overlapping turns and keep glyphs away
from the centre. On `top` the circle stays circular in XY, so surface arc length
is not preserved on slopes; ridges, folds and disconnected roofs can fail.

### Circular underside lettering

Use the same baseline with a downward-facing plane at the underside height:
choose axes whose cross product faces down and lay out the centre in that plane.
Recessed lettering cuts inward. Mirror only for a stamp.

## Supported scope and quality

Fonts: TTF, OTF, WOFF/WOFF2 and collections with vector outlines; bitmap-only or
colour/SVG-only glyphs are rejected. Mixed-script or bidirectional paragraphs
need separately placed features with explicit shaping; added spacing can break
connected scripts. Spline targets are tessellated for the text boolean; their
recipes stay editable. Lettering can make a vase section nonconvex or a roof
unsuitable for draping.

`toleranceMm` (0.02 mm) and `maxEdgeMm` (1 mm) are request-level construction
controls, not a certified error bound. Tight folds, offset self-intersections,
singular surfaces and mismatched seams can fail, as can a reference that
refinement cannot resolve; errors leave the print unchanged. Revise the geometry
or these settings rather than treating a failed mesh as printable. The
[geometry reference](../../core/geom/README.md#text-and-solid-modifiers) owns the
algorithms and precision limits.

<!-- layer: script -->
## Command line

`node core/print/cli.mjs text Prints/my-part text-request.json --revision REVISION`
takes the same request as `apply_text`.
