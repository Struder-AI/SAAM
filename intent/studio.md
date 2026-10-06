# Studio

What the person sees and does: the viewer, windows, dimming, export, the Connect pane, colours and the tour. [Index](README.md)

## The viewer shows SAAMpath
> "The toolpath viewer ... needs to run the same machine file the machine will get." — owner, 2026-09-08 ([D-009](../DECISIONS.md#d-009--the-viewer-runs-the-delivered-machine-files))
>
> "Ok decision: viewer shows the saampath. Adapters are responsible for making sure they accurately translate saampath into their machine format" — owner, 2026-10-06 (Claude 14d40329 03:37, queued)

Summary: Studio draws the SAAMpath, not a decoded machine program; the 10-06 decision overrides D-009. **Owner question pending**: the build draws the adapter's *prepared* path (adapter design A3, an agent recommendation) rather than the saved SAAMpath.

Sources: [D-009](../DECISIONS.md#d-009--the-viewer-runs-the-delivered-machine-files); [0.3.6 "Machine adapters for builders"](../plans/0.3.6.md); Claude 14d40329 03:31 ("I wonder if we need to move away from displaying gcode or whatever output in the viewer, show saampath instead"); `.local/team/questions-036.md` A3.

## Export captures the moment
> "You aren't getting it. You don't have to confirm they are current. That's extra complexity. The button captures an instantaneous moment. You don't have to confirm it's currency." — owner, 2026-10-01 (Codex 01a0f706 11:15)
>
> "If recipe changes, but no toolpath regen started, export still works, no viewer preview changes. If toolpath is regen, studio goes into "waiting" mode and export is unavailable and previous viewer results are still there, but dimmed. If geometry changes, toolpath is GONE from viewer and must be regenerated, nothing can be exported, geometry viewer shows the new geometry. We need all this in one tight, simple flow, NOT a clusterfuck of special cases." — owner, 2026-10-03 (Codex 01a102ba 18:16)

Summary: the person's one Export click confirms the current settings and the exact program on screen and saves it, with no re-check, regeneration or extra ceremony; a recipe edit leaves the last program exportable until regeneration starts, regeneration hides Export, and a geometry edit clears the toolpath.

Sources: Codex 01a0f706 10:52 ("There shouldn't really be any special cases here."); Codex 01a102a0 17:33; [0.3.1 Export bullet](../plans/0.3.1.md); [0.2.0 Settled intent](../plans/0.2.0.md#settled-intent) ("the person confirms settings and exact toolpath"); owner's guidance prompt 2026-10-02 (three-approval ceremony removed; supersedes [D-011](../DECISIONS.md#d-011--three-human-approval-stages)); [Bundle](bundle.md#bundle-state-no-fingerprints-or-approvals).

## Agent work is always visible
> "if the non-application route can't get to studio, it shouldn't exist. Everything should be through application. Agents don't get to try things for themselves, everything they do should get a user view in studio, even if it's incomplete and will stay dimmed out (right?)." — owner, 2026-10-05 (Claude 28ca77c4 01:38)
>
> "Changes the agent makes should push to studio, even if further revision is then needed - both agent AND user should get to see the intermediate results. I do NOT mean the agent must stop and ask for user input at each step" — owner, 2026-10-03 (Codex 01a102a0 19:14)

Summary: everything an agent does shows in Studio as it happens, including unfinished intermediate results.

Sources: [0.3.3 "One route: everything through Application"](../plans/0.3.3.md); [Application](application.md#one-route-through-application).

## Dimming means the agent is at the SAAM desk
> "So agent should un-dim if the work is ready for user to look at, or if the agent must now interact with the user, or if the user has interrupted with a message, it should also undim (… I want it to undim when that current revision finishes). BUT I don't want an iterative agent workflow, where they do a series of edits *without* user interaction, to dim on/off/on/off constantly." — owner, 2026-10-03 (Codex 01a102a0 19:14)
>
> "Dim status should be about whether the agent intends to keep working without a 2-way interaction with the user (keep dimmed), or whether the agent intends to perform a 2-way interaction with the user before the next operation (or is currently performing one). The tricky part is that IF the user interrupts, dim status should END after the current operation finishes (unless the agent has queued another one in the meantime)." — owner, 2026-10-05 (Claude 98e25b54 03:33)
>
> "Dimmed means "the agent is working over at the saam desk" in other words, not interacting with the user right now. Un-dim means "agent is interacting with you" (or that it has interacted with you and nothing has changed since then)." — owner, 2026-10-06 (Claude 14d40329 03:22, queued); "There are two ways to bring the agent from the saam desk (dimmed) to the interaction counter … one is if the agent finishes something (easy case), the other is if the user interjects a chat" (03:26); "Dim stuff looks good, green light." (03:43)

Summary: Studio is dimmed while the agent works without talking to the person and un-dims when it finishes something or the person interjects (after the current operation), on both Claude Code and Codex, without flicker during a run of edits. **Owner questions pending**: (a) whether incomplete work stays dimmed after hand-back (10-05 01:38 "(right?)"); (b) the approved design's D4 accepts re-dimming flicker when a background subagent edits after the turn ends.

Sources: [0.3.5 "Dimming by client turn-end signal"](../plans/0.3.5.md); [0.3.6 "Dimming means the agent is at the SAAM desk"](../plans/0.3.6.md); `.local/team/dimming-design.md`; `.local/team/questions-036.md` 1-2; `.local/team/questions.md` R1(a); Claude e6f170be 10-05 18:22 ("I've fully clarified this intent multiple times").

## Windows and instances
> "When Studio or SAAM restarts, we have the bundle state saved, we reattach new entities to that bundle and continue work. If the chat session disconnects, or goes idle, the chat session should be able to reconnect to it's old instance … OR fine to restart from bundle in that instance too, if it isn't, as long as that doesn't result in abandoned studio windows accumulating on the screen. In fact it would be nice if a chat could connect to any available studio instance/window." — owner, 2026-10-05 (Claude 98e25b54 04:34, queued)
>
> "there should be a studio window that the viewer can see for every runtime the agent is using (and the agent should reuse those, not bombard the user with dozens of windows)." — owner, 2026-10-05 (Claude 98e25b54 04:02)
>
> "two tabs on one address - serve them both, this will be the rare instance when we don't preserve the 1 to 1 expectation (the user expressed direct intent otherwise, and local url competency)" — owner, 2026-10-05 (Claude 98e25b54 04:38)

Summary: one Studio window per bundle, keeping its address across restarts and reloading from the bundle; chats reattach to their window or any available one, idle windows are reused before opening new ones, and two tabs on one address are both served.

Sources: [0.3.1 "One Studio instance per bundle"](../plans/0.3.1.md); [D-044](../DECISIONS.md#d-044--architecture-led-030); [0.3.3 "One SAAM orchestrator per OS"](../plans/0.3.3.md); Codex 01a0fb05 05:49 ("Instances will simply accumulate").

## The Connect pane
> "re-introduce the two lights - one for update service connector, one for chat pair. Also the connect pane is too wordy and repetative." — owner, 2026-10-02 (Codex 01a0fe5d 21:27)
>
> "I don't like having all those buttons up top. Let's remove undo/redo - these functions remain available through chat request only." — owner, 2026-10-02 (Codex 01a0fe5d 21:27); "let's use "help" instead of "manual", "import" instead of "import STL"" (21:44)
>
> "Retry client setup button should be avoided, that presents to much complexity to the user, hopefully you can find a way for the agent to manage all those needs" — owner, 2026-10-02 (Codex 01a0fe5d 21:28); "we shouldn't need any "re-pair" button." (21:44)
>
> "correction: decision is to REmove both launch buttons" — owner, 2026-10-05 (Codex 01a10903 01:05), "replace with short text instruction to mention SAAM in a chat client."

Summary: the header has Help and Import; Connect shows two labelled lights (chat and service) and the instruction to mention SAAM in a chat client, with no launch, re-pair, retry, detach or undo/redo buttons; agents handle repair.

Sources: [0.3.2 "Client/UI direction"](../plans/0.3.2.md#saam-application-chats-and-folders); [0.3.3 "Studio chat entry"](../plans/0.3.3.md); Codex 01a0fec9 23:57 ("We need "mention saam from any codex or claude code session" or equivalent"). The 10-05 removal overrides the 10-02 launch buttons.

## Quit and lost-connection messages
> "If I exit SAAM from the system tray, the connection status light change is too slow, and … is NOT a helpful message in that case" — owner, 2026-10-03 (Codex 01a0fec9 00:05)

Summary: after Quit, Studio promptly shows stopped lights and says SAAM has stopped and how to start it; an unexplained loss says SAAM cannot be reached.

Sources: [0.3.3 "Tray Quit feedback in Studio"](../plans/0.3.3.md).

## Report a bug, Donate
> "The bug report was supposed to be an agent-activated command. Let's keep the user-activated option on the connect page, but remove "links and file paths are removed" from the text (any of that should be in the collapsible consent section)." — owner, 2026-10-06 (Claude 14d40329 18:23)
>
> "Add a donate button to the 0.3.3 plan. Not sure what the target url will be yet." — owner, 2026-10-03 (Codex 01a0fec9 01:23)

Summary: Connect offers Report a bug beside the agent's command, with privacy details only in the consent section; a Donate button waits for the owner's destination.

Sources: [0.3.4 "Bug report button"](../plans/0.3.4.md); [0.3.5 "Donate button"](../plans/0.3.5.md); [Application](application.md#bug-reports).

## Toolpath colours
> "SAAMpath phase colours should be an agent choice, with sensible defaults that we know look good, and ability to override with local preferences." — owner, 2026-10-05 (Claude 98e25b54 04:37)
>
> "We have feedback that the older default colors were better" — owner, 2026-10-06 (Claude 14d40329 18:16)

Summary: phase colours default to the older, known-good palette; an agent may choose colours for a print and local preferences override.

Sources: [0.3.3 "SAAMpath phase colours"](../plans/0.3.3.md) (its "tested palette" wording is an agent paraphrase); [0.3.5 acceptance row](../plans/0.3.5.md); [0.3.6 "Older default phase colours"](../plans/0.3.6.md).

## Tab title
> "The name should be "SAAM Studio 0.3.5...." then whatever else instance identifier you need" — owner, 2026-10-06 (Claude 14d40329 17:19)

Summary: the browser tab reads "SAAM Studio", the version, then the instance identifier.

Sources: [0.3.6 "Tray instances on the first menu; Studio tab title"](../plans/0.3.6.md).

## Machine ghost and Machine view
> "we definitely have to go with machine ghost + toggle switch to go to machine view"; "we can stick to lines, shapes, cones, etc." — owner, 2026-09-13 ([D-028](../DECISIONS.md#d-028--simple-machine-ghost-and-machine-view))

Summary: Studio shows the machine as a simple ghost overlay with one Machine view switch, in lines and basic shapes.

Sources: [D-028](../DECISIONS.md#d-028--simple-machine-ghost-and-machine-view).

## What Studio hides
> "you must make standard-support solids NOT be visible" — owner, 2026-10-03 (Codex 01a102ba 18:38)
>
> "not all curves actually run by trace necessarily have to displayed in the geometry viewer … just like spatial region definitions or support solids aren't displayed (right?)" — owner, 2026-10-03 (Codex 01a102ba 18:32)

Summary: construction aids (support solids, region definitions, some Trace curves) are not drawn as part geometry; printer information comes with the bundle, not a profile picker.

Sources: Codex 01a102ba; [0.3.1 component 6](../plans/0.3.1.md).

## The tour
> "There's no nudge-cup tour example. Do you actually understand what the tour is? Tell me what the tour is" — owner, 2026-10-06 (Claude 3594b461 19:11)

> "Prepare a tour policy proposal for review" — owner, 2026-10-01 (Codex 01a0f8f8 20:27)

Agent wording; the policy file says it was approved by the owner's 2026-10-01 request for a worker to design a better tour using its own judgment, while the owner's message asked for a proposal for review (**owner question pending**): the core tour follows one editable part through a visible geometry change, playback, a visible printing change, printer/material review and checked export; Studio sets the task, gates follow visible results, and tour content is Studio-owned.

Sources: [0.3.1 tour policy](../plans/0.3.1-tour-policy.md); [0.3.2 "Next stays disabled…"](../plans/0.3.2.md#installed-031-tour-bugs) (Codex 01a0fa1c 01:33); [0.3.3 "Skill demos and examples"](../plans/0.3.3.md) ("Tour lessons remain Studio-owned tour content"); [examples/prints](../examples/prints/README.md).

## Browser Back and Forward (0.5.0)
> "Put browser restoration explicitly in a new 0.5.0 intent doc." — owner, 2026-10-04 (Codex 01a10903 22:52)

Summary: returning to Studio through browser history restores the toolpath, machine model, pose and controls (0.5.0 intent).

Sources: [0.5.0](../plans/0.5.0.md).
