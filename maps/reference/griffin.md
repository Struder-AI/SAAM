# Griffin output

The S5 output contract and current verification limits. See the [shared machine interface](output.md) for common motion semantics.

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

## Machine program templates and S5 observations

`core/export/griffin.mjs` owns the S5 dialect and the shared motion emitter/modal
interpreter. `core/export/bambu.mjs` adds the H2D envelope and sliced-3MF package.
The selected machine output's `program.header`, `program.start` and
`program.end` arrays contain literal lines with named value substitutions.
Values come from the locked setup, release metadata and path totals/bounds;
templates execute no JavaScript. Unknown values and invalid/nonfinite path data
are rejected. The emitter writes shared SAAMpath actions between these sections.
The supported dialect remains the declared Griffin subset, not arbitrary G-code.
Coordinate and extrusion rounding must still obey the locked flow limit.

The Griffin/H2D modal reader has no arbitrary program-size cutoff. It walks
lines incrementally rather than splitting the entire program into a line array;
the shared reader also accepts an iterable of text chunks and preserves machine
state, CRLF handling and source line numbers across chunk boundaries. Every
command passes the same checks regardless of position in the file.
This is incremental parsing, not a fully streamed
bundle: generation, retained playback moves and
browser transfer still use memory proportional to the job.

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

Shell and wedge generation share the interpreter's S5 startup-state rule:
recover the configured retraction once at the first deposition location without
another initial withdrawal. H2D uses an unretracted handoff; zero retraction and
relay output add no recovery. Physical confirmation of this correction is open.

S5 profile revision 7 also supplies `startup.primingStrokes` to shell generation:
two connected 100 mm sacrificial passes, with 4 mm clearance outside the complete
geometry and generated stroke footprint (including supports). The generator
chooses a fitting side within selected-tool bounds, including bead width, and
reports insufficient space rather than silently omitting the prime. It uses the
locked first-layer height, line width and speed, capped by the normal flow limit.
The first unretract occurs at the prime; the nozzle retracts and lifts before
approaching the part. These are ordinary `prime`-phase SAAMpath moves, included
in exported material, time, bounds and Studio playback. The bounded wedge keeps
its existing sacrificial line. Priming does not establish the firmware's hidden
retraction state or guarantee physical extrusion recovery.

Saved machine snapshots without this setting retain their existing paths.
Upgrade the print's machine snapshot and regenerate/review to obtain the new
strokes; an existing exported or delivered file does not change automatically.

Absence of explicit leveling or unused-heater commands does not establish that
Griffin firmware skips those actions. The [recovered diagnosis](../../DEVLOG.md#br-043--s5-startup-diagnosis)
records the checked export and subsequent report of automatic firmware leveling;
it does not establish a supported per-file bypass. Retained snapshots and delivered
bytes can predate the current profile; diagnose the actual file and installation
before applying an earlier observation. The [S5 print record](../../DEVLOG.md#br-005--first-complete-print)
still lacks a complete physical result for the corrected startup.
