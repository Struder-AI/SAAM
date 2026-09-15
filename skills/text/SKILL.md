---
name: text
description: Add raised or recessed lettering to a part, or create standalone text, using a supplied outline font. Lay out lettering flat, optionally along a spline baseline, then bend its solid onto a part surface or an independent spline guide. The resulting mesh goes through the shared printing and Studio review workflow.
metadata:
  saam-kind: task
---

# Text geometry

Use this preparation skill for lettering, labels, stamps and text inserts.
It creates actual material geometry; choose printing patterns afterward using
the [shared print tools](../../core/print/USAGE.md). Text changes invalidate
geometry and combined settings/toolpath confirmations. The person reviews the resulting solid in
Studio through the usual workflow.

## Tools and edits

Start from an existing shared shell/mesh print, including imported STL. Select
one `part` by id for an assembly. The bounded wedge-demo recipe is separate;
use a shared shell wedge or mesh when lettering is needed.

```sh
node core/print/cli.mjs text Prints/my-part text-request.json --revision REVISION
```

MCP `apply_text` takes `printId`, current `expectedRevision`, and `request`.
Both entries call the same implementation. `fontPath` is an absolute local
font path on the SAAM computer. The tool saves the exact font bytes and hash,
so subsequent edits and reopening do not depend on installed system fonts.
For a font collection, also supply its `postscriptName`.

For a portable starting font, resolve [Abel-Regular.ttf](tests/fixtures/Abel-Regular.ttf)
to an absolute path on the SAAM computer; replace the example's placeholder path.
For ordinary planar lettering, disable draped-skin on a fresh shell template,
as the text demo does; small glyph roofs are not one continuous drape surface.
Raised letters also interrupt an existing wavy roof. Before generating that
lettered part, select compatible planar top layers or an explicitly supported
regional composition; do not leave automatic whole-roof draping enabled and
retry its discontinuity error unchanged.

Example request for a 3 mm high part whose top is horizontal:

```json
{
  "feature": {
    "id": "label",
    "text": "SAAM",
    "fontPath": "C:/fonts/MyFont.ttf",
    "mode": "raised",
    "sizeMm": 6,
    "positionMm": [2, 2],
    "depthMm": 0.6,
    "reference": {
      "kind": "plane",
      "origin": [0, 0, 3],
      "xAxis": [1, 0, 0],
      "yAxis": [0, 1, 0]
    }
  }
}
```

Reusing an id edits that feature, retaining omitted settings and its saved
font. For example `{"feature":{"id":"label","text":"NEW","mode":"recessed"}}`.
`{"remove":"label"}` removes it. Every edit rebuilds from the retained original
part, not the previous boolean result. Removing all features restores that part.
Edit lettering through this tool; changing its baked recipe with `adjust_print`
is rejected with a rebuild instruction.

`standalone: true` explicitly replaces the selected target with standalone text;
it does not add a backing plate or retain the replaced body. The first feature
must be raised. Use zero `overlapMm` when its bottom should begin exactly at the
reference. Further features can add or subtract from that text. A final removal
that would leave no geometry is rejected.

## Reference and layout

Coordinates are in the selected part's local millimetres, before assembly and
printer placement. A reference can be:

- `top`: project local XY millimetres onto the original part’s upper surface,
  using shared spline or mesh height/normal queries. This follows wavy roofs
  directly, without constructing a duplicate guide. It needs an original part
  and takes no `sizeMm` or UV fields. Raised material follows the local normal.

- `plane`: `origin`, perpendicular `xAxis` and `yAxis`; axes are normalized.
- `part`: `patch` names a native spline patch on the retained original part,
  such as `top`. `sizeMm: [width,height]` defines the flat rectangle mapped to
  that patch. Optional `uvBounds: [[u0,u1],[v0,v1]]` selects a subregion.
- `spline`: an independent open reference with `degreeU`, `degreeV`, rectangular
  `controlPoints`, and `sizeMm`. Points are `[x,y,z]` or `[x,y,z,weight]` with
  positive weights. Degrees 1–5 are supported. Optional full `knotsU`/`knotsV`
  replace open uniform knots. This guide need not belong to any printed part.

All references accept `normalSide: 1` or `-1`. For plane and spline/part references, the default follows the cross
product of the reference’s U and V directions; it is not an inferred outward
normal of the target. The `top` reference uses the shared query’s upward normal. Imported meshes can use `top` or an independent plane or spline guide.
To use another geometry's surface, supply its control net as a standalone spline.
The guide does not become material in the output.

`sizeMm` explicitly controls stretching from the flat layout to spline UV.
It is not a promise of preserved distances on a doubly curved surface. Text
must stay inside the selected patch; move or resize the text or reference when
the tool reports domain escape.

| Setting | Meaning / default |
|---|---|
| `text`, `fontPath` | Requested characters and outline font; no silent missing-glyph replacement. |
| `sizeMm` | Font em size, 6 mm; actual capital height depends on the font. |
| `lineHeightMm`, `letterSpacingMm` | Baseline spacing 8 mm and additional glyph spacing 0 mm. Newlines advance downward in the flat layout. |
| `outlineOffsetMm` | Explicit stroke thickening (positive) or thinning (negative), 0 mm by default. Offsets the flat glyph outlines before layout/warping; holes shrink as strokes thicken. |
| `align` | `left`, `center`, or `right`, based on each line's advance width. |
| `direction`, `script`, `language`, `features`, `variation` | Fontkit shaping options; default script/direction detection, default font features, and no variation overrides. Variation values use the font's named axes. |
| `positionMm`, `rotationDeg`, `mirror` | Flat placement `[0,0]`, rotation 0°, and optional reflection for stamps. |
| `baseline` | A circular baseline (`kind: circle`, `radiusMm`, optional `startAngleDeg` and `clockwise`) or quadratic/cubic Bezier (three/four XY `controlPoints`, plus `startMm`). Defaults to straight. |
| `bendGlyphs` | `true`: bend letter shapes across the baseline and surface. `false`: keep each glyph rigid on its local tangent plane. |
| `depthMm`, `offsetMm`, `overlapMm` | Relief depth 0.6 mm, reference offset 0 mm, joining/cutting overlap 0.1 mm. |

