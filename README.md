# SAAM — Struder Agentic Additive Manufacturing

SAAM makes 3D printed parts through conversation. You describe a part to an AI agent; it authors the shape and printing instructions. SAAM builds the toolpath, shows it in Studio, and exports a checked program for your machine. The aim is to make printing accessible without first learning CAD, slicing or programming.

For developers, SAAM is an ecosystem of composable CAD and slicer components. It combines direct control over individual deposits with general slicing, including planar, inclined and curved layers. This README introduces the pieces, their goals and their current limits.

Geometry describes the shape. A recipe assigns printing techniques and settings to it. Material regions decides which technique owns which material. Inject, Trace and Slice construct deposition; SAAMpath records it; the Scheduler chooses its order. Export adapts it to a machine. A Bundle saves the work, and Studio presents it for review. Extensions and workspaces build on these same components.

## Geometry: the CAD toolkit

An ideal CAD toolkit lets callers create shapes, combine them, and ask reliable questions about them without managing a geometry kernel. Smooth curves should stay smooth; conversions and approximation should be explicit. The same operations should work across representations, with useful failures and practical time and memory costs.

| What we want | How SAAM measures up |
|---|---|
| Shared operations across shape types | One interface supplies construction, transforms, sections, containment, intersections and surface queries for spline, mesh and mixed geometry, within each operation's supported cases. Extensions use it to build features such as text and insert holes. |
| Preserve useful shape structure | Rational splines retain controls, knots, weights, trims and named faces. Meshes retain vertices and triangles. Viewer triangles are derived where needed; manufacturing queries can use the original curves and surfaces. |
| Reliable solid operations | Union, difference and intersection are available. Native Booleans still have known periodic/coincident and near-tangent failures; recovery reports any movement of the operands. General trimmed-surface offsets and resolution of self-intersecting offsets remain incomplete. |
| Controlled accuracy and cost | Operations use named physical tolerances, cancellable workers and reusable calculations. Some algorithms still rely on sampled checks, and solid-distance queries still scan triangles. Robustness and performance remain uneven. |

The common toolkit exists; general CAD robustness is still work in progress. [Geometry contracts](core/geom/README.md) describe guarantees, limits and workarounds; [future scope](plans/0.4.0.md) describes further solid and offset work.

## Authoring: formats an agent can write

| Format | What to use it for | Tradeoff |
|---|---|---|
| Blob fields | Organic shapes built from points with a position, reach and strength. Nearby contributions blend; negative strengths carve material. | Easy to sculpt with few values. Printing uses an extracted mesh; features below its sampling scale can be missed. The editable field is retained. |
| Splines | Smooth designed surfaces, exact circles, revolutions, lofts and named reference faces. | Compact control points describe curves precisely. Authors must arrange matching boundaries, orientation and closure. |
| Indexed meshes | Angular forms, explicit facets and imported models. | Direct control through vertices and triangles. Mesh validity matters; an STL has no semantic CAD faces. |

Booleans combine material; assemblies keep named components. Saved curves and points also support Trace and Inject without a solid. [Geometry authoring](GEOMETRY.md) owns the formats and examples.

## Toolpath: Inject, Trace and Slice

**Inject** deposits a volume at a point. **Trace** deposits along a curve. **Slice** fills a 3D region on a sequence of planar or curved surfaces, with walls, infill and process settings.

These share one output interface, so detailed paths can mix with general slicing in one part. Lettering can use Trace, the body Slice, and a plastic rivet Inject. Skills supply techniques through these families. Each publishes material, width, speed, orientation and the work that must precede it. See the [skill index](skills/DIGEST.md) and [Toolpath contract](core/path/README.md).

## SAAMpath: machine-independent toolpaths

SAAMpath records deposition before adapting it to a printer or robot. It stores curves and changing material/process values; a separate execution schedule references ranges of those curves. This avoids copying every deposit into a second list of moves. Splines stay compact where possible; faithful polylines remain available. Studio and exporters read the same representation.

The October 16, 2026 measurements show a large source reduction and the remaining storage overhead in a small integrated example:

