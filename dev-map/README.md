# Dev maps

[Dev maps intent](../plans/dev-maps.md) owns what the maps are for, what an arrow means, notation,
leaves, levels, scope and milestones. This guide covers the tools as they stand.

Sets:

- `030-influence`: influence maps generated from all SAAM source under `030-architecture`'s map 0.
  Product work reads these; the toolkit and onboarding default to them.
- `030-deployment`: the authored deployment design, for installation and service work.
- `030-architecture`: the authored top level `030-influence` builds on. Read it directly only to
  author map 0 ([authoring](#authoring)), not to explore implementation.

Pass the CLI `--set NAME` (or `--set-dir DIR` for a set kept outside `sets/`); without it, it
still selects the [old scanned set](#old-scanner-tooling-retiring).

## Influence sets

An influence set is a folder holding `map.json`, solved by
[influence/solved-set.mjs](influence/solved-set.mjs):

```json
{"mode": "influence", "title": "…", "authored": "dev-map/sets/030-architecture",
 "analysis": "dev-map/sets/030-influence/store/analysis/analysis.json",
 "analyse": {"maxHeapMB": 4096}, "sourceRoots": ["."], "preview": true, "jobs": 2}
```

`authored` names the design set whose map 0 and ownership are fixed. With `analyse`, `regenerate`
makes `analysis` from the current source; without it, `analysis` is a
[run.mjs](influence/run.mjs) `--out` result made elsewhere, and optional `missing` lists the files
it did not cover. `sourceRoots` are checkouts holding the text the analysis read.

Map 0 draws the authored nodes at their authored positions. Each node opens into clusters the
middle-out solver groups its leaves into, nested down to leaves, which open as source. Cluster
labels are provisional (`≈`), derived from their leaves until label passes exist; a node's
library (shared queries treating every caller alike) is one `library ·` box. Pages carry no prose:
unlinked and unowned leaves are counts on boxes and marker boxes that open their lists, and files
not analysed a marked list on map 0. The viewer is `sets/030-influence/view/index.html`.

## Commands

```sh
node scripts/agent-toolkit.mjs read-map ADDRESS [--set NAME]   # default 030-influence
node scripts/agent-toolkit.mjs regenerate [--set NAME]
node dev-map/cli.mjs --set NAME read ADDRESS | regenerate [--solve changed|place] | build | check
node dev-map/cli.mjs --set NAME serve [--port N] | import-layout FILE   # authored placement
```

Read map 0, then a box, then `@link/MAP/FROM/TO` for the leaf arrows behind an arrow, then the
source at `file:lines` with ordinary file tools. Addresses are map indexes, `@cluster/NODE-ID` for
an authored node, `@cluster/IDENTITY` for a solved cluster (a map read gives it as `address`),
`@link/MAP/FROM/TO`, `@unlinked` and `@unowned`. Indexes are renumbered by any re-solve; a
cluster's identity is not ([cluster identity](#cluster-identity)), so keep that to refer to a
cluster across regenerations. A leaf is not a map: read its source.

A map `read` is its drawing: `boxes` (a cluster's label and leaf count; a leaf as
`NAME FILE:LINES`, marked only `command` or `command returning data`, outside `folded` ranges,
`possibly caller-dependent`), `boundary` names, and `arrows`, each drawn pair (`→`, `•→`, `↔`) with
its leaf-arrow count, read whole at `@link/MAP/FROM/TO` as `FROM → TO KIND ×N` by direction. Map 0
adds the preview note, `notAnalysed` and counts for `@unlinked` and `@unowned`, whose reads list
those leaves. Reads never return code or solve. A read made after source changed reports
the changed files and the regenerate command; a missing store fails.

**Replacement contract:** a change to a reader or integration preserves this read on the direct
CLI, toolkit and onboarding routes: every drawn relationship, exact source ranges and change
warnings. Do not bypass it with a raw snapshot or another serializer. `check` and every
`regenerate` prove the reads match the drawings.

## Regenerate

Regenerate after each task. `regenerate --set 030-influence` runs:

1. **Analyse** ([analyse.mjs](influence/analyse.mjs)): the scope ([scope.mjs](influence/scope.mjs))
   is split into import closures, each analysed soundly by `run.mjs --closure` in its own process,
   smallest first. A closure that fails at the heap cap gives way to the closures of the files it
   imports; files no closure holds are listed as not analysed.
2. **Merge** the closures into `store/analysis/analysis.json`, each callable taking its leaf and
   role from the largest closure holding it.
3. **Solve** each authored node whose slice changed ([solve-middle.mjs](influence/solve-middle.mjs)),
   `jobs` at a time, into `store/solve/`.
4. **Write** `store/model.json`, **draw** `view/`, and **verify** that reads match the drawings.

Each closure is cached under `store/analysis/closures/` with a hash of its files, the analyser's
modules, Node and acorn, so only closures holding an edited file run again. Each node's solve is
kept by a hash of exactly what it reads: its own leaves (by rank, so offsets that merely move do
not count), its library leaves, the leaf arrows touching them with each far end as its owner node,
the solve options and the solver's code. Only nodes whose slice changed solve again. With
`"solve": "place"` in `map.json` (or `--solve place` for one run), a changed node is not solved: its new leaves go to their file's
cluster, read as `placement not solved` until a default (`"changed"`) regenerate solves it.
Timings (2026-10-04): clean 43 minutes (40 of them geometry's solve); unchanged 14 s; a comment
line in a settings file 3.3 minutes, all analysis, nothing re-solved; one added call there 2.6
minutes, `settings` alone re-solved.

## Authoring

The owner authors the top level in `030-architecture`; everything below it is computed.

- `architecture.json`: `nodes` (stable `id`, `index`, `label`, `parent`), `actors`, `contracts`
  (the arrows the top level permits, with their operations) and `layout` (`layout["0"].positions`
  by index; `{x,y,emphasis?}`). Map 0 of `030-influence` uses these nodes and positions by id.
- `ownership.json`: assigns each file or declaration to exactly one authored node. Leaves without
  an owner are drawn as `unowned` and listed at `@unowned`.
- `interfaces.json`: exact operation bindings for the authored contracts.

Design sets (`030-architecture`, `030-deployment`) declare `mode: "design"` and
`authoring: "manual"` in `map.json`; `build --set NAME` redraws them and `check --set NAME --viewer`
checks their drawings. Their reads follow the same contract.

## Authored placement

The owner places boxes by dragging them in the viewer ([milestone 5](../plans/dev-maps.md#milestones)).

```sh
node dev-map/cli.mjs --set 030-influence serve [--port 8768]    # launch entry influence-authoring
```

draws the view, then serves it at `http://localhost:8768/` with **Arrange** on: drag any box on any
map and the arrows touching it (heads, dots, labels, boundary boxes) re-route as it moves; other
boxes stay put. Each drop is saved at once; **Undo move** (ctrl+z) reverts the last move on the
map; **Reset map** returns a submap to its solved layout and redraws it, and on map 0 puts back
every box moved this session. Positions persist as authored data
([placement.mjs](influence/placement.mjs)), each file replaced atomically:

- Map 0's nodes and actors: `030-architecture/architecture.json` `layout["0"].positions` (only that
  block is rewritten; the architecture viewer uses the same positions).
- Every other box: `sets/030-influence/layout.json`, `maps[MAP PATH][BOX]` = `{x,y}`. A box is named
  by identity, never index: `@cluster/IDENTITY` for a cluster, `FILE::NAME[ #K]` for a leaf,
  `b:IDENTITY` for a boundary box, `list:NAME` for a marker. Its `clusters` keeps each named
  cluster's signature (below).

`build` and `regenerate` draw authored positions over solved ones; a box without one keeps its
solved place, and only arrows touching a placed box are re-routed. A re-routed arrow (and every
arrow on map 0) meets each box where the line between the two box centres leaves it; arrows on one
side are spread along it in that order (12 px apart, a full side passing its outermost round the
corner) and leave and enter square to the side (`leveled.py direct_routes`; the live drag runs a
line-for-line copy, so a rebuild draws what the drag showed, within 0.1 px). A position whose map or box is
no longer drawn (its cluster retired, a leaf was renamed) stays in its file and is
reported by `build`, `regenerate` and `check` (`placement.missing`, saying what became of a
retired cluster) and listed on map 0.

### Cluster identity

The solver numbers clusters afresh on every solve, so pages and positions name a solved cluster by
an identity carried by content instead ([cluster-identity.mjs](influence/cluster-identity.mjs)):
`NODE/~HEX` (HEX from a hash of its leaves when first seen) or `NODE/library`. Each `regenerate`
matches the clusters it solved to those of the stored model it replaces, node by node, by the
Jaccard overlap of all their leaves (by leaf identity): best pairs first, one to one, at overlap
0.25 or more (below 0.5 reported `weak`: a full re-solve after a one-leaf change can reshuffle a
node, and the best successors of its top clusters then overlap them by about 0.3; `"solve":"place"`
keeps them whole). A matched cluster keeps its identity; when one splits, the best-overlapping part
inherits it (and its positions) and the other parts are new and solver-placed; when clusters
merge, the best-overlapping one's identity goes on and the others retire. The stored model keeps
each cluster page's identity (its `path`), this solve's `solverId` and `signature` (leaf count and
a MinHash of its leaves), and `summary.clusterIdentity` reports the run: `kept`, `rematched`
(overlap, leaves before and now), `split`, `merged`, `retired`, `new`, and for layout.json the keys
`migrated` and the named clusters now `retired`. `regenerate` prints one line of it; `check`
repeats it.

`regenerate` also brings layout.json along: keys of the solver's old numbering (`@cluster/NODE/3`,
from before identities) are migrated to the identity of the cluster that numbering named, and
`clusters` is refreshed with the current signature of every cluster the maps name (the authoring
server adds one with each drop). Without an earlier stored model (a fresh checkout, a deleted
store) those signatures still match the owner's placed clusters to the new solve, by estimated
overlap (about ±0.09); unplaced clusters then get new identities.

Opened any other way (a file, the static `influence-map` server), **Arrange** keeps moves in the
browser; **Export layout** writes them to a file and
`node dev-map/cli.mjs --set 030-influence import-layout FILE` commits it.

`regenerate --solve changed|place` overrides `map.json` `solve` for one run.

## Old scanner tooling (retiring)

Still present until [milestone 5](../plans/dev-maps.md#milestones) removes it; not used for product
work. Nothing here describes the influence maps.

- The scanner in `lib/` (leaves, tree, graph, findings, couplings, scope) and its scanned set,
  selected when the CLI is given no `--set`: `tree.json`, `facts.tsv`, `lib/scope.mjs`.
- `score`, `solve`, `watch-freshness` and `flow-evidence` on scanned sets; `inventory`, `audit` and
  `audit-check` on design sets (`view/audit.html`, `store/audit.json`).
- `lib/score.mjs` stays: its penalties are the influence solver's starting objective.
