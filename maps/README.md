# The dev map

The map is generated from the code. Regions, files, entry points, boxes, wires,
labels, gates and lists all come from the parsed source. The only authored
inputs are the scan scope, `scripts/dev-map/scope.mjs`, and the external-fact
rows in [facts.tsv](facts.tsv). Nothing else about the map is written by hand.

## Commands

```sh
node scripts/agent-toolkit.mjs read-map INDEX|DECLARATION [--code]
node scripts/agent-toolkit.mjs regenerate [INDEX]
node scripts/dev-map.mjs build
node scripts/dev-map.mjs check [--json]
node scripts/dev-map.mjs flow-evidence INDEX|DECLARATION
```

`read-map` returns one stored page and never scans. Its argument is an index or
the declaration path that index is for; a region path (`core/path`) and a file
path (`core/path/compose.mjs`) are declaration paths too. `--code` adds that
page's own source span with line numbers, and is refused on `0` and on a region
page, which span no code of their own.

`regenerate` is the only command that reads source. With no argument, or `0`, it
rescans everything; with a region or page index it regenerates that region and
leaves every other region's stored pages byte-identical.

`build` draws the whole stored map for a person into `dev-map/view/`; open
`dev-map/view/index.html`, or serve that directory (the `generated-map`
configuration in `.claude/launch.json` serves it on port 8765). It reads the
store and never scans, so it refuses when there is no store and marks a page
whose source has moved. It needs Python 3; set `PYTHON` if it is not `python`.
`check` is described under [Checking](#checking). `flow-evidence` re-derives one
page from source with its call sites and columns, for auditing the generator.

The store is `dev-map/store/`; both it and the viewer are ignored by Git.

## The walk

`0` → region `N` → file `N.F` → entry point `N.F.E` → its callees → `--code` →
edit → `regenerate [INDEX]` → read again. Each step down is a box on the page
above it.

Prefer the walk over text search when orienting. Search finds names; the walk
gives `calledFrom`, couplings and the `unresolved` count, which is what says who
depends on the code being changed.

Indexes are regenerated and may change. Use one for talking about a page — the
index and the name together, as in `6.3.1 composeResults` — and never write one
into a document, a comment or code. The declaration path is the durable name.

## What each page carries

Every page: `index`, `kind`, `flow`, `generated`, and `stale` when the source
behind it has moved since the store was written.

- **`0` (root)** — `regions` (index, path, files, lines, nodes, entry points),
  `ports` (every way into the regions from outside them), `wires` between
  regions with their kinds and counts, `children`.
- **region** — `path`, `files`, `lines`, `nodes`, `components` (one per file,
  with its node and entry-point counts and any `unreached` count), `ports`,
  `wires` between the region's files, `children`.
- **file** — `file`, `region`, `lines`, `nodes`, `components` (the file's entry
  points), `unreached` (declarations no entry point of the file reaches),
  `ports` (other files, other regions, outside callers), `wires`, `children`.
- **node** (function, method, handler, class) — `path`, `file`, `line`,
  `endLine`, `lines`, `kind`, `inputs`, `outputs`, `components` (what it calls,
  in call order), `wires`, `gates`, `requires` (assertions it makes),
  `formulas`, `calledFrom`, `couplings`, `unresolved`, `external`, and `leaf`
  when its body calls nothing.
- **any node or file page** — `facts`, only when a row names it.

A `--code` read answers with `file`, `line`, `endLine`, `lines` and `source`:
a node's own span, or the whole file for a file page.

## Staleness

Every read hashes the source behind the page it returns. When a hash differs the
page comes back with `stale: {files, regenerate}`, naming the files that moved
and the index to regenerate. The viewer marks such a page on its own drawing.
Pages are never silently redrawn from source at read time.

## External facts

[facts.tsv](facts.tsv) is the one place authored content enters the map, for
what the code cannot state: a measurement, a vendor or firmware behavior, or a
recorded decision. It is tab-separated with a header row:

```text
declaration	kind	fact	source	date
```

- `declaration` — a declaration path, or a file path for a file-level fact.
- `kind` — `measurement`, `vendor` or `decision`.
- `fact` — the fact itself, in one line.
- `source` — where it came from. For `decision`, the anchor of a DECISIONS.md
  heading, as a link to it would write it.
- `date` — ISO `YYYY-MM-DD`.

`regenerate` attaches the rows to their pages as `facts` and the viewer prints
them under the drawing, above the other lists and marked as authored. A row
whose declaration the map no longer holds is reported as `orphanFacts` with the
row itself, by `regenerate` and by `check`; it is never dropped. A malformed
row, an unknown kind or a decision anchor that does not exist fails `check`,
named by line.

## Checking

`node scripts/dev-map.mjs check` exits non-zero when the store is missing, when
the store is stale (naming the index to regenerate), or when a fact row is
malformed. It reports the repository's `linked`, `unresolved` and `external`
totals, the `unreached` declarations, and any orphan facts. `--json` returns the
same as data.

## Scope

`scripts/dev-map/scope.mjs` holds the whole authored scope: `mappedRoots` are
the top-level directories that become regions, and `outsideRoots` are scanned
only so the calls they make into the mapped roots are seen and appear as ports.
It also holds the serving aliases whose import specifier is not the path on
disk. Regions, files, entries, numbering and every box follow from the code.

## Tests

```sh
node --test core/tests/dev-map-flow.test.mjs core/tests/dev-map-view.test.mjs
```
