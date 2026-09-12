# Griffin output and S5 observations

The S5 output contract and scoped machine observations. See the [shared machine interface](README.md) for common motion semantics.

## S5 setup and troubleshooting

Use the machine profile's standard Griffin startup unless there is evidence of
a different installation. The installed firmware version is optional; the
profile assumption can be reviewed without claiming verified startup behavior.
When the person reports a modification or startup problem, ask a focused question
about the discrepancy. An About-screen version or the actual exported file is
useful when it resolves a concrete compatibility question.

Record user-reported findings separately from assumptions and physical
verification, and [remember the setup](../print/USAGE.md#remember-machine-setup)
for subsequent jobs. The observations below identify which export and behavior
have been reported; they do not establish the behavior of every S5 installation.

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
command still passes the same checks, including commands after the former
25-million-character boundary. This is incremental parsing, not a fully streamed
bundle: generation, retained playback moves and
browser transfer still use memory proportional to the job.

The former 64 MB ZIP policy is also removed. H2D and Dobot keep the declared
ZIP32 container and integrity checks (CRC, member ranges, declared decompression
length, names and exact expected package contents). Its actual 32-bit member
size/offset boundary remains: a member or offset requiring ZIP64 is unsupported
and reported explicitly. No printer capacity is inferred from these software
checks. Programs/archives remain subject to available runtime memory; chunked
artifact writing and paged playback are further work if measurements require
them, rather than a reason to force smaller parts or lower print quality.

### S5 startup observations

On 2026-09-08 the user reported that the **last wedge change** achieved no routine
bed leveling and no heating of the unused nozzle. The reported envelope used
Griffin compatibility `4.4.0`, SAAM's own version field, build date, material GUID,
build-volume metadata, active-tool temperature commands, no G280, and shutdown.
The default recipe uses nozzle #2/T1. Earlier that day the user reported initial
under-extrusion; the wedge recipe then accounted for its terminal retraction on
the next start. These observations apply to that export revision, not every S5 run.

The user subsequently reported having to push filament to compensate on every
start. The shell generator had treated the S5 handoff as unretracted, leaving
the preceding job's withdrawal outstanding after its initial retract/recover
pair. Shell and wedge generation now share the interpreter's S5 startup-state
rule: recover the configured retraction once at the first deposition location,
without another initial withdrawal. H2D retains its unretracted handoff; zero
retraction and relay output add no recovery. The emitted commands are corrected;
physical startup with the correction has not yet been reported.

On 2026-09-10 the user reported that their observed S5 startup differs from the
listed template behavior; the exact file and extra actions are not yet identified.
Absence of explicit leveling or unused-heater commands does not establish that
Griffin firmware skips those actions. Retained snapshots and delivered bytes can
predate the current profile. Diagnose the actual file and printer behavior before
applying the earlier observation. Complete physical print validation remains open.
