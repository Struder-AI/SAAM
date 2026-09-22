# The dev map

Intent, scope and the reading rules are owned by
[DEVELOPER-CONTEXT.md](../DEVELOPER-CONTEXT.md); the state of the map work and
what remains by [HANDOFF.md](HANDOFF.md). This guide owns the commands, the
addresses, what each page carries and the authoring mechanics.

- `cli.mjs`: generation, drawing, checking and live freshness commands.
- `lib/`: source scanning, graph composition, stored pages and rendering.
- `flows/*.json`, `facts.tsv`, `lib/scope.mjs`: the authored inputs.
- `store/`, `view/`: generated snapshots and the human viewer; git-ignored.
- [`../dev-map-OLD/`](../dev-map-OLD/README.md): superseded material, not an input.

Generation derives code entities, relationships, gates, couplings and source
locations. Authoring arranges generated entities into pages; it cannot add a
call, a wire or prose. Disposable checks belong in the OS temporary directory.

## Commands

```sh
node scripts/agent-toolkit.mjs read-map INDEX|DECLARATION [--code] [--details]
node scripts/agent-toolkit.mjs regenerate [INDEX]
node dev-map/cli.mjs check [--json]
node dev-map/cli.mjs build
node dev-map/cli.mjs flow-evidence INDEX|DECLARATION
node dev-map/cli.mjs watch-freshness [--once]
```

`read-map` returns one stored page and never scans. Its argument is an index,
or the durable path that index is for: a region (`core/path`), a declaration
(`core/path/compose.mjs::planComposition`) or a group (`OWNER::@group/ID`).
`--code` returns the source span of a declaration, the member spans of a group,
or every file of a region (`0 --code` is refused); `--details` returns the full
stored evidence. The default response is compact JSON: `range` is
`[firstLine,lastLine]` inclusive, nested locations inherit `file`, empty arrays
are omitted, and expressions, producer traces and byte offsets are under
`--details`.

