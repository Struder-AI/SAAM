# Extensions

Skills and extensions: who uses and changes them, how they meet SAAM, and the examples they ship. [Index](README.md)

## Use SAAM, else build an extension
> "Good. If saam can do it, use saam. If it can't, build an extension that can. We expect most things to be doable with extensions, if you have to build outside of extensions that's a bug for us, please file a bug report! (I like that last part - put a cli command that goes to relay for this)" — owner, 2026-10-06 (Claude 14d40329 03:02)
>
> ""don't push them toward an extension or SAAM's own operations" is exactly the opposite intent" — owner, 2026-10-06 (Claude 14d40329 02:54)

Summary: agents make things through SAAM's own operations, or build an extension when SAAM cannot; work outside extensions is a SAAM bug the agent reports through `saam`.

Sources: [0.3.6 "Use SAAM, else an extension"](../plans/0.3.6.md); [MAKERS working boundaries](../MAKERS.md#working-boundaries); Claude 14d40329 02:50 (tkeller's custom vase script). questions-036 #12 (make it a numbered hard rule?) is unanswered.

## Makers call extensions; builders change them
> "What are extension editors. No! Builders operate on extensions! Makers only call them. This is a fundamental misunderstanding of how we operate, and you are adding unnecessary complexity." — owner, 2026-10-01 (Codex 01a0f8f8 20:51)
>
> "Ah yes, we need to allow builders to author guidance related to their extensions. My oversight. But I think that's it." — owner, 2026-10-02 (Codex 01a0fa1c 05:27)

Summary: makers call extension operations on prints; builders change extension code and its guidance; shipped core guidance needs a developer.

Sources: Codex 01a0f8f8, 01a0fa1c 05:24-05:27; [0.3.1 "Retained behavior and extensions"](../plans/0.3.1.md); [D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries) ("builders are generally working in the guidance skill layer"); [Maker context](maker-context.md#three-agent-roles).

## Extensions do their own work and deliver to Bundle
> "If an extension is putting work in bundle - that makes no sense. Extensions do their own work and deliver to bundle." — owner, 2026-10-01 (Codex 01a0f729 11:17)
>
> "I was thinking that extensions would all share a fixed set of interfaces, thus all would be represented inside map 4, whether they are currently packaged with the install or not." — owner, 2026-10-04 (Claude 28ca77c4 17:56, queued)

Summary: an extension is ordinary local code that composes the public Geometry and Toolpath operations through a fixed set of interfaces and hands its result to Bundle; it has no direct access to Bundle internals, Studio, private engine code or Export.

Sources: Codex 01a0f729; Claude 28ca77c4 17:56; [0.3.1 component 4 and extension paragraphs](../plans/0.3.1.md) (agent wording); [dev-maps Scope](../plans/dev-maps.md#scope).

## Local copies, one selection
Agent wording, no specific owner agreement found: extensions live outside bundles; a builder's local copy overrides the release default and survives updates; one selection drives manuals, calls and regeneration; exchange carries manifest, guidance, scripts, assets, provenance and licence without executing on import; no sandbox is promised.

Sources: [0.3.1 "Retained behavior and extensions"](../plans/0.3.1.md); [skills/AUTHORING](../skills/AUTHORING.md).

## Features become extensions
> "Regarding the website reference discussion items: yes we should include hole supports, and *single* line text packaging as plugins (parallel bead construction should require edit to the extension by a local builder agent - so can be done easily, but doesn't ship that way)." — owner, 2026-10-01 (Codex 01a0f8f8 20:27)
>
> "We should keep the gridfinity template"; "You can remove the rimming skills" — owner, 2026-09-28 ([D-040](../DECISIONS.md#d-040--geometry-is-authored-spline-patches-meshes-and-blob-fields))

Summary: text, heat-set inserts, Thingi10K, hole supports and single-line text (one bead per centerline) are extensions; gridfinity stays; the rimming skills are gone.

Sources: [0.3.1 "Retained behavior and extensions"](../plans/0.3.1.md); [0.3.1 discussion items](../plans/0.3.1-discussion.md); Codex 01a0f65b 08:16 ("Yeah I approve migration for all of those"); [D-040](../DECISIONS.md#d-040--geometry-is-authored-spline-patches-meshes-and-blob-fields) ("we need a new 'hybrid' skill category").

## Advanced vase is an extension
> "Advanced vase now becomes an extension, and sleeve mapper/etc gets moved to that extension's scripts. The script can just make repeated trace calls." — owner, 2026-10-01 (Codex 01a0f65b 07:52)

Summary: advanced vase lives in its extension and builds its spiral and patterns from repeated Trace calls.

Sources: Codex 01a0f65b; [0.3.2 Slice consolidation](../plans/0.3.2.md#inherited-unfinished-intent).

## Standard support extension
> "Build "standard support" extension (and/or guidance) in line with how I specified at the END of the brain-print chat last night" — owner, 2026-10-03 (Codex 01a102a0 17:14)
>
> "Approve the general extension command" — owner, 2026-10-03 (Codex 01a102a0 17:18), answering an agent proposal for one `apply_extension` command

Summary: standard support is an extension built on the owner's construction method ([Toolpath](toolpath.md#how-standard-supports-are-made)); extensions are called through one general command.

Sources: Codex 01a102a0.

## Example recipes are references for agents
> "Demos should be example recipes that ship into maker context from skills." — owner, 2026-10-05 (Claude 28ca77c4 00:55)
>
> "Those are example scripts, not a part of how SAAM actually runs." — owner, 2026-10-05 (Claude 28ca77c4 01:03)
>
> "Skill example recipes should not show in studio. But why would they? Example recipes are for agents to use as a reference to build their own recipes. Something isn't right here, I smell misaligned intent" — owner, 2026-10-05 (Claude 98e25b54 03:36)

Summary: a skill ships static example recipes that its manual lists and agents read as reference; SAAM never runs or displays them, and unneeded demos are deleted.

Sources: [0.3.3 "Skill demos and examples"](../plans/0.3.3.md) (its earlier "run through Application and shown in Studio" wording was an agent addition, corrected); Claude 98e25b54 03:41 (queued: "you are deleting the unneeded demos, right?"); Codex 01a0fac5 04:06 ("if the print shows some unique technique, design, or styling, keep it; if it's a duplicate that offers nothing, get rid of alll but one of them.").
