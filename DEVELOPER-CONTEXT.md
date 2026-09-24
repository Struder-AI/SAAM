# Developer context

## Orientation

A developer is maps-native: the **dev maps** and this file are the orientation
a developer relies on. The component manuals under `core/` and `studio/` are
written for makers and builders; open one when the work calls for it, as when a
change alters the behaviour it describes and it needs rewriting.

### What the dev maps are for

The dev maps are a visual knowledge graph of core and Studio, generated from
source; each graph in it is a **map**. They exist so that a reviewer moves
through the code an order of magnitude faster with several times the
confidence, and so that an agent gets an orientation it can trust, because a
person can trace the same path. The standard they are held to: for any code
you are about to edit, the maps tell you where it is, what it does with what,
and every consequence of changing it, without a separate trace and without
anything extra in your head. They contain exactly everything, and nothing
more. Map compatibility is worth adjusting how the code is written, within the
rules under [Code shape](#code-shape).

### Scope

- Mapped: core and Studio product code. Two areas inside core are scanned as
  outside callers and never mapped: the agent CLI toolkit, `core/agent`, and
  the exporters, every dialect under `core/export` that turns a SAAMpath into
  a machine program and reads it back ([exporter implementation](core/export/DEVELOP.md)).
  Output routing, the travel advisory and playback timing stay mapped.
- **Outside** code is scanned, not mapped: skills, adapters, scripts and the
  areas above. An outside caller is **active** when it runs while a person
  makes a part or operates Studio: a catalogued skill's implementation
  scripts, the MCP adapter, the agent toolkit and its CLI entry, the
  exporters. Active callers are listed on the nodes they call; everything else
  outside (skill tests and demos, benchmarks, audits) is counted, never drawn.
- The scope edge is drawn both ways: outside callers as ports and caller rows,
  and every call that leaves the maps as a headless arrow naming its target,
  at every level. Calls with no target in any scanned code are `platform`.

All of this is authored in one place, `dev-map/lib/scope.mjs`.

### Terms

- A **node** is anything with an index: a region, a cluster or a declaration
  (function, method, handler, class). It has one index and one home. Its
  **kind** is what it is; its **view** is how it opens: a **map** when it
  would draw at least two declarations it calls with a link between them (the
  map-or-code rule, `dev-map/lib/destination.mjs`), otherwise a **code
  block**, its source with the same callers, links and findings beside it.
  `0` is the **top map**, which draws the regions.
- A **box** is one drawing of a node on a map. A node can have many boxes, on
  several maps or on one: each call site is its own box. The map that numbers
  a node is its **home**; a box anywhere else is a **repeat**.
- A map also draws elements that are not nodes and have no index:
  **operators** (a choice, an iteration, an update, a collection, a member
  call), **state** (bindings and fields a declaration or class owns and its
  members use), **ports** (where links cross the boundary of the node whose
  map it is: a declaration's parameters, returns and throws; a region's links
  from and to other regions and outside code; on the top map, the ways code
  enters) and **stubs** (an argument slot no link reaches, showing its literal
  or the reason).
- A **link** (or wire) is a **call link** from a function to each box it
  calls, in call order, under its **gate**, the condition the call site
  stands under; a **data link** carrying a value between ports; a **state
  link**, owned state read or written; or an **indirect link**, reached
  through a medium rather than a call: a file, an HTTP route, a worker
  message, an event listener, or **keyed dispatch**, a function reached by
  its key in a named table. On region and cluster maps one link stands for
  every call site between two boxes, with a count.
- A **carried value** is a binding a loop updates on every pass, drawn on its
  iteration operator: `initial` and `next` in, `current` and `final` out.

### The tree

- The walk is `0`, a region, maps down to a leaf, then its code block, the
  edit, `regenerate`, and the read again. Each map numbers the nodes it homes
  under its own index. Where the code lives does not enter into it: the tree is
  functional, never a file tree.
- A region map shows its **entries**, the declarations nothing in the region
  calls, optionally grouped into authored **clusters**; a link between them
  says the code under one entry reaches the code under the other. Every other
  declaration in the region is homed by the first map of that region that
  reaches it, so a deep call chain is a deep index. A **nested** declaration,
  written inside another's body, is homed by the one enclosing it; a class is
  its construction and its members.
- A **leaf** is a declaration whose view is a code block. It is drawn as a box
  on the map that reaches it, with its links there, and its **chain**, what it
  calls while each of those is a leaf in turn, is drawn there too, linked from
  its box. Nothing is numbered beneath a leaf. No map draws a single box, and
  no box floats: a call is linked to the function that makes it even when its
  arguments could not be traced.
- From every map it is clear which child to open next. A repeat is drawn only
  where it gives context in that view; nothing is read twice otherwise. There
  is no cap on map size or depth; a good map decides.

### Findings

A **finding** is the scanner's honest record of what it could not represent
in full, never hidden. Each finding kind belongs to one of two classes:

- **Uncertain**: the thing is drawn, but one aspect of it is unknown, and the
  drawing marks it: a stub with its reason, an operator whose test or input is
  unknown, a port no link feeds, a callback whose timing is unknown.
- **Missing**: the code does something no map draws: a call with no resolved
  target, a write to an object, a value chosen between branches, an early exit
  or caught exception, a collection's contents after it escapes. The row is
  the only record, so the absence of a link is no evidence of absence.

[The map guide](dev-map/README.md#findings) assigns every kind. A finding about
a node is shown on every map that draws that node, once per node however many
boxes draw it: the box carries a count and the rows sit in the map's finding
list, sectioned by node; a cluster box carries one count. Most are analysis
limits and generator work; a few are the code's shape, handled below. Do not
turn a finding into an invented link, and do not infer that no caller exists
from an unscanned or dynamic boundary.

### Code shape

The map is trustworthy only when everything a piece of code does is visible
at its boundary: the scanner and a human reviewer read the same syntax, and
three patterns hide a relationship from both, so the map would draw nothing
or something false and no scanner work could recover it. They are strongly
preferred against; the restricted form needs the owner's explicit permission
for a compelling case:

1. No callable and no state in a reassigned binding: what runs, or what a
   value is, would depend on execution history rather than the text at the
   site. Owned state lives in an explicit record or behind an explicit
   stateful boundary; a callback chosen once is a `const` or a named function.
2. No callee chosen by an expression: the call site would not name its callee.
3. A stage does not mutate caller-owned state; it returns its result, so the
   effect is on a link rather than invisible on the caller's map. The
   exception is an explicit stateful controller (a UI controller, a session,
   the tour) operating on state it owns.

A rewrite counts as a code-shape fix only when it preserves behaviour and,
after regeneration, the map draws what was hidden. Anything the scanner cannot
yet follow by syntax (`super`, destructuring, loop variables, nested-call
arguments, `Promise.all`, instance receivers, passed callbacks) has a definite
meaning, so teaching the scanner is cheaper and more trustworthy than touching
ordinary code: generator work, never code churn. Reading a map does not by
itself authorise a rewrite.

Also: give conceptual stages and callbacks code names, so clusters survive
line edits; when code replaces an entity, rewire every consumer and remove the
old one, with no compatibility wrapper or parallel path.

### Working the map

```sh
node scripts/agent-toolkit.mjs read-map 0
node scripts/agent-toolkit.mjs read-map core/path/compose.mjs::planComposition
node scripts/agent-toolkit.mjs read-map 6.3.1 --code
node scripts/agent-toolkit.mjs regenerate 6
node dev-map/cli.mjs check
```

Reads come from the stored map and never scan; `regenerate` scans, and a read
whose inputs have moved says `stale` and names the index to regenerate. Use the
index when talking about the current map and the declaration path
(`file.mjs::name`) when something must keep pointing at it. **Text search for
orientation is discouraged**: it finds names; the walk shows who calls and
consumes what you are about to change. The authored inputs are clusters in
`dev-map/flows/*.json` (declaration members only, grouping entries), facts in
`dev-map/facts.tsv`, and the scope. The
[map guide](dev-map/README.md) owns the commands, read fields and authoring
mechanics; [dev-map/HANDOFF.md](dev-map/HANDOFF.md) owns the state of the dev-maps
work and what remains.

### What keeps its own owner

Repository policy, setup, contribution procedures, decisions and historical
evidence keep their owners. Skills, [client adapters](adapters/mcp/DEVELOP.md),
[exporters](core/export/DEVELOP.md) and the [agent CLI toolkit](core/agent/README.md) are outside the mapped scope
and keep their own references. [CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md)
owns checkpoint and publication rules; read it immediately before committing.
Source is authoritative for implementation; software checks do not establish
physical results. Run a check to settle a concrete uncertainty and reuse its
result until its inputs change; commits and task completion add no test gate.
Work from older repositories or conversations is reference only, and the
[September 12 withdrawal](DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission)
names work that must not be restored wholesale.

## Status note

As of 9/17/2026 and likely until 10/1/2026, we are not yet at the development stage where we care about backwards compatibility with print bundles. Back compat should not be a design priority or significant consideration in any new code, and any cumbersome back compat extras that are noticed should be flagged for removal.
