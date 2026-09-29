---
name: draped-skin
description: Roof-following courses authored as common skin assignments; steep regions and local bead gaps are reported.
---

# Draped skin

This is a construction of the [general slice/deposition skill](../slice/SKILL.md).
Add a `construction: 'skin'` record to `plan.slices.assignments`; there is no
separate enabled skill record. Use the [shared tools](../../core/print/USAGE.md)
and normal geometry/toolpath review.

Native spline and mesh roof queries retain their geometry. In an assembly,
select a component with `part`; `null` selects a single solid. The reference is
the highest exposed surface at XY, not an underside or a wrapped sleeve.
Mesh normals remain faceted. A discontinuous, absent or excessive-slope mapped
reference rejects rather than silently flattening the path.

## Assignment

`skinAssignment({id, ...settings})` in
[shared constructions](../../core/print/surface-constructions.mjs) supplies defaults.

| Field | Default | Meaning |
|---|---|---|
| `part` | `null` | Selected roof component, required for assemblies. |
| `filament`, `process` | `null` | Shared material selection and local process overrides. |
| `after` | `[]` | Additional operation prerequisites. |
| `supportFrom` | `null` | Explicit finalized producer assignment for first contact. |
| `layers` | `2` | Positive whole number of roof courses. |
| `pitchMm` | `0.2` | Vertical translation between roof courses. |
| `spacingFactor` | `1` | XY row pitch as a multiple of bead width. |
| `strokeAngleDeg` | `0` | Row direction in the XY chart. |
| `sampleStepMm` | `0.5` | Maximum physical mapping step; chord error also refines. |
| `surveyStepMm` | `0.5` | Roof/reservation topology sampling step. |
| `maxAngleDegOverride` | `null` | Explicit experimental override of the declared limit. |

Survey first, reserve the printable roof courses, then construct the supporting
body. Excluded steep regions retain ordinary body material. Reservations affect
only their actual footprint. The body finishes before its skin, and courses stay
ordered. Each course maps shared directed fill strokes onto its height reference;
shared deposition computes volume from local gaps and actual mapped normals.
Courses translate vertically; their normal bead thickness is pitch times the
local normal's Z component. True constant-normal offset stacks are not implied.
Legacy `normalMm` described projected normal depth and requires an explicit
process migration; it is not an alias for `pitchMm`.

With `supportFrom`, the first gap and prerequisites come from that producer's
final positive-volume beads. Missing support or support at/above the new stroke
rejects. Modulated support also uses actual finalized coverage. Unmodulated body
courses retain the declared layer-lattice approximation across sparse voids;
bridging remains a recipe judgment, without a separate permission flag.
Modulation runs before final bead coverage is published to later consumers.

## Travel and limits

Nearest-entry scanline groups retain their segment volumes and normals when
reversed. Shared surface travel checks the footprint and local height. Short
turnarounds allow up to one-quarter course thickness of sag, capped at 0.05 mm;
lifted travel clears all previously deposited material. See
[shared travel](../../core/path/README.md#whole-plan-travel-requirement).

The configured machine's fixed-axis slope limit applies. On a machine with
tool orientation, mapped surface frames command the nozzle along the negative
surface normal. An explicit fixed-axis override remains experimental.
Sampling can miss between-grid features, and projected XY spacing is not a
geodesic metric. Pressure, adhesion, full head collisions and physical bead shape
are not modeled. The user reported physical draped-skin prints on 2026-09-24;
head clearance and finish were not measured. New software checks are not new
physical validation.

The [surface-drape example](../../examples/prints/surface-drape/README.md) and
[common stack fixture](../../core/tests/fixtures/regional-stack.mjs) illustrate
construction. New examples remain unapproved until the normal review workflow.
