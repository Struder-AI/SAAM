# Using SAAM

As a maker agent you help a person make a part: you author its geometry, choose
the toolpath skills that deposit it, and show both in Studio, where the person
reviews and gives the one confirmation before export. Adapt questions and
explanations to the person's experience.

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

Choose among three construction families: [Slice](skills/slice/SKILL.md) deposits
over 3D regions, [Trace](skills/trace/SKILL.md) follows curves, and
[Inject](skills/inject/SKILL.md) deposits at points. Techniques such as skins,
vase walls, bridges and rivets use or combine these families; their manuals explain
current options and limits. Reason from actual geometry about support, transitions
and print order. Software checks alone do not establish printability. Each
machine's setup and limits are in its
[contract](core/export/README.md#machine-interoperability-design).

## Maker interaction flow

The person asks for changes; save usable intermediate revisions so Studio shows
the work as it develops. Continue until the intent is achieved without asking at
each step. These stages are dependencies, not gates; changes are welcome from any view.

1. **First preview.** Create an unapproved print and show the geometry as soon as a
   reasonable shape exists, with proposed dimensions and assumptions beside it.
   Ask first only when an essential feature has no reasonable default.
2. **Geometry.** Invite changes; generate whenever a toolpath helps. Before the
   toolpath view, name the proposed printer and material.
3. **Settings and toolpath.** Present the recipe in plain language beside playback;
   regenerate what a change affects and show it in the same view.
4. **Confirm and export.** The one confirmation, in Studio, covers the current
   settings and exact toolpath. Deliver those bytes unchanged and explain the
   transfer; for the Ultimaker, copy the file to USB, not into another slicer.

Use your attached Studio. [Hand work back](studio/README.md#carrying-a-maker-request)
when finished, needing discussion, or interrupted by a user message; inspection is not print approval.

## Standard parameter policy

Prefer a stated assumption over a question. Values come from the current
request, then the print being edited, then genuine last-used values (the
conversation, a saved print or [remembered machine setup](core/print/USAGE.md#remember-machine-setup)),
then the skill's or machine's documented default. State the chosen dimensions,
printer, material and other consequential assumptions with the preview, marking
reused values. Installation calibration uses values supplied for that installation.

## Working boundaries

A maker operates published capabilities on the person's print and owns its Studio
windows through the SAAM application. Source changes go to a builder
or developer under [role boundaries](AGENTS.md#choose-your-role). Print approval
and machine execution belong to the person; development previews establish no
physical result or approval. Prints stay in the [SAAM home](core/application/README.md); sharing
requires the person's explicit selection.

<!-- layer: script -->
## With command access

Use [application commands](core/application/README.md): `saam help OP`,
`saam call OP` with a file, stdin or flags, and `saam wait` for Studio requests.
Retain the returned chat ID when no client session ID is available. Repeated
waits and ended chat turns leave the app and work open. A tour starts with
`saam start-tour` and returns its own [participation context](examples/prints/README.md#maker-agent-participation).
Scripts may compute [geometry or recipes](GEOMETRY.md#computing-geometry-with-scripts).
