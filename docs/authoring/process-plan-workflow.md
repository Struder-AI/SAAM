# The Process-Plan Workflow

Every part SAAM produces moves through the same sequence, whether a human
is driving directly or an agent is composing operations on a human's
behalf.

1. **Describe.** State the manufacturing intent: what shape, what
   dimensions and placement are known, what tool behavior and
   constraints matter.
2. **Discover.** Match the request against compatible operations and an
   identified machine definition (see `registry/`). Ask for missing
   information that would materially change geometry, placement, tool
   behavior, or safety — never invent it.
3. **Generate.** Run the matched operations' deterministic generators
   against the part plan, process settings, and machine profile,
   producing a process plan (`schemas/process-plan/`) at `status:
   "draft"` or `"preview-only"`.
4. **Preview.** Render the plan in an interface for inspection: overall
   shape and dimensions, machine-space origin, axis orientation,
   start/end positions, motion order and direction, print vs. travel
   moves, and tool-on/off transitions.
5. **Approve.** A human, acting through an interface (never an adapter,
   never chat text alone), creates an approval record bound to the exact
   revision's content hash. Any later change to geometry, dependencies,
   tool state, machine context, or safety-relevant data invalidates that
   approval.
6. **Post-process.** Once approved for `executable-export` scope, the
   matched machine's post-processor translates the plan into native
   output. It never runs without an approval record at the matching
   revision.
7. **Test and record.** Physical results — successes, failures, and
   anything needing retest — are written back as evidence
   (`docs/authoring/evidence-labels.md`) against the exact operation and
   machine involved.

## What a passing preview does not mean

A deterministic preview and a passing schema/geometry validation confirm
that the plan is internally consistent and matches the stated intent.
Neither is authorization to assume a physical run is safe. Approval scope
is granted in stages on purpose: `geometry` approval, `executable-export`
authorization, and `machine-control` authorization are separate
permissions, and holding one never implies another.
