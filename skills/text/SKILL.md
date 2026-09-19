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

Start from an existing shared shell/mesh print, including imported STL. For an
assembly, select one component with a request-level `"part": "id"` beside
`feature`, `remove` or `standalone`; a single-part print omits it.

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
Raised letters interrupt an existing wavy roof. To preserve the curved finish,
use the [curved lettering composition](#curved-lettering-above-a-draped-roof)
below. Planar top layers are another process choice; do not silently substitute
them when the requested part calls for draping. Automatic whole-roof draping of
the merged lettered solid crosses height discontinuities.

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

On an assembly, the same request names its component alongside the feature:

```json
{"part": "fin", "feature": {"id": "label", "text": "SAAM", "fontPath": "C:/fonts/MyFont.ttf"}}
```

`part` applies equally to `{"remove": ...}` and `standalone`, and its coordinates
and surface references stay in that component's local millimetres. An unknown id,
or omitting `part` on an assembly, is rejected.

Reusing an id edits that feature, retaining omitted settings and its saved
font. For example `{"feature":{"id":"label","text":"NEW","mode":"recessed"}}`.
`{"remove":"label"}` removes it. Every edit rebuilds from the retained original
part, not the previous boolean result. Removing all features restores that part.
Edit lettering through this tool; changing its baked recipe with `adjust_print`
is rejected with a rebuild instruction.

`standalone: true` explicitly replaces the selected target with standalone text;
it retains the original body only as an editable surface reference, without
printing it or adding a backing plate. `top` and `part` references therefore work
without copying the original surface. Subsequent edits retain this mode. The first feature
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

## Material selections and printing patterns

Each text edit retains one final solid for review and exposes its material through
`composition.regions[].part`:

| Selection | Material |
|---|---|
| `null` (single part), or the assembly component id | The complete final solid; existing whole-solid consumers keep this behavior. |
| `base` | The original body after recessed cuts; absent for standalone text. |
| `text/label` | Material added by raised feature `label`, excluding earlier material and subsequent cuts. |
| `nameplate/base`, `nameplate/text/label` | The same selections within assembly component `nameplate`, in its existing coordinate frame. |

Recessed features are cutters, not printable regions. Empty material selections
are omitted. Overlapping raised features give earlier features ownership of the
overlap, so selecting all partitions deposits the final solid once. Uncut bases
retain their native surface queries and preparation details, including heat-set
reinforcement; a cut base uses its resulting mesh. Selecting a whole solid and
its partitions together needs the shared explicit lower-surface relationship to
avoid conflicting ownership.

Choose the shape before choosing its printing pattern. Changing only region
assignments or their settings retains saved geometry and updates process review.
Old saved text records still work as whole solids; one text rebuild is needed to
expose selections they did not save. That rebuild follows normal geometry review.

On a regional plan, assign each new raised feature's material deliberately.
Removing a selected feature requires updating its dependent assignments. Supply
request-level `regions` (the complete replacement `composition.regions` array)
alongside `feature` or `remove` to save both changes atomically. Invalid references
fail without changing the print; the text tool does not silently drop operations.

Selections expose material, not universal pattern compatibility. Horizontal body
fill, curved finishing layers, and side-wall relief have different requirements.
They are selected through regional patterns; supports, rimming, cladding, wave
slices and plastic welds retain their existing global settings and interfaces.
Planar fill can follow side lettering on a whole solid; continuous vase-wall
generation can fail at glyph contour transitions. Use the selected pattern's
geometry limits when deciding its applicability.

## Curved lettering above a draped roof

The lettering shape and its deposition layers are separate choices. Assign
`draped-skin` to the lettering to deposit curved layers; full-fill above a curved
lower surface still emits horizontal layers.

Apply raised text to the original roof with `reference: {"kind":"top"}`.
Use the resulting `base` and `text/label` selections; no duplicated guide,
extra assembly component or process-specific boolean reconstruction is needed.
The packaged [draped example](scripts/draped-demo.mjs) builds this composition.

Assign the usual body and draped finish to a region selecting `base`. Assign only
`draped-skin` to a region selecting `text/label`, with `lowerSurfaceFrom` naming the roof
region. For 0.8 mm raised lettering, four 0.2 mm skins form the complete relief.
The shared interface orders all roof operations before the lettering and measures
the first letter bead's actual gap above the deposited roof. Later skins follow
the letter tops with the selected normal spacing. Normal-offset geometry and
vertical skin sampling are approximate, so the first gap need not be exactly
0.2 mm everywhere.

```sh
node skills/text/scripts/draped-demo.mjs Prints/draped-lettering SAAM
node studio/server.mjs Prints/draped-lettering
```

This creates unapproved geometry using the example S5/PLA setup. Review the
geometry and generated toolpath through the shared workflow. Check every letter,
its counters and thin strokes; choose a survey step smaller than those features.
Disconnected letter tops are separate filled islands, with travel between them.
Their steep side faces can appear in the excluded-surface survey; inspect the
actual top coverage. Missing support and a skin stack extending into the finished
roof are rejected. This composition has software coverage, not physical print
or nozzle-clearance validation.

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
outside shared validation limits can fail. There is no chosen triangle ceiling:
the mesh is as large as `maxEdgeMm`, `toleranceMm` and the reference curvature
require. Only a subdivision too large for the 32-bit solid kernel to address is
refused in advance, and an actual kernel failure names the setting that caused
it. Refinement stops when a pass no longer reduces the sampled deviation, which
is reported as a reference that cannot be resolved. Errors leave the saved print
unchanged; revise the geometry or quality settings rather than treating a failed
mesh as printable.

The [geometry reference](../../core/geom/README.md#text-and-solid-modifiers)
owns algorithms and precision limits. Tests establish software behavior, not
physical lettering quality or machine clearance.
