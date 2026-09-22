# The dev map

Intent, scope and the reading rules are owned by
[DEVELOPER-CONTEXT.md](../DEVELOPER-CONTEXT.md); the state of the map work and
what remains by [HANDOFF.md](HANDOFF.md). This guide owns the commands, the
addresses, what each page carries and the authoring mechanics.

- `cli.mjs`: generation, drawing, checking and live freshness commands.
- `lib/`: source scanning, graph composition, stored pages and rendering;
  `lib/destination.mjs` is the one map-or-code rule.
- `flows/*.json`, `facts.tsv`, `lib/scope.mjs`: the authored inputs.
- `store/`, `view/`: generated snapshots and the human viewer; git-ignored.
  [`../dev-map-OLD/`](../dev-map-OLD/README.md) is superseded, not an input.

Generation derives code entities, relationships, gates, couplings and source
locations. Authoring arranges them into pages; it cannot add a call, a wire or
prose. Disposable checks belong in the OS temp directory.

## Commands

```sh
node scripts/agent-toolkit.mjs read-map INDEX|DECLARATION [--code] [--details]
node scripts/agent-toolkit.mjs regenerate [INDEX]
node dev-map/cli.mjs check [--json] | build | flow-evidence INDEX|DECLARATION
node dev-map/cli.mjs watch-freshness [--once]
```

`read-map` returns one stored page and never scans. Its argument is an index or
its durable path: a region (`core/path`), a declaration
(`core/path/compose.mjs::planComposition`) or a group (`OWNER::@group/ID`); file
paths are not addresses. `--code` returns a declaration's source span, a group's
member spans, or every file of a region (`0 --code` is refused); `--details` the
same page with the stored evidence under it: expressions, producer traces, byte
offsets. Responses are otherwise compact JSON: `range` is `[first,last]`
inclusive, nested locations inherit `file`, empty arrays omitted.

`regenerate` is the only command that scans. With no argument or `0` it
refreshes everything; with an index it refreshes that region and the references
its changed addresses affect, widening to the whole map when an inventory
change, a removed declaration or an old store schema requires it, and saying so.
It also redraws the viewer. `flow-evidence` re-derives one page from source for
auditing the generator; `build` redraws `view/index.html` from the store without
scanning (needs Python 3; set `PYTHON` if it is not `python`);
`watch-freshness` hashes inputs to keep the viewer's live status current.

## Addresses

`0` is the root; `N` a region; each map numbers the nodes it homes `N.1`, `N.2`,
and so on under its own index, down to leaves. A region page homes its flow
roots — the declarations no declaration of that region calls by name, a callable
passed in as a callback among them — and any authored clusters of them; every
other declaration of the region is homed by the first flow page that reaches it,
walking that region's roots and clusters in index order and each page's
components in call order, depth first. A declaration written inside another is
homed by its holder. The walk never descends into a code destination: a leaf is
homed where it is met, and what it calls or holds is homed and drawn there too,
wired from its box, on while each of those is a leaf in turn. Nothing is
numbered beneath a leaf; its chain is drawn on its home map alone. A node drawn
on any other map, including a callee in another region, is a repeat: it keeps
its index and carries `home`, and the home node carries `alsoOn`. Indexes are
regenerated and may change; the declaration path is the durable name. Static
methods are `file.mjs::Class::@static/method` (URI-encoded), instance methods
`file.mjs::Class::method`, parameter defaults `OWNER::@default/NAME`, and
anonymous callbacks a snapshot position that authoring must not reference.

An address is a map when its drawing would show at least two called declarations
with a data wire between them; otherwise `destination` is `code` and the read
returns source with what the page would have carried. Neither operators nor the
boxes a leaf brings make a map: the rule reads the page's own calls.

Repeated invocations of one declaration are distinct instances, each with an
`id` for its local wires and the shared `index`; a call inside a loop is one
stage with loop feedback, and each binding its body writes is an accumulator of
that loop: `initial` and `next` in, `current` and `final` out. A class page is
its construction plus its members: the constructor is not a node, `new X()` reaches the class page, and static and
instance methods are separate nodes homed there.

## What each page carries

Every page: `index`, `kind`, `destination`, `stale` when its inputs moved, `facts`
when a fact row names it, and `home`/`alsoOn` on components as above.

- **root**: `regions` (index, path, files, lines, nodes, roots), `ports` (each
  way into the regions, and `out:<root>` per scanned root they call), and
  `wires` with kinds and counts.
- **region** and **group**: `components` (roots or clusters, a group's members,
  and the chain of any leaf among them), input and output ports including `in:`
  and `out:` for every scanned root, `wires` labelled `calls` with counts,
  contracted onto the root whose flow owns each endpoint. These are containment
  maps: a `calls` arrow is a call site, not execution order or dataflow.
