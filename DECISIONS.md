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
[D-033](#d-033--three-agent-roles) owns the current agent roles and
entry-point routing; D-002 and D-013 preserve the earlier two-context wording.
Work history belongs in [DEVLOG.md](DEVLOG.md). Decision quotations, approval
events and approved wording retain their historical tense and dates under the
[provenance exception](BUILDERS.md#documentation-maintenance).

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
- Status: superseded
- Recorded: 2026-09-08T20:26:47Z
- Approvals: remettub — R1; tkeller — not recorded
- Source: R1, “AGENTS is the entry point for both”.
- Scope: The single entry point and the CLAUDE.md pointer remain current; the two-context split is superseded by D-033, which routes maker, builder and developer. The original approval metadata is preserved and is not extended to the three-role wording.

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
- Status: superseded
- Recorded: 2026-09-08T22:28:14Z
- Approvals: remettub — R3; tkeller — not recorded
- Source: R3, “Let's call them maker agents.”
- Scope: The name maker agent remains current. The single development-agent role is superseded by D-033, which separates builder from developer; “development agent” now covers both where the distinction is not needed. Original approval metadata is preserved.

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
- Subsequent planning, 2026-09-19: [D-037](#d-037--cloudflare-relay-and-studio-driven-chat-sessions) selects Cloudflare for the relay, ZIP-based installation with the existing browser UI, and pending MCP calls for active Studio-driven chat sessions. Its [milestone plan](adapters/mcp/RELAY-PLAN.md) refines this future direction; the current request is specification work, not production implementation or deployment.
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
- Scope: Active implementation instruction, including the user's 2026-09-10 rimming and ordering clarifications. Local geometry queries construct assigned supports and clearances; they do not decide where support is needed. Rimming uses assigned bivariate spline surfaces, two outward bead paths and bed/edge bases, with separate horizontal-offset and surface-normal-offset skills for comparison. The 45-degree lean preference is guidance. Both skills wait for the entire base edge, then finish before anything they support starts; among ready operations, prefer similar printing heights across skills. Planar boundaries are the horizontal case of these rules. The [rimming specification](skills/rimming-planar/BUILDER.md#rimming-support-specification) owns the construction details. The three job approvals remain unchanged.

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

## D-031 — Incremental C++ migration of selected compute components

- Decision: Adopt incremental migration of selected performance-critical components from JavaScript to C++, retaining JavaScript for Studio, agent tools and print workflow coordination. Choose components through profiling of representative large slicing jobs and move substantial operations behind shared interfaces, using packed data and batched calls. Keep SAAM usable throughout the migration.
- Status: proposed
- Recorded: 2026-09-16T02:30:59Z
- Approvals: Current user explicitly selects this direction and requests its recording; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User in the language-migration assessment task (01a0a806-e5b6-7b92-8511-0aff0e79e159), 2026-09-15 local time: “Okay so we can to incremental migration of select components from javascript to c++? That seems like the ideal approach”. Follow-up: “Great, record that intent as a decision.”
- Scope: Agreed migration intent; this request records the direction, without starting a component port or committing to a full application rewrite. The first component remains to be selected through current profiling. Before replacing an implementation, compare geometry, tolerance semantics and machine output against the existing behavior, and measure the complete workflow benefit, including data-transfer and memory costs. Preserve shared skill composition, generation identity, review and exact-byte delivery contracts. Existing compiled backends and avoidable repeated work must be accounted for when choosing a migration target. No speedup, schedule or contributor consensus is established by this record.

## D-032 — Separate standard and advanced vase-mode manuals

- Decision: Expose standard vase mode and advanced vase mode as separate manuals and separate references in the skills digest. Standard mode covers conventional continuous spiral walls; advanced mode covers motifs, patterns and fitted mesh sleeves. Both use the existing shared vase recipe and slicer.
- Status: proposed
- Recorded: 2026-09-16T17:02:13Z
- Approvals: Current user explicitly authorizes this split; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User in task 01a0ab09-9686-7160-a752-50132fd5baf7: “I've made the decision to have two "vase mode" skills (if we don't already). One is our a standard vase mode, similar to what all the other slicers would implement. The "advanced" vase mode uses our motif and pattern etc.” Clarification: “So have separate manuals, in other words, separate references in the skills digest”.
- Scope: Active user-authorized manual/catalog split. It adds no independent recipe key, duplicated slicer or manufacturing approval; contributor consensus is not inferred.

## D-033 — Three agent roles

- Decision: SAAM work is done by three agent roles rather than two. A maker uses skills, makes parts, gives printing advice and operates Studio, and changes no shared code. A builder changes skills, extends Studio, makes isolated local changes to core, and makes parts to test that work. A developer works on core and across components and owns cross-cutting design. Each role has its own onboarding command and starting reads. An agent determines its role from the initial request and defaults to maker when unclear; it escalates maker to builder on any build request, announced first; it reaches developer only on the person's explicit request or an accepted proposal for major core work. Maker and builder agents suggest a fresh session past roughly 250k tokens on an unrelated pivot; developers are exempt. AGENTS.md remains the single entry point.
- Status: proposed
- Recorded: 2026-09-17T16:29:11Z
- Approvals: Current user explicitly directed the three-role split; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User direction recorded in [DEVLOG 2026-09-16](DEVLOG.md#2026-09-16--three-agent-roles-and-documentation-restructure) and the reconciliation approved in [DEVLOG 2026-09-17](DEVLOG.md#2026-09-17--reconcile-role-context-and-the-map-contract). This is a summary of the preserved direction, not a verbatim quotation; the originating transcript is not available to this record. Recorded retroactively during a documentation audit, so the timestamp is the recording moment rather than the instruction.
- Scope: Active user-authorized structure. It supersedes the two-context split in D-002 and the single development-agent role in D-013, whose attributed approval metadata is preserved; formal contributor supersession remains unresolved. Inheritance between roles describes responsibility, not a requirement to load every lower-role manual. Escalation carries the original request's authorization and no more. No manufacturing approval or contributor consensus is inferred.

## D-034 — Adopt the PackIT region map contract for core and Studio

- Decision: Adopt PackIT's single region source and leveled flow-map approach as the primary structural account of core and Studio. One Markdown region file owns both the agent-readable map and the human rendering generated from it; a box resolves to a child page, a named code declaration or a shared component. A component may be shared only where every use carries the same input/output contract, including units, frames, preconditions, errors, mutation and ordering. Every occurrence exposes calculated references to all other mapped occurrences, drawn as red vertical arrows with node indexes and never authored by hand. Skill implementations and client adapters are callers outside the mapped boundary. PackIT's restrictions on shared code, comments and prose are not adopted.
- Status: proposed
- Recorded: 2026-09-17T16:29:11Z
- Approvals: Current user reviewed offset and perimeter examples and approved continuation; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User direction and review recorded in [DEVLOG 2026-09-17](DEVLOG.md#2026-09-17--core-and-studio-developer-maps) and [DEVLOG 2026-09-17](DEVLOG.md#2026-09-17--reconcile-role-context-and-the-map-contract). This is a summary of the preserved direction, not a verbatim quotation. Recorded retroactively during a documentation audit, so the timestamp is the recording moment rather than the instruction.
- Scope: Active user-authorized documentation structure, owned by the [map contract](BUILDERS.md#maps-and-local-documentation) and the [map guide](dev-map/README.md). Structural checks resolve anchors, hierarchy, boundaries and shared-use references; they establish neither behavioral truth nor complete caller coverage, and the supporting prose, wires and semantic contracts are authored and unverified. Drawing a map does not authorize refactoring code to make the picture cleaner. Dev maps cover core and Studio only. No manufacturing approval or contributor consensus is inferred.
- Subsequent direction: The September 19 generated-map work replaced the authored Markdown graph sources. [D-035](#d-035--authored-flow-composition-over-generated-code-relationships) records the current user's later approval of authored grouping over generated entities and relationships. The original approval and contributor status above are preserved as history; they do not describe the current graph source format.

## D-035 — Authored flow composition over generated code relationships

- Decision: Generate code entities, relationships, source locations and freshness evidence from source; allow authored flow grouping to arrange those entities into useful leveled pages. Authorship chooses explanatory boundaries, not implementation calls or data links. Generate and check the wires crossing those boundaries. Keep necessary external facts with provenance on their owning drawn pages, rather than replacing graph meaning with prose. Preserve maker and builder prose documentation and the developer's map-based workflow.
- Status: proposed
- Recorded: 2026-09-19T15:57:57Z
- Approvals: Current user explicitly selected authored flow grouping and authorized completing the system through a coordinated implementation team; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User in task `01a0ba56-7b17-71e3-9219-4972a0bc5bfd`: “This is why I thought the flows would need authorship, of automatically generated leaf nodes or whatever base entities”. In response to the explicit question whether authored grouping should revise the requirement that nothing about the graph is authored, selected “Allow authored flow grouping (Recommended)”. The user identified sparse pages, excessive nesting and the need to remember disconnected pages as the principal usability problem.
- Scope: Active user-authorized implementation direction. It revises the earlier fully generated grouping requirement without authorizing invented wires, silent staleness, incomplete change-consequence reporting or manufacturing changes. Acceptance requires useful per-page behavior, named data and conditions, source access through shared addresses, reliable explicit regeneration, and visible callers, output consumers and scanner limitations. This records direction, not a claim that implementation or validation is complete; contributor consensus and manufacturing approval are not inferred.

## D-036 — Explicit planning stages and state in the path-planning pilot

- Decision: Refactor path planning into meaningful stages with explicit inputs and named returned outputs. Stages do not mutate their caller's planning state; local working mutation is allowed inside a stage. Carry emitted actions efficiently without copying the accumulated toolpath on each move. Use the generated graph to review the resulting composition and preserve existing planning behavior.
- Status: proposed
- Recorded: 2026-09-19T16:40:17Z
- Approvals: Current user explicitly authorizes the path-planning pilot; remettub — not attributed in this conversation; tkeller — not recorded.
- Source: User in task `01a0ba56-7b17-71e3-9219-4972a0bc5bfd`: “Note that you are also allowed to suggest coding conventions for us that would make our codebase more suitable for \"the grasshopper experience\"”. After reviewing the proposed scope and convention, instructed: “Good, let's do it on the path planning area. That's also the most important area for me to review deeply, so that's perfect.”
- Scope: Active implementation authorization for the path-planning pilot and its callers, generated maps and behavioral checks. It does not authorize a repository-wide or Studio rewrite. Scanner limitations and projection defects remain separate from code conventions. Existing operation, travel, extrusion and machine-output behavior must be preserved; this decision does not claim completed validation, contributor consensus or manufacturing approval.
- Subsequent direction (2026-09-19, same task): The user instructed “we should go region by region, doing maps and code together” and “continue work”, beginning with completion of core/path. Work proceeds in bounded sections with explicit review links, rather than an indiscriminate codebase rewrite. The user selected operation scheduling as the next code-and-map section after reviewing planComposition. The original pilot scope above records the earlier authorization; this direction extends the active workflow, without claiming contributor consensus.
- Full rollout direction (2026-09-19, same task): The user authorized applying the reviewed standard throughout core and Studio and keeping the implementation team working until the mapping work is complete. Code and maps are developed together; a capability inventory alone does not satisfy the requested Grasshopper-style execution flow. Local working mutation and stage-local compaction remain allowed, while inputs and published results are preserved. Distinct invocations retain distinct stage identities. The user explicitly required rewiring all consumers and removing superseded entities, without compatibility wrappers or parallel old paths. Routine work sequencing belongs to the team; intent-level refinements remain for user discussion. This extends the earlier pilot scope and records direction, not completed implementation or new contributor consensus.
- Interpreter-state exception (2026-09-19, same task): The current user selected “Keep private interpreter state; expose its stateful boundary” after reviewing the Lua runtime's persistent variables, tables, scopes and call stack. These remain interpreter-owned mutable state and must be exposed as a stateful map boundary. This is a specific exception alongside owned caches and UI controllers, not permission for ordinary planning stages to mutate passed inputs. It adds no contributor consensus or machine-behavior approval.

## D-037 — Cloudflare relay and Studio-driven chat sessions

- Decision: Plan a Cloudflare Worker/Durable Object MCP relay connecting ChatGPT and Claude web sessions to locally installed SAAM, distributed as OS-specific ZIPs containing an installer while retaining browser-based Studio. Geometry, slicing and print data remain local; inference uses the person's own chat account. During an active SAAM session, Studio requests complete pending MCP tool calls so the assistant responds and resumes listening without another user action in chat. Bounded waits renew within client deadlines; transport loss does not cancel local work.
- Status: proposed
- Recorded: 2026-09-19T18:01:11Z
- Approvals: Current user explicitly selects the active-session interaction and requests the specification/plan; contributor account attribution is unconfirmed. No approval from either named contributor is inferred from the checkout or branch.
- Source: Task “Plan Cloudflare MCP relay” (`01a0baba-5902-7c41-8e9e-19d95fe2c81c`), 2026-09-19. Initial request specifies Cloudflare Durable Objects, installer ZIPs, local computation, the user's chat account and 200 users × five prints/day × 30 MCP requests/print. Following discussion of pending calls: “Okay, so if we hold the calls open, we can have the LLM respond to UI-driven user actions, without requiring separate user action in chat? That's what we need.” Then: “Okay, let's make that the plan then. We don't need to test capabilities, we need to focus on writing the specification/plan/whatever for getting us to that goalpost.”
- Scope: Authorizes the [milestone specification and roadmap](adapters/mcp/RELAY-PLAN.md). It advances D-023's deployment planning and retains Windows/macOS targets from that direction. It replaces short-call-only interaction as a planning preference with pending event waits where required for an active session. No preliminary capability experiment is required. Actual client continuation remains an implementation acceptance condition, not an established result. One shared Durable Object is a proposed implementation default, not a separately approved partitioning mandate. Indefinite wake-up of ended chats, cloud manufacturing computation, hardware operation, production deployment and contributor consensus are not established by this planning request.
- Subsequent planning direction (2026-09-19, same task): The user clarified “agent-led OR load stl”, rejected routine installation selection and questioned chat handoffs. The revised plan uses one active paired installation, with replacement in settings, and fresh chats that reopen saved bundles without session handoff. The requested quiet interval changed from ten minutes to slightly less than eight: 7:30, using two 3:45 waits for Claude and targeting a single 7:30 tool-call timeout for ChatGPT following “target 7:30 timeouts for chatgpt as well”. ChatGPT's deadline is an implementation target, not a verified provider guarantee. User stop remains authoritative; transport handling is limited to safe retries, retained outcomes and visible unavailability.
- Alpha scope clarification (2026-09-19, same task): “relay-plan is for the alpha, but also mention the beta shape for context”. Developer mode is acceptable for alpha. Reviewed ChatGPT publication is future beta context, not an alpha release gate. The user requested proposals to shrink/consolidate repeated material and reserved the choice of those edits for review.
- Budget refinement (2026-09-19, same task): The user asked to make $5/month the alpha hosting target, derive its user cap from the per-user workload, and show incremental costs. The plan derives a 150-active-user cap from an explicit 6,000-metered-request monthly budget per user and 10% request headroom. Additional event/listening, CPU, storage and logging quantities are engineering assumptions to validate, not user-supplied measurements. The initial 200-user scenario above is retained as historical provenance and a $5.15/month modelled comparison, not the current alpha admission cap.
- Session ending (2026-09-25, BR-058): “We don't need to resume a closed connection. The bundle will have saved work in most cases where it matters, and a new chat session can access that bundle.” An ended session's unfinished requests fail visibly; the local runtime and Studio stay; a new session starts from saved bundles. Retries within a live session remain.
- Scope trim (2026-09-25, same task): asked whether the relay issues all keys, the user said "Do we really need all of this? It seems overbuilt" and then "Yup, trim the scope as we have discussed." The plan drops idempotency keys and outcome records, generation job receipts and the cursor/acknowledgement event protocol. Revision checks reject repeated edits; the relay fails an in-flight call on link loss and the assistant rereads state; generation moves to Studio's worker only if a measured case exceeds a call deadline.

## D-038 — Dev-map intent: functional tree, complete leaf context, findings kept, code-shape rules

- Decision: The dev map covers core and Studio product code; the agent CLI toolkit is an outside caller. Outside callers are drawn on the declaration pages they call when they are active (a catalogued skill's implementation scripts, the MCP adapter, the agent toolkit and its CLI entry) and counted otherwise; calls leaving the map are drawn as headless arrows at every level. The tree is functional: a region page homes its flow roots, every other declaration is homed by the first flow page reaching it, nested declarations by their holder, constructors inside their class; file paths are never members; a page is a map only when it draws two called declarations with a wire, operators not counting; no page draws one box and no box floats; there is no cap on page size or depth. Findings are never removed and are shown on every map that draws their node. Three code-shape rules are strongly preferred and the restricted form needs the owner's permission: no callable or state in a reassigned binding, no callee chosen by an expression, no stage mutating caller-owned state; a rewrite is a code-shape fix only when the map draws the relationship afterwards, and everything else the scanner cannot follow is generator work. Name-keyed function tables are registry entries, not exclusions.
- Status: approved
- Recorded: 2026-09-21
- Approvals: Project owner (remettub), in the 2026-09-21 review session, point by point as summarised in [dev-map/HANDOFF.md](dev-map/HANDOFF.md); tkeller — not recorded.
- Source: The owner's review of the generated map on 2026-09-21 (over-nesting, unattached nodes, scope, uncertainty, link and node coverage, intent, process), with the owner's standard that the map lets a reviewer go ten times faster with four times the confidence and gives agents a traceable orientation. Evidence is in the DEVLOG entries of that date.
- Scope: Owned by [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md). Supersedes the parts of [D-034](#d-034--adopt-the-packit-region-map-contract-for-core-and-studio) and [D-035](#d-035--authored-flow-composition-over-generated-code-relationships) that let authored grouping select files or place every declaration; generated entities, relationships and findings remain unauthored. Establishes no manufacturing approval.
