# Build requests

Only outstanding or incomplete work belongs here. Work normally proceeds
build-first; completed work and dated evidence belong in [DEVLOG.md](DEVLOG.md).
Current component references and skill manuals own implemented behavior.
See [documentation maintenance](CONTRIBUTING.md#documentation-maintenance) for
the closeout rules. An empty outstanding-work list is valid.

## Outstanding work

### BR-044 — Prepared download platform and client acceptance

- Status: blocked
- Remaining: GitHub publication, native macOS/Windows ARM64/Linux matrix results and live desktop permission behavior lack verification. Publishing the workflow needs restored terminal Git authentication; removing main's remote test requirement needs repository admin access unavailable to the current connector.
- Completion: Publish the locally checked branches after authentication is restored, remove only the required test status as authorized, run the prepared/source archive matrix and record live Claude Code Desktop/Codex Desktop first-use behavior with the supported downloads.
- Context: [Implementation and Windows evidence](DEVLOG.md#2026-09-12--prepared-repository-downloads-and-consolidated-setup), [download procedure](scripts/FIRST-RUN.md), [Studio permissions](studio/README.md#studio-agent-permissions).

These entries retain unresolved requests and acceptance checks from the existing
records. Current task instructions determine what to take up. Lack of recorded
acceptance is not a new report of failure or authorization for hardware execution.
Limitations and deferred ideas do not automatically become implementation work;
[decisions](DECISIONS.md) owns deferred discovery, packaged deployment and more
complex region ordering.

### BR-005 — Complete print and novice workflow evaluation

- Status: open
- Remaining: A novice workflow evaluation and a validated complete physical print lack recorded acceptance. Evaluate feature identification, edits, the three reviews, recovery, save/reopen and delivery, including the setup and clarification effort relative to the same agent using existing CAD/slicing tools.
- Completion: Record the novice's actual workflow observations and the physical outcome for a specified printer/material/nozzle. Software checks alone do not close this item; real job approvals stay with the maker.
- Context: [Initial print request](DEVLOG.md#br-005--first-complete-print), [Studio evaluation](DEVLOG.md#br-006--saam-studio-interaction-and-export-interpretation), [evaluation proposal](DEVLOG.md#what-should-earn-adoption-next).

### BR-018 — H2D acceptance and physical retest

- Status: open
- Remaining: Independent Bambu Studio program-viewer acceptance, the corrected relative-extrusion physical retest and physical testing of the v2 startup sequence lack recorded results.
- Completion: Record program-viewer acceptance and user-observed physical results against the exact corrected export and startup revision, with the normal human reviews. Model-import CLI checks do not establish program-viewer acceptance.
- Context: [H2D implementation](DEVLOG.md#br-018--h2d-output-from-the-supplied-nozzle-references), [physical report and correction](DEVLOG.md#br-019--h2d-wedge-and-studio-reopenactivity), [startup checks](DEVLOG.md#2026-09-09-to-2026-09-10--h2d-reference-and-startup-checks), [current output contract](core/export/bambu.md#h2d-output-contract).

### BR-023 — Matched slicer and public-workflow comparison

- Status: open
- Remaining: Matched Cura/Bambu Studio planar timing and complete public-workflow load/check/generate comparisons lack a controlled result. Existing measurements have unequal settings, coverage or timing boundaries.
- Completion: Compare the same part and matched planar settings using saved profiles, exact versions, thread counts and repeated timings; separate loading, generation, checking/export and UI-ready time. Report failures and non-planar coverage differences separately.
- Context: [Benchmark request and initial findings](DEVLOG.md#br-023--slicing-performance-baseline), [benchmark procedure](scripts/bench/README.md#slicing-speed-benchmarks).

### BR-026 — Web-client pairing and Claude plugin acceptance

- Status: open
- Remaining: Actual ChatGPT/Claude vendor-client connection acceptance and Claude plugin upload/tool use lack recorded acceptance in the user's account.
- Completion: Verify pairing and ordinary tool use through the actual supported web clients and the uploadable Claude package; record the client, route and result. Temporary bridge/browser fixtures alone do not close this acceptance check.
- Context: [Connection work and pairing corrections](DEVLOG.md#br-026--temporary-web-chat-connection), [current connector guidance](adapters/mcp/README.md).

### BR-034 — Live Claude Code permission behavior

- Status: open
- Remaining: Live Claude Code launch/use/close behavior and browser permission persistence across Studio ports lack verification in an installation with Claude Code.
- Completion: Exercise the shared rules with that client and record the actual permission behavior, including instance ownership and closure.
- Context: [Permission implementation and verification scope](DEVLOG.md#br-034--shared-studio-permissions-for-codex-and-claude-code), [current setup](studio/README.md#studio-agent-permissions).

### BR-039 — Slicing latency and remaining validation duplication

- Status: open
- Remaining: The requested 10–12 second slicing target lacks a qualifying end-to-end result. Audit follow-through includes repeated settings validation at direct shell/wedge generation, spline closure work under rigid placement and repeated selected-surface field validation. Recheck each site against current source before changing it.
- Completion: Resolve or justify the remaining duplicate checks at their owning boundaries; measure the current recipe from user action to useful result with stage timings and unchanged quality/settings. Report the achieved latency and any remaining target gap explicitly.
- Context: [Validation audit](DEVLOG.md#br-039--remove-repeated-validation-and-make-slicing-progress-truthful), [subsequent kernel measurements](DEVLOG.md#br-041--complete-shared-clipper2-integration), [validation ownership](core/print/README.md#validate-at-the-boundary-that-owns-the-data).

### BR-040 — Precision audit follow-through

- Status: open
- Remaining: Audit priorities include polygon coordinate/vertex budgets, dimensionally inconsistent or scale-dependent repair/projector determinant thresholds, UV-to-physical error mapping, separate export field budgets and accumulated relative-E error, volume handling for coordinate collapse, and oriented-motion small-move policy.
- Completion: Resolve or justify each finding using dimensionally appropriate contracts and measured cost/shape/volume effects. Changes must preserve material and relevant machine semantics; this is not a blanket instruction to coarsen tolerances.
- Context: [Audit and export follow-up](DEVLOG.md#br-040--dimension-aware-precision-audit-and-developer-guidance), [current precision guidance](core/geom/README.md#precision-belongs-to-a-quantity-and-an-operation).

### BR-043 — S5 startup diagnosis

- Status: open
- Remaining: The actual export and extra firmware actions behind the reported startup discrepancy remain unidentified. Physical confirmation of the shared first-deposition recovery correction is also open.
- Completion: Identify the delivered bytes and relevant installation behavior, diagnose the discrepancy and record the user's startup result for the correction. Do not generalize an earlier successful envelope report to another revision or installation.
- Context: [Existing S5 reports](DEVLOG.md#2026-09-08-to-2026-09-10--s5-startup-observations), [current S5 contract](core/export/griffin.md#s5-startup-observations).
