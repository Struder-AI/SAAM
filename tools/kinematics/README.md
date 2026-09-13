# Machine studies in Studio

Create a nominal motion study and open it with the normal Studio launcher:

```sh
node tools/kinematics/create-study.mjs tilty Prints/development/tilty-studio
node studio/server.mjs Prints/development/tilty-studio
```

Supported IDs are `tilty`, `split-delta`, `dobot-mg400`, `denso-vp6242-rc8`,
`ultimaker-s5` and `bambu-h2d`. Use **Machine view** to fit the assembly and
**Play** or the scrubber to inspect motion. Enable **Show travel** to display
the default study's non-depositing path. Geometry and process approval are
unavailable; this source is not a machine program.

In Machine view, **Tool position** sliders move the simulated tool in XYZ and
the model's supported orientation axes. Moving a slider pauses playback. Use
**Return to playback**, Play or the timeline to resume source positioning.
Rails show fixed working travel from the machine definition. Slider movement
prioritizes the dragged coordinate and adjusts the others as needed to stay
reachable; at a local boundary the control stops and reports the limit.

The command writes `plan.json`, `machine.json` and `motion.json` into the named
directory, replacing an existing study there. Robot examples explicitly use
synthetic nominal floor installations. Dimensions and installation fields are
described in the [model reference](../../core/machine/README.md).

Optional third and fourth arguments supply motion and model-configuration JSON:

```sh
node tools/kinematics/create-study.mjs tilty Prints/development/tilty-custom motion.json model.json
```

The motion source is small, explicit and simulation-only:

```json
{
  "schema": "saam-machine-study-source/1",
  "orientation": "gimbal-rx-ry",
  "initial": {"tcp": [0, 0, 20], "anglesDeg": [0, 0, 0]},
  "moves": [
    {"tcp": [10, 0, 25], "anglesDeg": [10, 15, 0], "seconds": 2},
    {"tcp": [10, 0, 25], "anglesDeg": [10, 15, 0], "seconds": 1}
  ]
}
```

Each move supplies a destination TCP in mm, orientation in degrees and duration
in seconds. Equal endpoints express a dwell. `gimbal-rx-ry` interpolates Tilty's
two gimbal coordinates; its third angle must be zero. `euler-xyz` uses
`Rz(C) Ry(B) Rx(A)` and interpolates those Euler coordinates. Optional
`volumeMm3` is authored deposition intent for visualization, not an extrusion
controller command. This input does not silently convert between the two
orientation conventions.

Existing Splitty `.sdgcode` source can be opened without rewriting its bytes:

```sh
node tools/kinematics/create-study.mjs split-delta Prints/development/splitty-import preview.sdgcode
node studio/server.mjs Prints/development/splitty-import
```

The study retains `motion.sdgcode` and uses the existing Splitty interpreter.
Its TCP/Euler interpolation, elapsed dwell time and source lines feed Studio.
Supply a fourth model JSON argument when that source uses a different design.
The shared provider draws the solved mechanism using that same configuration.

[machine-study.mjs](../../studio/machine-study.mjs) is a read-only adapter into
the shared viewer, source transport and identity handling. It cannot approve,
generate or deliver a manufacturing job. Study data stays in ignored `Prints/`;
no study approvals transfer to ordinary print bundles.

## Lower rail limits

```sh
node tools/kinematics/rail-limits.mjs
```

This authoring calculation reads the Tilty profile and reports lower carriage
limits for nozzle positions at or above the bed. It bounds tilt-rail minima
over the allowed gimbal range to 0.02 mm, includes reachable witness poses,
and rounds lower stops down to 0.1 mm. It does not edit the profile or run
during playback. Recalculate after changing mechanism dimensions or the tilt
cone or rod angular reserve, then put the reported `railMinMm` and `tiltRailMinMm` in the machine
definition and refresh existing study snapshots.
