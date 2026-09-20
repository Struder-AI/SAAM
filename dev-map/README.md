# The dev map

All active developer-map tooling and inputs live in this folder:

- `cli.mjs`: generation, drawing, checking and live freshness commands.
- `lib/`: source scanning, graph composition, stored pages and rendering.
- `flows.json`, `flows/`, `facts.tsv`: authored grouping and external facts.
- `tests/`: map regression tests (`npm run test:maps` from the repository root).
- `store/`, `view/`: generated snapshots and the stable human viewer; git-ignored.
- `audit/`: local working checks and behavioral baselines still in use; git-ignored.

Historical comparisons and superseded review artifacts live in
[`dev-map-OLD/`](../dev-map-OLD/README.md). Maker and builder documentation maps
are separate documentation navigation. This reorganization does not add support
for other projects or expand the scanner's language coverage.

The map generates code entities, relationships, gates and source locations.
Authored flow grouping in [flows.json](flows.json) and `flows/*.json` arranges generated entities
into explanatory pages; it cannot add implementation calls or data links.
Other authored inputs are the scan scope, `dev-map/lib/scope.mjs`, and
external-fact rows in [facts.tsv](facts.tsv). The graph stays the account of
structure; prose does not replace missing relationships.

Repeated invocations of one declaration are distinct stage instances. Each has
an `id` for its local wires and the same canonical `index` for opening the shared
implementation. Generated result-binding names distinguish the uses. A call
inside a loop stays one stage with loop feedback; separate source calls never
collapse merely because they use the same implementation. Nested call evidence
uses the complete source span, including its end.

Structural region/file overviews summarize repeated call sites between the same
shown endpoints and retain their counts. Such call summaries are navigation,
not a claim of runtime sequence or dataflow. Detailed reads preserve every
underlying edge. Function flow pages retain their invocation identities, named
data, conditions and state connections.

## Commands

```sh
node scripts/agent-toolkit.mjs read-map INDEX|DECLARATION [--code] [--details]
node scripts/agent-toolkit.mjs regenerate [INDEX]
node dev-map/cli.mjs build
node dev-map/cli.mjs check [--json]
node dev-map/cli.mjs flow-evidence INDEX|DECLARATION
```

`read-map` returns one stored page and never scans. Its argument is an index or
the declaration path that index is for; a region path (`core/path`) and a file
path (`core/path/compose.mjs`) are declaration paths too. A group also has a
durable path, `OWNER::@group/ID`. `--code` returns the node's source span, a
whole file, a group's member spans, or all files in a region. Only `0 --code`
is refused. Multi-file reads return `sources`, with line numbers and locations.
Declarations with at most one callee and no flow operators, declarations whose
helper boxes have no generated wires, and empty file graphs have `destination: "code"`:
reading their address returns source directly, together with port references,
callers, coupling and uncertainty metadata. The viewer uses the same destination and
opens source without an intervening one-box drawing.
The left-hand viewer index lists graph pages only; terminal code addresses remain
available on their parent boxes and through direct address lookup.
The source pane displays code. Code-opening boxes have a distinct color.
Known callers elsewhere use red vertical arrows with individually clickable
addresses. Callers represented on the current page connect to their targets
with arrows labeled `calls`; those arrows do not claim returned-data flow or
execution order. Components carry off-page relationships in `callerReferences`,
and `callerWires` holds the connections within the page. The compact response
omits `calledFrom` entries already represented by those relations; the detailed
packet retains all canonical incoming-call evidence. Class membership is not a call.
Off-page reference arrows start on the shared box and point outward. An expanded
function lists its own callers as plain links, without a frame-level arrow. Compatible value
wires share a drawn connection with all values named; separate connections do
not imply asynchronous execution.

Input and return ports show their name and a short generated `references` entry
per caller site. Follow that caller's map for surrounding context. The full
argument expressions, patterns, defaults, result bindings and producer/consumer
traces remain in `--details`; the default CLI and drawing share the same reduced
information level. Unknown origins, uncertain spread positions and untraced uses
remain marked. These references are never authored in flows.json.

