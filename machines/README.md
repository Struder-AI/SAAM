# Machine files

A machine file describes a machine and the output options it supports. An
export generated from SAAMpath must match one of those options.

## Profiles for geometry and setup review

The following profiles are selectable through the shared machine catalog. They
support planar geometry/setup review; their output declarations have
`implemented: false`. Generation reports the missing machine contract before
constructing a toolpath. They do not inherit another printer's startup sequence.

| Profile | Installed nozzle assumption | Default / other declared materials | Output still needed |
|---|---|---|---|
| [Bambu X1 Carbon](bambu-x1-carbon.json) | Single hardened 0.4 mm, 1.75 mm filament | PLA / PETG, ABS, ASA, PC, TPU (95A class) | X1-specific firmware envelope and sliced 3MF |
| [Ultimaker 2 Extended](ultimaker-2-extended.json) | Original single 0.4 mm nozzle, 2.85 mm filament; 305 mm height | PLA / ABS | UltiGCode, with volumetric extrusion and firmware-owned material/startup settings |
| [Ultimaker 3](ultimaker-3.json) | One selected AA 0.4 core, 2.85 mm filament; 200 mm height | PLA / ABS | UM3-specific Griffin startup and shutdown |

PLA is a default, not a fixed material requirement. Change `setup.material`
together with nozzle/bed temperatures and the necessary process settings through
the ordinary setup adjustment. Material selection does not automatically retune
temperature, cooling, retraction or flow. TPU's flow cap is 2 mm³/s; the other
listed materials use a conservative 4 mm³/s cap. UM3 material changes also need
the correct material GUID before eventual Griffin output. Material windows are
starting limits, not certification for every brand or a physical print result.

These are the original **2 Extended** and standard **3**, not the 2+, Extended+,
2+ Connect, 3 Extended or S3. UM3 hardware has two nozzles, but SAAM plans select
one installed AA core; a BB support core and tool changes are not supported here.
No nonplanar clearance limit is assigned to these new profiles. Conservative
rectangular tool bounds avoid the X1 cutter region and UltiMaker glass clips;
each profile records the reduced area and official hardware/Cura sources.

## Existing machine contracts

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
