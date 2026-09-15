# Guided tour

Ask your agent to open the SAAM tour. After [setup](../../SETUP.md), the ordinary
Studio launcher opens it directly:

```sh
node studio/server.mjs --start-at-layer 12
```

Agents with command access start immediately with
`node studio/server.mjs --toolkit start-tour --no-open`, open the returned URL,
then consume the command's participation context and listener arguments.
The command supplies the maker guidance; no onboarding or manual read comes
before launch in an already set-up checkout.

Follow **Next** and **Back** through eight lessons. **Exit tour** is always
available and restores normal review controls. Your place and edits are saved.
A launch without a print path starts a new tour at lesson one with fresh
starter and wavy-roof copies from the bundled sources, preserving earlier parts
and ignoring their edits. The header's **Tour** button starts a fresh tour directly
in the handle geometry view when no tour is active. There is no welcome or
introductory pane. During an active tour, **Tour** toggles the lesson guidance.
To continue saved progress, open its print path and explicitly
choose **Resume tour** when paused. Refreshing an active viewer keeps its lesson.

| Lesson | Unlocks Next |
|---|---|
| A simple block with a raised fin | Ask the agent to change its geometry; Next unlocks after the changed geometry is displayed. |
| The wavy roof | Change it or proceed immediately. Active work locks Next; displaying the changed geometry unlocks and highlights it. |
| Open print | Choose one of the two saved parts. Studio immediately advances to the optional STL lesson, keeping geometry visible. |
| Import STL | Optionally load an STL with units assumed from its size. A clean import advances automatically; an automatically repaired import stays in geometry review until confirmed. Next otherwise keeps the selected part. |
| Playback | Press Play and watch for five seconds. Scrubbing and speed remain free. |
| Chat guidance | The agent offers infill patterns or another toolpath change; Next unlocks after the regenerated toolpath is loaded and displayed. |
| Printer and material | Ultimaker S5 and PLA are the initial choices. Keep them or ask the agent to change them. |
| Export | The highlighted control explains downloading a file to USB for the printer directly, rather than a separate slicer. Confirm settings & export downloads the reviewed file and completes the tour. There is no separate Finish button. |

The agent explicitly chooses `startAt: {layer: 12}` (zero-based layer index)
for the playback lesson. Choose an actual sparse-infill layer after the first
layer; Studio seeks to its infill move. If no layer is supplied, or an edit removes
infill from the chosen layer, Studio starts at layer 2 or the first deposited
layer for a one-layer model. The participant can
then move the slider freely; the gate measures five seconds of visible playback
in wall time, regardless of speed or position.

### Maker agent participation

The tour deliberately narrows the conversation to its current lesson. In the
first two lessons, offer shape edits to the selected example; use Open print and
Import STL in their designated lessons, playback controls while watching, recipe
changes in the chat lesson, printer/material changes in setup, and final export
in the export lesson. Questions about the current lesson are always welcome.
For an unrelated project, a new capability or an action belonging to another
lesson, gently redirect: "We can do that outside the tour. For this lesson,
let's change the fin's height; or choose Exit tour to work on your request now."
Do not silently leave, skip lessons or edit another part. An explicit request to
exit ends these teaching limits. Normal Studio accepts supported requests from
any view; a tour restriction must never become a general capability refusal.

