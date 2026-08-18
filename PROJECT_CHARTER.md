# SAAM Project Charter

**SAAM** — Struder Agentic Additive Manufacturing — is an open-source
framework for turning human manufacturing intent into inspectable,
machine-aware additive-manufacturing workflows.

## What SAAM is

A conversational agent, using its own reasoning and its own operator's
account, discovers the additive operations and machines a task can use,
composes them into a process plan, and hands that plan to a human for
inspection and approval before anything becomes machine-native output.

SAAM begins with additive manufacturing. Its operations — the reusable
strategies that turn a requested shape into a toolpath — are written to be
machine-independent wherever the physics allows. An operation's *exact*
path is resolved only once it is matched against an identified machine,
its installed configuration, the material in use, calibration, and setup.
The process plan produced along the way is independent of any specific
controller's syntax and of any specific user interface, but it is not
independent of the machine it's resolved against: SAAM does not pretend
one path works everywhere.

Machine definitions carry planning constraints, installed capabilities,
instance-specific configuration boundaries, supporting evidence, safety
information, and a machine-native post-processor. Post-processors
translate — or reject — approved geometry for their target controller.
They do not silently redesign it.

## What SAAM is not

- Not a conventional slicer, and not a slicer clone.
- Not a universal manufacturing ontology or a sensor/vision platform.
  Non-motion steps (a human placement, an inspection checkpoint) are
  represented minimally, as a prerequisite/result/evidence record — SAAM
  does not claim to have standardized vision, probing, or automatic
  corrective manufacturing.
- Not a remote-control platform. The MVP does not transmit commands to
  physical hardware, run unattended, or treat a validated preview as
  proof that a specific physical setup is safe.
- Not a hosted service. There is no account requirement, telemetry
  requirement, or proprietary dependency standing between a user and the
  open workflow.

## Governance and neutrality

Struder AI directs SAAM's mission, scope, roadmap, releases, and
compatibility policy, and enforces its contribution standards. That
authority governs *direction*, not *technical inclusion*: a third-party
operation, machine definition, or interface that meets the same
published compatibility, security, documentation, validation, and
evidence requirements as a Struder-authored one is treated the same way
by the generated conformance registry — `registry/registry.json`,
regenerated from the manifests actually present on disk by
`registry/generate.mjs` (`npm run generate-registry`), not
hand-curated, and checked for drift by
`tests/golden/registry-generate.test.mjs` on every test run. Authorship
is not a field it records, let alone a ranking factor. If SAAM later
adds a featured or recommended view, its criteria will be public,
technically grounded, and available to any component that meets them —
not a preference for Struder's own work.

Mission drift is prevented by keeping this charter, its stated
non-goals, and documented maintainer authority in force — not by giving
Struder-authored components preferential technical treatment.

SAAM may coexist with current or future Struder commercial products and
services. This charter does not promise that every future Struder
capability will be open source. It does promise the reverse: no
proprietary Struder service is required for the open workflow described
here to function.

## Licensing

Original SAAM code, schemas, operation definitions, machine definitions,
examples, tests, and documentation are licensed under the
[Apache License, Version 2.0](LICENSE), which permits commercial use by
anyone, including Struder. Using SAAM does not transfer ownership of a
user's generated parts, toolpaths, machine programs, workflow records, or
physical results — those remain the user's. Imported third-party
material is tracked separately; see `THIRD_PARTY_NOTICES.md`.

## Evidence and safety posture

SAAM distinguishes what has been observed on physical hardware from what
has been documented, simulated, or merely proposed — see
`docs/authoring/evidence-labels.md`. A deterministic preview or a passing
software validation confirms *intent and coordinates*. It is never
treated, in this project's own documentation or in generated output, as
proof that a specific physical setup is safe to run.

## Scope discipline

SAAM's first public milestone is a narrow, working vertical slice — one
planar operation, one genuinely spatial operation, one reference machine,
one reference post-processor, one reference workbench, and one adapter —
not a comprehensive catalog. New architectural layers are added when a
real operation, machine, or interface needs them, not in advance to look
more complete than the project currently is.
