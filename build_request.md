# Build requests

Track concrete development work here. Decisions belong in [DECISIONS.md](DECISIONS.md);
terms belong in [GLOSSARY.md](GLOSSARY.md). Implementation status is not approval status.

## This refresh cycle

Authorized by remettub on 2026-09-08: finish a clean refreshed repository, commit,
and push a new `refresh` branch directly to `Struder-AI/SAAM`.

| Build now | Document now | Defer |
|---|---|---|
| New local map viewer and source-anchor checks | Maker/developer routing and glossary | Rhino runtime integration |
| Dependency-free repository checks and CI | Decisions and three-approval workflow | SAAMpath encoding and generation |
| Clean repository skeleton and local Prints exclusion | Skill-package guidance and machine-output vocabulary | Process-plan schema and manufacturing skills |
| Preserve legacy working files locally; remove them from the active tree | Rhino/3DM direction and print-bundle contents | Studio's geometry/program viewers and a real print |

Legacy reference: commit `54093cadbe87020836916d53dd29a45a06bf5528`.
Working-folder archive destination: `../SAAM-legacy-20260908/legacy-reference/54093cadbe870/`.
Archive scope: old adapters, interfaces, machines, operations, registry, schemas,
tests, examples, docs/architecture, docs/authoring, ROADMAP.md, package.json and
package-lock.json. Preserve all contents by moving those named paths; do not
touch personal `Prints/` or `.saam/`. Following remettub's clean-folder
clarification, the archive, old `node_modules/` and earlier `.local/fill-review/`
work are preserved outside SAAM in the sibling archive directory. Keep
licenses/notices and update developer entry documents. No legacy runtime is adopted.

## BR-001 — Local architecture map

- Status: complete locally
- Requested by: remettub, 2026-09-08, restart conversation R3
- Build: A new local map viewer with a maker-flow view and a project view; selection details, source links, drag/pin layout, and a focus view.
- Verify: Real document anchors, clearly labelled proposed/unimplemented nodes, saved layout, working navigation, no legacy runtime adoption.
- Location: `.local/architecture-map/` (ignored by Git).
- Verified: Two views, 16 source anchors, node selection, cross-view navigation, search, focus, light/dark themes, and dragged positions surviving browser reload.

## BR-002 — Simplify restart terminology and guidance

- Status: complete
- Requested by: remettub, 2026-09-08, restart conversation R3
- Build: Maker-agent vocabulary, glossary, three approvals, direct generation from the locked plan, skill packages, local Prints, and concise developer documentation.
- Verify: Consistent current documents; superseded decisions preserved in the log.

## Refresh foundation verification

The old implementation is removed from the active tree. All 114 archived files
were checked against their original SHA-256 hashes. No legacy runtime was adopted.
The new `npm test` checks document links, decision metadata, and private-file
exclusions, including that curated examples remain visible to Git. CI runs it
on pushes and pull requests. These checks do not validate manufacturing behavior.

## BR-003 — Resolve native path versus machine file

- Status: resolved
- Source: R3 refers to both a native-format path and an output toolpath in a print.
- Result: R4/R5 establish SAAMpath as the internal representation, with a separate export using an output option in the machine file. Encoding and exact bundle layout remain open.

## BR-004 — Rhino geometry integration

- Status: wedge integration implemented; general integration deferred
- Direction: remettub selected Rhino; use 3DM as native geometry. The earlier kernel comparison is closed.
- Result needed: Choose and test the Rhino integration method, preserve spline surfaces and feature references, and establish runtime/install/licensing requirements.
- Wedge result: pinned rhino3dm creates a capped extrusion and six named NURBS reference surfaces; 3DM round-trip tests pass. General spline intersections and edited-file import remain deferred.

## BR-005 — First complete print

- Status: software demo implemented; physical print pending
- Result needed: One specified printer/material/nozzle, geometry edit, three approvals, direct generation, automated checks, same-file preview/delivery, and save/reopen of the print bundle.
- Depends on: BR-003, BR-004, and selection of the first printer/setup.
- Current implementation: BR-007 supplies the S5 wedge workflow. Each job requires three actual print approvals; software tests do not complete a physical print. Standard S5 startup is assumed without requiring firmware identification.

## BR-006 — SAAM Studio interaction and export interpretation

