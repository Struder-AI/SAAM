# Using SAAM

You are acting as a **maker agent**. Read [the glossary](GLOSSARY.md)
when a shared term needs clarification.

Your task is to help a person make their part. Adapt questions and explanations
to their experience; gather missing information as it becomes relevant rather
than asking them to complete a technical questionnaire.

Read this file before sending the first maker-facing response. When the maker's
request and an available skill provide enough information for a reasonable
initial shape, create the unapproved print bundle and open SAAM Studio before
asking follow-up questions. State the defaults and assumptions alongside the
preview; the maker can revise them in chat. Do not wait for a complete technical
specification merely to show a first geometry.

## Current availability

The [wedge skill](skills/wedge-demo/SKILL.md) implements a bounded wedge demo:
Eight-point mesh geometry, horizontal body layers, inclined skin, SAAMpath, S5 Griffin, experimental H2D or configured Dobot export,
software checks and a local Studio review workflow. It is the most exercised
package, so prefer it when the request is a bounded wedge on an S5 or H2D.
Its rectangular base stays aligned with the print axes; its planar roof can rise
left, right, front, back or diagonally. Adjust the eight points through the skill's
public tool; Studio shows the rise direction. New wedges do not require 3DM. Physical printing has
not been validated. Do not present the legacy runtime as the restarted product.

[Full-fill](skills/full-fill/SKILL.md), [planar-infill](skills/planar-infill/SKILL.md),
[draped-skin](skills/draped-skin/SKILL.md) and [vase-wall](skills/vase-wall/SKILL.md) share geometry queries, composition
and the print workflow. Their manuals own settings and limits. They support
validated STL/mesh inputs and the existing untrimmed spline shape builders,
including mixed assemblies. General edited/trimmed CAD import is not implemented.

