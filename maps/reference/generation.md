# Generation and plan contracts


## Changing plan schema and compatibility

Sources: [plan.mjs](../../core/print/plan.mjs).

**Contract.** defaults combines shared process/skill defaults with the selected machine setup/process/output. geometryTemplate selects allowed shape fields. canonical sorts object keys recursively while retaining array order; hash digests canonical values or supplied bytes. validatePlan is check-only: it never mutates the plan it is given. Every field defaults emits is required by the strict field/schema/version check, so a bundle written before the current schema is rejected rather than migrated; recreate it from its skills, as [the status note](../../DEVELOPER-CONTEXT.md#status-note) directs. validatePlan then validates setup and skill capabilities, and validates regional overrides through child plans. A region owns its selection, height interval and enabled skills; global process skills remain outside material-region overrides. The one optional field is a region's non-empty `process` override record (see [regions](regions.md)); it is absent, never defaulted. `process.experimentalDeposition` widens the plan's layer, bead-width and flow caps to 1 mm, 2 mm and 30 mm³/s, and switches the machine check to the tool's `experimentalPlanar` envelope and the material's `experimentalMaxFlowMm3S`; a tool without that envelope rejects it.

**Failures.** Unknown or missing fields, unsupported shape/version/output, invalid machine setup, duplicate or unknown selections, illegal regional overrides and self/unknown lower-surface references reject. Retired settings — standalone XYZ vase paths, the vase point budget, region `supportPolicy` — are unknown fields and reject with them. Semantic dependency cycles and actual material coverage are checked during regional generation, not proved by schema validation.

**Change together.** A new field needs defaults, strict template membership, validation, hash/invalidation semantics, CLI adjustment handling and Studio settings presentation. A removed field needs the same list, plus the fixtures and examples that still carry it. Coordinate new shapes with buildShell, native persistence, selections and query capabilities.

**Verification.** Use current recipe fixtures, typo rejection, per-machine defaults and a regional child override. Confirm a plan survives validation byte-identical, and that a recipe missing a current field is rejected rather than completed. Checks: [pipeline.test.mjs](../../core/tests/pipeline.test.mjs), [regional-workflow.test.mjs](../../core/tests/regional-workflow.test.mjs), [printer-profiles.test.mjs](../../core/tests/printer-profiles.test.mjs).


## Changing generation orchestration

Sources: [generate.mjs](../../core/print/generate.mjs).

**Contract.** generatePath validates the locked plan, creates/translates native geometry, constructs one PathBuilder from the machine startup position/retraction state and invokes existing skill producers. Regional and ordinary assignments share the result/composition pipeline. Ordinary draped-skin survey precedes supporting fill because it determines material reservation. Finished surfaces bind later consumers to actual producer operations. Rims/supports, wave work and weld completion enter the same dependency graph. An enabled line-network is a standalone producer: validation forbids it alongside geometry-derived body, skin, vase, lip or regional producers, and it emits the plan's explicit centerlines directly after checking them against the selected tool's bounds. Profile priming sees all produced footprints unless a locked `process.primeLine` replaces it; composition is followed by park/fan-off and the resulting SAAMpath report.

**Failures.** Reject incompatible overlapping body owners, absent selected components, invalid vase bases/layer alignment, missing material producers and tool-bound violations unless the profile explicitly defers that check. A skill failure does not produce a partially accepted manufacturing path. Generation still makes no claim of physical collision clearance.

**Change together.** Keep producer order, source operation IDs, material ownership, summary fields, startup state and consumer dependencies consistent. Skill implementation contracts remain in their separate authoring references; shared orchestration belongs here. Preserve mesh planarDetails through placement and assembly handling.

**Verification.** Trace one ordinary fill/skin recipe, one assembly, one regional
recipe and affected optional producers. The machine profile normally owns
whole-plan priming. An explicitly locked `process.primeLine` record replaces
that default for the print and may describe one pass or a bounded pass list; it
is emitted before every material operation and replaced atomically by recipe
adjustment because its two forms have different strict fields. Check
source/export consumers when action metadata or priming changes. Checks:
[pipeline.test.mjs](../../core/tests/pipeline.test.mjs), [interoperability.test.mjs](../../core/tests/interoperability.test.mjs), [composition.test.mjs](../../core/tests/composition.test.mjs), [prime.test.mjs](../../core/tests/prime.test.mjs), [workflow.test.mjs](../../core/tests/workflow.test.mjs).


## Changing regional material publication

Sources: [regions.mjs](../../core/print/regions.mjs).

**Contract.** Assignments become records with world-space start/end and dependency sets. Overlapping selections require an explicit consumed lower surface; nonoverlapping stacked records inherit predecessors. Ready records are ordered by start height with input order as tie-breaker. Published surfaces carry footprint, solidFootprint, a top query, sampled field, coverage kind and sourceOperationIds. The highest emitted material owns each XY location: lower solid masks cannot fill a higher sparse top. A spaced skin publishes bead strips; a level vase publishes its deposited rim; thick-lip publishes no consumable top. A process reservation may publish its explicit completing operation.

**Failures.** Cycles, floating starts, nonlevel vase transitions, skipped material above a lower surface, unsupported hollow/sparse ownership and assignments producing no material reject. Surface fields are sampled and bounded; they are not measured bead reconstructions. The planar support-grid fallback supplies a lattice level for bridging, not a claim that material exists throughout the void.

**Change together.** Change producer coverage masks, reservation queries, selected-part overlap, lower-surface dependencies and consuming fill/skin tests together. Preserve sourceOperationIds when adding an operation that completes a reserved region; a published height without its prerequisite is incorrect.

**Verification.** Verify solid versus sparse tops, curved consumed surfaces, holes, translated assemblies, overlapping assignments, cycles and missing support. Compare actual emitted masks and prerequisite IDs, not merely aggregate volume. Checks: [regions.test.mjs](../../core/tests/regions.test.mjs), [regional-workflow.test.mjs](../../core/tests/regional-workflow.test.mjs), [reservation-surface.test.mjs](../../core/tests/reservation-surface.test.mjs), [assembly-reservation.test.mjs](../../core/tests/assembly-reservation.test.mjs), [finished-cladding.test.mjs](../../core/tests/finished-cladding.test.mjs).