The default CLI response is compact JSON of the same stored graph. `range` is
`[firstLine,lastLine]`, inclusive; nested locations inherit the enclosing `file`.
Empty arrays are omitted. Duplicate spans, line counts, leaf flags and inventory
entries are removed. `calls` retains source occurrences, argument counts, simple
result bindings and analysis limits. Wires carry producers and consumers between
distinct invocation instances. `argN` identifies the Nth source argument; at and
after a spread, `positionUnknown` marks that the expanded callee position is not
known. Constants and untraced arguments retain slot markers. Expressions, producer
traces, result-use lists and byte offsets are available with `--details`, without rescanning.
`--code` returns source and edit-safety metadata without the graph body; automatic
terminal reads also retain their input/output boundary references. `--details`
can be combined with `--code`. The underlying store and graph relationships are unchanged
by this presentation format. Operator boxes show their identity/operation,
source location and a concise unresolved marker where applicable. The default
agent response uses the same information level. Expressions, constants, payloads,
branch alternatives and loop/update mechanics belong under source or `--details`,
not repeated inside boxes. Connections, wire roles, gates and page uncertainty
remain in the graph. Every operator body opens its
matching source span; it does not open another synthetic map page.

Back navigates maps only. Opening or closing source does not add a map-history
entry, and Back leaves an open source pane alone. Escape closes source.

Run `node dev-map/cli.mjs watch-freshness` alongside a served or local viewer
to update its live status. The watcher hashes generation inputs without parsing
or regenerating maps. Status identifies the exact stored snapshot and expires
after ten seconds; a stopped watcher or a different generation cannot certify
the drawing as current. The graph and its matching source remain readable when
stale or when live freshness is unavailable. `--once` writes one status check.

Calls resolved to source outside the mapped roots, such as skill functions, are
green invocation boxes. Their argument/result wires are generated, their target
metadata gives the external source declaration, and their click opens the
matching caller invocation. They have no invented canonical map index. Unknown
targets and unknown argument origins remain distinct analysis limits.

Named nested functions may appear as function values as well as invocations.
Callable-value wires into a returned record do not execute the function.
Captured bindings use separate reference wires; mutable or untraced captures
retain origin and lifetime limits. Binding source spans remain in `--details`.
These relationships do not establish callback timing or disposal order.

`regenerate` explicitly rescans source. With no argument, or `0`, it refreshes
everything. With a region or page index it refreshes that region and updates
references affected by its changed addresses. A region inventory change,
removed declaration or old store schema can widen the refresh to the full map;
the result states the requested scope and reason. Unrefreshed source retains
its old fingerprint, so a scoped refresh cannot certify unrelated edits as
current. Every `regenerate` also redraws the viewer and reports `view`.

