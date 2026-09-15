# Developing SAAM

For developer work with missing context, run
`node scripts/agent-toolkit.mjs developer-onboarding` directly; use `--area AREA`
when the affected component is already known. The command returns this manual,
core architecture and the complete skill digest, plus the requested area context.
Use that returned text without reading the same sources before or after the
command. If the developer context is already loaded, continue from it and read
only missing task-specific references. Individual skill manuals remain separate
choices. A client without command access reads the same sources directly once.

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

Build the smallest coherent implementation that serves current capabilities and
the work being implemented. Keep the core compact; expand its shared interfaces
as concrete producers and consumers need new behavior. Each abstraction,
configuration option and dependency should earn its place through a present
requirement or demonstrated simplification. Prefer removing duplication and
obsolete paths over adding another layer.

Consider future directions to preserve economical growth: choose clear ownership
and boundaries that can accommodate plausible extensions without a broad rewrite.
That consideration does not authorize future features, unused hooks, generalized
frameworks or speculative configuration. Keep future possibilities in the design
reasoning until implementation needs them. Minimal means completing the requested
behavior with little machinery, not deferring required integration or building a
throwaway shortcut. When simplifying existing code, identify the concrete cost
and check its current consumers before removing it.

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
and placement are justified. Apply that standard to agent workflows and CI under
[Avoid check spirals](#avoid-check-spirals); task boundaries and commits do not
create verification work. Distinguish algorithmic preconditions from printing
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

Keep present behavior and contracts in their owning manuals, future work and
proposals clearly marked at their owners, and past work and observations in
[DEVLOG.md](DEVLOG.md). Future possibilities must not read as implemented
capabilities. Implement current requests directly; do not create a build-request
record before starting or while carrying them through. [Build requests](build_request.md#outstanding-work)
retain authorized work deferred or left incomplete beyond the active task, or
work the human explicitly asks to put in the backlog. Completed work needs no
build-request record. Follow [documentation maintenance](#documentation-maintenance).

Describe what was actually established. Record approvals as given, without
extending their scope: a software simulation does not establish a physical result,
approval of a capability does not approve an old implementation, and one person's
instruction does not establish another person's agreement. This adds no approval
procedure or requirement to collect more evidence for every change.

## Collaboration

Work within the requested scope and carry authorized implementation through to a
reviewable result. Escalate consequential ambiguity with the evidence and tradeoff.
Delegate independent objectives with their purpose, relevant context and guiding
principles; leave implementation reasoning to the assignee. Coordinate changes
at shared boundaries and pass findings to the collaborators they affect.

Tasks sharing a checkout preserve concurrent edits and keep its current contributor
branch. If the checkout is on main, create a contributor branch before editing;
publish through a pull request unless direct main work is explicitly authorized.
Reread affected lines before editing. Infer scope and dependencies from the work,
source history and recorded context; resolve concrete conflicts without requiring
humans to maintain a coordination ledger. Preserve other tasks' unfinished work.
An authorized checkpoint includes all non-ignored work by default, across tasks,
unless the user explicitly narrows it. There is no blanket requirement to
checkpoint before starting.

Read [checkpoint and publication guidance](CONTRIBUTING-AGENTS.md) after doing the
work, immediately before an authorized checkpoint or remote activity; read it
earlier when integration or publication is itself the task.

## Context and selective adoption

The current checkout's instructions, shared contracts and the user's authorization
govern development. Older repositories, transcripts and saved branches are
reference material; their past requirements do not become current requirements
by entering an agent's context. Resolve a conflict with current scope before
silently importing an older design.

Before admitting a component or method from superseded or outside work, identify
its purpose and provenance, compare actual producers and consumers with current
geometry, composition, machine and lifecycle interfaces, and obtain explicit
human approval for that selective adoption. Existing approval applies to its
stated scope. Approval of a concept does not approve its previous implementation;
a merge, passing test or catalog entry does not establish architectural fit or
machine support. Ordinary authorized development adds no per-task approval gate.

## Build-request provenance

These rules apply when recording work that belongs in the
[backlog](build_request.md), not when starting an ordinary build, fix or maker
task. Do the requested work directly. Do not create a temporary request merely
to document its authorization, and do not apply the backlog's field schema to
ordinary devlog entries.

A backlog item must be explicitly human requested or an agent proposal explicitly
approved by a human. When an item is needed, use the [request format](build_request.md)
to record its contributor, source, session when available and originating context.
Reuse identity already established in conversation or available project/client
context without reconfirmation. Record attribution as inferred or unconfirmed
when that is all the evidence supports; Git identity alone is not proof of who
spoke. Missing contributor or session metadata is a recording limitation: it must
not trigger identity questions, transcript searches or delays during ordinary
work. Investigate historical provenance only when that investigation is requested.

The recorded scope must cover the actual remaining work. A requested audit can be
complete with findings and guidance; its recommendations do not automatically
authorize every proposed fix. Missing acceptance evidence can be an unfinished
check of requested behavior, but it does not commission a new study, additional
feature or physical trial. Explain that relationship in the request. Unapproved
ideas stay labeled as proposals at their owner, outside the work queue. An
explicitly committed but deferred request retains its deferral; listing it does
not authorize starting it early. A later audit of the queue is not blanket approval
of its contents.

When reviewing existing requests, check original human messages, later scope
changes, implementation and recorded outcomes. Preserve concise evidence and the
disposition in [DEVLOG.md](DEVLOG.md) when removing completed, superseded, cancelled
or never-authorized work; retain only the authorized remainder of partial work.
Move existing provenance with the record and preserve IDs and useful links. Keep
raw private transcripts out of shared Git. This records existing authorization;
it adds no identity-confirmation step, second approval, contributor-consensus
requirement, manufacturing approval or software-test gate.

## Avoid check spirals

Choose verification for the behavior being changed and a concrete failure it
could introduce. Use [existing coverage](core/tests/README.md) first. Once the
applicable checks resolve the uncertainty, continue toward completion. Run or
broaden checks again only when relevant inputs change, a failure appears, or a
specific uncertainty remains. Reuse valid results across tasks and contributors.

Checkpointing, publication, rereading guidance and task completion do not
invalidate results or create a verification pass. Prose-only edits and read-only
work need no software tests. Use the full suite only for broad integration risk
or a user request; skill manuals add no second gate. Setup belongs to first use
of an environment, with reuse governed by [SETUP.md](SETUP.md).

A check in production, CI or an agent workflow must earn its cost through a
concrete failure it detects. Account for compute, maintenance, false rejections
and interruptions. Reuse the owning result for unchanged inputs. Reconsider an
ineffective heuristic before adding a user-facing bypass. When a proposed
geometry, toolpathing or extrusion gate has ambiguous value or placement, discuss
its failure case, evidence, cost and alternatives within existing authorization.
A maker's judgment about a print does not itself change general product policy.
Resource-budget failures should state the limit and how to raise it, leaving
geometry and quality choices explicit.

## Reproducible examples

The [three demo workspaces](examples/prints/README.md) package editable recipes
for surface drape, wavy DENSO and Nudge Cup. The creation command refuses existing
destinations. Use `--generate` for unapproved development toolpaths, then inspect
geometry and toolpath in Studio.

## Testing through the use context

Develop and exercise maker-facing changes through [MAKERS.md](MAKERS.md), public
tools and the relevant skill manuals. Assess the affected experience, including
installation, discoverability and recovery when relevant to the change.

Use isolated projects, fixtures and machine simulators. Synthetic approvals are
test data and must not authorize real jobs. Hardware execution and human print
approvals remain with the person. Report software and physical results separately.

A demo's setup, assets and recipe assumptions must be reachable from its skill
manual for a fresh part. Put reusable preparation in packaged tools and describe
necessary settings there, rather than relying on the originating conversation.

## Documentation maintenance

Write current manuals and contracts in present tense, and label proposals and
future work by status. Update the owning account alongside the implementation.
Move completed-work narratives and dated measurements to [DEVLOG.md](DEVLOG.md);
retain current limits and reproducible procedures at the component owner. Git
retains superseded source. No separate documentation closeout gate is needed.

| Question | Owner |
|---|---|
| Product purpose and direction | [README.md](README.md) |
| Agent orientation and task selection | [AGENTS.md](AGENTS.md) and this document |
| Maker interaction and print approval | [MAKERS.md](MAKERS.md) |
| Installation and first-use capability | [SETUP.md](SETUP.md) |
| Checkpointing and remote contribution | [Contribution guidance](CONTRIBUTING-AGENTS.md), at that stage |
| Test design and coverage selection | [Test reference](core/tests/README.md) |
| Implementation contracts | [Core](core/README.md), [Studio](studio/README.md), [adapter](adapters/mcp/DEVELOP.md) and their owning references |
| Print operations and skill tools | [Print tools](core/print/USAGE.md) and relevant [skill manuals](skills/README.md) |
| Skill authorship and catalog maintenance | [Skill development](skills/DEVELOP.md) |
| Shared terms | [GLOSSARY.md](GLOSSARY.md) |
| Contributor decisions and approval status | [DECISIONS.md](DECISIONS.md) |
| Outstanding or incomplete work | [build_request.md](build_request.md) |
| Completed work and dated evidence | [DEVLOG.md](DEVLOG.md) |

Preserve exact decision quotations, approval events, approved wording and license,
third-party or fixture provenance notices with their dates. Surrounding guidance
still describes current behavior. A historical narrative in a technical manual
does not become an exception merely by being there.

Place specialized instructions where the operation or failure makes them useful;
the same manuals should serve local agents and the connector's manual reader.
Architectural references should explain boundaries and consumers and link to
owning source using ordinary repository tools. Review claims against source and
recorded evidence. The optional `node scripts/check-repo.mjs` diagnoses document
links, open-request and decision metadata, skill digest/catalog consistency and
private-file exclusions; it cannot establish factual accuracy, human approval or
printability. Use it to resolve those concrete maintenance uncertainties.

## Find context for your task

Start with the affected area and follow its dependencies. Reuse sources/sections
already returned by onboarding, including an explicitly selected `--area`.
Each reference owns a specific scope; reading neighboring material depends on
the change. Checkpoint/publication guidance belongs at that stage, and maker
guidance is needed when developing or exercising the maker-facing workflow.

| Task | Start here |
|---|---|
| Unused checkout | [Setup](SETUP.md) |
| Choosing or changing tests | [Avoid check spirals](#avoid-check-spirals), then [test reference](core/tests/README.md) |
| Checkpoint or remote activity, after implementation | [Contribution guidance](CONTRIBUTING-AGENTS.md) |
| Skill authoring and discovery metadata | [Skill development](skills/DEVELOP.md) |
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
| Maker-facing behavior or end-to-end use | [MAKERS](MAKERS.md) and [development testing](#testing-through-the-use-context) |
| Documentation | [Ownership and maintenance](#documentation-maintenance) |
| Project direction, outstanding work, history or terminology | Relevant [decisions](DECISIONS.md), [requests](build_request.md#outstanding-work), [devlog](DEVLOG.md) or [terms](GLOSSARY.md) |
