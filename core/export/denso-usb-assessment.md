# VS-068A4 / RC8A: native project and USB assessment

Assessment date: 2026-09-22. Direct native-project/USB export is scoped here;
SAAM currently emits the experimental PacScript source ZIP described in
[denso.md](./denso.md).

## Update: passing reference-point spiral demo

The user subsequently confirmed the spiral demo runs correctly. Desktop
DENSO_PASSING_REFERENCE.md reports STRUDER_SPIRAL2 and STRUDER_SPIRAL3 passed
end to end using Tool 6, Work 2 and P10 taught in those frames. The sources and
reference notes are preserved separately in ignored local evidence storage.
Spiral3 was not present in the earlier USB snapshot; it was read from Desktop.

This supersedes the earlier need for a basic P1/P2 interpolation experiment.
Spiral2 proves generated XYZ points with inherited posture/FIG and Move L @P.
Spiral3 retains the frame/reference method, changes short lines to quarter-turn
Move C arcs, and sets Speed 50 and Accel 100,100. Its 102 quarter turns reach
51 mm; it is not byte-equivalent geometry to the nominal 50.8 mm Spiral2 target.
The proven setup uses Tool 6 = P(155,0,35,0,90,0), Work 2 taught from three points,
and P10 as a posture/FIG template. P10 coordinates are not the generated path origin.

The passing record also supplies a working PacAttri.lst staging convention:
ordinary programs use relative-path,0,-2, with ASCII/CRLF/no-BOM source files.
Program-only import protects the current taught variables and frames. The older
runbook contains a stale VP-6242 mismatch paragraph; its heading, the passing
reference, user correction and supplied project all agree on VS-068A4.

The next integration target is the user's saved vertical/horizontal cladding job.
Its synthetic axis-7/IO-64/figure-1 setup must not be mistaken for the tested spiral
setup. A fixed-posture spiral does not establish tilted nozzle motion around the
part, an external rotary connection, extrusion control or the existing T/EX/Time
export dialect. Select the actual saved job and stationary/rotary execution mode,
then use this evidence to prepare its output. The earlier estimates remain only
estimates; basic generated-coordinate and USB proof is now complete.

## Evidence and decision

The user corrected the installed robot to **VS-068A4** and the controller to
**RC8A**; the reported loads and passing runs were on the RC8A. The supplied controller
project independently names VS068A4-AV6-NNN-NNN A, RC8 and VS-A4 definition files.
Its WPJ records minimum WINCAPS version 3.52.0 and RC8 version family 2.3.x;
these are project metadata, not verified installed software versions.

The user reports that STRUDER1_1.pcs and STRUDER1_2.pcs successfully load on the
controller. This establishes a working source-loading route. It does not establish
that SAAM's T/EX/Time commands compile, coordinated rotary motion works, or a part
has been printed. The same backup contains arc and spiral programs; their load and
motion results have not been reported. In particular, the spiral programs contain
assumed tool offsets and taught-frame requirements, not measured SAAM setup data.

**Recommendation: use a controller-project template and program-only USB import
as the next integration step.** Do not begin with a from-scratch WPJ writer. DENSO
states that a [saved WINCAPS project needs its accompanying folder](https://support.densorobotics.com/en/support/solutions/articles/60001087685-how-do-i-send-my-saved-wincaps-robot-project-).
The supplied WPJ is a 600-byte XML descriptor; the useful project also includes
Setting.xml, source files, attributes, opaque databases and controller data.
[Controller backup includes robot-specific settings](https://support.densorobotics.com/en/support/solutions/articles/60000697437-how-to-create-a-new-project-in-wincaps-iii).
Generating the descriptor alone would not deliver a usable project.

A published [RC8 integration procedure](https://docs.mech-mind.net/en/robot-integration/2.2.1/standard-interface-robot/denso-setup-instructions.html)
describes copying sources into a controller-created backup and selecting Program
when reading it from USB. This supports the template approach alongside the user's
successful loads. Preserve the original project and controller configuration;
produce a separate derivative for import. WINCAPS remains useful for compilation
and inspection, but need not be the routine file-copy step after the route is proven.

## Scope and effort estimate

These are engineering estimates, conditional on access to WINCAPS/controller
feedback; they are not approved implementation commitments.

1. **Reference-motion demo: hours plus operator testing.** A separate P1/P2
   Move L program exercises native Cartesian interpolation. Confirm frames,
   posture/figure compatibility, approach and the entire straight path locally.
   A subsequent generated-point path should use measured tool/work frames.
2. **Template export spike: 1–2 engineering days.** Insert a small actual SAAM
   main/helper source set into a copy of this backup; determine the necessary
   source registration, attributes and rebuild behavior; compile in WINCAPS and
   verify Program-only USB import. Test the actual T, EX, Time and IO dialect.
   A no-rotary demo cannot prove the configured external-axis contract.
3. **Reusable delivery integration: roughly 3–5 further engineering days if the
   spike passes.** Add explicit template selection, unique SAAM program names,
   source inventory/attribute handling, output packaging, exact-source hashes,
   review/delivery binding, actionable import errors and software regression checks.
   Keep opaque controller data private and unchanged. Hardware commissioning and
   vendor compatibility fixes may extend this estimate.

The backup's Setting.xml source list differs from the actual source directory;
PacAttri.lst also assigns program attributes. Determine which fields the real
import/rebuild consumes before writing a generic template updater. Do not guess
attribute flags or overwrite existing mainloop, calibration, safety or license data.
The supplied copy is a development reference, not a redistributable generic fixture.

Direct network transfer is a separate later option. The
[RC8 Provider Guide](https://www.fa-manuals.denso-wave.com/subfolder/en/usermanuals/img/001511/RC8_ProvGuide_en.pdf)
documents file operations, but connection, controller option/licensing, compilation
and deployment behavior need their own verification. A WINCAPS license alone does
not establish that complete path.

## Corrected SAAM target

The mistaken experimental profile is replaced by **denso-vs068a4-rc8a**, revision 4,
rather than maintaining two profiles for one installation. Registry, examples,
setup validation, interpretation and Studio use the corrected identity. Existing
saved job snapshots are not rewritten or granted fresh approvals: recreate/review
jobs against the corrected target. The old ID is no longer a selectable profile.

Nominal display geometry uses VS-068 dimensions: shoulder height 395 mm, radial
shoulder offset 30 mm, upper/forearm 340 mm each, elbow offset 20 mm and standard
flange length 80 mm. The supplied WINCAPS model pivots corroborate these dimensions.
See the [presentation model](../machine/README.md#denso-vs-068a4) for its limits.
Tool length and installation transforms remain explicit display inputs. Display
bounds are not a reach envelope. Tool/work frames, figure, rotary connection and
extruder IO remain unresolved; the model correction does not fill them with guesses.

## Local preservation

The complete STRUDER11 project was copied to the ignored local USB snapshot on
2026-09-22. Its verification.json records 66 files, directory inventory and SHA-256
hashes; source-before, local copy and source-after matched. Both STRUDER1_1 and
STRUDER1_2 are included. No writes were made to the USB. The preserved snapshot is
kept unchanged; new demo sources live in a separate local directory.
