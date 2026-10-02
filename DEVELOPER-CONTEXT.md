# Developer context

## Orientation

Developers own core skills, core capabilities, Studio and shared interfaces;
builders compose existing interfaces and author guidance. See [role boundaries](AGENTS.md#choose-your-role).
Before planning or editing, **read the active release intents: [0.3.0 installation](plans/0.3.0.md) and [0.3.1 architecture](plans/0.3.1.md)**, then [shared terms](GLOSSARY.md), dev maps and this file. Keep these pointers current; open component manuals as needed.

### What the dev maps are for

**Choose the release's map set explicitly:** `030-deployment` for 0.3.0 installation/service work; `030-architecture` for 0.3.1 product architecture (its existing identifier is retained). Toolkit developer onboarding/read-map default to `030-architecture`; pass `--set 030-deployment` for installation work. Onboarding returns both active intent documents.
The original scanned set is `default`, selected only with `--set default` for implementation evidence. Its indexes/scope are not the target architecture. Lower-level `dev-map/cli.mjs` still defaults to that original set, so always pass `--set`. Authored design contracts and scanned evidence are distinct; the glossary/default-map rules below do not override release contracts.
The goal is an order-of-magnitude faster review with greater confidence: the
person and agent trace the same trustworthy path. For any code to edit, maps
must show its location, interactions and every consequence of changing it,
without a separate trace or hidden context: exactly everything, nothing more.
Map compatibility warrants code changes within [Code shape](#code-shape).

### Dev map glossary

These terms are still settling and this list owns them. The map guide, the
tools and the read fields still use some older names. Nothing in the maps
comes from files or directories.

- **Dev maps**: the whole system: every map, the viewer and the tools that
  read and regenerate them. A **map** is one graph in it.
- **Node**: anything with an index: a leaf or a cluster. It has exactly one
  **parent map**, its **home**, which numbers it and draws it as a box; it is
  a **child node** there.
- **Leaf**: one scoped declaration with enclosed code and private helpers
  owned by that stage folded into it. Source, effects, links and findings stay
  on the owner; shared or escaping helpers remain separate. Leaves are generated;
  their view is a **code block**. No manual vocabulary suppression is applied.
- **Inner** and **outer**: a declaration written inside another's body is
  inner to that outer one. It is folded into the outer's leaf unless code
  outside the outer calls or links to it directly, or code outside the maps
  calls it; then it is a leaf of its own.
- **Cluster**: a node that groups boxes under a label. Its view is its map,
  which draws its members and calculated links. Groups and labels may be
  manually authored; a solver-created unlabeled group reads `[needs label]`.
- **Top map**: `0`, the master cluster: the root of the nesting and no node's
  box.
- **Nesting**: the tree of maps, `0` and the clusters down to leaves, authored
  in the set's `tree.json`. Each map numbers the nodes it homes
  `N.1`, `N.2`, … in its left-to-right order: `2.1.3` is homed in `2.1`.
- **Box**: one drawing of a node on a map. A box on any map other than the
  node's home is a **repeat** (a guest there); it keeps the node's index and
  names its home.
- **Port**: reserved for the junction where a link meets a box, as in
  Grasshopper: an argument slot a data link enters, or the result it leaves
  from. A **stub** is a port no link reaches, showing its literal value or why
  the value could not be traced.
- **Boundary box**: a box at a map's **edge** (its boundary and external
  boxes) that stands for a node on another map that a link crosses to.
- **External**: what outside the maps links to a leaf: an active outside
  declaration, the browser (DOM events) or module load. `0` draws every
  external; a cluster map draws those linked to what it nests. Externals a map
  cannot tell apart (linked, in the same directions, to exactly the same boxes
  there) share one box, so a parent map may group externals its child maps
  draw apart.
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
  full, in one of two classes. An **uncertain** finding is about a precise
  aspect of a leaf or link that is drawn. A **missing** finding is something
  the code does that no leaf or link stands for; maps show only these.
- **Annotation**: a sourced, dated statement about a node that the code cannot
  make: a `measurement`, `vendor` behaviour or a recorded `decision`, kept in
  `dev-map/facts.tsv`.
- **Outside**: code that is scanned but not mapped ([scope](#scope)). An
  outside caller is **active** when it runs while a person makes a part or
  operates Studio. Active outside code is drawn as externals; a call to
  nothing scanned is **platform**.
- **Node path**: the durable name of a node, as against its index, which
  changes whenever the tree does: `file.mjs::name` for a leaf (a folded
  declaration's path reads its leaf), `@cluster/ID` for a cluster.
- **Score** and **energy**: a map's score is the sum of its penalties for
  size, edge, hubs (a box with far more wires than the map's mean), islands,
  backflow and balance (`dev-map/lib/score.mjs`), each squared; the
  energy, the solver's goal, sums the scores of `0` and every cluster, each
  weighted by 1 + log₂ of its nested leaves, per leaf.
- **Authored inputs**: tree, labels, optional page positions, annotations and scope.
  Leaves and links are generated.

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
- The scope edge is drawn both ways, as externals: outside code calling in
  and every call that leaves the maps, at every level.

These are the default rules in `dev-map/lib/scope.mjs`. Named sets select
scanner leaves and retain all scanned outside connections; see
[set authoring](dev-map/README.md#authoring).

### The tree

- The walk is `0`, cluster maps down to a leaf, then its code block, the edit,
  `regenerate`, and the read again. Where the code lives does not enter into
  it: the nesting is functional, never a file tree.
- The default solver groups leaves to lower energy; default placement accepts
  new or gone leaves. Manual sets require an explicit home for each selected leaf.
- The solver runs only when the owner asks for it. `regenerate` places a new
  leaf beside its links in the existing tree and never re-solves; an agent
  that thinks the clustering needs a solve asks the owner, never runs one.
- No map draws a single box, and a cluster homes at least one node. A repeat
  is drawn where it keeps a link on the map. There is no cap on map size or
  depth; the score judges them.

### Findings

Findings are never dropped: every one is in its leaf's read. A map shows a
**missing** finding, something no leaf or link there stands for: code outside
every leaf, or a relationship between leaves no link draws, such as an
unresolved call or a write to shared state. The absence of a link is no
evidence of absence. An **uncertain** finding, about a precise aspect of what
a map already draws such as a branch or an argument's producer, stays in the
leaf's read. [The map guide](dev-map/README.md#findings) assigns every kind.
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
3. A sequential stage may mutate exclusively owned inputs and hand the result forward. Ownership transfers with the data: earlier stages/other consumers must not retain access to the same changing value. No hidden lookbacks to shared mutable sources; Bundle remains the explicit shared part-state authority. Private UI/session/job controllers own their state. Copies are needed only where ownership actually branches or a snapshot must be retained.

A rewrite must preserve intended behavior and expose its actual interactions. Apply the [release's simplification rule](plans/0.3.1.md) before choosing scanner work: direct wiring and explicit operations should remove unnecessary indirection, retaining necessary lifecycle handling. Improve syntax resolution where the existing abstraction earns its place. Authorized architecture work includes these rewrites; an unrelated map read grants no extra scope.
Also: give conceptual stages and callbacks code names, so clusters survive
line edits; when code replaces an entity, rewire every consumer and remove the
old one, with no compatibility wrapper or parallel path.

### Working the map

```sh
node scripts/agent-toolkit.mjs developer-onboarding --set 030-deployment
node scripts/agent-toolkit.mjs read-map 0 --set 030-architecture
node dev-map/cli.mjs read agent-bundle --set 030-architecture
node dev-map/cli.mjs audit --set 030-architecture
node dev-map/cli.mjs audit-check --set 030-architecture
```

Reads never scan. Design reads accept node/contract IDs and `--source` for explicit source references; scanned reads accept declarations and `--code`. Design `build`/`regenerate` redraws contracts, not implementation evidence; `audit` rescans and `audit-check` checks freshness. Scanned `regenerate` rescans its selected set. Never substitute one set's index for another's or infer compliance from a design rendering.
Walk the selected map to understand interactions before editing. Use its index in discussion and stable declaration/contract identities in records. The [map guide](dev-map/README.md) owns commands/authoring; [BR-052](build_request.md#br-052--complete-the-dev-map-against-the-2026-09-21-intent) retains implementation-map follow-ups.

### What keeps its own owner

Repository policy, setup, contribution procedures, decisions and historical
evidence keep their owners. Skills, [client adapters](adapters/mcp/DEVELOP.md),
[exporters](core/export/DEVELOP.md) and the [agent CLI toolkit](core/agent/README.md) keep their references; their exclusion applies only to the original default map, not the release architecture audit. [CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md)
owns checkpoint and publication rules; read it immediately before committing.
Source is authoritative for implementation; software checks do not establish
physical results. Run a check to settle a concrete uncertainty and reuse its
result until its inputs change; commits and task completion add no test gate.
Work from older repositories or conversations is reference only, and the
[September 12 withdrawal](DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission)
names work that must not be restored wholesale.

## Status note

As of 9/17/2026 and likely until 10/1/2026, we are not yet at the development stage where we care about backwards compatibility with print bundles. Back compat should not be a design priority or significant consideration in any new code, and any cumbersome back compat extras that are noticed should be flagged for removal.
