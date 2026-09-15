# Build requests

Only outstanding or incomplete work belongs here. Work normally proceeds
build-first; completed work and dated evidence belong in [DEVLOG.md](DEVLOG.md).
Current component references and skill manuals own implemented behavior.
See [documentation maintenance](DEVELOP.md#documentation-maintenance) for
the closeout rules. An empty outstanding-work list is valid.

Every request must be explicitly human requested, or agent proposed and explicitly
human approved. Record the contributor account, the request/approval evidence,
the originating chat title when recoverable, and a brief explanation of what
prompted the work. An agent's recommendation, audit finding, missing test result,
commit authorship or silence does not establish a human request or approval.
See [request provenance](DEVELOP.md#build-request-provenance) for attribution and
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

### BR-045 — Complete continuous wave-overhang paths around holes

- Status: open.
- Contributor: `remettub`, explicitly identified in the originating conversation as the contributor on this machine.
- Authorization: human requested — generalize wave overhangs to curved bivariate spline slices, support holes as in the exemplar, and use unbroken continuous passes per layer. No exception allowing branch restarts or arbitrary extruded retracing has been approved.
- Session: “Add wave overhang spline skill” (`01a0a191-8027-7f13-bf42-7b88316cc5ed`).
- Source: current conversation, 2026-09-14: “Must always use unbroken continuous passes per layer in this type of geometry”; “If the exemplar supports holes, we can too”; supplied [Janis Andersons short](https://www.youtube.com/shorts/RxPW5A4__X4), and clarified that SAAM introduced the glue jogs without an established exemplar.
- Context: The first generator split fronts and inserted travels. The correction preserves complete fronts and accepts a slice only when short in-domain turns form one continuous stroke. The [reference findings](skills/wave-overhangs/DEVELOP.md#research-and-license-findings) establish that the slicer exemplar permits branch restarts; they do not establish an uninterrupted whole-slice strategy for arbitrary holes. A clarification about that distinction is pending. The current no-hole diagnostic is not completion of hole support.
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
- Context: Four September 12 contributions were withdrawn to restore the agreed architecture. The user retained three concepts for selective review and singled out the material library as committed future work. [Current component contracts](core/README.md#interoperability-and-one-workflow), [minimal implementation guidance](DEVELOP.md#engineering-priorities).