`regenerate` is the only command that scans. With no argument or `0` it
refreshes everything; with an index it refreshes that region and the references
its changed addresses affect, widening to the whole map when an inventory
change, a removed declaration or an old store schema requires it, and saying
so. It also redraws the viewer. `check` is under [Checking](#checking);
`flow-evidence` re-derives one page from source for auditing the generator;
`build` redraws `view/index.html` from the store without scanning (needs Python
3; set `PYTHON` if it is not `python`); `watch-freshness` keeps the viewer's
live status current by hashing inputs. First onboarding generates a store when
none exists.

## Addresses

`0` is the root; `N` a region; each map numbers the nodes it homes `N.1`,
`N.2`, and so on under its own index, down to leaves. A region page homes its
flow roots, the declarations nothing in the region calls, and any authored
clusters of them; every other declaration is homed by the first flow page that
reaches it, walking regions in index order, a page's components in call order,
depth first. A declaration written inside another is homed by its holder. A
node drawn on any other map is a repeat: it keeps its index and carries `home`,
and the home node carries `alsoOn`. Indexes are regenerated and may change; the
declaration path is the durable name. Static methods are
`file.mjs::Class::@static/method` (URI-encoded), instance methods
`file.mjs::Class::method`, function-valued parameter defaults
`OWNER::@default/NAME`, and anonymous callbacks a snapshot source-position
identity that authoring must not reference.

An address is a map when its drawing would show at least two called
declarations with a wire between them; otherwise `destination` is `code` and
the read returns source together with the callers, couplings, boxes and
findings the page would have carried. Operators alone do not make a map.

Repeated invocations of one declaration are distinct instances, each with an
`id` for its local wires and the shared `index`. A call inside a loop is one
stage with loop feedback. A class page is its construction plus its members:
the constructor is not a node, `new X()` reaches the class page, and static and
instance methods are separate nodes homed there.

## What each page carries

Every page: `index`, `kind`, `destination`, and `stale` when its inputs moved.

- **root**: `regions` (index, path, files, lines, nodes, entries), `ports`
  (each way into the regions, and `out:<root>` per scanned root they call),
  `wires` with kinds and counts.
- **region** and **group**: `components` (roots or clusters; a group's
  members), input and output ports including `in:` and `out:` for every scanned
  root, `wires` labelled `calls` with counts. These are containment maps: a
  `calls` arrow is a call site, not execution order or dataflow. Each drawn
  declaration box carries its own `uncertainty` and `unresolved` rows; a group
  box carries `findings`, one count.
- **node** (function, method, handler, class): `path`, `file`, `range`,
  `inputs`, `outputs` (each return and throw), `components` (what it calls, in
  call order, including outside invocations that name their target),
  `operators` (choices, iterations, updates, collections, member invocations),
  `wires` (data between instances, with `fromPort` and `toPort`; `argN` for
  argument slots, `positionUnknown` after a spread), `gates` (every enclosing
  condition), `requires`, `couplings`, `callerReferences` (mapped callers by
  index; active outside callers by path with `unmapped: true`; `callerSummary`
  with a count and the canonical index when more than five would repeat),
  `outsideCallers` (counts per inactive caller directory), `outside` and
  `platform` (call sites without a mapped target), `unresolved` (rows with a
  `rule`, and `candidates` where callers supply known callables), `uncertainty`
  (rows with a `kind`; repeated `closure-capture` rows share one row with
  `count`), and `stateFields` on a class. A code read adds `source`,
  `sourceKind` and `sourceSha256`.
- **any page**: `facts` when a fact row names it; `home` and `alsoOn` on
  components as above.

Couplings are `file`, `http-route`, `worker-message`, `event-listener` and
`registry-entry`. A `registry-entry` is name-keyed dispatch: each entry of a
named table of functions (a `const` table, a `Map` with literal keys, or the
object a factory returns, named by the factory's path) is reached by key from
the declaration that names the table; computed keys and spreads are an analysis
limit. Unresolved rules include `member-receiver-unresolved`,
`parameter-target`, `registered-subscriber` (a callee iterated from a
closure-local collection filled by a registration function, which the row
names) and `unresolved-local-value`.

## Staleness

Every read hashes the recorded inputs: mapped and scanned source, generator
modules, the lockfile, facts and grouping. Any change produces `stale` with the
reason and the regeneration instruction; reads never regenerate silently, and
the viewer marks stale pages. Each mapped file's source is stored beside its
graph, so code reads return the snapshot that produced the page; a page whose
snapshot is missing reports `sourceUnavailable` rather than applying old line
numbers to changed source.

## Authoring

**Grouping**, `flows/*.json` (schema 1, fragments merged in sorted order, a
duplicated page fails). A flow names a published region or declaration page and
lists groups with `id`, optional `label`, `members` and nested `groups`. A
member is a declaration path; file paths and declarations written inside
another declaration are rejected, the latter naming the holder that already
places them. A group must draw at least two boxes, and must not hide a path
that leaves it and re-enters, because that would draw false feedback. Missing
or duplicate members fail generation, so renaming or removing a declaration
means editing its membership; ordinary edits only need `regenerate`. A group
for a page no map shows is `unplaced`, and `check` fails with the list.

```json
{"schema": 1, "flows": [{"path": "core/path",
  "groups": [{"id": "travel", "label": "travel between operations",
    "members": ["core/path/comb.mjs::prepareCombCorners", "core/path/material.mjs::materialRegion"]}]}]}
```

**External facts**, `facts.tsv`: tab-separated `declaration kind fact source
date`, for what the code cannot state. `kind` is `measurement`, `vendor` or
`decision` (whose `source` is a DECISIONS.md heading anchor); `date` is ISO. A
row is attached to its page as `facts`; a row naming a declaration the map no
longer holds is reported as `orphanFacts` and never dropped; a malformed row
fails `check` by line.

**Scope**, `lib/scope.mjs`: `mappedRoots` become regions; `outsideRoots` are
scanned only so their calls into the map are seen; `unmappedDirs` are
directories inside a mapped root that are outside callers instead of regions;
`activeCallers` are the outside files drawn as caller rows on declaration
pages, everything else scanned being counted only; `importAliases` name served
paths that are not the path on disk.

## Checking

`check` exits non-zero when the store is missing or stale (naming the index to
regenerate), when an authored page is unplaced, or when a fact row is
malformed. It reports `linked`, `unresolved`, `outside` and `platform` totals,
`unreached` declarations, `unplaced` pages and orphan facts; `--json` returns
the same as data. The analyzers have no stored tests: their oracle is
JavaScript semantics, re-derived from the scanner source when a change is
made, and a change is checked by regenerating and reading the affected pages.

## The viewer

`view/index.html` is the drawing of the same stored pages, overwritten in
place; an open viewer follows a declaration across renumbering. Boxes that open
code have their own colour; callers elsewhere and calls leaving the map are red
headless arrows with clickable addresses; repeats are red links to `home`.
Escape closes the source pane; Back navigates maps only. The `generated-map`
configuration in `.claude/launch.json` serves the directory on port 8765.
