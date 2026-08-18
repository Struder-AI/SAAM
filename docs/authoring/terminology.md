# Terminology

Definitions for the terms SAAM's schemas, code, and docs use consistently.
When a term appears with a specific meaning elsewhere in this repository,
it means what's defined here.

**Operation (skill)**
A named, versioned, deterministic generator for one machine-neutral
additive strategy — for example, planar layer filling or non-planar
cladding. An operation declares its inputs, outputs, capability
requirements, dependencies, maturity, and evidence in a manifest (see
`schemas/manifests/`). An operation's identity is its manifest `id`, not
its location in the repository or its display name — both of those can
change without breaking anything that references the operation.

**Part plan**
The part-level description of what's being made: overall shape, envelope
dimensions, and the process settings (layer height, bead width, etc.) an
operation's output was generated against. A part plan is an input to
operation generators, not a substitute for the manufacturing strategy
itself — the same part plan can be realized by different operations.

**Planar toolpath**
A toolpath whose motion stays on a series of flat, usually
horizontally-stacked layers. Conventional perimeter/infill printing is
planar even when it uses curved in-plane paths (arcs, spirals).

**3D toolpath (spatial toolpath)**
A toolpath whose motion is genuinely three-dimensional within a single
pass — coordinated X, Y, *and* Z change together along the path, not just
between discrete layers. Cladding a sloped or curved surface is a 3D
toolpath; stacking flat layers, even oddly-shaped ones, is not.

**Machine definition**
The description of one physical (or template) machine: planning
constraints, installed capabilities, instance-specific configuration
boundaries, supporting evidence, safety information, and the
post-processor that emits its native output. A machine definition
separates what's true of the *model* from what's true of one *instance*
of it (a specific unit's calibration, a specific facility's setup) — the
former can be published, the latter usually shouldn't be.

**Machine-resolved process plan**
The output of matching an operation's generated geometry against a
specific machine definition: motion, tool/process state, operation
dependencies, provenance (which generator and version produced each
part), validation results, a revision number, and approval state. See
`schemas/process-plan/`. A process plan is not portable to a different
machine without being re-resolved.

**Interface**
Software that lets a human inspect, navigate, and approve a process plan.
SAAM's reference interface is a local read-only 3D workbench; other
interfaces can be built against the same process-plan contract.

**Registry**
A generated, machine-readable and browsable index of every operation,
machine definition, and interface, built from their own manifests against
one published set of inclusion criteria. The registry does not grant
ranking preference by authorship.

**Adapter**
A thin integration layer that lets an external agent or tool call into
SAAM: discovery, generation, validation, review requests, approval-status
reads, and post-processing. An adapter does not own manufacturing logic
and cannot itself create an approval record.

**Post-processor**
The machine-specific translator from an approved process plan to native
controller output (for example, DobotStudio Lua). A post-processor
translates or rejects; it does not redesign approved geometry.

**Evidence**
A label describing how a claim about physical behavior is supported. See
`docs/authoring/evidence-labels.md` for the full taxonomy and its rules.

**Approval**
A record, created only by an explicit human action in an interface, that
binds a specific process-plan revision (by content hash) to a person's
decision that its geometry may proceed. Any change to geometry,
dependencies, tool state, machine context, or safety-relevant data
invalidates the approval it affected. Geometry approval, executable
export authorization, and direct machine-control authorization are
separate permissions — holding one does not imply another.
