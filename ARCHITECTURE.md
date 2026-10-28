# SAAM architecture

This document is SAAM's shared structural specification: the current
implementation account and runtime/deployment reference. [Migration intent](plans/0.4.0.md)
records the 0.4.0 scope and unsettled decisions.

The implementation account is organized using the
[arc42 structure](https://arc42.org/overview/). Git versions this document with
the source; [numbered decisions](docs/adr/) record changes in architectural direction.
Component manuals own detailed interfaces. The versioned [plans](plans/) define
intent cumulatively, including future versions; [intent](intent/README.md) retains
the owner's words. A structural account is not evidence of complete implementation
or physical qualification. [DEVLOG](DEVLOG.md) records verification and limitations.

## 1. Introduction and goals

SAAM makes 3D printed parts through conversation. Geometry, toolpath and hybrid
skills compose ordinary geometry and one machine-independent SAAMpath. A person
reviews geometry and SAAMpath in Studio; Export is the one confirmation and
translates the captured path and settings into a machine program for download.

The architecture concentrates numerical geometry, deposition construction,
scheduling, machine adaptation and saved state behind their owning interfaces.
Callers supply explicit inputs; each operation checks its own prerequisites.
An incomplete recipe or missing machine does not prevent unrelated operations.

## 2. Constraints

- Node.js 22+ runs the local application on Windows and macOS. Browser code owns
  presentation; expensive computation uses cancellable workers or child processes.
- The installed Application owns the OS listener, tray, runtime lifecycle and
  shared home. Source checkouts select their code through the same installed route.
- Bundle owns shared part state and saved revisions. Engines operate on supplied
  values; private controllers own UI, chat and job state.
- Construction and neutral scheduling work independently of the selected machine.
  Scheduler owns deposition order and nozzle assumptions; Bundle qualifies actual
  assignment before review. Export owns physical transfers and output compatibility.
- Builder extensions compose published interfaces. Changes to core capabilities
  or shared interfaces use the developer role. Local developer tools are selected
  through local preferences; shared onboarding reads published Markdown.

## 3. Context and scope

| Outside party | Interaction | SAAM owner |
|---|---|---|
| Person | Part intent, file selection, review and Export confirmation | Studio and Application |
| Chat agent | Scoped commands, manuals, requests and outcomes through `saam` | Application and maker context |
| Local STL file | User-selected bytes, units and import/repair findings | Geometry and Bundle |
| Asset provider | Models, fonts, source identity and license attribution | Extensions and Geometry |
| Printer or robot | A machine program exported for its declared capabilities | Export and machine adapters |
| Update/diagnostics service | Consented release offers and diagnostic evidence | Application release service |
| Local development tools | Read the checkout and keep their own analysis/view state | Outside the shipped SAAM system |

The agent does not supply the person's final print confirmation. Software evidence
and physical results are reported separately. See [maker workflow](MAKERS.md).
General web-agent access is future work without a release target; the implemented
route is local desktop clients through Application.

## 4. Solution strategy

Inject, Trace and Slice are the common deposition operations. Techniques select
and compose these operations instead of creating separate generation lifecycles.
Geometry owns construction, numerical representation, evaluation and native lifetime.
Recipe describes intent; Material regions resolves spatial responsibility;
Toolpath publishes finalized deposition and manufacturing prerequisites.
Scheduling preserves that immutable source while choosing execution order.
Export applies the selected machine and writes its program with scoped findings.

Bundle retains authored inputs, immutable source, neutral schedules and reviewed
snapshots. Studio and exporters share the numerical curve/profile/range reader.
Programs and machine execution are transient Export results; templates remain in
machine extensions. [ADR 0002](docs/adr/0002-neutral-bundles-and-transient-export.md)
records this boundary.

### Authoring and numerical scope

Agents author blob fields for organic volumes, splines for smooth geometry and
meshes for angular forms. Extensions compose them through Geometry's published
operations. The toolkit should preserve authored meaning, state approximation
and accuracy, support ordinary consumers and remain cancellable. Current
[geometry contracts](core/geom/README.md) retain native curves/trims and own mesh
repair. Periodic/coincident and near-tangent Boolean cases remain limited;
recovery reports operand displacement. Finite tangent neighborhoods do not
establish general fold-resolved offset solids or arbitrary sleeve topology.

SAAMpath compacts curves and changing profiles instead of expanded moves. One
recorded dome source shrank 84.4 MB to 6.35 MB (13.3×); this is a dated source-file
measurement, not a whole-bundle guarantee. [DEVLOG](DEVLOG.md) retains the bounds
and publication cost; [SP2](core/path/README.md) owns semantics.

## 5. Building block view

These modules describe responsibility, not a requirement that every declaration
live in one folder. Source entry points and the owning manuals locate their interfaces.

| Module | Owns | Primary reference |
|---|---|---|
| Maker context | Role guidance, capability discovery, manuals and tours | [MAKERS](MAKERS.md), [catalog](skills/DIGEST.md) |
| Application | `saam`, operation dispatch, chats, requests, jobs, runtimes and the shared home | [application](core/application/README.md), [runtime](core/application/runtime.mjs), [orchestrator](packaging/application.mjs) |
| Geometry | Shapes, native lifetime, numerical queries, conservative bounds, import and repair | [geometry](core/geom/README.md), [operations](core/geom/operations.mjs) |
| Recipe | Authored records, defaults, process resolution, validation and explicit migration | [print lifecycle](core/print/README.md), [plan](core/print/plan.mjs) |
| Material regions | Slice members for Construction: explicit claims, the default remainder, process reservations and selected material; no overlap distribution between claims | [regions](core/region/README.md) |
| Toolpath | Finalized Inject/Trace/Slice deposition, profiles and manufacturing prerequisites | [SAAMpath](core/path/README.md), [construction](core/print/construction.mjs), [finalization](core/print/finalize.mjs) |
| Scheduling | Ready work, exact source coverage, interference constraints and neutral endpoint transfers | [scheduler obligations](core/path/README.md#scheduler-obligations), [schedule](core/path/schedule.mjs) |
| Bundle | Persistent part state, revisions, immutable artifacts, history, completed output and delivery identity | [Bundle](core/print/README.md), [workflow](core/print/workflow.mjs) |
| Extensions | Published geometry/recipe edits, process sources and extension discovery | [authoring](skills/AUTHORING.md), [extension host](core/extensions/) |
| Studio | Review, selection, viewer state, playback and the Export interaction | [Studio](studio/README.md), [rendering](studio/RENDERING.md) |
| Workspace | Specialized authoring experiences returning ordinary bundles to Studio | [workspace host](workspaces/server.mjs) |
| Settings | Reusable machine/material profiles, defaults and remembered setup; submits explicit snapshots to Bundle | [machine interfaces](core/machine/README.md), [bundle settings](core/machine/bundle-settings.mjs) |
| Export | Selected-machine preparation, access, physical transfers, adapters and transient program emission | [export](core/export/README.md), [machine authoring](machines/README.md) |
| Development | Source guidance, repository checks, measurements and packaging | [source toolkit](core/agent/README.md), [packaging](packaging/README.md) |

### Relationships and state ownership

| Caller | Interface owner | Information or effect |
|---|---|---|
| Agent and Studio | Application | Validate a scoped operation and bind its chat/request/selection identity |
| Application, Studio and extension edits | Bundle | Commit authored changes against the expected revision; return the saved outcome |
| Extension host and core skills | Geometry and Recipe | Construct ordinary geometry and recipe values through published interfaces |
| Construction | Geometry, Recipe and Material regions | Resolve numerical shapes, process and spatial responsibility for supplied inputs |
| Bundle generation | Toolpath | Obtain immutable deposition and minimal manufacturing prerequisites |
| Bundle generation | Scheduling | Obtain neutral execution referencing the exact saved source identity |
| Studio and Export | Shared path reader | Read curves, profiles, source ranges, actions and summaries without a second saved motion authority |
| Export | Settings, Geometry and Scheduling | Resolve actual nozzle geometry, access and physical execution for the selected output |
| Export | Machine adapter | Emit commands and report writer facts, unsupported output or missing setup |
| Studio Export | Bundle | Read captured toolpath/settings and record a factual export receipt |
| Application | Workspace | Run specialized authoring and return a bundle through the ordinary Studio flow |

Geometry, construction and scheduling do not write Bundle state. Reusable settings
do not silently refresh existing bundles. A new geometry or toolpath revision does
not replace the captured inputs of a completed output.

## 6. Runtime view

### Author or edit

1. The person or agent selects a bundle through Application and Studio.
2. Application checks request/selection authority and the operation's prerequisites.
3. Geometry or an extension prepares values through the shared interfaces.
4. Bundle commits them at a fresh revision and records affected artifact identity.
5. Studio presents the saved geometry; the agent hands back the originating request.

### Generate and review

1. Bundle captures the authored geometry, recipe and relevant settings.
2. Geometry and Material regions supply construction inputs. Toolpath publishes
   finalized deposition and its required construction history.
3. Bundle saves immutable `saampath/3` source. Scheduling returns a
   `saam-schedule/1` execution joined by `sourcePathId`, preserving exact coverage.
4. Bundle records the completed neutral path and captured inputs; no machine is
   required. When actual nozzle assignment exists, Bundle qualifies its envelope
   through Scheduler before publishing the review. Declared prerequisite ancestry
   guarantees deposition clearance; travel still considers deposited obstacles.
5. Studio displays that saved path and settings without loading a program writer.

### Export, edit and recovery

Export captures the displayed path and settings before queueing. It resolves
the captured nozzle assumptions and physical transfers, then writes transient
download bytes. It does not repeat deposition-clearance checks or reschedule.
Later edits do not change the capture. Bundle records a receipt, never program
bytes or machine execution. Writer failure leaves the saved path intact. Edits
retain previous toolpaths; regeneration dims them and blocks new Export clicks
while working. Failure/cancellation preserves them. Opening never generates.
The [review contract](core/print/README.md#generation-and-review) owns eligibility.

## 7. Deployment view

The shared home is `C:\SAAM` on Windows or `~/SAAM` on macOS:

| Location | Lifetime and owner |
|---|---|
| `app/` | Replaceable installed code and bundled Node runtime |
| `local/Prints/` | User bundles, retained inputs, neutral paths and review records |
| `local/extensions/` | User extensions, independent of application replacement |
| `local/machine-setups/` | Remembered machine/material setups |
| `local/LOCAL-AGENT-NOTES.md` | Shared personal preferences and printer facts |
| `state/` | Application/client state and per-runtime private records |
| `tmp/` | Disposable diagnostics and temporary presentation artifacts |

One orchestrator owns code-root-specific child runtimes and stable Studio addresses
for its lifetime. `saam` selects installed code; `saam --code-root CHECKOUT` selects
source. Choosing source changes code, not the shared library. Runtime identity derives
from its code root; a folder rename selects a new identity. Quit and Update stop the
application's runtimes. Closing a browser tab does not stop SAAM.
See [installation](packaging/INSTALL.md) and [Application](core/application/README.md).

## 8. Crosscutting concepts

- **Ownership:** Bundle is the sole shared part-state authority. Private UI/chat/job
  controllers and numerical caches retain only their own state. Ownership transfers
  are explicit; snapshots survive where consumers branch.
- **Queries and commands:** a query answers without an effect another operation can
  observe; a command acts and returns its outcome and created identity. Detailed
  code-shape guidance remains in [developer context](DEVELOPER-CONTEXT.md#code-shape).
- **Identity:** source and execution share a path identity; expected revisions guard
  edits, request IDs preserve work provenance, and selection versions reject stale
  writes. Completed output preserves its own captured identity.
- **Numerics:** Geometry supplies dimensions, frames and conservative bounds.
  [Tolerance classes](core/README.md#dimensions-and-tolerances) distinguish print,
  construction, program and rounding accuracy from physical process dimensions.
- **Work and failure:** operations check their own prerequisites. Cancellation and
  failures preserve prior saved work. Findings name their real cause and scope;
  limits follow [the owning policy](core/README.md#limits-that-adapt-and-limits-that-are-kept).
- **Provenance:** imported assets retain source, hash and license notices. Local
  preferences and optional development-tool configuration remain outside shared code.

## 9. Architectural decisions

[ADR 0001](docs/adr/0001-text-architecture-and-local-dev-maps.md) establishes this
shared text specification and the separate local map tool. Historical decisions
and exact prior owner quotations remain in [DECISIONS](DECISIONS.md); release intent
and current component contracts determine which statements still apply.

## 10. Quality requirements

| Scenario | Required architectural property | Owning evidence |
|---|---|---|
| Change the selected machine | Preserve authored geometry and neutral source; perform machine checks at Export | Path/Export manuals and focused integration evidence |
| Edit during or after review | Retain reviewed inputs; Export uses its click-time path/settings capture | Bundle/Studio review evidence |
| Cancel or fail regeneration | Preserve and restore the prior saved output | Bundle generation and request evidence |
| Compose several skills | Use ordinary geometry, explicit material claims and declared prerequisites | Geometry/Toolpath integration evidence |
| Relocate a checkout or omit local tools | Shared onboarding and guidance remain readable without an external map store | Source toolkit and package checks |
| Replace the installed application | Preserve the user's library, extensions and settings | Installation/update evidence |

## 11. Risks and technical debt

This specification records architectural contracts, not an exhaustive computed
dependency inventory. Source-level review and focused verification establish actual
effects.
Shared-material behavior, timing improvements and all former 0.4.0 intents now
belong to [0.5.0](plans/0.5.0.md). The new [0.4.0](plans/0.4.0.md) direction is
data inspection, MCP service work and a developer-guidance review. Its [assessment](plans/0.4.0-design.md) is a proposal; this document retains
the current architecture until those replacements are implemented.
Package checks on one host do not establish native execution on another platform.

## 12. Glossary

[GLOSSARY.md](GLOSSARY.md) owns domain terms. This specification uses those terms
and links to component contracts rather than maintaining another vocabulary.
