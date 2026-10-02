# Guided tour

Ask your agent to open the SAAM tour. With command access it starts
`node studio/server.mjs --toolkit start-tour --no-open`, opens the returned
Studio URL and keeps that session alive. Studio gives the first task.

The tour uses one saved copy of the fin block. Follow **Next** and **Back**
through five lessons:

| Lesson | Continue when |
| --- | --- |
| Change the shape | Ask for a fin edit and see the changed geometry. |
| Watch how it prints | Press Play. Pause, scrub and change speed freely. |
| Change how it prints | Choose a printing change in chat and see the new path. |
| Check printer and material | Compare the displayed setup with your actual printer and filament; ask the agent to correct either one. |
| Export or finish viewing | Export the current checked file for a matching setup, or choose **Finish without export**. |

The starting Ultimaker S5 and PLA settings are examples. They are not a claim
that the file is ready for your printer. **Confirm settings & export** saves the
exact checked machine file on screen; a pending change hides Export until the
new file has been reviewed. No printer is needed to finish the viewing tour.

**Exit tour** stops without marking completion and keeps the part as an ordinary
print. A fresh tour creates a fresh copy. Your lesson and edits survive a page
refresh or Studio restart: reopen the same saved print to resume. The **Tour**
button toggles guidance while a tour is active. Import STL and other saved
prints are available after finishing or exiting.

## Maker agent participation

Studio leads each lesson. Do not add an introduction or repeat its instructions.
Wait for the participant's geometry request, apply it to the active tour copy,
and verify it is visible. For the printing lesson, offer a dramatic infill change
(such as 20% to 70%) or another visible fill pattern, explaining the material/time
tradeoff. Choose if asked; show an interior layer and compare the estimates.
Small wall-count or speed changes are poor first demonstrations. At setup,
establish the actual printer and filament, or finish by viewing.

Use the [maker request lifecycle](../../studio/README.md#carrying-a-maker-request).
Start work against the selected directory from `get_tour` or begin-work and
keep its tour marker. Studio generates the path when the lesson needs it.
Do not generate again merely to choose a playback position. Studio selects an
informative deposited layer; `set_tour_start_at` may override it when useful.
Claims are scoped to the tour run and lesson. A lesson left behind
or a Studio instance that closes cancels its outstanding requests; a reopened
instance gives the resumed lesson fresh request authority.

Keep the managed Studio session and its `wait-for-studio-request` listener
active between lessons. Use the `studio-ready` URL and owner ID; with the CLI:

```sh
node scripts/agent-toolkit.mjs wait-for-studio-request --studio URL --agent-owner ID --claim
```

Read a returned running command session to its JSON result. Handle the current
print and lesson only. If the participant requests unrelated work, offer
**Exit tour** so you can do that work without silently changing this part.
On completion, state once whether the file downloaded or the tour ended by
viewing, then offer help with printing or another part.

## Other examples

| Example | Explore |
| --- | --- |
| [Wavy roof](surface-drape/README.md) | Transverse waves, a downhill fall and a surface-following skin. |
| [Nudge Cup](nudge-cup/README.md) | Mesh geometry, spiral wall, weighted foot and curved skin. |
| [Wavy DENSO](wavy-denso/README.md) | Spline substrate and axial/helical cladding with robot output. |

Their recipes and the [fin block recipe](starter/recipe.mjs) are editable sources.
To make local copies under a new directory:

```sh
node examples/prints/create.mjs all Prints/tour-refresh --generate
```

Omit `--generate` for geometry and settings only. Review generated examples
in Studio; generated bundles and machine files stay local.
