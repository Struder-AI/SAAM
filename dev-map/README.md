# The dev map

Intent, scope and the reading rules are owned by
[DEVELOPER-CONTEXT.md](../DEVELOPER-CONTEXT.md); the state of the map work and
what remains by [HANDOFF.md](HANDOFF.md). This guide owns the commands, the
addresses, what each page carries and the authoring mechanics. Generation
derives code entities, relationships, gates, couplings and source locations;
authoring arranges them into pages and can add no call, wire or prose.

- `cli.mjs`: generation, drawing, checking and live freshness commands.
- `lib/`: source scanning, graph composition, stored pages and rendering;
  `lib/destination.mjs` is the one map-or-code rule.
- `flows/*.json`, `facts.tsv`, `lib/scope.mjs`: the authored inputs.
- `store/`, `view/`: generated snapshots and the human viewer; git-ignored.

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
same page with its stored evidence: expressions, producer traces, byte offsets.
Responses are otherwise compact JSON: `range` is `[first,last]` inclusive,
nested locations inherit `file`, empty arrays omitted.

`regenerate` is the only command that scans. With no argument or `0` it
refreshes everything; with an index it refreshes that region and the references
its changed addresses affect, widening to the whole map when an inventory
change, a removed declaration or an old store schema requires it, and saying so.
It also redraws the viewer. `flow-evidence` re-derives one page from source for
auditing the generator; `build` redraws `view/index.html` from the store without
scanning (needs Python 3; set `PYTHON` if it is not `python`); `watch-freshness`
hashes inputs to keep the viewer's live status current.

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
anonymous callbacks a snapshot position that authoring must not reference. A
module-level `el.onclick = …` or `addEventListener('x', …)` has no holder, so
its site names it `file.mjs::@handler/<receiver>.<event>` (URI-encoded; the
receiver an id selector's id, a binding or a member path) and homes its body.

An address is a map when its drawing would show at least two called declarations
with a data wire between them; otherwise `destination` is `code` and the read
returns source with what the page would have carried. Neither operators nor the
boxes a leaf brings make a map: the rule reads the page's own calls.

Repeated invocations of one declaration are distinct instances, each with an
`id` for its local wires and the shared `index`; a call inside a loop is one
stage with loop feedback, and each binding its body writes is an accumulator of
that loop: `initial` and `next` in, `current` and `final` out. A class page is
its construction plus its members: the constructor is no node, `new X()` reaches
the class page, and its methods are separate nodes homed there.

## What each page carries

Every page: `index`, `kind`, `destination`, `stale` when its inputs moved, `facts`
when a fact row names it, and `home`/`alsoOn` on components as above.

- **root**: `regions` (index, path, files, lines, nodes, roots), `ports` (each
  way into the regions, and `out:<root>` per scanned root they call), and
  `wires` with kinds and counts.
- **region** and **group**: `components` (roots or clusters, a group's members,
  and the chain of any leaf among them), input and output ports including `in:`
  and `out:` for every scanned root, and one wire per box pair contracted onto
  the root owning each endpoint: `count` sites, `kind` or `kinds`, and what they
  name in the label or in `names` past three. These are containment maps: a
  `calls` arrow is a call site, not execution order or dataflow.
- **node** (function, method, handler, class): `path`, `file`, `range`, `inputs`
  (`parameterTargets` on a port this page calls: each callable a caller passes,
  by `index`, `path` and `from`; its box is on that caller's page), `outputs`
  (each return and throw), `components` (what it calls, in call order, outside
  invocations naming their target included; an iteration method's callback is a
  stage of this flow, traced inline or called by name; a box a leaf homed here
  brought carries `inlined` and `via`, the leaf calling it, and counts toward no
  relationship total), `operators` (choices, iterations, updates, collections,
  member invocations), `wires` (data between instances, with `fromPort` and
  `toPort`; `argN` for argument slots, `positionUnknown` after a spread; one
  `invocation` wire per box, so none floats: `from`, the function itself
  (`"self"`) or the leaf whose chain drew it, the call's `order`, `provenance`
  (`call-site`, or `declaration`/`reference` for a box held or named, not
  called) and `stubs`, the slots with no data wire, each a `slot` and either a
  `literal`, the constant written there, cut past 40 characters (a number or
  boolean as itself), or a `reason`, a gap `argument-origin` carries; the rule
  counts data wires only), `gates` (every enclosing condition), `requires`,
  `couplings`, `callerReferences` (mapped callers by index; active outside
  callers by path with `unmapped: true`; `callerSummary` with a count and
  canonical index above five), `outsideCallers` (counts per inactive directory),
  `outside` and `platform` (call sites without a mapped target), `unresolved`
  (rows with a `rule`, and `candidates` where callers supply known callables),
  `uncertainty` (rows with a `kind`; repeated `closure-capture` rows share one
  with `count`), `stateFields` on a class, and `state`, what the holder owns and
  this page uses: a factory's `let`/`const` bindings and a class's `this.`
  fields (`field`, `static-field`), each `name`, `owner`, `ownerIndex`,
  `binding` kind, `access` and site, drawn but never called and outside the
  map-or-code rule. Its wires carry `owned-state` provenance, leaving the node
  for a read and entering it for a write, from `self` with a `stub` where the
  write has no traced producer; the holder wires each one to its initialisation
  and to every member touching it. A code read adds `source`, `sourceKind`,
  `sourceSha256`, its callees and its invocation wires.

Findings follow the node: every box, inlined ones included, carries its row
count as `findings`, a group box the count inside it; a containment map puts the
rows on the box, a node page lists them under `nodeFindings`, an `index`/`path`
section per node in drawing order, never its own; each row names its `file`.

Couplings are `file`, `http-route`, `worker-message`, `event-listener` and
`registry-entry`, name-keyed dispatch: each entry of a named table of functions
is reached by key from the declaration naming the table, computed keys and
spreads being an analysis limit. Unresolved rules include
`member-receiver-unresolved`, `parameter-target`, `registered-subscriber` (a
callee iterated from a collection a registration fills, named in the row) and
`unresolved-local-value`.

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
member is a declaration path; a file path, or a declaration its holder already
places, is rejected. A group must draw at least two boxes and must not hide a
path that leaves it and re-enters: that would draw false feedback. Missing or
duplicate members fail generation, so renaming a declaration means editing its
membership.

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
the same as data.

## The viewer

`view/index.html` draws the stored pages in place, following a declaration
across renumbering; its index lists map pages only. Code boxes have their own
colour, calls leaving it are red headless arrows, repeats link `home`. Below 50%
a box is its name alone; a minimap says where you are; hover lights a box, its
wires and far ends and dims the rest; `x` pins, `]` `[` walk the ends, `\`
returns, Escape closes pane/focus, Back walks maps; a wire too long to see whole
is two ends that name and open each other; `generated-map` serves 8765.
