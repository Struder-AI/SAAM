# Developing SAAM

Read [the product direction](../../PROJECT_CHARTER.md),
[decisions](../../DECISIONS.md), [glossary](../../GLOSSARY.md), and
[build requests](../../build_request.md), then the manuals relevant to the change.
[Development foundation](../development.md) covers setup and code organization.

## Restart boundary

- Do local work requested by the human. Import a previous component, decision,
  or concept only with their approval of that specific adoption.
- The old runtime is preserved in Git history and a local archive, outside the
  active tree. No source code has been migrated into the refresh.
- Record approvals exactly as stated. A contributor can authorize work while
  its project decision remains provisional pending the other contributor.
- Staging, committing, and publishing require explicit authorization. Honor
  authorization already given; do not ask for it again.
- The canonical destination is Struder-AI/SAAM. Use the requested feature
  branch when authorized to publish. Do not assume a personal fork is required.
  Do not push to main without an explicit request, or merge your own PR.

## Testing through the use context

Read [Using SAAM](use.md) and exercise the same public tools and skill manuals
a maker agent receives. Test installation, error recovery, and discoverability
from AGENTS.md as capabilities are built.

Use isolated test projects, fixtures, and machine simulators. Synthetic test
approval data must remain distinguishable from human approval and must never
authorize a real job. Do not manufacture a human approval record or run hardware
as a shortcut to testing. Report software and physical validation separately.

## Checks

Run `npm test` at the repository root before and after changes. It checks the
current documentation, decision metadata and private-file exclusions.
Add meaningful implementation checks as runtime capabilities are introduced.
See [setup and checks](../development.md#setup-and-checks).

## Developer documentation outside skills

Keep setup, test/build commands, code organization, and shared file-format
definitions in [developer documentation](../development.md). Skill-specific
usage and implementation notes live in the skill package.
The glossary owns shared meanings; decisions own contributor choices;
`build_request.md` owns requested work.

`Prints/` and `.local/` are ignored by Git. Copy only explicitly selected,
checked examples into `examples/prints/` for sharing.
