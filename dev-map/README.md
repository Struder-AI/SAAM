# Dev maps

[Dev maps intent](../plans/dev-maps.md) owns what the maps are for, what an arrow means, notation,
leaves, levels, scope and milestones. This guide covers the tools as they stand.

- `030-influence`: influence maps generated from all SAAM source under `030-architecture`'s map 0.
  Product work reads these; the toolkit and onboarding default to them.
- `030-deployment`: the authored deployment design, for installation and service work.
- `030-architecture`: the authored top level `030-influence` builds on. Read it directly only to
  author map 0 ([authoring](#authoring)), not to explore implementation.

Pass the CLI `--set NAME` (or `--set-dir DIR` for a set kept outside `sets/`); the default is
`030-influence`.

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
middle-out solver groups its leaves into, nested down to leaves, which open as source. A cluster
shows its [authored label](#authored-placement), else one generated from its leaves (`≈`); a node's
library (shared queries treating every caller alike) is one `library ·` box. Pages carry no prose:
unlinked and unowned leaves are counts on boxes and marker boxes that open their lists, and files
not analysed a marked list on map 0. The viewer is `sets/030-influence/view/index.html`.

## Commands

```sh
node scripts/agent-toolkit.mjs read-map ADDRESS [--set NAME]   # default 030-influence
node scripts/agent-toolkit.mjs regenerate [--set NAME]
node dev-map/cli.mjs --set NAME read ADDRESS | regenerate [--solve changed|place] [--cold NODE] | build | check
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
3. **Solve nesting** for each authored node whose slice changed ([solve-middle.mjs](influence/solve-middle.mjs)),
   `jobs` at a time, into `store/solve/`.
4. **Write** `store/model.json`, **place untouched maps**, **draw** `view/`, and **verify** reads match drawings.
5. **Check the code** ([code-checks.mjs](influence/code-checks.mjs)) against
   [what SAAM code is](../plans/dev-maps.md#what-saam-code-is): `regenerate` reports the counts
   and still writes the maps; `check` lists each error as `FILE:LINE: RULE: REASON` and fails on
   any. Rules: `unmodelled` (a shape the analysis does not model, [UNMODELLED.md](influence/UNMODELLED.md)),
   `unowned`, `contract` (a leaf arrow between top-level nodes no authored contract permits),
   `command-returns-data` and `unlinked` (load code that only declares is exempt).

Each closure is cached under `store/analysis/closures/` with a hash of its files, the analyser's
modules, Node and acorn, so only closures holding an edited file run again. Each node's solve is
kept by a hash of exactly what it reads: its own leaves (by rank, so offsets that merely move do
not count), its library leaves, the leaf arrows touching them with each far end as its owner node,
the solve options and the solver's code. Only nodes whose slice changed solve again, warm and cold.
Warm starts from the kept solve, new leaves placed in their file's cluster, and takes only moves
that lower the objective; cold anneals from flat and reshuffles clusters, so it is kept only when
its energy is 3% lower (`COLD_MARGIN`) or the node is named by `--cold NODE` (repeatable or a comma
list; solves it even unchanged). `regenerate` prints each node's `warm` and `cold` energy and which
it `kept`, and under `relabel` the new clusters to label where cold won. With `"solve": "place"` in
`map.json` (or `--solve place`), a changed node is not solved: its new leaves are placed and read
as `placement not solved` until a `"changed"` regenerate (the default) solves it. Timings
(2026-10-04, 2 jobs): every node warm and cold 128 s (studio's cold solve); unchanged 8 s.

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

Open `sets/030-influence/view/index.html` directly in a browser; no running process is needed.
**Arrange** starts on; drag a box and its wires follow. **Undo move** (ctrl+z) restores it.
**Export layout** saves the browser's arrangements;
`node dev-map/cli.mjs --set 030-influence import-layout FILE` imports them into the checkout.
The optional `serve` command saves directly instead of using browser storage.

The [placement solver](../plans/dev-maps.md#placement) places untouched maps with springs,
repulsion, damping, cooling and rectangle clearance.
Soft flow-column guides seed its free-space solve. The nesting solver chooses membership and
levels. Map 0 is authored; a map's first edit saves its whole arrangement. **Reset map**
explicitly requests new physics placement on a submap; on map 0 it undoes this session's moves.

Positions are signed coordinates in free space; Fit and the minimap follow boxes and wires.
Reopening the file restores browser edits; export keeps a portable copy. Imported positions
live in [placement.mjs](influence/placement.mjs):

- Map 0's nodes and actors: `030-architecture/architecture.json` `layout["0"].positions`;
  only that block changes, and the architecture viewer shares it.
- Other boxes: `sets/030-influence/layout.json`, `maps[MAP PATH][BOX]` = `{x,y}`, by identity:
  `@cluster/IDENTITY`, `FILE::NAME[ #K]`, `b:IDENTITY` or `list:NAME`. Its authored cluster names
  (`labels`) and cluster signatures (`clusters`, below) ride along.

Build and regenerate preserve saved positions. Retired positions and labels stay in their
files, are reported by build/regenerate/check and are listed on map 0.
Wires meet box outlines and spread along each side (12 px apart, spilling round corners).
`leveled.py direct_routes` and live dragging use the same rule, matching within 0.1 px on rebuild.

### Cluster identity

The solver numbers clusters afresh on every solve, so pages, positions and labels name a cluster by
an identity carried by content instead ([cluster-identity.mjs](influence/cluster-identity.mjs)):
`NODE/~HEX` (HEX from a hash of its leaves when first seen) or `NODE/library`. Each `regenerate`
matches the clusters it solved to those of the stored model it replaces, node by node, by the
Jaccard overlap of all their leaves (by leaf identity): best pairs first, one to one, at overlap
0.25 or more (below 0.5 reported `weak`; a warm solve keeps most clusters whole, a cold one can
reshuffle a node). A matched cluster keeps its identity, positions and label; when one splits, the
best-overlapping part inherits them and the others are new (solver-placed, generated labels); when
clusters merge, the best-overlapping one goes on and the others retire. The stored model keeps each
cluster page's identity (`path`), this solve's `solverId` and `signature` (leaf count and a MinHash
of its leaves); `summary.clusterIdentity` reports the run (`kept`, `rematched` with overlap and
leaves before and now, `split`, `merged`, `retired`, `new`; for layout.json the keys `migrated` and
the named clusters now `retired`), which `regenerate` prints in one line and `check` repeats.

`regenerate` also brings layout.json along: keys of the solver's old numbering (`@cluster/NODE/3`,
from before identities) are migrated to the identity of the cluster that numbering named, and
`clusters` is refreshed with the current signature of every cluster the maps or labels name (the
authoring server adds one with each drop). Without an earlier stored model (a fresh checkout, a
deleted store) those signatures still match the named clusters to the new solve, by estimated
overlap (about ±0.09); the others then get new identities.
