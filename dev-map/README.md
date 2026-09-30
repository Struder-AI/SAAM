# Dev maps

Intent, scope, terms and the reading rules are owned by
[DEVELOPER-CONTEXT.md](../DEVELOPER-CONTEXT.md), what remains by
[BR-052](../build_request.md#br-052--complete-the-dev-map-against-the-2026-09-21-intent). This guide owns the commands, the addresses, what each
read carries and authoring mechanics. Generation derives leaves, links, gates
and source locations; authored grouping or the solver arranges them.

- `lib/`: source scanning, leaves (`leaves.mjs`), the tree (`tree.mjs`), the
  store, scoring, the solver and rendering.
- `tree.json`, `facts.tsv`, `lib/scope.mjs`: default authored inputs.
- `sets/NAME/map.json`, `tree.json`, `facts.tsv`: independent named sets.
- `store/`, `view/`: generated snapshots and the viewer; git-ignored.

## Commands

```sh
node scripts/agent-toolkit.mjs read-map ADDRESS [--code] [--details]
node scripts/agent-toolkit.mjs regenerate [INDEX]
node dev-map/cli.mjs check [--json] [--viewer [ADDRESS…]] | build | flow-evidence ADDRESS
node dev-map/cli.mjs score [--json] | solve [--seed N]
node dev-map/cli.mjs watch-freshness [--once]
node dev-map/cli.mjs read ADDRESS [--code] [--details] --set NAME
```

An ADDRESS is a node's index or its durable path: a declaration
(`core/path/compose.mjs::planComposition`, which reads its leaf when it is
folded into one) or a cluster (`@cluster/ID`), never a file or directory.
`read-map` returns one node's read and never scans: a cluster's map or a
leaf's code block; `--code` returns a leaf's source span or the spans of every
leaf in a cluster (`0 --code` is refused), `--details` the read with its evidence:
expressions, traces, byte offsets. Reads are compact JSON: `range` is
`[first,last]` inclusive, nested locations inherit `file`, empty arrays omitted.

`regenerate` scans the selected set and redraws its viewer. Default generation
places new leaves in the existing tree; manual sets require explicit homes. `solve` anneals the tree, writes `tree.json` and
regenerates. It runs only when the owner asks; an agent may ask for one, never
start one. `flow-evidence` re-derives one node from source, to audit the generator;
`build` redraws `view/index.html` from the store, no scan (needs Python 3; set
`PYTHON` otherwise); `watch-freshness` keeps the viewer's live status current.

## Addresses

Each map numbers the nodes it homes `N.1`, `N.2`, and so on under its own
index, in its left-to-right flow order. Indexes change whenever the tree does;
the declaration path is the durable name. Static methods are `file.mjs::Class::@static/method` (URI-encoded),
instance methods `file.mjs::Class::method`, parameter defaults
`OWNER::@default/NAME`, and anonymous callbacks a snapshot position authoring
must not reference. A module-level `el.onclick = …` or `addEventListener('x', …)`
names its site `file.mjs::@handler/<receiver>.<event>` (URI-encoded; the
receiver an id selector's id, a binding or a member path) and is homed there. A
record is no node at any depth, so `.` joins its members,
`createStudio::lifetime.onViewers`; a module-level table keeps its entry keys.

A leaf includes enclosed declarations it alone reaches and private module
helpers called only by that stage (`lib/helpers.mjs`). Exports, shared callers
and escaping references prevent helper folding. Effects, dependencies, source
and findings move to the owner; folding asserts ownership, not purity. No
authored vocabulary list suppresses nodes. `new X()` reaches the class.

## What each read carries

Field names predate the [glossary](../DEVELOPER-CONTEXT.md#dev-map-glossary): `destination`
is the view (`graph` for a map, `code` for a code block), `components` are the
boxes, `wires` the links, `couplings` the indirect links, a `group` a cluster,
and `uncertainty` and `unresolved` rows the [findings](#findings).

Every read: `index`, `kind`, `destination`, `stale` when its inputs moved,
`facts` when a fact row names it, `home` on a repeat and `alsoOn` on the home.

- **Top map** (`0`) and **cluster**: `components`, the leaves and clusters it
  draws (a cluster box with its `label`, `[needs label]` until a label pass,
  and `count` of leaves; an `external` box with its `externals` and `count`),
  `leaves` nested, `ports` (a `boundary:` box for each node on another map a
  link crosses to, shown where the two maps meet), and one link per box pair
  lifted onto the boxes holding each end, with `kinds` and `count`. External
  boxes count toward the map's edge. A link is a call, a value passed between calls or an indirect link.
- **Leaf** (function, method, handler, class): `path`, `file`, `range`,
  `folded` (owned declarations), `foldedCode` (helpers outside its source span),
  `inputs` (`parameterTargets` on a port this node calls: each callable a
  caller passes, by `index`, `path` and `from`; its box is on that caller's
  map), `outputs` (each return and throw), `components` (what it calls, in call
  order, outside calls naming their target included; an iteration method's
  callback is a step of this flow, traced inline or called by name), `operators` (choices, iterations, updates,
  collections, member calls; one only a finding names carries `keptFor`),
  `wires` (data links between boxes, with `fromPort` and `toPort`; `argN` for
  argument slots, `positionUnknown` after a spread; one call link, `kind:
  invocation`, per box, so none floats: `from`, the function itself (`"self"`),
  the call's `order`, `provenance`
  (`call-site`, `declaration`/`reference` for a box held or named, not called,
  `operation` for a `keptFor` operator), the `gate` its sites stand under, or
  `siteGates` where they differ, and `stubs`, each a `slot` and either a
  `literal`, the constant written there, cut past 40 characters (a number or
  boolean as itself), or a `reason`), `gates` (each condition an item names, by
  number), `requires`, `couplings`, `callerReferences` (mapped callers by
  index; active outside callers by path with `unmapped: true`;
  `callerSummary` with a count and canonical index above five),
  `outsideCallers` (counts per inactive directory), `outside` and `platform`
  (call sites with no mapped target), the findings `unresolved` and
  `uncertainty` (repeated `closure-capture` rows share one with `count`; a
  folded declaration's rows name it as `declaration`),
  `stateFields` on a class, a node that owns no box for one writing it as a
  row, and `state`, what the enclosing declaration owns and this node uses: a
  factory's `let`/`const` bindings and a class's `this.` fields (`field`,
  `static-field`), each `name`, `owner`, `ownerIndex`, `binding` kind, `access`
  and site, never called. State
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

`uncertainty` rows name a `kind`, `unresolved` rows a `rule`; each row names
its `file`, and a leaf's read carries all of them. A map carries only the
**missing** ones (`lib/findings.mjs`), each tagged `missing: code` (red: code
outside every leaf) or `missing: link` (orange: a relationship between leaves
no link draws): a leaf box carries its rows, a cluster box the count of each
class nested in it as `findings`.

| Kind or rule | Class | Not drawn |
|---|---|---|
| `module-code` (on `0`: what runs at load, or a callable no leaf holds) | code | the code itself |
| `member-receiver-unresolved`, `parameter-target` (with `candidates`), `registered-subscriber`, `unresolved-local-value`, `callable-origin`, and an `argument-origin` beside `callable-origin` | link | the call's target |
| `member-mutation`, `nested-receiver-effect`, `nested-collection-effect`, unless `ownership` is `local` | link | a write to an object another leaf shares |
| `collection-escape`, `collection-capture`, `record-escape` | link | contents after they leave the leaf |
| `closure-capture` whose closure is a leaf of its own | link | state two leaves share |

**Uncertain**, a precise aspect of what a leaf or link already draws, in the
leaf's read only: `argument-origin`, `return-origin`, `return-field-origin`,
`return-field-override`, `choice-control`, `iteration-control`,
`iteration-backedge-control`, `iteration-source`, `iteration-input`,
`update-input`, `collection-input`, `callback-execution`, `loop-exception-path`,
`branch-result`, `branch-data-join`, `loop-data-flow`, `collection-alias`,
`collection-member-write`, `early-exit-control`, `exceptional-control-flow`,
`switch-control-flow`, `loop-control-transfer`, `receiver-state-order`, and the
rest of `closure-capture` and the write kinds.

## Staleness

Reads hash the recorded inputs: mapped and scanned source, generator modules,
the lockfile, facts and `tree.json`. Any change produces `stale` with the reason
and how to regenerate; the viewer marks stale maps. Each mapped file's source
is stored beside its graph, so a code block shows the snapshot that made the
read, a missing one reporting `sourceUnavailable`, not wrong line numbers.

## Authoring

**Trees**, `tree.json`: `clusters` (`id`, `label`, `parent`), `leaves`
(declaration → home), `repeats` (map → guests), optional `order` (map → node ids).
The default solver arranges these only on request. Default placement puts new
leaves beside their links, drops gone leaves, and dissolves empty/single-box
clusters. Labels are authored; the solver cannot invent them.

**Named sets**, `--set NAME` on any command: `sets/NAME/map.json` declares
`title`, `scope` (exact generated leaf paths), optional `scanFiles` (scan boundary)
and `authoring: "manual"` to disable solving. Select leaves after scanning;
folded declarations cannot be selected separately. Every selected leaf needs
an authored home. Unselected scanned connections remain externals, including
callers the default map only counts. Each set has its own store and viewer.
`toolpath-pipeline` is the manually authored example. Both sets use one viewer.
Optional `tree.json.layout[mapId]` supplies `positions` keyed by cluster id,
leaf path or external declaration path, each `{x,y,emphasis?}`; unpositioned boxes stay
below. Optional `viewport: [x,y,width,height]` sets initial focus and `captions`
adds `{x,y,text}` annotations. `build` applies position edits without scanning.
Omitting layout keeps automatic placement. Fit frames the overview; Fit all includes
every dependency. `map.json.externalLabels` keeps individual externals distinct;
`externalGroups: [{id,label,prefixes}]` groups boundaries, retaining every member and link.

**Facts**, `facts.tsv`: tab-separated `declaration kind fact source date`, for
what the code cannot state. `kind` is `measurement`, `vendor` or `decision`
(`source` a DECISIONS.md heading anchor); `date` is ISO. A row attaches to its
node as `facts`; one naming a declaration no map holds any more is
`orphanFacts`, never dropped; a malformed row fails `check`.

**Scope**, `lib/scope.mjs`: `mappedRoots` are mapped; `outsideRoots` are
scanned only so their calls into the maps are seen; `unmappedAreas` are
outside code inside a mapped root, each under its port name; `activeCallers`
the outside files listed as callers on declarations, all else outside being
counted; `importAliases` name served paths that are not the path on disk.

## Checking

`check` exits non-zero when the store is missing or stale, or a fact row is
malformed. It reports leaves, clusters, links, the `linked`, `unresolved`,
`outside` and `platform` totals and orphan facts; `--json` the same as data.
`--viewer` adds coverage: map by map, whether the built drawing carries what
the read presents, naming the fields nothing stands for. It only reports and
is opt-in, reading a view `build` drew; an address scopes it, `coverage.mjs`
states how each item is matched.

## Scoring

`score` reports size, boundary, hub, island, backflow and balance penalties;
`lib/score.mjs` owns their weights. Solver energy weights map scores by nested
leaf count. Crossing is reported, not scored. The viewer and `view/scores.html`
show scores; `score` prints the worst and best maps.

## The viewer

`view/index.html` draws the stored maps in place, following declarations
across renumbering; its index lists the top map and clusters.
A leaf opens its source and helpers; an external opens members and connections.
