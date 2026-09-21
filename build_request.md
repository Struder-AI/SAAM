# Build requests

Only outstanding or incomplete work belongs here. Work normally proceeds
build-first; completed work and dated evidence belong in [DEVLOG.md](DEVLOG.md).
Current component references and skill manuals own implemented behavior.
See [documentation maintenance](BUILDERS.md#documentation-maintenance) for
the closeout rules. An empty outstanding-work list is valid.

Every request must be explicitly human requested, or agent proposed and explicitly
human approved. Record the contributor account, the request/approval evidence,
the originating chat title when recoverable, and a brief explanation of what
prompted the work. An agent's recommendation, audit finding, missing test result,
commit authorship or silence does not establish a human request or approval.
See [request provenance](BUILDERS.md#build-request-provenance) for attribution and
scope rules.

Use a `### BR-NNN — Title` heading with these fields:

- `Status`: `open`, `in progress` or `blocked`.
- `Contributor`: requesting or approving account, with the basis for attribution.
- `Authorization`: `human requested` or `agent proposed, human approved`, followed
  by the authorized scope and any explicit deferral.
- `Session`: exact observed chat title and stable ID/link when available; otherwise
  state that it is unavailable. Distinguish an origin from a later follow-up.
- `Source`: dated request/approval excerpt or faithful summary and a retrievable
  reference. For an approved proposal, retain both the proposal and approval.
- `Context`: briefly explain the originating problem or discussion; link related
  records or contracts as useful context.
- `Remaining` and `Completion`: outstanding authorized work and what resolves it.

On completion, cancellation, supersession or discovery that an item was never
authorized, preserve its provenance and disposition in the devlog and remove it
from this queue. Update owning manuals and redirect links. Partial completion
leaves only the authorized remainder. Preserve IDs; do not reuse removed IDs.
A deferred idea belongs in a decision or labeled proposal until requested.

## Outstanding work

### BR-058 — Mixed nozzle diameters on the H2D (deferred)

- Status: open
- Contributor: Current requester in the TK-DEV checkout; account attribution unconfirmed.
- Authorization: human requested — "I do want to be able to support multiple nozzle sizes" (for example a 0.4 mm left and 0.6 mm right nozzle in one job, with different layer heights, bead widths and speeds per part). The requester deferred it on 2026-09-20: it "isnt necessary for the production of my demo", and the demo comes first.
- Session: Current Claude Code desktop session `0cf04721-9d7b-42b0-b972-8a3f7527a5ab`; exact title unavailable. Follow-up to BR-056 and BR-057.
- Source: 2026-09-20 messages in this session: "Bambu doesnt support different nozzles, but SAAM absolutley should"; then "I do want to be able to support multiple nozzle sizes, but this work isnt necessary for the production of my demo... preserve what knowledge we gained here".
- Context: [The handoff](maps/reference/bambu.md#nozzle-changes-and-mixed-nozzle-diameters) records what three dual-nozzle references show. Bambu Studio refuses mixed diameters, so no reference for the case exists; the path layer already carries a nozzle per part and per-nozzle process, and validates bead-width limits per nozzle.
- Remaining: After BR-057 (equal diameters): decide which nozzle owns the `M620.11` F, the `M983.3` F and the `M1015.4` H (none of the references decides it; a conservative rule is in the handoff); build the mixed-diameter macro from per-nozzle values; confirm the firmware accepts a mixed job; print the first one under supervision and record what was observed. Everything measured so far is diameter-independent of filament type.
- Completion: A mixed 0.4 and 0.6 mm job exports with checks, a supervised print is recorded, and the ownership question is closed by observation.

### BR-057 — H2D nozzle-change output for equal nozzle diameters

- Status: implemented in software, awaiting a supervised print
- Contributor: Current requester in the TK-DEV checkout; account attribution unconfirmed.
- Authorization: human requested — produce the two-colour demo file with both nozzles at 0.4 mm ("lets get back to producing this demo file with two different colors both on 0.4 nozzles"), which needs the H2D to switch nozzles inside one job.
- Session: Current Claude Code desktop session `0cf04721-9d7b-42b0-b972-8a3f7527a5ab`; exact title unavailable. Follow-up to BR-056.
- Source: 2026-09-20 message in this session, and the supplied dual-nozzle slices (`two color test print.gcode.3mf` is the 0.4 mm / 0.4 mm reference).
- Context: [The handoff](maps/reference/bambu.md#nozzle-changes-and-mixed-nozzle-diameters) has the switch skeleton, its slots and the ordered steps; `scripts/h2d-switch-analysis.mjs` reproduces the analysis.
- Remaining: Done in software (2026-09-20): the pinned nozzle-change template in the profile, regenerating all 14 reference switches byte for byte and pinned by digest; interpreter coverage of the block (lift, counters, fans, diameters, pre-heat time); the two-filament start patch; a purge pad and heater scheduling; two-filament package metadata; real toolpath bounds for line-network paths. Not done: **a supervised hardware print**, which is the only evidence the sequence, the purge size, the idle-nozzle policy and the `M620.17` `L` flag are right. Studio does not yet colour by nozzle.
- Completion: The demo exports as a checked H2D file with two nozzles at 0.4 mm and prints under supervision, and the switch is verified against the reference.

### BR-056 — Two-nozzle demo panel with thick text over a sparse background

- Status: in progress
- Contributor: Current requester in the TK-DEV checkout; account attribution unconfirmed.
- Authorization: human requested — a flat demo rectangle on the H2D using both nozzles (the features each nozzle builds are different colours), with thick-line text in several fonts over a background of two layers of 25% infill at 45 and -45 degrees, a 2 mm border and a 1 mm ring inset 5 mm; the left nozzle prints the background and a 0.6 mm nozzle prints 3 layers of text on top. A preview was requested first; a printable job was not yet requested.
- Session: Current Claude Code desktop session `0cf04721-9d7b-42b0-b972-8a3f7527a5ab`; exact title unavailable. Follow-up to BR-054 and BR-055.
- Source: 2026-09-20 message in this session: "i want to make a demo object using the thick text skill and these thickened lines. Using both nozzles on a bambu h2D..." and "Use the skill we developed to give me a preview".
- Context: [panel.mjs](skills/line-text/scripts/panel.mjs) builds the strokes and a true-scale preview; the [devlog](DEVLOG.md) records the choices (0.5 mm background bead, fonts, 140 x 130 mm).
- Remaining: The path side is done (see [the handoff](maps/reference/bambu.md#nozzle-changes-and-mixed-nozzle-diameters)). The requester then narrowed the demo to two colours on **both 0.4 mm nozzles**, because mixed diameters are deferred (BR-058); the text is rebuilt for a 0.4 mm nozzle (bead range 0.3 to 0.8 mm, 0.3 mm layers). It now exports as a two-colour H2D job (BR-057; `Prints/development/two-color-demo`). Still to do: a supervised print, Studio colouring by nozzle, and the text's bead range from the tool's setup, not a passed range. The demo spells "Individual" (assumed from the requester's second use) and "Toolpath" with a capital T, at 140 x 128 mm.
- Completion: The panel generates a checked toolpath using both nozzles, reviewed in Studio, and its limits are recorded.

### BR-055 — Calibration prints: bead width ladder, flow rate ramp and machine flow ratings

- Status: in progress
- Contributor: Current requester in the TK-DEV checkout; account attribution unconfirmed.
- Authorization: human requested — a max flow rate defined in the machine definition (as a function of hotend and nozzle), an operating flow slightly below it, and a flow-rate calibration skill that prints a measurable test object so people can push flow rates; and a bead-width test object measured with calipers against SAAM's calculation. The requester specified the width ladder's design (two 2-layer rails across the wall ends and no wider than the walls, six walls, per-wall layer heights at a starting 1:2 ratio, finest printed first, at least 15 mm spacing) and said a developer role is not needed for work pushed to TK-DEV.
- Session: Current Claude Code desktop session `0cf04721-9d7b-42b0-b972-8a3f7527a5ab`; exact title unavailable. Follow-up to BR-054.
- Source: 2026-09-19 messages in this session: the max-flow, derating and calibration-skill proposal; "the test object I wanted to describe is this... a box with two nominal horizontal lines connecting a bunch of vertical lines that are printed at different thicknesses"; "i want it a closed box the top and bottom lines tie all of the test lines together... just 2 layers thick"; "you need a different layer height for thicker lines"; "print the lower layer heights first and proceed to thicker ones"; "change the wall spacing to at least 15mm"; and speed being declared per move, not per course.
- Context: [width-calibration](skills/width-calibration/SKILL.md) implements the ladder. Manufacturer flow figures gathered this session (H2D 40 and 65 mm3/s peak-test, 24 to 48 sustained per material; A1 28; Ultimaker under 24 at printer level) are not yet in any profile, which still carries 4 mm3/s for PLA and 30 for experimental.
- Remaining: (1) A sanctioned test-only way to command widths and layers outside the operating limits, so the 0.25 mm and 2.5 mm walls can print; the requester has not yet chosen the test envelope. (2) The flow-rate calibration ramp, declaring flow along the path (speed per segment, which the path layer already carries per move but a stroke carries once), with a test ceiling above the operating limit and plateaus long enough to measure past nozzle pressure lag. (3) Machine flow ratings keyed by hotend, nozzle and material with basis and conditions, a derated operating limit, and calibrated values kept in remembered setup; this is a shared machine-profile and validation change. (4) Storing a width or flow result and applying it, so line-text commands the width that produces the wanted stroke. (5) Physical prints of the ladder to confirm or refute the rounded-bead hypothesis. (6) Whether the spacing means centerline or face to face, if not centerline. (7) Collecting commanded-versus-actual width readings from many setups (printer, nozzle, filament, layer height) into a shared record, since the requester accepted the ladder as a calibration article for that purpose; no collection route or record format exists.
- Completion: The ladder prints whole and its readings are recorded; the flow ramp yields a calibrated limit that a print can use within the machine's rating; ratings and derating are in the machine definition; and the manuals state what was observed.

### BR-054 — Line text: size-driven single-line lettering, parallel strokes and font library

- Status: in progress
- Contributor: Current requester in the TK-DEV checkout; account attribution unconfirmed.
- Authorization: human requested — a skill that prints a word in letters, starting with single-line thick letters sized from the described text, then parallel strokes for thicker and larger text, with fonts selected from a library of single-line and handwriting-script fonts. The requester approved merging `origin/main` into TK-DEV and downloading the font files, and directed that construction follow the described size: fine single-line fonts at small sizes, `line-network`'s wide bead at larger sizes, parallel strokes once one bead cannot be wide enough.
- Session: Current Claude Code desktop session `0cf04721-9d7b-42b0-b972-8a3f7527a5ab`; exact title unavailable. Same account and checkout as BR-053's session.
- Source: 2026-09-19 messages in this session: "I want to be able to tell you a word and have you print that word out in letters… start with single-line thick letters based on the size of the text described and then start thinking in terms of parallel strokes… think about how we select fonts especially from a library of fonts… Single line fonts and handwriting script fonts"; then "merge is fine, downloading font files is good", the size-driven construction direction above, and "font library is good for now. lets keep the studio picker just a generated image preview in the chat window for now".
- Context: The [skill manual](skills/line-text/SKILL.md) owns implemented behavior. The skill compiles a word into [line-network](skills/line-network/SKILL.md) strokes: eleven bundled stroke fonts, measured font metrics, a size-driven planner, junction snapping and concentric-loop parallel beads. The [devlog](DEVLOG.md) records what was measured and verified.
- Remaining: Physical print trials of the three construction regimes, the weight and clearance defaults, dot shapes, stroke crossings and parallel-bead ends and joins; none has been printed. The requester chose the bundled eleven fonts as the library for now and a generated image preview in chat, not Studio, for font and size selection; growth beyond them (further handwriting scripts, or converting outline fonts by skeleton extraction) and any Studio picker await a new request and license review.
- Completion: A printed size ladder shows each regime holds its letterforms at the defaults, or the defaults are revised from it, and the manual's limits are updated to what was observed.

### BR-053 — Wing design workspace and airfoil selection

- Status: open
- Contributor: Current requester in the TK-DEV checkout; account attribution unconfirmed.
- Authorization: human requested — develop the workspace together, focused on Use, Shape and Construction, with an orbitable 3D wing, wireframe interior inspection, independent spar/hardware visibility and an application-relevant airfoil candidate list. Source research was requested as one of the first steps.
- Session: Current Codex task `01a0b89f-4cea-7690-b3e6-e08287855eae`; exact task title unavailable.
- Source: 2026-09-19 messages in this task: "Start with a workspace stub so we can develop the workflow together" and the follow-up requesting Use / Shape / Construction, viewer toggles, airfoil sources and a scroll-through candidate list.
- Context: The [workspace brief](skills/wing-design/DESIGN-BRIEF.md) captures the requested experience; the [source assessment](skills/wing-design/AIRFOIL-SOURCES.md) records the completed first research step. The current deliverable remains a workspace stub and research, not an operational viewer.
- Remaining: Develop the data ingestion/search and application-aware candidate comparison, editable wing/tail/control-surface geometry and Studio-integrated inspection with wireframe and spar/hardware visibility. The user's subsequent 2026-09-19 request adds guided control-surface design after airfoil selection, followed by reinforcement and fuselage attachment (bolts, rubber bands, telescoping tubes, internal or surface-embedded members, glued or Struder-welded installation). Update actual CAD at each selection stage, preserving dependent-feature consistency. Detailed implementation slices remain to be developed with the user; no aerodynamic solver, structural certification or hardware execution is implied.
- Completion: The user can discuss Use, inspect source-backed candidates, select an airfoil, design controls and tails, then choose reinforcement and attachment while the CAD assembly updates. They can orbit the result with independent viewing controls. Verify geometry/source identity, dependent edits and viewing-only visibility through the shared interfaces.

### BR-052 — Reconcile TK-DEV's wall-tracer fixes with main's mesh-sleeve refactor

- Status: open
- Contributor: tkeller@inventopia.org (Timothy Keller); account attribution from session identity.
- Authorization: human requested — asked to pull `main` into `TK-DEV`; when the merge produced a real semantic conflict in `skills/vase-wall/scripts/{vase.mjs,paths.mjs,loop-demo.mjs}` and `SKILL.md`, explicitly chose "take main's version, drop your recent fixes for now" over reconciling them immediately.
- Session: Current Claude Code session, 2026-09-17; stable ID unavailable in supplied context.
- Source: 2026-09-17 merge of `origin/main` (94c0bca) into `TK-DEV`, resulting commit `14dabbc`. See [DEVLOG](DEVLOG.md#2026-09-17--merge-originmain-into-tk-dev-and-heat-set-insert-extensions).
- Context: `main` gained a large mesh-sleeve/motif refactor to vase-wall (new `reference.mjs`, `centerlineOffset`, tiled motifs, a `motifContour` pre-simplification step) while `TK-DEV` independently carried its own tested fixes to the same functions: removing that same pre-simplification as destabilizing on a real host (commit `435f4a3`), a tight-loop tangent/self-approach hardening pass (`9ef364d`), and accepting in-plane pinch-point jumps instead of failing (`c9df55d`). The merge took `main`'s version wholesale for the conflicted files, so these three fixes are currently absent from `TK-DEV`.
- Remaining: Re-apply the pinch-point-jump tolerance, the tight-loop tangent hardening, and the `motifContour` removal (replaced by the dominant-piece fallback) on top of `main`'s current mesh-sleeve/motif/tiled-pattern structure in `vase.mjs`/`paths.mjs`/`loop-demo.mjs`, then rerun the full vase-wall test suite and, ideally, regenerate the real host STL this session's predecessor validated against (`Prints/spiral-vase-v2`) to confirm the fixes still hold under the new code paths.
- Completion: The wall tracer accepts the same pinch-point/tight-loop cases it did before the merge, `motifContour` pre-simplification is not reintroduced, `node --test skills/vase-wall/tests/*.test.mjs` passes, and a real-host regeneration is spot-checked in Studio.

### BR-051 — Complete output for the three new printer profiles

- Status: open
- Contributor: Current requester; account attribution unconfirmed.
- Authorization: human requested — add Bambu X1 Carbon and Ultimaker 2/3 profiles, keep materials changeable, then correct the 2-series model to Ultimaker 2 Extended.
- Session: Current Codex task; exact title and stable task ID unavailable in supplied conversation.
- Source: 2026-09-16 messages: "We need to add a bambu x1 carbon profile", "We can change materials, though, right? That's just the default, right?", "We also need a profile for the ultimaker 2 and 3 (same?)", and "actually it says 'ultimaker 2 extended'". [Implemented definitions and verification](DEVLOG.md#2026-09-16--x1-carbon-ultimaker-2-extended-and-ultimaker-3-profile-definitions).
- Context: Machine definitions, material choices, catalog registration and geometry/setup persistence are implemented. The profiles explicitly declare output unavailable; no compatible startup handoff or full machine-program contract has been established for these models.
- Remaining: Establish X1-specific startup/shutdown and sliced-3MF metadata with material-correct settings; implement the original UM2 Extended's volumetric UltiGCode semantics and firmware-managed startup; establish UM3-specific Griffin startup/shutdown. Use representative vendor-sliced exports and owning firmware/slicer sources to resolve these contracts. Do not inherit H2D/S5 service routines by model-name substitution. Enable each output only with matching exporter/interpreter and shared lifecycle coverage.
- Completion: Each requested profile generates a machine-specific program that can be reopened, reviewed and delivered through the shared lifecycle, with material selection reflected consistently and software checks recorded separately from any physical trial. No hardware execution is authorized by this request.

### BR-050 — Finish Studio coordination and read-path handoff

- Status: in progress
- Contributor: Current requester; account attribution unconfirmed.
- Authorization: human requested — “read handoff and get to work,” with decisions explained and questions only for genuine ambiguity; then “2. I don't think it's worth it but start the rest.” SQLite adoption is withdrawn. Brief browser disconnects retain a tour until exit/cancel or Studio shutdown.
- Session: Current Codex task; title and stable task ID unavailable in the supplied conversation.
- Source: 2026-09-15 instructions above; [implementation and decisions](DEVLOG.md#2026-09-15--file-compatible-handoff-work-after-sqlite-withdrawal), the earlier handoff in the same log, and the [live agent/Studio session follow-up](DEVLOG.md#2026-09-17--live-agentstudio-sessions-and-review-completion).
- Context: Request presentation, tour lifetime, operational polling and repeated source reads were identified in the Studio flow audit. Managed agent/Studio coordination now uses a live owner-scoped request store with explicit Studio instances; request files remain a recovery journal and external-writer compatibility path. Scoped activity, Studio-worker cancellation, review metadata updates and normal-shutdown tour cleanup are implemented. No database or runtime migration was performed.
- Remaining: Cross-process exclusive claims and atomic request/tour transitions; forced-process-death tour invalidation; a shared cancellation/supersession owner for CLI/MCP generation and edits queued behind generation; coordination of activity and cancellation writes across independent processes; concurrent verified-source reuse and remaining nested read/copy reductions. Complete the authorized audit for cold processes, large STL/native/source files, growing review history, worker costs, and simultaneous writers. Keep database adoption excluded unless separately authorized.
- Completion: Implement and exercise the remaining ownership/recovery behavior without introducing competing persistent stores; record the remaining audit measurements and their limitations. Preserve current-byte validation at approval/delivery boundaries and separate software evidence from physical results.

### BR-049 — Improve generators identified by short-travel advisories

- Status: open
- Contributor: Current requester; account attribution unconfirmed.
- Authorization: human requested — add an advisory for all Studio toolpaths and improve the responsible skills/functions “at some point.” Generator repairs are explicitly deferred; the advisory itself is implemented.
- Session: Current Codex task, `01a0a650-b120-7bd3-a9c7-93fbede5003b`; title unavailable.
- Source: 2026-09-15 request: travel start/end points “within 2mm?” indicate a bad path; “it don't block, it doesn't repair, it just let's the agent know about the problem.”
- Context: The [shared advisory](core/export/README.md#short-travel-advisory) preserves counts, operation labels and source locations for complete travel trips whose XYZ endpoints are at most 2 mm apart. Near endpoints can expose avoidable breaks or detours; recipe membership alone does not identify the responsible algorithm.
- Remaining: Other advisory-identified cases remain deferred. When taken up, use reported exports and operation/source evidence to identify and improve the responsible skills or shared routing functions while preserving intended deposition and required clearance.
- Completion: Demonstrate the targeted generator improvement against representative reported cases and record the resolved producer/cause. Keep the advisory nonblocking and avoid automatic repair during review.

### BR-045 — Complete continuous wave-overhang paths around holes

- Status: open
- Contributor: `remettub`, explicitly identified in the originating conversation as the contributor on this machine.
- Authorization: human requested — generalize wave overhangs to curved bivariate spline slices, support holes as in the exemplar, and use unbroken continuous passes per layer. No exception allowing branch restarts or arbitrary extruded retracing has been approved.
- Session: “Add wave overhang spline skill” (`01a0a191-8027-7f13-bf42-7b88316cc5ed`).
- Source: current conversation, 2026-09-14: “Must always use unbroken continuous passes per layer in this type of geometry”; “If the exemplar supports holes, we can too”; supplied [Janis Andersons short](https://www.youtube.com/shorts/RxPW5A4__X4), and clarified that SAAM introduced the glue jogs without an established exemplar.
- Context: The first generator split fronts and inserted travels. The correction preserves complete fronts and accepts a slice only when short in-domain turns form one continuous stroke. The [reference findings](skills/wave-overhangs/BUILDER.md#research-and-license-findings) establish that the slicer exemplar permits branch restarts; they do not establish an uninterrupted whole-slice strategy for arbitrary holes. A clarification about that distinction is pending. The current no-hole diagnostic is not completion of hole support.
- Remaining: Resolve the continuity requirement against the intended exemplar and complete the corresponding hole-branch routing. Retain the strict continuity rejection until an explicit exception is authorized; do not add unreviewed glue/retrace strokes or silently remove holes. The original local hole recipe `Prints/wave-overhangs-preview-20260914` is preserved and presently requires five disconnected passes.
- Completion: Generate and review the intended curved hole example with the agreed continuity behavior, including support order, in-domain connections and exported movement checks. Update the [skill manual](skills/wave-overhangs/SKILL.md) and record software evidence separately from any physical trial.

### BR-044 — Port a vetted material library

- Status: open
- Contributor: Unconfirmed for the approving speaker; `tkeller` is explicitly identified as the source of the withdrawn material-library concept, not as the approver of this deferred port.
- Authorization: human requested — commit to a future material-library port, explicitly defer implementation until the user starts it. This approves the concept, not the withdrawn implementation.
- Session: “tkeller integration + contributor policy” (`01a09bdb-b64f-7dd1-a361-cd38dea3d245`).
- Source: 2026-09-13T18:48:54Z: “mark material library as definitely we will port that over - but don't do it yet.” Same message identifies “tkeller's three conceptual intents”. [Withdrawal record](DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission).
- Remaining: Port the material-library concept to the live shared architecture when the user explicitly starts this work. The user commits to doing it, but defers implementation; do not restore the withdrawn catalog or implement it during recovery.
- Completion: Review the selected data and interfaces against current material, machine, output and recipe consumers; preserve machine-owned compatibility and intentional process settings. Establish the concrete supported scope and relevant evidence before admitting the implementation. Catalog availability does not establish hardware or output support.
- Context: Four September 12 contributions were withdrawn to restore the agreed architecture. The user retained three concepts for selective review and singled out the material library as committed future work. [Current component contracts](core/README.md#interoperability-and-one-workflow), [minimal implementation guidance](BUILDERS.md#engineering-priorities).
