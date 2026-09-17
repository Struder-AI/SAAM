# Developer context (transitional)

**This file is a handoff, not a permanent home.** It holds the developer-only
material that has been separated from the maker- and builder-facing documentation
during the move to three agent roles ([AGENTS.md](AGENTS.md#choose-your-role)).
As the code-anchored [dev maps](AGENTS.md#maps) are built, the region a map covers
becomes the single account of that scope, and the matching material here is
deleted rather than kept in a second place. Expect most of this file to disappear.

A developer agent works map-first: read the region map for the scope you are
changing, then the code its boxes name. This file is the digest for what the maps
do not yet carry. Shared engineering direction, priorities, the check policy, the
contribution boundary and documentation ownership are builder-and-developer
material and stay in [BUILDERS.md](BUILDERS.md); read it as the developer baseline
and do not duplicate it here. The core routing table
([find context for your task](BUILDERS.md#find-context-for-your-task)) locates the
owning component reference for any scope.

## How this file is organized

- **Moved slices** — developer-only sections physically lifted out of a shared
  README, with their origin recorded. These no longer appear in the source file.
- **Dev-bin manifest** — developer-only material still living inside a maker- or
  builder-facing document because it is interwoven with content those roles need.
  Each entry names the file, the anchor, and what is developer-only, so a future
  map knows exactly what to absorb. Nothing here has been moved yet.
- **Developer-only documents** — whole references that are developer context in
  their entirety; a builder reads the single one their isolated change touches.

---

## Moved slices

### Agent toolkit — implementation and verification
*Moved from `core/agent/README.md` on 2026-09-16.*

[toolkit.mjs](core/agent/toolkit.mjs) composes exported owning APIs; the thin
[CLI](scripts/agent-toolkit.mjs) validates arguments and handles JSON output
and process lifetime. [manuals.mjs](core/agent/manuals.mjs) is shared with MCP
through its compatibility re-export. The browser opener and request wait/claim
implementation are also shared with MCP. No new MCP onboarding or preview tools
are registered.

Focused coverage lives in [agent-toolkit.test.mjs](core/tests/agent-toolkit.test.mjs):
current-source context, isolated setup reuse, approval/export preservation on
reopening, STL import, fresh tours, request coordination, partial failure and
the actual managed CLI launcher. Existing manual-access, MCP and Studio request
tests cover the shared seams. Select checks under
[check policy](BUILDERS.md#avoid-check-spirals).

### Machine output — stationary extrusion and nozzle control
*Moved from `core/export/README.md` on 2026-09-16.*

Shared `extrude` actions carry positive volume and volumetric flow; `temperature`
actions carry a nozzle target. Griffin and H2D's common motion writer converts
stationary volume to E-only `G1` commands in the selected absolute/relative mode.
The interpreter resolves retraction debt first, then counts unretracted positive
E-only deposition as volume and duration at a fixed position. These commands
produce zero-length display moves and `injection` events with position, volume,
temperature and source time. Studio uses the same source interpreter.

Operation temperature targets are validated against the locked recipe and
machine/material ranges. The writer emits `M400` followed by `M109 S` at the
composer's parked position and restores the normal target after the operation.
Thermal wait durations and actual temperatures are not simulated. These are the
existing dialect commands; do not assume a generic Marlin `M109 R` cooling mode
is portable to both outputs. Firmware behavior still needs physical verification.
Relay robot outputs explicitly reject the new actions.

### Studio — historical toolpath inspection
*Moved from `studio/README.md` on 2026-09-16.*

For an explicitly requested historical toolpath inspection, a local scratch
launcher may pass `resolveBundle` to `createStudio`. The resolver supplies a
scratch adapter over `createBundleWorkflow`; Studio keeps its existing source
playback, print picker and lifecycle. The default CLI and known adapters are
unchanged. This is explicit development injection, not automatic discovery or
permission to load module paths from a print. Record the original revision and
settings, distinguish historical stroke geometry from modern export assumptions,
and verify the interpreted deposition against the source generator.
An adapter's optional `inspection` presentation supplies a title, description,
facts/settings rows and note for a development tour. Studio then exposes settings
for reading and hides its approval button; the scratch adapter must independently
reject approval and delivery. This presentation does not grant production rights.

---

## Dev-bin manifest

Developer-only material still interwoven inside a maker- or builder-facing
document. Left in place to keep that document coherent for the role that needs
the surrounding content; recorded here so the region map that eventually covers
each scope knows what to take. When a map absorbs one of these, delete the entry
and the source prose together.

| Source | Anchor | Developer-only content to absorb |
|---|---|---|
| `core/region/README.md` | [Shared offset functions](core/region/README.md#shared-offset-functions), [Shared planar intersections](core/region/README.md#shared-planar-intersections) | The Clipper2 offset/intersection kernel, surface-offset and perimeter-recovery internals, and their benchmarks and provenance. Makers keep only [material regions and shared interfaces](core/region/README.md#material-regions-and-shared-interfaces). |
| `core/export/README.md` | [Machine interoperability design](core/export/README.md#machine-interoperability-design), [Output compatibility](core/export/README.md#output-compatibility) | The interoperability design internals — `profile.mjs`, `registry.mjs`, the SAAMpath action set. Makers keep machine choice, each profile's declared output and limits, and the [short-travel advisory](core/export/README.md#short-travel-advisory) meaning. |
| `studio/README.md` | [Agent request coordination](studio/README.md#agent-request-coordination) | The request-index and file-persistence internals and the `work-state.mjs` / `app.mjs` mechanics. Makers and builders keep the request-coordination behavior (`begin_studio_work`, wait/respond). |

---

## Developer-only documents

Whole references that are developer context in their entirety. A builder making an
isolated change reads only the one that owns the scope they touch; a developer
reads across them as the work needs.

- [core/README.md](core/README.md) — core architecture index; the map of stages and current exceptions.
- [core/geom/README.md](core/geom/README.md) — geometry representation, queries, precision, mesh repair.
- [core/path/README.md](core/path/README.md) — stroke composition, scheduling and travel.
- [core/print/README.md](core/print/README.md) — the print lifecycle contract (plans, validation, persistence, generation, delivery). Makers use [core/print/USAGE.md](core/print/USAGE.md), not this.
- [studio/RENDERING.md](studio/RENDERING.md) — render and playback implementation.
- [studio/KINEMATICS.md](studio/KINEMATICS.md) — machine presentation provider contract.
- [adapters/mcp/DEVELOP.md](adapters/mcp/DEVELOP.md) — MCP adapter implementation notes.
- [machines/README.md](machines/README.md) — machine capability file format.
- [core/tests/README.md](core/tests/README.md) — test design and coverage selection (also builder-accessible).
- [scripts/bench/README.md](scripts/bench/README.md) — performance benchmarks.

Skill authoring lives in [skills/DEVELOP.md](skills/DEVELOP.md) and each skill's
`DEVELOP.md`; changing a skill is **builder** work, not developer-only, so those
stay in [builder context](BUILDERS.md).
