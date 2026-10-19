# Toolpath

SAAMpath and how deposition is constructed: Inject, Trace, Slice, supports, vase, modulation and ordering. [Index](README.md)

## SAAMpath is machine-independent
> "Let's use SAAMpath" — owner, 2026-09-08 ([D-018](../DECISIONS.md#d-018--saampath))
>
> "Only actual export modules are allowed to block something on machine compatibility" — owner, 2026-09-30 ([D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries))

Summary: SAAMpath is SAAM's own toolpath; constructing it knows nothing about the selected machine, and only an exporter decides machine compatibility.

Sources: [D-018](../DECISIONS.md#d-018--saampath); [D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries); [0.3.1 component 3 and "Machine independence is semantic"](../plans/0.3.1.md) (agent wording); owner's guidance prompt 2026-10-02 ("Neutral toolpath completion knows nothing about the selected machine", Codex 01a0fdfa 19:00); [Export and machines](export-and-machines.md#machine-rules-live-only-in-export).

## Inject, Trace and Slice express every technique
> "Inject, Trace and Slice are meant to be *how every technique is expressed*, not shared vocabulary draped over technique-specific lifecycles." — owner's guidance prompt, 2026-10-02 (Codex 01a0fdfa 19:00)
>
> "Explicit paths IS the tile" — owner, 2026-09-30 ([D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries))

Summary: Inject deposits at points, Trace along curves and Slice over 3D regions; techniques are inputs to these three, and an advanced-vase tile is nothing but its explicit Trace paths.

Sources: [0.2.0 Settled intent](../plans/0.2.0.md#settled-intent) (agent wording); [D-042](../DECISIONS.md#d-042--020-authoring-and-shared-deposition-intent); [GLOSSARY](../GLOSSARY.md).

## Trace works on curves
> "A Trace curve can contain UV coordinates plus a named patch, slice or sleeve reference" — owner, 2026-10-01 (Codex 01a0f65b 07:52)

Summary: Trace deposits along curves; surface producers supply curves and their coordinate references. Geometry stores Trace curves and Inject points; solid-free bundles can show them before generation, with auxiliary geometry hidden when appropriate (owner approval, 2026-10-12).

[Breakaway bridge supports](../skills/bridge-supports/SKILL.md) interpolate matched control nets between selected base and landing curves, open or closed, into ordinary Trace. Bases may be on the bed or printed material. Part edges receive an outward half-bead ribbon before interpolation; the factor is code-tunable, not agent-facing. Requested average layer height determines divisions. Dependencies name the actual supporting base and later bridge, allowing support and part to advance together. Membrane and bridging share printed-edge straight spans. Waves interpolate from a printed base to a final geometric edge; stepped reduction masks ordinary native slices.

[Heat-set reinforcement](../skills/heat-set-inserts/SKILL.md) keeps Boolean bore walls from the main Slice. Trace adds walls to reach max(4,N+1), with the star in the final added wall. Fixed fin sheets intersect actual inherited layers; physical offsets and every boundary's wall band clip their curves. Added walls/fins overlap unchanged main infill. Blind pads exclude existing dense coverage. Reinforcement joins its native slice completion; the successor waits for both, with no main-layer barrier.

Sources: Codex 01a0f65b; [Extensions](extensions.md#advanced-vase-is-an-extension); owner, 2026-10-03 (Codex 01a102ba, 18:25/18:32 UTC), on curve/point geometry and visibility; owner, 2026-10-12: "That statement seems fine."; owner, Codex 01a1324b, 2026-10-12/13, control-point supports, edge contacts and fixed-fin/shared-layer reinforcement.

## Slice is one general operation
> "do you understand how each of the cases you mentioned can instead be served by the same generalized slice functionality? OTHER THAN maybe the vase mode parallel route - … BUT even if so it shouldn't be a parallel route within slice, it should be trace, using curves generated via the reference surface, and that should be an extension." — owner, 2026-10-02 (Codex 01a0fad5 04:31)

Summary: Slice is one owned-region/reference-family operation; lip, cladding, skin, brim and support are inputs to it, not separate producers, and the vase spiral is Trace in an extension.

Owner clarification, 2026-10-14: planar is a slice with no curvature; cladding is a slice wrapped around itself; a lip is a slice with no infill and possibly extra loops. The agent supplies stack spacing; each slice's local normal gap is derived from that spacing and the reference geometry. Slice reads prepared material descriptions, never completed deposition. Experimental completed-material adaptation is retained only for Trace.

Implementation: reference stacks, masks, fill progression and front seeds are prepared before construction. All references use shared physical offset/pattern/mapping/gap operations. Terminal selectors copy prepared level regions and never widen them according to loop count. General self-intersection trimming for normal-offset stacks is still a Geometry requirement; the current pointwise/fitted offset charts do not satisfy it. Periodic full-wrap perimeter regions also need seam-aware offset/boundary geometry; cell-fill cladding does not establish arbitrary wrapped-loop coverage.

Sources: [0.3.2 "Slice consolidation — owner approved"](../plans/0.3.2.md#inherited-unfinished-intent); Codex 01a0fad5 04:36; Codex 01a0fb05 05:20 ("we have that as a generalized slice capability already").

## Supports are chosen by judgment
> "I do NOT like how deterministic slicers automatically scan the whole part and assign support area based on angle, so we will not be doing that." … "We will be using judgement to assign support areas." — owner, 2026-09-10 ([D-025](../DECISIONS.md#d-025--support-areas-assigned-through-judgment))
>
> "support isn't always necessary, 45 degree angle usually prints just fine, even 60 degrees I generally omit supports. And support isn't generally needed for small areas of high overhang. This guidance will be refined in the future" — owner, 2026-10-03 (Codex 01a102a0 17:14)

Summary: the maker and agent decide where support goes; SAAM never assigns support from overhang angles, and the owner's experience is guidance, not a threshold.

Sources: [D-025](../DECISIONS.md#d-025--support-areas-assigned-through-judgment); [0.2.0 Settled intent](../plans/0.2.0.md#settled-intent) ("no overhang-percentage model"); [skills/standard-support](../skills/standard-support/SKILL.md); Claude aed1fd5b 10-04 16:59 ("The support preferences currently in local was meant to be guidance for all users of SAAM").

## How standard supports are made
> "Choose the underside regions you want supported. Copy those nonplanar regions as separate surfaces (meshes in this case). Move them down in z slightly (maybe .1mm?) Then treat those as the top surfaces of some "support solids." Create walls downwards to the build plate, and close of those support solids. Then pass those support solids to slice, with 0 perimeter loops, only infill, and single-direction infill." — owner, 2026-10-03 (Codex 01a0ff63 03:42); "That's the way to make supports, confirmed." (04:19)
>
> "I think we need supports to have no hop, and no retract" — owner, 2026-10-03 (Codex 01a0ff63 04:55)
>
> "supports generally need some sort of base or brim to stick to the print bed, AND small areas with short (maybe less than 8mm) lines don't perform well" — owner, 2026-10-03 (Codex 01a102a0 17:14)
>
> "no, they have a 0.1mm gap currently, and let's make that a 0.15mm gap moving forward." — owner, 2026-10-05 (Claude 98e25b54 15:40, queued)

Summary: a standard support is the chosen underside copied down by a 0.15 mm gap and closed to the bed as a solid, sliced with no perimeters, single-direction infill, no hop or retract, on a base or brim.

Sources: Codex 01a0ff63 03:42-04:55; Codex 01a102a0 17:14; Claude 98e25b54 15:40. [0.3.4 "Standard-support gap"](../plans/0.3.4.md) records the gap as "Decide … 0.1 to 0.15 mm"; the skill uses 0.15.

## One wiring for the same operation
> "slab-under-skin should be used for standard supports as well" — owner, 2026-10-05 (Claude 98e25b54 15:39); "I just mean, if we have dedicated wiring … use that for all operations that do exactly the same thing." (15:40)
>
> "I don't feel like we've seen eye-to-eye yet on slab under skin. After restart, you should explain to me in more depth what is going on there." — owner, 2026-10-05 (Claude 98e25b54 15:43)

Summary: equivalent operations share one wiring. Owner clarification, 2026-10-17: standard support is an independent solid and ordinary Slice, with common manufactured-contact readiness; the part owns its underside. Membrane and bridging share edge construction. Draped skin is removed.

Sources: [0.3.3 "One wiring for slab-under-skin"](../plans/0.3.3.md) (retired); `.local/team/questions.md` (after-restart note).

## Overlapping material regions
> "Forget the slice stack crossing check, get rid of it entirely. Just let overlapping material regions co-exist (don't bother even reporting), since we are about to fix it in 0.4.0 anyway. And it should never happen anyway, that would be an agent error already. And now the agent gets an image, so even if it does happen, the image will probably catch it, or the user will see it. Make sure you fully remove all signs of the overlapping material regions checks, and all current intent OTHER THAN the plan in 0.4.0. I don't want this coming back to life until 0.4.0." — owner, 2026-10-11, on audit item G22

Owner, 2026-10-16: "We need to remove our support of using them by maker and builder agents. Developer agents can use, to keep working on them."

Summary: shared-material overlap/interlocking is developer-only research; [maker and builder work](../MAKERS.md#toolpaths) uses disjoint or explicitly partitioned claims. Ordinary bead overlap is separate.

Sources: [0.3.7 "Overlapping material regions"](../plans/0.3.7.md); [0.4.0 "Material overlap and shared ownership"](../plans/0.4.0.md) (agent wording).

## No general gap filling
> "We NEVER want this" — owner, 2026-09-30, on general gap filling ([D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries))

Summary: general gap filling is rejected, not deferred; local gap-volume compensation and substrate adaptation are separate behaviour.

Sources: [D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries); [0.2.0 Settled intent](../plans/0.2.0.md#settled-intent); owner's guidance prompt 2026-10-02 (listed as a deliberate removal).

## Trace substrate adaptation is the agent's choice
Owner clarification, 2026-10-14: Slice has no completed-deposition adaptation. The existing Trace-only substrate adaptation is opt-in (`experimental.substrateAdaptation`), chosen by the agent with no Studio toggle; off uses nominal references, on adjusts gap/volume or follows the surface using finalized deposition.

Sources: [0.2.0 Settled intent and R11](../plans/0.2.0.md); [GLOSSARY](../GLOSSARY.md).

## Modulation and fields
> "Fields are supposed to apply to toolpaths. Do they not?" — owner, 2026-10-03 (Codex 01a0ffa3 02:59)

Summary: modulation applies optional, mainly visual and surface effects to an otherwise valid toolpath, and fields change the actual toolpath; other uses stay open and graded infill was not requested (agent wording, owner amendment 2026-09-29).

Sources: [D-042](../DECISIONS.md#d-042--020-authoring-and-shared-deposition-intent) (scope amended by owner 2026-09-29); [0.2.0 Settled intent](../plans/0.2.0.md#settled-intent); [0.4.0 Possibilities](../plans/0.4.0.md#possibilities-without-a-settled-requirement).

## Vase modes
> "I've made the decision to have two "vase mode" skills (if we don't already). One is our a standard vase mode, similar to what all the other slicers would implement. The "advanced" vase mode uses our motif and pattern etc." — owner, 2026-09-16 ([D-032](../DECISIONS.md#d-032--separate-standard-and-advanced-vase-mode-manuals))

Summary: standard vase is the conventional continuous spiral wall and advanced vase adds motifs and patterns; in advanced vase a tile can keep its size, so a wider part of the vase carries more tile repetitions per turn (0.3.6; the owner's request is recorded only in agent wording).

Sources: [D-032](../DECISIONS.md#d-032--separate-standard-and-advanced-vase-mode-manuals); [0.3.6 "Advanced vase tiles keep their size"](../plans/0.3.6.md); [D-041](../DECISIONS.md#d-041--offsets-resolve-collisions-ribbons-displace-without-a-surface) (vase wall centerline from each slice outline).

## Ordering and scheduling
> "We don't need to consider heat (yet - record this decision to defer these considerations)." … "Just a simple "jump to closest entry point" would be a massive improvement already." — owner, 2026-09-10 ([D-026](../DECISIONS.md#d-026--closest-region-entry-first-defer-heat-considerations))

Owner, 2026-10-14: "It should determine what is underneath (not just vertical, a cladding side wall would be underneath the next one, for example), it should determine what lines/operations would block the subsequent printing of others, instead of making the agent figure all that out beforehand." "Note that we are only considering nozzle, we don't check carriage collisions yet." "It needs to be agnostic to z direction, so it can support multi-axis printers." Implementation authorized: "Good, do it." Temporary nozzle: "It doesn't matter. Effectively infinite. The machine can't ever pass under existing material." Then: "let's change the default tip so it's a sharp cone instead, maybe 15 degrees."

Owner clarification, 2026-10-14: "overlapping lines is fine - as in the heat set reinforcement fins. Only if the *nozzle* intersects with an existing line is there a problem (and there should be a small forgiveness margin)." Margin: "It should be much higher, maybe .1mm". Owner, 2026-10-16: "No, if it's hitting the boundary we clearly need a .2 forgiveness".

Owner, 2026-10-17: "But just because a slice in a stack has a dependency, doesn't mean it prints right after the dependency. That's where the scheduler comes in." Implementation authorized: "Okay, start work, set the goal, don't stop until this intention is implemented."
Summary (agent wording, approved 2026-10-17): construction publishes valid deposition and minimal prerequisites; ordered slices require their immediate predecessor, and manufactured-surface consumers require their exact base. Scheduling preserves those requirements, resolves external interference and ranks ready work by cooling/entry preferences. Export realizes physical travel and selected-nozzle access. The [scheduling manual](../core/path/README.md) owns the contract; carriage collisions, cooling dwell and slowdown remain deferred.
Sources: [D-026](../DECISIONS.md#d-026--closest-region-entry-first-defer-heat-considerations); [0.2.0](../plans/0.2.0.md#settled-intent); [0.3.9](../plans/0.3.9.md); [0.4.0](../plans/0.4.0.md); Codex 01a14aa3, 2026-10-17.

## Recommended values are not limits
> "0.3 is an arbitrary limit for no good reason, don't follow it, and change the guidance so it's "suggested for standard printing" or something rather than being presented as an actual limit." — owner, 2026-10-03 (Codex 01a0ff8a 02:20)

Summary: typical process values (such as bead height) are suggestions for standard printing, never limits.

Sources: Codex 01a0ff8a 02:20; [Principles](principles.md#limits-and-checks-must-earn-their-place).
