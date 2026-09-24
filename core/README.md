# Core architecture

SAAM combines skill operations through shared geometry, region, motion and machine
interfaces. This page retains shared boundary contracts and supported
exceptions; the generated [dev map](../dev-map/README.md) owns the structural
account, read with `node scripts/agent-toolkit.mjs read-map 0`.

The [agent CLI toolkit](./agent/README.md) composes context reads, print preparation,
Studio opening and request coordination around these existing owners.

[File replacement](./file-write.mjs) supplies unique temporary files and bounded
Windows sharing-conflict retries to print and Studio persistence. It preserves
complete individual files; it is not a lock or a multi-file transaction.

## Current organization

The [developer orientation](../DEVELOPER-CONTEXT.md#orientation) indexes region
maps and their caller contracts. Maps own the generation/review flow and source
entry points; shared interfaces and the exceptions below remain caller context.

[Skill manuals](../skills/DIGEST.md) own pattern-specific tools and limits. Client
adapters use the same lifecycle; see [MCP implementation](../adapters/mcp/DEVELOP.md).

The [machine presentation boundary](../studio/KINEMATICS.md) lets the
kinematic-model and Studio tasks work independently. Models supply resolved
component poses and simple geometry; Studio owns their presentation alongside
the existing source-driven toolpath. This contract does not replace machine
output or prescribe a solver architecture.
The [model reference](./machine/README.md) owns implemented mechanisms, source-time
evaluation and nominal installation limits.

## Interoperability and one workflow

Shared geometry queries feed material regions and skill operations. Composition
orders those operations and plans their transitions; machine adapters emit and
interpret the program used by review and delivery. A change to one of these
interfaces needs to account for its current callers, result semantics and
affected consumers. [Geometry interfaces](./geom/README.md#geometry-interoperability-for-skill-authors),
[skill results](./path/README.md#skill-result-composition) and [machine output](./export/README.md#machine-interoperability-design)
describe those contracts.

Machine profiles and output adapters own machine behavior. Skills consume the
shared geometry and result interfaces, with explicit capabilities and limits.
Upstream numerical-library features become SAAM capabilities only through its
supported interface. Exercise affected combinations through the public
CLI/MCP/Studio workflow as well as their component tests.

Composing skills on one part requires explicit material ownership, operation
order and transitions without duplicate deposition. Report the unsupported
transition, support need or geometry constraint. A vase-to-cap transition, for
example, needs a level interface and support/bridging assessment. The user's
acceptance example is a flat base and vase wall, flat cap, normal walls/infill
under a wavy roof, draped roof, and horizontal full fill above that roof with a
wavy bottom. Region interfaces therefore include nonflat surfaces as well as
height bands; see [material regions](./region/README.md#material-regions-and-shared-interfaces).

Mesh and NURBS backends share geometry queries, downstream regions, composition,
motion, export and review.

## Limits that adapt, and limits that are kept

Generation, import, repair and export never refuse work because a count, a size
or an elapsed time crossed a number chosen in advance. A fixed work budget always
fails on somebody's legitimate part eventually, and a budget that is merely
configurable is still fixed. Where a count once guarded a loop, the loop now ends
on its own criterion and reports the cause when it genuinely cannot finish; where
a limit is kept, it is because something real, not an estimate, makes it true.

Replacing a cap, in order of preference: stop on the real criterion (a tolerance,
a chord error) and delete the count it stood in for; detect non-progress instead
of counting iterations (parameter or midpoint underflow, a residual that stops
falling relative to its own scale, a non-finite value); segment or stream when
memory is genuinely at stake, and fail only on an actual allocation failure;
split a command the machine cannot express in one piece rather than rejecting it;
and for time, keep work alive while it progresses or until it is cancelled.
Never convert a throwing cap into a silent truncation.

These limits are deliberately kept. They are not work budgets.

| Limit | Where | What it protects | Why it is real |
|---|---|---|---|
| Machine limits as a class: bounds, axis feed, layer height, bead width, flow, angle, temperature, retraction within the material profile | [machine profiles](../machines/README.md), [rules.mjs](./machine/rules.mjs), [profile.mjs](./machine/profile.mjs) | The machine and the material | Declared properties of hardware and filament, not guesses about work |
| Index capacity: at most `0x7ffffffe` vertices and `0x3ffffffe` triangles, plus `Number.isSafeInteger` counts | [mesh-capacity.mjs](./geom/mesh-capacity.mjs), and the same check in cylinder, sleeve and motif point counts | Indexed typed arrays | A count that cannot be represented, not one judged too large |
| `KERNEL_TRIANGLE_CAPACITY`, the solid kernel's 32-bit address space | [solid.mjs](./geom/solid.mjs) | Manifold WASM, whose abort is unrecoverable | The largest count the kernel can hold, published by the kernel |
| 64 MiB STL upload | [import-stl.mjs](../studio/import-stl.mjs) | The Studio HTTP boundary | Input safety on a network boundary; about 1,342,000 binary triangles, and not a geometry budget |
| 64,000 byte request body (64 MiB on the import route) | [server.mjs](../studio/server.mjs) | The Studio HTTP boundary | The same input-safety rule for request bodies |
| 64 KiB native repair report | [mesh-native.mjs](./geom/mesh-native.mjs) | The helper's single JSON line of counts | The report's size does not grow with the mesh, so 64 KiB means malformed output |
| Cache eviction: 32 MiB derived mesh data, 512 prepared curves and cells, four height slabs, 256 published sections, 32 file snapshots, 100,000 roof samples | [mesh.mjs](./geom/mesh.mjs), [prepared-contours.mjs](./geom/prepared-contours.mjs), [finished-surface.mjs](./path/finished-surface.mjs), [file-snapshot.mjs](./print/file-snapshot.mjs), [drape.mjs](../skills/draped-skin/scripts/drape.mjs) | Memory held by caches | Eviction, never refusal: the value is recomputed and the answer is unchanged |
| Prepared-contour refinement depth | [prepared-contours.mjs](./geom/prepared-contours.mjs) | The interpolation cache | An unresolved cell falls back to the exact curve, which is the better answer; the depth decides which queries are interpolated, so it is accepted output |
| One-turn angular conditioning, `prefix[samples] < TAU` | [directional-contour.mjs](./geom/directional-contour.mjs) | Regularized contour sampling | Geometry: the angular room the source needs must fit in one revolution |
| `validate` depth in `meshTransition` | [prepared-radial-contact.mjs](./geom/prepared-radial-contact.mjs) | Ledge confirmation | It answers "not confirmed" and the caller subdivides further; it refuses nothing, and the recursion branches on both halves |
| Jog relaxation sweeps | [jog.mjs](./machine/jog.mjs) | One correction vector per step | An algorithmic parameter of a single step whose result the outer loop re-tests; changing it changes accepted jog output |
| Convergence and precision parameters: golden-section and bisection iteration counts, fixed survey and mouth sample counts | [shell.mjs](./geom/shell.mjs), [tolerance.mjs](./geom/tolerance.mjs), [tessellate.mjs](./geom/tessellate.mjs), [drape.mjs](../skills/draped-skin/scripts/drape.mjs), [geometry.mjs](../skills/heat-set-inserts/scripts/geometry.mjs), [surface-clad.mjs](../skills/pipe-cladding/scripts/surface-clad.mjs) | Numerical resolution | None of them throws; each already has its own interval or tolerance criterion, and changing the number changes accepted output |
| One-command dwell maximum, with splitting | [griffin.mjs](./export/griffin.mjs) `G4 P`, [dobot-player.mjs](./export/dobot-player.mjs) `Wait` | What one firmware command expresses | A longer pause becomes consecutive commands whose milliseconds sum to it; the limit never shortens a wait |
| ZIP32 entry and member sizes | [zip.mjs](./export/zip.mjs) | The container format | The format cannot represent more; the message says ZIP64 is unsupported |
| DENSO 2,000-statement source blocks | [denso.mjs](./export/denso.mjs) | Compiler and project structure | Segmentation, not refusal: a program of any length is written, split into blocks called in order, which changes no motion |
| Malformed-file guards: STL header and token length, non-finite values, OFF header shape | [stl-file.mjs](./geom/stl-file.mjs), [mesh.mjs](./geom/mesh.mjs), [mesh-native.mjs](./geom/mesh-native.mjs) | The parsers | They detect a file that is not what it claims to be, before any work is attempted |
| Schema ranges the owner chose to keep: geometry dimension ranges, `composition.regions` at most 80, assembly `parts` 2–20, text `features` at most 40, text length at most 2,000, `thick-lip.steps` at most 50 entries, note and configuration-source lengths | [plan.mjs](./print/plan.mjs), [text.mjs](../skills/text/scripts/text.mjs), [rules.mjs](./machine/rules.mjs) | Hand-authored recipe shape | Intended bounds on authored input rather than budgets on the work a part needs |
| `composition.batchLayers` 1–20 | [plan.mjs](./print/plan.mjs), [compose.mjs](./path/compose.mjs) | Head clearance beside a taller neighbour | It stands in for a clearance the scheduler cannot yet reason about. To be revisited, probably with a new scheduler, when more multi-axis machines join the test program |
| `plastic-weld` sites at most 256 | [weld.mjs](../skills/plastic-weld/scripts/weld.mjs) | Authored rivet lists | The same class of authored-shape bound, and the most reachable of them: a 200 mm plate at the manual's 12 mm pitch is already 256 sites on one level |
| `maxHoleEdges` at most 100,000 | [mesh-native.mjs](./geom/mesh-native.mjs) | A requested repair option | Hole triangulation is cubic in the boundary edge count, so this bounds what may be asked for, not what a mesh may contain |
| Download size, timeout and redirect count; external search paging | [library.mjs](../skills/thingi10k/scripts/library.mjs) | An external HTTP boundary | Input safety on somebody else's server, the same class as the upload limit |
| Coordination timers as a class: viewer grace period, SSE keep-alive, bounded event waits, debounce and polling intervals, Windows sharing-conflict retries, download-link expiry | [lifetime.mjs](../studio/lifetime.mjs), [agent-requests.mjs](../studio/agent-requests.mjs), [studio-events.mjs](../studio/studio-events.mjs), [server.mjs](../studio/server.mjs), [file-write.mjs](./file-write.mjs) | Coordination between processes and viewers | None of them discards work: a bounded wait returns "nothing yet" with a cursor, and a retry rethrows the real error |
| Display budgets | [toolpath-view.mjs](../studio/toolpath-view.mjs), and see [rendering](../studio/RENDERING.md) | What the browser draws | Visual only; they must never alter the saved program, geometry or export |

One fixed size remains undecided: the MCP adapter refuses an STL source over
64 MiB in [server.mjs](../adapters/mcp/src/server.mjs) although it names a
local file path rather than an upload, so it is the binding limit on that import
route. Whether MCP counts as a boundary like Studio's is the owner's call.

Developer experiments use these same components; [historical inspection](../studio/README.md#historical-toolpath-inspection)
is a scoped example. A proposed parallel pipeline needs a reason the shared
extension cannot serve the task and normally a discussion before building it;
existing authorization applies. New product commands, artifact formats and
approval routes require an explicit scope decision. Document a necessary
exception's reason, limits and boundary tests where a caller encounters it.
