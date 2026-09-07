# Dobot stop/start Lua export

See [the machine definition](../README.md) for timing and travel behavior.
`generator.mjs` selects the stop/start policy in the shared Dobot translator.
It accepts only a currently export-approved plan for `dobot-stop`; selecting
this variant does not reuse approval granted for the original machine.

The exported Lua annotates every motion with `-- SAAM intent=print` or
`-- SAAM intent=travel`. The reader executes the Lua to determine actual
speed and extrusion, then carries the declared intent separately into the
trace. These annotations never switch a relay or imply hardware evidence.
