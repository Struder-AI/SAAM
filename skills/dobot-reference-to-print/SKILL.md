---
name: dobot-reference-to-print
description: Research, reconstruct, preview, and generate Dobot StruderBot Lua for a finished physical part from a plain-language need, STL/STEP/mesh file, dimensioned drawing, product page, specification, photographs, or online references. Use when the operator wants Codex to find or interpret part geometry and carry it through clarification, manufacturability planning, preview approval, and robot-ready code rather than supplying complete dimensions directly.
---

# Dobot Reference to Print

> **Imported legacy workflow manual.** Its source-evidence discipline is
> preserved, but SAAM's current maker workflow and three approvals govern new
> jobs. Port reusable evidence handling into that shared workflow rather than
> reviving the legacy preview/Lua pipeline.

Turn an object request plus available evidence into an approved, source-traceable
StruderBot manufacturing plan. Use with `dobot-programmer` and any relevant
geometry skill such as layer filling, patterned walls, spiral lips, or
non-planar cladding.

## 1. Ask for operator references first

Before searching, ask whether the operator has an STL/STEP file, dimensioned
drawing, product or standards link, photos, measurements, or a physical sample.
Skip this question only when references were already supplied or the operator
proactively said none are available.

Treat operator-provided evidence as primary. Do not replace it silently with a
similar-looking online object. For photographs without scale, request one known
dimension or a scale object and enough views to resolve hidden geometry.

Read `references/source-and-geometry-evidence.md` when evaluating sources,
downloads, mesh geometry, drawings, or photo-derived dimensions.

## 2. Research the object

Search for authoritative drawings, manufacturer specifications, standards,
patents, manuals, CAD repositories, and corroborating photographs. Prefer
primary sources. Record links, licensing, nominal dimensions, tolerances, units,
revision/model applicability, and conflicts.

Do not download or redistribute a model whose license does not permit the
needed use. A search-result thumbnail or visually similar STL is not dimensional
evidence. If exact geometry cannot be established, label every inferred or
chosen dimension rather than presenting it as sourced fact.

## 3. Build an evidence-backed feature model

Translate references into functional features: interfaces, fits, holes, walls,
bases, cavities, clearances, symmetry, load paths, and cosmetic surfaces. Keep
three categories distinct:

- `SOURCE-CONFIRMED`: directly supported by a cited drawing, file, or spec.
- `OPERATOR-CONFIRMED`: measured, supplied, or explicitly chosen by the user.
- `INFERRED`: reconstructed from photos, convention, or engineering judgment.

Inspect supplied mesh/CAD files for units, bounds, orientation, scale, manifold
quality, disconnected components, thin regions, unsupported geometry, and
whether the geometry assumes conventional slicer behavior unavailable to the
fixed-flow Struder.

Do not translate triangles directly into thousands of short robot moves.
Reconstruct the object as manufacturing features and apply the project's smooth
native-motion skills.

## 4. Ask only material clarifying questions

Ask about unresolved choices that change fit, function, orientation, placement,
strength, safety, material use, or toolpath strategy. Combine related questions.
Do not ask the operator to decide implementation details already established by
robot-confirmed skills.

Do not proceed to preview while a critical interface dimension is merely
guessed. If a noncritical dimension is uncertain, propose a clearly labeled
default and state its consequence.

## 5. Plan for StruderBot manufacture

Apply current robot-confirmed calibration, bead width, layer rise, line spacing,
wall tie-in, continuous-extrusion, lead-in, early-shutoff, and starting-posture
rules from project knowledge. Recalculate every dependent path from the final
part dimensions.

Identify object-specific risks such as first-layer area, heat accumulation,
bridging, inaccessible cavities, nozzle/body collision, weak layer orientation,
and transitions between solid and patterned regions. Redesign features only
with operator visibility; do not silently alter the referenced part.

## 6. Produce the approval preview

Generate a deterministic four-view preview—top, front, right, and isometric—from
the same feature/path model intended for Lua. Show:

- finished dimensions and work origin;
- functional interfaces and tolerances;
- source-confirmed versus inferred geometry;
- print orientation, solid regions, walls, infill/pattern strategy, and holes;
- lead-in, travel/repositioning, extrusion path, end point, and safe lift;
- any deliberate adaptation from the reference design.

Provide a compact source/evidence summary with the preview. Invite adjustments.
Do not emit paste-ready Lua until the operator approves the geometry, unless the
operator explicitly skips the preview gate for a diagnostic test.

## 7. Generate and validate Lua

Generate a single direct Online-mode program by default. Use the current clean
baseline and preserve one continuous extrusion window. Keep repositioning fast,
outside built volume, and confined to safe boundaries. Never introduce dense
short-segment approximations for smooth geometry.

Validate bounds, continuity, reconstructed arcs, tool state, calibration,
layer order, support, collisions, starting posture, early shutoff, and immediate
lift. Run project tests, the Struder Lua validator, and `git diff --check`.
Provide the full copy/paste Lua when requested.

## 8. Learn from the print

Record the exact references, assumptions, revision, robot configuration,
physical result, measurements, and failure/success evidence. Promote inferred
geometry or process parameters only after operator or robot confirmation.

## Portable dependencies

Install this as part of the complete suite in `../STRUDERBOT_SUITE.json`.
It requires `dobot-programmer`. Web access and suitable file-inspection tools
are task-time capabilities when the user asks for online research or supplies
CAD, mesh, or reference files; they are not vendored software dependencies.
