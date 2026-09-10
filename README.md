# SAAM — Struder Agentic Additive Manufacturing

SAAM lets you describe a part to an AI agent, inspect the toolpath it proposes,
approve it, and get a file your machine can run.

SAAM lowers the barrier to 3D printing. You should be able to point your agent
at this repository, describe what you want to make, and receive guidance suited
to your experience, without needing to learn CAD, slicing, or programming first.

## How it works

1. Describe your part. Your agent prepares geometry for you to inspect in
   **SAAM Studio**, and revises it with you until you approve it.
2. Agree on the process plan: how the part will be printed, with which machine,
   material, patterns, and settings.
3. Inspect the generated toolpath in Studio and approve it. SAAM delivers the
   same machine-program bytes you reviewed.

The locked process plan generates **SAAMpath**, our internal toolpath
representation, then an export supported by the machine. Automated checks run
before Studio displays that export. Delivery adds no fourth approval.

## Project direction

SAAM is an ecosystem of composable slicer components. Skills describe printing
patterns and package their manuals and tools together. The aim is to combine
patterns in one part, including planar, inclined, and curved deposition layers,
through one generation, review, and delivery workflow.

The intended scope includes spline curves and surfaces, mesh geometry,
3D printers, robot arms with printing end effectors, rotaries, and multi-axis
setups. Output adapters can target G-code, Lua, or other machine languages.
This is the product direction, not a list of implemented capabilities.
Contributor approval status is recorded in [DECISIONS.md](DECISIONS.md);
the direction remains provisional where only one approval is recorded.

Mesh imports use native indexed triangles. Existing spline geometry keeps direct
spline slicing and Rhino/3DM storage; both backends serve the same skill queries.
See [geometry interoperability](DEVELOP.md#geometry-interoperability-for-skill-authors)
and the requested direction in [D-021](DECISIONS.md#d-021--native-mesh-geometry).
Skills should work across geometry types and machines through shared interfaces,
with explicit, narrow exceptions. Prints keep geometry, the process plan,
SAAMpath, and its export together locally.

## What works today

The bounded development demo supports an UltiMaker S5 or experimental Bambu H2D wedge with horizontal body layers
and a planar roof up to 15° in any direction. It includes native eight-point mesh geometry, SAAMpath, machine-specific
export, automated checks, and a local SAAM Studio viewer. The same bounded wedge
also has configured Dobot software export/review/delivery checks.

[Full-fill](skills/full-fill/SKILL.md), [planar-infill](skills/planar-infill/SKILL.md),
[draped-skin](skills/draped-skin/SKILL.md) and [vase-wall](skills/vase-wall/SKILL.md)
share operation composition, export and the Studio approval/delivery workflow.
Their manuals own their current shapes and limitations. STL/mesh input and
restricted spline shapes are supported. Vase-wall prints a continuous rising
outer wall from a single supported convex section. Skills can be assigned to
different material regions of the same part: for example, a solid base, vase
wall with a level ending, flat cap, infill beneath a draped roof, then horizontal
full fill above that wavy surface. Shared boundaries account for material and
printing order; experimental bridging and geometry limits remain explicit.
See [material regions](DEVELOP.md#material-regions-and-shared-interfaces).
These skills have software checks against S5, H2D and configured Dobot profiles.
H2D has experimental sliced-3MF export through the same
review/delivery workflow; its firmware service routines are not simulated.
See the [H2D output scope](DEVELOP.md#h2d-output-contract). General trimmed CAD import is not implemented.
Software checks do not establish physical
print success. The user has reported that the latest S5 wedge startup avoids bed
leveling and unused-nozzle heating; complete print validation remains open.
See [implementation and observations](DEVELOP.md).

The experimental [Dobot MG400 output](DEVELOP.md#dobot-output-contract) uses the
same bundles, three approvals and exact-byte delivery. It requires supplied
installation settings and exports a Lua source ZIP. Playback covers a bounded
fixed-orientation command model; robot clearance, actual relay deposition and
vendor project-import acceptance remain unvalidated.

The [local MCP adapter](adapters/mcp/README.md) lets a compatible local chat
client create and adjust prints, open Studio, generate approved plans and deliver
reviewed files. Its small fixed lists cover this development checkout; automatic
discovery is [deferred](DECISIONS.md#d-022--defer-automatic-capability-discovery).
No MCP tool approves a job. Arbitrary browser-chat access is not implemented.

## Try the development demo

With Node.js 22+ and Git:

```sh
npm ci
npm test
npm run demo
npm run studio
```

Open [SAAM Studio](http://127.0.0.1:4321). The demo uses right nozzle #2,
AA 0.4 and PLA at 215°C. Standard S5 startup is assumed; installed firmware
information is optional. Its development preview creates no human approvals.
Physical clearance is the operator's responsibility for this demo.
Read the [wedge skill](skills/wedge-demo/SKILL.md) for the three-approval
workflow, or [full-fill](skills/full-fill/SKILL.md) for the shared-core workflow:

```sh
npm run shell -- init Prints/my-part
npm run studio -- Prints/my-part
```

Local print bundles belong in ignored `Prints/`; curated examples belong in
`examples/prints/`. A personal architecture map may live in ignored
`.local/architecture-map/`; it is optional and is not shipped in the repository.

## Reading and contributing

This README introduces the project to people and agents. Agents can use it for
product context. [AGENTS.md](AGENTS.md) routes agents to the instructions for
their task: maker agents use SAAM, and developer agents build it and exercise
the maker workflow in development tests.

- [MAKERS.md](MAKERS.md): guidance for helping a person make a part.
- [DEVELOP.md](DEVELOP.md): developer rules, setup, shared formats and organization.
- [skills/README.md](skills/README.md): available printing skills and their manuals.
- [GLOSSARY.md](GLOSSARY.md): shared terms.
- [DECISIONS.md](DECISIONS.md): contributor choices and approval status.
- [build_request.md](build_request.md): requested work and dated implementation history.

This is a clean restart with selective adoption. The previous runtime remains
recoverable from Git history. The user authorized restoration of MCP access,
Dobot machine/Lua support and vase-wall on 2026-09-09 through the shared pipeline.
Further legacy components require explicit human approval before adoption.
See [legacy reference](DEVELOP.md#legacy-reference).

The canonical repository is [Struder-AI/SAAM](https://github.com/Struder-AI/SAAM).
Licensing remains in [LICENSE](LICENSE).
