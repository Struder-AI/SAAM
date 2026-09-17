# Developer maps

Maps own the complete technical reference for core and Studio. Start at
`0_system`, then load the affected page, its contract sections and the source it
names. Skill implementations and client adapters have separate references and
appear as external callers. The viewer retains the approved PackIT layout.

From the repository root:

```sh
node scripts/dev-map.mjs build
node scripts/dev-map.mjs check
node scripts/dev-map.mjs check --since HEAD
node scripts/dev-map.mjs check --built
node scripts/agent-toolkit.mjs read-map 4a_offset
node scripts/agent-toolkit.mjs read-map 4_regions --section regions#shared-offset-functions
node scripts/agent-toolkit.mjs read-map 7_studio --node 7.4.1 --evidence
node scripts/agent-toolkit.mjs read-map 3_geometry --inventory
```

Install contributor dependencies with the normal `npm ci`.
Build uses Node and Python 3 and writes the self-contained viewer to
`dev-map/index.html`, individual SVGs and machine-readable context. Set `PYTHON`
if Python is not available as `python`. Generated `dev-map/` files are ignored;
rebuild after mapped code or region sources change. `read-map` is the only region
read: it resolves current source directly and needs no Python or prior viewer
build, and returns one requested page, concise region context, its contract
index, source locations and calculated other-use indexes. `--section ID#heading`
returns only the selected map-owned contract; skill builders can consume it
without an implementation map. `--node` selects one component; `--inventory`
includes owned files and declaration counts; `--evidence` includes detailed
relationship and caller evidence. `dev-map.mjs` only builds and
checks.

Region Markdown owns deliberate grouping, hierarchy, labels, boundary contracts and
supporting context. Parsed JavaScript supplies declarations and internal
relationships to the single model consumed by the viewer and agent reads. A
`saam-page` block declares components and semantic claims. A box resolves to a child page (`>key`),
a JavaScript declaration (`@core/path.mjs::declaration`), or a shared component
(`$name`). A `saam-components` block gives each shared component one declaration,
input set, output set and semantic contract. The generator resolves declarations
through the JavaScript syntax tree and checks hierarchy, boundaries, references
and minimum page size. These checks do not establish semantic correctness;
authors must trace the behavior and preserve the declared contract.

## Contract and resource ownership

Each technical reference has one authored source under `maps/reference/`, declared
by its owning region. `saam-references` rows contain `id | repository path | purpose`.
The reader indexes headings automatically. Viewer reference pages and contract-only
agent reads consume exactly this text; old component manuals contain redirects and
heading links, never a second copy. Shared callers use the same contract.

`saam-scope` rows contain `repository path | responsibility`. A trailing slash
owns a directory recursively; a more specific rule overrides it. Every core/Studio
file needs a maintenance owner. This includes native code, HTML/CSS, data and tests.
Ownership is distinct from direct, enclosed or unrepresented declaration coverage:
assigning a directory does not explain a newly added responsibility.

Every production implementation file also needs an explicit `saam-responsibilities`
row in its owning region:

```text
id | exact/file.mjs, another/file.cpp | reference-id#section | core/tests/owning.test.mjs
```

The section must link every named source and test, and describe **Contract.**
(responsibility, state, inputs/outputs and invariants), **Failures.**, **Change together.**
(consumers and coupled changes), and **Verification.** (scenarios and existing checks).
Group files that implement one coherent responsibility; never use a directory
wildcard to claim a new file is explained. All production implementation files,
including native sources, are checked for exactly one responsibility. Adding a file
without a contract, removing a linked source/test/section, or assigning a file to the
wrong region fails the map check. These structural checks cannot judge the truth
of prose: review changed behavior against its contract and update both together.
The agent packet indexes these sections and Code containment links each file
directly to its change contract, independently of declaration coverage.

Code containment states the expectation for each file separately from its coverage.
Core/Studio implementation requires map representation, including native code that
the declaration extractor cannot analyze. Helpers may sit inside a mapped operation;
ownership alone never satisfies the requirement. Assets, build inputs and documents
need an owning reference, and tests/fixtures serve as verification evidence; neither
needs a production implementation box. Skill and adapter files are listed separately
as outside scope, linked to their own guidance and excluded from missing-map counts.
The same expectations are returned by `read-map 0_system --inventory`.
The view orders required unassessed files and representation gaps first, then
directly mapped/enclosed implementation, supporting references, verification
files, and finally out-of-scope components. Files sort by path within each group.

