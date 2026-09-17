# Using SAAM

For a tour request, launch `node studio/server.mjs --toolkit start-tour --no-open`
immediately through the client's managed command session and open its returned
Studio URL. Read the context returned by that command after opening Studio;
no maker onboarding or manual read is a prerequisite for tour startup.

Your task as a maker agent is to help a person make their part. For a new custom
part with missing maker context, `node scripts/agent-toolkit.mjs maker-onboarding`
supplies this file, the complete skill digest and shared print tools in one call.
Use that returned text directly; do not read those sources before the command or
read them again afterward. If this context is already loaded, continue from it.
For an existing Studio print, begin/claim work first, before loading missing
context; [request coordination](#existing-studio-work) defines that operation.
Clients without the CLI read this file and the digest through their available
reader before the first maker-facing response. Adapt questions and explanations to
their experience, gathering missing information as it becomes relevant.

You use skills, print tools and Studio; you do not change shared code. If a
request needs a skill changed, Studio extended, or a code change of any kind,
that is builder work: tell the person you are switching to a builder role, run
`node scripts/agent-toolkit.mjs builder-onboarding`, and continue from
[builder context](BUILDERS.md). Core or cross-cutting development needs the
[developer role](AGENTS.md#choose-your-role) and the person's explicit request.
When a session grows past roughly 250k tokens and the next request is an
unrelated task or a substantial pivot, suggest the person start a fresh chat.

When the request and an available skill support a reasonable initial shape,
create an unapproved print bundle and open SAAM Studio. State the proposed
dimensions, defaults and assumptions beside that preview so the person can
revise them in chat. Ask a focused question first when an essential feature
has no reasonable supported default.

Reuse the existing Studio server and browser tab by default, including when switching prints; create another instance or tab only when the person asks.

## Existing Studio work

For an edit to an existing Studio print, call `begin_studio_work` immediately after receiving the
request, BEFORE an acknowledgement, status lookup or another
tool. Omit MCP printId to use the active tour or sole open Studio. CLI agents use
`node scripts/agent-toolkit.mjs begin-studio-work Prints/PART --instruction "Requested change"`;
omit the directory for the active tour, or use `--request ID` to claim
Studio-originated work. Add `--include-geometry` when the edit needs the complete
geometry recipe. The bundled CLI returns the current recipe and revision after
marking work pending; use those instead of another status/read call. The returned
print ID identifies the target; use it instead of an earlier chat reference.
Beginning an edit reads geometry and recipe context without checking the old
export; its returned `programChecked: false` is not a failed toolpath check.

Use one request through its work, result and response:

| Situation | Agent action |
|---|---|
| Inputs are still being edited | Keep the request working. Combine related changes before publishing a result target. |
| Saved inputs are ready to show | Bind that request with `status: working` and `resultStage: geometry` or `toolpath`. Bind every request included in a combined result. This is a readiness signal, not an approval. |
| Only geometry or proposed settings need review now | Target geometry and show it; do not slice merely to finish the request. Complete after acknowledging the displayed change. |
| The requested result needs a toolpath | Target toolpath. During a confirmed tour toolpath lesson Studio generates after that signal; outside the tour use explicit generation once. Verify the current result is displayed. |
| A choice or shape confirmation is needed first | Explain what is ready and what input is needed immediately, then mark the request `waiting`. Do not wait silently for a result that requires that input. Resume the same ID when work can continue; its saved target is retained. |
| A question needs an answer, without an edit | Answer in chat. For Studio-issued guidance, claim and complete its guidance request. Advice does not dim the preview or require generation. |
| Work finishes, fails or is superseded | Send the concrete outcome in chat, then resolve that ID as completed, failed or cancelled. Do not leave working requests behind. |

Send the acknowledgement or guidance before a listener wait. Keep tour listeners
active between lessons; an ordinary preview can be left for the person's next
chat request. Optional intermediate previews create no obligation to finish
superseded results. The [Studio coordination contract](studio/README.md#agent-request-coordination)
owns the CLI equivalents, result identity and waiting behavior.

## Tour startup

For a tour request in an already set-up checkout, the first useful result is
Studio showing lesson one. Launch
`node studio/server.mjs --toolkit start-tour --no-open` through the client's managed command
session, and open the returned URL with its browser integration. The
toolkit creates fresh copies, sets playback layer 12,
returns the URL first, then bundles the remaining participation guidance and
listener arguments. The direct `node studio/server.mjs --start-at-layer 12`
launcher remains available. Request an early
command yield (about one second when supported) so the persistent server does
not consume the command tool's default wait before its URL can be opened. New tours use
fresh copies of both bundled examples, regardless of earlier edits. Never resume
an old lesson for a new tour request. Keep the server session and viewer open.
Studio supplies the first task; do not add an introductory question in chat.

Reuse completed setup and permissions. Only an unused checkout needs
[first-use setup](SETUP.md) before launch. Do not put source searches, development
orientation, regression runs, skill selection or toolpath generation before the
first screen. Follow any required client/browser instructions when opening it.
The command returns this maker guidance and the
[tour manual](examples/prints/README.md#maker-agent-participation). Consume that
returned context once the screen is visible; do not reread the same files. Then
keep the returned Studio request listener active. Load the relevant skill
and adjustment instructions when an edit is requested. The initial launch creates
the tour print; `begin_studio_work` applies to subsequent work on that print.

## Tour participation

The eight-step tour starts with a
fin block and then the wavy roof. Use chat for requested changes; keep the tour
marker in place. Wait for Studio requests between lessons, offer infill options
as soon as the chat lesson starts. After the final download, promptly congratulate
her, offer help with any difficulties printing that file, and ask what she wants
to make next. Do not wait for her to request these
instructions. Send the congratulations, offer of printing help and next-project
question together as ordinary chat text. Never use a question box, form or
request-user-input tool for tour completion. If the client allows questions
only in a final response, send that complete message as the final response.
Prioritize it over timing notes, browser inspection and other bookkeeping.
Selecting the saved print (or an STL in its tour lesson) confirms
the chosen geometry before toolpath preparation. The final export confirmation
approves the displayed settings and exact toolpath; preview generation itself
creates no approval.

Preserve the tour's gradual introduction: Studio provides the early lesson
guidance. Do not repeat its first task, ask an introductory question, or prompt
the person to press Play in chat. Respond when the person requests an edit;
otherwise do preparatory agent work silently. Proactive teaching in chat begins
only at the designated infill lesson, followed by the requested congratulations
after completion. A development status update must not become an extra maker
instruction or move the participant into the next lesson.

During a toolpath lesson, Studio automatically generates after saved process or
machine changes have a published request target and keeps its viewport busy through loading. Do not launch a
second CLI generation alongside it or wait for an unstarted task. Check the
current rendered toolpath before resolving the request. Outside the tour, use
the ordinary explicit generation flow.

Studio also queues explicit generation failures with their exact error. Claim
that request promptly, inspect the current recipe and relevant skill limits, and
apply an appropriate correction before regenerating. Explain material process
changes, preserve human confirmations, and verify the current toolpath is visible
before resolving recovery. Do not blindly retry the same inputs. If recovery
needs a maker choice, ask for that choice and keep the failure actionable.

During a tour, keep `wait_for_studio_request` active between lessons and repeat
after its bounded timeout. Send each edit acknowledgement in commentary BEFORE
starting a wait: a final answer held until the listener ends can arrive a lesson
late. On the infill request, offer the choices in chat
immediately, then wait for the person's choice. This requires an active connected
agent; Studio does not wake an ended or disconnected chat by itself.

For CLI listeners, `node studio/agent-requests.mjs wait Prints --claim` runs for up to
25 seconds. If the command tool returns a running session ID, keep reading that
same session (in Codex, `write_stdin`) until it returns the JSON result. Do not
start a background listener and end the turn, abandon its session, or treat a
session ID as an empty result. The flag claims returned requests in the same
call; do not claim them again. Read each returned request, send its
guidance or complete silent preparation, and resolve it. Repeat empty bounded
waits while the tour is active. Only the designated infill and completion lessons
initiate chat teaching; the early lessons remain Studio-led.

Signals may accumulate while another request is being handled. Check their
relevance against the current print and lesson context before acting. Cancel
obsolete lesson guidance instead of teaching a lesson the participant has left;
diagnose generation failures against the current recipe rather than blindly
replaying an old request. Renew a working request before its ten-minute lease
expires if long-running agent work is still active; waiting for the person uses
`waiting`, not repeated claims.

Load STL files without a units popup or pre-import units question. The shared
importer assumes reasonable units from size unless the person specified them;
show the resulting size and allow later correction through chat. This applies
inside and outside the tour. [Print-tool guidance](core/print/USAGE.md#import-an-stl)
owns the provisional heuristic and unit-correction commands.

## Find the instructions for this part

For a new custom part, use the brief [capability digest](skills/README.md) supplied
by onboarding (read it only if missing), then choose and read the selected skill manual and use its
packaged tools. Tour startup uses its bundled examples and defers these reads
until a requested edit needs them. The
manuals own shape support, settings and process limits.

Treat these capabilities as building blocks: the applications described are
starting points, and you should consider other uses and combinations when they
serve the person's part, checking the relevant manuals for support and limits.

Prefer creating geometry tailored to the person's request with the available
tools when making it is an attractive option. When an existing mesh better serves
the request, or the person asks to fetch a model or supplies a Thingiverse link,
use the [Thingi10K skill](skills/thingi10k/SKILL.md) to search the mirror and import
an individual STL. For a supplied Thingiverse link, check mirror membership first;
if absent, ask the person to download the STL herself and provide it for import.
For every downloaded mesh, briefly identify its source in chat unless obvious
from the request, and always provide a clickable link to that file's license.
Check each model's exact license and intended-use permissions; preserve its
creator, source link, license and required change notices with shared results.
Prefer verified public-domain or CC BY models; CC BY-SA also requires compatible
licensing of shared adaptations. Dataset license labels alone are not sufficient.

For ordinary planar walls, hollow vessels or patterned fill, start with [planar-infill](skills/planar-infill/SKILL.md) and its full-fill composition guidance. These skills match most closely to legacy 3d printing slicers like cura or bambu studio, and your judgement will be required as to whether it's a good opportunity to show off some of SAAM's more advanced capabilities.

For continuous vase mode, normally use a solid model: the printing recipe makes
the hollow wall, so the model needs no hole. See [vase-wall input geometry](skills/vase-wall/SKILL.md#input-geometry-normally-a-solid)
for the distinction between the solid guide and the printed wall.
For motifs, authored patterns or fitted mesh sleeves, use the separate
[advanced vase mode manual](skills/advanced-vase-wall/SKILL.md).

Follow additional references when the part needs them:

| Need | Read |
|---|---|
| Initial installation or Studio access | [Setup and checks](SETUP.md), then [Studio agent permissions](studio/README.md#studio-agent-permissions). |
| Machine-specific setup, export or playback limits | The relevant contract under [machine interoperability](core/export/README.md#machine-interoperability-design). |
| Several printing patterns or material regions in one part | The chosen skill manuals and [material regions](core/region/README.md#material-regions-and-shared-interfaces). |
| Sacrificial or edge supports | [Supports](skills/supports/SKILL.md), [rimming-planar](skills/rimming-planar/SKILL.md) or [rimming-normal](skills/rimming-normal/SKILL.md), as applicable. |
| Creating or importing a print, changing settings or reusing setup | [Shared print tools](core/print/USAGE.md). |
| A connected chat client | The [MCP adapter manual](adapters/mcp/README.md), including its connection and local-file access limits. |
| A saved print | [Opening local prints in Studio](studio/README.md#opening-local-prints-in-studio). |

Read missing references relevant to the part and workflow; the onboarding's
shared print-tool text already satisfies links to its sections. Use
[GLOSSARY.md](GLOSSARY.md) when a shared term needs clarification.

Use the maker's knowledge and the actual geometry to reason about support,
bridges, transitions and print order. Show the proposed hollow and solid regions
and explain choices that affect the result. The selected skill's limits and
Studio inspection inform this judgment; software checks alone do not establish
printability.

## Maker interaction flow

These are review dependencies, not capability restrictions. Outside a tour, a
person can ask for any supported geometry, process, printer, material, inspection
or export operation from any view. Apply supported changes when requested and
invalidate only the affected confirmations. If a requested result depends on a
human confirmation or missing machine setup, do the independent work now and
explain that actual dependency. Never refuse supported functionality because the
person is in the "wrong" step. Tour-only teaching limits live in the
[tour participation manual](examples/prints/README.md#maker-agent-participation).

The person confirms geometry, then settings and the exact toolpath together.
Geometry can be confirmed in Studio or by an explicit chat statement approving
the current resulting shape. Record chat approval with the shared
[geometry confirmation command](core/print/USAGE.md), including its current revision,
geometry hash and chat reference; permission to make an edit is not approval of
its result. Final settings/toolpath confirmation stays in Studio.

1. **Prepare the first preview.** Initialize the print and show its geometry as
   soon as a reasonable shape is available. State the proposed dimensions and
   assumptions, and revise them through conversation.
2. **Confirm geometry.** Show the shape and dimensions until the person is ready.
   Establish the printer and material before this confirmation opens the toolpath.
   Geometry confirmation starts generation directly; there is no settings pane
   or separate settings confirmation.
3. **Review settings and toolpath together.** Present the recipe in plain language.
   Studio shows the printer, material and expandable full settings beside playback
   of the checked machine commands. The person may request infill, material,
   printer or other changes here. Apply them, regenerate the affected toolpath
   and show the result in the same view. Changed geometry returns to geometry
   confirmation; settings-only changes keep it. In a tour, geometry review temporarily
   replaces the view and either confirmation input returns to the same lesson.
4. **Confirm and export.** The final confirmation covers both the current settings
   and the exact toolpath. Deliver those bytes unchanged. Explain the relevant
   transfer method: for the Ultimaker example, download the machine file, copy it
   to USB and plug the USB directly into the printer, not another slicer.

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

## Standard parameter policy

Use this policy for geometry, feature, process and machine parameters across
skills. Updates are cheap: prepare a reasonable preview with stated assumptions
and let the person revise it through chat instead of asking for every setting.

Choose values in this order:

1. Apply values explicitly requested for the current work.
2. Preserve unspecified values in the current print when editing it.
3. Otherwise reuse the genuine last-used values available from the conversation,
   saved print or remembered setup, when compatible with the current part, skill
   and machine. Inspect the saved source; do not invent a last-used choice.
4. Where no usable prior value exists, use the relevant skill or machine's
   documented default as a proposed starting value. Ask a focused question only
   when an essential choice has no reasonable supported default, or the request
   conflicts with a capability's limits.

State the selected dimensions, feature options, printer, material and other
consequential assumptions with the preview, identifying reused values and new
defaults as applicable. An explicit requested change takes precedence on the next
revision. Reuse is a starting point and carries no geometry, settings, toolpath
or manufacturing approval; the ordinary Studio confirmations still apply.

The [shared print tools](core/print/USAGE.md#remember-machine-setup) own persisted
machine setup. Other parameters can be reused from an actual saved recipe or
conversation; this policy does not imply that every skill automatically stores
its last-used values.

## Printer setup and assumptions

Establish the relevant dimensions, intended use, machine, installed tool/nozzle
and material under the [standard parameter policy](#standard-parameter-policy).
Before entering toolpath view, identify the proposed printer and material and
tell the person any assumptions. Both remain changeable through chat from the
toolpath/settings view.

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
  [development testing boundary](BUILDERS.md#testing-through-the-use-context).
- Describe assumptions, observed behavior and unsupported results accurately.
  A software preview establishes no physical print result.
- Keep personal bundles in ignored `Prints/`. Sharing a curated example requires
  explicit selection by the person.

Opening, inspecting, restarting and closing your own Studio instances are part
of authorized project work. Follow the [Studio instructions](studio/README.md#studio-agent-permissions)
for the launcher, client permissions and instance ownership, and leave a
requested review open for the person.
