# Operations vs. Post-Processors

SAAM splits "how to make this shape" from "how this controller expresses
motion." Getting this split right is what lets one operation serve many
machines, and it's the part most worth double-checking whenever a new
operation or machine is added.

## The layers

**Operation** — a machine-neutral generator. Given a part plan and
process settings, it produces toolpath geometry: point sequences grouped
into named path families, per layer, with a print/travel intent. It knows
nothing about a specific controller's command syntax, I/O model, or
motion primitives.

**Machine definition** — planning constraints (reach, axis count, payload,
supported motion types), installed capabilities (what
`capabilityRequirements` it satisfies), instance configuration boundaries
(what's safe to vary per unit), evidence, safety information, and a
reference to its post-processor.

**Post-processor** — the only machine-aware code. It takes an approved,
machine-resolved process plan and emits that one machine's native output
(Lua tabs, G-code, or another controller's format). It may **translate or
reject** — for example, rejecting a path whose curvature exceeds what an
`Arc3`-style primitive can express — but it must not **redesign**
geometry. If a post-processor finds itself computing new path points
rather than restating existing ones in a different syntax, that logic
belongs in an operation instead.

**Trace reader** (`machines/*/trace/`) — the inverse of a post-processor,
and the only other machine-aware code. It reads that machine's native
output back into a machine-neutral **motion trace**
(`schemas/motion-trace/`): the ordered moves the program commands, each
with its speed, acceleration, extrusion state, duration, and a line
number into the source. It may **read or reject** — refusing a construct
it cannot account for — but must not **repair**. The trace is
machine-neutral, so one previewer (`interfaces/trace-player/`) and one
set of checks (`schemas/motion-trace/trace-lib.mjs`) serve every
machine.

## Two illustrative post-processors

**DobotStudio Lua** (`machines/reference-dobot-mg400-struderbot/`) —
emits the tab-based Lua program a Dobot MG400 controller runs: `global.lua`
for shared helpers, `src0.lua` for I/O selection, `src1.lua`+ for the
program itself. Keeps one continuous extrusion window per program. Print strokes use L and
travel uses J based on intent, including explicit hop coordinates.

**Dobot stop/start** (`machines/dobot-stop/`) uses the same translation
with a separate machine id, switching extrusion off for travel. Stop/start
response is experimental; it does not change the original machine policy.

**Known limitation:** it emits only `MovL`, with no `Arc3`, `Circle3`, or
`CP` parameter. Native arc motion for curves is intended but not
implemented; it needs arc-native data in `paths`, which is a schema
change. The trace reader already handles `Arc3`.

**Generic G-code** (template, not yet a full reference implementation) —
would emit standard `G0`/`G1`/`G2`/`G3` motion with `M82`/`M83`
extrusion-mode commands, the format most FDM firmware expects. Its
existence as a second target, even as a stub, is what actually proves an
operation is machine-neutral: an operation whose output only makes sense
next to one post-processor was not really machine-neutral to begin with.

## A concrete test

Before merging a new operation, check whether its generator ever branches
on a machine name, a controller family, or an instance-specific
calibration value. If it does, that logic has leaked out of the
post-processor layer where it belongs — move it, don't just rename it.
