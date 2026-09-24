# Dev maps

Intent, scope, terms and the reading rules are owned by
[DEVELOPER-CONTEXT.md](../DEVELOPER-CONTEXT.md), what remains by
[BR-052](../build_request.md#br-052--complete-the-dev-map-against-the-2026-09-21-intent). This guide owns the commands, the addresses, what each
read carries and the authoring mechanics. Generation derives nodes, links,
gates and source locations; authoring arranges them into maps and can add no
call, link or prose.

- `lib/`: source scanning, graph composition, the store and rendering;
  `lib/destination.mjs` is the one map-or-code rule.
- `flows/*.json`, `facts.tsv`, `lib/scope.mjs`: the authored inputs.
- `store/`, `view/`: generated snapshots and the viewer; git-ignored.

## Commands

```sh
node scripts/agent-toolkit.mjs read-map ADDRESS [--code] [--details]
node scripts/agent-toolkit.mjs regenerate [INDEX]
node dev-map/cli.mjs check [--json] [--viewer [ADDRESS…]] | build | flow-evidence ADDRESS
node dev-map/cli.mjs score [--json]
node dev-map/cli.mjs watch-freshness [--once]
```

An ADDRESS is a node's index or its durable path: a region (`core/path`), a
declaration (`core/path/compose.mjs::planComposition`) or a cluster
(`OWNER::@group/ID`), never a file path. `read-map` returns one node's read and
never scans: its map, or its code block when that is its view; `--code`
returns a declaration's source span, a cluster's member spans or a region's
files (`0 --code` is refused), `--details` the read with its evidence:
expressions, traces, byte offsets. Reads are compact JSON: `range` is
`[first,last]` inclusive, nested locations inherit `file`, empty arrays omitted.

`regenerate` is the only command that scans, and it redraws the viewer. No
argument or `0` refreshes everything; with an index, that region and the
references its changed addresses affect, widening to everything when an
inventory change, a removed declaration or an old schema requires it, and saying
so. `flow-evidence` re-derives one node from source, to audit the generator;
`build` redraws `view/index.html` from the store, no scan (needs Python 3; set
`PYTHON` otherwise); `watch-freshness` keeps the viewer's live status current.

## Addresses

Numbering follows [the tree](../DEVELOPER-CONTEXT.md#the-tree): each map numbers
the nodes it homes `N.1`, `N.2`, and so on under its own index, entries and
clusters first in index order, then each map's boxes in call order, depth first.
Indexes are regenerated and may change; the declaration path is the durable
name. Static methods are `file.mjs::Class::@static/method` (URI-encoded),
instance methods `file.mjs::Class::method`, parameter defaults
`OWNER::@default/NAME`, and anonymous callbacks a snapshot position authoring
must not reference. A module-level `el.onclick = …` or `addEventListener('x', …)`
names its site `file.mjs::@handler/<receiver>.<event>` (URI-encoded; the
receiver an id selector's id, a binding or a member path) and is homed there. A
record is no node at any depth, so `.` joins its members,
`createStudio::lifetime.onViewers`; a module-level table keeps its entry keys.

Each call site is its own box, with an `id` for its local links and the node's
shared `index`; a call inside a loop is one box with loop feedback. A class is
its construction plus its members: the constructor is no node, `new X()`
reaches the class, and its methods are nodes homed there.

## What each read carries

Field names predate the [glossary](../DEVELOPER-CONTEXT.md#dev-map-glossary): `destination`
is the view (`graph` for a map, `code` for a code block), `components` are the
boxes, `wires` the links, `couplings` the indirect links, a `group` a cluster,
`inlined`/`via` a leaf's chain, and `uncertainty` and `unresolved` rows the
[findings](#findings).

Every read: `index`, `kind`, `destination`, `stale` when its inputs moved,
`facts` when a fact row names it, `home` on a repeat and `alsoOn` on the home.

- **Top map** (`0`): `regions` (index, path, files, lines, nodes, entries as
  `roots`), `ports` (each way into the regions, and `out:<root>` per outside
  root they call), and `wires` with kinds and counts.
- **Region** and **cluster**: `components` (entries or clusters, a cluster's
  members, and the chain of any leaf among them), ports including `in:` and
  `out:` for every outside root, and one link per box pair contracted onto the
  entry owning each end: `count` sites, `kind` or `kinds`, and what they name
  in the label or in `names` past three; `structural`, `relationshipSummary`
  (sites collapsed into the drawn links) and `composition` (the clusters'
  source, and link counts) say so, and a `calls` arrow is a call site, not
  execution order or dataflow.
- **Declaration** (function, method, handler, class): `path`, `file`, `range`,
  `inputs` (`parameterTargets` on a port this node calls: each callable a
  caller passes, by `index`, `path` and `from`; its box is on that caller's
  map), `outputs` (each return and throw), `components` (what it calls, in call
  order, outside calls naming their target included; an iteration method's
  callback is a step of this flow, traced inline or called by name; a box a
  leaf's chain brought carries `inlined` and `via`, the leaf calling it, and
  counts toward no link total), `operators` (choices, iterations, updates,
  collections, member calls; one only a finding names carries `keptFor`),
  `wires` (data links between boxes, with `fromPort` and `toPort`; `argN` for
  argument slots, `positionUnknown` after a spread; one call link, `kind:
  invocation`, per box, so none floats: `from`, the function itself (`"self"`)
  or the leaf whose chain drew it, the call's `order`, `provenance`
  (`call-site`, `declaration`/`reference` for a box held or named, not called,
  `operation` for a `keptFor` operator), the `gate` its sites stand under, or
  `siteGates` where they differ, and `stubs`, each a `slot` and either a
  `literal`, the constant written there, cut past 40 characters (a number or
  boolean as itself), or a `reason`; the map-or-code rule counts data links,
  not a `keptFor` operator's), `gates` (each condition an item names, by
  number), `requires`, `couplings`, `callerReferences` (mapped callers by
  index; active outside callers by path with `unmapped: true`;
  `callerSummary` with a count and canonical index above five),
  `outsideCallers` (counts per inactive directory), `outside` and `platform`
  (call sites with no mapped target), the findings `unresolved` and
  `uncertainty` (repeated `closure-capture` rows share one with `count`),
  `stateFields` on a class, a node that owns no box for one writing it as a
  row, and `state`, what the enclosing declaration owns and this node uses: a
  factory's `let`/`const` bindings and a class's `this.` fields (`field`,
  `static-field`), each `name`, `owner`, `ownerIndex`, `binding` kind, `access`
  and site, drawn but never called and outside the map-or-code rule. State
  links carry `owned-state` provenance, leaving the node for a read and
  entering it for a write, from `self` with a `stub` where the write has no
  traced producer; the owner links each one to its initialisation and to every
  member touching it. A carried value is an operator's `initial`, `next`,
  `current` and `final` ports. A code block adds `source`, `sourceKind`,
  `sourceSha256`, its callees and its call links.

Indirect links are `file`, `http-route`, `worker-message`, `event-listener` (a
callable handed to a registration or held by an `on<event>` property) and
`registry-entry`, keyed dispatch: each entry of a named function table reached
by key from the declaration naming it, computed keys and spreads being an
analysis limit.

## Findings

Every box, chain boxes included, carries its node's finding count as
`findings`, a cluster box the count inside it; a region or cluster map puts the
rows on the box, a declaration's map lists them under `nodeFindings`, an
`index`/`path` section per drawn node in drawing order, never its own; each row
names its `file`. `uncertainty` rows name a `kind`, `unresolved` rows a
`rule`; each belongs to one class.

**Uncertain**, drawn with the unknown marked on it:

| Kind | Drawn | Unknown |
|---|---|---|
| `argument-origin` | the call's box | the argument's producer; the slot is a stub with a reason |
| `return-origin`, `return-field-origin`, `return-field-override` | the output port | what feeds it, or one field of it |
| `choice-control`, `iteration-control`, `iteration-backedge-control` | the operator | the test that controls it |
| `iteration-source`, `iteration-input`, `update-input`, `collection-input` | the operator | one input, drawn as a stub |
| `callback-execution` | the callback | when and how often it runs, and captured values then |
| `closure-capture` | a state link | nothing further: kept until ruled |
| `loop-exception-path` | the loop and its carried values | a return from inside it |

An `argument-origin` row raised beside `callable-origin` belongs to a call the
map does not draw, and is missing.

**Missing**, not drawn anywhere:

| Kind or rule | Not drawn |
|---|---|
| `member-receiver-unresolved`, `parameter-target` (with `candidates`), `registered-subscriber` (the registration named), `unresolved-local-value`, `callable-origin` | the call's target |
| `member-mutation`, `nested-receiver-effect`, `nested-collection-effect` | a write to an object or collection |
| `collection-escape`, `collection-capture`, `collection-alias`, `collection-member-write`, `record-escape` | a collection's or record's contents after that point |
| `branch-result`, `branch-data-join` | the choice between branch values |
| `loop-data-flow` | a carried value |
| `early-exit-control`, `exceptional-control-flow`, `switch-control-flow`, `loop-control-transfer` | the control path: an early return, a catch, a switch, a break or continue |
| `receiver-state-order` | the order of state changes on one receiver |

## Staleness

Reads hash the recorded inputs: mapped and scanned source, generator modules,
the lockfile, facts and clusters. Any change produces `stale` with the reason
and how to regenerate; the viewer marks stale maps. Each mapped file's source
is stored beside its graph, so a code block shows the snapshot that made the
read, a missing one reporting `sourceUnavailable`, not wrong line numbers.

## Authoring

**Clusters**, `flows/*.json` (schema 1, fragments merged in sorted order, a
duplicated node fails). A flow names a region or declaration whose map is
published and lists clusters as `groups` with `id`, optional `label`,
`members` and nested `groups`. A member is a declaration path; a file path, or
a nested declaration its encloser already places, is rejected. A cluster must
draw at least two boxes and must not hide a path that leaves it and re-enters:
that would draw false feedback. Missing or duplicate members fail generation,
so a rename means editing its membership.

```json
{"schema": 1, "flows": [{"path": "core/path",
  "groups": [{"id": "travel", "label": "travel between operations",
    "members": ["core/path/comb.mjs::prepareCombCorners", "core/path/material.mjs::materialRegion"]}]}]}
```

**Facts**, `facts.tsv`: tab-separated `declaration kind fact source date`, for
what the code cannot state. `kind` is `measurement`, `vendor` or `decision`
(`source` a DECISIONS.md heading anchor); `date` is ISO. A row attaches to its
node as `facts`; one naming a declaration no map holds any more is
`orphanFacts`, never dropped; a malformed row fails `check`.

**Scope**, `lib/scope.mjs`: `mappedRoots` become regions; `outsideRoots` are
scanned only so their calls into the maps are seen; `unmappedAreas` are
outside code inside a mapped root, each under its port name; `activeCallers`
the outside files listed as callers on declarations, all else outside being
counted; `importAliases` name served paths that are not the path on disk.

## Checking

`check` exits non-zero when the store is missing or stale (naming the index to
regenerate), an authored node is unplaced, or a fact row is malformed. It
reports `linked`, `unresolved`, `outside` and `platform` totals, `stranded`
declarations (no entry of their region reaches them; they keep their box on
the region map), `unplaced` nodes and orphan facts; `--json` the same as data.
`--viewer` adds coverage: map by map, whether the built drawing carries what
the read presents, naming the fields nothing stands for. It only reports and
is opt-in, reading a view `build` drew; an address scopes it, `coverage.mjs`
states how each item is matched.

## Scoring

`score` rates every map (`lib/score.mjs` states the measures): nodes drawn
outside 6–16, the share of links touching the map's nested content that leave
it, islands of boxes with no link between them, and links against the best
left-to-right order. Each is 0 when ideal; a map's score is their sum and the
tree's energy the sum over maps, the objective a clustering solver would
minimise. It prints the worst and best maps and writes `view/scores.html`,
which every viewer build also refreshes, ranking all maps with links into the
viewer.

## The viewer

`view/index.html` draws the stored maps in place, following declarations
across renumbering; its index lists maps only. A code block opens its source
beside a panel of what its read carries — ports, callees, state, links,
callers, ledger — in the map's sections, each row marked for `check --viewer`
and opening what it names. Code-block boxes have their own colour, calls out
are red headless arrows, repeats link `home`; below 50% a box is its name
alone, hover lights and dims, the minimap and hint bar orient you;
`generated-map` serves 8765.
