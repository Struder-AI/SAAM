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

### Dev map glossary

These terms are still settling and this list owns them. The map guide, the
tools and the read fields still use some older names. Nothing in the maps
comes from files or directories.

- **Dev maps**: the whole system: every map, the viewer and the tools that
  read and regenerate them. A **map** is one graph in it.
- **Node**: anything with an index: a leaf or a cluster. It has exactly one
  **parent map**, its **home**, which numbers it and draws it as a box; it is
  a **child node** there.
- **Leaf**: one scoped declaration (a function, method, event handler or
  class) with every declaration written inside it that only it reaches, which
  is **folded** into it. All scoped code is drawn by exactly one leaf. Leaves
  are generated; a leaf's view is its **code block**, the source with its
  callers, calls, links and findings beside it.
- **Inner** and **outer**: a declaration written inside another's body is
  inner to that outer one. It is folded into the outer's leaf unless code
  outside the outer calls or links to it directly, or code outside the maps
  calls it; then it is a leaf of its own.
- **Cluster**: a node that groups boxes under a label. Its view is its map,
  which draws its members and the links between them. The cluster solver
  authors clusters; a label pass authors their labels, and a cluster without
  one reads `[needs label]`.
- **Top map**: `0`, the master cluster: the root of the nesting and no node's
  box.
- **Nesting**: the tree of maps, `0` and the clusters down to leaves, authored
  by the solver in `dev-map/tree.json`. Each map numbers the nodes it homes
  `N.1`, `N.2`, … in its left-to-right order: `2.1.3` is homed in `2.1`.
- **Box**: one drawing of a node on a map. A box on any map other than the
  node's home is a **repeat** (a guest there); it keeps the node's index and
  names its home.
- **Port**: reserved for the junction where a link meets a box, as in
  Grasshopper: an argument slot a data link enters, or the result it leaves
  from. A **stub** is a port no link reaches, showing its literal value or why
  the value could not be traced.
- **Boundary box**: a box at a map's edge that stands for something outside
  that map: a node on another map, outside code, or a way in such as an HTTP
  route or module load.
- **Link** (or wire): a relationship between two leaves, generated from the
  scan: a **call link**; a **data link** carrying a value from one call's
  result into another call; or an **indirect link**, reached through a medium
  rather than a call: a file, an HTTP route, a worker message, an event
  listener, or **keyed dispatch**, a function looked up by key in a named
  table. A map draws one link between the two boxes holding its ends, with a
  count. Beside a leaf's code block are its calls in call order, each under
  its **gate**, the condition the call stands under, and its **state links**,
  state read or written.
- **Operator**: a step in a leaf that is not a call: a choice, a loop, an
  update, a collection or a member call. **State**: bindings and fields that
  an outer function or class owns and its inner ones or members read or write.
  A **carried value** is a variable a loop updates on every pass: `initial`
  and `next` in, `current` and `final` out. They are read beside a leaf's code
  block and are not nodes.
- **Finding**: the scanner's record of something it could not represent in
  full, in one of two classes. An **uncertain** finding is about something
  drawn, with the unknown part marked on the drawing. A **missing** finding is
  something the code does that no map draws; the finding is its only record.
- **Annotation**: a sourced, dated statement about a node that the code cannot
  make: a `measurement`, `vendor` behaviour or a recorded `decision`, kept in
  `dev-map/facts.tsv`.
- **Outside**: code that is scanned but not mapped ([scope](#scope)). An
  outside caller is **active** when it runs while a person makes a part or
  operates Studio. A call to outside code is drawn as a headless arrow naming
  its target; a call to nothing scanned is **platform**.
- **Node path**: the durable name of a node, as against its index, which
  changes whenever the tree does: `file.mjs::name` for a leaf (a folded
  declaration's path reads its leaf), `@cluster/ID` for a cluster.
- **Score** and **energy**: a map's score is the sum of its penalties for
  size, interface (the nested leaves links reach from outside or leave from),
  islands, backflow and balance (`dev-map/lib/score.mjs`); the energy is the
  mean score over `0` and every cluster, the cluster solver's goal.
- **Authored inputs**: the tree (clusters by the solver, labels by a label
  pass), annotations and scope. Everything else is generated.

### Scope

- Mapped: core and Studio product code. Two areas inside core are scanned as
  outside callers and never mapped: the agent CLI toolkit, `core/agent`, and
  the exporters, every dialect under `core/export` that turns a SAAMpath into
  a machine program and reads it back ([exporter implementation](core/export/DEVELOP.md)).
  Output routing, the travel advisory and playback timing stay mapped.
- Outside, scanned but not mapped: skills, adapters, scripts and the areas
  above. Active outside callers are a catalogued skill's implementation
  scripts, the MCP adapter, the agent toolkit and its CLI entry, and the
  exporters. They are listed on the nodes they call; everything else outside
  (skill tests and demos, benchmarks, audits) is counted, never drawn.
- The scope edge is drawn both ways: outside callers as boundary boxes and caller rows,
  and every call that leaves the maps as a headless arrow naming its target,
  at every level.

All of this is authored in one place, `dev-map/lib/scope.mjs`.

### The tree

- The walk is `0`, cluster maps down to a leaf, then its code block, the edit,
  `regenerate`, and the read again. Where the code lives does not enter into
  it: the nesting is functional, never a file tree.
- Leaves and links are generated; the cluster solver arranges the leaves into
  clusters, repeats included, to lower the energy. Placement is total: every
  leaf is in the tree whatever `tree.json` says or leaves out, and nothing
  fails for a leaf that is new or gone.
- No map draws a single box, and a cluster homes at least one node. A repeat
  is drawn where it keeps a link on the map. There is no cap on map size or
  depth; the score judges them.

### Findings

Findings are never hidden. An uncertain finding is marked where it is drawn: a
stub with its reason, an operator whose test or input is unknown, a result
no link carries, a callback whose timing is unknown. A missing finding is a call
with no resolved target, a write to an object, a value chosen between
branches, an early exit or caught exception, a collection's contents after it
escapes: the absence of a link is no evidence of absence.
[The map guide](dev-map/README.md#findings) assigns every kind to its class.

A finding about a leaf is shown on its code block and on every box that draws
the leaf; a cluster box carries the count nested in it.
Most are analysis limits and generator work; a few are the code's shape,
handled below. Do not turn a finding into an invented link, and do not infer
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
node scripts/agent-toolkit.mjs regenerate
node dev-map/cli.mjs check
node dev-map/cli.mjs solve
```

Reads come from the stored map and never scan; `regenerate` scans, and a read
whose inputs have moved says `stale` and names the index to regenerate. Use the
index when talking about the current map and the node path
(`file.mjs::name`) when something must keep pointing at it. **Text search for
orientation is discouraged**: it finds names; the walk shows who calls and
consumes what you are about to change. The authored inputs are the tree in
`dev-map/tree.json`, annotations in `dev-map/facts.tsv`, and the scope. The
[map guide](dev-map/README.md) owns the commands, read fields and authoring
mechanics; [BR-052](build_request.md#br-052--complete-the-dev-map-against-the-2026-09-21-intent)
holds what remains.

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
