# Ultimaker S5 G-code Post-Processor

Translates an approved process plan into Griffin-flavor G-code for the
`ultimaker-s5` machine: a single `output.gcode` file.

This is the one machine-aware piece in this machine definition. It
translates or rejects; it never redesigns geometry — see
`../../../docs/architecture/operations-vs-postprocessors.md`. Every
point emitted in the generated G-code is a restatement of a point
already present in the input plan.

## What grounds this, and what doesn't

Unlike the Dobot reference post-processor — built against a real robot's
ROBOT-CONFIRMED print history — nothing about this machine has been
print-tested by this project yet. What it does have: a real `.ufp` file
exported by Cura 5.4.0 for a real Ultimaker S5 (a sensor-bracket part,
`magic_spiralize` mode, 0.8mm nozzle, PLA), supplied by this project's
own user and inspected directly (a `.ufp` is a zip container; the actual
G-code lives at `3D/model.gcode` inside it). That's a real accepted
file, not documentation — every structural convention below was read out
of it, not assembled from general Marlin knowledge. That's why this is
labeled DOC-CONFIRMED (see `manifest.json`) rather than EXPERIMENTAL:
it's grounded in one real, accepted artifact, just not yet in a print.

What the sample settled, concretely:

- **`;FLAVOR:Griffin`**, with a structured `;START_OF_HEADER` /
  `;END_OF_HEADER` block, not raw Marlin. The header declares bounding
  box, nozzle diameter, initial temperatures, and a print-time estimate.
- **No `G28` (home) and no `M140`/`M190` (bed temperature) anywhere in
  the body.** The header declares `BUILD_PLATE.INITIAL_TEMPERATURE`, and
  the printer's own connected/queued print system reads that and
  pre-heats the bed itself before running the payload — there's no
  in-body command for it. Guessing a standard raw-Marlin start sequence
  would have produced a file this printer doesn't actually expect.
- **`M109 S<temp>`** (wait for hotend temperature) *does* appear in the
  body, even though the same temperature is also declared in the header
  — the asymmetry is real, not an oversight to "fix."
- **Absolute extrusion** (`M82`), and the E-axis formula was checked
  against the sample's real numbers: measured `E_per_mm` on both a skirt
  line and a wall segment matched `(lineWidth × layerHeight) /
  (π × (filamentDiameter/2)²)` with 2.85mm filament to within 0.4%.
- **5mm retract/prime** around every real travel gap — a different
  choice from the Dobot post-processor's single-continuous-extrusion
  window, deliberately: that convention was a hardware-specific lesson
  about the Dobot's crude relay-controlled tool, not a general rule.
  This machine's stepper-driven E-axis extruder is designed for
  retract/prime cycling; the sample does it around essentially every
  travel, and this post-processor does too.
- **`G280 S1`** for bed-leveling compensation. Replicated exactly as
  observed; its parameter semantics beyond "S1 was what a real accepted
  export used" are not independently confirmed.
- **Both print cores get cooled at the end** (`M104 S0` then
  `M104 T1 S0`), even though only core 0 (T0) was used — a real,
  sensible convention worth keeping even in this post-processor's
  current single-extrusion scope.

## What it deliberately doesn't replicate

Per-feature speed/acceleration/jerk tuning (`M204`/`M205`), per-line
`;TIME_ELAPSED:` progress comments, and Cura-catalog identifiers
(`MATERIAL.GUID`, `NOZZLE.NAME`) all appeared in the real sample but
aren't emitted here — the first two are firmware/UI tuning and cosmetic
progress display, matching `ROADMAP.md`'s "Not operations" boundary; the
last two are Cura-specific catalog identifiers this project has no
legitimate source for. See `manifest.json` → `knownLimitations` for the
full list, including the open question of whether the S5's connected
print queue actually requires the fields this post-processor omits —
worth testing against a real unit.

## Instance configuration

`translate({ plan, instanceProfile })` takes material/nozzle
configuration separately from the plan — filament diameter, print core
nozzle size, print and build-plate temperature. Omit `instanceProfile`
and it falls back to the values observed in the reference sample (2.85mm
filament, 0.4mm nozzle, 210°C/60°C) — safe for inspecting output shape,
not necessarily right for your own filament or installed nozzle. See
`../instance-profile.example.json`.

## Known limitations

See `manifest.json` → `knownLimitations`. The most important one: no
program emitted by this generator has been run on physical hardware yet.
