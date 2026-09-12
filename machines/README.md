# Machine files

A machine file describes a machine and the output options it supports. An
export generated from SAAMpath must match one of those options.

[ultimaker-s5.json](ultimaker-s5.json) defines the first machine and its
`griffin-gcode` output. It contains nominal motion limits, tool offsets and the
startup contract. The locked plan selects the installed tool and material.
Exporting introduces no new process choices. Physical clearance is delegated
to the operator for the wedge demo; no general 15° clearance rating is claimed.

Standard S5 startup is assumed; firmware version is optional metadata.
Physical printing remains unvalidated.
See [S5 export notes](../skills/wedge-demo/references/s5-export.md).

[denso-vp6242-rc8.json](denso-vp6242-rc8.json) describes the six-axis VP-6242 with
RC8 and an external rotary for the [pipe demo](../skills/pipe-cladding/SKILL.md).
Installation fields start unresolved. Its experimental PacScript source ZIP uses
the shared Studio/review/delivery pipeline. The profile's display bounds are not
robot reach limits; kinematics, motion limits and collisions remain deferred.
See the [RC8 contract](../core/export/denso.md#denso-rc8-output-contract) for calibration,
rotary assumptions, relay behavior and unverified vendor execution.

See [GLOSSARY.md](../GLOSSARY.md) and [build requests](../build_request.md).
