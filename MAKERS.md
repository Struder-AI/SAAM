# Using SAAM

Author geometry and toolpaths and show them in Studio for review; Export is the one confirmation.
Adapt questions and explanations to the person's experience.

The [digest](skills/DIGEST.md) indexes every skill and every advanced section
(for machines with a capability, or on request). Read one by name when its gate
applies or the person asks; a read lists what it omitted.

## Geometry

SAAM has no shape templates: you write the geometry, in millimetres with Z = 0 on
the bed. Read the form's section before writing it.

| Form | Reach for it for |
|---|---|
| [Spline surfaces](GEOMETRY.md#spline-surfaces) | Smooth bodies, exact circles, revolutions, lofts, sleeves, surfaces skills follow by name |
| [Blob field](GEOMETRY.md#blob-field) | Organic volumes, blends, holes and voids |
| [Mesh](GEOMETRY.md#mesh) | Flat faces, sharp edges, chamfers, polyhedra |
| [Boolean](GEOMETRY.md#booleans), [assembly](GEOMETRY.md#assembly) | Drilling, joining or trimming solids; placing separate parts |

Check sections and tops with [`intersect_geometry`](GEOMETRY.md#checking-geometry).
For an existing mesh import an STL, or use [thingi10k](skills/thingi10k/SKILL.md)
when the person asks to fetch one or gives a Thingiverse link.

## Toolpaths

Use [Slice](skills/slice/SKILL.md) for regions, [Trace](skills/trace/SKILL.md) for curves or [Inject](skills/inject/SKILL.md) for points; their manuals cover composite techniques.
For a bridge across a gap, [bridging](skills/bridging/SKILL.md) spans selected supporting edges. Match both the attachment and the full requested coverage; follow-on slices may cover the supports too.
Maker and builder agents use disjoint or explicitly partitioned material claims; SAAM does not distribute overlapping claims or interlock them.
Ordinary bead overlap, including fill overlap and reinforcement, remains part of those techniques.
Reason from geometry about transitions and print order. Usually omit support; where needed use [standard support](skills/standard-support/SKILL.md#choose-the-patches).
Ask setup questions when the person wants machine output; read the machine's [contract](core/export/README.md#machine-interoperability-design) first. Software checks do not establish printability.
For Bambu, read [Choosing the spool](machines/bambu/SKILL.md#choosing-the-spool) first: material and colour suffice for automatic matching; ask for a physical slot only for a requested or necessary route. Confirm mapping at the printer.

## Maker interaction flow

Save usable intermediate revisions so Studio shows work as it develops; continue until the intent is achieved.
These stages are dependencies, not gates; changes are welcome from any view.
Inspect each returned `visualCheck` and correct what looks wrong. Use the person's current camera/playback for inspection; choose another view when they request it.

When a command returns an available `commandResult`, use
`saam call get_bundle_command_result` with its `bundleId` and `commandResult.id`
to read the complete associated summary, edit details and findings. This is the
captured result of that command; `get_bundle` instead reads the current part.
An unavailable report does not undo a reported committed edit. Check its saved
identity before deciding whether any new work is needed.

1. **First preview.** Create a print and show the geometry as soon as a
   reasonable shape exists, with proposed dimensions and assumptions beside it.
   Ask first only when an essential feature has no reasonable default.
2. **Geometry.** Invite changes; generate whenever a toolpath helps. Generation needs no printer; the printer can be chosen at any time and only its program waits for it.
3. **Settings and toolpath.** Present the recipe in plain language beside playback;
   regenerate what a change affects and show it in the same view.
4. **Export.** The person exports from Studio; that Export is the one
   confirmation, capturing the displayed settings and path. Export writes the machine
   program for download; explain the
   transfer; for the Ultimaker, copy the file to USB, not into another slicer.

Use your attached Studio. [Hand work back](studio/README.md#carrying-a-maker-request)
when finished, needing discussion, or interrupted by a user message; inspection is not an export.

## Standard parameter policy

Prefer a stated assumption over a question. Values come from the current
request, then the print being edited, then genuine last-used values (the
conversation, a saved print or [remembered machine setup](core/print/USAGE.md#remember-machine-setup)),
then the skill's or machine's documented default. State the chosen dimensions,
printer, material and other consequential assumptions with the preview, marking
reused values. Installation calibration uses values supplied for that installation.

## Working boundaries

“If saam can do it, use saam. If it can't, build an extension that can.” (owner,
2026-10-05). Geometry and machine programs for a printer come only from SAAM
operations, extensions included; scripts compute only their [inputs](GEOMETRY.md#computing-geometry-with-scripts).
When no operation fits, tell the person, then as a [builder](AGENTS.md#changing-role)
write an extension in `<SAAM home>/local/extensions/` through the
[extension interface](skills/AUTHORING.md). Work it cannot express is a SAAM bug:
tell the person and file it with `saam call report_bug`.
Export and machine execution belong to the person; previews establish no
physical result. Prints stay in the [SAAM home](core/application/README.md), shared only on the person's selection.

## Using the saam command

[Application commands](core/application/README.md) own `saam help OP`, `saam call OP`
(file, stdin or flags), `saam wait` and chat IDs; waits and ended turns leave the
app and work open. `saam start-tour` returns its own [participation context](examples/prints/README.md#maker-agent-participation).
