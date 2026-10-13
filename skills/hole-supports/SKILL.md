---
name: hole-supports
description: Experimental. Downward-hole printing guidance using general breakaway bridge supports or an additional sacrificial membrane Slice below the overhang.
metadata:
  saam-kind: guidance
---

# Downward-facing holes

For a recess narrowing into a bore above air, choose the construction in chat.
Removal access, bridge span, material and cooling need review; these methods
have no physical printing qualification.

- A removable landing support uses [bridge-supports](../bridge-supports/SKILL.md):
  specify a base on the bed or printed part and its landing curve. Rings/arcs/strips
  use the same Trace stack. Bridge from the resulting printed edge; remove it later.
- A drill-through membrane is an additional ordinary [Slice](../slice/SKILL.md)
  below the first overhang course. Supply a thin filled guide solid/footprint;
  slicing empty air cannot create it. Use zero loops, dense fill and one row direction,
  extending anchors into the supporting rim. Drill through after printing.

With a shoulder at Z6.0 and 0.2mm layers, the membrane course tops at Z6.0,
and the first model overhang course tops at Z6.2. The membrane occupies 5.8–6.0.
Use ordered lower-body, membrane and upper-body recipe assignments on the
same layer grid; preserve the original model geometry and ordinary wall/fill settings.
Anchor overlap is intentional. This earlier membrane is an owner-selected adaptation
of TKeller's membrane idea, whose original transition printed in the overhang course.
Stepped reduction is excluded. No specialized hole-support runtime or editable
feature record is installed; use normal Slice/Trace tools and Bundle revisions.
Review the complete toolpath in Studio through the [shared workflow](../../core/print/USAGE.md).
