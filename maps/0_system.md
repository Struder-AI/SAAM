# Core and Studio

## Development navigation

Maps own the technical reference for these domains. A page read provides its
components and contract index; `--section ID#heading` reads a contract without
loading its implementation graph. `--inventory` lists owned files, including
native source and browser assets. `--evidence` expands generated relationships
and discovered callers. Source and tests remain reachable from the same structure.
Each region also returns `responsibilities`: exact implementation files, their
change-contract section, coupled behavior and owning verification routes. This is
the route from a file to its meaning, including native files without extracted boxes.

| Responsibility | Page | Contract IDs |
|---|---|---|
| Lifecycle, persistence and review | `1_lifecycle` | `lifecycle` |
| Plans, dispatch and assignment | `2_generation` | `generation`, `lifecycle`, `motion`, `regions` |
| Geometry and numerical foundations | `3_geometry` | `geometry`, `native-repair` |
| Region operations and ownership | `4_regions` | `regions`, `region-verification` |
| Composition, material and motion | `5_motion` | `motion` |
| Emission, interpretation and archives | `6_output` | `output`, `griffin`, `bambu`, `dobot`, `denso` |
| Studio server, browser and workers | `7_studio` | `studio`, `rendering`, `studio-protocols` |
| Machine capabilities and presentation | `8_machine` | `machine`, `machine-files`, `presentation` |
| Agent toolkit and context access | `9_agent` | `agent` |
| Verification and measurement | `0_system` | `testing`, `performance` |

## Scope and roles

Makers operate existing tools and need no implementation maps. Skill builders
use skill authoring references and consumed map-owned API contracts. Builders
changing core or Studio internals use these maps, as developers do. Core
utilities used by skills are still core. Skill implementations and client adapters
remain outside the implementation map domain, with their own references and
visible caller evidence. Their separation is also shown in Code containment.

Repository policy, setup, contribution procedures, decisions and history retain
their existing owners. They are not a second core/Studio technical hierarchy.

## Routes for representative changes

