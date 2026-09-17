# Developer maps

Maps cover core and Studio. Start at `0_system`, then load the affected region
and inspect the source it names. Skill implementations and client adapters are
external callers. The viewer retains the approved PackIT layout.

From the repository root:

```sh
node scripts/dev-map.mjs build
node scripts/dev-map.mjs check
node scripts/agent-toolkit.mjs read-map 4a_offset
```

Install contributor dependencies with the normal `npm ci`.
Build uses Node and Python 3 and writes the self-contained viewer to
`dev-map/index.html`, individual SVGs and machine-readable context. Set `PYTHON`
if Python is not available as `python`. Generated `dev-map/` files are ignored;
rebuild after mapped code or region sources change. `read-map` is the only region
read: it resolves current source directly and needs no Python or prior viewer
build, and returns the requested page's owning region, its shared contracts,
source locations and calculated other-use indexes. `dev-map.mjs` only builds and
checks.

Region Markdown owns both agent context and the human rendering. A `saam-page`
block defines boxes, boundaries and wires. A box resolves to a child page (`>key`),
a JavaScript declaration (`@core/path.mjs::declaration`), or a shared component
(`$name`). A `saam-components` block gives each shared component one declaration,
input set, output set and semantic contract. The generator resolves declarations
through the JavaScript syntax tree and checks hierarchy, boundaries, references
and minimum page size. These checks do not establish semantic correctness;
authors must trace the behavior and preserve the declared contract.

Repeated declarations must use the same shared component. Every occurrence gets
calculated red references to all other mapped occurrences, including those on
the same page. Do not author these references. Different input/output contracts
require distinct components, usually distinct implementation declarations.

The layout and viewer are adapted from PackIT_dev's `flow_map/leveled.py` and
`flow_map/viewer.py`. The main visual adaptation is the downward red arrow and
other-use indexes. Keep labels short and split dense regions into meaningful
submaps; pages with fewer than three operation/state nodes are rejected.

## Editing a region

Keep addresses stable. Use `node scripts/dev-map.mjs check` after changing map
sources or mapped declarations, and rebuild the viewer before presenting it.
Trace changed calls and data paths in code; passing checks does not prove them.
Review every calculated shared-use reference and search for callers beyond the
mapped boundary. Add prose only for the numerical assumptions, limits or other
context the graph cannot convey. The Doc button uses that same prose.

Minimal syntax (identifiers are local to the page):

```text
box localId | 4.1.2 | short operation | @core/path.mjs::namedDeclaration
box anotherId | 4.1.3 | shared operation | $componentId
box childId | 4.2 | child operation | >child_page_key
port inputId | input label
localId > anotherId | what crosses | data
anotherId > childId | condition | gate
```

Use `io` for user/side-effect interactions and append `| norank` for a return
wire that must not determine forward layout. Declare a child page's `parent`,
`in` and `out` to match its parent-box wires exactly, then provide matching
boundary ports. Map keys contain letters, digits and underscores; operation
addresses contain dot-separated numbers. `ext` marks a caller outside that
page. A `saam-components` row is
`identity | @declaration | full inputs | full outputs | semantic constraints`.
All occurrences of a repeated declaration must use that identity. The invariant
includes units, frames, errors, mutation and ordering; values may differ.

Builder onboarding adds region maps for selected core/Studio `--area` values;
developer onboarding also supplies `0_system`. A `read-map` request for any
child returns its whole owning region once, with calculated references and
shared contracts. Follow another region only when its use is relevant to the
change. Maker workflow and individual skill role manuals remain selective reads.
