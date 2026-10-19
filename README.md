# SAAM — Struder Agentic Additive Manufacturing

SAAM makes geometry, toolpaths, and machine code for 3D printing through conversation with an AI agent, combining agent-native CAD, nonplanar slicing, and bespoke 3D printing techniques.

## Get started

Ask desktop Codex or Claude Code: “Install SAAM from https://github.com/Struder-AI/SAAM.”
Agents begin at [AGENTS.md](AGENTS.md) and follow the [installation guide](https://github.com/Struder-AI/SAAM/releases/latest/download/INSTALL.md).

## Studio and interaction

Studio is the WebGL viewer for geometry, toolpaths and machine playback. An AI agent drives most Studio changes, the user interacts with the agent through Codex desktop or Claude code desktop. See [Studio](studio/README.md) and [Application](core/application/README.md).

## Geometry

The CAD toolkit that creates, combines and queries shapes. Aspirationally, SAAM's geometry toolkit is a small, capable set of tools that is curated for 3d printing needs, and that significantly augments agent capabilities in 3D space. See [Geometry](core/geom/README.md).

## Authoring

Agents can write geometry directly: **blob fields** for organic shapes, **splines** for smooth designed surfaces, and **meshes** for angular forms. See [geometry authoring](GEOMETRY.md).

## Toolpath

Three core operations:
- **Inject** deposits material at a point.
- **Trace** deposits along a curve.
- **Slice** is the primary versatile component that covers most situations. Composes into slice stacks. See [toolpath](core/path/README.md).

## Scheduler

Chooses the order of printing while respecting dependencies, access and cooling. It can interleave techniques generated independently by toolpath. See [scheduling](core/path/README.md#scheduler-obligations).

## SAAMpath, recipes, and bundles

SAAMpath: internal machine-independent format with built in compression stores path, effector pose, deposition parameters, and process settings for Studio and exporters.

The "recipe" describes how to print one or more material regions with specific technique(s). A bundle is the saved project: geometry, recipe, settings, and SAAMpath. See [bundles](core/print/README.md) and [regions](core/region/README.md).

## Extensions

Scripts that compose SAAM’s geometry and toolpath operations can be used to make an endless variety of bespoke 3D printing techniques. Share your innovations with other SAAM users.
 See [extension authoring](skills/AUTHORING.md).

Workspace extensions additionally add custom UI scenes, and output ordinary bundles for review in Studio. See [workspace authoring](skills/AUTHORING.md).

Machine adapter extensions translate SAAMpath into machine programs, handling machine-specific motion, tools and startup. Create one for your own machine and share it with the community. See [machine support](machines/README.md).

## Developing

Start with [SETUP.md](SETUP.md), then [ARCHITECTURE.md](ARCHITECTURE.md). Agents begin at [AGENTS.md](AGENTS.md). Current direction and outstanding work live in [plans](plans/).

[Repository](https://github.com/Struder-AI/SAAM) · [License](LICENSE)
