# Nudge Cup

A proposed self-righting desk cup, 44 mm maximum diameter and 40 mm tall. It prints
mouth-down and is inverted for use. An open reinforced lip, a light spiral wall,
a weighted full-fill foot and three curved contact-skin layers belong to one
continuous object. The component meshes and explicit operation dependency show
why different toolpath skills can be useful in the same part.

```sh
node studio/server.mjs
```

Choose this example from the tour. Your copy is saved automatically.

Inspect each material region and the transition from the spiral wall into the
foot. Ask the agent to explain the mass distribution, change the lip reinforcement,
or compare a heavier upper wall. The cup component is a solid guide; its printing
recipe creates the open interior. The foot mesh contains its own narrowing cavity.

[recipe.mjs](recipe.mjs) reproduces the original Nudge Cup geometry and composition
using current S5 defaults, with no saved personal setup or approvals. The underlying
skills are [vase wall](../../../skills/vase-wall/SKILL.md),
[full fill](../../../skills/full-fill/SKILL.md),
[planar infill](../../../skills/planar-infill/SKILL.md) and
[draped skin](../../../skills/draped-skin/SKILL.md).

Self-righting is a design intent, not a tested product rating. The narrowing cavity
still ends in a bridge; verify its support, the wall/foot transition and the curved
contact surface before printing. Physical balance depends on the deposited mass,
surface contact and contents. Tall or off-center contents can defeat recovery.
