# Authoring an Operation

An operation is a named, versioned, deterministic generator for one
machine-neutral additive strategy. This guide explains its manifest —
`schemas/manifests/operation-manifest.schema.json` — and the design
principle behind it that's worth understanding before writing your own.

## Identity is not location

An operation's permanent identity is its manifest `id`. Its display
`name`, its `category` tags, and the directory it lives in under
`operations/` are all freely changeable metadata — nothing in the schemas
references an operation by name or by path.

This is deliberate. SAAM's current operation catalog reflects what its
first contributors happened to build and test, not a first-principles
survey of every strategy a 3D printer or deposition robot needs. That
survey is worth doing eventually, and it will very likely draw different
category lines than the ones in use today. Keeping `id` as the only thing
a process plan or another operation's `dependencies` list ever points to
means that future recategorization is a metadata edit, not a breaking
migration. Don't encode a category or a machine capability into an
operation's `id` (avoid `three-axis-layer-filling`; prefer `layer-filling`
with `capabilityRequirements: ["planar-motion", ...]`) — that's the
mistake this structure exists to avoid repeating.

## Required manifest fields, briefly

- **`capabilityRequirements`** — what a machine must declare to be
  compatible, as data. This is what actually determines whether an
  operation can run on a given machine; naming conventions and directory
  placement are not load-bearing for that decision.
- **`maturity`** — `concept`, `experimental`, or `validated`. This is
  separate from `evidence.label`: maturity is a statement about the
  operation itself (has it run end-to-end, has physical hardware
  confirmed it), while evidence records the specific supporting claim.
  A newcomer or a funder scanning the registry should be able to tell
  "proven" from "sketched out" without reading the code.
- **`generator`** — must be deterministic: identical inputs (parameters,
  process settings, machine profile) always produce identical output.
  This is what makes a process plan reproducible and its approval
  meaningful.
- **`evidence`** — see `docs/authoring/evidence-labels.md`. Required on
  every manifest; defaults to `EXPERIMENTAL` for new work.

## Before submitting

1. Validate your `manifest.json` against
   `schemas/manifests/operation-manifest.schema.json`.
2. Confirm your generator is pure and deterministic — no filesystem,
   network, or clock reads inside the generation path itself
   (`provenance.generatedAt` is stamped by the caller, not the
   generator).
3. Add at least one example under `examples/` with its expected output,
   used by `tests/golden`.
4. State the operation's `maturity` and `evidence` honestly. It is not a
   defect for a new operation to be `concept` or `experimental` — it is a
   defect for it to claim more than it has earned.
