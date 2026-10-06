# Settings

Machine and material profiles, remembered setups and local preferences. [Index](README.md)

## Profiles feed explicit recipe values
Agent wording, no specific owner agreement found: reusable machine/material profiles and remembered setup sit behind explicit interfaces; the selected settings go to Bundle, and authoring defaults become explicit recipe values before construction. Defaults supply process and setup, never geometry.

Sources: [0.3.1 component 9](../plans/0.3.1.md); [0.2.0 Settled intent](../plans/0.2.0.md#settled-intent); [D-042](../DECISIONS.md#d-042--020-authoring-and-shared-deposition-intent) ("Defaults supply no geometry").

## Profiles list no allowed ranges
> "22. No. Each profile should not list allowed layer heights, that's an incomplete intent implementation that is begging to be silently regressed. I suspect something similar for 19 and 20, so take a look at those again." — owner, 2026-10-05 (Claude 98e25b54 15:29)
>
> "Okay, I will want to see the list of limit-like field in the machine and material profiles" — owner, 2026-10-05 (Claude 98e25b54 15:31)

Summary: profiles carry no allowed-range lists; every remaining field either feeds the printer or Studio, or is a check that prevents a real failure, and the owner sees the list of limit-like fields.

Sources: [0.3.5 "Profile limit fields"](../plans/0.3.5.md) (its status "Owner wants the list" omits the decided removal; see report); [Export and machines](export-and-machines.md#no-limit-checks-in-profiles-or-export).

## Material limits: temperature only
> "I would just delete these entirely other than temperature (cap at 350) - temp is the only safety issue" — owner, 2026-10-01 (Codex 01a0f6ac 09:19)

Summary: the only material limit SAAM keeps is a 350 °C temperature cap.

Sources: Codex 01a0f6ac; [core/README limits](../core/README.md#limits-that-adapt-and-limits-that-are-kept).

## Remember setup from the last export
> "remember setup (last use of that machine) should be in local, subfolder or not is your call. Last export for that machine is a better trigger for remember setup, and there should be an agent-facing option to defer that save for a specific bundle, which I expect will rarely be used." — owner, 2026-10-05 (Codex 01a10903 01:25)

Summary: SAAM remembers each machine's setup from its last successful export, in the home's `local/` folder; an agent can defer that save for a bundle, and ordinary edits change no future defaults.

Sources: [0.3.3 "Local notes and user data"](../plans/0.3.3.md); Codex 01a10903 01:20 ("Do we actually have remembered machine setups though? I don't remember asking for that.").

## SAAM owns local notes and preferences
> "Yes SAAM should own those notes, and we have to be careful here not to provide conflicting instructions to users who have downloaded a local checkout as well as the install." — owner, 2026-10-05 (Codex 01a10903 01:07)
>
> "We should put these in <SAAM home>/local/LOCAL-AGENT-NOTES.md. Bundles should go here too, if they don't already." — owner, 2026-10-05 (Codex 01a10903 01:14)

Summary: the person's preferences and printer notes live in one SAAM-owned file in the home, read by source and installed agents alike, never in client memory; local preferences (such as phase colours) override defaults.

Sources: [0.3.3 "Local notes and user data"](../plans/0.3.3.md); [Development](development.md#where-intent-and-memory-live); [core/application](../core/application/README.md).

## Vetted material library (0.4.0)
> "mark material library as definitely we will port that over - but don't do it yet." — owner, 2026-09-13 ([D-029](../DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission))

Summary: a vetted material library is committed future work that starts only when the owner starts it.

Sources: [D-029](../DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission); [0.4.0 "Vetted material library"](../plans/0.4.0.md).
