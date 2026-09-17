# Developer context

## Orientation

Dev maps are the technical reference for core and Studio: responsibilities,
contracts, algorithms, state/protocols, source and verification. Start with
`0_system`, then read the affected page and the contract sections it lists.
There is no parallel core/Studio manual hierarchy. The old manual paths are
compatibility routes to map-owned reference text.

```sh
node scripts/agent-toolkit.mjs read-map 0_system
node scripts/agent-toolkit.mjs read-map 7b_source
node scripts/agent-toolkit.mjs read-map 7_studio --section studio-protocols#source-session-and-stale-replies
node scripts/agent-toolkit.mjs read-map 7_studio --node 7.4.1 --evidence
node scripts/agent-toolkit.mjs read-map 3_geometry --inventory
```

A normal read returns one page, concise region context, shared component contracts,
calculated other-use addresses and the map-owned reference index. Select a contract
or heading with `--section`; this returns only that contract text. Use `--evidence`
for detailed relationships/callers and `--inventory` for owned source, native code,
page assets and verification resources. Reuse context already read.

Each region's `responsibilities` index maps exact production files to change
contracts: invariants, failures/limits, coupled changes and verification. The
containment view links the same contract for each file, including native code.
New implementation files cannot pass the map check through directory ownership
alone. Follow the system map's change routes, then inspect the linked source and
tests for the particular edit.

The system map provides the region index and verification routes. Build the
[human viewer](dev-map/index.html) with `node scripts/dev-map.mjs build`; its
maps, reference pages, code and containment use the same model as agent reads.
The [map guide](maps/README.md) owns authoring and maintenance commands.

Scope follows components, not roles. Makers operate existing tools and need no
dev maps. Builders changing skills use [skill authoring](skills/AUTHORING.md), the
selected skill's role manual and consumed API contracts; contract-only reads do
not require implementation maps. Builders changing or investigating core/Studio
use the affected maps. Developers use maps for core/Studio and load maker or skill
context when their work needs it. Skills and [client adapters](adapters/mcp/DEVELOP.md)
retain separate implementation references and remain visible as external callers.

Repository policy, setup, contribution procedures, decisions and historical
evidence retain their existing owners. Onboarding supplies engineering policy;
it does not preload skill catalogs or every technical contract. Source remains
authoritative for implementation; software checks do not establish physical results.
