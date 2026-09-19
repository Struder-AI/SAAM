# Developer context

## Orientation

This is the whole of a developer's orientation. The account of core and Studio
is the **dev map**, generated from the source: nothing on a page is authored,
and there is no prose manual in the developer's reading. The component manuals
under `core/` and `studio/` are maker and builder documentation; read one only
when a person asks about the behaviour it describes, never to find your way
around the code.

Walk the map from `0`. `0` is the regions, `N` a region and its files, `N.F` a
file and its entry points, `N.F.E` a declaration with its callees, `calledFrom`,
`couplings` and `unresolved` count. Read a page, read its source with `--code`,
make the edit, `regenerate` the region, read again.

```sh
node scripts/agent-toolkit.mjs read-map 0
node scripts/agent-toolkit.mjs read-map studio
node scripts/agent-toolkit.mjs read-map studio/source.mjs
node scripts/agent-toolkit.mjs read-map studio/source.mjs::bindSource --code
node scripts/agent-toolkit.mjs regenerate 9
```

A read comes out of the stored map and never scans; `regenerate [INDEX]` is the
only scan. A page whose source has moved since the store was written says so in
its `stale` field, naming the files and the index to regenerate. Indexes are
regenerated and may change: say the index and the name when talking about a
page, and write the **declaration path** (`file.mjs::name`) when something must
keep pointing at it. Reuse context already read.

**Text search for orientation is discouraged.** Searching finds names; the walk
is what shows who calls and consumes the code you are about to change.

External facts — versions, licences, hardware observations, anything the scanner
cannot see in the source — are rows in [maps/facts.tsv](maps/facts.tsv), the one
place authored content enters the map. `scripts/dev-map/scope.mjs` holds the
whole authored scan scope: which roots are mapped and which are scanned only so
their calls into the mapped roots are seen. The [map guide](maps/README.md) owns
the commands and the fields each page carries; `node scripts/dev-map.mjs build`
draws the same stored map for a person.

### Code shape

The map is only as good as the code's shape, so shape the code for it:

- Write functions of inputs to outputs. No mutable state crosses a function
  boundary.
- Name handlers and stages, so each becomes a node on a page instead of an
  anonymous body inside one.
- A coupling the scanner cannot see is a finding about the code, not a gap in
  the map. Fix the code, or record the fact in `facts.tsv` and say why.

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
