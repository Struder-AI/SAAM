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

- Status: deferred
- Direction: remettub selected Rhino; use 3DM as native geometry. The earlier kernel comparison is closed.
- Result needed: Choose and test the Rhino integration method, preserve spline surfaces and feature references, and establish runtime/install/licensing requirements.

## BR-005 — First complete print

- Status: deferred
- Result needed: One specified printer/material/nozzle, geometry edit, three approvals, direct generation, automated checks, same-file preview/delivery, and save/reopen of the print bundle.
- Depends on: BR-003, BR-004, and selection of the first printer/setup.

## BR-006 — SAAM Studio interaction and export interpretation

- Status: deferred
- Result needed: Shared geometry references and a viewer that interprets the actual export, including its helper files and declared machine state. Detect unsupported behavior before review; tie approval to the reviewed version and invalidate affected approvals after changes.
- Proposed interaction: Click-to-select geometry with shared labels; compare a feature tree and screenshot markup during usability testing. See [developer proposals](docs/development.md#studio-feature-references).
- Verify: A novice can identify a feature, request an edit, approve the three stages, and reopen the print. The delivered export is byte-identical to the reviewed export.

## What should earn adoption next

Recommend proving one complete print before adding a catalog of operations.
The value to test is whether SAAM reduces setup, clarification and recovery work
compared with the same agent using existing CAD and slicing tools. Extra agent
instructions alone are not enough. Test repeatable generation, useful machine
checks, shared geometry references, and review of the exact delivered program.
This is a proposed evaluation direction, not a claim of implemented advantage.