- Status: bounded S5 demo implemented; general interpreter deferred
- Result needed: Shared geometry references and a viewer that interprets the actual export, including its helper files and declared machine state. Detect unsupported behavior before review; tie approval to the reviewed version and invalidate affected approvals after changes.
- Proposed interaction: Click-to-select geometry with shared labels; compare a feature tree and screenshot markup during usability testing. See [developer proposals](DEVELOP.md#studio-feature-references).
- Verify: A novice can identify a feature, request an edit, approve the three stages, and reopen the print. The delivered export is byte-identical to the reviewed export.
- Current result: named face selection, geometry/process editing, three version-bound approvals, exact Griffin export playback, save/reopen, and byte-identical delivery tests. Novice usability and physical validation remain pending.

## BR-007 — S5 inclined-wedge demo

- Status: implemented locally; physical validation pending
- Source: user in the S5 wedge conversation, 2026-09-08: "looks good, go ahead". Setup clarified as AA 0.4, right nozzle #2, PLA at 215°C.
- Build: S5 machine definition; Rhino wedge; horizontal solid-fill body; 15° inclined skin; SAAMpath; Griffin export; software checks; local Studio and print bundle.
- Clearance scope: user explicitly said "Don't worry about clearance for this one. I'll make sure it clears." Physical head collision checking is deferred for this demo; bounds, motion and extrusion checks remain.
- Verify: generation, native geometry round trip, supported-command interpretation, temperature/flow/bounds checks, deterministic export, stale-approval invalidation and byte-identical delivery. No real approval is fabricated and no printer is started.
- Job inputs: actual geometry, locked-plan and toolpath approvals. Bed temperature and other defaults are proposed recipe values until plan approval. Firmware identification and startup verification are optional metadata.

## BR-008 — Root developer and maker guidance

- Status: complete locally
- Source: user correction during the S5 wedge conversation, 2026-09-08.
- Result: consolidate developer rules and development notes into root DEVELOP.md; move maker guidance to root MAKERS.md; remove docs/ and update active references. Unspecified agents default to developer for now, and every developer reads both root files.
- Approval scope: this records the user's development instruction, not an inferred contributor decision approval.

## BR-009 — Accessible chat-driven review and wedge refinement

- Status: implemented locally; physical validation remains pending.
- Source: user in the S5 wedge conversation, 2026-09-08.
- Result: concise geometry → settings → toolpath review, chat-only recipe edits with automatic viewer updates, playback speed selector, adjustable sloped-layer count, 0.2 mm nominal layers, alternating sloped strokes and alternating flat-layer traversal.
- Travel: fixed clearance at full part maximum Z plus 2 mm by default, for every generated horizontal travel in this profile.
- Setup: remove installed-firmware approval requirement; assume standard S5 startup, resolve concrete questions in chat, and remember setup locally for later prints.
- Guidance: MAKERS.md owns the review/revision flow and setup conversation; DEVELOP.md documents implementation and setup persistence; the wedge manual documents adjustment tools.

## BR-010 — Split the wedge patterns into general skills

- Status: implemented locally; untested beyond software checks
- Requested by: remettub, 2026-09-08: split the wedge skill in two, a "full fill"
  skill doing the first pattern for any shape, and a non-planar top surface skill
  doing the final pattern for any shape, limited by a max-nonplanar-angle machine
  setting (15 degrees for the S5). Also: improve on the wedge's travel moves, and
  leave the wedge skill as it is.
- Naming and behavior chosen by remettub during the work: the second skill is
  `draped-skin`; surface steeper than the limit is excluded from the skin and
  reported rather than rejecting the job.
- Geometry scope agreed in the same conversation: closed breps of untrimmed
  bivariate spline surfaces. Intersections between several such solids are
  computed at the toolpath, not as boolean geometry. Running a Rhino Compute
  server was rejected.
- Build: `core/` slicing core (patch evaluation, plane sectioning, planar regions
  and booleans, top-surface height field, travel planning, SAAMpath, Griffin
  export, plan and preview CLI); `skills/full-fill/`; `skills/draped-skin/`;
  `nonplanar.maxAngleDeg` in the S5 machine file.
- Verified in software: 29 tests covering evaluation against rhino3dm, sections
  and offsets and booleans against analytic areas, closure rejection, degenerate
  cuts, the surface height field, travel and lift behavior, exclusion of
  over-limit surface, strict export interpretation, determinism, and detection of
  an edited export.
- Not verified: no physical print, no Studio integration, no approval or delivery
  workflow, and no maker agent has used either skill end to end. Multi-solid
  geometry is implemented in the region core but not reachable from a plan.
  Contour completeness rests on a rigorous bound for cells with no sign change
  and a sampling check elsewhere, bounded by `minFeatureMm`.
- The wedge skill was left unchanged, as requested.

## What should earn adoption next

Recommend proving one complete print before adding a catalog of operations.
The value to test is whether SAAM reduces setup, clarification and recovery work
compared with the same agent using existing CAD and slicing tools. Extra agent
instructions alone are not enough. Test repeatable generation, useful machine
checks, shared geometry references, and review of the exact delivered program.
This is a proposed evaluation direction, not a claim of implemented advantage.
