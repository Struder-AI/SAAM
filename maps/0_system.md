# Core and Studio

Read the affected region through `node scripts/dev-map.mjs read PAGE` so the
calculated shared-use references accompany its graph. Open `dev-map/index.html`
for the same source rendered with PackIT's layout. Skills and client adapters
are callers at the boundary; their implementations are outside these maps.
Solid wires carry data/calls, dashed red wires carry conditions. Vertical red
arrows list every other mapped use of the same component contract.

```saam-page 0_system
title 0 — Core and Studio
sub Level 0 · prepare, generate, review and deliver
width 2300
ext person | person / client
box agent | 9 | assist | >9_agent
box life | 1 | manage print | >1_lifecycle
box gen | 2 | generate | >2_generation
box geom | 3 | query geometry | >3_geometry
box region | 4 | shape regions | >4_regions
box motion | 5 | compose moves | >5_motion
box output | 6 | check commands | >6_output
box studio | 7 | review | >7_studio
box machine | 8 | pose machine | >8_machine
person > agent | request | io
agent > life | print commands | data
agent > studio | session / requests | data
life > gen | locked plan | data
gen > geom | geometry query | data
geom > gen | geometry | data | norank
gen > region | region query | data
region > gen | regions | data | norank
gen > motion | skill results | data
motion > life | path | data | norank
life > output | path / plan | data
output > life | checked program | data | norank
life > studio | bundle | data
studio > life | review actions | data | norank
studio > machine | source / time | data
machine > studio | poses | data | norank
```

Scope is the implemented shared workflow. The bounded wedge supplies a separate
skill generator through the same lifecycle. A map anchor establishes location;
it does not prove an arrow's behavior or enumerate every possible caller.
Follow calculated shared uses before editing a reused component, and inspect
source callers outside the mapped core/Studio boundary.
