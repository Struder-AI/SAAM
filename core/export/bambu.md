# Bambu H2D and X1 Carbon output

SAAM authors its job description, G-code configuration comments and sliced-3MF
metadata. [resolveBambuJob](bambu-job.mjs) resolves that description once for each
export or import; [bambu.mjs](bambu.mjs) projects it into every repeated field.
Machine files own bounded firmware service sequences. Reference exports are
comparison evidence, never package/header/thumbnail templates to copy into a job.

Output remains experimental. A consistent archive proves neither firmware
compatibility nor that the requested AMS tray is physically connected or loaded.
The outstanding reference and hardware checks are tracked in
[BR-055](../../build_request.md#br-055--express-plate-choice-and-close-the-ams-package-gap).

## Maker setup

Before generation, establish the selected nozzle, **both installed diameters** on
H2D, plate, PLA identity/colour, temperatures and intended spool. Profile defaults
are editable assumptions, not observations of the printer. In particular,
`otherNozzleMm: 0.4` and the default filament colour must not be represented as
confirmed hardware or spool identity.

Example: H2D right 0.8 mm, left 0.4 mm, textured plate, one brown PLA filament:

```json
{
  "tool": 1,
  "core": "Hardened steel 0.8",
  "nozzleMm": 0.8,
  "material": "PLA",
  "filamentColor": "#8B5A2B",
  "ams": {"unit": 1, "slot": 4},
  "bambu": {
    "plate": "textured_plate",
    "otherNozzleMm": 0.4,
    "amsConnections": [{"unit": 1, "tool": 1}],
    "filaments": [{"id": "GFA01", "colour": "#8B5A2B"}],
    "filament": 0,
    "startup": {
      "bedLeveling": "printer",
      "flowCalibration": "printer",
      "plateDetection": "printer",
      "toolOffsetCalibration": "printer"
    }
  }
}
```

These are setup fields to merge into a complete recipe with normal print tools,
not a complete plan. `GFA01` is an example preset identity, not a universal brown
PLA ID. Use the actual material identity and colour. `filaments: null` declares
one PLA Basic (`GFA00`) logical filament using `setup.filamentColor` or the profile
placeholder. It does not discover spools. An explicit list and an explicit
`setup.filamentColor` must agree on the selected entry or export is rejected.

`setup.nozzleMm` is the selected diameter; `core` must name that same diameter.
`otherNozzleMm` names the **unselected** H2D nozzle; update it when switching
sides. It is null on X1 Carbon. There is no second selected-diameter override.
The output supports standard hardened-steel nozzles only, not high-flow or
stainless alternatives.

`plate` is `textured_plate` (Textured PEI Plate) or `hot_plate` (Smooth PEI Plate).
Select the installed surface and set `bedC` for that material/surface. Plate choice
does not choose a temperature for the maker. Cool, Engineering, SuperTack and
third-party surface-specific recipes are not implemented and are rejected.

Startup controls accept `printer`, `on`, or `off`. `printer` leaves the runtime
flag to the printer; an explicit choice emits one flag assignment before any
service action. H2D exposes bed leveling, flow calibration, plate detection and
tool-offset calibration. X1 exposes bed leveling and flow calibration; the other
two must remain `printer`. These switches control their named conditional blocks,
not all probing, homing or mechanical checks. Tool-offset calibration can heat
both H2D nozzles. Do not promise an unused nozzle remains cold.

Use normal `adjust` / `adjust_print`, regenerate, and review the new artifact.
[Remember setup](../print/USAGE.md#remember-machine-setup) after the installation
facts are correct. Never repair a mismatch by editing a delivered G-code comment,
XML entry or checksum. A changed setting invalidates the old generated program.
Old snapshots without these setup fields or with retired envelope IDs must be
recreated against the current machine profile and reviewed; they are not silently
migrated or re-delivered.

## Choosing the spool

There are three different number systems:

| Setting | Meaning | Example |
|---|---|---|
| `setup.tool` | Logical nozzle, zero-based | H2D 0 left, 1 right |
| `setup.bambu.filament` | Index in this job's logical filament list, zero-based | One-filament job uses 0, regardless of tray |
| `setup.ams` | Requested physical unit/slot, one-based | Unit 1 slot 4 is operator intent, not `T3` |

H2D physical heater selectors reverse the logical nozzle order: left uses 1,
right uses 0. Package extruder IDs are one-based 1/2. Never replace all T numbers:
`T1000`, `T1001`, `T1100` and end-of-job unload sentinels are firmware operations.

`M620 S<n>A`, ordinary `T<n>` and `M621 S<n>A` use the job's logical filament
index. The H2D repeats that load triplet and also uses the same index in
`M620.6 I<n>`. The selected nozzle remains a separate mapping. A job may declare
several logical PLA entries and print one; an entry is not a claim that a
corresponding physical AMS tray exists. Duplicate colours are valid and do not
establish physical slot identity.

`bambu.amsConnections` is null when connectivity is unknown, or the installation's
list of `{unit, tool}` connections. For the user-reported H2D, unit 1 connects to
tool 1 (right). A requested AMS unit that cannot feed the selected nozzle is
rejected when connections are declared. This prevents treating an attached AMS
as available to both nozzles. An empty list means no AMS units are connected.
The two current profiles describe four-slot units. Their connection counts
generate `extruder_ams_count` per logical nozzle (`1#0|4#0` for none,
`1#0|4#1` for one), matching the supplied right-connected H2D reference.
The field describes counts, not unit IDs or a firmware routing command.
Unknown connectivity omits this field; an empty list declares zero counts.
Single-slot AMS devices and other topologies need an extended contract.

`setup.ams` is validated against the profile's unit/slot capacity and recorded in
`Metadata/saam-job.json` and the interpreted program's job summary. **It does not
force a tray through G-code.** SAAM has no implemented printer-dispatch mapping
adapter. Confirm the job filament-to-tray mapping on the printer before starting;
if the intended mapping cannot be selected, stop and record that failure. Colour
and material are matching hints, not proof of the selected spool. External-spool
selection and H2D AMS-to-nozzle connectivity are not implemented contracts.

The old shared H2D profile's four remembered tray colours have been removed.
The exporter no longer invents inventory entries to reach a requested tray,
silently substitutes a remembered colour, or fills unknown second-unit trays
with copies of one spool. Prior observations of wrong-tray loads remain in the
[devlog](../../DEVLOG.md#2026-09-19--ams-spool-selection-follows-filament-colour);
they do not prove a universal rule that logical filament index equals tray index.

`Manual` (H2D) and `Auto For Flush` (X1) are slicer **filament-to-extruder** mapping
modes. Neither is a
physical AMS tray selection mode. Whether the printer offers manual tray mapping
for SAAM's minimal archive remains an acceptance test, not a promise implied by
either string. H2D uses Manual to preserve the explicitly selected nozzle,
matching the resolved slice in the supplied reference. Optional
`optimal_assignment` is omitted: it is a slicer-generated
physical assignment result, not another spelling of the selected nozzle.

## Startup duplication inventory

This inventory covers both implemented Bambu exporters (which share one writer),
the complete service start/end arrays and every generated package entry. The
CONFIG_BLOCK and project JSON are generated from the **same settings object**.
Numbers with different meanings are intentionally not unified.

| Aspect / authoritative input | All generated repetitions and handling |
|---|---|
| Selected diameter: `setup.nozzleMm` | CONFIG/project `printer_settings_id` and `nozzle_diameter`; plate JSON `nozzle_diameter`; slice `nozzle_diameters`, filament `nozzle_diameter`, nozzle `nozzle_diameter`; H2D both `M620.10 H`, `M1015.4 H`; SAAM job summary. Fixed 0.4 command literals were replaced. |
| Other installed diameter: `bambu.otherNozzleMm` | Other element of CONFIG/project `nozzle_diameter`, slice `nozzle_diameters`, job summary. Never independently defaulted inside each writer. |
| Nozzle side: `setup.tool` + machine `physicalExtruder` | CONFIG/project `filament_map`, `filament_map_2`, `filament_nozzle_map`, `physical_extruder_map`; model/slice `filament_maps`; slice filament `group_id`, nozzle `id`/`extruder_id`; sequence `nozzle_sequence`; H2D `M104 T` and `G151 P`. No profile settings spread can overwrite them. |
| Nozzle type / volume: supported standard hardened contract | CONFIG/project `nozzle_type`, `nozzle_volume_type`; model `filament_volume_maps`; slice `extruder_type`, `nozzle_volume_type`, filament/nozzle `volume_type`. Cardinality follows actual tools or declared filaments. X1 no longer inherits a two-nozzle type list. |
| Logical filament: `bambu.filament` | Both H2D load triplets (one on X1); H2D `M620.6 I`; plate `filament_ids` and `first_extruder` (zero-based); slice filament `id` (one-based), `layer_filament_lists` (zero-based); sequence `sequence` (one-based); job summary. The fixed sequence `[1]` and detector `I0` are removed. |
| Logical list: `bambu.filaments` | CONFIG/project filament IDs, colours, self indices, types, temperatures, diameter, density, flow ratio and maps; model/slice map cardinality. Only the used filament appears as a consumed slice filament and in plate colours. `limit_filament_maps` remains the reference's zero restriction values; it is not a used-filament bit mask. |
| Physical tray intent: `setup.ams` | SAAM job manifest and review summary only. It never manufactures logical entries or changes logical G-code selectors. Dispatch mapping / physical confirmation remains separate. |
| Material / colour | CONFIG/project `filament_type`, `filament_ids`, `filament_colour`; slice `type`, `tray_info_idx`, `color`; plate `filament_colors`; fixed PLA firmware `set_filament_type` stages. UNKNOWN is an intentional transient loading state. Non-PLA output is rejected. |
| Filament diameter / density | Header filament diameter, CONFIG/project filament diameter/density, interpreted extrusion conversion, slice used weight and plate weight. Output constrains 1.75 mm PLA; service feed conversion retains the vendor recipe's 2.4053 constant. |
| Plate: `bambu.plate` | CONFIG/project `curr_bed_type`; plate JSON `bed_type`; H2D object-detection branch `M972 S26` versus `S36 … X1`; final `G29.1` correction; job summary. Initial `G29.1 Z0` resets previous trim. Textured correction is H2D −0.02 / X1 −0.04 mm; smooth stays zero. |
| Bed temperature: `setup.bedC` | All startup `M140`/`M190` working temperatures, body prelude wait, CONFIG/project selected plate temperature and initial-layer temperature. Shutdown and early heater-off `S0` are deliberate stages, not mismatches. |
| Print temperature: `setup.nozzleC` | Startup `M104`/`M109`, H2D `M620.10 P`, wipe `G150 T`, tool-offset `M620.17 S` and `G383* T`, body prelude, CONFIG/project nozzle/initial-layer temperatures. X1 wipe temperature is nozzle minus 20 C. Body process overrides remain explicit later changes. |
| Flush / purge / calibration recipe: pinned output constraints | H2D `M620.10 F/T`, `M620.11 F`, extrusion/prime feeds and `M983.3 F`; X1 `M620.1 F/T` and purge `M109`. H2D uses 25 mm³/s service flow and 240 C flush; X1 21 mm³/s, 240 C feeder flush and a distinct 250 C hot purge stage. These are not the conservative print-body flow limit. |
| Calibration constants that look like nozzle sizes | `M983.3 A0.4`, motor-current `M17 Z0.4`, relative Z moves and prime-line heights stay protocol/recipe constants. They must not follow nozzle diameter. |
| Chamber / air handling | `buildVolumeC` must be zero; CONFIG/project chamber temperatures and service `M141`/`M191` preserve no chamber heating. PLA fans, anti-jam thresholds and air-handling macros remain pinned model-specific recipe stages. X1 bed must remain 46–70 C for its supported fan branch. |
| Calibration / detection policy | One `bambu.startup` policy generates initial flag assignments; later `judge_flag`/`M622`/`M623` blocks consume them. `printer` emits no assignment. Mechanical tests and unconditional checks remain; no blanket fast-start option exists. |
| Probe footprint: placed geometry bounds | H2D both G29 branch rectangles, X1 G29 rectangle, plate bounding boxes and SAAM context. Service-area moves are not object bounds. |
| Motion / extrusion handoff | End of startup and body prelude explicitly establish G90/G21/M83/G92; initial position is checked against machine startup position. These necessary repeats express the same supported modal state. Bambu bodies remain relative extrusion. |
| Shutdown clearance: path maximum + geometry + model limits | Repeated H2D end lifts and park positions; X1 lift, park and settle; envelope summary. No descent below the completed path; rejection if the required clearance exceeds limits. |
| Unloading / heater shutdown | H2D 65535 and 65279 paired M620/T/M621 operations and heaters T0/T1 off; X1 255 triplet and single heater off. These are firmware sentinels and all-tool shutdown, never the selected logical filament. |
| Object / layer identity and counts | Header layer total, CONFIG/project nominal layer heights, slice layer ranges, plate object ID/height, fresh SAAM object names. No reference object's geometry, filename or totals are copied. |
| Print totals / packaging integrity | Header interpreted filament/volume, slice consumed filament/weight/prediction, regenerated thumbnails, code MD5 and ZIP CRCs. These cover print body only, not firmware service material/time. SAAM release metadata is distinct from the loader's required Bambu client-version field. |

## The program carries its own configuration

The G-code contains a CONFIG_BLOCK as well as project JSON. A comment block is
not harmless decoration: printer validation may consume it. Most arrays use
commas; colour, IDs, type and extruder AMS count use semicolons. The writer has
one serializer, not independent header and archive settings builders.

Machine `package.projectSettings` must be empty; it cannot override generated job
fields. Shared profiles carry no installation-specific AMS inventory
or topology. No raw startup G-code override is supported. Envelope hashes bind
start, end **and constraints**, so changing a fixed service recipe requires an
intentional new contract.

Import re-derives the job, header, service blocks and every package entry and
compares them with the actual bytes. An inconsistent archive, changed plan,
unknown service envelope, checksum mismatch or metadata edit is rejected.
The same-file review/delivery lifecycle remains unchanged.

## H2D output contract

`h2d-saam-startup-v4`: one standard hardened 0.4, 0.6 or 0.8 mm nozzle;
1.75 mm PLA; Textured or Smooth PEI; no chamber heating. Startup establishes
[100,100,20]. Shutdown clears geometry by 10 mm and parks at or below 320 mm.
Firmware service flow is independent of print-body flow and can reach 25 mm³/s.

This revision fixes parameter synchronization and introduces explicit plate and
startup flag choices. It retains the preceding sequence's deliberate omission
of the early H10 homing/wipe block. It does **not** establish that omitting that
block is valid from every cold-start machine state. Cold-start homing, service
clearance and both-nozzle calibration require physical acceptance. Do not remove
more homing or pretend playback verifies those moves.

Earlier user-reported successful left-nozzle PLA output is historical evidence
for that earlier program, not physical validation of this revision or every
mixed-nozzle/AMS configuration. See the
[dated record](../../DEVLOG.md#2026-09-18--x1-carbon-output-through-the-shared-bambu-exporter).

## X1 Carbon output contract

`x1c-saam-startup-v2`: one standard hardened 0.4 mm nozzle; 1.75 mm PLA;
Textured or Smooth PEI; bed 46–70 C; no chamber heating. It retains homing,
wiping, front-edge purge/calibration lines, mechanical checks and first-layer
scan registration. Shutdown clears by 0.5 mm, parks up to 250 mm and settles
without descending below clearance. Other nozzle sizes/materials are not output
contracts even if the machine could physically support them.

The loader's `X-BBL-Client-Version` remains `02.08.02.61`; SAAM is identified
separately. The earlier loader failure with a SAAM-formatted client version and
the manual-AMS-mapping warning are recorded in the
[devlog](../../DEVLOG.md#2026-09-18--x1-carbon-output-through-the-shared-bambu-exporter).
Changing a mapping-mode string has not been proven to resolve the warning.

## Evidence and verification tools

Read a vendor or SAAM sliced archive without extracting files or copying headers:

```sh
node scripts/bambu-audit.mjs path/to/reference.gcode.3mf
node scripts/bambu-audit.mjs path/to/reference.gcode.3mf path/to/saam.gcode.3mf
```

The report includes archive SHA-256, relevant project/config fields, duplicate
configuration keys, numbered
startup/service commands, plate metadata, slice/model metadata and sequence.
It reports observed facts; it does not claim a firmware protocol or physical
safety verdict. Raw vendor G-code without an archive is not accepted by this tool.

The supplied `twistedbox.gcode.3mf` (SHA-256
`3a0cf2396c1f05862945ca740bd2e3f8cd7545d9947a3bf68a28adab97fc2459`)
declares 0.8/0.8 in its slice even though the user reports actual left 0.4 / right
0.8, with one four-slot AMS attached to the right nozzle. These are distinct
evidence: SAAM must describe the reported hardware. This reference establishes
right-tool heater 0, map 2, nozzle ID 1, map_2 1, logical filament 0, H0.8 in both
flush descriptors and air-print detection, and fixed A0.4 in calibration. Its
saved project preferences (left/automatic) differ from the resolved slice
(right/manual); those are legitimate stages, not settings to copy over our job.
Its 30 mm³/s service recipe also differs from SAAM's pinned 25 mm³/s recipe.

Using both different-diameter nozzles within one job is an explicit requirement,
not a Bambu Studio limitation to inherit. It is not yet implemented by the
single-tool path contract. It requires per-operation tool/process selection,
validated changeover/retraction/temperature state and clearance, per-tool
extrusion interpretation, and layer/filament usage generated from actual actions.
A both-nozzle reference has been requested for changeover protocol facts; no
unequal-nozzle prohibition should be introduced.

The implementation was cross-referenced against installed Bambu Studio H2D and
X1 template expressions (including H/nozzle, fixed A0.4, plate branches and
logical filament variables), the existing X1 Studio cube archive, and primary
[Bambu format source](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp),
[configuration definitions](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/PrintConfig.cpp),
[filament/extruder mapping](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Print.cpp)
and [sequence generation](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/GCode.cpp).
Current upstream source is supplementary evidence, not proof that every installed
firmware implements it. Controlled exports remain necessary to settle mixed-nozzle
preference/variant mappings, exact minimal AMS package requirements and dispatch.

Tests exercise both H2D sides, 0.4/0.6/0.8, a distinct other nozzle, both plates,
nonzero logical filament, independent physical tray intent, temperatures, startup
controls, contradictory setup, override rejection, archive tampering and normal
Studio review/delivery. Round-trip checks alone are insufficient: assertions also
inspect actual emitted commands and every relevant independent archive surface.
Firmware service moves are not simulated; playback and timing cover the body.
