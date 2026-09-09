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

Software checks exercise this skill on both S5 and H2D profiles and both geometry
backends. Only S5 has a runnable export and complete toolpath review/delivery.
H2D currently supports geometry/settings review and SAAMpath compatibility checks.
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
| `perimeters` | `2` | Wall count in body mode; planar-infill owns walls in shared solid-surfaces mode. |
| `fillAnglesDeg` | `[45, 135]` | Alternating fill directions in body mode. |
| `fillOverlap` | `0.15` | Interior/wall overlap as a bead fraction in body mode. |
| `minFeatureMm` | `0.4` | Smallest sampled spline section feature. |

Solid-surfaces mode uses planar-infill's directions, overlap and feature tolerance
so the complementary regions share a common stroke grid and wall owner.
Layer height, line width, speeds, flow, retraction and cooling come from the
locked shared process settings, validated against the selected machine and tool.

## Travel

Alternating fill strokes and nearest wall starts reduce travel. Verified combing
stays inside the allowed region at print height, with routes around holes when
possible within `maxCombMm`. Other traverses clear the maximum of the entire
placed plan plus `liftMm`, including other skills and later operations. Cooling
uses the same bound; an out-of-bounds clearance is rejected. This is not a full
head collision model. See [shared travel](../../DEVELOP.md#whole-plan-travel-requirement).

## Composition and limits

`fullFillResult({shell, plan, reserve, id})` returns wall and interior operations.
`generateFullFill(builder, options)` uses the same result/composer for a single
instance. General composition uses all results together, with one travel state
and one whole-plan clearance. Assemblies can alternate or batch compatible layers;
body operations precede draped skins. A drape reserve removes its material from
planar sections. Whole-body full-fill and sparse infill on the same component
are rejected instead of double-printing.

The [geometry contract](../../DEVELOP.md#geometry-interoperability-for-skill-authors)
owns validation and backend limits. Mesh normals are faceted; spline contour
sampling may miss features below `minFeatureMm`. Thin regions may disappear under
bead-width offsets. Rectangular beads and overlap are approximations. Automatic
support, geometric overlap resolution between arbitrary components and physical
clearance validation are not implemented.

Run `npm test` after changes. Tests cover shape/volume, travel, geometry and
machine interoperability, source changes, approvals and exact-byte S5 delivery.