| Measurement | Result |
|---|---|
| Pinned dome source, republished from finalized strokes | 84.4 MB → 6.35 MB: about 13.3× smaller, or 92.5% less. Replay checked 2.27 million positions, with maximum change below 0.0004 mm and exact course material totals retained. |
| Actual CLI → Studio → checked S5 program | 32,135 bytes of source + 15,150 bytes of schedule, versus a 33,283-byte program. Source plus schedule is still about 1.42× the program size. |

These measure path storage, not total bundle size: geometry, programs and history also take space. The large probe added publication time compared with its pinned baseline. We have evidence of substantial source savings, but no representative total-bundle reduction figure yet. [Recorded evidence and scope](DEVLOG.md#2026-10-16--finish-recovered-spline-publication-and-source-studio-verification) explain the measurements; [SAAMpath contracts](core/path/README.md) define storage.

## Bundle, Recipe and Material regions

A **Bundle** is the saved project for a part: geometry, recipe (`plan.json`), selected settings, revisions, paths and checked programs. It owns shared part state. A completed output keeps its original inputs and bytes through later edits. Operations ask for what they need, so a geometry draft can exist before choosing a machine. See [Bundle and Recipe](core/print/README.md).

**Material regions** assigns spatial responsibility before toolpath construction: explicit claims select material, and a default technique takes the remainder. This lets techniques share a part without accidentally filling the same assigned volume twice. Ownership is separate from print order; sparse infill does not become a solid just because it owns a region. Shared-material interlock cadence remains developer research. See [region contracts](core/region/README.md).

## Scheduler

The Scheduler chooses when to print each piece of work while preserving required predecessors, geometry, material and orientation. It tries whole slices and operations first, splitting or interleaving only where constraints require it. Layers need not follow world Z. Cooling influences the choice among ready tasks. Export resolves actual-nozzle access and travel routes; carriage/fixture collisions, cooling waits and calibrated timing remain future scope. See [scheduler obligations](core/path/README.md#scheduler-obligations).

## Extensions and workspaces

**Extensions** package manuals, scripts, assets and dependencies. They add geometry features and printing techniques through published interfaces. Local extensions survive application updates and can be shared as packages. [Extension authoring](skills/AUTHORING.md) explains the interfaces and lifecycle.

**Workspaces** provide specialized design UIs, such as Wing and light-switch covers. They keep their own design state, then create ordinary bundles for Studio. The [workspace host](workspaces/server.mjs) handles saving and handoff; extensions own the design tools and construction.

## Studio viewer

Studio shows geometry, selections, toolpath playback, material views and supported machine models. It reads the saved path and execution. The person clicks **Export** to confirm the displayed settings and exact checked program; delivery preserves those bytes. Failed or cancelled regeneration restores the previous output. See [Studio](studio/README.md) and [rendering](studio/RENDERING.md).

## Export adapters

Export turns neutral deposition into a machine program: it resolves actual-tool access, travel, startup, tool/material changes and axes. Adapters emit and interpret the result for checking. Implemented outputs include Griffin, Bambu, Dobot and DENSO, with different extrusion, orientation and installation support. Broader robot, rotary and multi-axis support remains product direction. [Machine manuals](machines/README.md) and [output compatibility](core/export/README.md#output-compatibility) define current support and physical evidence; software checks alone do not establish print success.

## Application and settings

The local **Application** supplies `saam`, Studio windows, agent requests, cancellable jobs, updates and the shared home for prints and extensions. Reusable machine/material profiles and remembered setups become explicit settings saved in a bundle; changing a reusable profile does not silently change an existing part. See [Application](core/application/README.md) and [settings ownership](core/print/README.md).

## Start developing

Follow [SETUP.md](SETUP.md) for Node.js 22+, dependencies and the setup check. After setup, launch the tour with `saam --code-root . start-tour`. Agents start at [AGENTS.md](AGENTS.md); core contributors use `node scripts/agent-toolkit.mjs developer-onboarding`, and extension authors use `node scripts/agent-toolkit.mjs builder-onboarding`.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for module boundaries and runtime flows, [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md) for engineering conventions, [GLOSSARY.md](GLOSSARY.md) for terms, [plans](plans/) for cumulative intent and outstanding work, and [decision records](docs/adr/) for architectural choices. The canonical repository is [Struder-AI/SAAM](https://github.com/Struder-AI/SAAM); licensing is in [LICENSE](LICENSE).
