# Machine files

A machine file describes a machine and the output options it supports. An
export generated from SAAMpath must match one of those options.

For incremental kinematic-model development, the
[Studio presentation contract](../studio/KINEMATICS.md) defines how links, rails,
carriages and other components reach the complete shared viewer. Model providers
own motion and frame alignment; profiles do not embed rendering code.
The [model reference](../core/machine/README.md) describes the implemented
providers and their nominal/installation limits. [Studio studies](../tools/kinematics/README.md)
provide a read-only route for machines without controller output.

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
robot reach limits; production kinematic validation, motion limits and collisions
remain deferred. Its nominal presentation model does not establish RC8 branch parity.
See the [RC8 contract](../core/export/denso.md#denso-rc8-output-contract) for calibration,
rotary assumptions, relay behavior and unverified vendor execution.

See [GLOSSARY.md](../GLOSSARY.md) and [build requests](../build_request.md).

[split-delta.json](split-delta.json) declares the six-carriage design profile and
shared kinematic model. Its [standalone lab](../tools/split-delta/README.md) provides
cylinder/track assessment and a simulation-only source interpreter; production
controller output is unavailable. The same lab exposes a nominal MG400 linkage
model without changing the configured Dobot Lua output or claiming calibration.
