# Bundle

The print bundle: the one shared part state, what it holds and what it serves. [Index](README.md)

## Bundle is the only shared part state
> "Bundle is the only shared part-state authority." — owner's guidance prompt, 2026-10-02 (Codex 01a0fdfa 19:00)

Summary: Bundle alone holds shared part state and commits proposals others supply; every other component owns only private state, and sequential stages hand owned data forward without keeping aliases.

Sources: [0.3.1 Bundle bullet and component 5](../plans/0.3.1.md); [D-044](../DECISIONS.md#d-044--architecture-led-030); [dev-maps Arrows](../plans/dev-maps.md#arrows) ("Bundle is the only shared part state", owner 2026-10-04); [DEVELOPER-CONTEXT code shape 3](../DEVELOPER-CONTEXT.md#code-shape).

## What a bundle holds
> "Bundle always includes geometry, sometimes recipe, and sometimes toolpath iff recipe present - all correct?" — owner, 2026-10-03 (Codex 01a102ba 18:16)
>
> "Trace should have geometry, and that geometry should be curves. Inject should have geometry, and that geometry should be points. I don't think we've implemented it that way, but we should." — owner, 2026-10-03 (Codex 01a102ba 18:25)

Summary: a bundle always has geometry, may have a recipe, and has a toolpath only with a recipe; for Trace the geometry is curves and for Inject it is points. Bundle stores what it is given and invents no geometry, machine or defaults; each operation checks its own prerequisites.

Sources: Codex 01a102ba; [0.3.1 component 5](../plans/0.3.1.md) (agent wording); owner's guidance prompt 2026-10-02 ("An operation runs when its own prerequisites exist").

## Bundle state, no fingerprints or approvals
> "THe fingerprint isn't actually doing anything, it's just meaningless ceremony" — owner, 2026-10-06 (Claude 14d40329 04:56)
>
> "Fingerprint and approvals design is none, no fingerprint, no approvals. Right? We have bundle state and single operator. Aren't you guys reading the ousterhout guidance?" — owner, 2026-10-06 (Claude 14d40329 05:08)

Summary: Bundle's own state and the single operator replace print fingerprints and stored approvals; an edit itself makes the program stale, and content hashes are taken only on bytes arriving from outside SAAM.

Sources: [0.3.6 "Retire fingerprint ceremony"](../plans/0.3.6.md); [Studio](studio.md#export-captures-the-moment).

## Prepared meals for consumers
> "The bundle should serve a known and sensible set of prepared meals to all consumers." — owner, 2026-10-04 (Codex 01a10903 23:25)
>
> "Bundle checks themselves seem legit, although I would definitely rephrase the last one more correctly as "has this bundle been exported"/etc" — owner, 2026-10-04 (Codex 01a10903 23:35)

Summary: Bundle supplies prepared saved-work and output identities, byte integrity, revision association and factual export history to every consumer.

Sources: [0.3.3 "Bundle evidence and output diagnostics"](../plans/0.3.3.md).

## Old bundles update when work resumes
> "Any stale bundles should be updated to new versions only at the point after the upgrade when that bundle is actively being worked on. Reduce complexity" — owner, 2026-10-01 (Codex 01a0f8f8 22:30)

Summary: after an upgrade a bundle is updated only when someone works on it again, with no bulk migration; saved geometry and SAAMpath stay viewable without extension code, and a recipe that needs migration says to run `migrate_bundle`.

Sources: [0.3.1 "Retained behavior and extensions"](../plans/0.3.1.md); [0.3.4 "Old recipes say how to generate"](../plans/0.3.4.md).

## Sharing a bundle
> "We need a shared bundle operation. Think about which parts of it need to be included, so that the other SAAM install on the other machine can do everything it needs to, but don't bloat the file size. Regenerate toolpaths for example, rather than ship toolpaths" — owner, 2026-10-03 (Codex 01a102a0 17:18)
>
> "Prints are local and are not pushed to the remote" — owner, 2026-09-08 ([D-015](../DECISIONS.md#d-015--local-print-bundles))

Summary: prints stay local and are shared only on the person's choice, through one share operation that carries what another SAAM needs and regenerates the rest.

Sources: Codex 01a102a0; [D-015](../DECISIONS.md#d-015--local-print-bundles); [MAKERS](../MAKERS.md).
