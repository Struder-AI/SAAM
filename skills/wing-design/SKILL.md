---
name: wing-design
description: Explore wing design in a local prototype with source-backed airfoils and an orbitable assembly. Generate a developmental Clark Y continuous-vase sample; full aircraft design, validated full-span toolpaths and aerodynamic/structural analysis remain unsupported.
metadata:
  saam-kind: task
---

# Wing design

Use the [design brief](DESIGN-BRIEF.md) for the intended Use / Shape / Construction
conversation. Record user choices separately from provisional values. Current
prototype controls and their limitations are in [the prototype manual](prototype/README.md).
Run `node skills/wing-design/prototype/server.mjs` and open its emitted URL.
There is no embedded AI service: notes save locally; the agent acts separately.
The [airfoil sources](AIRFOIL-SOURCES.md) distinguish coordinates from aerodynamic
evidence. A displayed assembly is not a printable or structurally validated wing.

## Continuous-vase construction sample

Read [the construction definition](VASE-CONSTRUCTION.md). The intended construction
uses printed sections with integral shallow diagonal skin stiffeners and deeper
tube-channel webs, assembled onto reinforcing tubes. Conventional display ribs
in the prototype do not yet implement this construction.

Generate the developmental coupon with:

    node skills/wing-design/scripts/vase-sample.mjs [output-directory]

Default output is `Prints/development/clark-y-vase-200`. It contains `sample.stl`,
`geometry.json`, `sections.json` and `report.json`. The script overwrites those
named generated outputs at that location; use another directory for another case.
It creates a 200 mm Clark Y chord / 200 mm span CAD solid with 5 mm bores at
30% and 60% chord, 2.5 mm-wide/deep weld troughs, and shallow diagonal routing cuts.
The 25 mm pitch, 45-degree angle, 1.5 mm slit depth and 0.4 mm bead are provisional.
Upper/lower skins use opposite diagonal families; each skin is not a diamond grid.
Slits taper out at protected leading/trailing-edge and spar-cap regions; they
terminate in skin rather than merging fully into the deep spar webs.

Generation uses shared solid/offset kernels and rejects sampled raw or bead-offset
sections with additional loops. It checks regular layers and brackets mesh feature
heights. It does not generate a full rising toolpath or establish physical printing
success. The specific first sample's 5 mm vase-path proof is recorded in its
personal output directory, not a general claim of generator compatibility.

Import generated STL through [shared print tools](../../core/print/USAGE.md) for
normal SAAM geometry review. Select vase-wall explicitly and disable ordinary
fill/surface producers. Preserve microscopic routing cuts; do not assume fitted
sleeve smoothing preserves them. Material, machine, full toolpath and physical
validation remain separate. Never infer printable mass from the CAD solid volume.

Run `node --test skills/wing-design/tests/vase-sample.test.mjs` for the coupon's
mesh, bore and sampled-continuity regression. This script is a development sample,
not a general solution for tapered wings, control surfaces, section joins or
validated aircraft design. Use [skill authoring](../AUTHORING.md) and shared
contracts when extending it.
