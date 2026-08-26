# Contributing to SAAM

SAAM is founder-directed on mission, scope, roadmap, and release
decisions, and platform-neutral on technical inclusion: a third-party
operation, machine definition, or interface that meets the same published
requirements as a Struder-authored one is treated the same way. See
`PROJECT_CHARTER.md` for the full neutrality commitment.

## Ways to contribute

- **Operations** — new machine-neutral additive strategies under
  `operations/`, or improvements to existing ones. Start with
  `docs/authoring/` for the manifest schema and required evidence.
- **Machine definitions** — a new `machines/` entry for hardware SAAM
  doesn't yet describe. Model-level constraints and instance
  configuration are kept separate; see `docs/authoring/`.
- **Post-processors** — a translator from an approved process plan to a
  specific controller's native output. Post-processors translate or
  reject; they do not redesign approved geometry.
- **Interfaces and adapters** — alternative ways to inspect, approve, or
  drive SAAM plans, built against the published process-plan contract.
- **Documentation, tests, and examples.**

## Process

You won't have (and won't be given) push access to this repository
directly — that's not a judgment about you personally, it's how every
contribution here lands, including the maintainer's own. It's a normal
fork-and-pull-request flow:

```bash
gh repo fork Struder-AI/SAAM --clone   # or fork on github.com, then git clone your own fork
cd SAAM
git checkout -b my-change
# ... make your change ...
npm test                                # from the repo root
git commit -m "..."
git push -u origin my-change
gh pr create --repo Struder-AI/SAAM
```

A pull request is, literally, a request for the maintainer to *pull*
your branch from your fork into `Struder-AI/SAAM`'s `main` — opening one
doesn't change anything in this repository by itself; review and merge
are still a separate, deliberate action on the maintainer's part.
`main` is protected: nobody pushes to it directly or merges their own
PR, and that holds even for changes the maintainer's own agent drafts —
see `AGENTS.md`'s "Contributing it upstream" section, which any
agent-drafted contribution should already be following.

## Before you open a pull request

1. Read `PROJECT_CHARTER.md` and the relevant guide under
   `docs/authoring/`.
2. Run the fresh-clone validation commands documented in the top-level
   `README.md` for the area you touched (schema, unit, golden-artifact,
   or security checks, as applicable) — `npm test` from the repo root
   covers the common case.
3. If you added, removed, or edited a `manifest.json` under
   `operations/` or `machines/`, run `npm run generate-registry` and
   commit the resulting `registry/registry.json` —
   `tests/golden/registry-generate.test.mjs` fails on drift between that
   file and what's actually on disk, and CI runs this on every PR (see
   `.github/workflows/test.yml`), so drift won't pass review unnoticed.
4. Label any claim about physical behavior with the evidence taxonomy in
   `docs/authoring/evidence-labels.md`. Do not upgrade an inference or a
   preview result to a stronger evidence label than it earned — most
   first contributions correctly land as `EXPERIMENTAL` or
   `DOC-CONFIRMED`, and that's a fine place to start, not a weakness.
   `ROBOT-CONFIRMED` means this exact revision produced correct output
   on physical hardware, not "the math checks out."
5. Add a README for whatever you added, documenting real capability and
   real known limitations — not just the happy path. Look at an existing
   operation or machine definition for the shape.
6. Keep the change reviewable: prefer a small, focused pull request over
   a bundle of unrelated fixes.

## Review and inclusion criteria

Every package — Struder-authored or community — is evaluated against the
same published compatibility, security, documentation, validation, and
evidence requirements, and indexed by the same generated registry rules.
Authorship is not a ranking factor. If SAAM later adds a featured or
recommended view, its criteria will be public and available to any
component that meets them.

## Licensing

By contributing, you agree your contribution is licensed under the
Apache License, Version 2.0, the same license covering the rest of the
repository (see `LICENSE` and `NOTICE`). Do not submit code, text, or
media you don't have the right to license this way — see
`THIRD_PARTY_NOTICES.md` for how imported third-party material is
recorded.

## Conduct

Participation in SAAM is governed by `CODE_OF_CONDUCT.md`.
