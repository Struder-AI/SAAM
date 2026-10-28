# Development

Architecture, development tools, and how agents work with the owner. [Index](README.md)

## Shared architecture and local tools

> "We need to move the dev maps system out of saam itself, our local preferences will still reference it and our local developer agents will still be able to use it, but it will be in a different root folder, and in the package that ships to remote, we will replace with a more standard text-based architecture spec version thing." — owner, 2026-10-18 (Codex 01a151de-c16c-72c3-9d10-42241d643c03)

> "Saam doesn't need maps... maps is a dev tool..." — owner, 2026-10-26 (Claude 62c04216)

Summary: the 2026-10-18 split is the current direction again. The contract maps, their reader, viewer, validation and tests live only in the local architect checkout's `.local/architecture`; SAAM code, onboarding, guidance and packaging do not depend on them. This supersedes the 2026-10-20 direction below to ship maps for 0.4.0.

Sources: [ADR 0001](../docs/adr/0001-text-architecture-and-local-dev-maps.md), [architecture specification](../ARCHITECTURE.md). Original map intent and its exact quotations are preserved with the separate tool.

## Contract maps, types and developer guidance for 0.4.0

> "we want to remake it into a similar thing (similar in terms of how it gets queried by both humans and agents so we understand what the architecture is and how to work effectively), that ships with source, but it's a contract viewer." — owner, 2026-10-20 (this Codex chat)
>
> "I review at the contract/map layer, rarely having to look at the code itself, although retaining that ability is good to have if possible." — owner, 2026-10-20
>
> "We also have to review all additional developer guidance in light of our development history (in addition to comparing it against or new 0.4.0 intent), some of which has not gone well. Have the code style restriction, for example, been hurting us?" — owner, 2026-10-20

Summary (map shipping superseded 2026-10-26, above): 0.4.0 ships maps as contracts for roles, permitted causal interactions, plugs and data types, queried by humans and agents from map 0; review guidance and enforcement cost against development history. Agent-authored submaps retain enclosing obligations. Mechanisms and rule changes remain to settle.

Sources: [0.4.0 intent](../plans/0.4.0.md), this Codex chat, 2026-10-20. [Assessment](../plans/0.4.0-design.md) is agent proposal, not approved wording.

Owner clarification, 2026-10-20: "I want to see a map with nodes and links. Clicking on a node or link opens the contract details." A wire and its plugs share one contract. The deliverable is a useful human-facing prototype; completeness is not required. Command/query separation is explicitly retained. The next Paath degree bound remains open pending investigation.

