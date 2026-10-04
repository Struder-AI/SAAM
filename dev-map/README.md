# Dev maps

Intent, including what a link means: [DEVELOPER-CONTEXT.md](../DEVELOPER-CONTEXT.md#working-with-dev-maps).
Active [0.3.2](../plans/0.3.2.md) sets: `030-architecture` for product work (toolkit default), `030-deployment` for installation/service work. CLI defaults to scanned `default`; pass `--set`. Designs express contracts, not conformance.

- `lib/`: source scanning, leaves (`leaves.mjs`), the tree (`tree.mjs`), the
  store, scoring, the solver and rendering.
- `influence/`: the rebuild's influence analysis ([intent](../plans/dev-maps.md)), run with `run.mjs`.
- `tree.json`, `facts.tsv`, `lib/scope.mjs`: default authored inputs.
- `sets/NAME/map.json`, `tree.json`, `facts.tsv`: independent named sets.
- `store/`, `view/`: generated snapshots and the viewer; git-ignored.

## Dev map glossary

This guide owns map terminology; some tool fields retain older names. Scanned maps describe declarations and functional groups, never a file tree. Design sets separately author responsibilities and contracts.

| Term | Meaning |
|---|---|
| Dev maps / map | The system of graphs, viewer and tools / one graph. |
| Node / home | An indexed leaf or cluster / its sole parent map, which numbers and draws it as a child. |
| Leaf / code block | A generated scoped declaration with owned helpers folded in / its source view in the human viewer. CLI maps supply source ranges; see [containment](#addresses). |
| Inner / outer | A declaration inside another's body / its containing declaration. External access prevents folding. |
| Cluster / top map | A group whose map draws members and links / `0`, the root without a parent box. An unlabeled solver group reads `[needs label]`. |
| Nesting | The functional tree of maps, from `0` through clusters to leaves; scanned sets own it in `tree.json`. |
| Box / repeat | A drawing of a node / a guest drawing away from its home, retaining its index and naming its home. |
| Port / stub | The junction of a link and box, an argument or result slot / an unreached port showing a literal or why the value could not be traced. |
| Boundary box / edge | A node on another map that a link crosses to / the map's boundary and external boxes. |
| External | Active outside declarations, DOM events or module load linked to leaves. `0` draws all; clusters draw those linked to nested nodes. Indistinguishable externals with the same connections and directions share a box, so children may distinguish what parents group. |
| Link / wire | Influence between two nodes, generated from source evidence; its kind says how it travels. Maps draw one counted link per box pair, as one arrow in the [notation](../plans/dev-maps.md#notation). |
| Gate / state link | The condition under which a call runs / a read or write of owned state, shown beside the leaf's code in the viewer. |
| Operator / state | A non-call choice, loop, update, collection or member call / bindings and fields owned by an outer function or class and accessed by inner declarations or members. |
| Carried value | A loop-updated variable: `initial` and `next` in, `current` and `final` out; an operator's ports, not nodes. |
| Finding | Influence the scanner can neither rule out nor fully trace: [missing or uncertain](#findings). |
| Annotation | A sourced, dated statement the code cannot establish; see [facts](#authoring). |
| Outside / platform | Scanned but unmapped SAAM code / code that is not SAAM (language, runtime, browser, packages), counted and never linked. Outside callers are active when making a part or operating Studio. |
| Node path | A durable declaration or `@cluster/ID` identity independent of indexes. |
| Score / energy | A map's squared penalties / the solver's weighted sum across maps; see [scoring](#scoring). |
| Authored inputs | Tree, labels, optional page positions, annotations and scope. Scanned leaves and links are generated. |

## Scope

The scanned `default` maps core and Studio product code. `lib/scope.mjs` owns its roots and the outside code scanned so its calls into the map are seen. Active outside callers are drawn; inactive ones (tests, demos, benchmarks, audits) are counted. Scope crossings in both directions appear as externals at every level. Named sets select leaves while retaining outside connections; design maps and release audits have their own scope. See [authoring](#authoring).

## Commands

```sh
node scripts/agent-toolkit.mjs read-map ADDRESS --set NAME
node scripts/agent-toolkit.mjs regenerate [INDEX] --set NAME
node dev-map/cli.mjs check --set NAME [--json] [--viewer [ADDRESS…]]
node dev-map/cli.mjs score --set default [--json] | solve --set default [--seed N]
node dev-map/cli.mjs watch-freshness --set default [--once]
node dev-map/cli.mjs read ADDRESS --set NAME
```

Design addresses are indexes, `@design/ID`, contract IDs or visible `@link/PAGE/FROM/TO` addresses. Every CLI entry, including onboarding, uses `lib/read.mjs`: maps return all visible boxes/links and leaf `sources` (`file`, inclusive `range`); link/contract reads return complete interfaces with source references. Stop map navigation at the containing map: leaf addresses are rejected as not maps. Read the supplied file ranges with normal file tools only for internals; interactions belong on the parent map. CLI reads never return code or offer `--source`, `--code` or `--details`.

**Replacement contract:** changing a reader or integration must preserve that behavior on the actual direct CLI, toolkit and onboarding routes, including every visible relationship, exact source ranges, full contract semantics and stale warnings. Do not bypass this boundary with a raw snapshot or alternate serializer. The human viewer retains its code previews. `regenerate` captures relationships/source evidence; `build` redraws the snapshot. Missing stores fail explicitly; stale stores remain readable.

Scanned map addresses are cluster indexes or durable `@cluster/ID` paths, never
files, directories or leaf declarations. Declaration identities remain in the viewer.
Scanned sets use the same CLI read contract. Leaf references include folded helper
spans; parent maps retain boundary links and findings. Raw scanner evidence stays
in the stored analysis and viewer; it is not a second CLI read mode. Reads never scan.

Scanned `regenerate` rescans its set and redraws the viewer; design `regenerate` captures relationships and redraws, with implementation scanning owned by `audit`. Default generation
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
helpers called only by that stage (`lib/helpers.mjs`). Design uses the current audit's same source-proved containment;
authored nesting alone proves nothing. Exports, shared callers and escaping references prevent folding.
Effects, dependencies, source and findings stay visible; folding asserts ownership, not purity.

## Stored analysis and viewer fields

`destination` names the view; `components` are boxes, `wires` links and `couplings` indirect links ([glossary](#dev-map-glossary)). The following fields describe scanned snapshots and the human viewer, not extra CLI read modes.

Stored node fields: `index`, `kind`, `destination`, `stale` when its inputs moved,
`facts` when a fact row names it, `home` on a repeat and `alsoOn` on the home.

- **Top map** (`0`) and **cluster**: `components`, the leaves and clusters it
  draws (a cluster box with its `label`, `[needs label]` until a label pass,
  and `count` of leaves; an `external` box with its `externals` and `count`),
  `leaves` nested, `ports` (a `boundary:` box for each node on another map a
  link crosses to, shown where the two maps meet), and one link per box pair
  lifted onto the boxes holding each end, with `kinds` and `count`. External
  boxes count toward the map's edge.
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

Coupling kinds, for influence that travels without a call: `file`, `http-route`,
`worker-message`, `event-listener` and `registry-entry` (keyed dispatch through a
named function table).

## Findings

A finding is influence the scanner can neither rule out nor fully trace. Stored
analysis and the viewer keep every one: `uncertainty` rows name a `kind`,
`unresolved` rows a `rule`, each its `file`. A map carries the **missing** ones,
where influence may exist that no box or link shows: `missing: code` (red) for
code outside every leaf, `missing: link` (orange) for influence between leaves no
link draws. A leaf box carries its rows, a cluster box the count of each class
nested in it as `findings`. **Uncertain** rows qualify what a leaf or link already
draws, such as an argument's origin or which branch runs, and stay in stored
analysis and the viewer. `lib/findings.mjs` classifies each kind.

Absence of a link is no evidence of absence. Resolve a finding by establishing the
influence, or its absence, from source: first ask whether simpler code removes the
ambiguity ([code shape](../DEVELOPER-CONTEXT.md#code-shape)), otherwise improve the
scanner. Never author a link to hide one.

## Staleness

Reads hash the recorded inputs: mapped and scanned source, generator modules,
the lockfile, facts and `tree.json`. Any change produces `stale` with the reason
and how to regenerate; the viewer marks stale maps. Each mapped file's source
is stored beside its graph, so a code block shows the snapshot that made the
read, a missing one reporting `sourceUnavailable`, not wrong line numbers.

## Authoring

**Design sets**: `map.json` declares `mode: "design"`, `title`, `authoring: "manual"`; `architecture.json` owns
stable IDs, indexes, actors, contracts and layout. Nodes reference `source: {file, heading?}` or `{file, declaration?}`;
`optional: true` allows absent local files. Terminal boxes preview source in the viewer; CLI reads return locations. `build --set NAME` captures sources; `check --viewer` checks freshness, boxes, wires and previews.
Contract arrows carry information/actions; `access: [{from,to}]` separately records calls/reads, without transitive permission.
`implementationLinks: [nodeId]` adds observed calls beneath selected roots using exact ownership homes; map 0 retains authored contracts.
Scoped `source.declaration` identities open nested helpers/methods. External links lift to their nearest shared-parent boundary.

**Scanned trees**: `tree.json` owns `clusters` (`id,label,parent`), `leaves` (declaration → home), `repeats`
(map → guests), optional `order`. Placement adds leaves beside links, drops gone leaves and dissolves
empty/single-box clusters; it never re-solves. No map draws a single box; clusters home at least one node.
Repeats keep links on their maps. Size and depth have no cap; scoring judges them. Solving requires owner request; labels are authored.

**Scanned named sets**, `--set NAME`: `sets/NAME/map.json` declares `title`, `scope` (exact generated leaves),
optional `scanFiles`, and `authoring: "manual"` to disable solving. Selected leaves need homes; folded declarations
cannot be selected independently. Unselected connections stay external, including normally counted callers.

**Influence sets** (the rebuild, [influence/solved-set.mjs](influence/solved-set.mjs)): `map.json` declares `mode: "influence"`,
`analysis` (a `run.mjs --out` result), `authored` (the design set whose map 0 and ownership are fixed) and optional
`sourceRoots`, `missing`, `preview`. `regenerate` solves each authored node whose inputs moved, writes `store/model.json`
and draws the viewer; `read`, `build` and `check` use the store. `--set-dir DIR` selects a set kept outside `sets/`,
such as a preview in an ignored folder. Map 0 is drawn at the authored set's map-0 positions (by node id); submaps
are placed by the renderer. Pages carry no prose: unlinked and unowned leaves are counts on boxes and marker boxes
that open their lists, and files not analysed a marked list on map 0. A map `read` is its drawing: `boxes` (a
cluster's label and leaf count; a leaf as `NAME FILE:LINES`, marked only `command` or `command returning data`,
outside `folded` ranges, `possibly caller-dependent`), `boundary` names, and `arrows`, each drawn pair (`→`, `•→`,
`↔`) with its leaf-arrow count, read whole at `@link/MAP/FROM/TO` as `FROM → TO KIND ×N` by direction. Map 0 adds
the preview note, `notAnalysed` and counts for `@unlinked` and `@unowned`. `check` proves reads match the drawing.

**Layout**: scanned `tree.json.layout[mapId]` keys positions by cluster/leaf/external identity; design
`architecture.json.layout[index]` uses drawn indexes. Positions: `{x,y,emphasis?}`; viewport: `[x,y,width,height]`;
captions: `{x,y,text}`. Unpositioned boxes stay below; absent layout uses automatic placement. `build` needs no scan.
Fit frames the overview; Fit all includes dependencies. Scanned `externalLabels` names externals;
`externalGroups` (`id,label,prefixes`) groups them, preserving every declaration/connection.

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

Scanned `check` fails for missing/stale stores or malformed facts; `--json` reports totals and orphan facts.
`--viewer [ADDRESS]` checks drawing coverage against stored reads (`coverage.mjs`).
Design `inventory --set NAME` gathers runtime declarations/modules; `audit` compares exact `ownership.json`
assignments against map 0 and evidenced public operation boundaries, writing `view/audit.html` and `store/audit.json`.
`audit-check` rejects missing/stale snapshots. Boundary audit preserves raw sites, root classifications, private access,
direction review and unresolved ownership/effects; navigation boxes alone impose no API boundary. Exact `interfaces.json`
bindings and public import routes constrain operation access, without certifying schema/effect compliance or granting transitive access.

## Scoring

`score` reports size, boundary, hub, island, backflow and balance penalties (`lib/score.mjs`). Solver energy weights scores by nested
leaf count: each map's score sums squared penalties; energy sums map scores weighted by 1 + log₂ of nested leaves, per leaf. A hub has far more wires than the map's mean.
Crossing is reported, not scored. The viewer and `view/scores.html`
show scores; `score` prints the worst and best maps.

## The viewer

`view/index.html` follows declarations across renumbering. Leaves open source/helpers; externals open connections.
