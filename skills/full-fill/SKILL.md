---
name: full-fill
description: Fill an entire body with solid planar layers, or add solid bases, caps and surface regions around sparse infill. Works on closed meshes and supported spline shells, providing solid material where the part needs it.
---

# Full fill

Use for a solid planar body or for solid top/bottom regions alongside
[planar-infill](../planar-infill/SKILL.md). For maker work, read
[MAKERS.md](../../MAKERS.md). For development, start with the
[builder orientation](../../BUILDERS.md) and follow its task-specific references.

Supported geometry: validated indexed triangle meshes (including STL import),
closed untrimmed spline shells from the existing shape builders, and assemblies
of those components. Arbitrary edited 3DM and trimmed CAD import are unsupported.
The shared geometry interface supplies each layer's real cross section.
Closed planar masks and material reservations use the
[shared Clipper2 region tool](../../core/region/README.md#shared-planar-intersections).
This does not add new input geometry types.

Software checks exercise this skill on both S5 and H2D profiles and both geometry
backends, including the shared export, toolpath review and delivery workflow.
H2D output is experimental; read its [machine contract](../../core/export/bambu.md#h2d-output-contract)
before use. Firmware service routines are not simulated by playback.
No physical print from this skill has been validated.

## Setup and tools

Use the [shared print tools](../../core/print/USAGE.md) to create or import a
shell print, adjust its recipe, and complete review and delivery. This manual
owns the full-fill settings and composition choices below.

For a wholly planar solid, keep full-fill in `body` mode and disable draped-skin
and planar-infill; the shared shell template otherwise includes a draped roof.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Select full-fill. |
| `parts` | `[]` | Assembly component IDs; empty selects all. |
| `mode` | `body` | Entire body, or `solid-surfaces` alongside planar-infill. |
| `bottomLayers` / `topLayers` | `3` / `3` | Local solid thickness in layers in solid-surfaces mode. |
| `perimeters` | `2` | Maximum inward loops from each boundary in body mode; planar-infill owns walls in shared solid-surfaces mode. Any whole count from zero up is accepted; more than about eight is rarely useful. |
| `perimeterScope` | `all` | `all` prints outer and hole boundaries; `outer` prints only exterior boundaries while fill remains clipped around holes. |
| `holeLineWidthMm` | `null` | Hole-boundary perimeter bead width, 0.3 mm through the main line width; `null` uses the main width. |
| `fillAnglesDeg` | `[45, 135]` | Alternating fill directions in body mode. |
| `fillOverlap` | `0.15` | Interior/wall overlap as a bead fraction in body mode. |
| `minFeatureMm` | `0.4` | Smallest sampled spline section feature. |

Solid-surfaces mode uses planar-infill's directions, overlap and feature tolerance
so the complementary regions share a common stroke grid and wall owner.
Layer height, line width, speeds, flow, retraction and cooling come from the
locked shared process settings, validated against the selected machine and tool.

Opposing fronts in a uniform closed wall share their final coincident loop.
For example, a 2 mm circular wall at 0.4 mm line width with three or more
perimeters produces five distinct loops and no interior fill. Increasing the
setting stops adding loops once the wall is consumed. This recovers a closed
central contour; it does not add general medial-axis or variable-width gap fill
for branching, uneven or sharp-corner remnants.

Mesh sections and offset wall strokes remove numerical straight-edge seams
through the shared contour helper before expensive offsets or motion emission.
This uses the existing numerical plane tolerance, preserving curved walls and
the locked process settings. The bundle stores the checked export and summary;
reopening interprets that export without regenerating or loading a SAAMpath file.

## Travel

Alternating fill strokes and nearest wall starts reduce travel. Disconnected
regions and uninterrupted row groups beside holes/concavities are completed
before changing sides. Each next row group is selected by the closest endpoint
of its first or last row. Row order and stroke direction are chosen independently,
so either side of either end row can be the entry.
Variable-gap volumes stay attached to their segments when reversed. This is
straight-line distance ordering; heat balancing and lookahead are deferred.
Shared motion compacts straight runs. A row, wall loop or fill entry starting
within 2 mm of the preceding deposition, inside the layer's region, continues as
a short printed connector rather than a travel: rows print as a zigzag and wall
loops step into each other. A nearby start on the next layer is one rising move
without retraction. Verified
combing stays inside the allowed region at print height, with routes around
holes when possible within `maxCombMm`. Other traverses clear the highest material
deposited so far across all skills plus `liftMm` (default 1 mm; zero allowed).
Cooling uses the same height; an out-of-bounds clearance is rejected.
This is not a full head collision model. See [shared travel](../../core/path/README.md#whole-plan-travel-requirement).

## Composition and limits

`fullFillResult({shell, plan, reserve, id})` returns wall and interior operations.
`planComposition(state, results)` plans all skill results together, with one travel state
and one deposited-height record. Assemblies can alternate or batch compatible layers;
body operations precede their draped skins. A drape reserve removes only its
owned footprint from planar sections, including separate components supporting
a spanning roof. It cannot truncate an unrelated component elsewhere.

Shared `composition.regions` can assign this skill repeatedly on one part, for
example base, cap, and solid material above a draped roof. Each region has an ID,
selected component, component-relative Z bounds and skill setting overrides.
Layer intervals are open at the start and closed at the end on
the component's shared layer grid. Sparse and solid masks can share one region;
two complete body owners cannot overlap the same material. See the
[shared contract](../../core/path/README.md#skill-result-composition).

An optional `lowerSurfaceFrom` references another region's published material
top. Full-fill keeps horizontal layers, clips them above that actual lower
surface and samples the local first-layer gap for each segment's volume. Valleys
start receiving material before the layer reaches higher peaks; later layers
use normal thickness. The consumer's start cannot skip those lower partial
layers. The supplied interface must cover the requested footprint. Missing
coverage or an unresolvable sampled boundary is rejected; no sampling budget can
run out. Traverses use the clipped region rather than the unprinted envelope.
Variable-gap walls keep their order. Segmented fill may reverse its row order
and stroke direction independently, reversing segment volumes with the stroke
points so material amounts remain attached to their original segments.

A cap above a hollow wall uses a level wall ending. The agent chooses bridge
direction and wall contact with the maker and reviews the path in Studio;
no bridge permission flag is required. Full-fill above a draped surface consumes its published area
interface through the same generator. The
[synthetic stack fixture](../../core/tests/fixtures/regional-stack.mjs) exercises
base, vase, cap, sparse walls, drape and horizontal fill over the wavy lower
surface. Its invented robot configuration is software-test data, not a usable
hardware setup. Region settings and source references are part of combined settings/toolpath confirmation.

The [geometry contract](../../core/geom/README.md#geometry-interoperability-for-skill-authors)
owns validation and backend limits. Mesh normals are faceted; spline contour
sampling may miss features below `minFeatureMm`. Thin regions may disappear under
bead-width offsets. Rectangular beads and overlap are approximations. Automatic
support, geometric overlap resolution between arbitrary components and physical
clearance validation are not implemented.

Available tests cover shape/volume, travel, geometry and
machine interoperability, source changes, approvals and exact-byte S5/H2D delivery.

## Shared example

The [nudge-cup workspace](../../examples/prints/nudge-cup/README.md) packages a
reproducible recipe using this skill. Its guide describes dimensions, setup and
current limits; generated workspaces begin without manufacturing approvals.
