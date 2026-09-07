# Travel and hop geometry

The shared `operations/travel.mjs` helper adds explicit travel paths before
review. All four operations support `settings.travelHopHeight` in mm:

- Omitted: preserve legacy path-only output with unplanned gaps.
- `0`: add explicit straight travel with no lift.
- Positive: lift vertically, cross at clearance height, descend vertically.

Clearance height is the highest preceding print Z (or either transition
endpoint if higher) plus the requested hop. The MCP compiler applies this
helper after placement, retaining the preceding operations' printed height
so an operation's travel also accounts for earlier features. Continuous
paths sharing an endpoint do not get a travel or hop inserted. Hops do not
change the target's part dimensions.

This is a conservative height rule, not obstacle routing, collision
detection, machine reach validation, or a check of end-effector clearance.
Explicit travel and its clearance are visible plan geometry. Review them
before export; changing the setting changes the plan and its approval.

Both Dobot variants follow travel coordinates. The reference Dobot keeps
extrusion on inside its single window; `dobot-stop` switches it off for
travel. Ultimaker S5 retracts, follows the same travel points, and primes
before the next print stroke. A motion's speed never decides its intent.
