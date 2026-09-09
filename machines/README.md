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

See [GLOSSARY.md](../GLOSSARY.md) and [build requests](../build_request.md).
