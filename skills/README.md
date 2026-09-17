# Skills

This brief digest introduces the available capabilities and why they may help
with a part. Printing skills describe deposition patterns; task skills operate
on geometry or other preparation work. Follow the selected manuals for tools,
settings and supported scope.

All three onboarding paths include this complete catalog as starting context. Judge
which skills and references fit the task, then read each selected manual
individually before using or changing the skill. Follow further references when
their responsibilities affect the work; onboarding alone is not sufficient.

<!-- BEGIN GENERATED SKILL DIGEST -->

## Printing patterns

| Skill | Capability and value |
|---|---|
| [planar-infill](planar-infill/SKILL.md) | Print conventional flat-layer walls with a patterned interior, varying infill density to control material use or leave a hollow body. Supports closed meshes and supported spline geometry; combine with full-fill for solid tops and bases. |
| [full-fill](full-fill/SKILL.md) | Fill an entire body with solid planar layers, or add solid bases, caps and surface regions around sparse infill. Works on closed meshes and supported spline shells, providing solid material where the part needs it. |
| [plastic-weld](plastic-weld/SKILL.md) | Inject molten plastic into blind shafts with wider bottom basins to form experimental rivets across printed layers. Place individual reinforcement points or stagger them through a solid body. Sparse interiors receive explicit solid envelopes and floors; strength and sealing need physical trials. |
| [supports](supports/SKILL.md) | Add conventional supports beneath selected areas or explicitly placed tree branches at local contacts. Choose their placement to balance support, surface contact and removal access; the agent and maker assign areas through judgment. |
| [rimming-planar](rimming-planar/SKILL.md) | Experiment with thin walls that support selected edges so a planned bridge can span the area between them. A maker-assigned spline surface connects the bed or another edge to the supported edge; paired beads use horizontal offsets. |
| [rimming-normal](rimming-normal/SKILL.md) | Experiment with edge-support walls whose paired beads follow 3D surface-normal offsets, allowing nonplanar paths on a curved reference surface. Compare with rimming-planar to explore how offset direction affects bead spacing and edge contact; physical behavior remains unvalidated. |
| [draped-skin](draped-skin/SKILL.md) | Follow a sloping or curved roof with top-skin strokes instead of approximating it with flat-layer steps. Works on continuous accessible mesh or supported spline roofs within the machine's nonplanar angle limit; excluded steep areas are reported. |
| [wave-overhangs](wave-overhangs/SKILL.md) | Experiment with continuous wave passes on curved bivariate spline slices, including flat slices. Grow from explicitly assigned supported seeds with physical surface spacing. Reject slices requiring disconnected passes; hole-branch continuity remains incomplete. Single regular spline charts; physical printing remains unvalidated. |
| [vase-wall](vase-wall/SKILL.md) | Print a conventional hollow vase or tube with one continuous rising spiral wall and an optional solid base. Use advanced vase mode for motifs, authored patterns and fitted mesh sleeves. |
| [advanced-vase-wall](advanced-vase-wall/SKILL.md) | Print repeating motifs and authored patterns mapped onto a reference sleeve, with optional smooth mesh fitting, adjustable mesh fidelity and loose offsets. Use standard vase mode for a conventional continuous spiral. |
| [thick-lip](thick-lip/SKILL.md) | Thicken a vase-wall's top edge into a rigid, optionally rolled rim instead of leaving a single spiral or level-ended bead. Use when the operator asks for a rim, brim, bead, rolled edge, round-over or a more durable/rigid lip on a vase-mode print. |
| [pipe-cladding](pipe-cladding/SKILL.md) | Wrap a substrate with alternating lengthwise and helical cladding, or opposite-handed helices for a crossed exterior pattern. Supports circular pipes and explicitly mapped periodic spline or mesh surfaces; this development capability requires a configured DENSO RC8 robot and external rotary. |

## Geometry processing

| Skill | Capability and value |
|---|---|
| [thingi10k](thingi10k/SKILL.md) | Find meshes by descriptive keywords or a Thingiverse link, then download individual STL files from the Thingi10K mirror for Studio review. Preserve attribution and always link the file's license in chat; prefer tailored geometry when making it is attractive. |
| [mesh-tools](mesh-tools/SKILL.md) | Diagnose mesh import failures, clean duplicate or collapsed facets, and repair self-intersections with CGAL local patches. Supports explicitly bounded hole filling, preserves source files and reports shape changes for geometry review. |
| [text](text/SKILL.md) | Add raised or recessed lettering to a part, or create standalone text, using a supplied outline font. Lay out lettering flat, optionally along a spline baseline, then bend its solid onto a part surface or an independent spline guide. The resulting mesh goes through the shared printing and Studio review workflow. |
| [gridfinity](gridfinity/SKILL.md) | gridfinity |
| [heat-set-inserts](heat-set-inserts/SKILL.md) | Add catalog-sized heat-set insert bores with six local wall loops and radial fins connecting their sleeves to the insertion face. Uses shared planar fill, infill, assemblies, and material regions. Includes SPIROL Series 19/29 metric and imperial inserts; insertion faces must be flat and face up in the build orientation. |

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
Builders and developers start at [BUILDERS.md](../BUILDERS.md) for shared geometry, numerical,
composition, travel and machine requirements. [Skill development](AUTHORING.md)
owns manual authorship and discovery metadata.

Package implementation notes cover [planar infill](planar-infill/BUILDER.md),
[assigned supports](supports/BUILDER.md) and the shared
[rimming design](rimming-planar/BUILDER.md). Read these when changing the relevant
producer or its integration with shared components.
