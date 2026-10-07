# Development

Dev maps, development tools, and how agents work with the owner. [Index](README.md)

## Dev maps

### What the maps are for
> "A link records influence between two pieces of SAAM: one can change what the other does or receives. The map exists so you can change a node knowing everything it affects and everything that affects it, without reading source to find out." — owner's intent summary, 2026-10-04 (Claude 28ca77c4 16:30)
>
> "We are hoping maps provide full and useful project context, at an efficient token price." — owner, 2026-10-06 (Claude 14d40329 02:40)

Summary: a developer changes a piece of SAAM knowing everything it affects and everything that affects it, at a low reading cost; the owner's standard is review ten times faster with four times the confidence.

Sources: [dev-maps Purpose](../plans/dev-maps.md#purpose); [D-038](../DECISIONS.md#d-038--dev-map-intent-functional-tree-complete-leaf-context-findings-kept-code-shape-rules) (the "ten times faster" standard, 2026-09-21); [D-045](../DECISIONS.md#d-045--a-dev-map-link-records-influence) ("that's the correct intent", Claude 6b4140ef 03:37).

### Every arrow is causal influence
> "Causal influence is what ALL arrows should represent, top level or leaf level or any level in between. So if A calls B and B returns to A, the arrow would be B -> A. If A activates B and then B passes data on to C, the first arrow would be A -> B." — owner, 2026-10-04 (Claude 1bdc613c 04:19)
>
> "So you CAN build a scanner that will represent all causal influence *potential* between components of SAAM, but it won't always know whether that influence is actually being exerted, and the false possibilities can be minimized. Is that right?" — owner, 2026-10-04 (Claude 1bdc613c 03:56); answered yes and confirmed at 04:19

Summary: an arrow points from code that can change something to the code it changes; the analysis shows every possible influence and keeps false possibilities few.

Sources: [dev-maps Arrows](../plans/dev-maps.md#arrows), [Potential, not actual](../plans/dev-maps.md#potential-not-actual); [D-046](../DECISIONS.md#d-046--rebuilt-dev-maps-causal-arrows-and-banned-unmodelled-code); Claude 6b4140ef 03:34 ("A list of cases is not intent"), 03:37.

### One arrow per pair; outcome dot
> "Let's have the visual representation of the command + acknowledgement at the leaf level be an arrow with a dot on the other end, as distinct from an actual two headed arrow (we currently use two separate arrows, which I don't like, harder to read), two-headed arrow would mean it DOES return data A computes with, as well as forward flow elsewhere." — owner, 2026-10-04 (Claude 016a097d 05:43)

Summary: each related pair of boxes is drawn as one arrow: one head, a head with a tail dot for a command returning only its outcome, or two heads.

Sources: [dev-maps Notation](../plans/dev-maps.md#notation); [D-047](../DECISIONS.md#d-047--command-outcomes-and-one-arrow-per-pair); Claude 016a097d 05:13.

### Authored top, computed leaves, solved middle
> "We need to be able to author the top-level node structure(s), and have every piece of code accounted for as a leaf node. Code that violates the top level links will also be banned outright. The solver idea for intermediate map stages is still attractive." — owner, 2026-10-04 (Claude 1bdc613c 04:04)
>
> "Higher level links fall out automatically from leaf-level links, correct?" — owner, 2026-10-04 (Claude 1bdc613c 04:19)
>
> "0 map looks pretty good, I approve and we may adjust it as we continue to work." — owner, 2026-10-04 (Claude 28ca77c4 22:42)

Summary: the owner authors each set's top level (map 0 approved, open to adjustment); every piece of code is a computed leaf with one top-level owner; levels between are solved; higher arrows derive from leaf arrows.

Sources: [dev-maps Levels](../plans/dev-maps.md#levels); [D-050](../DECISIONS.md#d-050--influence-map-0-approved-authored-placement); Claude 28ca77c4 17:11 ("A different 0 map structure is possible, upon request and my approval."), 22:49 ("I think assigning a Map-0 bucket is a coder agent task if they are writing a new node."); [0.3.5 "Dev map rebuild"](../plans/0.3.5.md) (held map-0 wires await label pass, Claude 28ca77c4 02:15).

### Leaves
> "Leaves with no arrows should not exist. That would mean they have no causal effect. That would mean they don't do anything, which if actually true would mean they should be removed." — owner, 2026-10-04 (Claude 016a097d 06:33)
>
> "What matters is *the leaf treats all callers the same way,* in other words, same interface, same behavior set, so it isn't a black box that hides it's behavior or interaction effects from the map." — owner, 2026-10-04 (Claude 28ca77c4 17:17)
>
> "C is fine, code that does nothing should be represented as doing nothing." — owner, 2026-10-05 (Claude 28ca77c4 01:16)

Summary: every leaf has an arrow (an arrowless leaf is dead code or an analysis gap); a callable that treats all callers the same is a shared library box; load code that only declares is listed without arrows.

Sources: [dev-maps Leaves](../plans/dev-maps.md#leaves); [D-051](../DECISIONS.md#d-051--code-shape-no-passthrough-wires-without-good-reason); Claude 28ca77c4 16:46 (vector helpers on their own map), 17:03 ("if we can avoid naming special case helpers, that's even better"), 17:11 ("I suspect we are atomizing leaf nodes too much").

### State, actors and channels
> "definitely state as node." — owner, 2026-10-04 (Claude 28ca77c4 17:36)
>
> "we author the map 0 externals, retain the automatically detected kinds, then we assign each kind to one of the authored externals. On sub maps, if only one or a set of external kinds are present rather than the full set, we can make that clear too. Does that track?" — owner, 2026-10-04 (Claude 28ca77c4 17:50); recorded as owner rule in dev-maps

Summary: each piece of state is a node owned by its boundary; outside parties are authored actors whose detected contact kinds are assigned to declared channels.

Sources: [dev-maps Arrows](../plans/dev-maps.md#arrows); Claude 28ca77c4 17:38 (queued: "Yes, it's an effect to an external."); Claude 98e25b54 02:59 ("Keep maker context, external resources, and just "unassigned."").

### Scope
> "Agent run scripts - agent is supplying a script that runs and uses the core engines to make bundles. This is extension behavior, right? Demos wire through extensions, just like any other script, right?" — owner, 2026-10-05 (Claude 28ca77c4 01:10); then "yes, re-own them to Extensions" (01:11)
>
> "Your understanding of what the scope should be is correct, once again I can always adjust it later." — owner, 2026-10-04 (Claude 1bdc613c 04:19)

Summary: the analysis covers all SAAM code that runs in use, other processes included, plus skill scripts and examples (owned by Extensions) and development tooling (its own node); tests are out; the owner may adjust scope.

Sources: [dev-maps Scope](../plans/dev-maps.md#scope); Claude 28ca77c4 17:56 (queued, extensions share a fixed interface set inside map 4).

### Analysis and regeneration
> "Ah sorry, yes I meant to approve compositional analysis, that sounds great." — owner, 2026-10-04 (Claude 016a097d 05:57)
>
> "In any case, we don't have to stick to that decision, we should do whatever works." — owner, 2026-10-04 (Claude 016a097d 07:15)
>
> "I think we do need incremental analysis, but let's not block on it. Let's get the SAAM dev teams working, using maps, with regens after each task being the policy, THEN work on incremental analysis." — owner, 2026-10-04 (Claude 28ca77c4 18:08)
>
> "That's fast enough that we can give blanket authorization to run after a work cycle finishes, or if not done, when a work cycle starts, both without my explicit green light. I can still call for it mid-cycle or the orchestrator can still propose it mid-cycle." — owner, 2026-10-05 (Claude 98e25b54 03:30)

Summary: regenerate after every task; run a full solve after each work cycle without asking; analysis method is whatever measures fastest on the sound analysis; incremental analysis follows.

Sources: [dev-maps Analysis](../plans/dev-maps.md#analysis); [D-048](../DECISIONS.md#d-048--compositional-influence-analysis); `.local/DEVELOPMENT.md` standing full-solve authorization. The 10-05 03:30 statement overrides "I think I'll call for when full solves happen" (Claude 28ca77c4 02:15).

### Placement
> "I want to author placement myself. Picking through the nodes manually and watching the wires move in real time, like in airsourceChemistry, is now a high level objective for us, ok?" — owner, 2026-10-04 (Claude 28ca77c4 22:42)
>
> "what I actually asked for was changes to the new layout solver, that took link crossings into account, using my hand edits as an example. I did not request any kind of ongoing learning ability, just a one time update." — owner, 2026-10-05 (Claude 98e25b54 14:37)
>
> "I think we need the arrows to not just stick to the four quadrant points, you know?" — owner, 2026-10-04 (Claude 28ca77c4 23:26)

Summary: the owner places boxes by hand and placements persist; a placement solver gives untouched maps a starting layout that accounts for link crossings.

Sources: [dev-maps Placement](../plans/dev-maps.md#placement); [D-050](../DECISIONS.md#d-050--influence-map-0-approved-authored-placement); [0.3.3 "Dev map placement"](../plans/0.3.3.md); Claude 98e25b54 03:04 (canvas bigger, better aspect ratio); Claude 28ca77c4 18:02.

### Map reads and the viewer
> "Map call for agents should see essentially the same info I see. NOT carry anything with it. It's a few kb, and they know which sub maps to drill into next if they need it. We should also give them the option to query a specific interface (link) and just look at that." — owner, 2026-10-02 (Codex 01a0fa1c 05:08)
>
> "Okay, I've decided that map reads should not return code itself." — owner, 2026-10-02 (Codex 01a0fe18 19:48)
>
> "The point is to *replace* text summaries with a simpler visual representation for the human viewer. The text representation is for the agent-facing access - but make sure that has no redundancies as well!" — owner, 2026-10-04 (Claude 28ca77c4 18:02)
>
> "stale files should only show in map 0 read, make is so. Same for human viewer" — owner, 2026-10-06 (Claude 14d40329 04:55)

Summary: an agent's map read shows what the owner sees, grouped the same way, small, without code or redundancy, with one useful default; leaves are read as source from the ranges shown.

Sources: [0.3.2 "CLI map reads"](../plans/0.3.2.md#small-truthful-map-reads-and-complexity-reduction); Codex 01a0fa1c 04:59; Codex 01a0fe18 19:50-20:03; Claude 28ca77c4 18:30 (queued), 18:35 ("Agent facing reads need to group links the same way the human-facing reads does."); Codex 01a0f74b 11:50-11:54 (clickable links, hovered wire emboldens).

### Who reads maps
> "Builders should not get maps automatically, they should know about reading map 0 individually it if they decide they need a look. You know, I wonder if making the developers do a separate call for it as well might be better patter- building and encourage compliance." — owner, 2026-10-04 (Claude 28ca77c4 21:33)

Summary: builders read map 0 only if they choose; developers read it with their own call before editing.

Sources: Claude 28ca77c4 21:33; [DEVELOPER-CONTEXT Working with dev maps](../DEVELOPER-CONTEXT.md#working-with-dev-maps).

### Labels, old scanner, separate project
> "cluster label pass will be authored by agents, reviewed by me, actually." — owner, 2026-10-05 (Claude 28ca77c4 02:07)
>
> "F waits, I see no reason to not retire the old scanner now. Dev map split to own will wait, likely wait for quite a while." — owner, 2026-10-05 (Claude 98e25b54 02:37)

Summary: agents write cluster labels and the owner reviews them; the old scanner is retired now; splitting dev maps into its own project waits.

Sources: [0.3.5 "Dev map rebuild"](../plans/0.3.5.md) (bundles retirement with the split: see report); Claude 28ca77c4 16:30.

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

Sources: [0.3.3 "One SAAM orchestrator per OS"](../plans/0.3.3.md); `.local/DEVELOPMENT.md` "No silent dev instances"; `.local/team/BRIEF.md`.

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

### Map position edits ride along
> "We don't need to commit specifically FOR any of my map position edits. This can be a hard and fast rule. Any updates I make will be committed with the next feautre based checkpoint that we would have done anyway." — owner, 2026-10-05 (Claude 28ca77c4 00:55)

Summary: the owner's map edits are committed with the next ordinary checkpoint.

Sources: `.local/DEVELOPMENT.md` Rules.

### Checkpoints, releases and machine load
Agent wording recorded as standing owner authorizations, owner words not found here: checkpoint after every verified task on `codex/remettub-dev-branch` without asking (2026-10-03), no push; a requested push may continue into a release when warranted; at most three concurrent workers and one heavy job machine-wide (2026-10-04).

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
