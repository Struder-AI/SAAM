# Wavy DENSO

A 32 mm tall spline tube with a 16 mm bore receives a solid sliced substrate and six
alternating axial/helical cladding shells. Its [recipe](recipe.json) holds the
deterministic wavy control net.

Choose this example from the tour. Your copy is saved automatically.

Inspect the substrate and successive cladding shells, show travel, and compare
the oriented toolpath with the part. Try fewer shells or a changed cladding angle.
Geometry, operations, machine output and playback follow the shared lifecycle.

The [pipe-cladding manual](../../../skills/pipe-cladding/SKILL.md) owns tool
orientation, rotary setup and current limits. The recipe's nominal DENSO setup
is a development fixture. A complete arm overlay requires an explicit robot-base
alignment, tool length and model seed; source tool/rotary playback remains
available without inventing an installation. This is not a calibrated robot job.
