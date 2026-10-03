---
name: supports
description: Experimental tree branches at authored contacts; selected curved underside support uses standard-support.
metadata:
  saam-kind: extension
---

# Tree supports

Use [shared print tools](../../core/print/USAGE.md). [Standard support](../standard-support/SKILL.md) owns provisional placement, adhesion and removal guidance and the selected underside → lowered roof → closed-to-bed → infill-only Slice method. This extension supplies explicit tree skeletons; flat footprints can instead use [Slice's support preset](../slice/SKILL.md#presets-and-patterns). No hardware is run.

Enable `skills.supports.enabled` and supply `assignments`. Each has exactly `id`, `reason`, `contactZMm`, `treeNodes`; each node exactly `id`, `parent`, `point`, `radiusMm`. XY is relative to print placement, Z above bed. Roots have `parent:null`, Z 0; children name lower parents and share trunks. Every terminal tip ends at `contactZMm-topGapMm`; different contact heights need separate assignments. Radii must be at least one bead width.

| Setting | Default | Meaning |
|---|---|---|
| `enabled`, `assignments` | `false`, `[]` | No supports inferred. |
| `topGapMm` | `0.2` | Minimum contact gap. |
| `xyGapMm` | `0.3` | Clearance to part sections at every layer. |
| `treeChordMm` | `0.02` | Circle polygon tolerance. |

Each layer unions circles interpolated along skeleton branches; this is SAAM's construction, not Bambu's tree algorithm. Judge branch lean, section overlap between layers, root adhesion, tip coverage and removal access. Record a reason/contact-removal tradeoff per assignment; selection remains authored ([D-025](../../DECISIONS.md#d-025--support-areas-assigned-through-judgment)).

Branches use one loop and 15% rows, with the last two courses at 0.8 density. Flat-footprint Slice supports use the same settings and require an explicit footprint, contact height, top gap and XY gap, with `part:null`. The last course rounds down on the layer grid and the summary reports actual gaps. Supports print before part operations above them, including nonplanar ones and layer batching; they use print material/tool unless [routed elsewhere](../../core/print/USAGE.md#nozzle-selection).

Part clearance intersections are reported, not trimmed or rerouted. Tree contacts on the model, curved tree contacts and automatic routing are absent. No physical validation is claimed.
