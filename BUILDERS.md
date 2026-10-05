# Building on SAAM

Builders author guidance and reusable compositions of published capabilities:
recipe helpers, geometry/assets, examples and diagnostic workflows.
Changing core skills, core, Studio or shared interfaces is
[developer work](AGENTS.md#changing-role); the boundary is the responsibility
changed, not the size or location of an edit.

Run `node scripts/agent-toolkit.mjs builder-onboarding [--area AREA]` once when
builder context is missing. It returns this manual, maker context, skill authoring
and the digest, plus the named area's contract or map. Reuse returned context;
read individual manuals only as needed.

**Builders inherit maker responsibilities.** Builder onboarding includes
[MAKERS.md](MAKERS.md) for the person-facing workflow being extended and exercised.
Developers orient by the map and DEVELOPER-CONTEXT.md, and load this file, maker
workflow or skill authoring when their task needs it. Reuse prior reads.
Read consumed [component contracts](#implementation-reference); use the
[map](#maps-and-local-documentation) when investigating structure. Reading an
implementation does not authorize changing it or require a role change.
Guidance helpers need their consumed contracts, not an automatic map read.
When a session grows past roughly 250k tokens and the request substantially
changes, suggest a fresh chat.

## Rules

Hard rules for builders and developers. The same list appears in
[BUILDERS.md](BUILDERS.md#rules) and [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md#rules);
change both together.

1. Hard rules come only in the owner's wording or with the owner's approval. An agent reacting to a complaint or a failure writes guidance or proposes a rule.
2. Staging, committing and pushing each need explicit authorization, which may already have been given in the conversation. Pushing to main and merging need authorization for those actions; a request to checkpoint is not a request to publish.
3. A checkpoint commits all non-ignored work in the checkout, including concurrent contributions, unless the user narrows it, and stays on the current branch.
4. Keep at most one pending branch per account and reuse it across tasks; edit on it rather than main unless direct main work is explicitly authorized.
5. Admitting a component or method from outside SAAM, or from superseded work, needs explicit human approval.
6. Record approvals as given, without widening their scope. Report software and physical results separately.
7. Work enters a release intent only on the owner's request or approval.
8. Preserve exact decision quotations, approval events, approved wording, and license, third-party or fixture provenance notices, with their dates.
9. A cap is never replaced by silent truncation: partial output must not pass as a complete result.

## Design direction

Core skills expose shared geometry and deposition capabilities. Guidance teaches
their composition, adding no deposition family or parallel recipe representation.
Builders may package existing operations; a missing capability goes to developers.

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
already available or better scheduled elsewhere. Reuse requires valid input
identity; background work must preserve responsiveness. A production
check likewise needs a concrete failure to detect and evidence that its cost
and placement are justified. Apply that standard to agent workflows and CI under
[Avoid check spirals](#avoid-check-spirals); task boundaries and commits do not
create verification work. Distinguish algorithmic preconditions from printing
decisions that require domain judgment.

## Working context

Use source to establish current behavior, the current release intent to establish
agreed direction, and evidence to evaluate a proposed change. Keep assumptions and
unresolved questions explicit. Software tests, benchmarks, vendor-tool results
and physical prints establish different things; report the scope actually checked.

Leave the next developer a concise account they can reason from. Document the
contracts, assumptions and algorithms that source alone does not convey. Distill
exploratory conversation into precise current guidance, stated once at its owner.
Correct that account when understanding changes. References should resolve
conveniently to source using ordinary repository tools.

## Maps and local documentation

The influence maps show what code affects what ([dev maps intent](plans/dev-maps.md));
the [map guide](dev-map/README.md) owns their commands. Builders may inspect the code
behind consumed interfaces alongside its manual; makers need no maps. What code
cannot state belongs where it is owned: a measurement in [DEVLOG.md](DEVLOG.md),
an agreed direction in the current release intent, and a user-facing limit in
the manual that owns the behaviour.

Add a docstring or comment only for local value, such as a subtle precondition,
a unit convention or an external constraint, not to repeat what the code plainly
shows. A structural finding is recorded and handled within the authorised scope;
noticing it does not by itself authorise a refactor.

## Context ownership

Role describes the work, not exclusive access to documents. Maker-facing manuals
own settings, supported behavior and recovery. Caller-facing contracts belong
to every builder or developer using that interface, including skill results,
geometry queries and Studio extension boundaries. Core/Studio behaviour, contracts
and limits belong to the [component manuals](#implementation-reference);
influence — what code a change affects and what affects it — is read from the
influence maps and the source they name. Skills and adapters retain
their separate implementation references. Select context by the boundary being consumed or
changed, rather than labeling an entire mixed component manual developer-only.

### Implementation reference

One manual per component, beside the code it describes. Read the one you are
changing; read the maps for what it affects and what affects it.

| Component | Manual |
|---|---|
| Core architecture and shared boundaries | [core/README.md](core/README.md) |
| Agent CLI toolkit | [core/agent/README.md](core/agent/README.md) |
| Machine interfaces and program output | [core/export/README.md](core/export/README.md), with [Bambu](core/export/bambu.md), [DENSO](core/export/denso.md), [Dobot](core/export/dobot.md), [Griffin](core/export/griffin.md) and the [exporter implementation](core/export/DEVELOP.md), which is off the map |
| Geometry and numerical contracts | [core/geom/README.md](core/geom/README.md), with [native mesh repair](core/geom/native/README.md) |
| Machine presentation models | [core/machine/README.md](core/machine/README.md) |
| Skill composition and travel | [core/path/README.md](core/path/README.md), with the [collision-planning proposal](core/path/collision-proposal.md) |
| Print lifecycle and persistence | [core/print/README.md](core/print/README.md) |
| Regions, offsets and intersections | [core/region/README.md](core/region/README.md) |
| Development tests | [core/tests/README.md](core/tests/README.md) |
| Machine files | [machines/README.md](machines/README.md) |
| Benchmarks and kernel provenance | [scripts/bench/README.md](scripts/bench/README.md) and [region-reference.md](scripts/bench/region-reference.md) |
| Studio | [studio/README.md](studio/README.md), with [kinematics](studio/KINEMATICS.md) and [rendering](studio/RENDERING.md) |

Keep core/Studio behavior and contracts in their owning component manual, future work and
proposals clearly marked at their owners, and past work and observations in
[DEVLOG.md](DEVLOG.md). Future possibilities must not read as implemented
capabilities. Implement current requests directly. Work deferred beyond the
active task goes in the release intent that schedules it ([plans](plans/)). Follow
[documentation maintenance](#documentation-maintenance).

Describe what was actually established: a software simulation does not establish
a physical result, and one person's instruction does not establish another
person's agreement. This adds no approval procedure or requirement to collect
more evidence for every change.

## Collaboration

Work within the requested scope and carry authorized implementation through to a
reviewable result. Escalate consequential ambiguity with the evidence and tradeoff.
Delegate independent objectives with their purpose, relevant context and guiding
principles; leave implementation reasoning to the assignee. Coordinate changes
at shared boundaries and pass findings to the collaborators they affect.

Tasks sharing a checkout preserve concurrent edits and keep its current contributor
branch, publishing through a pull request. Remove temporary repair branches when
their work is integrated.
Reread affected lines before editing. Infer scope and dependencies from the work,
source history and recorded context; resolve concrete conflicts without requiring
humans to maintain a coordination ledger. Preserve other tasks' unfinished work.
There is no blanket requirement to checkpoint before starting.

[Checkpoint and publication guidance](CONTRIBUTING-AGENTS.md) covers checkpoints
and remote activity.

## Context and selective adoption

The current checkout's instructions, the current release intent, shared
contracts and the user's authorization govern development. Older repositories,
transcripts, saved branches, older plans and decision records are reference
material, never authority; where they differ from current intent, current
intent wins.

Before asking to admit a component or method from outside SAAM or from
superseded work, identify its purpose and provenance and compare its producers and consumers with current geometry, composition,
machine and lifecycle interfaces. Ordinary authorized development adds no
per-task approval gate.

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
A failure states its real cause and what the person can change, leaving
geometry and quality choices explicit. For count, size and elapsed-time limits, see
[limits that adapt, and limits that are kept](core/README.md#limits-that-adapt-and-limits-that-are-kept).

## Reproducible examples

A skill's [example recipes](skills/AUTHORING.md) are static references; the
[tour examples](examples/prints/README.md) are Studio's tour content. An example's
setup, assets and recipe assumptions must be reachable from its skill manual for a
fresh part, not from the originating conversation; reusable preparation belongs in
packaged tools that describe the necessary settings.

## Testing through the use context

Develop and exercise maker-facing changes through [MAKERS.md](MAKERS.md), public
tools and the relevant skill manuals. Assess the affected experience, including
installation, discoverability and recovery when relevant to the change.

Use isolated projects, fixtures and machine simulators. Report software and
physical results separately.

A developmental preview is an ordinary `saam` bundle, created and generated
without human approvals. Robot parts still need explicit command settings; for a
new provisional part use the reusable setup instructions for
[DENSO](skills/pipe-cladding/SKILL.md#contact-and-pose) or
[Dobot](core/export/dobot.md#dobot-output-contract), independently of its shape.

## Documentation maintenance

Write current manuals and contracts in present tense, and label proposals and
future work by status. State intent positively at its owner
([intent and rules](DEVELOPER-CONTEXT.md#intent-and-rules)). Update the owning account alongside the implementation.
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
| Core/Studio behaviour, contracts and limits | The [component manuals](#implementation-reference); skill callers may read them independently |
| Core/Studio influence — what a change affects and what affects it | The influence maps: `read-map 0`, then the boxes and `@link` arrows the change touches |
| Application commands and chat attachment | [Application](core/application/README.md) |
| Print operations and skill tools | [Print tools](core/print/USAGE.md) and relevant [skill manuals](skills/DIGEST.md) |
| Skill authorship and catalog maintenance | [Skill development](skills/AUTHORING.md) |
| Map commands and scope | [Map guide](dev-map/README.md) |
| Developer entry instructions | [Developer context](DEVELOPER-CONTEXT.md); the influence maps own technical navigation |
| Documentation navigation for each role (human reference) | `maker-context-map.html` and `builder-context-map.html` |
| Shared terms | [GLOSSARY.md](GLOSSARY.md) |
| Current direction, scheduled and outstanding work | The current release intent in [plans](plans/) |
| Dated decision history | [DECISIONS.md](DECISIONS.md) |
| Completed work and dated evidence | [DEVLOG.md](DEVLOG.md) |

Around preserved quotations and notices, guidance still describes current
behavior. A historical narrative in a technical manual
does not become an exception merely by being there.

Place specialized instructions where the operation or failure makes them useful;
the same manuals serve every agent that reads them.
Architectural references should explain boundaries and consumers and link to
owning source using ordinary repository tools. Review claims against source and
recorded evidence. The optional `node scripts/check-repo.mjs` diagnoses document
links, decision metadata, skill digest/catalog consistency and
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
| Choosing or changing tests | [Avoid check spirals](#avoid-check-spirals), then the [test reference](core/tests/README.md) |
| Checkpoint or remote activity, after implementation | [Contribution guidance](CONTRIBUTING-AGENTS.md) |
| Skill authoring and discovery metadata | [Skill development](skills/AUTHORING.md) |
| Trace the system or change an interface | [Core architecture](core/README.md), then `read-map 0` and the boxes and `@link` arrows the change touches |
| Geometry representation, queries, precision or mesh repair | [Geometry](core/geom/README.md) and [native mesh repair](core/geom/native/README.md); `read-map @cluster/geometry` for influence |
| Offsets, intersections or material ownership | [Regions](core/region/README.md); `read-map @cluster/geometry` and `@cluster/toolpath` for influence |
| Skill operations, scheduling or travel | [Skill composition and travel](core/path/README.md), then the relevant [skill](skills/DIGEST.md); `read-map @cluster/toolpath` for influence |
| Plans, validation, persistence, generation or delivery | [Print lifecycle](core/print/README.md); `read-map @cluster/bundle` and `@cluster/toolpath` for influence |
| Using shared print commands or changing their task guidance | [Print tools](core/print/USAGE.md) |
| Machine capabilities, emission or interpretation | [Machine interfaces and program output](core/export/README.md), [machine presentation models](core/machine/README.md) and [machine files](machines/README.md); `read-map @cluster/export` and `@cluster/settings` for influence |
| Studio interaction, lifetime or rendering | [Studio](studio/README.md), [kinematics](studio/KINEMATICS.md) and [rendering](studio/RENDERING.md); `read-map @cluster/studio` for influence |
| Chat-client commands and attachment | [Application](core/application/README.md) |
| Performance measurement | [Slicing benchmarks](scripts/bench/README.md) and [region kernel verification](scripts/bench/region-reference.md) |
| Maker-facing behavior or end-to-end use | [MAKERS](MAKERS.md) and [development testing](#testing-through-the-use-context) |
| Documentation | [Ownership and maintenance](#documentation-maintenance) |
| Project direction, outstanding work, history or terminology | The current release intent in [plans](plans/), [devlog](DEVLOG.md), [decision history](DECISIONS.md) or [terms](GLOSSARY.md) |
