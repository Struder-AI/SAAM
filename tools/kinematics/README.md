# Machine studies in Studio

Studio is the shared viewer for every supported machine. Create a nominal motion
study and open it with the normal Studio launcher:

```sh
node tools/kinematics/create-study.mjs ultimaker-s5 Prints/development/s5-studio
node studio/server.mjs Prints/development/s5-studio
```

Supported IDs are `dobot-mg400`, `denso-vs068a4-rc8`,
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
node tools/kinematics/create-study.mjs ultimaker-s5 Prints/development/s5-custom motion.json model.json
```

The motion source is small, explicit and simulation-only:

```json
{
  "schema": "saam-machine-study-source/1",
  "orientation": "euler-xyz",
  "initial": {"tcp": [0, 0, 20], "anglesDeg": [0, 0, 0]},
  "moves": [
    {"tcp": [10, 0, 25], "anglesDeg": [10, 15, 0], "seconds": 2},
    {"tcp": [10, 0, 25], "anglesDeg": [10, 15, 0], "seconds": 1}
  ]
}
```

Each move supplies a destination TCP in mm, orientation in degrees and duration
in seconds. Equal endpoints express a dwell. `euler-xyz` uses
`Rz(C) Ry(B) Rx(A)` and interpolates those Euler coordinates. Optional
`volumeMm3` is authored deposition intent for visualization, not an extrusion
controller command.

[machine-study.mjs](../../studio/machine-study.mjs) is a read-only adapter into
the shared viewer, source transport and identity handling. It cannot approve,
generate or deliver a manufacturing job. Study data stays in ignored `Prints/`;
no study approvals transfer to ordinary print bundles.
