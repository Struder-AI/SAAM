# Hole transition examples

These complete `create_bundle` inputs contain ordinary geometry and Slice/Trace.
They are software examples, not physical qualification.

| Recipe | Construction |
|---|---|
| [Stepped](stepped.json) | A 6 mm host with a 1.8 mm recess and .8 mm bore; five native partial bridge slices use edge-derived material masks. Source/schedule pass. |
| [Tilted stepped](tilted-stepped.json) | The same construction rotated 30 degrees, with normal-aligned tool poses and native slice identities. Source/schedule pass; this is not a bed-ready orientation for its saved three-axis machine. |
| [Planar wave](wave.json) | Printed square rim to a geometric inner edge; interpolated fronts require only the base and previous front. Source/schedule pass. |
| [Curved wave](curved-wave.json) | The same edge construction on a rotated saddle. Source/schedule pass; Export needs a machine supporting the changing tool orientation. |

Inspect apertures, strand support and removal. The [extension manual](../SKILL.md)
owns current interfaces; [hole guidance](../../hole-supports/SKILL.md) owns choice
and [original STEP provenance](../../hole-supports/references/README.md) owns the exemplar.
