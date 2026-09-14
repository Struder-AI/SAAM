# SAAM — Struder Agentic Additive Manufacturing

SAAM lets you describe a part to an AI agent, inspect the toolpath it proposes,
approve it, and get a file your machine can run.

SAAM lowers the barrier to 3D printing. You should be able to point your agent
at this repository, describe what you want to make, and receive guidance suited
to your experience, without needing to learn CAD, slicing, or programming first.

## How it works

Describe your part in chat. Your agent prepares a shape to inspect in **SAAM
Studio**, works out the printing settings with you, and generates the toolpath
for review. You approve the geometry, the process plan and the toolpath. SAAM
then delivers the same machine-program bytes you reviewed.

Your agent handles the tools and settings; you guide the result. See the
[maker workflow](MAKERS.md#maker-interaction-flow) for how revisions and approvals
work.

## Project direction

SAAM is an ecosystem of composable slicer components. Skills describe printing
patterns and package their manuals and tools together. The aim is to combine
patterns in one part, including planar, inclined, and curved deposition layers,
through one generation, review, and delivery workflow.

The intended scope includes spline curves and surfaces, mesh geometry,
3D printers, robot arms with printing end effectors, rotaries, and multi-axis
setups. Output adapters can target G-code, Lua, or other machine languages.
This is the product direction; the references below describe implemented scope.
Contributor approval status is recorded in [DECISIONS.md](DECISIONS.md).

Skills should work across geometry types and machines through shared interfaces,
with explicit, narrow exceptions. Prints keep geometry, the process plan,
the checked export, and review records together locally. The
[developer principles](core/README.md#interoperability-and-one-workflow) explain
how changes extend this shared system.

## What works today

This is a development checkout. Choose a pattern through the [skill
index](skills/README.md); each manual owns its current shapes, settings and limits.
[Machine support and output contracts](core/export/README.md#machine-interoperability-design)
describe what each machine's export and playback cover, including the scope of
reported physical observations. Software checks do not establish physical print
success.

The [MCP adapter](adapters/mcp/README.md) connects compatible chat clients to the
same local workflow. Its manual covers available tools and local stdio connections.

## Get started

Give your agent this repository and describe what you want to make. Agents start
at [AGENTS.md](AGENTS.md), which routes making, development and setup work.

For a manual development trial, follow [setup and checks](SETUP.md)
and the [wedge demo manual](skills/wedge-demo/SKILL.md). The demo produces a
development preview; human job approval remains separate.

Ask your agent to **open the SAAM tour**, or launch Studio after setup:

```sh
node studio/server.mjs
```

The [guided tour](examples/prints/README.md) takes you through a bivariate surface
drape, wavy DENSO cladding, and Nudge Cup in the same viewer used for your parts.
Their geometry, settings and toolpath previews are ready to explore. Studio saves
your copies automatically in ignored `Prints/tour/`, remembers your place, and
lets you revisit them with **Open print**. **Use this example** starts the normal
review workflow; exploring a demo grants no printing approvals.

## Reading and contributing

Start with the [developer orientation](DEVELOP.md) for code or documentation
work. Use [GLOSSARY.md](GLOSSARY.md) for terms, [DECISIONS.md](DECISIONS.md) for
contributor choices, the [build requests](build_request.md#outstanding-work)
for outstanding or incomplete work, and [DEVLOG.md](DEVLOG.md) for dated work
and evidence.

The canonical repository is [Struder-AI/SAAM](https://github.com/Struder-AI/SAAM).
Licensing remains in [LICENSE](LICENSE).
