# Principles

Code shape, complexity, tolerances, limits and checks. These apply in every area. [Index](README.md)

## Complexity reduction and special cases
> "We want complexity reduction. SAAM is being pulled toward a small number of deep, general operations. Inject, Trace and Slice are meant to be *how every technique is expressed*, not shared vocabulary draped over technique-specific lifecycles. Geometry owns construction, numerical representation and native lifetime… Neutral toolpath completion knows nothing about the selected machine. Bundle is the only shared part-state authority. … An operation runs when its own prerequisites exist; no stage order or complete recipe gates it." — owner's guidance prompt, 2026-10-02 (Codex 01a0fdfa 19:00)
>
> "it goes farther than that. That's a weak statement of the ideal. Special cases themselves are a red flag that we have unnecessary complexity." — owner, 2026-10-02 (Codex 01a0fa1c 04:52)
>
> "Special cases are a red flag. Always ask "can there be fewer special cases if I did this differently"? The ones that survive need justification that matches current intent, not just historical. Put the invariant in the operation boundary. … Consolidation is done when consumers use the general operation and the old routes are gone. An adapter that stays needs a current consumer and a concrete reason." — owner's guidance prompt, 2026-10-02 (Codex 01a0fdfa 19:00)

Summary: SAAM moves toward a few deep, general operations with small interfaces; every special case is evidence the operation may be wrong, and consolidation is finished only when the old routes are gone.

