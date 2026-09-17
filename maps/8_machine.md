# Machine presentation

```saam-components
sourceTime | @core/export/source-time.mjs::frameAtTime | interpreted move store; seconds | active/completed move, fraction, position and optional pose | Uses source durations with linear or declared rest-to-rest ramps; timing is modeled, not measured controller behavior or thermal simulation.
```

```saam-page 8_machine
title 8 — Pose machine
sub Level 1 · source motion and configured installation determine pose
parent 0_system machine
in source / time
out poses
port in | source / time
box provider | 8.1 | create presentation | @core/machine/presentation.mjs::createMachinePresentation
box time | 8.2 | sample command time | $sourceTime
box dobot | 8.3 | solve Dobot arm | @core/machine/dobot-kinematics.mjs::dobotInverse
box denso | 8.4 | solve DENSO arm | @core/machine/denso-kinematics.mjs::densoInverse
box jog | 8.5 | constrain manual jog | @core/machine/jog.mjs::constrainedJog
box validate | 8.6 | validate pose binding | @studio/machine-view.mjs::validateSnapshot
box pose | 8.7 | transform components | @studio/machine-view.mjs::poseMachine
port out | poses
in > provider | program; setup; identity | data
provider > time | moves and seconds | data
time > provider | TCP / rotary frame | data | norank
provider > dobot | aligned MG400 | gate
provider > denso | aligned VP-6242 | gate
dobot > provider | joints / margins | data | norank
denso > provider | joints / margins | data | norank
provider > jog | manual target | gate
jog > provider | reachable coordinates | data | norank
provider > validate | bound snapshot | data
validate > pose | matching request / model | data
pose > out | component transforms | data
box 8a | 8.8 | validate machine setup | >8a_profile
ext 8aCaller | shared callers
8aCaller > 8a | profile / plan / commands | data
8a > 8aCaller | capabilities / validated setup | data | norank
box 8b | 8.9 | transform machine frames | >8b_frames
ext 8bCaller | shared callers
8bCaller > 8b | installation / source poses | data
8b > 8bCaller | assembly poses | data | norank
```

The trusted registry is closed; machine profiles contain data, not executable
model paths. Unsupported or unconfigured arm presentation is partial or absent.
Nominal kinematics, source timing and manual model jogging are not controller
execution, collision clearance or hardware validation. [Machine contracts](reference/machine.md)
own the installation and model limits.


```saam-scope
core/machine/ | Machine capabilities, installation, kinematics and presentation
```

```saam-references
presentation | maps/reference/presentation.md | Machine provider and Studio consumer integration
machine | maps/reference/machine.md | Implemented machine models and solver limitations
machine-files | maps/reference/machine-files.md | Machine capability and setup declarations
```


```saam-page 8a_profile
title 8.8 — validate machine setup
sub Shared responsibility · contracts remain with the owning region
parent 8_machine 8a
in profile / plan / commands
out capabilities / validated setup
port in | profile / plan / commands
port out | capabilities / validated setup
box n0 | 8.8.1 | load known machine | @core/machine/profile.mjs::loadMachine
in > n0 | load known machine inputs | data
n0 > out | load known machine result | data
box n1 | 8.8.2 | validate selected setup | @core/machine/rules.mjs::validateSetup
in > n1 | validate selected setup inputs | data
n1 > out | validate selected setup result | data
box n2 | 8.8.3 | require capability | @core/machine/rules.mjs::requireMachine
in > n2 | require capability inputs | data
n2 > out | require capability result | data
box n3 | 8.8.4 | check reconstructed path | @core/machine/rules.mjs::checkMachinePath
in > n3 | check reconstructed path inputs | data
n3 > out | check reconstructed path result | data
box n4 | 8.8.5 | validate DENSO setup | @core/machine/denso.mjs::validateDensoConfiguration
in > n4 | validate DENSO setup inputs | data
n4 > out | validate DENSO setup result | data
```


```saam-page 8b_frames
title 8.9 — transform machine frames
sub Shared responsibility · contracts remain with the owning region
parent 8_machine 8b
in installation / source poses
out assembly poses
port in | installation / source poses
port out | assembly poses
box n0 | 8.9.1 | compose rigid transforms | @core/machine/rigid.mjs::compose
in > n0 | compose rigid transforms inputs | data
n0 > out | compose rigid transforms result | data
box n1 | 8.9.2 | validate rigid frame | @core/machine/rigid.mjs::validateRigid
in > n1 | validate rigid frame inputs | data
n1 > out | validate rigid frame result | data
box n2 | 8.9.3 | sample Dobot joints | @core/machine/dobot-kinematic-player.mjs::sampleDobotProgram
in > n2 | sample Dobot joints inputs | data
n2 > out | sample Dobot joints result | data
```


```saam-responsibilities
machine-policy | core/machine/profile.mjs, core/machine/rules.mjs, core/machine/denso.mjs | machine#changing-machine-profiles-and-capability-checks | core/tests/printer-profiles.test.mjs, core/tests/export.test.mjs, core/tests/denso.test.mjs, core/tests/dobot.test.mjs
kinematics | core/machine/dobot-kinematics.mjs, core/machine/denso-kinematics.mjs | presentation#changing-robot-kinematic-models | core/tests/dobot-kinematics.test.mjs, core/tests/studio-kinematics.test.mjs, core/tests/machine-presentation.test.mjs
presentation-provider | core/machine/presentation.mjs, core/machine/jog.mjs | presentation#changing-presentation-and-jog-contracts | core/tests/machine-presentation.test.mjs, core/tests/machine-jog.test.mjs, core/tests/studio-kinematics.test.mjs
machine-frames | core/machine/rigid.mjs, core/machine/dobot-kinematic-player.mjs | presentation#changing-rigid-frames-and-incremental-playback | core/tests/dobot-kinematics.test.mjs, core/tests/machine-presentation.test.mjs, core/tests/robot-playback.test.mjs
```
