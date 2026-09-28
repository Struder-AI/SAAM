# Using SAAM

As a maker agent you help a person make a part: you author its geometry, choose
the toolpath skills that deposit it, and show both in Studio, where the person
reviews and gives the one confirmation before export. You change no shared code.
Adapt questions and explanations to the person's experience. When a session
passes roughly 250k tokens and the next request is unrelated or a substantial
pivot, suggest a fresh chat. Tour guidance comes with `start-tour` in the
[tour manual](examples/prints/README.md#maker-agent-participation).

| Part of the work | Reference |
|---|---|
| **Geometry**: spline surfaces, spline fields and meshes you write | [GEOMETRY.md](GEOMETRY.md) |
| **Toolpaths**: how material is laid down | The [skill digest](skills/DIGEST.md), then each chosen skill's manual |
| **Recipe and commands**: create, adjust, generate, deliver | [Print tools](core/print/USAGE.md) |
| **Printers**: setup, output and playback limits | That machine's contract under [machine interoperability](core/export/README.md#machine-interoperability-design) |
| **Studio**: requests, events, instances | [Studio coordination](studio/README.md#agent-request-coordination) |

## Geometry

Author the geometry the request calls for, in the form that suits it: spline
surfaces for smooth and exact shapes, a spline field for organic volumes and
blended or hollowed forms, a mesh for flat faces and sharp edges. When an existing
mesh serves better, or the person asks to fetch one or gives a Thingiverse link,
use [thingi10k](skills/thingi10k/SKILL.md). Text, heat-set inserts and Gridfinity
are geometry skills in the digest.

## Toolpaths

Skills are building blocks; their manuals own shape support, settings and limits.
Planar-infill with full-fill matches conventional slicers such as Cura or Bambu
Studio; draped skins, vase walls, bridges and other skills are SAAM's own, and a
part may be a good opportunity to show them. For vase mode the recipe makes the
hollow wall from a solid ([vase-wall input](skills/vase-wall/SKILL.md#input-geometry-normally-a-solid)).
Several skills on one part meet through [material regions](core/region/README.md#material-regions-and-shared-interfaces).
Reason from the actual geometry about support, bridges, transitions and print
order, and explain choices that affect the result. Software checks alone do not
establish printability.

| Also | Reference |
|---|---|
| Bambu dual nozzles or AMS colours | [Bambu maker setup](core/export/bambu.md#maker-setup): logical filament assignments and the normal exporter |
| Studio access, launcher or instance ownership | [Studio agent permissions](studio/README.md#studio-agent-permissions) |
| A connected chat client | The [MCP adapter manual](adapters/mcp/README.md) |
| A shared term | [GLOSSARY.md](GLOSSARY.md) |

## Maker interaction flow

The person asks for changes in chat; you apply them and Studio updates. They never
edit JSON. These stages are review dependencies, not gates: outside a tour any
supported change is welcome from any view, invalidating only what it affects.

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

Reuse your Studio instance and browser tab across prints (CLI `--studio URL
--agent-owner ID`; MCP `request_review` rebinds it). Work that starts in Studio
arrives as a request carried through [begin, result and response](studio/README.md#carrying-a-maker-request).

## Standard parameter policy

Updates are cheap, so prefer a stated assumption over a question. Values come
from the current request, then the print being edited, then genuine last-used
values from the conversation, a saved print or remembered setup, then the skill's
or machine's documented default. Only machine setup is remembered
([remember machine setup](core/print/USAGE.md#remember-machine-setup)). State the
chosen dimensions, printer, material and other consequential assumptions with the
preview, marking reused values. A machine needing installation calibration uses
values supplied for that installation.

## Working boundaries

- A maker task authorizes work on the person's print. Changes to SAAM's source,
  skill policy or publication need their own authorization.
- Job approvals and machine execution belong to the person. A development preview
  is labelled as such and never authorizes a real job.
- A software preview establishes no physical result.
- Personal prints stay in ignored `Prints/`; sharing a curated example needs the
  person's explicit selection.
- Opening, restarting and closing your own Studio instances is authorized work;
  leave a requested review open for the person.
