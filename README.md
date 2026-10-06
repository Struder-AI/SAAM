# SAAM — Struder Agentic Additive Manufacturing

SAAM lets you describe a part to an AI agent, inspect the toolpath it proposes
and export a file your machine can run.

SAAM lowers the barrier to 3D printing. You should be able to point your agent
at this repository, describe what you want to make, and receive guidance suited
to your experience, without needing to learn CAD, slicing, or programming first.

## How it works

Describe your part in chat. Your agent prepares a shape to inspect in **SAAM
Studio**, works out the printing settings with you, and generates the toolpath
for review. You confirm the geometry, then settings and toolpath together. SAAM
then delivers the same machine-program bytes you reviewed.

Your agent handles the tools and settings; you guide the result. See the
[maker workflow](MAKERS.md#maker-interaction-flow) for how revisions and export
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
with explicit, narrow exceptions. Print bundles keep geometry, the recipe,
the checked export, and review records together locally. The
[developer principles](core/README.md#interoperability-and-one-workflow) explain
how changes extend this shared system.

## What works today

This is a development checkout. Choose a pattern through the [skill
index](skills/DIGEST.md); each manual owns its current shapes, settings and limits.
[Machine support and output contracts](core/export/README.md#machine-interoperability-design)
describe what each machine's export and playback cover, including the scope of
reported physical observations. Software checks do not establish physical print
success.

The [SAAM application](core/application/README.md) owns Studio and jobs. Desktop
chats use its installed `saam` command.

## Get started

Give your agent this repository and describe what you want to make. Agents start
at [AGENTS.md](AGENTS.md), which routes making, development and setup work.

For a manual development trial, follow [setup and checks](SETUP.md) and create a
preview from a skill recipe. It produces a development preview, not an exportable
program.

Ask your agent to **open the SAAM tour**, or launch Studio after setup:

```sh
node scripts/saam.mjs start-tour
```

The [guided tour](examples/prints/README.md) uses one editable fin block in the
same Studio used for your parts. Your copy and lesson survive restarts in the
SAAM home. Explore geometry, playback, chat edits, setup and export; software
examples grant no physical qualification.

## Reading and contributing

Start with [role selection](AGENTS.md#choose-your-role) for code or documentation
work; [builder orientation](BUILDERS.md) supplies the shared engineering baseline.
The [dev maps](dev-map/README.md) show what SAAM code influences, generated from
the source; agents walk them from map `0` with `read-map ADDRESS` through the
agent toolkit.
Use the [technical overview](TECHNICAL-OVERVIEW.md) and [0.2.0 plan](plans/0.2.0.md)
for architecture and build scope, [GLOSSARY.md](GLOSSARY.md) for terms, the
current release intent in [plans](plans/) for direction and outstanding work,
[DECISIONS.md](DECISIONS.md) for decision history, and [DEVLOG.md](DEVLOG.md)
for dated work and evidence.

The canonical repository is [Struder-AI/SAAM](https://github.com/Struder-AI/SAAM).
Licensing remains in [LICENSE](LICENSE).
