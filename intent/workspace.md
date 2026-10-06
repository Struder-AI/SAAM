# Workspace

Specialized workspaces: extensions with their own design UI, such as Wing. [Index](README.md)

## A workspace is an extension with a UI
> "Workspaces (like the wing workspace) need to be another class of extensions. Does that make sense?" — owner, 2026-10-02 (Codex 01a0fe2c 19:53)
>
> ""Workspace" should mean an extension that also includes a UI." — owner, 2026-10-03 (Codex 01a102a0 17:45)

Summary: a workspace is a portable extension with its own design UI, loaded through the extension library; the installed app hosts its instances like Studio.

Sources: [0.3.2 "Workspace extension class — owner authorized"](../plans/0.3.2.md#workspace-extensions-and-wing-export-size); [0.3.1 component 7](../plans/0.3.1.md).

## A workspace does its own work and hands off parts
> "workspace has to do it's own work. Isn't someone already assigned to this?" — owner, 2026-10-01 (Codex 01a0f729 11:27)
>
> "After workspace creates the bundle, a normal session may and will edit each individual part. So the wing recipe remains as provenance, not authority." — owner, 2026-10-05 (Codex 01a10903 00:24)
>
> "We definitely need the workspace to produce parts, so "pieces" is fine although the name implies plural and single part is fine. We need preview." — owner, 2026-10-03 (Codex 01a102a0 17:53)

Summary: a workspace designs with previews, then creates self-contained bundles one way; each part is then ordinary, independently editable work, and the workspace recipe is provenance only.

Sources: [0.3.3 "Workspace part independence"](../plans/0.3.3.md); [0.3.1 Wing scope](../plans/0.3.1.md#retained-behavior-and-extensions); Codex 01a102a0 18:01.

## Wing scope
> "Let's cut tail, and just do wing. … Everything should print in standard 3-axis, oriented upright (so layer lines are always in the airflow direction), with continuous-extrusion toolpaths. I would say we don't need any specific attachment geometry, other than holes for straight reinforcement rods. A rod can also function as the pivot for the flaps. Don't bother with any other mechanism mounting hardware or attachment geometry - assume glue. … Treat this as an example that can inform future workspaces, so generalizable yes, but don't over-build for functionality that isn't needed." — owner, 2026-10-01 (Codex 01a0f692 08:45)
>
> "btw you will need to show the whole plane in the viewport, just only print the wing parts" / "Can we just save all the bundles to a single folder I don't like having 6 separate agent asks." — owner, 2026-10-01 (Codex 01a0f692 09:07)

Summary: Wing designs the wing only (with flaps), shows the whole plane but prints wing parts upright in 3-axis with continuous extrusion, uses straight rod holes and glue, saves the whole set at once for one agent request, and is a demonstration, not flight-qualified.

Sources: Codex 01a0f692 08:29-09:30; Codex 01a0fe2c 20:23 ("Looks like we've lost functionality. No flaps?"); Codex 01a0f729 11:33 ("Use explicit workspace limits; select printer/setup later."); [0.3.1 "Accepted wing scope"](../plans/0.3.1.md#retained-behavior-and-extensions).

## Re-export replaces the previous set
> "bug: wing workspace generates gigantic files." — owner, 2026-10-02 (Codex 01a0fa1c 03:59)
>
> "wing export growth, my rule to not clean up?! I'm being badly misrepresented here. We obviously have to clean up/overwrite" — owner, 2026-10-05 (Claude 98e25b54 04:35)

Summary: exporting a design again replaces its previous exported set, safely (the new set is complete before the old one goes); files stay as small as the self-contained parts allow.

Sources: [0.3.3 "Wing re-export cleans up"](../plans/0.3.3.md); [0.3.2 Wing export size](../plans/0.3.2.md#workspace-extensions-and-wing-export-size) (its "never truncate points" is an agent safeguard, no approval found; "keep prior sets" was agent wording, corrected).