`build` draws the whole stored map for a person into `dev-map/view/`; open
`dev-map/view/index.html`, or serve that directory (the `generated-map`
configuration in `.claude/launch.json` serves it on port 8765). That one page is
the stable place to keep open: it is overwritten in place, never removed, and an
open viewer follows the same declaration when a new drawing changes its numeric
index. If the declaration was removed, it opens the nearest surviving parent. `build`
reads the store and never parses source into a new graph. It refuses only when there is no store; a store
behind the source is still drawn, with each page whose source has moved marked on
its own drawing, so the map stays readable while code is being changed. It needs
Python 3; set `PYTHON` if it is not `python`.
`check` is described under [Checking](#checking). `flow-evidence` re-derives one
page from source with its call sites and columns, for auditing the generator.
First onboarding generates a store when none exists. These are explicit
exceptions to ordinary stored reads, which only enumerate and hash inputs.

The store is `dev-map/store/`; both it and the viewer are ignored by Git.

## The walk

`0` → region `N` → file `N.F` → declaration `N.F.D` → `--code` → edit →
`regenerate [INDEX]` → read again. Every declaration belongs to its own file,
irrespective of which caller reaches it first. Flow pages can show contextual
groups and appearances of declarations from other files. Those appearances
retain the declaration's canonical address; a group opens its generated child
page and has its own durable group path.

Prefer the walk over text search when orienting. Search finds names; the walk
gives `calledFrom`, couplings, unresolved sites and flow uncertainty. These are
static evidence; do not infer absence of callers from an unsupported or
unscanned boundary.

Indexes are regenerated and may change. Use one for talking about a page — the
index and the name together, as in `6.3.1 planComposition` — and never write one
into a document, a comment or code. The declaration path is the durable name.

## What each page carries

Every page: `index`, `kind`, and `stale` when the source behind it has moved since
the store was written. The fields below describe the rich stored packet returned
by `--details`; the default response applies the compact conventions above.

- **`0` (root)** — `regions` (index, path, files, lines, nodes, entry points),
  `ports` (every way into the regions from outside them), `wires` between
  regions with their kinds and counts, `children`.
- **region** — `path`, `files`, `lines`, `nodes`, `components` (one per file,
  with its node and entry-point counts), `ports`,
  `wires` between the region's files, `children`.
- **file** — `file`, `region`, `lines`, `nodes`, `components` (the file's
  declarations),
  `ports` (other files, other regions, outside callers), `wires`, `children`.
- **node** (function, method, handler, class) — `path`, `file`, `line`,
  `endLine`, `lines`, `kind`, `inputs`, `outputs`, `components` (what it calls,
  in call order), `wires`, `gates`, `requires` (assertions it makes),
  `formulas`, `calledFrom`, `couplings`, `unresolved`, `external`, `uncertainty`
  where needed, and `leaf` when its destination is code.
- **operators** — source-derived choices and supported loop-carried values.
  Choices expose control, alternatives and the selected value. Iterations expose
  initial/current/next/final state, including the zero-iteration path, and
  distinguish an iterable collection from its current item. Wire
  `fromPort` and `toPort` identify those roles; member labels distinguish values
  such as `composed.state` from `composed.actions`. Direct parameter-callback
  invocations expose the callable and argument values, source location and
  optional-call gate. `targetUnknown` preserves the distinction between a
  known invocation and an unresolved implementation. Unsupported argument or
  returned-field origins remain explicit uncertainty.
  Verified local Map/array operations expose collection state and returned
  values separately. Counter updates distinguish prefix/postfix results from
  the next state; optional invocations preserve the skipped-update branch.
  Aliases, escaped or captured collections, unknown receivers and custom
  accumulator effects remain outside this supported local-state analysis.
- **group** — its authored membership and label, canonical member components,
  generated input/output boundary ports, wires and edge evidence. `structural`
  pages show calls/couplings; these must not be mistaken for execution order.
- **any node or file page** — `facts`, only when a row names it.

A single-span `--code` read answers with `file`, `range` and numbered `source`,
plus identity, provenance and edit-safety metadata. Region and group reads return
source spans in `sources`. `--details` retains `line`, `endLine` and `lines`.

## Staleness

Every read checks the recorded scan inventory and fingerprints: mapped source,
outside callers, generator modules, dependency lockfile, facts and grouping.
Changed, added or deleted inputs produce `stale` with the reason and regeneration
instruction. Freshness is deliberately conservative across the whole map:
incoming callers and receiver resolution can affect a page whose own file did
not change. The viewer marks stale pages. Reads never silently regenerate them.

Generation stores each mapped file's source once alongside its graph record.
CLI and viewer code reads use that matching snapshot, even when working files
have moved or been deleted. Scoped regeneration preserves unrefreshed snapshots.
`sourceKind` and `sourceSha256` identify the returned code. A legacy record with
no snapshot may use live source only when its hash matches; otherwise the code
read reports `sourceUnavailable` and requests regeneration. Old line numbers
are never applied to changed source.

## Flow grouping

Execution groups must not hide a path that leaves the group and later re-enters
it. Generation rejects that contraction because it would draw false feedback.
Keep those stages visible or reshape the code into an explicit stage first.

`flows.json` uses schema 1. Each flow names an existing region, file or
declaration page and lists groups with `id`, optional `label`, and `members`.
A member is a generated declaration path, or a file path selecting its
declarations for a region/file composition. Unlisted entities remain visible.

```json
{
  "schema": 1,
  "flows": [{
    "path": "core/path/compose.mjs::planOperationStart",
    "groups": [{
      "id": "temperature",
      "label": "temperaturePreparation",
      "members": [
        "core/path/planning.mjs::planPark",
        "core/path/planning.mjs::planNozzle"
      ]
    }]
  }]
}
```

Membership contracts existing generated relationships on the parent and exposes
their exact crossings as ports on the child. It cannot add wires, source nodes,
prose or unsupported fields. Missing members and duplicate membership fail
generation. A code edit that removes a referenced declaration therefore needs
the corresponding grouping edit. Choose groups for useful behavior, not an
arbitrary number of boxes. Necessary facts belong in the fact table once.

Groups can contain nested `groups` using the same schema. Child membership must
belong to its parent; all other members stay visible at that level. Group source
reads retain the original declaration spans. Configurations are merged from the
base file and sorted `dev-map/flows/*.json` fragments; duplicate page specifications
fail. Adding, changing or removing a fragment invalidates freshness. The retained
`../dev-map-OLD/comparison-path-groups.json` is historical comparison, outside active inputs.

Ordinary implementation edits only need regeneration. New declarations remain
visible until their grouping is reviewed. Rename, move, split or removal of a
referenced declaration requires updating its authored membership; missing
members fail generation. Review the conceptual boundaries when responsibilities
or data flow change, even if every membership still resolves. Edit code and
grouping together for one region, preserve behavior with relevant checks, then
inspect the generated parent and child pages before continuing to another region.
When code replaces an entity, rewire every consumer and remove the superseded
entity in the same migration. Compatibility wrappers and alternate old routes
are not an accepted outcome of this overhaul.

The reviewed `core/path/compose.mjs::planComposition` drawing on 2026-09-19
(six declaration components, 22 operators and 56 wires before further grouping)
is a rough upper reference for entity and semantic density, not a target to fill
or a universal numerical cap. Its private bookkeeping is a candidate for less
prominent display. Favor named stage boundaries and meaningful connections over
copying implementation into boxes. Current authored grouping selects declarations;
it cannot yet group arbitrary operators inside one declaration.

Conditions preserve all enclosing lexical gates. Unsupported branch/loop value
joins and uncertain callback or receiver sequencing are exposed as uncertainty,
rather than inventing a reaching value or execution order. Called functions stay
visible even when classified as simple formulas; purity does not determine
whether a stage matters to the flow. Recognized assertion calls are connected
gates with ordinary generated argument wires and distinct invocation identities.
Their condition caption opens the caller's predicate source; the body opens the
assertion implementation. Full predicates and error messages remain in source
and detailed `requires` evidence, without duplicate prose in the default map.

Small numeric accumulations and single-expression vector arithmetic open directly
as code. The classifier recognizes their syntax; it does not establish runtime
purity, receiver identity or callback timing. Their parent boxes, caller addresses
and analysis limits remain available. A numeric expression with mapped called
stages does not use this shortcut. Branches, searches and larger algorithms keep
their existing destination policy.

Class pages mark source-proven updates after construction as `stateful` and draw
shared named-field dependencies. These are state dependencies, not execution
ordering. Static and instance fields stay separate. Indirect receiver effects
and dynamic field names remain explicit analysis limits; a method call through
a stored object is not automatically certified as a field mutation or a pure read.
An assertion does not imply an invented success edge or prove exception ordering.
An external call alone is not evidence of purity.
The `external` count means call sites without mapped targets under scanner
rules; it does not mean user actions or calls across an application boundary.
It includes platform/library operations. Unresolved parameter calls are a
separate category. Event entry points and incoming callers retain their own
generated relationships where the scanner can identify them.

## External facts

[facts.tsv](facts.tsv) holds authored external facts, for
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

`node dev-map/cli.mjs check` exits non-zero when the store is missing, when
the store is stale (naming the index to regenerate), or when a fact row is
malformed. It reports the repository's `linked`, `unresolved` and `external`
totals, the `unreached` declarations, and any orphan facts. `--json` returns the
same as data.

## Scope

`dev-map/lib/scope.mjs` holds the whole authored scope: `mappedRoots` are
the top-level directories that become regions, and `outsideRoots` are scanned
only so the calls they make into the mapped roots are seen and appear as ports.
It also holds the serving aliases whose import specifier is not the path on
disk. Regions, files, entries, numbering and every box follow from the code.

## Tests

```sh
npm run test:maps
```
