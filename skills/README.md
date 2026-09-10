# Skills

Skills package a manual, callable tools and tests. Discover their behavior and
limits in the owning manual:

| Skill | Geometry | Machine compatibility |
|---|---|---|
| [wedge-demo](wedge-demo/SKILL.md) | Eight-point mesh, rectangular base, planar roof in any direction | S5, experimental H2D and configured Dobot software checks; shared export/review lifecycle. |
| [full-fill](full-fill/SKILL.md) | Closed mesh or supported untrimmed spline shell | S5, H2D and configured Dobot software checks. |
| [planar-infill](planar-infill/SKILL.md) | Closed mesh or supported untrimmed spline shell | S5, H2D and configured Dobot software checks. |
| [draped-skin](draped-skin/SKILL.md) | Continuous accessible roof on either backend | Declared non-planar capability/limit; S5, experimental H2D and configured Dobot checks. |
| [vase-wall](vase-wall/SKILL.md) | One supported convex outer section on mesh or untrimmed splines, no holes/islands | Continuous rising wall with optional level ending for successors; S5, experimental H2D and configured Dobot software checks. |

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
