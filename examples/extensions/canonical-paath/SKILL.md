---
name: canonical-paath
description: Experimental canonical Paath extension example with one exact cubic and one stationary dose.
metadata:
  saam-kind: geometry
---

# Canonical Paath example

This portable `operation-edit` extension demonstrates
`Toolpath.paathAssignment({id, entities, natives, after, process, toolIndex})`.
It never reads the recipe: it adds its operation, or changes its earlier one
found through `Recipe.assignment(id)`. Copy this directory to the
installation's local extensions folder as `canonical-paath`, then invoke it
through `apply_extension`. Requests accept `id`, `lengthMm` (default 2) and `toolIndex`
(default 0). Existing assignments are retained; the chosen ID is replaced.

The example proposes an exact cubic curve at Z=0.2 mm, with rate 0.08 mm³/mm,
aspect 2, requested speed 20 mm/s, tool axis -Z and independent material normal
+Z. It then requests a stationary 0.02 mm³ dose at 0.01 mm³/s and a 0.1 s hold.
The point's arrival and departure do not replace that instruction. There is no
intrinsic roll or selected-machine/nozzle geometry in the contribution.

Entities retain their geometry and canonical anchors through common admission;
they do not pass through raw Trace sampling, fitting or dimension conversion.
`after` on an entity names local entity IDs. Assignment `after` names ordinary
manufacturing prerequisites. Optional native records carry `{id,stackId,index,
sequence,surface?}`; `layerId` selects one. Process defaults are resolved by the
host. The logical tool index is assigned to a physical tool separately.

The host owns recipe publication, scheduling, review and Export. This is an
authoring example, with no physical printing qualification. Inspect and Export
the resulting Bundle through the ordinary human review workflow.
