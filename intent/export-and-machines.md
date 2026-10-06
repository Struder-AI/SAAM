# Export and machines

Translating SAAMpath for a machine, machine adapters, and checks on output. [Index](README.md)

## Machine rules live only in export
> "Only actual export modules are allowed to block something on machine compatibility" — owner, 2026-09-30 ([D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries))
>
> "our own internal toolpath representation ... AND the export produced from it" — owner, 2026-09-08 ([D-019](../DECISIONS.md#d-019--a-print-includes-saampath-and-its-export))

Summary: an adapter translates the neutral SAAMpath for the selected machine (compatibility, tool mapping, start and priming, change clearance, axis limits, output) and delivers checked program bytes; output-only changes never reconstruct unchanged deposition.

Sources: [D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries); [0.3.1 component 8 and "Machine independence is semantic"](../plans/0.3.1.md) (agent wording); [0.2.0 Interface migration](../plans/0.2.0.md#interface-migration) ("Delivery means checked machine-program/package bytes").

## Machine adapters builders can make
> "we need a nice friendly way for builder agents to build export adapters for different machines, just like we have for extensions, so guidance, *sensible* standards which I don't trust you at all about so I need to review the standards list, and most importantly - a standard set of plugs for builders to plug their new machine adapters into." — owner, 2026-10-06 (Claude 14d40329 03:31)
>
> "The ideal shape is that saampath (and machine settings) is the only transfer medium into the adapter. Any other link where toolpath or geometry needs to talk to an adapter - I need to see it, a case for it, and I need to specifically approve it, otherwise it's not allow" — owner, 2026-10-06 (Claude 14d40329 03:37, queued; message ends there)
>
> "Ah yes, machine adapters needs to be built, green light." — owner, 2026-10-06 (Claude 14d40329 05:08)

Summary: builders add machines as adapters that plug into a standard set of plugs, with guidance and owner-reviewed standards; SAAMpath and machine settings are an adapter's only input, and any other link needs the owner's specific approval. **Owner questions pending**: (a) the standards list S1-S10 was adopted in `machines/README.md` without the owner's review, and S4 enforces tool bounds and axis feed against Q19/Q20; (b) the Geometry frame-math link to Export the owner approved on 2026-10-01 ("Yes—add the narrow Geometry–Export connection", Codex 01a0f8f8 21:24) has not been re-shown under the 10-06 rule (adapter design A1 is unanswered).

Sources: [0.3.6 "Machine adapters for builders"](../plans/0.3.6.md); `.local/team/adapter-design.md`; `.local/team/questions-036.md` 20-30; [0.3.1 "Owner approved 2 → 8 frame mathematics"](../plans/0.3.1.md); [machines/README](../machines/README.md).

## Verification checks are debug-only
> "The rest of motion is absolute garbage that should not be in here. This is just extra work, this type of thing should all be labeled explicitly as a debug system, run on new stuff in case you don't know if your new code works. OR removed completely, agents are perfectly capable of checking their own outputs." — owner, 2026-10-04 (Codex 01a10903 23:35)
>
> "new adapters should probably do some verification checks, those verification checks should be debug only and get taken out once we know it works" — owner, 2026-10-06 (Claude 14d40329 03:37, queued)

Summary: checks that re-verify SAAM's own output belong to a new adapter's debugging and are removed once it is known to work; machine and output prerequisites that prevent a real failure stay with their operations.

Sources: [0.3.3 "Bundle evidence and output diagnostics"](../plans/0.3.3.md); [0.3.5 "Program self-consistency checks"](../plans/0.3.5.md); Codex 01a0f6ac 08:59 ("what is bad is doing it twice, or doing it in a sub-optimal place, or doing a check that doesn't offer anything or isn't worth the delay"); D-010 ("Whatever automated checks need to be done should happen prior to sending machine code to the viewer", 2026-09-08) is history.

## No limit checks in profiles or export
> "19. no 20. no" — owner, 2026-10-05 (Claude 98e25b54 15:06), declining export refusal on tool bounds (Q19) and enforced maximum flow (Q20)
>
> "21. A 0.4 line from a 0.6 nozzle would happen here: "oops, I didn't realize we had a 0.6 installed, do we really have to regenerate that really really long toolpath that took a really really long time?" You will have to convince me that any checks we have here actually provide value rather than just limiting functionality and causing stumbling blocks." — owner, 2026-10-05 (Claude 98e25b54 15:29)
>
> "No it is not our job to limit flow. The machine generally will do that anyway." — owner, 2026-10-01 (Codex 01a0f6ac 09:14)

Summary: export does not refuse on tool bounds, flow, line width or layer height; any cap a specific machine truly needs lives in that machine's adapter.

Sources: `.local/team/questions.md` (Q19-Q22); [0.3.5 "Profile limit fields"](../plans/0.3.5.md); [Settings](settings.md#profiles-list-no-allowed-ranges).

## Ask only what printing needs
> "Let's use white and black. You don't need to know the slots I don't think" — owner, 2026-10-03 (Codex 01a0ff6d 01:48)

Summary: material identity and colour are enough for automatic AMS feed matching; agents ask for physical slots only when a route needs them.

Sources: [0.3.3 "Unnecessary AMS slot question"](../plans/0.3.3.md); [machines/bambu](../machines/bambu/SKILL.md#choosing-the-spool).
