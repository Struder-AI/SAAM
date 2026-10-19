---
name: ultimaker
description: UltiMaker S5 Griffin output contract; UltiMaker 2 Extended and 3 review profiles
metadata:
  saam-kind: machine
---

# Griffin output

The S5 output contract and current verification limits. See the [shared machine interface](../../core/export/README.md) for common motion semantics.

## S5 setup and troubleshooting

Use the machine profile's standard Griffin startup unless there is evidence of
a different installation. The installed firmware version is optional; the
profile assumption can be reviewed without claiming verified startup behavior.
When the person reports a modification or startup problem, ask a focused question
about the discrepancy. An About-screen version or the actual exported file is
useful when it resolves a concrete compatibility question.

Record user-reported findings separately from assumptions and physical
verification, and [remember the setup](../../core/print/USAGE.md#remember-machine-setup)
for subsequent jobs. The linked devlog observations identify their export and
behavior; they do not establish the behavior of every S5 installation.

Nave reports early Z movement instead of coordinated XYZ interpolation on
inclined `G1` extrusion spans; use explicit short collinear segments and
physically verify the result.

## Machine program templates and S5 observations

`machines/ultimaker/griffin.mjs` owns the S5 dialect;
[the shared writer](../../core/export/gcode-motion.mjs) emits motion and its totals.
`machines/bambu/bambu.mjs` adds the H2D envelope and sliced-3MF package.
The selected machine output's `program.header`, `program.start` and
`program.end` arrays contain literal lines with named value substitutions.
Values come from the locked setup, release metadata and written-command totals;
templates execute no JavaScript. Unknown values and invalid/nonfinite path data
are rejected. A snapshot locked without templates uses the installed profile's, noted.
The emitter writes shared SAAMpath actions between these sections.
The supported dialect remains the declared Griffin subset, not arbitrary G-code.

The shared writer computes material and timing from emitted coordinates,
extrusion and feeds at program precision. Generation retains those totals with
the exact bytes. Geometry, machine preparation, retained playback and browser
transfer still use memory proportional to the job.

Firmware reads at most 60,000 ms from a single `G4 P`. The writer splits longer
waits into consecutive commands whose milliseconds sum to the requested wait;
its tally includes each written command. Export preparation tracks withdrawals
and recoveries across tool/material changes.

H2D and Dobot have no arbitrary archive-size cutoff. They keep the declared
ZIP32 container and integrity checks (CRC, member ranges, declared decompression
length, names and exact expected package contents). Its actual 32-bit member
size/offset boundary remains: a member or offset requiring ZIP64 is unsupported
and reported explicitly. No printer capacity is inferred from these software
checks. Programs/archives remain subject to available runtime memory; chunked
artifact writing and paged playback are further work if measurements require
them, rather than a reason to force smaller parts or lower print quality.

### S5 startup observations

The [devlog](../../DEVLOG.md#2026-09-08-to-2026-09-10--s5-startup-observations)
preserves the revision-specific reports of leveling, unused-nozzle heating and
initial under-extrusion. They do not establish behavior on every S5 installation.

Export preparation follows the S5 startup-state rule:
recover the configured retraction once at the first deposition location without
another initial withdrawal. H2D uses an unretracted handoff; zero retraction and
relay output add no recovery. Physical confirmation of this correction is open.

S5 profile revision 7 supplies two connected 100 mm `startup.primingStrokes`
for export preparation, 4 mm outside the geometry and generated stroke footprint.
Preparation chooses a fitting side within the selected tool's bounds, shortens
a lane that exceeds them or omits it when none fits, with a note. It uses the
locked first-layer height, line width and speed. The first unretract occurs at
the prime, followed by retract/lift and approach to the part. Written-command
material and time include these strokes; Studio draws the saved source/execution.
Priming does not establish hidden firmware retraction state or physical recovery.

Saved machine snapshots without this setting retain their existing paths.
Recreate the print against the current machine profile and regenerate/review to
obtain the new strokes; an existing exported or delivered file does not change
automatically.

Absence of explicit leveling or unused-heater commands does not establish that
Griffin firmware skips those actions. The [recovered diagnosis](../../DEVLOG.md#br-043--s5-startup-diagnosis)
records the checked export and subsequent report of automatic firmware leveling;
it does not establish a supported per-file bypass. Retained snapshots and delivered
bytes can predate the current profile; diagnose the actual file and installation
before applying an earlier observation. The [S5 print record](../../DEVLOG.md#br-005--first-complete-print)
still lacks a complete physical result for the corrected startup.
