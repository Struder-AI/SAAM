# Skills

Skills package a manual, callable tools and tests. Discover their behavior and
limits in the owning manual:

| Skill | Geometry | Machine compatibility |
|---|---|---|
| [wedge-demo](wedge-demo/SKILL.md) | Bounded eight-point wedge | S5 only; shared Griffin/review lifecycle. |
| [full-fill](full-fill/SKILL.md) | Closed mesh or supported untrimmed spline shell | S5 and H2D skill/SAAMpath checks. |
| [planar-infill](planar-infill/SKILL.md) | Closed mesh or supported untrimmed spline shell | S5 and H2D skill/SAAMpath checks. |
| [draped-skin](draped-skin/SKILL.md) | Continuous accessible roof on either backend | Declared non-planar capability/limit; S5 and experimental H2D checks. |

S5 has the complete export, Studio toolpath review and delivery workflow.
H2D runnable export is pending a verified startup/command/packaging envelope.
Software verification does not establish a physical print.

Shared authoring requirements live in DEVELOP.md:

- [Geometry queries and representation boundaries](../DEVELOP.md#geometry-interoperability-for-skill-authors).
- [Machine capabilities and output adapters](../DEVELOP.md#machine-interoperability-design).
- [Whole-plan travel and combing](../DEVELOP.md#whole-plan-travel-requirement).
- [Composable operations and dependencies](../DEVELOP.md#skill-result-composition).

Keep pattern decisions in skills, representation-specific queries in the
geometry core and machine behavior in profiles/output adapters. Add equivalent
backend/machine tests for general skills; document narrow exceptions. Reuse the
existing composer, Studio, approvals and delivery rather than creating another
pipeline. Intermediate tests use the same components in scratch bundles.
