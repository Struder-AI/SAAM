# Developer context

## Orientation

Start with the system map and the affected region, then read the source it names.
Developer onboarding supplies the system map and maps for selected `--area`
values. Use `node scripts/agent-toolkit.mjs read-map PAGE` for missing regions;
the returned context includes the calculated references to every other mapped
use of a shared component. Reuse regions already consumed.

Dev maps cover core and Studio. Builders read affected maps when changing or
investigating those internals. Skill-script work needs skill guidance and the
consumed API contracts; it does not automatically require dev maps. Developers
load maker workflow, print tools and skill-authoring manuals when the task needs
them. Responsibilities do not require every lower-role manual.

| Scope | Map key | Caller contract |
|---|---|---|
| System | `0_system` | [Core boundaries](core/README.md) |
| Print lifecycle | `1_lifecycle` | [Lifecycle](core/print/README.md) |
| Generation | `2_generation` | [Plan and composition](core/path/README.md) |
| Geometry | `3_geometry` | [Geometry](core/geom/README.md) |
| Regions | `4_regions` | [Regions](core/region/README.md) |
| Motion | `5_motion` | [Composition](core/path/README.md) |
| Output | `6_output` | [Output](core/export/README.md) |
| Studio | `7_studio` | [Studio](studio/README.md) |
| Machine presentation | `8_machine` | [Models](core/machine/README.md) |
| Agent tools | `9_agent` | [Toolkit](core/agent/README.md) |

The [map guide](maps/README.md) owns commands and source syntax; the
[map contract](BUILDERS.md#maps-and-local-documentation) owns reading, shared-use
and documentation rules. Build the [viewer](dev-map/index.html) with
`node scripts/dev-map.mjs build` for the same source rendered for people; it is
generated and git-ignored. Its Doc button shows the owning region's supporting
context and shared contracts.

The implementation bin has been absorbed into the region sources. Kernel
verification and reference-generation procedures now live with
[region benchmarks](scripts/bench/region-reference.md). Consult
[tests](core/tests/README.md) for a concrete verification task. Client adapters
and skill implementations remain outside dev-map scope: use
[MCP development](adapters/mcp/DEVELOP.md), [skill authoring](skills/DEVELOP.md)
and the selected skill's role manuals. Machine declarations remain in
[machine files](machines/README.md).
