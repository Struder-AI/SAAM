---
name: full-fill
description: Generate solid planar layers or selected solid surface regions on closed meshes and supported spline shells, using compatible machine profiles and the shared SAAM Studio review workflow.
---

# Full fill

Use for a solid planar body or for solid top/bottom regions alongside
[planar-infill](../planar-infill/SKILL.md). Read [MAKERS.md](../../MAKERS.md);
developers also read [DEVELOP.md](../../DEVELOP.md).

Supported geometry: validated indexed triangle meshes (including STL import),
closed untrimmed spline shells from the existing shape builders, and assemblies
of those components. Arbitrary edited 3DM and trimmed CAD import are unsupported.
The shared geometry interface supplies each layer's real cross section.
Closed planar masks and material reservations use the
[shared Clipper2 region tool](../../DEVELOP.md#shared-planar-intersections).
This does not add new input geometry types.

Software checks exercise this skill on both S5 and H2D profiles and both geometry
backends, including the shared export, toolpath review and delivery workflow.
H2D output is experimental; read its [machine contract](../../DEVELOP.md#h2d-output-contract)
before use. Firmware service routines are not simulated by playback.
No physical print from this skill has been validated.

## Setup and tools

Install with `npm ci` using Node.js 22+. From the repository root:

- `node core/print/cli.mjs init Prints/<name> [plan.json] [--machine <machine-id>]`
  creates unapproved geometry and settings. Machine IDs are `ultimaker-s5`
  (default) and `bambu-h2d`. Remembered setup is kept separately per machine.
- `node core/print/cli.mjs import-stl Prints/<name> <source.stl> <mm|inch> [machine-id]`
  imports ASCII/binary STL. Explicit units, source bytes/hash and the translation
  onto the bed are saved before geometry review. Review size and placement.
- `npm run studio -- Prints/<name>` opens the shared three-approval workflow.
- `node core/print/cli.mjs adjust Prints/<name> patch.json` applies chat changes.
  Geometry edits invalidate all approvals; settings edits preserve geometry approval.
- `node core/print/cli.mjs demo Prints/<name>` generates a development bundle
  without approvals on a machine with an implemented exporter/interpreter.
- `node core/print/cli.mjs check-path Prints/<name>` runs the same generator and
  machine checks without producing or approving a machine file. This supports
  profile development, including H2D; it is not a second viewer or delivery path.
- `node core/print/cli.mjs check Prints/<name>` verifies saved geometry and any
  generated export against the locked plan.
- `node core/print/cli.mjs remember-setup Prints/<name>` remembers setup for that machine.
- `node core/print/cli.mjs upgrade Prints/<name>` upgrades its machine snapshot
  and invalidates plan/toolpath approvals. Existing delivery bytes stay unchanged.
- `node core/print/cli.mjs deliver Prints/<name>` delivers only the exact approved export.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Select full-fill. |
| `parts` | `[]` | Assembly component IDs; empty selects all. |
| `mode` | `body` | Entire body, or `solid-surfaces` alongside planar-infill. |
| `bottomLayers` / `topLayers` | `3` / `3` | Local solid thickness in layers in solid-surfaces mode. |
| `perimeters` | `2` | Maximum inward loops from each boundary in body mode; planar-infill owns walls in shared solid-surfaces mode. |
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
before changing sides. Shared motion compacts straight runs and directly
repositions across permitted gaps of at most 1 mm without retraction or lift. Verified
combing stays inside the allowed region at print height, with routes around
holes when possible within `maxCombMm`. Other traverses clear the highest material
deposited so far across all skills plus `liftMm` (default 1 mm; zero allowed).
Cooling uses the same height; an out-of-bounds clearance is rejected.
This is not a full head collision model. See [shared travel](../../DEVELOP.md#whole-plan-travel-requirement).

## Composition and limits

`fullFillResult({shell, plan, reserve, id})` returns wall and interior operations.
`generateFullFill(builder, options)` uses the same result/composer for a single
instance. General composition uses all results together, with one travel state
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
[shared contract](../../DEVELOP.md#skill-result-composition).

An optional `lowerSurfaceFrom` references another region's published material
top. Full-fill keeps horizontal layers, clips them above that actual lower
surface and samples the local first-layer gap for each segment's volume. Valleys
start receiving material before the layer reaches higher peaks; later layers
use normal thickness. The consumer's start cannot skip those lower partial
layers. The supplied interface must cover the requested footprint. Missing
coverage, an unresolvable sampled boundary or an exhausted sampling budget is
rejected. Traverses use the clipped region rather than the unprinted envelope.
Variable-gap strokes keep their order so volumes remain attached to their
original segments.

A cap above a hollow wall uses a level wall ending. The agent chooses bridge
direction and wall contact with the maker and reviews the path in Studio;
no bridge permission flag is required. Full-fill above a draped surface consumes its published area
interface through the same generator. The
[synthetic stack fixture](../../core/tests/fixtures/regional-stack.mjs) exercises
base, vase, cap, sparse walls, drape and horizontal fill over the wavy lower
surface. Its invented robot configuration is software-test data, not a usable
hardware setup. Region settings and source references are part of plan approval.

The [geometry contract](../../DEVELOP.md#geometry-interoperability-for-skill-authors)
owns validation and backend limits. Mesh normals are faceted; spline contour
sampling may miss features below `minFeatureMm`. Thin regions may disappear under
bead-width offsets. Rectangular beads and overlap are approximations. Automatic
support, geometric overlap resolution between arbitrary components and physical
clearance validation are not implemented.

Run `npm test` after changes. Tests cover shape/volume, travel, geometry and
machine interoperability, source changes, approvals and exact-byte S5/H2D delivery.
