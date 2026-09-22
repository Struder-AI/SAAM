# The dev map

Intent, scope and the reading rules are owned by
[DEVELOPER-CONTEXT.md](../DEVELOPER-CONTEXT.md), the state of the work by
[HANDOFF.md](HANDOFF.md). This guide owns the commands, the addresses, what each
page carries and the authoring mechanics. Generation derives entities, relations,
gates, couplings and source locations; authoring arranges them into pages and can
add no call, wire or prose.

- `lib/`: source scanning, graph composition, stored pages and rendering;
  `lib/destination.mjs` is the one map-or-code rule.
- `flows/*.json`, `facts.tsv`, `lib/scope.mjs`: the authored inputs.
- `store/`, `view/`: generated snapshots and the human viewer; git-ignored.

## Commands

```sh
node scripts/agent-toolkit.mjs read-map ADDRESS [--code] [--details]
node scripts/agent-toolkit.mjs regenerate [INDEX]
node dev-map/cli.mjs check [--json] [--viewer [ADDRESS…]] | build | flow-evidence ADDRESS
node dev-map/cli.mjs watch-freshness [--once]
```

An ADDRESS is an index or a durable path: a region (`core/path`), a declaration
(`core/path/compose.mjs::planComposition`) or a group (`OWNER::@group/ID`),
never a file path. `read-map` returns one stored page and never scans; `--code`
returns a declaration's source span, a group's member spans or a region's files
(`0 --code` is refused), `--details` the page with its evidence: expressions,
traces, byte offsets. Responses are compact JSON: `range` is `[first,last]`
inclusive, nested locations inherit `file`, empty arrays omitted.

`regenerate` is the only command that scans, and it redraws the viewer. No
argument or `0` refreshes everything; with an index, that region and the
references its changed addresses affect, widening to the whole map when an
inventory change, a removed declaration or an old schema requires it, and saying
so. `flow-evidence` re-derives one page from source, to audit the generator;
`build` redraws `view/index.html` from the store, no scan (needs Python 3; set
`PYTHON` otherwise); `watch-freshness` keeps the viewer's live status current.

## Addresses