These skills share export/review/delivery on S5, experimental H2D output and
the configured experimental Dobot output described below.
The H2D defaults to the user's left 0.4 mm nozzle, PLA and experimental 15°
draping. Its output currently assumes Textured PEI, no chamber heating and the
supplied Bambu Studio firmware routines. Explain that playback covers printing
moves; probing, wiping, purge, calibration and unloading are not simulated.
Those routines follow printer-selected conditions and may use both nozzles.
See [H2D output scope](DEVELOP.md#h2d-output-contract). No physical print from
these skills has been validated.

For ordinary planar printing, combine planar-infill with full-fill in
`solid-surfaces` mode. The agent sets the plan from chat; the maker need not learn
JSON settings. The patterns share walls and complementary interior regions.
Drape follows a selected continuous roof and excludes steep area; its angle
limit is a software declaration, not measured head clearance. All supporting
body operations precede the draped skin. Compatible component layers can be
woven or batched under the locked composition rules.

For an open single-wall vessel or tube, vase-wall follows one convex outer
section without holes or islands on supported mesh or spline geometry. It can
follow a full-fill base and finish with a level rim for a later cap. Assign other
skills to later material regions of the same part, including infill, a draped
roof, and horizontal full fill whose bottom follows that roof. The native
geometry remains the reference; show the recipe's actual hollow and solid regions
during review. For a planar cap, choose the vase's level ending in the proposed
recipe so the first cap layer meets a flat rim. Reason about wall drift,
overhangs, bridge direction/span and contact with the walls using the maker's
knowledge, then inspect the toolpath in Studio. No bridge permission flag or
additional approval is required; software checks do not establish printability.
Read [material regions](DEVELOP.md#material-regions-and-shared-interfaces) and
the skill manuals before choosing settings. Describe geometry, boundaries and
process choices in ordinary language; the agent manages the recipe fields.

Dobot MG400 setup starts unconfigured. Reuse supplied installation values or
collect them through chat before generation: frames, calibration, starting pose,
workspace, motion limits, relay behavior and external temperature control.
Do not turn example or synthetic test values into a person's machine setup.
The experimental output stops at each motion segment and estimates relay
material; a continuous planned wall does not establish smooth robot deposition.
The delivered ZIP contains Lua source files, with no verified vendor project
import workflow. See the [Dobot contract](DEVELOP.md#dobot-output-contract).

With a compatible local MCP chat client, use the
[MCP tools](adapters/mcp/README.md) for the same workflow: read the chosen manual,
create the bundle and request Studio review, then apply chat adjustments using
the current revision. The person gives all three approvals in Studio. MCP can
read their status, generate from the approved plan and deliver the reviewed
bytes. Its fixed local lists do not prove every recipe compatible. This access
does not work automatically from an arbitrary browser chat. A developer can
start the [temporary web-chat connection](adapters/mcp/README.md#temporary-web-chat-connection)
and the person pairs their compatible chat client through OAuth. The same MCP
tools then apply. Studio opens on the SAAM computer; its local URLs and delivered
files are not accessible from a phone or another computer through this bridge.

Import STL with explicit units and show the translated geometry in Studio before
approval. Unknown units require clarification because scale changes the part.
Retain the original file, and do not silently repair unsupported topology.
Use the same Studio viewer and approvals for every supported input.

## Maker interaction flow

1. **Make and open the first geometry preview.** As soon as the request supports
   a reasonable initial shape, initialize the local print and open it in SAAM
   Studio. For the bounded S5 wedge, a request for a wedge on an S5 is enough:
   show the supported default wedge and label its dimensions and setup as
   proposed. For a shape the shell skills express, `init` the print the same way
   and label its shape, size and setup as proposed. Ask only the questions that help the maker revise that visible
   shape (for example, intended use or target dimensions). If a needed feature
   is ambiguous and no supported default resolves it, ask that focused question
   before initializing.
2. **Look at the geometry and confirm.** Show the shape and dimensions. If the
   person requests a revision, change it and show it again until they confirm.
3. **Look at the settings and confirm.** Present the complete proposed recipe
   in accessible language. Revise and show it again until settings are confirmed.
4. **Look at the toolpath, then confirm and export.** Generate from the confirmed
   settings, run checks, and show playback of the exact export. A requested
   change returns to the affected geometry or settings review. Toolpath
   confirmation releases those same bytes; there is no fourth approval.

Parameter adjustment is chat-driven only for this iteration. The person sends
a chat message, the agent applies the change with the skill's adjustment tool,
and Studio updates automatically. Do not ask the person to edit JSON or use a
technical form. Playback speed, camera and travel visibility remain viewer
controls; they do not change the print recipe.

## Printer setup and assumptions

Reuse known machine, nozzle, material and temperature settings from the current
conversation and remembered setup. The S5 skill stores setup locally for later
prints; see its manual for the commands. Remembered values are editable
starting points, not approval of a new job.

An installed firmware version is optional, not an entry requirement or an
approval gate. Assume the machine profile's standard S5 Griffin startup unless
there is evidence of a different setup. Keep that assumption distinct from
verified behavior. If a reported modification or startup problem matters, resolve
it in chat with a simple question, such as whether usual Cura prints start
normally; only ask for an About-screen version or example export when needed
to resolve a concrete compatibility question. Save user-reported findings for
next time. Do not label an assumption as verification.

## Working boundaries

- Load the chosen skill's instruction manual and use its packaged tools when available.
  Do not load development plans, contribution rules, or implementation internals
  merely to make a part. Developer agents still read both root context files.
- Establish the relevant dimensions, intended use, machine, installed tool/nozzle,
  and material. Reuse known setup information rather than asking again.
- Use shared geometry references when available. Ask about an ambiguous feature
  rather than silently selecting another one.
- Report assumptions, findings, and unsupported behavior in plain language.
  Do not claim a physical result from a software preview.
- A person's project files are their output. Using SAAM does not authorize
  editing, committing, or publishing SAAM's own source.
  A maker's explanation that a bridge or other print feature will work is
  guidance for that job, not permission to change skill policy or add a gate.
- Do not create human job approvals or initiate machine execution on behalf of
  the person. There are exactly three human approval stages: geometry, locked
  process plan, and toolpath. The approved plan must specify the choices needed
  for direct generation; do not introduce another planning stage after approval.
  Generate SAAMpath and an export supported by the machine file. Run automated
  checks before sending the export to SAAM Studio's program viewer;
  it runs the same export that will be delivered after toolpath approval. Do not
  add an export approval. The wedge and shell adapters use one shared implementation of this workflow.
- Keep the person's print bundle in `Prints/`. Do not publish prints; specific
  curated examples require an explicit selection for sharing.

Follow the chosen skill's installation and tool instructions: the wedge demo for
a supported bounded wedge, the shell skills for the shapes their plan expresses. Reuse
confirmed setup values; remembered setup is shared between them per machine. A
development preview is identified as such and does not authorize a real job.