Use fenced blocks named `saam-references`, `saam-scope` and
`saam-responsibilities` for these rows.
References may link to other map-owned contracts, implementation, verification,
skill/adapter interfaces and repository policy/history. Core/Studio development
must not require an undiscoverable technical manual elsewhere.

Repeated declarations must use the same shared component. Every occurrence gets
calculated red references to all other mapped occurrences, including those on
the same page. Do not author these references. Different input/output contracts
require distinct components, usually distinct implementation declarations.

The layout and viewer are adapted from PackIT_dev's `flow_map/leveled.py` and
`flow_map/viewer.py`. The main visual adaptation is the downward red arrow and
other-use indexes. Keep labels short and split dense regions into meaningful
submaps; pages with fewer than three operation/state nodes are rejected.

## Editing a region

Keep addresses stable. Follow the change-focused maintenance procedure in
[Keeping maps current](../BUILDERS.md#keeping-maps-current). Flow-map grouping
stays curated; mechanically reproducing all code declarations as boxes would
reduce readability without establishing their semantic boundaries. Generated
containment and change reports cover the inventory work instead.

`check --since REF` compares the current working tree (including untracked files)
with that commit, reports added/removed/modified named callable declarations and
mapped state, and identifies changed authored regions. It shows direct mapped
uses and enclosing map nodes, and calls out module-level/callback review separately.
Changed implementation also carries its direct change-contract read command,
including native sources in the resource-change list.
Use the task's starting commit, or HEAD when all changes remain uncommitted.
AST comparison ignores comments and formatting but retains behavior-sensitive
syntax such as automatic semicolon insertion. `--json` supplies structured output.
This is a review list, not a semantic certificate or an approval baseline. A missing
mapped anchor still fails the existing structural check immediately.

The viewer's **Code containment** entry is generated for every scanned core/Studio
module, including modules without any boxes. Expand a file and its direct,
enclosed or unrepresented group to see declarations, locations and links to mapped
uses. The full inventory is also in `containment.json`; region reads carry per-file
counts on `--inventory`, with all core/Studio files available from the system region. No extra map
authorship is required for this view. Callable counts are separate from all
declarations, and enclosed code is never counted as directly explained.

`build` records hashes of scanned source, region Markdown, generator/renderer and
dependency manifests, plus every delivered output. It skips rendering only when
all inputs and outputs match. `build --force` regenerates explicitly;
`check --built` exits unsuccessfully for stale, missing or altered artifacts.
Inputs changing during a build prevent a fresh manifest being recorded. This
checks the saved files, not an already-open browser snapshot; refresh after rebuild.
No tracked approval ledger or per-component snapshot tests are needed.

Review affected shared-use references and discovered callers. Add prose only for
numerical assumptions, limits, deliberate scope choices or other context the graph
cannot convey. The Doc button uses that same prose. Extend generator tests for a
new extraction/projection rule or a concrete regression, not for routine map boxes.

Minimal syntax (identifiers are local to the page):

```text
box localId | 4.1.2 | short operation | @core/path.mjs::namedDeclaration
box anotherId | 4.1.3 | shared operation | $componentId
box childId | 4.2 | child operation | >child_page_key
port inputId | input label
localId > anotherId | what crosses | data
anotherId > childId | condition | gate
```

An arrow touching a `port` or `ext` is an authored boundary contract. An arrow
between internal components is a semantic claim, retained in the Doc view and
agent context; it does **not** create a displayed wire. Code extraction creates
internal wires, including relationships absent from the region file. Removing
a call removes its generated wire even if an old semantic claim remains.
Use `io` for authored user/side-effect interactions and append `| norank` for an
authored return boundary that must not determine forward layout. Declare a child page's `parent`,
`in` and `out` to match its parent-box wires exactly, then provide matching
boundary ports. Map keys contain letters, digits and underscores; operation
addresses contain dot-separated numbers. `ext` marks a caller outside that
page. A `saam-components` row is
`identity | @declaration | full inputs | full outputs | semantic constraints`.
All occurrences of a repeated declaration must use that identity. The invariant
includes units, frames, errors, mutation and ordering; values may differ.

Builder onboarding adds region maps for selected core/Studio `--area` values;
developer onboarding also supplies `0_system`. A `read-map` request for any
child returns that page, with region navigation, calculated references and
shared contracts. Follow another page or region only when its use is relevant to the
change. Maker workflow and individual skill role manuals remain selective reads.

## Code generation and evidence

`loadModel()` extracts the current repository graph and projects it onto every
page. The renderer, toolkit `read-map`, and developer/area onboarding all consume
this generated model. There is no report-only or authored-wiring fallback.
`build` also writes `dev-map/graph.json` and `dev-map/coverage.json`; these retain
source hashes, declaration spans, call sites, resolution steps, complete paths,
all unresolved sites and the coverage inventory. `context.json` holds the same
concise page packets returned by the toolkit, for every page. No previous build is needed for
agent reads; a changed source is parsed on the next read or rebuild.

The Acorn extractor resolves lexical bindings, immutable aliases, imports and
named re-exports, finite literal-object dispatch, returned object choices, and
local class methods (`new` and lexical `this`). The output registry's adapter
choices therefore generate possible calls into each supported implementation.
Choices on the same returned registry object retain selection identity so value
flow does not connect one dialect's writer to another dialect's reader.

Relationships distinguish calls, construction, assigned/returned call results,
direct argument value flow, lexical state writes/reads and possible worker
delivery. The Studio source page includes the worker handler and retained program
storage: decode writes that storage and bind reads it. Worker delivery resolves
literal `/studio/` Worker URLs passed into known session functions, in both
directions. It does not establish message-type selection, successful replies,
request-ID correlation or timing. Native-thread worker construction remains an
explicit unresolved analysis case.

Projection chooses the nearest containing mapped declaration (or a child page's
members) and follows at most six call/handoff steps through unrepresented helpers,
stopping at the next mapped component. It does not compose returns or argument
flow into an invented taint or sequence proof. Connections sharing endpoints are
drawn once with their relationship kinds; complete derivation paths stay in the
model and evidence artifacts. Enclosure of a factory does not mean all its
behavior has been explained. Diagram layout and the existing Doc/code interactions
remain the approved PackIT adaptation.

The Doc view and agent packet identify authored claims, unsupported or unresolved
relationships, isolated components and unresolved-call groups with sample sites.
A claim with endpoint evidence still needs semantic review: the call graph does
not verify a payload label, condition, precondition or execution order. Isolated
components remain visible with `links unresolved`; lack of a resolved wire does
not disprove their behavior. Full unresolved lists are in the evidence artifacts.

Inventory separates directly represented, merely enclosed and unrepresented
code, with callable counts reported separately. Extraction scans `.mjs` under
core, Studio, skills and adapters; only core/Studio enter map coverage. Skills and
adapters contribute caller evidence without mapped internals. Tests, node_modules,
.local, native and non-.mjs source are excluded from declaration extraction;
the owned-resource inventory still includes tests, native source and browser assets.
Every shared use retains all other
calculated indexes, including same-page occurrences. Discovered callers lacking
a direct map node are reported separately, never assigned invented indexes.
Semantic equivalence remains an authored full I/O contract, not a symbol match.

Limits remain explicit: arbitrary mutable-object dispatch, escaped mutations,
callback protocols, inheritance, export-star, dynamic imports and external APIs
are not fully resolved. Lexical state dependencies are not reaching-definition
analysis. No control sequence is inferred from sibling call order. The explicit
Studio deployment alias is a serving fact, not a guessed module path. Projection
is bounded; native workers and request/response correlation need further analysis.

`node scripts/dev-map-evidence.mjs [--out DIRECTORY]` writes a supporting evidence
report from the **same generated model**. It is not another region reader or a
separate authority for map connections. The containment/report categories were
informed by PackIT's instruments; resolution uses parsed scopes rather than
name-mention heuristics.

Focused checks:

```sh
node --test core/tests/dev-map.test.mjs core/tests/dev-map-evidence.test.mjs core/tests/dev-map-generation.test.mjs core/tests/dev-map-maintenance.test.mjs core/tests/dev-map-reference.test.mjs
```

The integration fixture changes only code and verifies changed SVG wiring and
agent region relationships, while stale authored claims stay visible. Repository
checks exercise all pages, real toolkit CLI reads, registry dispatch, worker
state, calculated duplicate references and unresolved evidence.
