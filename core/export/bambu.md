# Bambu H2D and X1 Carbon output

SAAM authors its job description, G-code configuration comments and sliced-3MF
metadata. [resolveBambuJob](bambu-job.mjs) resolves that description once for each
export or import; [bambu.mjs](bambu.mjs) projects it into every repeated field.
Machine files own bounded firmware service sequences. Reference exports are
comparison evidence, never package/header/thumbnail templates to copy into a job.

Output remains experimental. A consistent archive proves neither firmware
compatibility nor that the requested AMS tray is physically connected or loaded.
An explicitly correct USB mapping screen has still produced a wrong physical
feed in testing. Screen confirmation is necessary review evidence, not physical
acceptance. Verify the actual loaded filament and selected nozzle.
The X1 three-colour test also failed: the printer rejected manual AMS mapping
and printed all bands in grey despite two material-change command blocks.
H2D DUAL-12-PROJECT-CONTROL physically passed left/right/left with left 0.4,
right 0.8, left external PLA and right AMS blue PLA. AMS-10 passed right-nozzle
colour switching. Both used the same successful reference project entry; these
are physical command/installation results, not acceptance of the reusable
project writer. X1 AMS changes remain unaccepted.
The current v13 writer stores its own rendered startup and shutdown in the
project fields, using the exact same strings as the executable. Fresh AMS-19
and DUAL-20 pass software validation but await physical acceptance. AMS-14
(routing changes) and AMS-15 (Standard-only variant tables) physically passed
as independent reductions of the working reference project. Those results do
not prove that every other authored project field is compatible.
The H2D investigation also found a pinched left-feed PTFE tube. The untouched
Studio left-only reference prints correctly. After that repair, full-04 completes
its motions but still prints entirely with the right nozzle at elevated height.
Fast-05, including restored early homing, has the same physical failure. Neither
the missing early homing block nor the obstruction explains all observations.
The working left-only reference also prints correctly when repacked by SAAM and
when its G-code producer marker and 3MF Application identity are replaced.
Those container/identification changes alone do not explain the H2D failure.
In a subsequent controlled pair, the full reference configuration printed
correctly while reducing/reordering CONFIG and project fields to SAAM's current
field set reproduced the wrong right nozzle and elevated height. The two files
had byte-identical executable commands and the same shortened startup. This
isolates the changed configuration surfaces in that comparison; the responsible
field remains unresolved. Alphabetizing the same reduced configuration also
failed. Subsequent physical controls isolate project JSON: full project settings
with the minimal 40-entry G-code CONFIG print correctly; full G-code CONFIG with
minimal project settings fails. Correct G-code comments cannot compensate for
this project-settings omission. No individual key or firmware entry-count
requirement is established. AMS-09 subsequently changed colours successfully
with SAAM's same-nozzle commands and the complete reference project entry.
It declared 0.8/0.8. AMS-10 retains its executable commands and changes only
left-diameter declarations to 0.4; the user confirms it works. Mixed installed
diameters therefore do not prevent this same-nozzle colour job. The authored
v12 project writer failed its AMS-11 acceptance test: the user reports the
whole part is orange. The shared multicolour exporter remains unresolved;
the reusable dual-nozzle package writer remains open despite DUAL-12's success.
The outstanding reference and hardware checks are tracked in
[BR-055](../../build_request.md#br-055--express-plate-choice-and-close-the-ams-package-gap).

## Maker setup

The current user's installation is a test case, not a shared machine default:
H2D left 0.4 mm fed by an external spool, right 0.8 mm fed by a four-slot AMS.
The development goal covers every feed combination supported by each machine.
Keep logical filaments, nozzle assignments, installed diameters, feed devices,
their connections and physical slot choices independent. Discover or ask for
installation facts for each job; never infer them from this example or its colours.
Machine capabilities constrain valid combinations; an unimplemented adapter must
report its limit instead of silently routing through a different source. Physical
dispatch remains delegated to the printer; declared capacities are described below.

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
  "ams": null,
  "bambu": {
    "plate": "textured_plate",
    "otherNozzleMm": 0.4,
    "amsConnections": [{"unit": 1, "tool": 1}],
    "filaments": [{"id": "GFA01", "colour": "#8B5A2B", "tool": 1, "source": {"type": "auto"}}],
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

For repeat tests on an already calibrated, unchanged installation, set
`setup.bambu.fast_start: true` on either H2D or X1 Carbon. This reusable option
defaults to false and appears in Studio's recipe review and the job manifest.
It sets the supported leveling/flow/plate/tool-offset flags to off, omits startup
music and vibration tests, and omits the selected model's optional camera/lidar
checks. An explicit `startup` choice of `on` conflicts with fast start and is
rejected; set `fast_start: false` when those checks are wanted. Printer-mode
choices do not override fast start. Calibration blocks can remain in the text
behind disabled firmware flags; their presence is not an instruction to run them.

Fast start retains homing/Z registration, saved compensation, bed/nozzle heating
and waits, filament loading, cleaning, priming and the explicit body handoff.
Use full startup after changes that require calibration, rather than treating
fast start as a cold-machine commissioning sequence. It never removes necessary
temperature waits to make a stalled print appear to proceed. Service durations
are not simulated; no measured startup-time saving is claimed yet.

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

Each explicit filament entry may include `tool` (the logical nozzle index).
For example, `[{"id":"GFA00","colour":"#00AE42","tool":1},
{"id":"GFA00","colour":"#FFFF00","tool":0}]` keeps the green and yellow
entries on different nozzles across every generated mapping. An omitted `tool`
uses `setup.tool` for compatibility with existing single-tool jobs. The selected
entry must agree with `setup.tool`; contradictory declarations are rejected.
Assign `composition.regions[].filament` to use a logical filament for that
region. An omitted assignment uses `bambu.filament`, which is the startup
selection. H2D can use both nozzles with different installed diameters in one
program. X1 supports regional PLA changes through its single 0.4 mm nozzle and
AMS, with a bounded rear-chute flush. H2D also implements same-nozzle PLA changes
through AMS. AMS-09 physically verified those same-nozzle commands with the
reference project entry. The reusable v12 project writer failed AMS-11 (all
orange); do not represent its colour changes as physically working.

The normal source is `{ "type": "auto" }`: supply material preset ID and colour
and let the printer propose a physical feed match. Do not ask for a slot just
because the print uses an AMS. `{ "type": "external" }` records external-spool
intent. An optional `{ "type": "ams", "unit": 1, "slot": 4 }` requests a
particular four-slot unit/tray. `{ "type": "ams-ht", "unit": 1 }` requests
one single-slot AMS HT device without inventing a four-slot tray index.
These remain dispatch intentions; the archive
does not itself guarantee the printer's physical mapping. `setup.ams` is the
legacy request for the startup filament only; use null for automatic selection.
An explicit source and a non-null legacy request must agree.
In particular, `source: external` currently reaches SAAM's manifest/review only;
there is no implemented printer-consumed field that forces the USB screen to
preselect external. Do not promise automatic external selection from this value.
Zero AMS connection counts describe topology, not that filament's launch route.
`default_ams_type` is Studio's load/unload timing enum, not a feed selector.

### A mixed-nozzle recipe

For the reported left 0.4 / right 0.8 installation, set the startup setup to
left 0.4, 215 C, `ams: null`, and `otherNozzleMm: 0.8`. The base process must
match that initial filament. Merge this logical list into `setup.bambu`:

```json
{
  "filament": 0,
  "amsConnections": [{"unit": 1, "tool": 1}],
  "filaments": [
    {"id": "GFA00", "colour": "#FFFF00", "tool": 0, "source": {"type": "external"}},
    {"id": "GFA00", "colour": "#00AE42", "tool": 1, "source": {"type": "auto"},
     "nozzleC": 225,
     "process": {"lineWidthMm": 0.8, "firstLayerMm": 0.3, "layerMm": 0.3}}
  ]
}
```

These colours, temperatures and process values are examples to review, not
observed spool inventory or material recommendations. Assign the left part's
region `filament: 0`, the right part's `filament: 1`. The ordinary assembly and
region fields remain required. A filament's optional process overrides are
`firstLayerMm`, `layerMm`, `lineWidthMm`, `planarSpeedMmS`, `skinSpeedMmS`,
`firstLayerSpeedMmS`, `maxFlowMm3S`, `retractMm`, and `retractSpeedMmS`.
The startup entry's explicit overrides must equal the base setup/process;
contradictions fail rather than silently choosing one declaration. Each region
can further override its documented layer/bead settings. Nozzle diameter stays
an installation setting, not a region override. Review both filaments and the
region assignments in Studio. Source playback labels the active nozzle and
uses its filament colour and commanded bead width.

The composer retracts the outgoing nozzle, lifts at least 3 mm above deposited
material and moves into the common nozzle area before requesting a change.
Each nozzle keeps its own retraction state. The authored tower-free service
recipe loads the incoming logical filament, waits for its print temperature,
restores body acceleration/fan/modes and returns to the checked handoff position.
Layer identities, nozzle records, material quantities and usage sequence come
from actual actions. The two nozzle grids need not share layer height or width.
There is no prime tower. One logical filament per used nozzle is supported;
switching materials inside one nozzle needs a separate flushing contract and
is rejected. Firmware service moves, purged material, heating time, automatic
standby cooling and power-loss recovery are not modeled or physically validated.
Do not infer recovery support or a cold parked nozzle from this implementation.

`bambu.amsConnections` is null when connectivity is unknown, or the installation's
list of `{unit, tool}` connections for four-slot AMS/AMS 2 Pro units, or
`{type: "ams-ht", unit, tool}` for single-slot HT units. The two device types
have separate one-based unit-number spaces; these are installation labels, not
firmware tray IDs. For the user-reported H2D, four-slot unit 1 connects to
tool 1 (right). A requested AMS unit that cannot feed the selected nozzle is
rejected when connections are declared. This prevents treating an attached AMS
as available to both nozzles. An empty list means no AMS units are connected.
Connection counts generate `extruder_ams_count` per logical nozzle:
`1#<HT count>|4#<four-slot count>`. `1#0|4#1` matches the supplied right-connected
H2D reference. A device cannot be assigned to both nozzles simultaneously.
The field describes counts, not unit IDs or a firmware routing command.
Unknown connectivity omits this field; an empty list declares zero counts.
H2D capacity is four four-slot units and eight HT units, independently assigned
to either nozzle, following the manufacturer's
[H2D capacity specification](https://eu.store.bambulab.com/products/h2d).
The X1 adapter allows up to four connected devices total, including up to four
HT units; the manufacturer's [AMS HT FAQ](https://asia.store.bambulab.com/collections/bambu-lab-ams/products/ams-ht)
confirms four HT connections. Mixed X1 topologies beyond that conservative
four-device total are not established here. Metadata count serialization follows
[Studio's count parser/writer](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/PrintConfig.cpp).
These are software capacity/metadata contracts, not physical tests of all units.
An HT used only as a dryer through its manual bypass is an external feed for
this purpose. Do not declare it as an automatically connected HT feed.

`setup.ams` is validated against the profile's unit/slot capacity and recorded in
`Metadata/saam-job.json` and the interpreted program's job summary. **It does not
force a tray through G-code.** SAAM has no implemented printer-dispatch mapping
adapter. Confirm the job filament-to-tray mapping on the printer before starting;
if the intended mapping cannot be selected, stop and record that failure. Colour
and material are matching hints, not proof of the selected spool. External-spool
intent and declared AMS-to-nozzle connections are validated and reviewable;
forcing those physical routes through a dispatch adapter is not implemented.

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
CONFIG_BLOCK and project JSON derive job fields from the **same resolved job**.
H2D project JSON additionally expands explicit compatibility-field scopes through
[the project writer](bambu-project.mjs); its field vocabulary/defaults are
cross-referenced to Studio 02.08.02.61. It contains no vendor executable templates or
reference part data. Stored `machine_start_gcode` and `machine_end_gcode` receive
the very same rendered strings as the executable start and end; the strict
importer reconstructs both and rejects any discrepancy. Arrays follow declared filaments, physical tools or supported
variants; the reference's unused filament and High Flow variants are not retained.
`filament_map_2` belongs to the resolved slice CONFIG, not the saved H2D project.
Numbers with different meanings are intentionally not unified.

| Aspect / authoritative input | All generated repetitions and handling |
|---|---|
| Selected diameter: `setup.nozzleMm` | CONFIG/project `printer_settings_id` and `nozzle_diameter`; plate JSON `nozzle_diameter`; slice `nozzle_diameters`, filament `nozzle_diameter`, nozzle `nozzle_diameter`; H2D both `M620.10 H`, `M1015.4 H`; SAAM job summary. Fixed 0.4 command literals were replaced. |
| Other installed diameter: `bambu.otherNozzleMm` | Other element of CONFIG/project `nozzle_diameter`, slice `nozzle_diameters`, job summary; when used, its own filament/nozzle records and changeover H values. Never independently defaulted inside each writer. |
| Nozzle side: `setup.tool`, each `bambu.filaments[].tool` + machine `physicalExtruder` | CONFIG/project `filament_map`, `filament_nozzle_map`, `physical_extruder_map`; slice CONFIG `filament_map_2`; model/slice `filament_maps`; slice filament `group_id`, nozzle `id`/`extruder_id`; sequence `nozzle_sequence`; H2D `M104 T` and `G151 P`. The selected filament must agree with setup.tool. No profile settings spread can overwrite them. |
| Nozzle type / volume: supported standard hardened contract | CONFIG/project `nozzle_type`, `nozzle_volume_type`; model `filament_volume_maps`; slice `extruder_type`, `nozzle_volume_type`, filament/nozzle `volume_type`. Cardinality follows actual tools or declared filaments. X1 no longer inherits a two-nozzle type list. |
| Logical filament: `bambu.filament` and interpreted usage | Both H2D load triplets (one on X1); H2D `M620.6 I`; header `filament` (comma-separated one-based IDs, **never a count**); plate `filament_ids` and `first_extruder` (zero-based); slice filament `id` (one-based), `layer_filament_lists` (zero-based); sequence `sequence` (one-based); job summary. |
| Logical list: `bambu.filaments` | CONFIG/project filament IDs, colours, self indices, types, temperatures, diameter, density, flow ratio and maps; model/slice map cardinality. Only actually consumed filaments appear in consumed slice records and plate colours. `limit_filament_maps` remains the reference's zero restriction values; it is not a used-filament bit mask. |
| Feed intent: `filaments[].source`, legacy `setup.ams` | SAAM job manifest and review summary only: auto/external or an optional AMS unit/slot. It never manufactures logical entries or changes logical G-code selectors. Dispatch mapping / physical confirmation remains separate. |
| Material / colour | CONFIG/project `filament_type`, `filament_ids`, `filament_colour`; slice `type`, `tray_info_idx`, `color`; plate `filament_colors`; fixed PLA firmware `set_filament_type` stages. UNKNOWN is an intentional transient loading state. Non-PLA output is rejected. |
| Filament diameter / density | Header filament diameter, CONFIG/project filament diameter/density, interpreted extrusion conversion, slice used weight and plate weight. Output constrains 1.75 mm PLA; service feed conversion retains the vendor recipe's 2.4053 constant. |
| Plate: `bambu.plate` | CONFIG/project `curr_bed_type`; plate JSON `bed_type`; H2D object-detection branch `M972 S26` versus `S36 … X1`; final `G29.1` correction; job summary. Initial `G29.1 Z0` resets previous trim. Textured correction is H2D −0.02 / X1 −0.04 mm; smooth stays zero. |
| Bed temperature: `setup.bedC` | All startup `M140`/`M190` working temperatures, body prelude wait, CONFIG/project selected plate temperature and initial-layer temperature. Shutdown and early heater-off `S0` are deliberate stages, not mismatches. |
| Print temperature: `setup.nozzleC`, optional `filaments[].nozzleC` | Startup uses the initial selection in `M104`/`M109`, H2D `M620.10 P`, wipe `G150 T` and initial tool-offset `G383* T/L`. Both `M620.17 T/S/L` branches derive each physical extruder's first actually used logical filament and its temperature from the ordered path, with declared filament 0 as the vendor fallback for an unused nozzle. Physical T0 is right, T1 left on H2D; these are not nozzle-group indices. Each body segment/changeover uses its own filament target; CONFIG/project temperature arrays follow the same selections. X1 wipe temperature is nozzle minus 20 C. Body process overrides remain explicit later changes. |
| Flush / purge / calibration recipe: pinned output constraints | H2D `M620.10 F/T`, `M620.11 F`, extrusion/prime feeds and `M983.3 F`; X1 `M620.1 F/T` and purge `M109`. H2D uses 25 mm³/s service flow and 240 C flush; X1 21 mm³/s, 240 C feeder flush and a distinct 250 C hot purge stage. These are not the conservative print-body flow limit. |
| Calibration constants that look like nozzle sizes | `M983.3 A0.4`, motor-current `M17 Z0.4`, relative Z moves and prime-line heights stay protocol/recipe constants. They must not follow nozzle diameter. |
| Chamber / air handling | `buildVolumeC` must be zero; CONFIG/project chamber temperatures and service `M141`/`M191` preserve no chamber heating. PLA fans, anti-jam thresholds and air-handling macros remain pinned model-specific recipe stages. X1 bed must remain 46–70 C for its supported fan branch. |
| Calibration / detection policy | `bambu.fast_start` and `bambu.startup` resolve together. Fast mode emits supported flags off and omits machine-owned `fullStartOnly` blocks; explicit `on` conflicts fail. Full mode retains the complete sequence and `printer` emits no flag assignment. The same fast-mode value drives code, job manifest and review summary. |
| Probe footprint: placed geometry bounds | H2D both G29 branch rectangles, X1 G29 rectangle, plate bounding boxes and SAAM context. Service-area moves are not object bounds. |
| Motion / extrusion handoff | End of startup and body prelude explicitly establish G90/G21/M83/G92; initial position is checked against machine startup position. These necessary repeats express the same supported modal state. Bambu bodies remain relative extrusion. |
| Shutdown clearance: path maximum + geometry + model limits | Repeated H2D end lifts and park positions; X1 lift, park and settle; envelope summary. No descent below the completed path; rejection if the required clearance exceeds limits. |
| Unloading / heater shutdown | H2D 65535 and 65279 paired M620/T/M621 operations and heaters T0/T1 off; X1 255 triplet and single heater off. These are firmware sentinels and all-tool shutdown, never the selected logical filament. |
| Object / layer identity and counts | Header layer total, CONFIG/project nominal layer heights, slice layer ranges, plate object ID/height, fresh SAAM object names. No reference object's geometry, filename or totals are copied. |
| Mixed-nozzle scalar defaults | CONFIG/project printer preset name and nominal layer heights, plate scalar nozzle/layer height describe the startup/default process. Per-nozzle arrays, consumed filament records, source moves and layer-use lists describe both actual processes. A scalar must not be copied over those arrays. |
| Print totals / packaging integrity | Header ID list, per-used-filament length/volume/weight/diameter/density arrays in ascending logical-ID order, slice consumed filament/weight/prediction, regenerated thumbnails, code MD5 and ZIP CRCs. These cover print body only, not firmware service material/time. SAAM release metadata is distinct from the loader's required Bambu client-version field. |

### Additional repetitions during H2D tool changes

These repetitions are emitted by the authored H2D changeover recipe. The
equal-diameter reference must not obscure which side owns each value:

| Repetition | Authoritative source |
|---|---|
| `M620.10 A0 H/F/T/P` | Outgoing nozzle diameter, outgoing filament's service flow/flush temperature and outgoing print temperature. At initial startup both descriptors describe the initially selected nozzle. |
| `M620.10 A1 H/F/T/P` | Incoming nozzle diameter, incoming filament's service flow/flush temperature and incoming print temperature. A0 and A1 **must differ** when the installed diameters differ. |
| `M620 S`, ordinary `T`, `M621 S`, `M620.6 I` | Incoming logical filament index; derive its nozzle from the job mapping, not the same integer. Service/unload T sentinels remain separate. |
| `M620.11 I` in outgoing cut/retraction descriptors | Outgoing logical filament index. Its hotend selector and retraction parameters are separate facts; they are not the incoming selector or a physical tray number. |
| `M1015.4 H` after switching | Incoming nozzle diameter. Detector enable policy also depends on material. |
| `M620.10 R` and repeated `M983.3 R` | Incoming extruder's current retraction state. The reference first activation uses R0 and later returns R2; neither is a universal constant. `M983.3 A0.4` remains a calibration constant. |
| Cooling/preheat and `M620.15 C` | Current/incoming thermal state and selected preparation policy. The installed template subtracts `filament_cooling_before_tower` from the new temperature; the tower reference contains C220 then C210 despite both print targets being 220. Do not inherit that subtraction for a tower-free job. |
| Sequence, per-layer filament lists, consumed material and nozzle records | Actual ordered tool/filament use in the interpreted program, including both nozzle diameters independently. Counts must not come from number of declared filaments alone. |
| Service clearance and return position | Current deposited height, machine/tool limits and the planned next action. Tower-associated approach, prime and return positions are not a reusable generic switch path. |
| `M620.10 R`, `M983.3 R`, body recovery | Interpreted incoming nozzle withdrawal debt: zero before its first use, then its own configured retract amount. Outgoing debt must equal the outgoing retract setting before changing. |
| Changeover `M983.3 F` | Incoming filament's configured `maxFlowMm3S / 2.4`, a conservative calibration rate; startup retains the separate pinned 25 mm³/s service recipe. Neither calibration A0.4 nor these phase-specific rates are nozzle diameter overrides. |
| `M620.11 B` and `M620 Q` | Same-nozzle colour changes retain remapped B-1 for all outgoing descriptors. Cross-nozzle changes use previous logical hotend state (-1 on first change, then outgoing tool 0/1). Q is ordered change count plus initial load. These are not physical heater selectors. |
| `M204`, fan and modal restoration | Pinned service/body acceleration, interpreted fan state and explicit G90/G21/M83/G92 plus the incoming temperature wait. Acceleration returns to the same profile value used by startup. |

The user explicitly excluded prime-tower implementation from this work. Keep
tower geometry, extrusion and tower-specific cooling/return policy out of the
new writer. The subsequent tower-free reference below isolates those differences;
it does not establish physical priming quality or clearance on the actual printer.

## Making an H2D dual-nozzle print

The physical DUAL-12 control passed with left 0.4/right 0.8 and a return to the
left nozzle. The shared planner and executable writer can express this job.
**The current generated project metadata is still unresolved:** AMS-11 failed,
and DUAL-12 succeeded with a reference project entry substituted. A maker must
not advertise arbitrary generated jobs as hardware-verified or copy that entry
into another job. Use the setup/review workflow below when the project writer
has passed generated-file acceptance; current hardware experiments remain
builder/developer work. The fact-only hardware fixture and executable regression
test preserve the successful command sequence without a reference dependency.

1. Establish the machine and installation: left and right diameters, plate,
   materials, nozzle temperatures, feed devices and which nozzle each device
   connects to. `tool: 0` is left and `tool: 1` is right. These are not physical
   heater selectors or AMS slots. The tested external-left/AMS-right combination
   is an example, not a required topology.
2. Set the starting filament's `setup.tool`, `nozzleMm`, matching `core`,
   `nozzleC` and global process. `bambu.otherNozzleMm` describes the other side.
   Declare each logical filament once, with its `tool`, material ID, colour and
   source. Set per-filament `nozzleC` and process overrides for a different
   nozzle/process. Same-nozzle colours can share a tool; different tools do not
   have to share a diameter or layer grid.
3. Assign each part/region its logical `filament` index. `bambu.filament` selects
   the initial entry, which must agree with `setup.tool`. Reuse that entry when
   returning to the original material/nozzle. Do not express a physical nozzle
   switch by changing temperatures or by adding raw G-code.
4. Generate using the current profile and normal print tools. Review the part
   placement, selected nozzle and bead dimensions per region, first-layer
   heights, order of actual changes and clearance. Each nozzle must stay within
   its own print area. No prime tower is implemented. Fast start is optional
   for a calibrated, unchanged installation; it retains homing and required
   loading, heating, wiping and priming.
5. At USB launch, confirm intended feeds. For the tested example, explicitly
   select left external PLA and map right blue to its actual AMS filament;
   the printer's initial left suggestion may be incorrect. Automatic matching
   needs material/colour, not an invented physical slot number. Observe actual
   nozzle selection and deposition height, including a return switch. Record
   the archive hash and human result; playback verifies commands, not firmware.

Example filament settings for a **left-first** recipe (merge with the complete
plan, keeping `setup.tool: 0`, `nozzleMm: 0.4`, `core: "Hardened steel 0.4"`,
`nozzleC: 215`, line width 0.4 and first/subsequent layers 0.2):

```json
{
  "plate": "textured_plate",
  "otherNozzleMm": 0.8,
  "filament": 0,
  "amsConnections": [{"unit": 1, "tool": 1}],
  "filaments": [
    {"id": "GFA00", "colour": "#808080", "tool": 0, "source": {"type": "external"}},
    {"id": "GFA00", "colour": "#0000FF", "tool": 1, "source": {"type": "auto"},
     "nozzleC": 225, "process": {"lineWidthMm": 0.8, "firstLayerMm": 0.3, "layerMm": 0.3}}
  ]
}
```

This is `setup.bambu` input, not a complete plan. Colours, PLA Basic IDs,
temperatures and the unit number are example values; confirm the actual job.
For independent STLs, put them in separate assembly parts and assign each
part's region to the corresponding filament. For different patterns in one
part, use the normal regional composition and support/dependency rules.
Neither workflow requires Bambu Studio to slice unequal diameters.

## Making an H2D two-colour print

1. Establish the actual installed diameters, selected nozzle, plate, PLA identities
   and colours. Set `setup.tool`, `nozzleMm`, matching `core`, temperature and
   `bambu.otherNozzleMm`; do not substitute equal diameters to match a reference.
2. Declare two `setup.bambu.filaments` entries with the **same tool**, their actual
   material IDs/colours and `source: {"type":"auto"}`. Leave `setup.ams` null for
   automatic matching. Declare known AMS connections independently. A colour is
   not a slot number; `GFA00` is PLA Basic, not an arbitrary PLA identity.
3. Set startup `bambu.filament: 0`, and assign regions to filament indices
   `0, 1, 0` for colour A → B → A. Use the existing region/path workflow for the
   desired part. The return to A reuses its entry. Both colour-change feeds must
   be AMS feeds; external-spool automatic colour changes are rejected.
4. Generate with the current machine profile through normal print tools. Existing
   bundles pin their profiles: create a fresh bundle or explicitly update the
   profile through the supported workflow when testing this exporter revision.
   Review geometry, first-layer Z, colours and both change boundaries in Studio.
   For repeat tests on calibrated hardware, `bambu.fast_start: true` is available.
   No prime tower is generated.
5. Deliver the reviewed archive unchanged. Confirm the printer's material/colour
   mapping, then observe actual A → B → A switching and first-layer contact.
   An on-screen mapping alone does not prove physical switching. Record the
   exact archive hash and observation before reporting hardware acceptance.

Do not transplant a Studio project entry or hand-edit exported metadata. The
exporter derives job declarations from the plan and rejects package overrides.
The successful AMS-09 control is evidence for the service commands; it is not
a reusable maker file. The v12 generated-project test failed: AMS-11 printed
entirely orange. This workflow currently supports controlled development tests,
not a verified multicolour delivery. Explain that limitation and escalate shared
exporter investigation to a builder/developer; do not transplant the control
entry as a maker workaround. DUAL-12 demonstrated physical H2D nozzle changes
using the successful reference project; portable metadata and X1 AMS acceptance
remain separate outstanding work.

## The program carries its own configuration

The G-code contains a CONFIG_BLOCK as well as project JSON. A comment block is
not harmless decoration: printer validation may consume it. Most arrays use
commas; colour, IDs, type and extruder AMS count use semicolons. The writer has
one canonical job, with format-specific CONFIG and project serializers.

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

`h2d-saam-startup-v13`: one or both standard hardened 0.4, 0.6 or 0.8 mm nozzles,
including unequal diameters;
1.75 mm PLA; Textured or Smooth PEI; no chamber heating. Startup establishes
[100,100,20]. Shutdown clears geometry by 10 mm and parks at or below 320 mm.
Firmware service flow is independent of print-body flow and can reach 25 mm³/s.

Revision v9 restored initial X homing, wipe/park and Z registration before
the first remapped material load, including in fast mode. These operations were
absent from full-04 as well as the preceding fast tests. The working Studio
left-only reference provides the command/order evidence. Later bed leveling
and front-edge purge registration do not replace this initial sequence in the
authored contract. Service clearance and both-nozzle calibration still require
physical acceptance; playback does not verify firmware service motions.

Revision v10 adds tower-free same-nozzle PLA material changes. Assign distinct
logical filaments to the same `tool` and assign them to successive regions.
For blue → orange → blue, declare two filaments and use regional indices 0, 1,
0; do not declare a third filament for the return to blue. Both sources must
use AMS (automatic matching is supported); automatic external-spool changes
are rejected. This capability works through the common regional planner,
exporter and source player on either H2D nozzle, with machine-area checks.

The H2D recipe requests the profile's `materialChangeFlushMm3` (300 mm³) once
per same-nozzle change. Divide this by the filament cross-sectional area to
derive the identical `M620.10 A0/A1 L` filament lengths. Both are descriptors
of one firmware flush, not two purge extrusions. The installed H2D change
template and upstream [GCode.cpp](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/GCode.cpp)
establish the length units. No additional explicit G1 E flush is emitted.
`SYNC T` follows the descriptor length; v11 adds thermal timing derived from
the flush/print temperature difference and the profile's 2 C/s cooling and
3.6 C/s heating rates, cross-referenced to the same-nozzle export. An explicit
incoming-temperature wait precedes resuming body moves. Chute flush quantity is an experimental fixed
PLA policy, not guaranteed colour purity. Firmware priming and service time
are excluded from body totals. The planner/player establish the incoming
filament's retraction debt afresh after each material change, including reuse
of a previously selected logical filament. Dual-nozzle changes retain zero
colour-flush length and do not increment the same-nozzle flush count.

Revision v13 adds authored stored startup and shutdown to the project writer.
`sections()` renders each once from the canonical job and print bounds, then
the executable and project materializer receive the same strings. Fast/full
startup, installed nozzles, plate, temperatures and shutdown clearance cannot
drift between those copies. No reference file is required at export time.
The other stored G-code fields remain empty; whether these two populated fields
are sufficient is the physical acceptance question for AMS-19 and DUAL-20.
Both normal bundles reopen through the strict importer, and executable hashes
match physically successful AMS-10 and DUAL-12 respectively. This is an
implemented repair candidate, not yet a physically accepted exporter.

Revision v12 introduced the authored H2D project writer. Canonical job values override
compatibility defaults, including colours, material identities, connections,
temperatures, plate, both diameters and all nozzle assignments. It emits only
Standard variants, disables tower fields and leaves all executable-template
fields empty. JSON uses four-space indentation and CRLF, matching the successful
control's representation. X1 retains its existing project format. These changes
are covered by software checks, but AMS-11 physically failed colour changes
(all orange) with byte-identical executable commands to working AMS-10. No individual missing field or formatting rule has
been proven responsible. The executable startup/change service is unchanged
from v11; the B-selector change alone did not fix the failure.

The supplied `twocolor.twistedbox.gcode.3mf` (SHA-256
`c0905ff8957f685282ba66d0795765a016d2c95246ad99183989a6600fdf5127`)
contains 62 same-nozzle changes through right nozzle 1, all retaining outgoing
`M620.11 B-1` as well as incoming `T H-1`. v11 uses that remapped outgoing
selector for each same-nozzle change, including returning to a used filament.
The reference has a tower and green/yellow declarations; neither its tower
nor its colours, unused third filament, 0.8/0.8 declarations, header or project
blob becomes an exporter template. Its first flush length is 112.253 mm;
SAAM independently requests 300 mm³, or 124.72551 mm of 1.75 mm filament.
The reference's thermal sync uses 240→220 C (10 and 5.55556); the 225 C test
uses 7.5 and 4.16667. Those command observations are not physical acceptance.

Hardware status: the Studio reference prints both colours; both SAAM AMS-08
diameter variants completed entirely in orange. AMS-09 then changed colours
successfully after replacing only the failed ALT's project_settings.config with
the reference entry, keeping every other entry and executable command fixed.
That diagnostic's foreign configuration does not pass the strict importer and
must not become a maker template. It establishes a sufficient project
representation for that job, not a particular missing key; field values and
serialization also differ. AMS-10 also passed with left 0.4 / right 0.8
declarations and those same commands. Neither test exercises both nozzles.
AMS-11-L04-R08 failed (all orange). Its executable commands matched AMS-10
exactly; generated project values differed in 264 fields. The next controls
start independently from working AMS-10: empty stored executable templates,
change only saved routing, or remove unused High Flow variant rows. A revised
DUAL-12 control retains the dual executable and substitutes AMS-10's exact
project entry. All are explicit diagnostics, not shared exporter fixes.

AMS-13 subsequently failed entirely orange. It cleared nine nonempty stored
G-code-template fields from working AMS-10 and changed no other archive entry.
Thus emptying that family is independently sufficient to break this job;
neither the required individual field nor its required contents is identified.
Stored templates cannot yet be treated as safely disposable metadata. This does
not prove the printer executes their contents. The next controls restore only
startup, only filament-change, or SAAM's own exact executable startup in the
startup field. AMS-14 passed the three saved routing changes and AMS-15 passed
the Standard-only variant-table reduction, each independently with the remaining
working project fields preserved. Neither pass identifies the required template.
The v13 authored duplicates now reuse the executable's canonical renderer;
they introduce no second source of nozzle/plate/feed settings or vendor header.

Both supported profiles declare `single_extruder_multi_material=1` and
`printer_technology=FFF` in CONFIG and project JSON from the same resolved job.
These installed-profile declarations apply even with an external feed or one
used filament. Their effect on the observed runtime routing failure remains
unverified; they do not choose a physical AMS slot.

Earlier user-reported successful left-nozzle PLA output is historical evidence
for that earlier program, not physical validation of this revision or every
mixed-nozzle/AMS configuration. See the
[dated record](../../DEVLOG.md#2026-09-18--x1-carbon-output-through-the-shared-bambu-exporter).

## X1 Carbon output contract

`x1c-saam-startup-v5`: one standard hardened 0.4 mm nozzle; 1.75 mm PLA;
Textured or Smooth PEI; bed 46–70 C; no chamber heating. Full startup retains
homing, wiping, front-edge purge/calibration lines, mechanical checks and
first-layer scan registration. Fast mode omits optional checks as described
above, retaining homing, wiping and priming. Shutdown clears by 0.5 mm, parks up to 250 mm and settles
without descending below clearance. Other nozzle sizes/materials are not output
contracts even if the machine could physically support them.

The loader's `X-BBL-Client-Version` remains `02.08.02.61`; SAAM is identified
separately. The earlier loader failure with a SAAM-formatted client version and
the manual-AMS-mapping warning are recorded in the
[devlog](../../DEVLOG.md#2026-09-18--x1-carbon-output-through-the-shared-bambu-exporter).
Changing a mapping-mode string has not been proven to resolve the warning.

### X1 colour changes through one nozzle

The X1 profile supports regional PLA colour changes using distinct logical
filaments assigned to physical tool `0`. For exactly two changes, use three
successive height bands; interleaved objects can require repeated changes.
These changes require AMS feeds. Automatic material/colour matching remains
available, and the user confirms the actual slots on the printer. Explicit
external-spool changes are rejected.

The `x1c-saam-startup-v5` recipe lifts above the printed part by 3 mm, selects
the next logical filament through the remapped `M620`/`T`/`M621` sequence,
and flushes 300 mm³ into the rear chute at the profile's PLA service temperature
and flow rate. It restores the incoming print temperature, primes 2 mm of
filament, retracts by the incoming process setting, wipes and returns at
clearance. The planner and independent interpreter both reset retraction debt
to that incoming setting. The flush volume is a bounded test policy, not a
guarantee of colour purity. No prime tower is generated.

Regional filament use supplies the package metadata, selection sequence and
body playback from the same plan. Service time and purge/prime material are
additional to the displayed body estimates; the review states this explicitly.
The installed Bambu Studio X1 change template dated 2025-10-31 supplies reference
evidence for the service route and commands. Physical verification of this
authored recipe failed the first three-colour test; its firmware routing remains
under investigation. Software interpretation of both changes is not evidence
that the printer executes them.

## Evidence and verification tools

Read a vendor or SAAM sliced archive without extracting files or copying headers:

```sh
node scripts/bambu-audit.mjs path/to/reference.gcode.3mf
node scripts/bambu-audit.mjs path/to/reference.gcode.3mf path/to/saam.gcode.3mf
```

The report includes archive SHA-256, relevant project/config fields, duplicate
configuration keys, numbered
startup/service commands, plate metadata, slice/model metadata and sequence.
It also reports paired material loads, observed nozzle transitions, outgoing and
incoming flush descriptors, feeder/detection selectors, retraction/cooling facts,
tower feature markers and mismatches against resolved slice declarations.
Its checks cover those selected fields only. Saved project preferences are not
compared as though they were another resolved slice. Firmware branches are not
executed, and a report with no issues is not full archive or hardware validation.
It reports observed facts; it does not claim a firmware protocol or physical
safety verdict. Raw vendor G-code without an archive is not accepted by this tool.

`studioReader` reports necessary conditions from Studio's desktop G-code reader:
a `; BambuStudio` prefix and at least 80 recognized configuration entries. The
reported entry count includes unknown keys, so passing these checks is not
schema acceptance. Fast-05 lacks the prefix and has only 40 entries; the working
left-only reference has the prefix and 569 entries. Firmware handling of the
entry-count difference remains unknown. A physical H2D control with the producer
marker removed and Application identity replaced printed correctly; the desktop
producer gate is not a demonstrated firmware gate. Do not equate consistent declarations with
successful ingestion, add arbitrary entries to meet a count, or claim that a
producer marker alone fixes physical routing. The owning source is Studio's
[configuration loader](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Config.cpp)
and [G-code processor](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/GCode/GCodeProcessor.cpp).

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

Using both different-diameter nozzles within one job is implemented through
regional filament/process selection, bounded changeover/retraction/temperature
state and clearance, per-tool extrusion interpretation, and layer/filament usage
generated from actual actions. DUAL-12 physically verified its left/right/left
commands and 0.4/0.8 setup with the successful reference project. Acceptance of
fresh generated project metadata and other installations remains outstanding.
The supplied `twistedbox.2color.gcode.3mf` (SHA-256
`ddbea3c405b12328990c1aa6f45c106b8e6899a5807d7cc7947c23caa2835a63`)
contains 124 observed nozzle changes, 126 material-load blocks (including the two
startup selections), and 372 prime-tower feature sections. Green logical filament
0 maps to right nozzle 1; yellow filament 1 maps to left nozzle 0. Its resolved
maps are `2,1` / `1,0`, its 125-entry use sequence begins with right, and its
declared diameters are 0.4/0.4. Those declarations do not change the reported
0.4/0.8 installation. Fact-only fixtures preserve this evidence without using
the reference header, geometry or tower as an output template.

The installed H2D `change_filament_gcode` template independently identifies
`current_nozzle_id` for A0 and `next_nozzle_id` for A1. This establishes how to
derive unequal H values; the equal-H example alone cannot demonstrate that.
The user confirmed left external/right AMS for this machine right now and
explicitly required configurable feed combinations across machines. No fixed
feed arrangement or unequal-nozzle prohibition should be introduced.

The user then replaced that same desktop filename with a tower-disabled export,
SHA-256 `f6bad52dc858c7a06ebdbace77b40706d8ea8d1f9afbfac26dd4e4678d03bf86`.
It preserves the 124 transitions and nozzle/filament mappings, sets
`enable_prime_tower = 0`, has no tower feature sections or plate tower object,
and uses C220 throughout M620.15 instead of the tower variant's later C210.
The tower-specific Y320/X approach is absent; Y295/Y265 service moves remain.
Do not infer that every park/wipe move belonged to the removed tower. Outgoing
M620.11 B begins at -1 and subsequently follows known 0/1 hotend state, while
incoming T H remains -1. This is another state-dependent field derived by the writer,
not permission to replace all B/H selectors with the heater ID. Blank
`;prime_tower_interface` comments persist even with the tower disabled; they
do not mean tower extrusion occurred. Both observations are recorded by hash in
`core/tests/fixtures/bambu-h2d-dual-reference-facts.json`, since the path was reused.

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

### Diagnosing a stop or an elevated first layer

Inspect the exact delivered archive, including modal feed rates, speed overrides,
temperature waits and nozzle-change service boundaries. `F` is mm/min; divide by
60 for mm/s. Body timing excludes firmware loading, synchronization, calibration
and thermal waits. A normal body estimate cannot rule out a blocked service call.
Capture actual/target temperatures and the pad/nozzle in use at the stop.

Current profiles require `G1` for body travel as well as deposition, including the
explicit descent from startup and every changeover clearance. This matches the
supplied H2D Studio body convention; it is not evidence that the firmware rejects
`G0`. The separated-pad test with G1 still ran the centre/left pad using the right nozzle above the plate and stopped after one layer; this change did not resolve the failure. Other output dialects retain
their existing travel command. Do not invent a Z offset to compensate for an
unexplained elevated layer after a correct purge line.

Keep `H-1` on static-mapping material selectors. Studio's
[`NOZZLE_ID_FOR_GCODE` rule](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/GCode.cpp)
uses -1 when dynamic mapping is off; replacing it with a heater or tray index is
not an established fix. Studio also passes separate runtime AMS/nozzle mappings
through [PrintJob](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/Jobs/PrintJob.cpp).
USB launch constructs that dispatch on the printer. Its behavior still needs
verification independently of consistent archive declarations.

The supplied left-only Studio archive `leftnozzle.gcode.3mf` (SHA-256
`2e476df9cccd6e1b94433c9ddfc91295db9b00b9054206cfd7c4dc6c55a55be7`)
declares maps 1,1 / 0,0, uses only logical filament 0 on left nozzle group 0,
and declares equal 0.4/0.4 diameters despite the reported 0.4/0.8 installation.
Its initial M104 T1, G151 P1 and both remapped T0 H-1 selections agree with
SAAM's intended left startup. This confirms those expressions but does not
establish general execution. The user subsequently confirmed the left reference
prints correctly; the failing SAAM dual diagnostics still selected the right
nozzle. Preserve that distinction when investigating the next dual-nozzle test.