`0` is the root; `N` a region; each map numbers the nodes it homes `N.1`, `N.2`,
and so on under its own index, down to leaves. A region page homes its flow
roots — the declarations no declaration of that region calls by name, a callable
passed in as a callback among them — and any authored clusters of them; every
other declaration of the region is homed by the first flow page that reaches it,
walking that region's roots and clusters in index order and each page's
components in call order, depth first; one written inside another is homed by
its holder. The walk never descends into a code destination: a leaf is homed
where it is met, and what it calls or holds is homed and drawn there too, wired
from its box, on while each of those is a leaf in turn. Nothing is numbered
beneath a leaf; its chain is drawn on its home map alone. A node drawn on any
other map, a callee in another region included, is a repeat: it keeps its index
and carries `home`, and the home node carries `alsoOn`. Indexes are regenerated
and may change; the declaration path is the durable name. Static methods are
`file.mjs::Class::@static/method` (URI-encoded), instance methods
`file.mjs::Class::method`, parameter defaults `OWNER::@default/NAME`, and
anonymous callbacks a snapshot position authoring must not reference. A
module-level `el.onclick = …` or `addEventListener('x', …)` names its site
`file.mjs::@handler/<receiver>.<event>` (URI-encoded; the receiver an id
selector's id, a binding or a member path) and homes its body. A record is no
page at any depth, so `.` joins its members, `createStudio::lifetime.onViewers`;
a module-level table keeps its entry keys.

Repeated invocations of one declaration are distinct instances, each with an
`id` for its local wires and the shared `index`; a call inside a loop is one
stage with loop feedback, and each binding its body writes is an accumulator of
that loop: `initial` and `next` in, `current` and `final` out. A class page is
its construction plus its members: the constructor is no node, `new X()` reaches
the class page, and its methods are separate nodes homed there.

## What each page carries

Every page: `index`, `kind`, `destination` (`code` when the address is no map,
the read then source with what the page would carry), `stale` when its inputs
moved, `facts` when a fact row names it, `home`/`alsoOn` on components as above.

- **root**: `regions` (index, path, files, lines, nodes, roots), `ports` (each
  way into the regions, and `out:<root>` per scanned root they call), and
  `wires` with kinds and counts.
- **region** and **group**: `components` (roots or clusters, a group's members,
  and the chain of any leaf among them), input and output ports including `in:`
  and `out:` for every scanned root, and one wire per box pair contracted onto
  the root owning each endpoint: `count` sites, `kind` or `kinds`, and what they
  name in the label or in `names` past three; `structural`,
  `relationshipSummary` (sites collapsed into the drawn connections) and
  `composition` (the grouping's source, and edge counts) say so, and a `calls`
  arrow is a call site, not execution order or dataflow.
- **node** (function, method, handler, class): `path`, `file`, `range`, `inputs`
  (`parameterTargets` on a port this page calls: each callable a caller passes,
  by `index`, `path` and `from`; its box is on that caller's page), `outputs`
  (each return and throw), `components` (what it calls, in call order, outside
  invocations naming their target included; an iteration method's callback is a
  stage of this flow, traced inline or called by name; a box a leaf homed here
  brought carries `inlined` and `via`, the leaf calling it, and counts toward no
  relationship total), `operators` (choices, iterations, updates, collections,
  member invocations; one only a finding names carries `keptFor`), `wires` (data
  between instances, with `fromPort` and `toPort`; `argN` for argument slots,
  `positionUnknown` after a spread; one `invocation` wire per box, so none
  floats: `from`, the function itself (`"self"`) or the leaf whose chain drew
  it, the call's `order`, `provenance` (`call-site`, `declaration`/`reference`
  for a box held or named, not called, `operation` for a `keptFor` operator) and
  `stubs`, the slots with no data wire, each a `slot` and either a `literal`,
  the constant written there, cut past 40 characters (a number or boolean as
  itself), or a `reason`, a gap `argument-origin` carries; the rule counts data
  wires but not a `keptFor` operator's), `gates` (each enclosing condition an
  item here names; the call sites behind an invocation wire are `--details`),
  `requires`, `couplings`, `callerReferences` (mapped callers by index; active
  outside callers by path with `unmapped: true`; `callerSummary` with a count
  and canonical index above five), `outsideCallers` (counts per inactive
  directory), `outside` and `platform` (call sites without a mapped target),
  `unresolved` (rows with a `rule`, and `candidates` where callers supply known
  callables), `uncertainty` (rows with a `kind`; repeated `closure-capture` rows
  share one with `count`), `stateFields` on a class — a page that owns no box for
  one writes it as a row — and `state`, what the holder owns and this page uses:
  a factory's `let`/`const` bindings and a class's `this.` fields (`field`, `static-field`), each `name`, `owner`,
  `ownerIndex`, `binding` kind, `access` and site, drawn but never called and
  outside the map-or-code rule. Its wires carry `owned-state` provenance,
  leaving the node for a read and entering it for a write, from `self` with a
  `stub` where the write has no traced producer; the holder wires each one to
  its initialisation and to every member touching it. A code read adds `source`,
  `sourceKind`, `sourceSha256`, its callees and its invocation wires.

Findings follow the node: every box, inlined ones included, carries its row
count as `findings`, a group box the count inside it; a containment map puts the
rows on the box, a node page lists them under `nodeFindings`, an `index`/`path`
section per node in drawing order, never its own; each row names its `file`.

Couplings are `file`, `http-route`, `worker-message`, `event-listener` (a
callable handed to a registration or held by an `on<event>` property) and
`registry-entry`, name-keyed dispatch: each entry of a named function table
reached by key from the declaration naming it, computed keys and spreads being
an analysis limit. Unresolved rules: `member-receiver-unresolved`, `parameter-
target`, `registered-subscriber` (a callee iterated from a collection a
registration fills, named in the row) and `unresolved-local-value`.

## Staleness

Reads hash the recorded inputs: mapped and scanned source, generator modules,
the lockfile, facts and grouping. Any change produces `stale` with the reason and
how to regenerate; the viewer marks stale pages. Each mapped file's source is
stored beside its graph, so a code read returns the snapshot that made the page,
a missing one reporting `sourceUnavailable`, not wrong line numbers.

## Authoring

**Grouping**, `flows/*.json` (schema 1, fragments merged in sorted order, a
duplicated page fails). A flow names a published region or declaration page and
lists groups with `id`, optional `label`, `members` and nested `groups`. A
member is a declaration path; a file path, or a declaration its holder already
places, is rejected. A group must draw at least two boxes and must not hide a
path that leaves it and re-enters: that would draw false feedback. Missing or
duplicate members fail generation, so a rename means editing its membership.

```json
{"schema": 1, "flows": [{"path": "core/path",
  "groups": [{"id": "travel", "label": "travel between operations",
    "members": ["core/path/comb.mjs::prepareCombCorners", "core/path/material.mjs::materialRegion"]}]}]}
```

**External facts**, `facts.tsv`: tab-separated `declaration kind fact source
date`, for what the code cannot state. `kind` is `measurement`, `vendor` or
`decision` (`source` a DECISIONS.md heading anchor); `date` is ISO. A row
attaches to its page as `facts`; one naming a declaration the map no longer
holds is `orphanFacts`, never dropped; a malformed row fails `check`.

**Scope**, `lib/scope.mjs`: `mappedRoots` become regions; `outsideRoots` are
scanned only so their calls into the map are seen; `unmappedDirs` are outside
callers inside a mapped root; `activeCallers` the outside files drawn as caller
rows on declaration pages, all else scanned being counted; `importAliases` name
served paths that are not the path on disk.

## Checking

`check` exits non-zero when the store is missing or stale (naming the index to
regenerate), an authored page is unplaced, or a fact row is malformed. It reports
`linked`, `unresolved`, `outside` and `platform` totals, `stranded` declarations
(no root of their region reaches them; they keep their region-page box),
`unplaced` pages and orphan facts; `--json` the same as data. `--viewer` adds
coverage: page by page, whether the built drawing carries what the compact read
presents, naming the fields nothing stands for. It only reports and is opt-in,
reading a view `build` drew; an address scopes it, `coverage.mjs` states how each
item is matched.

## The viewer

`view/index.html` draws the stored pages in place, following declarations across
renumbering; its index lists map pages only. A code destination opens its source
beside a panel of what its compact read carries — ports, callees, state, wires,
callers, ledger — in the map's sections, each row marked for `check --viewer` and
opening what it names. Code boxes have their own colour, calls out are red
headless arrows, repeats link `home`; below 50% a box is its name alone, hover
lights and dims, the minimap and hint bar orient you; `generated-map` serves 8765.
