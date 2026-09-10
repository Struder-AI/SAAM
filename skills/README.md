# Skills

Skills package a manual, callable tools and tests. Discover their behavior and
limits in the owning manual:

| Skill | Geometry | Machine compatibility |
|---|---|---|
| [wedge-demo](wedge-demo/SKILL.md) | Eight-point mesh, rectangular base, planar roof in any direction | S5, experimental H2D and configured Dobot software checks; shared export/review lifecycle. |
| [full-fill](full-fill/SKILL.md) | Closed mesh or supported untrimmed spline shell | S5, H2D and configured Dobot software checks. |
| [planar-infill](planar-infill/SKILL.md) | Closed mesh or supported untrimmed spline shell | S5, H2D and configured Dobot software checks. |
| [supports](supports/SKILL.md) | Explicit standard footprints or tree skeletons; shared mesh/spline part-clearance queries | Bed-rooted, same-tool planar supports through the shared S5/H2D/configured Dobot lifecycle. |
| [rimming-planar](rimming-planar/SKILL.md) | Assigned open bivariate spline surface between base and supported edges | Two outward horizontal offsets per section, shared planar pipeline; bed/edge bases. |
| [rimming-normal](rimming-normal/SKILL.md) | Same assigned surface as rimming-planar | Experimental 3D normal offsets; shifted heights and ordering remain subjects for physical comparison. |
| [draped-skin](draped-skin/SKILL.md) | Continuous accessible roof on either backend | Declared non-planar capability/limit; S5, experimental H2D and configured Dobot checks. |
| [vase-wall](vase-wall/SKILL.md) | One supported convex outer section on mesh or untrimmed splines, no holes/islands | Continuous rising wall with optional level ending for successors; S5, experimental H2D and configured Dobot software checks. |

## Imported StruderBot manuals

The following manuals were recovered on 2026-09-10 from the historical
`tkeller-inventopia/ai-native-3d-printer` workflow. They preserve physical
Dobot observations, process rules, geometry derivations, references and helper
scripts that had not been migrated to SAAM. They are discoverable source
material, **not callable SAAM operations**. Their individual manuals state the
integration work still required.

| Imported manual | Preserved capability | Current SAAM status |
|---|---|---|
| [dobot-patterned-wall](dobot-patterned-wall/SKILL.md) | Triangular touchback, walled truss, touchback loops, trochoids, omega/ribbon and sine walls | Highest-priority new operation family; manuals and evidence imported, generator integration pending. |
| [dobot-dog-ears](dobot-dog-ears/SKILL.md) | Clipped mouse ears, separated skirt and localized ties | Import complete; support/composer integration pending. |
| [dobot-prime-lead-in](dobot-prime-lead-in/SKILL.md) | Compact minimum-length purge and continuous entry | Import complete; whole-plan/machine-policy integration pending. |
| [dobot-layer-filling](dobot-layer-filling/SKILL.md) | Measured Struder fill spacing, overlap and region-first ordering | Evidence source for implemented `full-fill` and `planar-infill`; reconciliation pending. |
| [dobot-non-planar-cladding](dobot-non-planar-cladding/SKILL.md) | Robot-tested coupons and transition failures | Evidence source for implemented `draped-skin`; reconciliation pending. |
| [dobot-spiral-lip](dobot-spiral-lip/SKILL.md) | Width-driven supported rounded lips | Proposed successor/modifier for `vase-wall`; implementation pending. |
| [dobot-reference-to-print](dobot-reference-to-print/SKILL.md) | Source and dimension provenance for reconstructed parts | Reconcile with the current maker workflow. |
| [dobot-programmer](dobot-programmer/SKILL.md) | Historical Online-mode Dobot workflow and controller rules | Evidence/provenance only; current SAAM approvals and export supersede it. |
| [multiaxis-cross-layer-cylinder-cladding](multiaxis-cross-layer-cylinder-cladding/SKILL.md) | Preview-only cross-layer cylindrical cladding | Concept only; orientation/collision/machine implementation pending. |
| [multiaxis-diagonal-rib-growth](multiaxis-diagonal-rib-growth/SKILL.md) | Preview-only diagonal rib growth | Concept only; orientation/collision/machine implementation pending. |

See [the import manifest](STRUDERBOT_SKILL_MIGRATION.md) for source provenance,
evidence boundaries and migration priorities.
Install and validate the imported manuals as one transitional bundle using the
[portable suite guide](STRUDERBOT_SUITE.md) and its machine-readable
[`STRUDERBOT_SUITE.json`](STRUDERBOT_SUITE.json) manifest. The bundled Python
helpers are executable migration specifications; all callable functionality
still needs conversion into SAAM's JavaScript skill-result architecture.

S5 has the complete export, Studio toolpath review and delivery workflow.
H2D has experimental sliced-3MF output through the same review/delivery workflow.
Its [firmware-service contract](../DEVELOP.md#h2d-output-contract) is checked but not motion-simulated.
Dobot's experimental [Lua source ZIP](../DEVELOP.md#dobot-output-contract) follows
the same approvals and delivery, with installation settings required before
generation. Its segment-stop motion and relay estimate do not establish smooth
vase deposition or measured extrusion. Vendor project-import acceptance is unverified.
Software verification does not establish a physical print.

Skills also compose within one part through shared [material regions](../DEVELOP.md#material-regions-and-shared-interfaces).
They can own different bases, walls, caps and roofs, and a later horizontal fill
can consume an earlier nonflat surface as its bottom. The owning manuals describe
support, transition, sampling and geometry limits. Sharing a machine exporter
alone does not establish this broader interoperability.

The [local MCP adapter](../adapters/mcp/README.md) exposes the current workflow
and these known manuals to a compatible client. Automatic discovery and
registration are [deferred](../DECISIONS.md#d-022--defer-automatic-capability-discovery);
the fixed list does not replace validation of the selected recipe.

Shared authoring requirements live in DEVELOP.md:

- [Geometry queries and representation boundaries](../DEVELOP.md#geometry-interoperability-for-skill-authors).
- [Machine capabilities and output adapters](../DEVELOP.md#machine-interoperability-design).
- [Whole-plan travel and combing](../DEVELOP.md#whole-plan-travel-requirement).
- [Composable operations and dependencies](../DEVELOP.md#skill-result-composition).
- [Shared offsets and their supported scope](../DEVELOP.md#shared-offset-functions).
- [Numerically robust, established and measured shared functions](../DEVELOP.md#shared-numerical-foundations).

Keep pattern decisions in skills, representation-specific queries in the
geometry core and machine behavior in profiles/output adapters. Add equivalent
backend/machine tests for general skills; document narrow exceptions. Reuse the
existing composer, Studio, approvals and delivery rather than creating another
pipeline. Intermediate tests use the same components in scratch bundles.
