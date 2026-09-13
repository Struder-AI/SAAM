# Machine files

A machine file describes a machine and the output options it supports. An
export generated from SAAMpath must match one of those options.

Each tool declares concrete `hotends` as valid core/nozzle-diameter pairs and
the material categories they accept. A saved setup contains one installation
record per tool plus one active tool; this shape extends to printers with more
than two heads without adding named left/right fields. Material properties live
in the separate [generic material catalog](../materials/README.md). The active
nozzle derives layer-height and line-width limits. Changing a tool, nozzle or
material is a plan change and invalidates settings/toolpath approval.

[ultimaker-s5.json](ultimaker-s5.json) defines the first machine and its
`griffin-gcode` output. It contains nominal motion limits, tool offsets and the
startup contract. The locked plan selects the installed tool and material.
Exporting introduces no new process choices. Physical clearance is delegated
to the operator for the wedge demo; no general 15° clearance rating is claimed.

Standard S5 startup is assumed; firmware version is optional metadata.
Physical printing remains unvalidated.
See [S5 export notes](../skills/wedge-demo/references/s5-export.md).

The S5 profile declares the vendor's valid combinations: AA 0.25/0.4/0.8 mm
for non-abrasive build material, BB 0.4/0.8 mm for soluble support, and CC
0.4/0.6 mm for abrasive composites. Both slots use the same extensible tool
record; the shipped remembered default remains AA 0.4.

The H2D profile declares 0.2, 0.4, 0.6 and 0.8 mm hardened-steel hotends on
both sides, following the official H2D specification. The shipped default is
0.4 mm. The current single-material path selects one active head; dual-material
composition remains future work.

[denso-vp6242-rc8.json](denso-vp6242-rc8.json) describes the six-axis VP-6242 with
RC8 and an external rotary for the [pipe demo](../skills/pipe-cladding/SKILL.md).
Installation fields start unresolved. Its experimental PacScript source ZIP uses
the shared Studio/review/delivery pipeline. The profile's display bounds are not
robot reach limits; kinematics, motion limits and collisions remain deferred.
See the [RC8 contract](../core/export/denso.md#denso-rc8-output-contract) for calibration,
rotary assumptions, relay behavior and unverified vendor execution.

See [GLOSSARY.md](../GLOSSARY.md) and [build requests](../build_request.md).
