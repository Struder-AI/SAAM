# Decisions

Contributors: `tkeller`, `remettub`.

Each entry states one decision, its status, a recording timestamp, approvals,
and a brief source. Both contributors' approval makes a decision **accepted**;
one contributor's approval makes it **provisional**. Never infer approval from
authorship, silence, agent work, or agreement on a different decision.

SAAM Studio has approval from both contributors as explicitly reported by
remettub. Other entries record only the approvals stated in their metadata.
The timestamp is when the instructions were recorded; the conversation does not
expose an exact timestamp for the human's message.

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