The dots and viewport fading are **Updating preview**. Show intermediate results
only when useful; advice, listener waits and download bookkeeping do not require
dimming. Use the [maker request lifecycle](../../MAKERS.md#existing-studio-work)
for work, target publication, pauses and responses.

Keep requested edits in the current selected copy returned by begin-work or
`get_tour`. Call `begin_studio_work` before editing, publish its saved result
target, and resolve its ID after the requested preview is displayed
with `respond_to_studio_request`. Keep `wait_for_studio_request` active between
lessons, repeating its bounded waits. Studio queues requests for the infill
lesson, an imported model’s explicit start layer, and completion. Claim each
request and resolve it after doing its work. Prepare an imported model's start
layer silently; Studio supplies the playback instructions. Give proactive chat
guidance only for the designated infill lesson and completion. Before then, let
the participant read Studio and respond to her requested edits without adding
introductory questions or repeating the UI's tasks. Local CLI equivalents are in
[Studio coordination](../../studio/README.md#agent-request-coordination). An ended
or disconnected chat is not automatically awakened. Local agents can read
`node studio/tour.mjs status Prints` and choose the layer with
`node studio/tour.mjs start-at Prints 12`.
At the chat lesson, offer rectilinear (parallel), grid (crossed), triangles,
gyroid (curving), or concentric (nested) infill, and mention other toolpath edits.
Wait for her choice and apply it; Studio automatically regenerates the selected
confirmed part at toolpath lessons. Verify the rendered result before resolving
the edit request. At completion,
immediately congratulate her, offer help with any difficulties printing the
downloaded file, and ask what she wants to make next. These messages belong in
ordinary text chat. Never use a generic question box or request-user-input tool
for completion. Prioritize this message over status checks and bookkeeping.

Imported models reset the start layer: the maker agent can choose an actual sparse
infill layer from the existing toolpath, while the layer-2 fallback allows playback
and its five-second timer to proceed without waiting. A late choice does not
reset playback after the participant has started watching. An explicit layer that
no longer has infill also uses the fallback. Never edit or reslice a part solely
to provide a viewing position. Saved part names
and download filenames describe their shapes and lettering, such as
**Named handle · Nave**. Existing bundle directory names are preserved. Tour
highlights blink with a simple slate-blue outline. All tour small text uses the
selected bold treatment. Dots and highlights retain opacity/color animation,
including under reduced-motion settings; they do not move or expand.

Selecting a saved print confirms its current geometry and keeps geometry visible
through the optional STL lesson. A worker prepares the selected part during
that lesson without blocking geometry review or persisting output. **Continue
with this part** uses that candidate and opens playback. Import creates another
saved part; it does not replace the part already selected. **Open print** can
reopen either saved copy later.
Selecting an STL during its tour lesson confirms that imported geometry before
its preview is generated when no repair was needed; repaired geometry requires
the explicit **Confirm repaired geometry & continue** action. Both versions and
the repair report remain saved. Skipping keeps the already confirmed selected part.
The finished panel says “Congratulations!” and directs the participant back to
chat for the next project. The final confirmation approves the displayed settings and exact toolpath,
downloads that checked production output without reslicing. Production output
is prepared after geometry selection, before toolpath review; final settings
confirmation still belongs to the participant. A stale program must be
regenerated and reviewed again. Completion follows receipt of the download in
the browser; browser or OS download prompts remain under the person’s control.
**Exit tour** leaves without marking completion and restores ordinary review.
It is also available on the congratulations screen, where it dismisses the tour
and retains the completed result. Step 3 fades the geometry until a print is
selected; step 4 restores it and marks both choices with large arrows and the
same slate-blue blinking outline and button colors.

### Example recipes

| Example | Explore |
|---|---|
| [Wavy roof](surface-drape/README.md) | Transverse waves and a downhill fall, with flat body layers and a surface-following skin. |
| [Nudge Cup](nudge-cup/README.md) | Mesh geometry, a spiral wall, a weighted foot and a curved skin in one useful object. |
| [Wavy DENSO](wavy-denso/README.md) | A wavy spline substrate and composed axial/helical cladding with robot/rotary output. |

The starting shapes are bundled as source recipes: the
[handle/fin block](starter/recipe.mjs) and [wavy roof](surface-drape/recipe.mjs).
Nudge Cup and DENSO remain optional recipes outside the two starting tour shapes.
Studio creates both tour examples at the start under ignored `Prints/tour/`,
adding a suffix when a folder already exists. Both use the shared bundle initializer
with no generated toolpath or inherited approval. **Open print** reopens these saved
copies. Starting another tour makes a pristine pair, preserving earlier work.

Exiting or finishing starts normal review of your copy. During the tour, ask
your agent to edit the current copy with the ordinary adjustment tools; keep
its tour marker in place. The guide stays
on the same step and reuses the edited copy when navigating or explicitly resuming. At a
toolpath step, Studio automatically prepares changed process or machine inputs
using the normal generation worker after geometry confirmation. Generation
creates no human approvals. Review
the geometry, then settings and toolpath together before printing. Tour examples have
no inherited approvals or personal machine calibration. The
[maker guide](../../MAKERS.md) owns those reviews.

## Maintaining the examples

Recipes are editable source. To regenerate a set in a new local directory:

```sh
node examples/prints/create.mjs all Prints/tour-refresh --generate
```

The optional arguments are the example ID (or all) and output directory.
Omit `--generate` to create geometry and settings only. Review generated examples
in Studio; generated bundles, display data and machine programs remain local.
The repository carries recipes rather than `prepared/` packages. Studio uses the
normal generation worker and source interpreter when the tour reaches toolpath
review, so playback and export follow the same current lifecycle as other prints.
