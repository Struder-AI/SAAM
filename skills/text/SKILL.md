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
geometry, plan and toolpath reviews. The person reviews the resulting solid in
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

- `plane`: `origin`, perpendicular `xAxis` and `yAxis`; axes are normalized.
- `part`: `patch` names a native spline patch on the retained original part,
  such as `top`. `sizeMm: [width,height]` defines the flat rectangle mapped to
  that patch. Optional `uvBounds: [[u0,u1],[v0,v1]]` selects a subregion.
- `spline`: an independent open reference with `degreeU`, `degreeV`, rectangular
  `controlPoints`, and `sizeMm`. Points are `[x,y,z]` or `[x,y,z,weight]` with
  positive weights. Degrees 1–5 are supported. Optional full `knotsU`/`knotsV`
  replace open uniform knots. This guide need not belong to any printed part.

All references accept `normalSide: 1` or `-1`. The default follows the cross
product of the reference's U and V directions; it is not an inferred outward
normal of the target. Imported meshes use an independent plane or spline guide.
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
| `baseline` | Optional quadratic/cubic Bezier: three/four XY `controlPoints`, plus `startMm` along its length. Defaults to a straight baseline. |
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

## Circular underside lettering

For a complete ring, use a planar annular `spline` reference. The `baseline`
setting accepts only one quadratic/cubic Bezier segment, not a closed circular
path. An annular reference maps the whole line around the circle without adding
a baseline or a new text operation.

Choose centre `(cx, cy)`, underside height `z`, positive inner radius `R`, radial
guide width `H`, and layout width `W` (both positive). Construct the reference as follows:

```js
const directions = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1],[1,0]];
const reference = {
  kind: 'spline', degreeU: 2, degreeV: 1,
  knotsU: [0,0,0,0.25,0.25,0.5,0.5,0.75,0.75,1,1,1],
  sizeMm: [W, H],
  controlPoints: directions.map(([x,y],i) =>
    [R,R+H].map(r => [cx+r*x, cy+r*y, z, i%2 ? Math.SQRT1_2 : 1]))
};
```

U runs counterclockwise in XY and V runs outward, so the reference normal points
downward. With `mode: recessed`, positive `depthMm` cuts into material above the
underside plane. Lettering faces the viewer below the part; do not mirror it as
for a stamp. Rotate the control net about its centre to choose the starting angle.

Allow layout margins at both ends of the line and below the glyph outlines,
including any `outlineOffsetMm` expansion. The first and last control rows meet
geometrically, but the layout does not wrap overflowing text across that seam.
Fit the shaped font advances and `letterSpacingMm` within `W`; use `positionMm`
for the margins. `W` near the baseline circumference is a useful starting point,
but rational-circle parameterization is not uniform arc length, so inspect the
resulting letter widths and spacing. Keep the entire ring on solid material and
away from pockets or mating profiles. Check the underside view and first-layer
toolpath, including small counters and the bridging above recessed strokes.

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
