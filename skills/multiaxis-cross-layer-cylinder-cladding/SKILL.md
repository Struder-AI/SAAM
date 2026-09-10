---
name: multiaxis-cross-layer-cylinder-cladding
description: Generate preview-only axial cladding around a known deposited cylinder using alternating vertical Z strokes and supported turnarounds. Use for future multi-axis deposition demos requiring cross-layer reinforcement or a straight cylindrical skin; do not use this skill to generate Dobot motion or Lua.
---

# Multi-Axis Cross-Layer Cylinder Cladding

> **Imported preview-only concept.** This is preserved design knowledge, not a
> callable SAAM operation or machine capability. It requires an orientation,
> collision, kinematics, composition, export, and review implementation before
> executable use.

This geometry skill is for future multi-axis deposition previews. It does not
define nozzle orientation, kinematics, collision safety, machine control, or
executable robot code.

## Derive the path

Record the cylinder center, support radius `r_support`, contact heights,
measured bead width `b`, and target spacing `s_target`.

```text
r_path = r_support + s_target
n = nearest even integer(2 pi r_path / s_target)
s_actual = 2 pi r_path / n
physical_overlap = b - s_actual
```

Increase `n` to the next even integer if `s_actual > b`. Keep `r_path` constant
so the cladding remains straight and coaxial.

At angular station `i`, print between bottom and top Z, alternating direction.
Join adjacent stations with short supported arcs at alternating ends. Where
ribs interrupt the cylinder, split the skin into independent exposed panels;
never run a serpentine through a rib.

## Validation

- Constant radius and common axis.
- Exact vertical span.
- `s_actual <= b`.
- Supported turnarounds.
- Bead-volume and centerline previews.
- Explicit separation between independent rib-bounded panels.
- No claim of machine executability from preview validity.

Label all output **EXPERIMENTAL MULTI-AXIS CONCEPT · PREVIEW ONLY**.