- **node** (function, method, handler, class): `path`, `file`, `range`, `inputs`
  (`parameterTargets` on a port this page calls: each callable a caller passes,
  by `index`, `path` and `from`; its box is on that caller's page), `outputs`
  (each return and throw), `components` (what it calls, in call order, outside
  invocations naming their target included; an iteration method's callback is a
  stage of this flow, traced inline or called by name; a box a leaf homed here
  brought with it carries `inlined` and `via`, the leaf that calls it, and
  counts toward no relationship total), `operators` (choices, iterations,
  updates, collections, member invocations), `wires` (data between instances,
  with `fromPort` and `toPort`; `argN` for argument slots, `positionUnknown`
  after a spread; one `invocation` wire per box, so none floats: `from`, the
  function itself (`"self"`) or the leaf whose chain drew the box, the call's
  `order`, `provenance` (`call-site`, or `declaration`/`reference` for a box
  held or named but not called here) and `stubs`, the slots with no data wire,
  each a `slot` and a `reason` (`literal` a constant at the call site, the rest
  gaps already carried by `argument-origin` rows). It carries no value; the rule
  counts data wires only), `gates` (every enclosing condition),
  `requires`, `couplings`, `callerReferences` (mapped callers by index; active
  outside callers by path with `unmapped: true`; `callerSummary` with a count
  and canonical index above five), `outsideCallers` (counts per inactive
  directory), `outside` and `platform` (call sites without a mapped target),
  `unresolved` (rows with a `rule`, and `candidates` where callers supply known
  callables), `uncertainty` (rows with a `kind`; repeated `closure-capture` rows
  share one with `count`), `stateFields` on a class, and `state`, the
  `let`/`const` bindings the holder owns and this page uses: each is `name`,
  `owner`, `ownerIndex`, `binding` kind, `access` and site, drawn but never
  called, so no part of the map-or-code rule. Its `state` wires carry
  `provenance: "closure-state"`, leaving the node for a read and entering it
  for a write, from `self` with a `stub` where the write has no traced
  producer; the holder wires each binding to its initialisation and to every
  member sharing it. A code read adds `source`, `sourceKind`, `sourceSha256`,
  its callees and its invocation wires.

Findings follow the node: every box, inlined ones included, carries its row
count as `findings`, a group box the count inside it; a containment map puts the
rows on the box, a node page lists them under `nodeFindings`, an `index`/`path`
section per node in drawing order, never its own; each row names its `file`.

Couplings are `file`, `http-route`, `worker-message`, `event-listener` and
`registry-entry`, name-keyed dispatch: each entry of a named table of functions
is reached by key from the declaration that names the table, computed keys and
spreads being an analysis limit. Unresolved rules include
`member-receiver-unresolved`, `parameter-target`, `registered-subscriber` (a
callee iterated from a collection a registration function fills, which the row
names) and `unresolved-local-value`.

## Staleness

Reads hash the recorded inputs: mapped and scanned source, generator modules,
the lockfile, facts and grouping. Any change produces `stale` with the reason
and how to regenerate; the viewer marks stale pages. Each mapped file's source
is stored beside its graph, so a code read returns the snapshot that produced
the page, a missing one reporting `sourceUnavailable`, not wrong line numbers.

## Authoring

**Grouping**, `flows/*.json` (schema 1, fragments merged in sorted order, a
duplicated page fails). A flow names a published region or declaration page and
lists groups with `id`, optional `label`, `members` and nested `groups`. A
member is a declaration path; file paths and declarations written inside another
are rejected, the latter naming the holder that already places them. A group
must draw at least two boxes and must not hide a path that leaves it and
re-enters: that would draw false feedback. Missing or duplicate members fail
generation, so renaming a declaration means editing its membership.

```json
{"schema": 1, "flows": [{"path": "core/path",
  "groups": [{"id": "travel", "label": "travel between operations",
    "members": ["core/path/comb.mjs::prepareCombCorners", "core/path/material.mjs::materialRegion"]}]}]}
```

**External facts**, `facts.tsv`: tab-separated `declaration kind fact source
date`, for what the code cannot state. `kind` is `measurement`, `vendor` or
`decision` (whose `source` is a DECISIONS.md heading anchor); `date` is ISO. A
row attaches to its page as `facts`; one naming a declaration the map no longer
holds is reported as `orphanFacts`, never dropped; a malformed row fails
`check`.

**Scope**, `lib/scope.mjs`: `mappedRoots` become regions; `outsideRoots` are
scanned only so their calls into the map are seen; `unmappedDirs` are outside
callers inside a mapped root; `activeCallers` are the outside files drawn as
caller rows on declaration pages, everything else scanned being counted only;
`importAliases` name served paths that are not the path on disk.

## Checking

`check` exits non-zero when the store is missing or stale (naming the index to
regenerate), when an authored page is unplaced, or when a fact row is malformed.
It reports `linked`, `unresolved`, `outside` and `platform` totals, `stranded`
declarations (no root of their region reaches them; they keep a region-page box
rather than being dropped), `unplaced` pages and orphan facts; `--json` returns
the same as data. The analyzers have no stored tests: their oracle is JavaScript
semantics; a change is checked by regenerating and reading the pages.

## The viewer

`view/index.html` is the drawing of the same stored pages, overwritten in place;
an open viewer follows a declaration across renumbering. Its index lists map
pages only: a leaf opens from its box, or from the filter, which highlights it
on the map that homes it. Boxes that open code have their own colour; callers
elsewhere and calls leaving the map are red headless arrows with clickable
addresses; repeats are red links to `home`. Escape closes the source pane; Back
navigates maps. `generated-map` in `.claude/launch.json` serves port 8765.
