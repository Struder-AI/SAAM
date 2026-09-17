# Machine output

```saam-components
interpret | @core/export/registry.mjs::interpretProgram | saved bytes; plan; machine | checked interpreted program | Declared available output only; adds travel advisory; source commands determine motion.
griffin | @core/export/griffin.mjs::interpretGriffin | G-code text; plan; machine; optional move store | checked moves, events and totals | Checks Griffin envelope and modal G-code, commanded bounds/feed/flow; does not establish physical behavior.
motionWriter | @core/export/griffin.mjs::exportMotion | SAAMpath; plan; extrusion mode | G-code body lines | Absolute or relative E; writes selected process actions; no firmware envelope.
```

```saam-page 6_output
title 6 — Check commands
sub Level 1 · interpret the bytes that review and delivery consume
parent 0_system output
in path / plan
out checked program
port in | path / plan
box dispatch | 6.1 | select output | @core/export/registry.mjs::outputAdapter
box pipeline | 6.2 | export and interpret | @core/export/registry.mjs::exportAndInterpretProgram
box cartesian | 6.3 | write G-code | >6a_gcode
box robot | 6.4 | write robot program | >6b_robot
box advisory | 6.5 | report short travel | @core/export/travel-advisory.mjs::withTravelAdvisory
port out | checked program
in > pipeline | path and locked settings | data
pipeline > dispatch | declared output | data
dispatch > pipeline | available adapter | data | norank
pipeline > cartesian | S5 / H2D | gate
pipeline > robot | Dobot / DENSO | gate
cartesian > pipeline | bytes and interpretation | data | norank
robot > pipeline | bytes and interpretation | data | norank
pipeline > advisory | checked program | data
advisory > out | bytes; moves; checks | data
```

```saam-page 6a_gcode
title 6.3 — Write G-code
sub Level 2 · H2D retains its packaging-time interpretation
parent 6_output cartesian
in S5 / H2D
out bytes and interpretation
port in | S5 / H2D
box s5 | 6.3.1 | emit Griffin | @core/export/griffin.mjs::exportGriffin
box h2d | 6.3.2 | package H2D | @core/export/bambu.mjs::exportAndInterpretBambu
box motion | 6.3.3 | emit body | $motionWriter
box decode | 6.3.4 | check Griffin | $griffin
box body | 6.3.5 | check H2D body | @core/export/bambu-player.mjs::interpretBody
port out | bytes and interpretation
in > s5 | S5 | gate
in > h2d | H2D | gate
s5 > motion | absolute E | data
h2d > motion | relative E | data
motion > s5 | body lines | data | norank
motion > h2d | body lines | data | norank
s5 > decode | complete source | data
h2d > body | body source | data
body > h2d | totals / thumbnail motion | data | norank
decode > out | Griffin bytes / program | data
h2d > out | archive / program | data
```

```saam-page 6b_robot
title 6.4 — Write robot program
sub Level 2 · installation and relay intent remain explicit
parent 6_output robot
in Dobot / DENSO
out bytes and interpretation
port in | Dobot / DENSO
box dobot | 6.4.1 | emit Lua | @core/export/dobot.mjs::exportDobot
box denso | 6.4.2 | emit PACScript | @core/export/denso.mjs::exportDenso
box checkDobot | 6.4.3 | interpret Lua archive | @core/export/dobot.mjs::interpretDobot
box checkDenso | 6.4.4 | interpret PAC archive | @core/export/denso.mjs::interpretDenso
port out | bytes and interpretation
in > dobot | configured Dobot | gate
in > denso | configured DENSO | gate
dobot > checkDobot | archive bytes | data
denso > checkDenso | archive bytes | data
checkDobot > out | bytes / commands / estimates | data
checkDenso > out | bytes / commands / estimates | data
```

## Process actions

[Output contracts](../core/export/README.md) own supported dialects and limits.
Griffin/H2D stationary deposition uses E-only commands; interpretation resolves
retraction debt before counting volume and records zero-length injection moves.
Injection events retain position, volume, temperature and source time.
Temperature actions park, synchronize with `M400`, wait with `M109 S`, and
restore the normal target afterwards. Do not assume Marlin `M109 R` cooling
semantics apply to these dialects.
Thermal wait duration and actual temperature are not simulated. Robot relay
outputs reject those process actions. Validation is software evidence about
commands; physical operation needs its own evidence.

## Command validation

[Machine profile validation](../core/machine/profile.mjs) owns capability checks.
Production bounds, feed and flow checks consume interpreted export commands,
including selected-tool limits. `checkMachinePath` remains available to tests;
Dobot uses it on commands reconstructed from Lua. The bounded wedge shares
profile validation and output selection through its own eight-point generator.
Registry dispatch rejects unavailable declared outputs.
