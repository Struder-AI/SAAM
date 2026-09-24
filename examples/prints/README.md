# Guided tour

Ask your agent to open the SAAM tour. After [setup](../../SETUP.md), the ordinary
Studio launcher opens it directly:

```sh
node studio/server.mjs --start-at-layer 12
```

Agents with command access run `node studio/server.mjs --toolkit start-tour --no-open`
before anything else, open the returned URL, then use the command's
participation context and listener arguments.

Follow **Next** and **Back** through eight lessons. **Exit tour** is always
available and restores normal review. Your place and edits are saved, and
refreshing keeps the lesson. A launch without a print path, or the header's
**Tour** button when no tour is active, starts lesson one with fresh copies of
both starting shapes; earlier copies are kept. During a tour, **Tour** toggles
the lesson guidance. To continue saved progress, open its print path and choose
**Resume tour**.

| Lesson | Unlocks Next |
|---|---|
| A simple block with a raised fin | Ask the agent to change its geometry; Next unlocks once the change is displayed. |
| The wavy roof | Change it or proceed. Active work locks Next; the displayed change unlocks it. |
| Open print | Choose one of the two saved parts; this confirms its geometry. |
| Import STL | See where normal Studio imports a model; import stays unavailable until the tour ends. Continue keeps the selected part. |
| Playback | Press Play. Next unlocks immediately; playback, scrubbing and speed stay free. |
| Chat guidance | The agent explains the toolpath and suggests process changes; Next unlocks once the changed toolpath is displayed. |
| Printer and material | Ultimaker S5 and PLA to start. Keep them or ask the agent to change them. |
| Export | Confirm settings & export downloads the reviewed file for USB transfer to the printer and completes the tour. |

### Maker agent participation

**Scope.** The tour narrows the conversation to its current lesson: shape edits
in the first two, Open print in its lesson, pointing out that STL import comes
after the tour, playback while watching, recipe changes in the chat lesson,
printer and material in setup, and export last. Questions about the current
lesson are always welcome. For anything else, redirect gently: "We can do that
outside the tour. For this lesson, let's stay with the current tour task; or
choose Exit tour to work on your request now." Never silently leave, skip
lessons or edit another part. An explicit request to exit ends these limits; a
tour limit is never a general capability refusal.

**Studio leads.** A new tour request always starts fresh; never resume an old
lesson for it. Keep the server session and viewer open. Don't ask an
introductory question, repeat Studio's task or prompt Play; respond to requested
edits and otherwise work silently. A development status update must not become
a maker instruction or advance the lesson. Show intermediate results (the
**Updating preview** dots and fading) only when useful; advice and waits don't
dim the viewport.

**Requests.** Edit the current selected copy returned by begin-work or
`get_tour`, keeping its tour marker, through the
[maker request lifecycle](../../MAKERS.md#existing-studio-work). Studio queues
requests for the chat lesson, the playback start layer and completion; lesson
changes also arrive as Studio events. Claim each, do its work, resolve it.

- Keep `wait_for_studio_request` active between lessons, repeating its bounded
  waits. Send each acknowledgement in commentary before starting a wait; a final
  answer held until the listener ends arrives a lesson late. An ended or
  disconnected chat is not woken.
- CLI listener: `node scripts/agent-toolkit.mjs wait-for-studio-request --studio URL
  --agent-owner ID --claim`, with both values from `studio-ready`; without the
  owner ID it hears nothing. It runs up to 25 seconds and also returns Studio
  events; `--claim` claims returned requests, so don't claim them again. If the
  command tool returns a running session ID, keep reading that session (in
  Codex, `write_stdin`) until it returns JSON. Never start a background listener
  and end the turn, or treat a session ID as an empty result. Other CLI
  equivalents are in [Studio coordination](../../studio/README.md#agent-request-coordination).
- Signals can pile up while you handle another request. Check each against the
  current print and lesson, and cancel guidance for a lesson the person has left.

**Playback start layer.** Silently choose an actual sparse-infill layer after
the first (`startAt: {layer: 12}`, zero-based) with MCP `set_tour_start_at` or
`node studio/tour.mjs start-at Prints 12`; `node studio/tour.mjs status Prints`
reads tour state. Without a usable choice Studio starts at layer 2, and a late
choice doesn't reset playback already started. Never edit or reslice a part just
for a viewing position.

**Chat lesson.** Briefly explain that the toolpath controls how the confirmed
shape is built, then immediately offer two or three toolpath or process changes
suited to the recipe and choices already made, each with its likely effect on
strength, finish, print time or material use. Use known context, with at most one
current-print read. Send this before another wait, status check or browser
inspection. Don't suggest geometry or repeat a settled choice, but oblige an
independent geometry request. Apply the person's choice; Studio generates once a
saved change has a published target, so don't start a second generation or wait
for one that hasn't started. Verify the rendered result before resolving.

**Completion.** After the download, immediately congratulate the person, offer
help with any difficulties printing the file, and ask what they want to make
next, together in ordinary chat. Never use a question box or request-user-input
tool; if the client allows questions only in a final response, send the whole
message as the final response. It comes before status checks and bookkeeping.

### Example recipes

| Example | Explore |
|---|---|
| [Wavy roof](surface-drape/README.md) | Transverse waves and a downhill fall, with flat body layers and a surface-following skin. |
| [Nudge Cup](nudge-cup/README.md) | Mesh geometry, a spiral wall, a weighted foot and a curved skin in one useful object. |
| [Wavy DENSO](wavy-denso/README.md) | A wavy spline substrate and composed axial/helical cladding with robot/rotary output. |

The two starting shapes are source recipes: the
[handle/fin block](starter/recipe.mjs) and [wavy roof](surface-drape/recipe.mjs).
Nudge Cup and DENSO are optional. Studio creates the tour copies under ignored
`Prints/tour/` (suffixed when a folder exists) with the shared bundle
initializer, no toolpath and no inherited approvals or personal calibration.
At a toolpath step Studio prepares changed inputs with the normal generation
worker; generation creates no approval. Exiting or finishing starts normal
review of your copy.

### Tour presentation

Selecting a saved print confirms its geometry, which stays visible through the
STL introduction while a worker prepares the part without persisting output.
Step 3 fades the geometry until a print is selected; step 4 restores it and marks
both choices with large arrows. **Continue with this part** uses that candidate
and opens playback; it keeps the normal orange primary style while **Import STL**
keeps the slate-blue teaching style. Both blink until the first hover over Import
STL, which leaves only Continue blinking. Tour highlights are a simple blinking
slate-blue outline; dots and highlights animate opacity and colour only, even
with reduced motion, and never move or expand. Tour small text is bold. Part
names and download filenames describe shape and lettering (**Named handle ·
Nave**); existing bundle directory names are kept.

The final confirmation approves the displayed settings and exact toolpath and
downloads that checked production output without reslicing; a stale program is
regenerated and reviewed again. Completion follows the browser's receipt of the
download. The finished panel says "Congratulations!" and points back to chat.
**Exit tour** leaves without marking completion; on the congratulations screen
it dismisses the tour and keeps the completed result.

## Maintaining the examples

Recipes are editable source. To regenerate a set in a new local directory:

```sh
node examples/prints/create.mjs all Prints/tour-refresh --generate
```

The optional arguments are the example ID (or all) and output directory.
Omit `--generate` to create geometry and settings only. Review generated examples
in Studio; generated bundles, display data and machine programs remain local.
The repository carries recipes rather than `prepared/` packages; at toolpath
review, playback and export follow the same lifecycle as other prints.
