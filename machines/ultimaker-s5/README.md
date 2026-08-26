# Ultimaker S5

A purpose-built desktop FDM printer: cartesian XY gantry, Z-lifting
heated bed, dual swappable print cores, Marlin-derived controller. This
is SAAM's second machine definition, and the first that isn't a
repurposed robot arm — most of the model-level facts here come from
Ultimaker's own published specification sheet and Marlin's public G-code
reference rather than hands-on history the way the Dobot reference
install's evidence does.

See `manifest.json` for the full definition, structured per
`docs/authoring/machine-definitions.md`.

## What's here and what isn't

Model-level facts (build volume, filament diameter, motion primitives)
are published and DOC-CONFIRMED against public sources — see
`manifest.json`'s `sourceNote`. Real per-unit values (which print core
and nozzle size is installed, this bed's own Z-offset) are not;
`instance-profile.example.json` is a synthetic placeholder showing the
*shape* of that data only.

## Capability evidence, at a glance

| Capability | Evidence |
|---|---|
| `planar-motion` | DOC-CONFIRMED — standard Marlin G0/G1 |
| `extrusion-on-off` | DOC-CONFIRMED — standard Marlin G1 E-axis / M82 / M83 |
| `coordinated-xyz-motion` | DOC-CONFIRMED — a single G1 natively carries simultaneous X/Y/Z/E on any Marlin-family controller; this is the ordinary primitive FDM G-code always uses, not an experimental use of one designed for something else the way it was on the Dobot reference install. Covers the motion primitive existing, not that a specific non-planar surface has been print-verified on this unit. |

None of these are ROBOT-CONFIRMED yet in the sense this project uses
that label for the Dobot reference install — DOC-CONFIRMED against
public documentation is a real, honest, but lower bar. That upgrades the
moment a real exported file from this post-processor is checked against
this unit's own accepted G-code and, ideally, actually printed.

## Filament diameter: 2.85 mm, not 1.75 mm

Worth calling out on its own line because it's the easiest wrong
assumption to import from other FDM projects: Ultimaker's S-line
printers use 2.85 mm filament. Every extrusion (E-axis) calculation in
the post-processor is wrong if this constant is wrong.

## Post-processor

Native output for this machine is emitted by
`ultimaker-s5-gcode-postprocessor`, in `postprocessor/` alongside this
manifest. The post-processor translates or rejects approved geometry; it
does not redesign it — see
`docs/architecture/operations-vs-postprocessors.md`.

Its structural conventions (Griffin header block, absolute extrusion,
per-gap retract/prime, no in-body bed-heat command, dual-print-core
cooldown at the end) were read directly out of a real `.ufp` export from
Cura 5.4.0 for a real Ultimaker S5 — not assembled from generic Marlin
documentation. That sample also settled a genuinely non-obvious point:
there's no `G28` (home) or `M140`/`M190` (bed temperature) anywhere in a
real accepted file — this machine's connected print-queue system handles
both itself, outside the G-code payload, based on the header's declared
values. Guessing a standard raw-Marlin start sequence instead would have
produced a file this printer doesn't actually expect. See
`postprocessor/README.md` for the full account of what that sample did
and didn't confirm, and its `manifest.json` for the current known
limitations.

## Scope

Single-extrusion output only (print core 1). The S5's dual print cores
support tool-change and multi-material sequencing, which is real,
documented future work in `ROADMAP.md`'s Multi-material/multi-tool
category — not built here yet, and not silently assumed by anything in
this machine definition.
