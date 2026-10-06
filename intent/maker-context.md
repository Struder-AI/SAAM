# Maker context

What agents read to work with SAAM: roles, onboarding, manuals and guidance. [Index](README.md)

## Three agent roles
> "core skills are authored or worked on by developer role agents"; "builders are generally working in the guidance skill layer" — owner, 2026-09-30 ([D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries))
>
> "No! Builders operate on extensions! Makers only call them." — owner, 2026-10-01 (Codex 01a0f8f8 20:51)
>
> "Let's call them maker agents." — owner, 2026-09-08 ([D-013](../DECISIONS.md#d-013--maker-agents))

Summary: a maker makes parts and changes no shared code; a builder changes extensions, their guidance and local copies; a developer works on core and cross-cutting design. An agent starts as maker when unclear and becomes developer only on the person's explicit request (agent wording, [D-033](../DECISIONS.md#d-033--three-agent-roles)).

Sources: [D-033](../DECISIONS.md#d-033--three-agent-roles) (summary, not verbatim); [D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries); [AGENTS.md](../AGENTS.md); [Extensions](extensions.md#makers-call-extensions-builders-change-them).

## Skills carry their own manuals
> "skills always come with their own text instruction manual." — owner, 2026-09-08 ([D-014](../DECISIONS.md#d-014--skills-package-manuals-and-tools))

Summary: each skill or extension ships its own manual, and maker context assembles the manuals of the selected extensions.

Sources: [D-014](../DECISIONS.md#d-014--skills-package-manuals-and-tools); [D-032](../DECISIONS.md#d-032--separate-standard-and-advanced-vase-mode-manuals); [0.3.1 component 1](../plans/0.3.1.md).

## Guidance is for every user
> "The support preferences currently in local was meant to be guidance for all users of SAAM" — owner, 2026-10-04 (Claude aed1fd5b 16:59)

Summary: the owner's printing experience written as guidance ships to every user's agents through manuals, not through one checkout's notes.

Sources: Claude aed1fd5b; [skills/standard-support](../skills/standard-support/SKILL.md).

## Ask only necessary questions
> "be quite skeptical - was this really necessary? Realistically only I can judge, so better to bring borderline interaction issues to my attention rather than let them remain silent" — owner, 2026-10-03 (Codex 01a102a0 16:37)
>
> "Let's use white and black. You don't need to know the slots I don't think" — owner, 2026-10-03 (Codex 01a0ff6d 01:48)

Summary: a maker agent reads the relevant guidance before asking and asks only what the print needs; an unnecessary question is a defect worth fixing in guidance.

Sources: [0.3.3 "Unnecessary AMS slot question"](../plans/0.3.3.md); Claude 5689f0da 10-03 16:39 (same brief to Claude).

## Starting is simple
> "pasting in "Read AGENTS.md in this SAAM home, then run saam call maker_onboarding …" is confusing and bad. "Make me a..." would be better, or something similarly simple." — owner, 2026-10-03 (Codex 01a0fec9 00:01)

Summary: a person starts by asking for what they want ("make me a …") in a chat that mentions SAAM; onboarding happens without instructions from the person.

Sources: Codex 01a0fec9 00:01-00:02; [Studio](studio.md#the-connect-pane); Claude 98e25b54 03:47 ("Okay keep the check, but firstrun MAKER agent should do it, right?", on the setup check).

## Example recipes come through maker context
See [Extensions](extensions.md#example-recipes-are-references-for-agents): skill example recipes are read through maker context as references for agents and never displayed.
