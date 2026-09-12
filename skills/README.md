# Skills

Choose a manual by the operation you need. Printing skills describe deposition
patterns; task skills operate on geometry or other preparation work. Each manual
owns its tools, settings and supported scope.

## Printing patterns

| Operation | Manual |
|---|---|
| Planar walls and patterned interior fill | [planar-infill](planar-infill/SKILL.md) |
| Solid fill and solid surface layers | [full-fill](full-fill/SKILL.md) |
| Supports assigned to selected areas | [supports](supports/SKILL.md) |
| Edge supports using horizontal offsets | [rimming-planar](rimming-planar/SKILL.md) |
| Experimental edge supports using normal offsets | [rimming-normal](rimming-normal/SKILL.md) |
| Skin following a continuous roof | [draped-skin](draped-skin/SKILL.md) |
| A continuous rising outer wall | [vase-wall](vase-wall/SKILL.md) |
| Pipe and selected-surface cladding | [pipe-cladding](pipe-cladding/SKILL.md) |
| A bounded wedge with a planar sloping roof | [wedge-demo](wedge-demo/SKILL.md) |

## Geometry processing

| Task | Manual |
|---|---|
| Diagnose a rejected mesh or perform requested mesh cleanup/reconstruction | [mesh-tools](mesh-tools/SKILL.md) |

## Shared workflow and development

[Print tools](../core/print/USAGE.md) owns creating/importing a print, applying
changes, reopening, setup reuse and generation/delivery. Pattern manuals add
their own recipe settings and supported geometry.

For a part combining patterns, read the selected manuals and their
[material-region interface](../core/region/README.md#material-regions-and-shared-interfaces).
For machine setup and export limitations, follow the
[machine contracts](../core/export/README.md#machine-interoperability-design).

Maker guidance lives in [MAKERS.md](../MAKERS.md); connected-client tools and
discovery scope live in the [MCP adapter manual](../adapters/mcp/README.md).
Developers start at [DEVELOP.md](../DEVELOP.md), whose skill-author pathway
routes to the shared geometry, numerical, composition, travel and machine
requirements.

Package implementation notes cover [planar infill](planar-infill/DEVELOP.md),
[assigned supports](supports/DEVELOP.md) and the shared
[rimming design](rimming-planar/DEVELOP.md). Read these when changing the relevant
producer or its integration with shared components.