| Change | Map-owned route and behavior to preserve | Verification |
|---|---|---|
| Add a plan field | `2_generation`; [schema change contract](reference/generation.md#changing-plan-schema-and-compatibility). Update defaults, supported normalization, strict fields, validation, identity/invalidation and Studio review rows together. | Old/new recipe, typo rejection, machine defaults and regional override cases linked in the section |
| Change bundle invalidation | `1a_read`, `1c_review`; [lifecycle boundary](reference/lifecycle.md#validate-at-the-boundary-that-owns-the-data), then [presentation identity](reference/studio-protocols.md#request-completion-and-display). Current bytes and current displayed target are distinct evidence. | Workflow and view-readiness cases |
| Change worker cancellation | `7g_generation`; [atomic commit boundary](reference/studio-protocols.md#preparation-generation-and-cancellation). Cancellation wins only before committing; this does not make multiple file writes transactional. | Generation-control and checked-handoff cases |
| Add an output adapter | `6_output`; [output selection](reference/output.md#changing-output-selection-and-shared-checking), selected dialect, machine capability and Studio decoder. A profile entry does not implement an exporter. | Exact-byte writer/interpreter round trip, unsupported capabilities and source loading |
| Change numerical precision | `3i_numerics`; [quantity-specific precision](reference/geometry.md#precision-belongs-to-a-quantity-and-an-operation), [numerical foundations](reference/geometry.md#changing-numerical-foundations), affected region and output quantization. Coordinate, parameter, angular and volume budgets differ. | Analytical geometry and affected consumer cases |
| Change native repair | `3f_repair`; [repair boundary](reference/geometry.md#changing-explicit-mesh-repair-and-native-execution) and [native build](reference/native-repair.md). Source/build identity, child termination, retained input/report and strict validation belong together. | Defect, stale-build, cancellation and re-import cases |
| Change consumed regional surfaces | `2a_assignments`; [publication](reference/generation.md#changing-regional-material-publication), [finished surfaces](reference/motion.md#changing-finished-surface-publication). Preserve actual coverage masks and prerequisite operation IDs; a height alone is insufficient. | Sparse/solid, holes, cycles and missing-support cases |
| Change operation scheduling or temperature | `5_motion`; [composition](reference/motion.md#skill-result-composition), [process controls](reference/motion.md#changing-deposition-spacing-and-process-controls), affected dialect. Ordering must retain support dependencies and stationary deposition. | Mixed-operation scheduling and modal output cases |
| Change import failure recovery | `7_studio`; [import transaction](reference/studio.md#changing-studio-import-transactions). Repair only eligible geometry defects; terminate the worker before removing only its newly reserved directory. | Collision, cancellation, ineligible failure and neighboring-print preservation cases |
| Change asynchronous machine display | `7b_source`, `8_machine`; [session epochs](reference/studio-protocols.md#source-session-and-stale-replies), [provider interface](reference/presentation.md#provider-interface). Stale replies cannot replace the current source/model; model availability is separate from source validity. | Rebind, late reply, disposal and frame continuity cases |
| Change agent completion UI | `7c_requests`; [request state](reference/studio-protocols.md#changing-agent-request-state-and-presentation). Completed work still needs a receipt for the requested print, identity and stage. | Completed-but-unpresented, stale snapshot and other-print cases |
| Change playback or rendering | `7j_playback`, `7i_draw`; [storage/movie lifetime](reference/studio-protocols.md#playback-storage-and-movie-resources), [display geometry](reference/rendering.md#changing-camera-and-displayed-geometry). Scratch rows, transferred buffers and GPU/movie resources have different owners. | Compact/full equivalence, frame boundaries, rebuild and cancellation cases |
| Change a machine profile | `8_machine`; [capability checks](reference/machine.md#changing-machine-profiles-and-capability-checks), [machine files](reference/machine-files.md). Installation placeholders may allow geometry review but cannot become invented export settings. | Unsupported output, unresolved setup, bounds/flow and action cases |
| Change agent documentation access | `9_agent`; [guidance access](reference/agent.md#changing-guidance-and-map-reads). Preserve path boundaries, canonical redirects and section-only reads. | Manual-path security and reference-selection cases |

These are navigation examples, not a mandatory check bundle. Select verification
for the behavior being changed. Adding file ownership does not certify a contract
or turn enclosed helpers into individually explained operations. Completeness here
means a source-grounded route for every implementation responsibility, its contract,
failure/limit behavior, affected consumers and verification. It does not mean every
private declaration needs a box or every possible future change has a recipe.
New implementation files without explicit change contracts fail the map check;
changed behavior still requires reviewing the meaning of its existing contract.

Read the affected region through `node scripts/agent-toolkit.mjs read-map PAGE`
so the calculated shared-use references accompany its graph. Build
`dev-map/index.html` with `node scripts/dev-map.mjs build` for the same source
rendered with PackIT's layout. Skills and client adapters are callers at the
boundary; their implementations are outside these maps. Solid wires carry
data/calls, dashed red wires carry conditions. Vertical red arrows list every
other mapped use of the same component contract.

```saam-page 0_system
title 0 — Core and Studio
sub Level 0 · prepare, generate, review and deliver
width 2300
ext person | person / client
box agent | 9 | assist | >9_agent
box life | 1 | manage print | >1_lifecycle
box gen | 2 | generate | >2_generation
box geom | 3 | query geometry | >3_geometry
box region | 4 | shape regions | >4_regions
box motion | 5 | compose moves | >5_motion
box output | 6 | check commands | >6_output
box studio | 7 | review | >7_studio
box machine | 8 | pose machine | >8_machine
person > agent | request | io
agent > life | print commands | data
agent > studio | session / requests | data
life > gen | locked plan | data
gen > geom | geometry query | data
geom > gen | geometry | data | norank
gen > region | region query | data
region > gen | regions | data | norank
gen > motion | skill results | data
motion > life | path | data | norank
life > output | path / plan | data
output > life | checked program | data | norank
life > studio | bundle | data
studio > life | review actions | data | norank
studio > machine | source / time | data
machine > studio | poses | data | norank
```

Scope is the implemented shared workflow. The bounded wedge supplies a separate
skill generator through the same lifecycle. A map anchor establishes location;
it does not prove an arrow's behavior or enumerate every possible caller.
Follow calculated shared uses before editing a reused component, and inspect
source callers outside the mapped core/Studio boundary.


```saam-scope
core/README.md | Compatibility route to the map-owned system contract
core/tests/ | Verification fixtures and tests; select by the testing reference
```

```saam-references
system | maps/reference/system.md | System boundaries and interoperability
testing | maps/reference/testing.md | Test design and change-specific verification registry
performance | maps/reference/performance.md | Reproducible performance measurement
```