Raised material spans `offsetMm - overlapMm` to `offsetMm + depthMm` along the
reference normal. Recess cutters span `offsetMm - depthMm` to
`offsetMm + overlapMm`. A guide away from the body needs an offset/depth that
actually reaches it; a disjoint cutter leaves the body unchanged, and a disjoint
addition leaves separate material. Inspect contact and thin strokes in Studio.

Compare the text's strokes with the selected bead width, then inspect the actual
toolpath. A valid text solid can lose narrow strokes when the fixed-width slicer
insets its perimeters. Use a heavier font, larger lettering or explicit positive
`outlineOffsetMm` when appropriate; these change the reviewed geometry. The 6 mm
Abel curved-roof example uses 0.15 mm outline expansion because its unmodified
C/U strokes disappear with a 0.4 mm bead. Geometry visibility alone is insufficient.

## Circular lettering on a part

Use the shared circular baseline with `reference: {"kind":"top"}` for lettering
on flat, sloped or wavy tops. Do not rebuild or copy the roof into an annular
reference. A normal text edit can use this feature, with the saved font or an
absolute `fontPath`:

```json
{
  "feature": {
    "id": "circular-name", "text": "groucho",
    "sizeMm": 12, "align": "center", "positionMm": [50, 30],
    "letterSpacingMm": 0.4, "outlineOffsetMm": 0.18, "depthMm": 0.8,
    "baseline": {"kind": "circle", "radiusMm": 15},
    "reference": {"kind": "top"}
  }
}
```

`positionMm` is the circle centre in local XY. `startAngleDeg` defaults to 90
(the top of the circle); zero points along +X. Clockwise defaults to true, so
text centred at the top reads left to right and extends outward from the circle.
Text advance measures arc length at `radiusMm`. Positive glyph Y follows the
left normal of the baseline: outward clockwise and inward counterclockwise.
`align: center` centres the word at the chosen angle. Font spacing stays intact;
do not stretch a short name around a full turn unless requested. Reduce spacing
or change radius/font size to adjust the arc. Avoid overlapping turns and keep
all glyph material away from the circle centre.

The circle remains circular in XY when using `top`; heights and relief normals
come from the original geometry. This does not preserve surface arc length on
slopes. Footprint escape fails, and sharp ridges, discontinuous mesh normals,
folds or disconnected roof regions can exceed mapping limits. Inspect contact
and strokes through the normal geometry/toolpath workflow. A `part` UV reference
remains useful for deliberate UV layout, with its existing distortion semantics.

### Circular underside lettering

For circular underside lettering, use the same baseline with a downward-facing
plane at the underside height, instead of `top`. Choose plane axes so their
cross product faces down and lay out the centre in that plane’s coordinates.
Recessed lettering cuts inward. Do not mirror unless making a stamp. The
independent annular spline reference remains supported for explicit guide work;
it is no longer necessary for ordinary circular text.

## Reproduce the development examples

Use a new, unused print directory:

```sh
node skills/text/scripts/demo.mjs Prints/text-review
node core/print/cli.mjs demo Prints/text-review
node studio/server.mjs Prints/text-review
```

The [example builder](scripts/demo.mjs) creates raised and recessed flat labels,
lettering on a part's curved roof, and pipe lettering shaped by an independent
rational spline guide. It uses the bundled open-licensed Abel test font. The
second command generates a development toolpath through the shared workflow;
neither command creates human approvals. Inspect both the geometry and the
deposition paths, especially each letter's narrow strokes and counters.

## Supported scope and quality

The font backend reads TTF, OTF, WOFF/WOFF2 and collections with vector outlines;
variable-font axes and font shaping are passed to Fontkit. Bitmap-only or
color/SVG-only glyphs without conventional outlines are rejected. Missing
characters require another font. Automatic mixed-script/bidirectional paragraph
layout is not implemented; use separately placed features with explicit shaping
settings when needed. Added glyph spacing can separate connected script forms.

The boolean result is a validated indexed mesh used by both Studio and slicing.
Spline targets are explicitly tessellated for this operation; their original
recipes remain editable. Unmodified parts keep their existing representations.
Printing patterns retain their own geometry limits: lettering can make a convex
vase section nonconvex or make a roof unsuitable for draped skin.

Request-level `toleranceMm` defaults to 0.02 mm for outline flattening and sampled
surface chord refinement; `maxEdgeMm` defaults to 1 mm before warping. These are
construction controls, not a certified global surface error bound. Tight folds,
offset self-intersections, singular surfaces, mismatched target seams, and meshes
outside shared validation limits can fail. The current mesh ceiling is 100000
triangles. Errors leave the saved print unchanged; revise the geometry or quality
settings rather than treating a failed mesh as printable.

The [geometry reference](../../core/geom/README.md#text-and-solid-modifiers)
owns algorithms and precision limits. Tests establish software behavior, not
physical lettering quality or machine clearance.