Sources: [DEVELOPER-CONTEXT "Architectural discipline"](../DEVELOPER-CONTEXT.md#architectural-discipline) (holds the owner's prompt); [0.3.2 "Complexity rule, owner direction"](../plans/0.3.2.md#small-truthful-map-reads-and-complexity-reduction) (agent wording); [0.2.0 Architecture](../plans/0.2.0.md#architecture-and-records) (Ousterhout refactor as release goal); [0.3.1 "Impose the map to simplify"](../plans/0.3.1.md); Codex 01a0fa1c 04:48 ("His talking points define several of our coding ideals"); Claude e49ed69c 10-02 18:47; Claude 14d40329 10-06 05:08 ("Aren't you guys reading the ousterhout guidance?").

## Consolidate; don't add
> "Are you ADDING things? We are supposed to be consolidating." — owner, 2026-10-01 (Codex 01a0f5e7 08:14)
>
> "And I hope you are eliminating any now-unneeded code as you go." — owner, 2026-10-01 (Codex 01a0f65b 08:30)
>
> "You always overbuild everything." — owner, 2026-10-06 (Claude 14d40329 05:08)

Summary: work removes what is no longer needed and adds nothing without an actual consumer.

Sources: Codex 01a0f5e7 08:14; Codex 01a0f65b 08:30; Codex 01a0f755 12:20 ("Make sure you aren't suggesting anything that no one is actually using."); Codex 01a0f748 11:51 (merged work expected to bring LOC down); Claude 14d40329 05:08.

## Deliberate removals stay removed
> "Deliberate removals (ribbons, templated shapes, general gap fill, the three-approval ceremony, web relay) and deliberate changes (vase family direction, source-only leaf panes, deferred material overlap) are not regressions. Reading an old decision and restoring what it describes is MORE damaging than dropping a live obligation." — owner's guidance prompt, 2026-10-02 (Codex 01a0fdfa 19:00)
>
> "Good. Is someone going to add those back in later?" — owner, 2026-10-02 (Codex 01a0fe18 19:55), quoting the "Loss through replacement" pattern

Summary: something removed on purpose is absent by choice, and a replacement must carry every behaviour of the path it replaces.

Sources: Codex 01a0fdfa 19:00; Codex 01a0fe18 19:55; [DEVELOPER-CONTEXT "How it has gone wrong"](../DEVELOPER-CONTEXT.md#how-it-has-gone-wrong).

## No ceremony
> "There still feels like there is a LOT of ceremonial protocol/rules here" — owner, 2026-10-03 (Codex 01a102a0 17:33)
>
> "THe fingerprint isn't actually doing anything, it's just meaningless ceremony" — owner, 2026-10-06 (Claude 14d40329 04:56)
>
> "If this keeps up I'm going to ban approvals." — owner, 2026-10-06 (Claude 14d40329 04:57, queued)

Summary: protocol that re-verifies SAAM's own work or confirms what the single operator already did is complexity to remove (see [Bundle](bundle.md#bundle-state-no-fingerprints-or-approvals)).

Sources: Codex 01a102a0 17:33; Claude 14d40329 04:56, 04:57, 05:08; Claude 28ca77c4 16:30 ("This seem like counterproductive ceremonial rules to me."); [0.3.6 "Retire fingerprint ceremony"](../plans/0.3.6.md).

## No passthrough wires
> "It seems to me that passthrough wires like in your mergeSettings example increase complexity and reduce visibility and we should avoid coding like that without good reason." — owner, 2026-10-04 (Claude 28ca77c4 23:06); approved wording "That wording is good." (01:21)

Summary: avoid generic code that routes values by keys known only at run time unless there is good reason.

Sources: [D-051](../DECISIONS.md#d-051--code-shape-no-passthrough-wires-without-good-reason); [DEVELOPER-CONTEXT code shape 5](../DEVELOPER-CONTEXT.md#code-shape); [0.3.3 "Passthrough record walkers"](../plans/0.3.3.md); Claude 28ca77c4 23:03 ("So you are asking for permission to create black boxes that the intent cannot be traced through.").

## Code the analysis can model
> "Code it can't model will be banned outright in SAAM. We will have to decide whether supporting a given code shape is worth it." — owner, 2026-10-04 (Claude 1bdc613c 04:04)
>
> "If A calls B and B returns to A and also passes data to C and also does twenty other things, that code is bad and should be rewritten." — owner, 2026-10-04 (Claude 1bdc613c 04:19)
>
> "Let's include in your scope the work of rewriting our code, hopefully resulting in identical functionality, to match our code shape rules (here rules DO work well)." — owner, 2026-10-04 (Claude 28ca77c4 16:46)

Summary: SAAM code uses only shapes the dev-map analysis models; a callable either answers its caller or acts and returns only its outcome, and code is rewritten to fit.

Sources: [dev-maps "What SAAM code is"](../plans/dev-maps.md#what-saam-code-is); [D-046](../DECISIONS.md#d-046--rebuilt-dev-maps-causal-arrows-and-banned-unmodelled-code); [D-047](../DECISIONS.md#d-047--command-outcomes-and-one-arrow-per-pair); [DEVELOPER-CONTEXT code shape 1-4](../DEVELOPER-CONTEXT.md#code-shape) (agent wording; rules 1-3 from [D-038](../DECISIONS.md#d-038--dev-map-intent-functional-tree-complete-leaf-context-findings-kept-code-shape-rules), owner-reviewed 2026-09-21); Claude 016a097d 05:13 ("I'm not sure that I was asking for strict command-query separation. Seems only possible at the leaf node, level, right?").

## Dimensions and tolerances
> "I don't know why the hell we are doing anything at 1e-9 mm - crucial intent for 0.3.6: everything in saam, anyone building extensions for saam, must understand what dimensions we are actually dealing with and what tolerances are appropriate. You don't need me to tell you. You just haven't thought about it. And then we need guidance to ensure that tolerance awareness stays in the development culture and doesn't drift." — owner, 2026-10-06 (Claude 14d40329 03:06, queued)
>
> "make sure the tolerances for 'touching' are reasonable" — owner, 2026-09-30 ([D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries))

Summary: every tolerance in SAAM and its extensions comes from the dimensions SAAM actually prints at and names what it protects; guidance and checks keep that from drifting. **Owner question pending**: the agent-written code-shape rule 6 keeps a 1e-9 mm "numeric conditioning" class; questions-036 #38 asks whether that is acceptable and is unanswered.

Sources: [0.3.6 "Dimensions and tolerances"](../plans/0.3.6.md); [DEVELOPER-CONTEXT code shape 6](../DEVELOPER-CONTEXT.md#code-shape) (agent wording); [core/README dimensions and tolerances](../core/README.md#dimensions-and-tolerances); `.local/team/questions-036.md` #38; Claude 3594b461 10-06 19:11 (queued: "tolerances were supposed to be completed by the last orchestrator").

## Memory limits adapt to the system
> "memory limits must be adaptive and appropriately sized for the system." — owner, 2026-10-06 (Claude 3594b461)

Summary: memory limits are derived from the machine SAAM runs on, not fixed numbers.

Sources: Claude 3594b461 (2026-10-06); tester incident 2026-10-06 (an agent's script added "an arbitrary ram check that was way too conservative for his system"); brain 44375 generation exhausting the default worker heap (DEVLOG 2026-10-06).

## Limits and checks must earn their place
> "No it is not our job to limit flow. The machine generally will do that anyway. Judgement is required to choose fields that don't result in excessive flow, and when that fails, the machine already catches it. If for some crazy reason we did need to cap it, the appropriate place for that cap would be in that specific machine's exporter." — owner, 2026-10-01 (Codex 01a0f6ac 09:14)
>
> "I didn't necessarily mean that "generation invoking export/check is bad", what is bad is doing it twice, or doing it in a sub-optimal place, or doing a check that doesn't offer anything or isn't worth the delay" — owner, 2026-10-01 (Codex 01a0f6ac 08:59)
>
> "0.3 is an arbitrary limit for no good reason… change the guidance so it's 'suggested'" — owner, 2026-10-03 (Codex 01a0ff8a 02:20)
>
> "You will have to convince me that any checks we have here actually provide value rather than just limiting functionality and causing stumbling blocks." — owner, 2026-10-05 (Claude 98e25b54 15:29)

Summary: a limit or check stays only if it prevents a real failure, once, in the right place; recommendations are not limits, and valid work is never rejected by an arbitrary budget.

Sources: Codex 01a0f6ac 08:59, 09:14; Codex 01a0ff8a 02:20; Claude ec6035d1 05:37 ("Can this system for avoiding our arbitrary-limit-sickness be better?"); Claude 98e25b54 15:29; `.local/DEVELOPMENT.md` "Avoid fixed failing budgets" (owner clarification 2026-10-03, agent wording); [core/README limits](../core/README.md#limits-that-adapt-and-limits-that-are-kept); see [Export and machines](export-and-machines.md#no-limit-checks-in-profiles-or-export) and [Settings](settings.md#material-limits-temperature-only).

## Software results are not print results
Agent wording, no approval found: "Software support is not print evidence"; physical qualification continues across releases and no software check implies print approval.

Sources: [0.2.0 Verification](../plans/0.2.0.md#verification-limits-and-completion); [0.4.0 Scope boundaries](../plans/0.4.0.md#scope-boundaries); [DEVELOPER-CONTEXT rule 6](../DEVELOPER-CONTEXT.md#rules).

## Hard rules for builders and developers
Agent wording, reviewed by the owner item by item, 2026-10-04 (Claude ec6035d1 05:37-06:31): the nine rules in [DEVELOPER-CONTEXT](../DEVELOPER-CONTEXT.md#rules). Owner words on the review: "Go ahead and fix/remove/update the rules I've already commented on, then capture the spirit of it" (05:53); "Your other takes seem correct, go ahead and complete the rules rewrite" (06:11).

Summary: hard rules exist only in the owner's wording or with the owner's approval; the current list is DEVELOPER-CONTEXT's.

Sources: Claude ec6035d1; [BUILDERS rules](../BUILDERS.md#rules).
