---
name: wing-design
description: Plan a 3D printed wing with the user. Workspace stub for developing the design workflow together; wing geometry generation, structural design and aerodynamic analysis are not implemented.
metadata:
  saam-kind: task
---

# Wing design

This workspace is a starting point for developing a conversational wing-design
workflow in SAAM. It currently supports recording and refining the design brief;
it has no wing generator, dedicated Studio controls or printing recipe.

## Start the conversation

Use the [design brief](DESIGN-BRIEF.md) to develop the workflow with the user.
Its focus is Use, Shape and Construction, with a requested orbitable wing viewer,
wireframe inspection and independent spar/hardware visibility. These are product
requirements awaiting implementation. The [airfoil source guide](AIRFOIL-SOURCES.md)
supports source-backed discussion and describes the proposed candidate browser.
After Use and airfoil selection, guide control-surface and tail requirements,
then reinforcement and fuselage attachment. Each sufficiently defined choice
must update the eventual CAD assembly. The brief owns the sequence, construction
alternatives and dependent-feature behavior; these tools are not implemented yet.
Start with the intended application and the first result they want to inspect.
Record their choices separately from proposed defaults and unresolved questions.
Do not ask for every dimension at once or present proposed features as available.

The eventual workflow should let the person describe a wing, revise its geometry
through conversation, and review the part, process settings and toolpath in
SAAM Studio. Use the existing [maker workflow](../../MAKERS.md) and
[shared print tools](../../core/print/USAGE.md) as those capabilities are built.
Personal print bundles belong in `Prints/`; this folder holds the reusable skill.

## Current boundary

No airfoil family, wing dimensions, internal structure, printer or material has
been selected. There is no generated wing or machine program. Aerodynamic
performance, structural strength and physical print results are unvalidated.

The first research step is complete; viewer and generator implementation remain
future work within the developing workspace. Follow
[skill authoring](../AUTHORING.md) and the relevant shared contracts when that
work is requested. Reuse SAAM geometry, printing and review interfaces rather
than introducing a separate export workflow.
