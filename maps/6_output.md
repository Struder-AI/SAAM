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
box 6c | 6.6 | interpret bounded Lua | >6c_lua
ext 6cCaller | shared callers
6cCaller > 6c | Lua sources / bound globals | data
6c > 6cCaller | program results / error | data | norank
box 6d | 6.7 | package source archives | >6d_archive
ext 6dCaller | shared callers
6dCaller > 6d | entries / ZIP bytes | data
6d > 6dCaller | archive / decoded entries | data | norank
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
box lines | 6.3.6 | iterate source lines | @core/export/gcode-lines.mjs::gcodeLines
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

[Output contracts](reference/output.md) own supported dialects and limits.
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


```saam-scope
core/export/ | Machine program writing, decoding, packaging and checking
```

```saam-references
output | maps/reference/output.md | Output compatibility, process actions and validation
griffin | maps/reference/griffin.md | Griffin emission and interpretation
bambu | maps/reference/bambu.md | Bambu packaging and interpretation
dobot | maps/reference/dobot.md | Dobot Lua output and interpreter limits
denso | maps/reference/denso.md | DENSO output and interpreter limits
```


```saam-page 6c_lua
title 6.6 — interpret bounded Lua
sub Shared responsibility · contracts remain with the owning region
parent 6_output 6c
in Lua sources / bound globals
out program results / error
port in | Lua sources / bound globals
port out | program results / error
box n0 | 6.6.1 | tokenize Lua | @core/export/dobot-lua-subset.mjs::tokenize
in > n0 | tokenize Lua inputs | data
n0 > out | tokenize Lua result | data
box n1 | 6.6.2 | parse Lua subset | @core/export/dobot-lua-subset.mjs::parse
in > n1 | parse Lua subset inputs | data
n1 > out | parse Lua subset result | data
box n2 | 6.6.3 | execute bounded runtime | @core/export/dobot-lua-subset.mjs::LuaRuntime
in > n2 | execute bounded runtime inputs | data
n2 > out | execute bounded runtime result | data
box n3 | 6.6.4 | provide standard library | @core/export/dobot-lua-subset.mjs::standardLibrary
in > n3 | provide standard library inputs | data
n3 > out | provide standard library result | data
```


```saam-page 6d_archive
title 6.7 — package source archives
sub Shared responsibility · contracts remain with the owning region
parent 6_output 6d
in entries / ZIP bytes
out archive / decoded entries
port in | entries / ZIP bytes
port out | archive / decoded entries
box n0 | 6.7.1 | write ZIP | @core/export/zip.mjs::packZip
in > n0 | write ZIP inputs | data
n0 > out | write ZIP result | data
box n1 | 6.7.2 | read ZIP | @core/export/zip.mjs::unpackZip
in > n1 | read ZIP inputs | data
n1 > out | read ZIP result | data
box n2 | 6.7.3 | check entry checksum | @core/export/zip.mjs::crc32
in > n2 | check entry checksum inputs | data
n2 > out | check entry checksum result | data
```


```saam-responsibilities
output-selection | core/export/registry.mjs | output#changing-output-selection-and-shared-checking | core/tests/export.test.mjs, core/tests/printer-profiles.test.mjs, core/tests/interoperability.test.mjs
gcode-dialects | core/export/griffin.mjs, core/export/bambu.mjs, core/export/bambu-player.mjs, core/export/gcode-lines.mjs | output#changing-g-code-writers-and-readers | core/tests/export.test.mjs, core/tests/bambu.test.mjs, core/tests/modal-export.test.mjs, core/tests/gcode-stream.test.mjs
robot-dialects | core/export/dobot.mjs, core/export/dobot-player.mjs, core/export/dobot-lua-subset.mjs, core/export/denso.mjs, core/export/denso-player.mjs | output#changing-robot-source-and-bounded-interpretation | core/tests/dobot.test.mjs, core/tests/denso.test.mjs, core/tests/robot-playback.test.mjs
archives | core/export/zip.mjs | output#changing-archive-containers | core/tests/bambu.test.mjs, core/tests/dobot.test.mjs, core/tests/denso.test.mjs
source-time | core/export/source-time.mjs, core/export/travel-advisory.mjs | output#changing-shared-source-time-and-travel-advisories | core/tests/source-player.test.mjs, core/tests/travel-advisory.test.mjs, core/tests/robot-playback.test.mjs
study-source | core/export/machine-study.mjs | output#changing-mechanism-study-source | core/tests/machine-study.test.mjs
```
