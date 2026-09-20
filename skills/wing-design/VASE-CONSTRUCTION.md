# Continuous-vase wing construction

Research and user direction, 2026-09-20. This defines the intended construction;
it is not an implemented printable wing generator or validated process.

## Construction definition

The user wants spanwise printed sections threaded onto separate reinforcing tubes,
then glued or plastic welded together. Printed skin stiffeners and tube-channel
webs are integral perimeter features. Conventional separate transverse airfoil
ribs in the current display prototype do not represent this construction.

Start from a solid wing envelope. Narrow cuts connected to the exterior make its
boundary dive inward and return; the resulting paired deposited tracks form
internal webs. Connect tube bores into this boundary route rather than leaving
independent hole loops. Vary the cuts along span to create diagonal skin-support
patterns and their intersections with tube supports. Avoid cuts that divide a
cross-section into separate material islands. Near-contact regions must be sized
for actual deposited bead spacing and bonding, not just nominal nozzle diameter.
The exported CAD solid's volume is not the printed material volume.

The CAD cuts, resulting printed material, and reinforcing tubes are three distinct
things to display. Do not render the CAD cutting volume as the physical finished
wing. A one-loop raw outline is necessary but not sufficient: offsets, collapsed
features and inter-turn correspondence must be checked too. A slicer that closes
tiny gaps may erase the intended internal route.

## Sources

- Tom Stanton's demonstration, published on Tim Station, *How I Designed a 3D
  Printed Wing*: https://www.youtube.com/watch?v=QJjhMan6T_E . Located the original
  video and model reference; no full video transcript was available in this pass.
  Model: https://www.printables.com/model/261434-vase-mode-wing (page fetch failed).
- Arvid Norlander's first-hand examples explain slit-connected internal features,
  double-wall contact spacing and disabling gap closing in PrusaSlicer:
  https://vorpal.se/ (article: 3D printing with unconventional vase mode).
- An inspectable parametric implementation, marked work in progress:
  https://github.com/Beachless/Vase-Wing . Reference only; no code copied.
- Another evolving implementation connects grid cuts and carbon-tube channels:
  https://github.com/mrtbrnz/OpenGeoDrone . Its universal slicer setup section is
  unfinished; do not treat its README as manufacturing validation.
- colorFabb's material calibration uses single-wall samples to determine expansion
  versus temperature, speed and flow:
  https://support.colorfabb.com/hc/en-150/articles/360003022978-How-to-print-with-LW-PLA .
  Continuous deposition avoids repeated stop/start events; foaming calibration
  and bond strength still require physical samples. No universal zero-retraction
  requirement is inferred for every filament sold as lightweight PLA.

## Inspection of supplied examples

Originals were read without modification from the user's Wing Test folder.
Personal diagnostics live in `Prints/development/wing-vase-study/`, outside the
reusable skill. The three files are geometry-only 3MF archives: one mesh each,
no embedded slicer configuration or G-code. Source X spans 100 mm, Y is roughly
150 mm chord, and Z thickness is approximately 17.557 mm. Print span-up requires
rotating source X onto machine Z. Two tube passages are visible in the sections.
Filename reinforcement sizes are user labels, not measured skin wall thickness.

A mesh-edge-connected plane intersection at 500 stations (X=0.1 through 99.9 mm,
0.2 mm spacing) found one raw contour at every station in the 1 mm and 2 mm files.
The 3 mm file had one contour at 437 stations, two at 24, three at 39. All mesh
edges have two incident triangles; this alone does not prove absence of geometric
self-intersections. All sampled contour graph vertices have degree two.

A diagnostic half-bead inward offset using SAAM's shared `offsetRegion` retained
one loop at all 500 stations for the 1 mm model with an assumed 0.4 mm bead.
Larger assumed beads, and portions of the other models, produced multiple offset
loops. These are plain polygon erosion tests, not a complete slicer or proof that
another slicer cannot print the files. No small-loop cleanup, variable-width
recovery, physical bonding test or full spiral motion verification was performed.

## Toolpath implementation contract

SAAM already offers continuous rising vase paths, but its normal fitted-sleeve
route and defaults must not be assumed suitable for microscopic routing cuts.
Use exact sections for initial validation (`sleeveToleranceMm: 0`), preserve cut
precision, and verify:

1. A single intended extrusion route after bead-centerline construction throughout
   the print interval; no omitted tube walls or internal supports.
2. Stable correspondence between turns at moving diagonal cuts and intersections;
   do not shortcut an inward excursion by smoothing or changing loop phase.
3. One continuous depositing stroke through the body, monotonic rising Z, no
   inter-feature travel/retractions, and appropriate layer contact/support.
4. Calibrated foamed bead geometry and fused paired tracks, tube fit, and physical
   strength. No supported-print or flight-strength claim from a CAD preview.

The current research confirms the representation and its constraints. It does
not establish that the existing generic vase producer successfully generates
these complete wing toolpaths. The next implementation proof is a short section
of the supplied 1 mm geometry with a reviewed continuous path, followed by the
feature-transition cases in the other variants. Do not silently discard loops
in order to claim a continuous print.

## Workspace construction controls

Replace the conventional rib assumption with controls for:

- Printed skin: calibrated bead width, layer pitch and material profile.
- Integral support pattern: diagonal pitch/angle, penetration, paired-track
  contact, tube-channel webs and clearance.
- Separate reinforcement: tube diameter, count, path and insertion access.
- Sectioning: printer usable Z, XY footprint and print orientation; mandatory
  breaks at chosen control-surface starts/stops, root/tip and hardware boundaries.
  Add height-limited breaks between these stations, accounting for any joint
  overlap and bed allowance. Do not simply divide every wing into equal lengths.
- Assembly: tube alignment across sections, glue/weld access, optional separately
  printed joint details where continuous-vase geometry cannot provide them.

Preview assembled/exploded sections, selectable isolated sections, cut locations,
print orientation/build envelope and the real extrusion route. Label conventional
solid caps, unsupported bridges and topology transitions rather than suggesting
that all joins or hardware interfaces can be spiral printed.
