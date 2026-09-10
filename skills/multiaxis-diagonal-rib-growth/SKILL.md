---
name: multiaxis-diagonal-rib-growth
description: Generate preview-only diagonal rib primordia for future multi-axis deposition by growing narrow closed bridge loops outward from an already deposited flange-cylinder inside corner. Use for conceptual 6-axis toolpath demos where ribs must be woven into known prior material; do not use this skill to generate Dobot motion or Lua.
---

# Multi-Axis Diagonal Rib Growth

> **Imported preview-only concept.** This is preserved design knowledge, not a
> callable SAAM operation or machine capability. It requires an orientation,
> collision, kinematics, composition, export, and review implementation before
> executable use.

This is a geometry and preview skill for a future multi-axis printer. It does
not define nozzle orientation, robot kinematics, collision clearance, flow
control, Dobot motion, or executable Lua.

## Inputs

- Actual deposited flange plane `z_flange`.
- Actual deposited cylinder support radius `r_cylinder`.
- Final core endpoints `r_outer` and `z_top`, including bead allowances.
- Rib angles, core width, bead width, and buildup spacing.
- All prior-operation geometry. Never substitute the final CAD envelope for
  as-built support.

## Construction

For growth fraction `f`, with `0 < f <= 1`, define parallel bridges in radial-Z
section:

```text
lower(f) = (r_cylinder + f (r_outer - r_cylinder), z_flange)
upper(f) = (r_cylinder, z_flange + f (z_top - z_flange))
```

The first bridge is nearly zero-length at the inside flange-cylinder corner.
Each later bridge grows longer while remaining parallel. Its lower endpoint
always contacts deposited flange material and its upper endpoint always
contacts deposited cylinder material.

Turn each bridge into a narrow closed loop with two touching diagonal legs at
constant width, joined across the width at both endpoints. Create every rib
independently; do not add a cylinder hoop or connect behind the ribs.

## Dependency rule

The as-built diagonal envelope is shared geometry. Changing its radii, Z
limits, width, or spacing requires regeneration of downstream fillets,
cladding, cylinder-panel boundaries, flange occupancy masks, and encapsulation
passes. Downstream paths must query this envelope instead of copying a final
part slope.

## Validation

- Every loop is closed and has constant width.
- Lower endpoints lie on `z_flange`.
- Upper endpoints lie on `r_cylinder`.
- Spans increase strictly and remain parallel.
- Later paths contact prior deposited bead envelopes.
- Fillets taper before rib support ends.
- No machine executability is inferred from a valid preview.

Label all output **EXPERIMENTAL MULTI-AXIS CONCEPT · PREVIEW ONLY**.
