# Wedge generation

The exact target face is `z = base + x tan(angle)`, with slope along +X.
The 3DM contains a capped extrusion and six named ruled NURBS reference surfaces;
the browser's eight-vertex display proxy represents the same planar faces.
Geometry parameters, proxy, native file and feature identifiers are bound into
the geometry approval hash. Arbitrary external Rhino edits are not resliced.

## Horizontal substrate

For `N` skins of normal thickness `t`, reserve vertical height `N t / cos(angle)`
below the final face. Horizontal courses begin at `firstLayerMm`, then advance
by `layerMm`. Each slice is a clipped rectangle whose downhill boundary follows
the reserved core plane. Deposit a perimeter and solid serpentine fill. The
small final courses omit interior fill when no space remains. Reverse stroke
order and each stroke's traversal on alternate layers to reduce repositioning.
First and subsequent flat layers default to 0.2 mm.

This is a demo rectangle filler, not a general polygon slicer. Small perimeter
and fill overlaps, rounded bead edges and the end of each stroke are not modeled
as exact material solids. A numerical test compares deposited volume with the
analytic wedge volume, but this does not measure a physical print.

## Inclined skin and transition

Raster strokes alternate uphill and downhill along X with a fixed vertical
nozzle; alternate skins also reverse row order. Rows divide the face width
evenly; actual row spacing is used in extrusion volume. The default is two
0.2 mm skins, measured normal to the face; count and thickness are chat-adjustable.

Nearby starts within the locked comb distance move directly at their current
height without retracting or lifting. Longer transitions retract, lift to a
fixed clearance Z, traverse, descend and recover. Clearance is the
maximum Z of the complete part geometry plus the locked `liftMm` margin (2 mm
by default). The native 3DM and its exact display proxy describe the same
bounds. Cooling parks and finish moves use that height without accumulating
additional lifts. This route does not check the print head's physical envelope.

For the first skin, split strokes at substrate-height steps and at a maximum
0.5 mm segment length. Evaluate the supported height at the downhill bead edge
and use the local midpoint gap. Between step boundaries, gap varies linearly,
so midpoint integration gives its interval-average volume under the model.

Volume is `3D segment length × row spacing × vertical gap × cos(angle)`.
Subsequent skins have constant normal thickness `t`. This calculation uses
three-dimensional motion length, with vertical-to-normal conversion explicit.
It approximates the material needed at the staircase interface; actual contact,
adhesion, pressure and bead distortion need physical evaluation.

When the base is thinner than the requested tilted-skin stack at the downhill
end, an inner tilted course starts where its own sloped height reaches the
first-layer height. Successive outer courses can therefore extend farther
downhill. The generator clips those starts geometrically rather than claiming
that a complete inner stack exists everywhere; this remains physically
unvalidated.

The first skin bridges the stepped substrate, so its local gap can exceed the
nominal layer height. Check its geometric upper bound from skin height, flat
layer height and the bead's downhill offset; this is not an experimentally
validated nozzle-gap limit. Generation caps motion
speed at the locked material-flow and Z-speed limits, adds the locked retraction
and cooling dwell strategy, and makes no additional process choices.

Studio estimates commanded motion and dwell time from the actual export,
excluding heating, firmware startup and acceleration. Playback speed scales that
timeline and interpolates within moves. The recipe favors slow development
settings and solid substrate fill; dimensions and settings can be adjusted in
chat before plan approval.
