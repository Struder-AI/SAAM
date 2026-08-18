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

## Before you open a pull request

1. Read `PROJECT_CHARTER.md` and the relevant guide under
   `docs/authoring/`.
2. Run the fresh-clone validation commands documented in the top-level
   `README.md` for the area you touched (schema, unit, golden-artifact,
   or security checks, as applicable).
3. Label any claim about physical behavior with the evidence taxonomy in
   `docs/authoring/evidence-labels.md`. Do not upgrade an inference or a
   preview result to a stronger evidence label than it earned.
4. Keep the change reviewable: prefer a small, focused pull request over
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