Owner clarification, 2026-10-21: "Exactly, so control doesn't exist either. The link types are semantic in nature, and carry no non-semantic flavor. Make this change." Command and query are the only link kinds; values are payloads and lifecycle operations use those same kinds. [Current intent](../plans/0.4.0.md#semantic-links--owner-direction-2026-10-21) owns the change.

## Development tools

### Background instances are a dev tool, and visible
> "Test runtimes should not be a thing, there should be a studio window that the viewer can see for every runtime the agent is using" — owner, 2026-10-05 (Claude 98e25b54 04:02)
>
> "Okay well nevermind I guess I see the need for background instances for developer agents. But it should be a dev tool." — owner, 2026-10-05 (Claude 98e25b54 04:13)
>
> "That's explicitly against the intent I expressed. It needs to be in the tray." — owner, 2026-10-05 (Claude c6c50c08 18:13), about a development Studio shown without a tray entry
>
> "I HATE that there is a silent dev instance." — owner, 2026-10-05 (Claude 764ea5bb 21:07)

Summary: developer agents verifying source changes use one development tool; a development instance a session starts is stopped before it reports back. Resolved by the owner, 2026-10-06 (Claude 3594b461): "I want background instances to still show up on the tray, even though no studio window is visible."

Sources: [0.3.3 "One SAAM orchestrator per OS"](../plans/0.3.3.md); `.local/DEVELOPMENT.md` "No silent dev instances".

### Never take focus
> "Sure, just don't window focus me away from whatever task I'm working on. I'm using my OS." — owner, 2026-10-05 (Claude 764ea5bb 21:21)

Summary: agents create no windows, dialogs or focus changes on the owner's machine except in answer to the owner's own action.

Sources: `.local/DEVELOPMENT.md` "Never take focus from the owner"; Claude 764ea5bb 21:19 ("what are all these popups you are putting on my os"); [0.3.4 "Second launch brings Studio forward"](../plans/0.3.4.md).

### Tests: build, don't write tests; ask before a whole suite
> "don't build any tests. Build the plan. We will run it to test." — owner, 2026-09-25 (relay plan, quoted in `.local/DEVELOPMENT.md`)
>
> "36. I'm not sure. This successfully cured our incessant test-itis, you're right it's objectively a bad rule but I think we have to keep it strict." — owner, 2026-10-04 (Claude ec6035d1 06:11)

Summary: workers write no new tests and report which checks they did not run; a whole test suite runs only when the owner agrees.

Sources: `.local/DEVELOPMENT.md` Rules; Claude 98e25b54 03:49 ("Yes this is a good time to run whole test suite before release.").

### Checkpoints, releases and machine load
Owner, 2026-10-21: "The team doesn't have to ask to make checkpoints, change that guidance". Local staging and checkpoints are authorized across the team's checkouts and branches; pushes and merges still need explicit authorization. This supersedes the older branch-specific checkpoint wording.

Historical agent wording, owner words not found here: checkpoint on `codex/remettub-dev-branch` without asking (2026-10-03), no push; a requested push may continue into a release when warranted; at most three concurrent workers and one heavy job machine-wide (2026-10-04).

Sources: `.local/DEVELOPMENT.md` "Working in this checkout"; Codex 01a0f8f8 23:51 ("No no no - we push to remettub-dev-branch").

## Working with the owner

### One question at a time
> "I like the question queue from the last orchestrator - you probably don't have to check it, it's straightforward, give me one question at a time, with some context and some straightforward explanation, I have the option to discuss deeper, or resolve and say "next question"" — owner, 2026-10-05 (Claude 98e25b54 02:55)
>
> "Ah, I think the problems came in when I asked for the second question to be queued up while I answer the first. We won't do that again." — owner, 2026-10-06 (Claude 3594b461)

Summary: one decision per question, with brief context and a plain explanation, discussed until resolved; the next question comes only on "next question". The 10-06 statement overrides "two questions out ahead of me" (Claude 98e25b54 03:27).

Sources: `.local/AGENTS.md` "Question queue"; Claude 14d40329 02:50 ("you can always look back at pretty much any portion of a previous orchestration chat to see what kind of context I need").

### Write better than the owner writes
> "The goal is not to mimic my writing style, btw, the goal is to do better that I do in terms of directness and concision." — owner, 2026-10-02 (Claude e49ed69c 18:47)
>
> "please try to be more concise for the rest of the questions, *don't* copy my own scattered prose style" — owner, 2026-10-04 (Claude 28ca77c4 17:50)
>
> "redo that summary in a more normal prose style, the short-aphorism style doesn't help readability" — owner, 2026-10-05 (Claude 98e25b54 15:08)

Summary: write exact, plain, compact prose, saying each thing once, in normal sentences rather than aphorisms.

Sources: `.local/AGENTS.md` "Deliberate style asymmetry" (owner-edited, Claude 16601f98 10-04 18:06); "Docs should end shorter than they started" (same file; owner words not found).

### Teams and workers
> "Local "rules" being counter productive again... The *policy* should be use up to 2 unless I say otherwise, in this case I give you up to 4, but only use the number within that max that you judge makes the most sense." — owner, 2026-10-04 (Claude 28ca77c4 16:46)
>
> "Offload work to them rather than doing it yourself, keeping your context free for interaction/discussion with me, and overview understanding." — owner, 2026-10-05 (Claude 98e25b54 02:33)
>
> "Don't tell them what to do. Their task is already specified. The prompt should be about increasing awareness regarding the more general intent we have with the project direction, the coding philosophy I prefer, the problems we've been having, and demonstrated success patterns." — owner, 2026-10-02 (Codex 01a0fdcf 18:21)

Summary: orchestrators delegate within the owner's worker cap (two by default), keep their own context for the owner, and brief workers with intent rather than scripts; workers run without needing the owner's approvals.

Sources: `.local/AGENTS.md` "Workers" (300k-token handover is agent wording); Codex 01a0fdcf 18:24 ("I can't be sitting here approving their requests."); Claude 98e25b54 02:38 (queued: reserve a worker to use the maps for complexity fixes).

### Hand over at once
> "You should put a good starting point maps set in their checkout, don't make them generate their own." / "I don't want to name it, just set it up and hand to me" — owner, 2026-10-04 (Claude 28ca77c4 21:57, 22:05, queued)
>
> "Do it immediately, wtf am I waiting for." — owner, 2026-10-04 (Claude 28ca77c4 22:24)

Summary: when the owner asks for something set up, do it with what exists and hand it over rather than deliberating.

Sources: chat only.

### Developer onboarding carries the owner's guidance
> "Not developer-context.md? What?!" — owner, 2026-10-02 (Codex 01a0fe33 20:04)
>
> "Agree, include whole document" — owner, 2026-10-02 (Codex 01a0fe18 20:17), answering an agent proposal to load all of DEVELOPER-CONTEXT in onboarding

Summary: the owner's architectural-discipline prompt lives in DEVELOPER-CONTEXT, which developer onboarding delivers whole.

Sources: Codex 01a0fa1c 05:01 ("A "short durable reference" probably won't get it done."); [DEVELOPER-CONTEXT](../DEVELOPER-CONTEXT.md).

### Where intent and memory live
> "24. no wonder our BR document has never really been used. We mostly now work with versioned intent docs, can you think of an improvement here?" — owner, 2026-10-04 (Claude ec6035d1 05:37)
>
> "No client memory is a hard rule we want to keep, but it currently doesn't work for alpha testers." — owner, 2026-10-04 (Claude ec6035d1 06:11)
>
> "Yeah we need to change the decisions format, now I understand why it has been ignored. The other developer (tkeller) has taken a supporting role and now contributes mainly through direct interaction with me." — owner, 2026-10-04 (Claude 28ca77c4 16:30)

Summary: versioned intent documents carry the spec; preferences live in SAAM's own notes, never in client memory; remettub owns SAAM's decisions and tkeller contributes through him.

Sources: [D-049](../DECISIONS.md#d-049--one-owner-plain-decision-records); [0.3.3 "Local notes and user data"](../plans/0.3.3.md); Claude 5b0f248a 06:16 ("I'm not sure the no-external memories rule is being followed.").
