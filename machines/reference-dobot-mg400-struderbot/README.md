# Dobot MG400 · StruderBot Reference Installation

The reference machine definition for a Dobot MG400 desktop robotic arm
fitted with a fixed-nozzle filament-extrusion end effector — the
configuration SAAM's operation library and reference post-processor were
first proven against.

See `manifest.json` for the full definition, structured per
`docs/authoring/machine-definitions.md`: model constraints, satisfied
capabilities with their own evidence, installed tooling, safety notes,
and the boundary around instance-specific configuration.

## What's here and what isn't

Model-level facts (axis count, native motion primitives) and capability
evidence are published. Real calibration — this installation's specific
XY scale coefficients, bed height, frame IDs, and I/O wiring — is not.
`instance-profile.example.json` is a synthetic placeholder showing the
*shape* of that data, not real values. If you're setting up your own
MG400-class installation, measure and record your own instance profile
following that shape; see the post-processor's calibration procedure for
how those values get used.

## Capability evidence, at a glance

| Capability | Evidence |
|---|---|
| `planar-motion` | ROBOT-CONFIRMED |
| `extrusion-on-off` | ROBOT-CONFIRMED |
| `coordinated-xyz-motion` | EXPERIMENTAL — confirmed at shallow slope (20°); steeper slopes and long continuous runs remain open work (see `manifest.json` for the known layer-transition limitation) |

## Post-processor

Native output for this machine is emitted by `dobot-lua-postprocessor`,
in `postprocessor/` alongside this manifest. The post-processor
translates or rejects approved geometry; it does not redesign it — see
`docs/architecture/operations-vs-postprocessors.md`.
