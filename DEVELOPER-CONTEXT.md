# Developer context

## Orientation

The dev map is the account of core and Studio, generated from the source. There
is no parallel core/Studio manual hierarchy and nothing on a page is authored.
Walk it from `0`: `0` is the regions, `N` a region and its files, `N.F` a file
and its entry points, `N.F.E` a declaration with its callees, `calledFrom`,
couplings and `unresolved` count.

```sh
node scripts/agent-toolkit.mjs read-map 0
node scripts/agent-toolkit.mjs read-map studio
node scripts/agent-toolkit.mjs read-map studio/source.mjs
node scripts/agent-toolkit.mjs read-map studio/source.mjs::bindSource --code
node scripts/agent-toolkit.mjs regenerate 9
```

A read comes out of the stored map and never scans; `regenerate` is the only
scan. A page whose source has moved since the store was written says so in its
`stale` field. Indexes are regenerated and may change: say the index and the
name when talking about a page, and write the declaration path when something
must keep pointing at it. Reuse context already read. Prefer the walk over text
search when orienting: it is what shows who calls and consumes the code being
changed. The [map guide](maps/README.md) owns the commands, the page fields and
the external-fact rows; `node scripts/dev-map.mjs build` draws the same stored
map for a person.

Scope follows components, not roles. Makers operate existing tools and need no
dev maps. Builders changing skills use [skill authoring](skills/AUTHORING.md), the
selected skill's role manual and consumed API contracts; contract-only reads do
not require implementation maps. Builders changing or investigating core/Studio
walk the affected regions. Developers use the map for core/Studio and load maker
or skill context when their work needs it. Skills and
[client adapters](adapters/mcp/DEVELOP.md) retain separate implementation
references and remain visible as external callers into the map.

Repository policy, setup, contribution procedures, decisions and historical
evidence retain their existing owners. Onboarding supplies engineering policy;
it does not preload skill catalogs or every technical contract. Source remains
authoritative for implementation; software checks do not establish physical results.

## Status note

As of 9/17/2026 and likely until 10/1/2026, we are not yet at the development stage where we care about backwards compatibility with print bundles. Back compat should not be a design priority or significant consideration in any new code, and any cumbersome back compat extras that are noticed should be flagged for removal.