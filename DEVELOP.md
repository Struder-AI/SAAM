# Developing SAAM

SAAM is a composable slicing system operated through an AI agent. The product
goal is to make advanced printing workflows accessible through conversation,
while retaining explicit control over geometry, process choices and machine
output. [MAKERS](MAKERS.md) defines the user workflow; this document establishes
the engineering direction and routes development work to its owning context.

## Design direction

Skills implement deposition strategies over shared geometry and motion
interfaces. The intended scope spans planar, inclined and curved deposition,
mesh and spline geometry, conventional printers and multi-axis machines.
Current support is defined by each component's contracts and limits.

Composition is the central architectural requirement. Combining a wall, infill
and roof requires material ownership, operation dependencies, compatible geometry
and valid transitions across skill boundaries. Evaluate an extension through its
producers and consumers, including export and review. A shared exporter alone
does not establish that two skills compose.

Use one generation, review and delivery workflow, with narrow adapters for
different recipes and machines. Extend shared interfaces around demonstrated
needs. Necessary parallel paths need explicit responsibilities, boundaries and
integration points. [Core architecture](core/README.md) locates the implemented
stages and current exceptions.

## Engineering priorities

Prefer designs that make consistency structural. Review and delivery consume
the same machine-program bytes; consumers reuse the owning validation result
for unchanged inputs. Apply the same approach to algorithms, derived data and
documentation: reduce independently maintained representations and give each
operation a clear owner. Judge an abstraction by the duplication and coordination
it removes, including the obligations it creates for collaborators.

Use established numerical methods through small shared interfaces. Preserve
their preconditions, topology and tolerance semantics, and evaluate adaptations
against reference behavior. Precision belongs to a quantity and an operation;
accuracy, supported geometry and cost should be explicit enough to assess a
tradeoff. The [geometry reference](core/geom/README.md) defines these contracts.

Measure performance from a user action to the useful result, with stage timings
that identify the responsible work. Examine whether a computation is necessary,
already available or better scheduled elsewhere. Reuse requires valid input and
runtime identity; background work must preserve responsiveness. A production
check likewise needs a concrete failure to detect and evidence that its cost
and placement are justified. Distinguish algorithmic preconditions from printing
decisions that require domain judgment.

## Working context

Use source to establish current behavior, recorded decisions to establish agreed
direction, and evidence to evaluate a proposed change. Keep assumptions and
unresolved questions explicit. Software tests, benchmarks, vendor-tool results
and physical prints establish different things; report the scope actually checked.

Leave the next developer a concise account they can reason from. Document the
contracts, assumptions and algorithms that source alone does not convey. Distill
exploratory conversation into precise current guidance, stated once at its owner.
Correct that account when understanding changes. References should resolve
conveniently to source using ordinary repository tools.

Keep that guidance in present tense. [DEVLOG.md](DEVLOG.md) owns completed work
and dated evidence; [build requests](build_request.md#outstanding-work) contains
only outstanding or incomplete work. Build-first work needs no request record
once complete. The [maintenance rules](CONTRIBUTING.md#documentation-maintenance)
define the closeout workflow and provenance exceptions.

## Collaboration

Work within the requested scope and carry authorized implementation through to a
reviewable result. Escalate consequential ambiguity with the evidence and tradeoff.
Delegate independent objectives with their purpose, relevant context and guiding
principles; leave implementation reasoning to the assignee. Coordinate changes
at shared boundaries and pass findings to the collaborators they affect.

## Find context for your task

Start with the affected area and follow its dependencies. Each reference owns a
specific scope; reading neighboring material depends on the change.

| Task | Start here |
|---|---|
| Setup, work authorization, tests or publication | [Contribution practices](CONTRIBUTING.md) |
| Trace the system or change an interface | [Core architecture](core/README.md) |
| Geometry representation, queries, precision or mesh repair | [Geometry](core/geom/README.md) |
| Offsets, intersections or material ownership | [Regions](core/region/README.md) |
| Skill operations, scheduling or travel | [Composition and travel](core/path/README.md), then the relevant [skill](skills/README.md) |
| Plans, validation, persistence, generation or delivery | [Print lifecycle](core/print/README.md) |
| Using shared print commands or changing their task guidance | [Print tools](core/print/USAGE.md) |
| Machine capabilities, emission or interpretation | [Machine output](core/export/README.md), then the selected machine contract |
| Studio interaction, lifetime or rendering | [Studio](studio/README.md) |
| Chat-client connection or adapter tools | [MCP](adapters/mcp/README.md) and its [implementation notes](adapters/mcp/DEVELOP.md) |
| Performance measurement | [Benchmarks](scripts/bench/README.md) and the owning component |
| Maker-facing behavior or end-to-end use | [MAKERS](MAKERS.md) and [development testing](CONTRIBUTING.md#testing-through-the-use-context) |
| Documentation | [Ownership and maintenance](CONTRIBUTING.md#documentation-maintenance) |
| Project direction, outstanding work, history or terminology | Relevant [decisions](DECISIONS.md), [requests](build_request.md#outstanding-work), [devlog](DEVLOG.md) or [terms](GLOSSARY.md) |
