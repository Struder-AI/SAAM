# Dev maps

Intent, scope, terms and the reading rules are owned by
[DEVELOPER-CONTEXT.md](../DEVELOPER-CONTEXT.md), what remains by
[BR-052](../build_request.md#br-052--complete-the-dev-map-against-the-2026-09-21-intent). This guide owns the commands, the addresses, what each
read carries and the authoring mechanics. Generation derives leaves, links,
gates and source locations; the cluster solver arranges leaves into maps and
can add no call, link or prose.

- `lib/`: source scanning, leaves (`leaves.mjs`), the tree (`tree.mjs`), the
  store, scoring, the solver and rendering.
- `tree.json` (the solver's clusters, with authored labels), `facts.tsv`,
  `lib/scope.mjs`: the authored inputs.
- `store/`, `view/`: generated snapshots and the viewer; git-ignored.

## Commands

```sh
node scripts/agent-toolkit.mjs read-map ADDRESS [--code] [--details]
node scripts/agent-toolkit.mjs regenerate [INDEX]
node dev-map/cli.mjs check [--json] [--viewer [ADDRESS…]] | build | flow-evidence ADDRESS
node dev-map/cli.mjs score [--json] | solve [--seed N]
node dev-map/cli.mjs watch-freshness [--once]
```

An ADDRESS is a node's index or its durable path: a declaration
(`core/path/compose.mjs::planComposition`, which reads its leaf when it is
folded into one) or a cluster (`@cluster/ID`), never a file or directory.
`read-map` returns one node's read and never scans: a cluster's map or a
leaf's code block; `--code` returns a leaf's source span or the spans of every
leaf in a cluster (`0 --code` is refused), `--details` the read with its evidence:
expressions, traces, byte offsets. Reads are compact JSON: `range` is
`[first,last]` inclusive, nested locations inherit `file`, empty arrays omitted.

`regenerate` is the only command that scans; it always regenerates everything
(about a minute) and redraws the viewer. `solve` anneals the tree, writes
`tree.json` and regenerates. `flow-evidence` re-derives one node from source, to audit the generator;
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

A leaf is a declaration with every declaration written inside it that only it
reaches; one that other code calls or links to directly, or outside code
calls, is a leaf of its own (`lib/leaves.mjs`). A class is its construction
plus its members: the constructor is no node and `new X()` reaches the class.

## What each read carries

Field names predate the [glossary](../DEVELOPER-CONTEXT.md#dev-map-glossary): `destination`
is the view (`graph` for a map, `code` for a code block), `components` are the
boxes, `wires` the links, `couplings` the indirect links, a `group` a cluster,
and `uncertainty` and `unresolved` rows the [findings](#findings).

Every read: `index`, `kind`, `destination`, `stale` when its inputs moved,
`facts` when a fact row names it, `home` on a repeat and `alsoOn` on the home.

- **Top map** (`0`) and **cluster**: `components`, the leaves and clusters it
  draws (a cluster box with its `label`, `[needs label]` until a label pass,
  and `count` of leaves), `leaves` nested, `ports` (ways in by mechanism,
  `out:` for every outside root, and a `boundary:` box for each node on
  another map a link crosses to, shown where the two maps meet), and one link
  per box pair lifted onto the boxes holding each end, with `kinds` and
  `count`. A link is a call, a value passed between calls or an indirect link.
- **Leaf** (function, method, handler, class): `path`, `file`, `range`,
  `folded` (declarations written inside it and folded into it),
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

A leaf box carries its leaf's finding rows, a cluster box the count of rows
nested in it as `findings`; each row names its `file`. `uncertainty` rows name a `kind`, `unresolved` rows a
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
the lockfile, facts and `tree.json`. Any change produces `stale` with the reason
and how to regenerate; the viewer marks stale maps. Each mapped file's source
is stored beside its graph, so a code block shows the snapshot that made the
read, a missing one reporting `sourceUnavailable`, not wrong line numbers.

## Authoring

**Clusters**, `tree.json`, written by `solve` (`lib/solve.mjs`): `clusters`
(`id`, `label`, `parent`), `leaves` (leaf path → the cluster or `0` homing
it) and `repeats` (map → the leaves and clusters it repeats). The solver
anneals the mean map score from the current tree: it forms, dissolves, merges
and moves clusters, re-homes leaves and adds or drops repeats. Placement is
total (`lib/tree.mjs`): a leaf the file leaves out goes where most of its
links are, else to `0`; what no longer exists is dropped; a cluster homing
nothing or drawing fewer than two boxes is dissolved, and a repeat on its
node's home map or inside the cluster it repeats is dropped. Nothing fails.

**Labels** are authored in `tree.json` by a label pass, on request, never by
the solver. A cluster keeps its label and id across a solve while it shares
more than half its leaves with the cluster it was; any other is `[needs label]`.

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

`score` rates every map, `0` and each cluster (`lib/score.mjs` states the
measures): 0.1 per box drawn outside 6–16, the share of links touching the
map's nested content whose other end no box on it holds (a repeat keeps a
link on the map), islands of boxes with no link between them, and links
against the best left-to-right order, the last three from 0 to 1. A map's
score is their sum and the tree's energy the mean over maps, which `solve`
minimises. The viewer shows each map's score and parts in its bar.
`score` prints the worst and best maps and writes `view/scores.html`, which
every viewer build also refreshes, ranking all maps with links into the viewer.

## The viewer

`view/index.html` draws the stored maps in place, following declarations
across renumbering; its index lists maps only. A leaf opens its source
beside a panel of what its read carries — ports, callees, state, links,
callers, ledger — in the map's sections, each row marked for `check --viewer`
and opening what it names. Cluster boxes, leaf boxes and boundary boxes have
their own colours, calls out are red headless arrows, repeats link `home`; below 50% a box is its name
alone, hover lights and dims, the minimap and hint bar orient you;
`generated-map` serves 8765.
