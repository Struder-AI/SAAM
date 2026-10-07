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
> "Trace is supposed to operate on curves. Why does it have any surface dependencies whatsoever? We will likely be removing those." — owner, 2026-10-01 (Codex 01a0f65b 07:27)
>
> "Trace IS the deposition primitive. Did we also build tools for arraying that primitive along surfaces? That's kind of what slice is." — owner, 2026-10-01 (Codex 01a0f65b 07:45)
>
> ""A Trace curve can contain UV coordinates plus a named patch, slice or sleeve reference" - good, we keep this. … Go ahead and change advanced vase to an extension, and down scope trace." — owner, 2026-10-01 (Codex 01a0f65b 07:52)

Summary: Trace deposits along curves (which may carry a surface reference for their coordinates) and has no surface machinery of its own; surface-generated curves come from their producers.

Sources: Codex 01a0f65b; [Extensions](extensions.md#advanced-vase-is-an-extension).

## Slice is one general operation
> "We've received word that the intended slice consolidation/generalization didn't actually get done, complexity got bundled into slice instead of the actual complexity reduction/generalization that was intended." — owner, 2026-10-02 (Codex 01a0fad5 04:21)
>
> "do you understand how each of the cases you mentioned can instead be served by the same generalized slice functionality? OTHER THAN maybe the vase mode parallel route - … BUT even if so it shouldn't be a parallel route within slice, it should be trace, using curves generated via the reference surface, and that should be an extension." — owner, 2026-10-02 (Codex 01a0fad5 04:31)

Summary: Slice is one owned-region/reference-family operation; lip, cladding, skin, brim and support are inputs to it, not separate producers, and the vase spiral is Trace in an extension.

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

Sources: Codex 01a0ff63 03:42-04:55; Codex 01a102a0 17:14; Claude 98e25b54 15:40. [0.3.4 "Slice ownership by rule"](../plans/0.3.4.md) records the gap as "Separately decide … 0.1 to 0.15 mm", and the skill still uses 0.1 (see report).

## Overlapping claims and the overlap check
> "That's a stupid arbitrary check that only gets in the way (just saying this so our review catches the bug). We need to print it!" — owner, 2026-10-03 (Codex 01a0ff63 03:38)
>
> "Okay, good to correct that misunderstanding, but that's still a shit check. Can you tell me why?" — owner, 2026-10-05 (Claude c6c50c08 17:11)
>
> "slab-under-skin should be used for standard supports as well" — owner, 2026-10-05 (Claude 98e25b54 15:39); "I just mean, if we have dedicated wiring … use that for all operations that do exactly the same thing." (15:40)
>
> "I don't feel like we've seen eye-to-eye yet on slab under skin. After restart, you should explain to me in more depth what is going on there." — owner, 2026-10-05 (Claude 98e25b54 15:43)

Summary: the Slice overlap refusal is a bad check, and operations that do the same thing share one wiring. **Owner question pending**: the 0.3.4 row proposes settling overlaps by an ownership rule because no dedicated slab-under-skin mechanism exists; the explanation the owner asked for is not recorded.

Sources: [0.3.3 "One wiring for slab-under-skin"](../plans/0.3.3.md) (retired); [0.3.4 "Slice ownership by rule, not overlap refusal"](../plans/0.3.4.md); `.local/team/questions.md` (after-restart note).

## Material overlap and shared ownership (0.4.0)
> "material overlap is too difficult for today, we need to defer it to 0.3.0"; "Should return as unsupported"; "make sure the tolerances for 'touching' are reasonable" — owner, 2026-09-30 ([D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries))

Summary: competing material overlaps return unsupported and touching boundaries are allowed; shared ownership (first explicit claimant principal, subordinate regions adapting layers and interlock) is 0.4.0 intent.

Sources: [0.2.0 Settled intent](../plans/0.2.0.md#settled-intent); [0.4.0 "Material overlap and shared ownership"](../plans/0.4.0.md) (agent wording); [D-042](../DECISIONS.md#d-042--020-authoring-and-shared-deposition-intent) ("Finish shared ownership integration", 2026-09-29).

## No general gap filling
> "We NEVER want this" — owner, 2026-09-30, on general gap filling ([D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries))

Summary: general gap filling is rejected, not deferred; local gap-volume compensation and substrate adaptation are separate behaviour.

Sources: [D-043](../DECISIONS.md#d-043--complete-consolidation-and-role-boundaries); [0.2.0 Settled intent](../plans/0.2.0.md#settled-intent); owner's guidance prompt 2026-10-02 (listed as a deliberate removal).

## Substrate adaptation is the agent's choice
Agent wording; owner confirmed the Studio controls gone (0.2.0 R11): substrate adaptation is opt-in (`experimental.substrateAdaptation`), chosen by the agent with no Studio toggle; off uses nominal references, on adjusts gap/volume or follows the surface using finalized deposition.

Sources: [0.2.0 Settled intent and R11](../plans/0.2.0.md); [GLOSSARY](../GLOSSARY.md).

## Modulation and fields
> "Fields are supposed to apply to toolpaths. Do they not?" — owner, 2026-10-03 (Codex 01a0ffa3 02:59)

Summary: modulation applies optional, mainly visual and surface effects to an otherwise valid toolpath, and fields change the actual toolpath; other uses stay open and graded infill was not requested (agent wording, owner amendment 2026-09-29).

Sources: [D-042](../DECISIONS.md#d-042--020-authoring-and-shared-deposition-intent) (scope amended by owner 2026-09-29); [0.2.0 Settled intent](../plans/0.2.0.md#settled-intent); [0.4.0 Possibilities](../plans/0.4.0.md#possibilities-without-a-settled-requirement).

## Vase modes
> "I've made the decision to have two "vase mode" skills (if we don't already). One is our a standard vase mode, similar to what all the other slicers would implement. The "advanced" vase mode uses our motif and pattern etc." — owner, 2026-09-16 ([D-032](../DECISIONS.md#d-032--separate-standard-and-advanced-vase-mode-manuals))

Summary: standard vase is the conventional continuous spiral wall and advanced vase adds motifs and patterns; in advanced vase a tile can keep its size, so a wider part of the vase carries more courses per turn (0.3.6; the owner's request is recorded only in agent wording).

Sources: [D-032](../DECISIONS.md#d-032--separate-standard-and-advanced-vase-mode-manuals); [0.3.6 "Advanced vase tiles keep their size"](../plans/0.3.6.md); [D-041](../DECISIONS.md#d-041--offsets-resolve-collisions-ribbons-displace-without-a-surface) (vase wall centerline from each slice outline).

## Ordering and scheduling
> "We don't need to consider heat (yet - record this decision to defer these considerations)." … "Just a simple "jump to closest entry point" would be a massive improvement already." — owner, 2026-09-10 ([D-026](../DECISIONS.md#d-026--closest-region-entry-first-defer-heat-considerations))

Summary: regions are entered closest-first and dependency-ready operations run by actual maximum Z; heat, lookahead, layer batching and carriage collision avoidance are 0.4.0 intent.

Sources: [D-026](../DECISIONS.md#d-026--closest-region-entry-first-defer-heat-considerations); [0.2.0 Settled intent](../plans/0.2.0.md#settled-intent); [0.4.0 scheduling, collision and thermal rows](../plans/0.4.0.md).

## Recommended values are not limits
> "0.3 is an arbitrary limit for no good reason, don't follow it, and change the guidance so it's "suggested for standard printing" or something rather than being presented as an actual limit." — owner, 2026-10-03 (Codex 01a0ff8a 02:20)

Summary: typical process values (such as bead height) are suggestions for standard printing, never limits.

Sources: Codex 01a0ff8a 02:20; [Principles](principles.md#limits-and-checks-must-earn-their-place).
