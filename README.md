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

The first development demo is an UltiMaker S5 wedge with horizontal body layers
and a 15° inclined skin. It includes native Rhino geometry, SAAMpath, Griffin
G-code, automated checks, and a local SAAM Studio viewer.

[Full-fill](skills/full-fill/SKILL.md), [planar-infill](skills/planar-infill/SKILL.md)
and [draped-skin](skills/draped-skin/SKILL.md)
share operation composition, export and the Studio approval/delivery workflow.
Their manuals own their current shapes and limitations. STL/mesh input and
restricted spline shapes are supported. All three have software checks against
S5 and H2D profiles; H2D runnable export is pending a verified startup/output
envelope. General trimmed CAD import is not implemented.
Software checks do not establish physical
print success. The user has reported that the latest S5 wedge startup avoids bed
leveling and unused-nozzle heating; complete print validation remains open.
See [implementation and observations](DEVELOP.md).

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
recoverable from Git history; no legacy component has been adopted. Adopting an
old component or concept requires explicit human approval.
See [legacy reference](DEVELOP.md#legacy-reference).

The canonical repository is [Struder-AI/SAAM](https://github.com/Struder-AI/SAAM).
Licensing remains in [LICENSE](LICENSE).
