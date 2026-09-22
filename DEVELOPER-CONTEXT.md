# Developer context

## Orientation

This is the whole of a developer's orientation. The account of core and Studio
is the **dev map**: code entities and relationships are generated from source,
while authored grouping makes useful flow pages. There is no component prose
manual in the developer's orientation. The component manuals
under `core/` and `studio/` are maker and builder documentation; read one only
when a person asks about the behaviour it describes, never to find your way
around the code.

Walk the map from `0`. `0` is the regions and `N` a region; every map numbers
its own nodes under itself (`N.2`, then `N.2.1`, down to leaves). A declaration's
map shows its callees, callers, `couplings` and `unresolved` sites. A node drawn
away from its home map keeps its home index and names that map as `home`. Read a page, read its source with `--code`,
make the edit, `regenerate` the region, read again.

Reads use compact JSON: `range` is `[firstLine,lastLine]` inclusive; nested
locations inherit `file`; empty arrays are omitted. Caller relations appear once
in `callerReferences`, `callerWires`, or residual `calledFrom`. High-reuse
components show `callerSummary`: a count and the canonical index with the full
caller list. `--details`
returns the full stored evidence without scanning. `--code` omits the graph body.
Condition gates show a short identity and branch; their complete predicates live
under the source click and in `--details`, rather than on the drawing.

```sh
node scripts/agent-toolkit.mjs read-map 0
node scripts/agent-toolkit.mjs read-map studio
node scripts/agent-toolkit.mjs read-map studio/source-player.mjs
node scripts/agent-toolkit.mjs read-map studio/source-player.mjs --code
node scripts/agent-toolkit.mjs regenerate 9
```

A read comes out of the stored map and never parses source into a new graph;
`regenerate [INDEX]` explicitly scans. Reads check input fingerprints and expose
staleness; follow the returned regeneration instruction. The separate
`flow-evidence` command explicitly rescans for an audit, and first onboarding
generates a store when none exists. Indexes are
regenerated and may change: use the index when talking about the current map,
and write the **declaration path** (`file.mjs::name`) when something must
keep pointing at it. Reuse context already read.

**Text search for orientation is discouraged.** Searching finds names; the walk
is what shows who calls and consumes the code you are about to change.

Flow membership and group labels are authored in `dev-map/flows.json` and
`dev-map/flows/*.json`; nodes, wires,
conditions and boundary connections remain generated. Necessary external facts
are recorded with provenance in [dev-map/facts.tsv](dev-map/facts.tsv) and displayed on
their owning pages. `dev-map/lib/scope.mjs` holds the authored scan scope:
which roots are mapped and which are scanned only so
their calls into the mapped roots are seen. The [map guide](dev-map/README.md) owns
the commands and the fields each page carries; `node dev-map/cli.mjs build`
draws the same stored map for a person.

### Code shape

The map is only as good as the code's shape, so shape the code for it:

- Write graph-visible stages as functions of explicit inputs to named outputs.
  A stage does not mutate its caller's planning state. Local working arrays and
  internal mutation are allowed; expose the resulting state and actions at the
  boundary. Avoid copying an accumulated toolpath on every move.
- Keep owned caches and UI controllers behind explicit stateful boundaries.
  The Lua interpreter also retains its private variables, tables, scopes and
  call stack across execution steps. This approved runtime exception does not
  permit ordinary planning stages to mutate caller-owned inputs.
- Give conceptual handlers and stages code binding names so authored grouping
  survives line edits. Small implementation callbacks may remain anonymous;
  authored membership must not depend on their source-position identities.
- Separate uses of the same implementation remain distinct generated stage
  instances. Replacing an entity requires rewiring all consumers and removing
  the superseded entity; do not retain compatibility wrappers or parallel paths.
- Keep page context at its level: short caller references lead to surrounding
  maps, and source holds implementation detail. A dense page is an upper bound,
  not a goal; private bookkeeping should not dominate conceptual stages.
- Distinguish hidden coupling in code from unsupported extraction and scanner
  defects. Do not turn uncertainty into an invented wire or use an external fact
  to assert a code relationship the scanner has not established.

Review code and maps in small sections before applying an approach more widely.
Before proposing a page for human review, inspect both its drawing and its exact
default CLI read. Provide the verified current link and open that CLI response in
the person's sidebar when the client supports it.

### What keeps its own owner

Repository policy, setup, contribution procedures, decisions and historical
evidence retain their existing owners. Skills and
[client adapters](adapters/mcp/DEVELOP.md) are outside the mapped roots, keep
their own authoring references, and appear in the map as external callers.
[CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md) owns checkpoint and remote
contribution rules; read it only immediately before committing or publishing.
Source remains authoritative for implementation; software checks do not
establish physical results.

## Status note

As of 9/17/2026 and likely until 10/1/2026, we are not yet at the development stage where we care about backwards compatibility with print bundles. Back compat should not be a design priority or significant consideration in any new code, and any cumbersome back compat extras that are noticed should be flagged for removal.
