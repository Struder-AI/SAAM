# Decisions

Contributors: `tkeller`, `remettub`.

Each entry states one decision, its status, a recording timestamp, approvals,
and a brief source. Both contributors' approval makes a decision **accepted**;
one contributor's approval makes it **provisional**. Never infer approval from
authorship, silence, agent work, or agreement on a different decision.

SAAM Studio has approval from both contributors as explicitly reported by
remettub. Other entries record only the approvals stated in their metadata.
The timestamp identifies instruction recording; the conversation does not
expose an exact timestamp for the human's message.

Contributor status and current work authorization are distinct. Entries D-021
onward record explicit user direction without attributed contributor identity; `proposed` does not negate that authorization. Follow their stated
scope for implementation. Earlier attributed approvals remain historical
records and are not extended to later wording. In particular, [D-027](#d-027--export-only-print-persistence)
owns current print persistence; D-015 and D-019 preserve the earlier wording.
Work history belongs in [DEVLOG.md](DEVLOG.md). Decision quotations, approval
events and approved wording retain their historical tense and dates under the
[provenance exception](DEVELOP.md#documentation-maintenance).

Use a `## D-NNN — Title` heading and record `Status`, `Decision`, `Recorded`,
`Approvals` and `Source`. The recording timestamp uses UTC ISO 8601 format.
Preserve exact source quotations and approval events; surrounding prose describes
the current decision and status. Do not extend earlier approval to changed wording.

## Statuses

| Status | Meaning |
|---|---|
| proposed | No contributor approval recorded. |
| provisional | One contributor approves. |
| accepted | Both contributors approve; called active in the initial request. |
| superseded | Replaced by a named later decision. |
| rejected | Explicitly declined and closed. |
| withdrawn | No longer pursued. |

Record objections and substantive approval/status changes with actor, time and
source. Do not infer the second contributor's approval. An accepted decision
remains effective until its replacement is accepted. Provisional decisions may
be replaced by the contributor whose approval they carry. Approval refers to
the recorded decision wording, not later substantive edits.

Source R1: remettub's restart request in the SAAM skeptical-assessment/restart
conversation in Codex, observed 2026-09-08. Identifying excerpt:
“Let's do a clean restart, and pull over selected components, decisions, or
concepts on your recommendation and my approval.”

Source R2: remettub's subsequent viewer/approval clarification in the same
conversation, observed 2026-09-08. Identifying excerpt:
“The toolpath viewer ... needs to run the same machine file the machine will get.”

Source R3: remettub's subsequent simplification request in the same conversation,
observed 2026-09-08; includes “Let's call them maker agents” and “SAAM Studio it is
(approved by both developers - accepted status).”

Source R4: remettub's clarification that a print includes the internal toolpath
representation and its export, matching an output option in the machine file.
Source R5: remettub's follow-up, “Let's use SAAMpath”. Both observed 2026-09-08.

Source R6: remettub requested a clean refreshed repository this cycle, committed
and pushed on a new `refresh` branch. Source R7: “Let's go with rhino. My familiarity
will be useful.” Source R8: remettub clarified the destination is directly
`https://github.com/Struder-AI/SAAM`, not the personal fork. Observed 2026-09-08.

## D-001 — Clean restart with selective adoption

- Decision: Restart SAAM; adopt selected previous components, decisions, or concepts only on recommendation and explicit human approval.
- Status: provisional
- Recorded: 2026-09-08T20:26:47Z
- Approvals: remettub — R1; tkeller — not recorded
- Source: R1, “pull over selected components, decisions, or concepts on your recommendation and my approval.”

## D-002 — One entry point, two agent contexts

- Decision: AGENTS.md holds shared context and routes use and development roles; developers also load use context when testing. CLAUDE.md only points to AGENTS.md.
- Status: provisional
- Recorded: 2026-09-08T20:26:47Z
- Approvals: remettub — R1; tkeller — not recorded
- Source: R1, “AGENTS is the entry point for both”.

## D-003 — Contributor approval determines decision status

- Decision: Decisions are concise, with provenance, timestamp, and status. Approval by both tkeller and remettub makes a decision active; approval by one makes it provisional. Later decisions can supersede earlier ones.
- Status: provisional
- Recorded: 2026-09-08T20:26:47Z
- Approvals: remettub — R1; tkeller — not recorded
- Source: R1, “If both approve a new decision, it's active”.

## D-004 — Preserve the mission and serve non-technical users

- Decision: Preserve the describe–inspect–approve–machine-file mission; lower the barrier to 3D printing through a seamless, reliable experience and guidance appropriate to the user's knowledge.
- Status: provisional
- Recorded: 2026-09-08T20:26:47Z
- Approvals: remettub — R1; tkeller — not recorded
- Source: R1, “a non-technical person should be able to point their agent at the repo”.

## D-005 — Build an ecosystem of slicer components

- Decision: SAAM includes slicing; scope includes spline curves, bivariate spline surfaces, and toolpath layers defined by angled planes or nonplanar surfaces.
- Status: provisional
- Recorded: 2026-09-08T20:26:47Z
- Approvals: remettub — R1; tkeller — not recorded
- Source: R1, “We ARE building a slicer, or rather, we are building an ecosystem of slicer components.”

## D-006 — Plans reference geometry and process choices

- Decision: The new process plan references geometry and incorporates user and agent toolpath and parameter choices; output adapters target each machine's language as needed.
- Status: provisional
- Recorded: 2026-09-08T20:26:47Z
- Approvals: remettub — R1; tkeller — not recorded
- Source: R1, “it references the geometry file, incorporates user+agent toolpath and parameter choices.”

## D-007 — The workbench supports shared geometry references and program inspection

- Decision: Provide a part viewer where the user and agent can reference features, surfaces, and edges, and a generated-program viewer for inspecting toolpaths.
- Status: provisional
- Recorded: 2026-09-08T20:26:47Z
- Approvals: remettub — R1; tkeller — not recorded
- Source: R1, “The workbench needs to perform two functions”.

## D-008 — Two human approval stages

- Decision: The making workflow has exactly two human approval stages: geometry, then toolpath; no additional export approval.
- Status: superseded by D-011
- Recorded: 2026-09-08T20:36:10Z
- Approvals: remettub — R2; tkeller — not recorded
- Source: R2, “#1 geometry is approved, and #2 toolpath is approved.”
- Event: 2026-09-08T22:28:14Z — remettub replaced this provisional decision via R3.

## D-009 — The viewer runs the delivered machine files

- Decision: The program viewer runs the same machine file or file bundle the machine will receive; toolpath approval applies to those exact files.
- Status: provisional
- Recorded: 2026-09-08T20:36:10Z
- Approvals: remettub — R2; tkeller — not recorded
- Source: R2, “needs to run the same machine file the machine will get.”

## D-010 — Automated checks precede the viewer

- Decision: Complete automated checks before sending machine code to the program viewer.
- Status: provisional
- Recorded: 2026-09-08T20:36:10Z
- Approvals: remettub — R2; tkeller — not recorded
- Source: R2, “Whatever automated checks need to be done should happen prior to sending machine code to the viewer”.

## D-011 — Three human approval stages

- Decision: Approve geometry, then the locked process plan, then the toolpath; delivery adds no further approval.
- Status: provisional
- Recorded: 2026-09-08T22:28:14Z
- Approvals: remettub — R3; tkeller — not recorded
- Supersedes: D-008
- Source: R3, “we need 3 approvals actually. #2 is to approve the locked process plan.”

## D-012 — Generate directly from the locked process plan

- Decision: The locked process plan specifies the process choices needed to generate the native path directly; no separate planning stage follows it.
- Status: provisional
- Recorded: 2026-09-08T22:28:14Z
- Approvals: remettub — R3; tkeller — not recorded
- Source: R3, “If we can't, the process plan isn't scoped widely enough.”

## D-013 — Maker agents

- Decision: Call agents using SAAM maker agents; development agents also take that role when testing.
- Status: provisional
- Recorded: 2026-09-08T22:28:14Z
- Approvals: remettub — R3; tkeller — not recorded
- Source: R3, “Let's call them maker agents.”

## D-014 — Skills package manuals and tools

- Decision: Skills package their own instruction manuals and tools; do not introduce separate contracts or evidence documentation hierarchies at this stage.
- Status: provisional
- Recorded: 2026-09-08T22:28:14Z
- Approvals: remettub — R3; tkeller — not recorded
- Source: R3, “skills always come with their own text instruction manual.”

## D-015 — Local print bundles

Historical approved wording; current persistence direction is [D-027](#d-027--export-only-print-persistence).

- Decision: Keep prints in a local Prints folder; a print bundles its process plan, native path and output toolpath. Share only specifically curated examples.
- Status: provisional
- Recorded: 2026-09-08T22:28:14Z
- Approvals: remettub — R3; tkeller — not recorded
- Source: R3, “Prints are local and are not pushed to the remote”.

## D-016 — SAAM Studio

- Decision: Name the user interface SAAM Studio.
- Status: accepted
- Recorded: 2026-09-08T22:28:14Z
- Approvals: remettub — R3; tkeller — explicitly reported by remettub in R3
- Source: R3, “approved by both developers - accepted status”.

## D-017 — Decision statuses

- Decision: Use proposed, provisional, accepted, superseded, rejected and withdrawn; accepted names the both-contributor approval level initially called active.
- Status: provisional
- Recorded: 2026-09-08T22:28:14Z
- Approvals: remettub — R3; tkeller — not recorded
- Source: R3, “Your decisions status are good” and “accepted status”.

## D-018 — SAAMpath

- Decision: Name SAAM's internal toolpath representation SAAMpath; the name can be revised later.
- Status: provisional
- Recorded: 2026-09-08T22:31:32Z
- Approvals: remettub — R4/R5; tkeller — not recorded
- Source: R5, “Let's use SAAMpath”.

## D-019 — A print includes SAAMpath and its export

Historical approved wording; current persistence direction is [D-027](#d-027--export-only-print-persistence).

- Decision: Bundle SAAMpath and the export produced from it; the export must match an output option declared by the machine file.
- Status: provisional
- Recorded: 2026-09-08T22:31:32Z
- Approvals: remettub — R4; tkeller — not recorded
- Source: R4, “our own internal toolpath representation ... AND the export produced from it”.
- Clarifies: D-009's delivered executable files are called exports; machine file names the machine definition here.

## D-020 — Rhino geometry

- Decision: Use Rhino as the geometry platform, with its 3DM format as native geometry.
- Status: provisional
- Recorded: 2026-09-08T22:40:51Z
- Approvals: remettub — R7; tkeller — not recorded
- Source: R7, “Let's go with rhino. My familiarity will be useful.”

## D-021 — Native mesh geometry

- Decision: Make mesh the native part-geometry representation; support CAD-to-mesh conversion with explicit tolerances. Native mesh storage should not require Rhino/3DM. Keep sections as curves/regions and SAAMpath as motion/process data.
- Status: proposed
- Recorded: 2026-09-09T16:24:37Z
- Approvals: Current user explicitly requested the native-mesh direction; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User, 2026-09-09, this design-review task: “It makes more sense to have mesh be the native format (decision change)”.
- Replaces on contributor attribution/approval: D-020's native-format choice. Its earlier approval record is preserved; no second-contributor agreement is inferred.
- Scope: Design and requirements for review only. No runtime migration, new mesh encoding, or legacy adoption is approved by this record. The sections/SAAMpath distinction is an agent recommendation for review.
- Clarification, 2026-09-09: user confirmed “Yes—support both backends” to retaining direct spline slicing and adding mesh behind the shared skill interface, with mesh as the default imported-part format. This replaces the earlier suggestion that every spline must be converted before geometry approval. Existing spline native storage remains supported; the contributor attribution caveat above is unchanged.

## D-022 — Defer automatic capability discovery

- Decision: Defer automatic machine/skill discovery and extensible catalog or registration infrastructure. During development at the current single location, MCP uses the fixed supported machines and skills and exposes the existing print workflow. Keep validation of a selected plan's geometry, skill and machine combination; a fixed list is not proof of compatibility.
- Status: proposed
- Recorded: 2026-09-10T00:01:30Z
- Approvals: Current user explicitly directed the deferral and its recording; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User in the legacy-adoption session, 2026-09-09 local time: “We are in development, running at one location, all machines are available here.” Follow-up: “Record the deferred discovery decision.”
- Scope: Active instruction for this implementation. Automatic discovery can be reconsidered when multiple installations or independently installed capabilities create a need. No contributor consensus is inferred.

## D-023 — Future deployment: local SAAM application with a hosted relay

- Decision: Adopt a local SAAM application for Windows and macOS with a hosted relay as the future deployment direction; defer implementation. The relay would connect compatible agents, including web-based chat clients, to the user's local SAAM workflow. Prioritize compatibility with commonly used agent clients and ease of onboarding. Keep generation and print bundles local, using the shared geometry, locked-plan, toolpath review and exact-byte delivery workflow; people give the three approvals in Studio.
- Status: proposed
- Recorded: 2026-09-10T04:14:08Z
- Approvals: Current user explicitly selected this deployment direction and requested its recording; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User in the Studio deployment discussion, 2026-09-09 local time: “We'll go with local SAAM app and hosted relay. Record in decisions.” Earlier requirements: “We'd need it for mac as well” and “The main priorities are compatibility with the agents that most people use, and ease of onboarding experience.”
- Clarification: The user subsequently specified: “Let's put this in as a future direction, we won't be doing it immediately.”
- Subsequent scope, 2026-09-10: D-024 authorizes a temporary development connection for the existing browser-based Studio now. Packaged Windows/macOS applications and a production hosted relay remain future work.
- Scope: Future direction only, with no immediate implementation planned or authorized by this record. The packaged application and hosted relay are not yet implemented. Hosting provider, desktop framework, authentication/pairing and client-specific installation details remain to be designed when this work is taken up. Compatibility must be established for each supported client; MCP support alone does not establish universal web-chat access. This entry preserves D-015's local print bundles and does not change D-022's discovery deferral. Contributor status remains proposed until approval can be attributed under the rules above; this does not negate the user's explicit selection.

## D-024 — Temporary web-chat access to the existing local workflow

- Decision: Implement a temporary development connection now so compatible ChatGPT and Claude web chats can drive the existing local MCP tools and browser-based Studio. Run the bridge locally and use a temporary hosted HTTPS tunnel; keep generation, print bundles, Studio and the three human job approvals local. Packaged applications and production relay deployment remain deferred under D-023.
- Status: proposed
- Recorded: 2026-09-10T04:30:05Z
- Approvals: Current user explicitly requested this implementation; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User in this deployment task: “we can use our existing web app based SAAM, mcp, and hosted relay to drive our current implementation from a web chat. Right? We should do that now”. Clarifications: “Both ChatGPT and Claude” and “Yeah do the temp, we're just going to host relay from local during dev”.
- Scope: Authorized development work through the shared workflow, with OAuth connection authorization distinct from manufacturing approvals. Actual vendor-web-chat acceptance must be tested in the user's account. No contributor consensus, hardware execution or public directory listing is inferred.

## D-025 — Support areas assigned through judgment

- Decision: The maker and agent use judgment to explicitly assign support areas in the proposed process plan. Do not automatically scan the whole part and assign support areas from overhang angles. Generation may calculate the geometry and toolpaths of the assigned supports, including branches and interfaces, under the locked settings; it must not introduce additional support areas. This applies to conventional, tree and future rimming supports.
- Status: proposed
- Recorded: 2026-09-10T08:39:05Z
- Approvals: Current user explicitly directed this behavior and requested its recording; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User in the infill/support task: “I do NOT like how deterministic slicers automatically scan the whole part and assign support area based on angle, so we will not be doing that.” Follow-up in the same message: “Record the decision. We will be using judgement to assign support areas.”
- Scope: Active implementation instruction, including the user's 2026-09-10 rimming and ordering clarifications. Local geometry queries construct assigned supports and clearances; they do not decide where support is needed. Rimming uses assigned bivariate spline surfaces, two outward bead paths and bed/edge bases, with separate horizontal-offset and surface-normal-offset skills for comparison. The 45-degree lean preference is guidance. Both skills wait for the entire base edge, then finish before anything they support starts; among ready operations, prefer similar printing heights across skills. Planar boundaries are the horizontal case of these rules. The [rimming specification](skills/rimming-planar/DEVELOP.md#rimming-support-specification) owns the construction details. The three job approvals remain unchanged.

## D-026 — Closest region entry first; defer heat considerations

- Decision: Initially order segmented fill regions by the closest entry point from the current nozzle position, completing each region before choosing the next. Defer heat-based region ordering. Review this simple approach on the flange before deciding whether a more complex algorithm is justified.
- Status: proposed
- Recorded: 2026-09-10T19:08:43Z
- Approvals: Current user explicitly requested implementation and recording of the heat deferral; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User in the region-ordering task, 2026-09-10: “We don't need to consider heat (yet - record this decision to defer these considerations).” Follow-up in the same message: “Just a simple \"jump to closest entry point\" would be a massive improvement already. Let's implement that first, show it to me on the flange part, and then we will see if a more complex algorithm is justified.”
- Scope: Active implementation instruction, including the 2026-09-10 endpoint correction. Compare both endpoints of both end rows (up to four entries) by straight-line XYZ distance; choose row order and stroke direction independently. Keep operation/support dependencies, shared travel handling and existing layer cooling. Lookahead, travel-time scoring and heat balancing are deferred.
- Correction source: the user observed missed nearest entries in flange playback near 5:08. The initial two-entry implementation and subsequent comparison measurements are retained in [BR-036](DEVLOG.md#br-036--closest-entry-ordering-for-segmented-fill).

## D-027 — Export-only print persistence

- Decision: Persist the checked machine export, plan, geometry and review records in local print bundles. SAAMpath motion is transient during generation; do not require a saved intermediate path or regenerate an unchanged export when reopening. Review and delivery use the saved export, in an output option declared by the machine file.
- Status: proposed
- Recorded: 2026-09-11T21:41:51Z
- Approvals: Current user explicitly requested the persistence change; remettub — not attributed in the source record; tkeller — not recorded.
- Source: User instruction recorded 2026-09-10 in [BR-030](DEVLOG.md#br-030--export-only-bundles-and-measured-flange-speed): remove mandatory saved SAAMpath and regeneration on Studio reopen. This is a summary of the preserved request, not a verbatim quotation.
- Scope: Current implementation direction replaces the saved-path requirement in D-015/D-019. Their attributed approval metadata is preserved; formal contributor supersession remains unresolved. Local-only storage, curated sharing, machine-declared outputs and the three job approvals are unchanged.

## D-028 — Simple machine ghost and Machine view

- Decision: Add machine context to Studio through a default ghost overlay and one Machine view switch. Preserve ordinary zoom in both modes and Studio's existing simple, carefully composed visual language. Represent links, rails and print carriages with lines and basic shapes, integrated with the existing bed/tool and detailed toolpath. Studio delivers the complete consumer as one work package while machine models develop incrementally through the shared [presentation contract](studio/KINEMATICS.md).
- Status: proposed
- Recorded: 2026-09-13T18:01:13Z
- Approvals: Current user explicitly selects the presentation direction and requests the integration contract; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User in the kinematic presentation task, 2026-09-13: “we definitely have to go with machine ghost + toggle switch to go to machine view”; “we can stick to lines, shapes, cones, etc.” Subsequent scope correction: “We need links and rails and a print carriage representation. YOU are not incremental! The kinematic model builder will work incrementally”.
- Scope: The selected design and work split govern implementation. The contract is authored; runtime integration is not yet implemented. Photorealistic machine graphics, inset navigators, detail lenses and split windows are not part of this upgrade. No contributor consensus or manufacturing approval is inferred from this instruction.

## D-029 — Withdraw September 12 contributions and vet readmission

- Decision: Withdraw the surviving implementation and guidance from e3dc134, f2a97d8, 6e11afd and ce61c69 from the current working source while preserving independently authored work. Superseded repository context is reference material, not live design authority; components and methods require explicit selective adoption against the current shared contracts.
- Status: proposed
- Recorded: 2026-09-13T18:53:57Z
- Approvals: Current user explicitly authorizes withdrawal and the context boundary; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User in the contribution-withdrawal task, 2026-09-13, reports that the originating agent context began with a pre-GitHub repository and then included modern SAAM. The user requests withdrawal and says, “We must not let unvetted components into the ecosystem”; subsequently, “mark material library as definitely we will port that over - but don't do it yet.” The original repository and transcripts are unavailable.
- Scope: This is current user-authorized implementation direction, without inferred contributor consensus. It preserves independent setup, geometry, skills, kinematics and test-policy work. The three conceptual intents below remain separate from admission of their old implementations. The material-intent feature and its revert have no net source effect.

| Conceptual intent | Disposition | Admission boundary |
|---|---|---|
| Easier first use and onboarding, including a possible guided tour | Potential future port; no new implementation requested | Retain the independently developed lightweight setup check. Reconsider additional onboarding against the conversational workflow and current setup cost; the removed tour and its repeated prompting are not approved for restoration. |
| Material-intent presentation during geometry review | Potential future port; no implementation requested | Assess the need and presentation against geometry, process and toolpath responsibilities. Do not restore the removed panel or duplicate the region model without a specific approved design. |
| Printer/nozzle/material configuration and a shared material library | Material library is committed future work, deferred until the user starts it; nozzle controls and expanded hardware/output support remain potential ports | [BR-044](build_request.md#br-044--port-a-vetted-material-library) owns the deferred library. Its old data, generic compatibility fallback, process-reset behavior and expanded H2D startup contract are not admitted. Vet each consumer against current shared interfaces and the minimal-core guidance. |


## D-030 — Provisional STL units assumption

- Decision: Load STL files without a units question or popup. Assume reasonable units after loading, based on part size, in both tour and ordinary Studio flows. Respect explicitly supplied units and allow later correction. This is a provisional policy expected to be reconsidered.
- Status: proposed
- Recorded: 2026-09-15T01:03:31Z
- Approvals: Current user explicitly authorizes implementation and recording; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User in the Studio tour task (01a0a19d-25eb-7fa3-9e55-d1b97ee544fc), 2026-09-14 local time: “Automatically choose reasonable units after load, based on part size. Can always be changed later if needed. This applies outside of tour as well. Note this in decisions - and we will likely change this policy later down the road.”
- Scope: Active user-authorized implementation. The shared importer owns the size heuristic and records the assumption; [print-tool guidance](core/print/USAGE.md#import-an-stl) describes the current thresholds and correction tools. STL itself does not encode units. Formal contributor consensus is not inferred.
