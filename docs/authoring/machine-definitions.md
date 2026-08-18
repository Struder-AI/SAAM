# Authoring a Machine Definition

A machine definition (`schemas/manifests/machine-manifest.schema.json`)
separates four things that are easy to accidentally tangle together:

1. **Model constraints** — true of the machine model in general (axis
   count, native motion primitives, reach, rated payload). Safe to
   publish. If you're not certain of an exact figure, say so in
   `sourceNote` rather than asserting a number you haven't verified —
   `reachMm`/`ratedPayloadG` accept `null` for exactly this reason.
2. **Capabilities** — which operation `capabilityRequirements` this
   machine, as configured, actually satisfies, each with its own
   evidence label and scope. A capability being listed is not a blanket
   claim; it's scoped to what's actually been confirmed.
3. **Installed tooling** — equipment specific to a reference
   installation (an extrusion end effector, a remote-I/O button panel).
   Documents what one real setup looks like without claiming every unit
   of the model has it.
4. **Instance configuration** — values that vary per physical unit:
   calibration coefficients, bed height, frame IDs, I/O channel
   assignments. This is exactly the material that must never be
   committed to a public fork as real facility data. A machine manifest
   names which fields are instance-specific (`instanceConfiguration.fields`)
   and points at a synthetic example (`instanceConfiguration.example`)
   for format only.

## Why the split matters

Model constraints and capabilities are what an operation's
`capabilityRequirements` are checked against during discovery — they
need to be accurate and honestly scoped, but they don't change per unit.
Instance configuration is what a post-processor actually needs at
generation time to emit correct native output for *this* unit, and it's
also the category most likely to contain something that shouldn't be
public: a specific facility's calibration, a specific bed's height
offset, wiring particular to one build.

Keep safety notes generalized. A real lesson (verify tool-load tuning
before running unattended custom end effectors, don't trust a live IDE
readout over physical motion) is worth publishing. The exact
measurement that lesson came from on one specific rig usually isn't.

## Evidence discipline

Every `capabilities[].evidence` entry follows
`docs/authoring/evidence-labels.md`. A machine succeeding at an event or
milestone does not upgrade every capability's evidence — check and scope
each one on its own.
