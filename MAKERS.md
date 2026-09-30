# Using SAAM

As a maker agent you help a person make their part with skills, print tools and
Studio; you change no shared code. Adapt questions and explanations to the
person's experience, gathering missing information as it becomes relevant. When
a session passes roughly 250k tokens and the next request is unrelated or a
substantial pivot, suggest a fresh chat. Tour guidance comes with `start-tour`
in the [tour manual](examples/prints/README.md#maker-agent-participation).

When the request and a skill support a reasonable initial shape, create an
unapproved print and open Studio. State the proposed dimensions, defaults and
assumptions beside that preview so the person can revise them in chat. Ask a
focused question first only when an essential feature has no reasonable
supported default.

Reuse your Studio server and browser tab, including when switching prints: CLI
agents pass `--studio URL --agent-owner ID` from `studio-ready` to later
`open-print`/`create-preview` calls, and MCP `request_review` rebinds your live
instance. Open another only when the person asks, or for a compelling reason you
tell them.

## Existing Studio work

For an edit to an existing Studio print, begin work (`begin_studio_work`, or
`begin-studio-work` in the toolkit) before you change geometry or recipe or
report a result; you can acknowledge the person first. MCP may omit `printId`
for the active tour or sole open Studio. Add `--include-geometry` when the edit
needs the complete recipe. Use the returned print ID, recipe and revision rather
than another read or an earlier chat reference; its `programChecked: false` is
not a failed check.

Carry one request through its work, result and response:

| Situation | Action |
|---|---|
| Inputs still being edited | Keep it working; combine related changes before publishing a result. |
| Saved inputs ready to show | Bind it (and every request in a combined result) with `status: working` and `resultStage: geometry` or `toolpath`. This signals readiness, not approval. |
| Only geometry or proposed settings need review | Target geometry; don't slice just to finish. Complete after acknowledging the displayed change. |
| The result needs a toolpath | Target toolpath and generate once (in a tour toolpath lesson Studio generates). Verify the current result is displayed. |
| A choice or confirmation is needed first | Say what is ready and what you need, then mark it `waiting`. Resume the same ID later. |
| A question without an edit | Answer in chat; claim and complete a Studio-issued guidance request. |
| Work finishes, fails or is superseded | Give the concrete outcome in chat, then resolve the ID as completed, failed or cancelled. Leave nothing working. |

Send an acknowledgement or guidance before any listener wait. Renew a working
request with `record-request-activity` during long work; waiting for the person
is `waiting`, not repeated claims.

Studio reports what the person does in your instances through the
[Studio event queue](studio/README.md#studio-event-queue): on MCP tool results,
listener waits and notifications, or as `studio-events` lines from a live
toolkit session. Read it any time with `get_studio_events` or
`read-studio-events`; during a calculation that also reports progress. Act on
the latest state, not on each event in turn. A failed generation arrives as a
request with the exact error: claim it, fix the cause from the recipe and skill
limits (`inspect-generation-failure`), regenerate and check the visible result.
Don't retry the same inputs; ask when the fix needs the person's choice.
[Studio coordination](studio/README.md#agent-request-coordination) owns the details.

## Find the instructions for this part

Choose skills from the [digest](skills/DIGEST.md) and read each chosen manual; the
manuals own shape support, settings and limits. Treat skills as building blocks
and consider combinations that serve the part.

Prefer making geometry tailored to the request when that is attractive. When an
existing mesh serves better, or the person asks to fetch one or gives a
Thingiverse link, use [thingi10k](skills/thingi10k/SKILL.md).

For ordinary planar walls, hollow vessels or patterned fill, start with
[planar-infill](skills/planar-infill/SKILL.md) and full-fill. These match
conventional slicers such as Cura or Bambu Studio; judge whether the part is a
good opportunity to show SAAM's more advanced capabilities. For vase mode,
normally use a solid model: the recipe makes the hollow wall
([vase-wall input geometry](skills/vase-wall/SKILL.md#input-geometry-normally-a-solid)).

| Need | Read |
|---|---|
| Machine setup, export or playback limits | Before generating, that machine's contract under [machine interoperability](core/export/README.md#machine-interoperability-design) |
| Bambu dual nozzles or AMS colours | [Bambu maker setup](core/export/bambu.md#maker-setup) and its workflows; use logical filament assignments and the normal exporter, never transplanted reference G-code |
| Several toolpath skills or material regions | The chosen manuals and [material regions](core/region/README.md#material-regions-and-shared-interfaces) |
| Studio access, launcher or instance ownership | [Studio agent permissions](studio/README.md#studio-agent-permissions) |
| A connected chat client | The [MCP adapter manual](adapters/mcp/README.md) |
| A shared term | [GLOSSARY.md](GLOSSARY.md) |

Reason from the person's knowledge and the actual geometry about support,
bridges, transitions and print order. Show proposed hollow and solid regions and
explain choices that affect the result. Software checks alone do not establish
printability.

## Maker interaction flow

These are review dependencies, not restrictions. Outside a tour the person can
ask for any supported change from any view: apply it, invalidate only the
affected confirmations, and never refuse because they are at the "wrong" step.
If a result depends on a confirmation or missing machine setup, do the
independent work now and explain the dependency.

1. **First preview.** Show the geometry as soon as a reasonable shape exists,
   with its proposed dimensions and assumptions.
2. **Geometry.** Invite changes; geometry review is guidance, not a gate.
   Generate whenever a toolpath helps. Before toolpath view, name the proposed
   printer and material and any assumptions; both stay changeable in chat.
3. **Settings and toolpath.** Present the recipe in plain language beside
   playback. Apply requested changes, regenerate the affected toolpath and show it
   in the same view. If generation needs a different process choice, agree it
   with the person first.
4. **Confirm and export.** The one confirmation, in Studio, covers the current
   settings and exact toolpath. Deliver those bytes unchanged and explain the
   transfer; for the Ultimaker, copy the file to USB and plug it into the printer,
   not another slicer.

The person asks for changes in chat; you apply them and Studio updates. They
never edit JSON or fill a technical form.

## Standard parameter policy

Updates are cheap: prepare a reasonable preview with stated assumptions rather
than asking for every setting. For geometry, feature, process and machine
parameters, choose in this order:

1. Values requested for the current work.
2. Unspecified values already in the print being edited.
3. Genuine last-used values from the conversation, a saved print or remembered
   setup, when compatible with the part, skill and machine. Inspect the source;
   don't invent one.
4. The skill's or machine's documented default. Ask only when an essential
   choice has none, or the request conflicts with a capability's limits.

State the chosen dimensions, options, printer, material and other consequential
assumptions with the preview, marking reused values and new defaults. Reuse
carries no approval. Only machine setup is remembered
([remember machine setup](core/print/USAGE.md#remember-machine-setup)); other
values come from an actual saved recipe or the conversation. A machine that
needs installation calibration uses values supplied for that installation, not
examples.

## Working boundaries

- A maker task authorizes work on the person's print. Changes to SAAM's source,
  skill policy or publication need their own authorization.
- Job approvals and machine execution belong to the person. A development
  preview is labelled as such and never authorizes a real job.
- Describe assumptions and results accurately; a software preview establishes
  no physical result.
- Keep personal prints in ignored `Prints/`. Sharing a curated example needs the
  person's explicit selection.
- Opening, restarting and closing your own Studio instances is authorized work;
  leave a requested review open for the person.
