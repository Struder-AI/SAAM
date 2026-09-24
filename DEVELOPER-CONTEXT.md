# Developer context

## Orientation

A developer is maps-native: the **dev map** and this file are the orientation
a developer relies on. The component manuals under `core/` and `studio/` are
written for makers and builders; open one when the work calls for it, as when a
change alters the behaviour it describes and it needs rewriting.

### What the map is for

The map is a visual knowledge graph of core and Studio, generated from source.
It exists so that a reviewer moves through the code an order of magnitude
faster with several times the confidence, and so that an agent gets an
orientation it can trust, because a person can trace the same path. The
standard it is held to: for any code you are about to edit, the map tells you
where it is, what it does with what, and every consequence of changing it,
without a separate trace and without anything extra in your head. It contains
exactly everything, and nothing more. Map compatibility is worth adjusting how
the code is written, within the rules under [Code shape](#code-shape).

### Scope

- Mapped: core and Studio product code. Two areas inside core are scanned as
  outside callers and never mapped: the agent CLI toolkit, `core/agent`, and
  the exporters, every dialect under `core/export` that turns a SAAMpath into
  a machine program and reads it back ([exporter implementation](core/export/DEVELOP.md)).
  Output routing, the travel advisory and playback timing stay mapped.
- Scanned, not mapped: skills, adapters, scripts. A caller is **active** when it
  runs while a person makes a part or operates Studio: a catalogued skill's
  implementation scripts, the MCP adapter, the agent toolkit and its CLI entry,
  the exporters.
  Active callers are drawn on the declaration pages they call; everything else
  scanned (skill tests and demos, benchmarks, audits) is counted, never drawn.
- The scope edge is drawn both ways: outside callers as ports and caller rows,
  and every call that leaves the map as a headless arrow naming its target, at
  every level. Calls with no target in any scanned root are `platform`.

All of this is authored in one place, `dev-map/lib/scope.mjs`.

### The tree

- The walk is `0`, a region, then flow pages down to a leaf, then `--code`, the
  edit, `regenerate`, and the page again. Each map numbers the nodes it homes
  under its own index. Where the code lives does not enter into it: the tree is
  functional, never a file tree.
- A region page shows its flow roots, the declarations nothing in the region
  calls, optionally clustered by authored groups; a wire between them says the
  code under one root reaches the code under the other. Everything else in the
  region is homed by the first flow page of that region that reaches it, so a
  deep call chain is a deep index. A declaration written inside another is
  homed by its holder; a class is its construction and its members. A node
  drawn anywhere else is a repeat carrying `home`, and the home node lists its
  repeats as `alsoOn`.
- An address is a map only when it would draw at least two called declarations
  with a wire between them; otherwise it opens as code with the same callers,
  couplings and findings beside it. What is not a map is drawn on the map
  above it: a code-destination declaration is a leaf, drawn as one box on the
  map that reaches it with its incoming and outgoing wires there, and nothing
  is homed beneath it. No page draws a single box, and no box floats: a call
  is connected to the function that makes it even when its arguments could
  not be traced.
- From every map it is clear which child to open next. A node is repeated on a
  map only where it gives context in that view; nothing is read twice
  otherwise. There is no cap on page size or depth; a good map decides.

### Findings

Findings are the scanner's honesty, never hidden. A finding about a node is
shown on every map that draws that node, once per node however many boxes
draw it: the box carries a count and the rows sit in the page's finding list,
sectioned by node; a group box carries one count. Most rows are
analysis limits (destructuring, loop values, untraced collections, untyped
receivers) and are generator work; a few are the code's shape,
handled below. Do not turn a finding into an invented wire, and do not infer
that no caller exists from an unscanned or dynamic boundary.

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
   effect is on a wire rather than invisible on the caller's page. The
   exception is an explicit stateful controller (a UI controller, a session,
   the tour) operating on state it owns.

A rewrite counts as a code-shape fix only when it preserves behaviour and,
after regeneration, the map draws what was hidden. Anything the scanner cannot
yet follow by syntax (`super`, destructuring, loop variables, nested-call
arguments, `Promise.all`, instance receivers, passed callbacks) has a definite
meaning, so teaching the scanner is cheaper and more trustworthy than touching
ordinary code: generator work, never code churn. Reading a map does not by
itself authorise a rewrite.

Also: give conceptual stages and callbacks code names, so grouping survives
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
consumes what you are about to change. The authored inputs are grouping in
`dev-map/flows/*.json` (declaration members only, clustering flow roots),
external facts in `dev-map/facts.tsv`, and the scope. The
[map guide](dev-map/README.md) owns the commands, page fields and authoring
mechanics; [dev-map/HANDOFF.md](dev-map/HANDOFF.md) owns the state of the map
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
