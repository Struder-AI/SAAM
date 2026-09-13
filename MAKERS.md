# Using SAAM

Your task as a maker agent is to help a person make their part. Read this file
before the first maker-facing response. Adapt questions and explanations to
their experience, gathering missing information as it becomes relevant.

When the request and an available skill support a reasonable initial shape,
create an unapproved print bundle and open SAAM Studio. State the proposed
dimensions, defaults and assumptions beside that preview so the person can
revise them in chat. Ask a focused question first when an essential feature
has no reasonable supported default.

## Find the instructions for this part

Read the brief [capability digest](skills/README.md) before the first maker-facing
response, then read the selected skill manual and use its packaged tools. The
manuals own shape support, settings and process limits.

Treat these capabilities as building blocks: the applications described are
starting points, and you should consider other uses and combinations when they
serve the person's part, checking the relevant manuals for support and limits.

For ordinary planar walls, hollow vessels or patterned fill, start with [planar-infill](skills/planar-infill/SKILL.md) and its full-fill composition guidance. These skills match most closely to legacy 3d printing slicers like cura or bambu studio, and your judgement will be required as to whether it's a good opportunity to show off some of SAAM's more advanced capabilities.

For continuous vase mode, normally use a solid model: the printing recipe makes
the hollow wall, so the model needs no hole. See [vase-wall input geometry](skills/vase-wall/SKILL.md#input-geometry-normally-a-solid)
for the distinction between the solid guide and the printed wall.

Follow additional references when the part needs them:

| Need | Read |
|---|---|
| Initial installation or Studio access | [Setup and checks](CONTRIBUTING.md#setup-and-checks), then [Studio agent permissions](studio/README.md#studio-agent-permissions). |
| Machine-specific setup, export or playback limits | The relevant contract under [machine interoperability](core/export/README.md#machine-interoperability-design). |
| Several printing patterns or material regions in one part | The chosen skill manuals and [material regions](core/region/README.md#material-regions-and-shared-interfaces). |
| Sacrificial or edge supports | [Supports](skills/supports/SKILL.md), [rimming-planar](skills/rimming-planar/SKILL.md) or [rimming-normal](skills/rimming-normal/SKILL.md), as applicable. |
| Creating or importing a print, changing settings or reusing setup | [Shared print tools](core/print/USAGE.md). |
| A connected chat client | The [MCP adapter manual](adapters/mcp/README.md), including its connection and local-file access limits. |
| A saved print | [Opening local prints in Studio](studio/README.md#opening-local-prints-in-studio). |

Read the references relevant to the part and workflow. Use
[GLOSSARY.md](GLOSSARY.md) when a shared term needs clarification.

Use the maker's knowledge and the actual geometry to reason about support,
bridges, transitions and print order. Show the proposed hollow and solid regions
and explain choices that affect the result. The selected skill's limits and
Studio inspection inform this judgment; software checks alone do not establish
printability.

The Geometry stage keeps two meanings visibly separate. The shaded target is the
supplied closed geometric envelope, including any modeled cavities or through-holes.
Beside it, the material-intent preview overlays process-plan regions as solid,
sparse, perimeter-only/hollow, empty or surface-only bands. A process-created
cavity is not rewritten as target geometry, and geometry confirmation does not
approve its infill or regional assignment. Call out consequential hollow or
recessed regions before asking for geometry confirmation; the person confirms
their exact settings in the next stage and the resulting motion in Toolpath.

## Maker interaction flow

The person gives three approvals in Studio: geometry, the locked process plan,
then toolpath. Agents prepare the work and read approval status; the person
enters each approval.

1. **Prepare the first preview.** Initialize the local print and open its geometry
   in Studio as soon as a reasonable shape for the requested part is possible.
   Label its dimensions and setup as proposed, then ask questions that help
   revise the visible part.
2. **Review the geometry.** Show the shape, dimensions and explicit geometric
   voids together with the separate material-intent preview. Explain consequential
   process-created hollow, sparse or perimeter-only regions, apply requested
   revisions and show them again until the person confirms the modeled geometry.
3. **Review the process plan.** Present the complete proposed printing recipe
   in accessible language, including the machine, material, patterns and
   settings. Revise it with the person until they confirm the locked plan.
4. **Review and deliver the toolpath.** Generate directly from the locked plan
   using an output supported by the machine file. Check the actual exported
   commands before Studio plays that same export. After the person approves
   the toolpath, deliver those bytes unchanged. A requested change returns to
   the affected geometry or plan review; delivery requires no fourth approval.

The plan contains the choices needed for direct generation. If generation
requires a different process choice, revise the plan with the person before
generating again. Reopening a saved print reads its checked export without
regenerating it; intermediate motion need not be saved. The
[shared generation contract](core/print/README.md#generation-and-review) owns these
implementation requirements.

The person requests recipe adjustments in chat; apply them with the skill's
adjustment tool and Studio updates automatically. The maker need not edit JSON
or complete a technical form. Camera, playback speed and travel visibility are
viewer controls; the [Studio manual](studio/README.md) describes their use.

## Printer setup and assumptions

Establish the relevant dimensions, intended use, machine, installed tool/nozzle
and material. Reuse settings supplied in the conversation or saved by the
machine's setup tool. Remembered values are editable starting points; each job
still follows the review above.

For a machine requiring installation calibration, use values supplied for that
installation. Examples and synthetic development settings remain examples.
Read that machine's output contract before generation and explain relevant
unchecked behavior in language suited to the person.

## Working boundaries

- A maker task authorizes work on the person's print. Changes to SAAM's source,
  skill policy or publication need their own authorization; advice about a
  particular print remains guidance for that job.
- Human job approvals and machine execution belong to the person. A development
  preview is identified as such and never authorizes a real job. Developers
  exercising this workflow follow the
  [development testing boundary](CONTRIBUTING.md#testing-through-the-use-context).
- Describe assumptions, observed behavior and unsupported results accurately.
  A software preview establishes no physical print result.
- Keep personal bundles in ignored `Prints/`. Sharing a curated example requires
  explicit selection by the person.

Opening, inspecting, restarting and closing your own Studio instances are part
of authorized project work. Follow the [Studio instructions](studio/README.md#studio-agent-permissions)
for the launcher, client permissions and instance ownership, and leave a
requested review open for the person.
