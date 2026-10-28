# Machine presentation models

[presentation.mjs](./presentation.mjs) implements the provider side of the
[Studio contract](../../studio/KINEMATICS.md). Gantry machines are drawn from
profile data alone (`kinematics` of `cartesian-fixed-vertical-nozzle` and the
profile bounds), so every such profile gets the schematic without code. Every other
machine is drawn by its extension's [kinematics plug](../export/DEVELOP.md#kinematics-plug):
the machine pose is inverse kinematics from the toolhead's position and orientation
in the part frame, and core names no axis. A machine without a plug is not drawn.
The renderer receives simple rigid components and world transforms; it has no
machine-specific solvers. [Study tools](../../tools/kinematics/README.md) open
nominal mechanisms in the same Studio.

## Profile and defaults queries

`query-operations.mjs` owns installed machine-list projection and remembered/default
settings assembly. The caller supplies the neutral recipe base as a value from
Bundle; Settings receives no Bundle resolver. Store admission precedes profile
selection, and queries create no setup files. The approved `settings-profile-catalog`
query reads selected data declarations from Extensions, preserving local override
provenance and duplicate/skipped findings. It does not execute entries or authorize
process/adapter providers; those seams remain separate.

`settings-memory.mjs` owns remembered setup storage. After complete program
preparation, Bundle sends the captured machine ID, setup and preparation receipt;
Settings serializes its atomic write and reports completion or failure. It runs
no Bundle callback under the lock. Remembering and Bundle receipt recording are
independent optional steps: either failure preserves the prepared program.
New selections query this store without creating files; saved parts retain their
own settings. Download retries reuse the artifact without remembering again.

## Source and installation

[path-time.mjs](path-time.mjs) evaluates one path time for both the drawn path
and its machine: the path's requested timing, tool-orientation interpolation and
studies' Euler interpolation. Reverse seeks do not depend on
previous screen frames.
Providers solve at the requested pose, not interpolated joint endpoints.

`machine.kinematicModel` owns dimensions and optional installation data in the
machine snapshot. Study plans can override them with `setup.kinematicModel`.
`worldFromBase` is a rigid transform from the model's base coordinates into the
source display room; `toolLengthMm` describes the modeled installed tool.
Without explicit robot alignment, the provider supplies the known bed/tool
frames and declares the missing arm. Nominal setup in a study is synthetic,
not installation calibration; the plug states what else leaves its arm undrawn.

The provider's `part` transform maps drawn path points into the room.
It includes a printer's descending bed or the plug's table (its `partFrame`) exactly once.
Following the plate applies its inverse to the entire scene. S5/H2D models show
schematic travel centerlines from the profile bounds, an XY carriage and a Z bed;
they omit housings, belts and parked tools. Tool shapes are schematic: a short
cone marks the tip, and a line represents the configured tool length.

Machine view supplies manual XYZ tool-position sliders, plus the rotations the
plug names (`rotationControls`).
The provider owns their coordinates and ranges, and reuses its source-pose solver.
Unaligned robots do not offer arm controls. Manual poses remain temporary display
state; they do not alter source programs or authorize hardware motion.
Rail lines show fixed working carriage limits from the machine definition.
They do not depend on loaded source or expand during slider movement.
Slider spans conservatively cover the geometry's workspace instead of using
the print display bounds. These fixed spans contain the modeled motion, not
just sampled source poses.
[jog.mjs](./jog.mjs) prioritizes the dragged coordinate
and adjusts other coordinates through local constraint projection; all returned
poses pass the owning model checks: gantries enforce travel bounds, a plug supplies
its arm's margins. A solve failure stops the jog; unknown physical
socket limits and collisions remain outside these nominal models.
The [presentation contract](../../studio/KINEMATICS.md#provider-interface) owns
manual request identity, display retention and return-to-playback behavior.

The Dobot and DENSO models, with their sources, are in their machine manuals:
[Dobot](../../machines/dobot/SKILL.md#kinematics) and [DENSO](../../machines/denso/SKILL.md#kinematics).

## Verification

Presentation poses, frame alignment, provider conformance and study-adapter
behavior have no stored tests: their expected values follow from the model and
the contracts above, so write the checks you need on demand. The external
controller facts they build on stay covered by [denso.test.mjs](../tests/denso.test.mjs)
and [dobot.test.mjs](../tests/dobot.test.mjs).
