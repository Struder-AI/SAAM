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
```

The trusted registry is closed; machine profiles contain data, not executable
model paths. Unsupported or unconfigured arm presentation is partial or absent.
Nominal kinematics, source timing and manual model jogging are not controller
execution, collision clearance or hardware validation. [Machine contracts](../core/machine/README.md)
own the installation and model limits.
