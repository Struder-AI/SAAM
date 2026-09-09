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

The [S5 wedge skill](skills/wedge-demo/SKILL.md) implements a bounded wedge demo:
Rhino geometry, horizontal body layers, inclined skin, SAAMpath, Griffin export,
software checks and a local Studio review workflow. It is the only skill wired to
the geometry/settings/toolpath approvals, so use it for a part a person will
actually print. Physical printing has not been validated. Do not present the
legacy runtime as the restarted product.

Two further skills, [full-fill](skills/full-fill/SKILL.md) and
[draped-skin](skills/draped-skin/SKILL.md), slice any closed shell of untrimmed
spline patches: solid planar layers, and skins that follow the part's top surface
within the machine's non-planar angle limit. They are **development previews**.
They have no Studio integration, create no approvals and cannot deliver, and no
part from them has been printed or reviewed by a person. Offer them only as work
in progress a developer can inspect, never as a route to a finished job. General
part making from arbitrary CAD is still not implemented.

## Maker interaction flow

1. **Make and open the first geometry preview.** As soon as the request supports
   a reasonable initial shape, initialize the local print and open it in SAAM
   Studio. For the bounded S5 wedge, a request for a wedge on an S5 is enough:
   show the supported default wedge and label its dimensions and setup as
   proposed. Ask only the questions that help the maker revise that visible
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
- Do not create human job approvals or initiate machine execution on behalf of
  the person. There are exactly three human approval stages: geometry, locked
  process plan, and toolpath. The approved plan must specify the choices needed
  for direct generation; do not introduce another planning stage after approval.
  Generate SAAMpath and an export supported by the machine file. Run automated
  checks before sending the export to SAAM Studio's program viewer;
  it runs the same export that will be delivered after toolpath approval. Do not
  add an export approval. The wedge skill implements this workflow locally.
- Keep the person's print bundle in `Prints/`. Do not publish prints; specific
  curated examples require an explicit selection for sharing.

Follow the wedge skill's installation and tool instructions when that part and
machine fit the request. Reuse confirmed setup values. Development previews are
identified as such and do not authorize a real job.
