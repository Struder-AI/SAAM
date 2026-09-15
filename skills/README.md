# Skills

This brief digest introduces the available capabilities and why they may help
with a part. Printing skills describe deposition patterns; task skills operate
on geometry or other preparation work. Follow the selected manuals for tools,
settings and supported scope.

<!-- BEGIN GENERATED SKILL DIGEST -->

## Printing patterns

| Skill | Capability and value |
|---|---|
| [planar-infill](planar-infill/SKILL.md) | Print conventional flat-layer walls with a patterned interior, varying infill density to control material use or leave a hollow body. Supports closed meshes and supported spline geometry; combine with full-fill for solid tops and bases. |
| [full-fill](full-fill/SKILL.md) | Fill an entire body with solid planar layers, or add solid bases, caps and surface regions around sparse infill. Works on closed meshes and supported spline shells, providing solid material where the part needs it. |
| [supports](supports/SKILL.md) | Add conventional supports beneath selected areas or explicitly placed tree branches at local contacts. Choose their placement to balance support, surface contact and removal access; the agent and maker assign areas through judgment. |
| [rimming-planar](rimming-planar/SKILL.md) | Experiment with thin walls that support selected edges so a planned bridge can span the area between them. A maker-assigned spline surface connects the bed or another edge to the supported edge; paired beads use horizontal offsets. |
| [rimming-normal](rimming-normal/SKILL.md) | Experiment with edge-support walls whose paired beads follow 3D surface-normal offsets, allowing nonplanar paths on a curved reference surface. Compare with rimming-planar to explore how offset direction affects bead spacing and edge contact; physical behavior remains unvalidated. |
| [draped-skin](draped-skin/SKILL.md) | Follow a sloping or curved roof with top-skin strokes instead of approximating it with flat-layer steps. Works on continuous accessible mesh or supported spline roofs within the machine's nonplanar angle limit; excluded steep areas are reported. |
| [thick-lip](thick-lip/SKILL.md) | Thicken a vase-wall's top edge into a rigid, optionally rolled rim instead of leaving a single spiral or level-ended bead. Use when the operator asks for a rim, brim, bead, rolled edge, round-over or a more durable/rigid lip on a vase-mode print. |
| [pipe-cladding](pipe-cladding/SKILL.md) | Wrap a substrate with alternating lengthwise and helical cladding, or opposite-handed helices for a crossed exterior pattern. Supports circular pipes and explicitly mapped periodic spline or mesh surfaces; this development capability requires a configured DENSO RC8 robot and external rotary. |
| [wedge-demo](wedge-demo/SKILL.md) | Demonstrate horizontal body layers and inclined roof layers on a bounded eight-point wedge. Uses its own generator for a rectangular base, vertical sides and one planar sloping roof, providing a small example for exploring inclined deposition. |

## Thick wall strategies

Describe a container by one boundary (inner or outer) and a wall thickness instead of perimeters and infill: these skills build the wall itself through a continuous or repeating 3D path rather than stacked flat rings.

| Skill | Capability and value |
|---|---|
| [vase-wall](vase-wall/SKILL.md) | Describe a container by one boundary and a wall thickness instead of perimeters and infill, using a continuous spiral or repeating motifs warped around the guide's actual contours. Overlapping tilted loops touch their neighbor by one line width to bond into a thicker wall, and can preserve the guide's exterior or create a scalloped finish. Continuous vase mode has no travel; explicit segmented mode permits gaps. |

## Geometry processing

| Skill | Capability and value |
|---|---|
| [mesh-tools](mesh-tools/SKILL.md) | Diagnose rejected meshes or perform requested STL cleanup and solid reconstruction so usable geometry can return to import and review. Preserves the original for comparison; reconstruction can change small features and requires closed, consistently oriented input. |
| [text](text/SKILL.md) | Add raised or recessed lettering to a part, or create standalone text, using a supplied outline font. Lay out lettering flat, optionally along a spline baseline, then bend its solid onto a part surface or an independent spline guide. The resulting mesh goes through the shared printing and Studio review workflow. |
| [gridfinity](gridfinity/SKILL.md) | gridfinity |

<!-- END GENERATED SKILL DIGEST -->

## Special capabilities

Most printing patterns can spread their lines farther apart while retaining
the nominal bead width, creating open meshes or reducing material. The agent
chooses one [spacing factor](../core/print/USAGE.md#line-spacing); SAAM derives
the matching path spacing and extrusion internally.
Cladding can also alternate helix winding on a
[finished surface](pipe-cladding/SKILL.md#finished-surface-composition), including
a hollow vase wall, to form a crossed exterior pattern.

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
Developers start at [DEVELOP.md](../DEVELOP.md) for shared geometry, numerical,
composition, travel and machine requirements. [Skill development](DEVELOP.md)
owns manual authorship and discovery metadata.

Package implementation notes cover [planar infill](planar-infill/DEVELOP.md),
[assigned supports](supports/DEVELOP.md) and the shared
[rimming design](rimming-planar/DEVELOP.md). Read these when changing the relevant
producer or its integration with shared components.
