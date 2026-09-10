# Portable StruderBot skill suite

Install the ten directories listed in `STRUDERBOT_SUITE.json` together. Several
skills deliberately compose with `dobot-programmer`, and material-depositing
programs require `dobot-prime-lead-in`; installing arbitrary individual
directories produces an incomplete workflow.

## Runtime requirements

- Node.js 22 or newer for SAAM and the package audit.
- Python 3.10 or newer for legacy deterministic planners and validators.
- No third-party Python packages. Every Python helper uses the standard
  library only.
- The JavaScript dependencies are locked by the repository-level
  `package-lock.json` and install with `npm ci`.

From a fresh clone, run:

```text
npm ci
npm run test:struderbot-suite
npm test
```

The suite checker validates the manifest, every required skill resource,
sibling SAAM skills, metadata, Python syntax, planner smoke cases, and all
bundled Python regression tests. It searches `PYTHON`, `python3`, `python`, and
the Windows `py -3` launcher in that order and rejects unusable shims.

## Capability boundary

Passing the package check means the imported manuals and deterministic legacy
specifications are complete and reproducible on the new computer. It does not
register them as SAAM operations and does not prove robot safety. The migration
status in `STRUDERBOT_SKILL_MIGRATION.md` remains authoritative until each
capability is integrated with SAAM's geometry, composition, export, Studio,
and configured-machine tests.

The Python files are transitional executable specifications recovered from the
legacy repository. They exist so geometry and safety behavior can be compared
during the migration; they are not the target architecture. Port every such
behavior to the repository's JavaScript skill-result and shared-plan contracts,
then retire the corresponding Python helper only after equivalent regression
fixtures pass.
