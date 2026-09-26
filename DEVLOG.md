# Development log

## 2026-09-25 — Dev maps: state links drawn, holders followed (orange 2041 → 649)

- Owner direction: a finding that knows what to draw is drawn. Owned state is
  now a map link (`state`): a read links from the owner, a write (including
  through a member, `report.rows=…`, `this.rows.push(…)`) into it. A capture
  or write whose binding those links name is no longer missing. All 212
  cross-leaf captures and ~150 writes were already named by leaf state.
- `nested-receiver-effect` gets a real ownership (`global` for a name the
  file never binds, such as `Math`; `local`, `parameter`, `outer`) and
  `reads` for non-mutating methods; `Object.assign` and kin take their first
  argument's. 220 false effects gone.
- New `holders.mjs`: a member call no value names is settled by following
  every mapped holder of that member (object literal or class instance)
  forward, flow-insensitively, through bindings, imports, parameters,
  returns, property keys and collection elements; functions are followed as
  values to find their callers. A reached receiver draws a possible link
  (`holder-reach`), an unreached one is the platform's
  (`no-holder-reaches-receiver`), and an escaped holder leaves the call
  unresolved. `moveStore`'s Proxy made `map`/`every`/`some` ambiguous
  everywhere; its real uses (`range`, `value`, `findLast`, `reader`,
  `snapshot`) now link to it. 874 → 75; the remaining escapes are through a
  registered subscriber and a parameter callback, both orange kinds of their
  own. 34 object members proved called from outside became leaves.

## 2026-09-25 — Dev maps: missing findings in two colours; module code reported

- Owner direction: a missing finding is either code outside every leaf (red,
  `missing: code`) or a relationship between leaves no link draws (orange,
  `missing: link`); every other kind must earn its place. `findings.mjs` tags
  each row once; boxes say `N outside every leaf` / `N unlinked` in colour,
  lists are coloured and headed by class, the legend names both.
- New `module-code` rows on `0`: top-level code that runs at load (not a
  declaration or constant data) or holds a callable no leaf draws. It was
  invisible before: 74 rows (main guards, `app.mjs` wiring, module-level
  `new Map()` state, computed constants).
- Baseline to take to zero: 74 red, 2041 orange (874
  `member-receiver-unresolved`, 220 `nested-receiver-effect` of unknown
  ownership, 212 `closure-capture`, 199 `member-mutation` on a receiver, …).
  Viewer coverage has no findings gap.

## 2026-09-25 — Dev maps: second solve, labels follow every stage, title pass

- Solve from the stage-80 tree under the weighted-up minimum (5.911): stopped
  at stage 90 on the owner's word at 1.061 with 133 clusters, depth median 6
  max 9, cluster boxes mean 9.6 (2 outside 6–20), cluster edge mean 5.9 max
  12. `0` homes 5: two clusters of 449 and 489 leaves and three stray leaves
  that meet the minimum. Splitting a giant raises `0`'s hubs (2.4 → 20–137),
  because the mean counts its external boxes, mostly 1–2 wires; a mean over
  the map's own boxes makes the split downhill (5.343 → 5.295). Open for the
  owner.
- Owner direction: labels carry every stage. The solver carries labels from
  the previous stage's labelled tree onto each stage's best, taking up
  `tree.json` whenever it was changed from outside, so a title authored while
  a solve runs survives (checked: authored at stage 0, on the same cluster at
  the stage-10 write). Maps regenerate at every checkpoint (local note).
- Title pass on the stage-90 tree: all 133 clusters titled from their homes,
  deepest first; 44 hold unrelated code and are marked `(mixed)`, most of them
  mixing Studio handlers or shared helpers into geometry or planning.
- Owner direction: a box whose code is in no single source file draws no
  location line: clusters lose `@cluster/ID`, and an external box grouping
  externals from several files loses its list (one external, or several in
  one file, keeps it). Checked on `1.3`.

## 2026-09-25 — Dev maps: edge and hubs; the size minimum weighted up

- Owner direction: every map's edge counts against it: 0.01 × (boundary boxes +
  external boxes)², no allowance. `drawMap` names each crossing link's boundary
  box (the box on the nearest shared map holding its other end); store,
  scorer and solver share it. Interface is dropped: counted in leaves it grew
  with cluster size and charged for gathering the leaves an external touches.
- Owner direction: link balance. Hubs: 0.1 × the square of each drawn box's
  wires beyond 3 more than the map's mean (0.4 at 5 above, 4.9 at 10).
- Solver: a move also rescores the maps whose edge it changes (the other
  end's chain below where the moved node's chains meet, and the maps inside a
  moved cluster). 1700 random moves matched a full rescore exactly; about 5 ms
  a move. The best tree is written to `tree.json` every tenth stage.
- Solve from the 1b532c5 tree (74.54): stage 80 at 1.88, 238 clusters, 83
  repeats, depth median 7 max 12, cluster edge mean 5.6 max 12 (was 10 and
  75), `0` 2 homes and 8 external boxes (was 118 and 129). Stopped there: the
  6-box minimum cost `0` 0.4 and 135 clusters sat below it.
- Owner direction: the minimum weighs 1 per squared box short of 6 (the
  maximum stays 0.025 beyond 20). The stage-80 tree scores 5.911 under it,
  size 4.133 of that. Rescoring a written tree shifts backflow slightly
  (74.54 → 74.43 at the start), since flow-order ties go by cluster id and
  labels carried across a write rename clusters.
- Docs: map guide 211→211, DEVELOPER-CONTEXT 216→216 (edge defined with the
  boundary box).

## 2026-09-25 — Dev maps: squared parts, summed energy, size on non-externals

- Owner direction: the energy is a sum with a fixed denominator (weighted map
  scores per leaf), so a new map no longer lowers it by dilution; under the
  mean, a zero-score five-leaf cluster was worth as much as a box off `0`
  (0.0006), and 327 maps scored 0 while 230 clusters homed one node. Every
  part is squared, each weight the old one over the excess where the square
  equals it: size 0.025 (k 4), interface 0.025 (k 4), islands 0.2 (k 1),
  backflow 0.05 (k 2), balance 2 (share 0.5).
- Owner direction: the 6–20 size range applies to homes and repeats; external
  boxes do not count toward it. Externals are to always count against a map
  (the edge term, pending the owner's decision with the link-count term).
- The 1b532c5 tree scores 8.727 under it; `0` scores 730 (size 240, backflow
  490) and carries 8.44 of it. No solve run. Viewer bar shows external boxes.
- Docs: map guide 211→211, DEVELOPER-CONTEXT 216→216.

## 2026-09-25 — Dev maps: externals drawn as boxes

- Owner direction: every external is shown from `0`, in place of the way-in
  ports and outside-call arrows ("hair"). Externals (`leaves.mjs`): each
  active outside declaration linked to a leaf, the browser (DOM events) and
  module load; 220, from 642 links. On any map, externals linked to what it
  nests are drawn, and those it cannot tell apart (same boxes, same
  directions) share one box, labelled by their outside roots. External boxes
  count toward size, islands, backflow and interface.
- Solve from the weighted tree (5.5 min): 0.539 → 0.340, 554 clusters, 1836
  repeats. `0` homes 118 boxes and draws 129 external boxes (247 in all);
  leaf depth median 4, max 12. `0` did not shrink: under the log weighting it
  carries about 0.7% of the energy, so each box there is worth 0.0007 while
  small near-perfect clusters multiply (359 → 554). Leaf-count weighting is
  proposed to the owner.
- The solve reports the tree's shape each stage. A broad `taskkill` of
  `node.exe` was run while restarting the solver; it appears to have matched
  nothing, but other node processes may have been stopped at 20:30.

## 2026-09-25 — Dev maps: maps show only missing findings; weighted energy

- Owner review of the third solve: coherent, followable, better than the
  authored maps; checkpointed on `codex/remettub-dev-branch` (fast-forward
  from 9d1be57 to 741eb60).
- Owner direction: a map shows a finding only when it may hide something no
  leaf or link stands for (code outside every leaf, or a relationship between
  leaves no link draws); one about a precise aspect of what is drawn stays in
  the leaf's read. `lib/findings.mjs` decides: every unresolved call,
  `callable-origin` and its arguments, escapes, writes to objects a leaf does
  not own, and closure captures shared with another leaf. The scanner now
  marks `member-mutation` `ownership` (local, parameter, outer, receiver).
  Maps carry 2040 of 10,808 rows; leaf reads keep all. The map guide's
  finding classes are re-sorted to match (missing = on maps).
- Owner direction: less falls to `0`. The energy weights each map by
  1 + log₂ of its nested leaves (`0` weighs 10.9, a five-leaf cluster 3.3).
  The third solve's tree scores 0.576 under it. Fourth solve (5 min, from
  it): 0.576 → 0.350, 359 clusters, 1267 repeats; `0` homes 97 boxes (96
  clusters, was 194), leaves mostly at depth 3 (137 at 2, 512 at 3, 186 at 4,
  105 deeper).
- Checks: regenerate; `read-map` of `0`, a cluster, a leaf, `--code` and
  `--details`. Docs: DEVELOPER-CONTEXT 218→212, map guide 225→211 over the
  session.

## 2026-09-25 — Dev maps: the solver authors the whole tree

- Owner direction: the maps are leaves, clusters and `0`. Every scoped
  declaration is drawn by exactly one leaf, which opens as its code block;
  call maps and the map-or-code rule are gone. The cluster solver authors
  every cluster, home and repeat; the goal is the mean map score. Labels are
  authored only in a label pass and carried across solves by leaf overlap
  (more than half, Jaccard), else `[needs label]`.
- Leaves (`lib/leaves.mjs`, was `entries.mjs`; entry points and stranded
  gone): an inner declaration folds into its outer leaf unless code outside
  the outer calls or links to it, or outside code calls it. 504 of 660 fold;
  156 stay leaves (factory methods and returned closures called elsewhere);
  941 leaves, 3208 links between them.
- `lib/tree.mjs`: `tree.json` placed in full (an unmentioned leaf goes where
  most of its links are, else `0`; unknown names dropped), the two rules
  enforced (a cluster homes a node and draws two boxes; no repeat on its
  home or inside the cluster it repeats), numbering by each map's flow order,
  and `drawMap`, shared by generation, scoring and the solver. Composition
  and `flows/` removed; `tree.json` bootstrapped from the af5cc42 tree (each
  call map a cluster holding its leaf, authored clusters kept with labels).
- `score.mjs`: maps are `0` and clusters; crossing counts a link whose other
  end no box on the map holds, so a repeat keeps a link on the map; energy is
  the mean. `solve.mjs`: annealing with undo and rescoring of only the maps a
  move reaches; `node dev-map/cli.mjs solve` writes `tree.json` and
  regenerates.
- First solve (17 min): mean 1.037 → 0.177 by dumping leaves into two
  clusters of 488 and 283 boxes, since size badness was capped at 1. Owner
  direction: size is 0.1 per box outside 6–16, uncapped. Flow order now uses
  heaps (7 ms for 900 boxes). Current-state baseline under it: 0.859.
- Second solve (11 min, from the current-state tree): 0.859 → 0.249, 93
  clusters (11 kept labels), 186 repeats, every map 6–16 boxes (mean parts:
  crossing 0.158, backflow 0.077, islands 0.014, size 0). But the tree is a
  chain 70 deep: each map homes about five leaves and one cluster holding all
  the rest, and repeats fill it to 16. Nothing in the score resists depth or
  one box holding nearly everything; open for the owner.
- Owner direction: a new goal. Crossing is reported, not scored; every part
  is a count times a weight: size 0.1 per box outside 6–16, interface 0.1 per
  nested leaf beyond four reached from outside and per one beyond four
  linking out, 0.2 per extra island, 0.1 per backward pair, and balance (the
  biggest home box's share beyond an even share). Authored tree 0.833, chain
  14.84 under it. Third solve (7.5 min, from the authored tree): 0.833 →
  0.235, 231 clusters, 749 repeats, leaves at depth 2–3 (clusters to depth
  5), no chain. But `0` homes 194 boxes (136 clusters) and scores 31.2: the
  mean lets one bad map stand for many good ones. No authored label survived
  (29 carried were unlabelled).
- Viewer, on the owner's request: a leaf opens its source alone (the context
  panel, its sidecars and its `check --viewer` coverage removed); the index
  lists `0` and clusters only; a Minimap button folds the minimap (kept
  across reloads); opening a map closes an open leaf's code.
- Docs: glossary and The tree rewritten (DEVELOPER-CONTEXT 218→213), map guide
  225→218, toolkit README and onboarding hint. Checks: regenerate, `check`,
  `read-map` on a cluster and a folded declaration, viewer on `0` and a
  cluster. `check --viewer` gaps: ports on the largest maps, and the new
  `leaves`/`cluster` fields.

## 2026-09-24 — Dev maps: no regions; nothing comes from files

- Owner direction: no region maps; nothing in the maps comes from files. The
  top map `0` draws the entry points of all mapped code (top-level
  declarations no mapped code calls), ordered by how much each reaches; every
  mapped call nests, with no directory edge. `lib/regions.mjs` became
  `lib/entries.mjs`; internal addresses are plain numbers, not
  region.file.declaration.
- Scoped regeneration is gone: `regenerate` always does everything (~1 min).
  Module-level findings sit on `0`; module-only files are no boxes. The two
  file-level facts now name `filaments.mjs::validateBambuConnections`.
- Region clusters merged into one flow on `0` (`flows/top.json`, 17 clusters);
  57 memberships dropped because those declarations now nest under a caller.
  Empty region flow files removed.
- Result: 99 entry points (146 region roots before), 1445 declarations, 0
  stranded, 0 unplaced, 0 orphan facts; 655 maps, energy 868.58 (899.34).
  The solver model reproduces all 655 map scores. Viewer checked on `0`.
- Docs: map guide 232→225 lines, DEVELOPER-CONTEXT 220→218 (Region removed from
  the glossary, entry point and the tree redefined), toolkit README 264→263,
  BUILDERS 410→410.

## 2026-09-24 — Dev maps: cluster solver (first run)

- `dev-map/lib/solve.mjs`: a model of every site (a region or a node whose view
  is a map) as units a cluster can take, each carrying the chain its leaf
  draws. It reproduces every stored map's score exactly (670 of 670 plus the top
  map). A compiled scorer scores proposals by lookups. `solveTree` anneals the
  whole tree's energy with one temperature and random moves across all sites,
  and stops when a stage freezes.
- `score.mjs`: `scoreMap` scores any drawing (`covers`, `inside`); counting and
  rating are split (`rateMap`); backflow ties go by index, so list order doesn't
  change a score (energy 899.23 → 899.34).
- Owner direction: the score judges cluster quality, so generation no longer
  refuses a non-convex or one-box cluster (`composition.mjs`, map guide).
- First solve: 84 s, froze at stage 29, energy 897.8 → 830.9 by dissolving
  every cluster. Under this energy every cluster is a net cost: flattening the
  nine clustered sites takes them from 76.2 to 9.3, because size is capped at 1
  and each cluster map adds its own crossing. The energy needs the owner's
  decision before any flows are written. Flows unchanged.

## 2026-09-24 — Tour manual condensed

- `examples/prints/README.md` went from 12,797 to 8,778 characters. The
  maker-agent participation section, which `start-tour` returns, went from
  7,560 to 4,129: scope, Studio leads, requests and listener, playback start
  layer, chat lesson and completion. Repeated rules (Studio leads, no geometry
  suggestions, send before waiting, completion in chat) now appear once.
- Studio visual and completion behaviour (slate-blue highlights, blinking,
  arrows, file naming, final download and Exit tour) moved out of the agent
  section into a new "Tour presentation" subsection. The lesson table and intro
  were condensed.
- Tour agent context (MAKERS plus participation) is 14,800 serialized
  characters. `check-repo` links pass.

## 2026-09-24 — Dev maps: score in the viewer bar

- User asked for each map's score and breakdown on the map itself. The viewer
  model carries every map's score (`scoreMaps`), and the bar shows it on its
  own row as penalties: "Score -2.74 · size -0.80 (2 nodes) · crossing -0.94
  (16 of 17 links leave) · islands -1.00 (2 islands) · backflow 0 (0 of 0
  backward)", nonzero parts in red. `scores.html` uses the same sign.
- Checked in the viewer on 2.2, 4.2 and 6.1.2.19; regenerate clean.

## 2026-09-24 — MAKERS condensed; tour guidance lives in the tour manual

- `MAKERS.md` went from 356 lines / 23,908 characters to 148 / 8,770. The Tour
  startup and Tour participation sections were removed. They restated AGENTS
  and the tour manual, which `start-tour` already returns; the few items only
  MAKERS carried (fresh start, CLI listener session handling, no duplicate
  generation, stale signals, final-response completion) moved as a short list
  into `examples/prints/README.md#maker-agent-participation`.
- Condensed the request table, event queue, reference table, interaction flow,
  parameter policy and boundaries. Printer setup folded into the flow and the
  policy. Generation-failure recovery and lease renewal stay in Existing Studio
  work because they aren't tour-only. The Thingi10K licensing policy moved to its
  manual, which had deferred to MAKERS.
- Linked anchors are kept; `core/agent/README.md` now links tour participation
  in the tour manual.
- Maker onboarding output is now 22,832 serialized characters (18,127 of text),
  down from 52,813 this morning. Checks: `mcp.test.mjs`, `mcp-access.test.mjs`
  and `studio-tour-lifetime.test.mjs` pass; `check-repo` links pass (only
  concurrent BR/D records fail).

## 2026-09-24 — Shared print tools condensed

- `core/print/USAGE.md` went from 285 lines / 16,826 characters to 98 / 5,422.
  One command table (CLI and MCP columns) replaces per-operation prose. Removed
  restatements owned elsewhere: the thingi10k and text sections (skill manuals),
  the Bambu setup, filament and AMS block (`core/export/bambu.md`), firmware and
  S5 notes (`griffin.md`), Studio picker and launcher detail (`studio/README.md`),
  and the legacy `migrate` row.
- Both creation routes stay: `init`/`import-stl` make geometry without Studio;
  toolkit `create-preview` does the same and opens Studio. Neither generates.
  The route question is left open for the user.
- The development `demo` paragraph, with its robot command-setting links, moved
  unchanged to BUILDERS "Testing through the use context".
- The four linked anchors are kept; `inspect-generation-failure` still reads
  `#check-generate-and-deliver`. Checks: `core/tests/mcp.test.mjs` 17/17;
  `check-repo` reports only BR-055 from concurrent backlog edits.

## 2026-09-24 — Dev maps: map scorer

- Direction from the owner: leaves and links are generated from scanned code;
  clusters are authored (eventually solved) to balance map size (6–16),
  crossing links, flow readability and one-way flow; everything nested under
  `0`, with repeats. A solver weighs all maps at once. First step: a scorer
  the owner checks against good and bad maps.
- `dev-map/lib/score.mjs` and `node dev-map/cli.mjs score [--json]`: per map,
  size badness, crossing share (and without nodes called from 20+ places),
  islands and backflow (Eades–Lin–Smyth order), summed; tree energy is the
  sum. Links are calls, data between calls (through operators) and indirect
  links, lifted onto the drawn members. Writes `dev-map/view/scores.html`
  (sortable, filter by kind, each index opening the viewer); viewer builds
  refresh it.
- First run: 671 maps, 4368 node links, energy 899.23. Medians: clusters 1.45
  (27 of 42 with islands), regions 1.45, node maps 1.40; top map 0.38.
  Checked the page and map links in the viewer; regenerate and `check`
  unchanged.

## 2026-09-24 — Dev map glossary: ports reserved; no "declaration"

- User rulings: "port" is reserved for the Grasshopper junction of a link and
  a box (argument slot or result); what the maps drew as region and top-map
  ports are boundary boxes. "Declaration" is dropped for node, parent map,
  child map, child node, inner and outer; the durable name is the node path.
  Code inputs and outputs are not listed separately. Link kinds and the two
  finding classes are kept.
- Measured for the region question (store of this date): 117 region entry
  points, 33 of them called by mapped code in another directory; 351 of 1921
  repeat boxes exist because a call crosses a directory. From the same call
  edges, homing each node at its nearest common caller without regions gives
  93 entry points, depth 10 (mean 2.5, now 13 and 5.3), and 426 nodes on the
  top map, 333 of them shared helpers (189 leaves) that no single caller
  owns. No generator change yet; the region pivot awaits the owner.

## 2026-09-24 — Dev maps: glossary in DEVELOPER-CONTEXT; HANDOFF removed

- User asked for a "Dev map glossary" section in DEVELOPER-CONTEXT as the one
  owner of the terms while they settle. Changed with it: a node is a region,
  cluster or declaration with one parent map (was home); nesting is the tree of
  maps; entry point (was entry/flow root), with an example; inner and outer
  declaration (was nested/enclosing, holder); ports belong to the node and
  appear on its boxes and at its own map's edge; annotation (was fact). The
  map guide, tools and read fields are not yet propagated.
- Deleted `dev-map/HANDOFF.md` (241 lines), a one-use handoff. Its open items,
  open questions and accepted scanner limits moved into BR-052, which already
  pointed at it; its rulings are in D-038 and the DEVLOG. Links updated in
  DEVELOPER-CONTEXT (186 → 225 lines), the map guide and `.local`.
- Checks: `check-repo` reports only the existing BR-055 and D-038 errors.

## 2026-09-24 — Skill digest trimmed to selection; keyword skills

- User asked for the AGENTS.md treatment on the skill digest. `skills/DIGEST.md`
  went from 79 lines / 8,360 characters to 41 / 3,885. The intro is three
  sentences; the onboarding paragraph, special capabilities and shared-workflow
  sections were removed as restatements of AGENTS, GLOSSARY, MAKERS, USAGE
  and AUTHORING.
- Rewrote 19 SKILL.md descriptions (the digest and MCP catalog source) to what
  the skill does, when to choose it and what rules it out: 4,843 to about 2,500
  characters. Details that matter after selection stay in the manuals.
  Unvalidated skills start with "Experimental.". The table column is "Use".
- User ruling: `gridfinity` keeps its one-word description as a keyword skill,
  used only when the person names it. Added "Keyword skill" to GLOSSARY and the
  description rule to skills/AUTHORING.md; fixed its `--builder` file name
  (BUILDER.md) and a toolkit comment that still barred developers from manuals.
- Experimental list reviewed with the user. "Experimental." now means a new
  printing technique whose physical behaviour is still unknown; most manuals
  also lack validated prints, so "unvalidated" did not distinguish anything.
  User report 2026-09-24: draped-skin, bridging, advanced-vase-wall and thick-lip
  have been demonstrated in physical prints. Bridging lost its marker and the
  four manuals' "no physical print" lines now record that report. Marked:
  plastic-weld, rimming-planar, rimming-normal, wave-overhangs, and at the
  user's direction pipe-cladding and line-network. User report: every
  planar-infill pattern is physically validated (manual updated); supports are
  not (the freehand spline cat did not need its support), so that manual stands.
- Checks: digest freshness passes; `core/tests/mcp.test.mjs` and thingi10k
  library tests 23/23. `check-repo` reports only BR-055 and D-038, from
  concurrent uncommitted backlog and decision edits.

## 2026-09-24 — Dev maps: terms and finding classes

- User reviewed the dev-map vocabulary. New terms in DEVELOPER-CONTEXT
  (`#terms`): dev maps (the system) and map (one graph); node (anything with
  an index: region, cluster, declaration) with a kind and a view, map or code
  block; box (one drawing of a node; a node may have several on one map);
  top map, entry (was flow root), cluster (was group), nested/enclosing (was
  holder); link or wire, as call, data, state or indirect link (was coupling),
  keyed dispatch (was registry entry); carried value (was accumulator).
- Findings are uncertain (drawn, the unknown marked on it) or missing (not
  drawn anywhere); the map guide's `#findings` tables assign all 31 kinds and
  4 rules. Current store: 5629 uncertain, 5179 missing (10,808).
- Docs and prose only: map guide rewritten in the terms with a field-name
  bridge; HANDOFF gains a terms note and queue item 13 (rename fields, store,
  viewer and `flows/`; class on each finding row), and its commit list moved
  to a DEVLOG pointer; toolkit onboarding text and CLI/read messages say
  nodes, maps, clusters. Lines: DEVELOPER-CONTEXT 147 → 186, map guide
  193 → 220, HANDOFF 245 → 241.
- Checks: regenerate and `check` unchanged (3177 linked, 977 unresolved, 57
  outside, 4994 platform); developer onboarding returns the new text; no link
  errors in the edited docs. The commit also carries another session's
  uncommitted work in the checkout (vase-wall motif → tile rename, skill and
  manual edits), at the user's request.

## 2026-09-24 — Dev map: exporters leave the mapped scope

- User ruled that exporters, anything turning a SAAMpath into another
  language, are outside the dev map and keep their own markdown. In
  `dev-map/lib/scope.mjs`, `unmappedDirs` became `unmappedAreas`: `core/agent`
  and `exporters`, which is every `core/export` file except `registry`,
  `travel-advisory`, `source-time` and `machine-study`. No file moved (another
  session was editing the DENSO exporter). Exporters are active callers, so
  99 caller rows now name them on 21 core pages; mapped calls into them are
  outside arrows (`out:exporters`, 20 sites from registry and Studio's
  source player).
- New `core/export/DEVELOP.md` (54 lines): adapter interface, files by
  dialect, how to add one. Removed the two Lua flows from
  `flows/export.json` (116 → 27 lines) and the 13 exporter rows from
  `facts.tsv` (16 → 3); each fact was already stated in its dialect contract
  or D-036. Scope wording in DEVELOPER-CONTEXT (145 → 147), HANDOFF
  (249 → 245; the Lua and H2D-exporter items are closed), the map guide and
  the BUILDERS reference row.
- Before → after, full regeneration of the same source (before rebuilt in a
  detached worktree with the old scope): pages 1692 → 1496, maps 764 → 671,
  code destinations 928 → 825, group pages 49 → 42, drawn boxes 3589 → 3101,
  repeat boxes 1906 → 1614, finding rows 12,328 → 10,808 (uncertainty
  11,243 → 9,831, unresolved 1085 → 977), linked 3697 → 3177, outside
  47 → 57, platform 5843 → 4994, facts 15 → 2. Region `core/export`: 19 → 4
  files, 213 → 17 pages, 1659 → 141 finding rows. Other regions unchanged;
  max depth 13. `check`: 0 stranded, unplaced or orphan facts;
  `check --viewer 2` 827/827 and 145/145.

## 2026-09-24 — Correct DENSO controller to RC8A

- User corrected the controller to RC8A: the reported loads and passing runs were
  on the RC8A, not an RC8. Renamed the profile to denso-vs068a4-rc8a revision 4
  and the rotary interface to rc8a-relative-ex, and updated the registry, setup
  checks, interpreter identity, examples, tools, Studio labels and docs. DENSO
  document titles and the supplied project's RC8 metadata keep their names.
- Local bundles under Prints/development/denso-* and Prints/tour/wavy-denso*
  still snapshot the old ID; they are not migrated. Recreate them to use them.
- Validation: 33 tests in denso, mcp, mcp-access and printer-profiles passed;
  map regenerated (3697 linked, 1085 unresolved, 47 outside, 5843 platform;
  0 stranded or orphan facts).

## 2026-09-24 — AGENTS.md trimmed to role routing; sync report moved into the toolkit

- User asked to cut context read, starting with AGENTS.md, which every role
  reads. It went from 184 lines / 14,183 characters to 43 lines / 2,343:
  a role and first-action table, the tour launch, role changes and the
  `.local/AGENTS.md` pointer. Owner lists, dev-map rules, setup/check policy,
  documentation placement and evidence rules were removed as restatements of
  MAKERS, BUILDERS, DEVELOPER-CONTEXT and CONTRIBUTING-AGENTS.
- Moved the unique pieces: the D-029 withdrawal pointer to BUILDERS selective
  adoption and DEVELOPER-CONTEXT; the check-reuse rule to DEVELOPER-CONTEXT; the
  tour's early-yield hint from MAKERS (returned only after launch) to AGENTS.
  DEVELOPER-CONTEXT, BUILDERS and the toolkit now call developers maps-native
  without forbidding a component manual when the work calls for one.
- Onboarding (all roles) and `start-tour` fetch `main` and return
  `sync.summary` (branch, HEAD, newest main commit included, main's newer
  commits); maker/builder/tour `nextStep` asks for it to be relayed in one line.
- Renamed `skills/README.md` to `skills/DIGEST.md`, with the toolkit, digest
  script, MCP test and links. `.local/AGENTS.md` (preferences, printer notes,
  no client memories) and `.local/DEVELOPMENT.md` now hold this checkout's former
  Claude memories, condensed; the originals are in `.local/claude-memory-archive/`.
  Both context maps show the local file.
- Checks: `maker-onboarding` run live (sync fetched in ~2 s; three documents
  returned); `core/tests/mcp.test.mjs` and `review-state.test.mjs` 19/19 pass;
  digest script regenerated `skills/DIGEST.md` unchanged. Tour launch not run.

## 2026-09-22 — Continuous tube-first DENSO motion in both open studies

- User identified the missing tube, assigned extrusion to a separate controller,
  requested both existing Studio instances be updated, then required continuous
  extrusion with no travel for both versions. No process or rotary commands added.
- Reused shared full-fill substrate operations: 16 mm bore, 18.4 mm OD, 12 mm high,
  60 layers, three concentric beads. Both combined candidates use 716 quarter arcs
  before the final tube ring changes orientation while moving; top-first cladding
  follows via a deposited link. All ring/layer/track joins deposit. The 180-degree
  track directions reverse; 360 retains the source down/up order.
- All intermediate moves request @P; only the final target stops. There are no
  intermediate travels, lifts, dwells or stationary rotations. Explicit starting
  TCP/posture and external extrusion start/stop are outside the depositing path.
  Only P10 FIG is inherited; initial tool roll is explicitly defined.
- Expanded the emitted PacScript loops and checked every route/end coordinate,
  orientation and stop flag. Nominal Studio checks passed 4909/5639 samples.
  Both original study directories were updated in place; no controller
  compilation, physical execution or USB writes occurred.


## 2026-09-22 — Both 180- and 360-degree fixed-part cladding candidates

- User requested both versions after identifying possible full-circle collisions.
  Generated separate motion-only programs from the selected first vertical shell:
  180 degrees includes 75 boundary-inclusive tracks (151 Move L targets); 360
  visits all 148 tracks once (297 Move L targets), without a closing return.
  Both retain T6/W2, inward/downward 45-degree axis, fixed rotary and no process IO.
- Added cyclic source-sector selection, explicit sector CLI argument, matching
  Studio studies and per-file setup/staging notes. Every source track and emitted
  pose was checked; maximum nozzle-axis component error was below 4.8e-9.
- Full-circle presentation exposed a nominal IK half-turn limitation. Rotation
  error now recovers the axis from R + I when its antisymmetric part vanishes;
  the declared elbow/wrist branch checks remain in force. The two studies passed
  750 and 1480 sampled presentations respectively; four earlier FK/IK and
  presentation fixtures also passed. Preview angles unwrap across the source seam.
- Browser inspection could not run (browser tool process exited twice). No claim
  of visual QA, collision clearance, controller compilation or physical execution.
  No USB writes. Full production cladding still awaits rotary integration.

## 2026-09-22 — Passing spiral evidence; fixed-part cladding dry run and Tool 6 model

- User confirms the spiral motion demo passed. Read Desktop STRUDER_SPIRAL3 and
  DENSO_PASSING_REFERENCE.md; the earlier USB snapshot had only Spiral1/2.
  The record reports Spiral2/3 passed with T6/W2/P10. Spiral3 adds quarter-turn
  arcs and explicit speed/acceleration. Preserved source/guide hashes privately.
- User selected the saved development/denso-rc8-pipe recipe from the other SAAM
  checkout and narrowed hardware scope to a motion-only front ~20% of the first
  vertical shell, fixed rotary. Full output is deferred until rotary integration.
  Centre at Work 2 origin, axis +Z; task defines front -Y. User confirms upright
  mounting/parallel work plane and 45-degree downward, radially inward tool axis.
- Added tools/denso/create-cladding-dry-run.mjs: selects existing shared-skill
  strokes, retains the recipe, emits 29 of 148 tracks, 59 stopped linear targets,
  no IO/rotary commands. Local source hash and copied recipe bind the candidate.
  Preserves FIG using documented T2P(T(...,Fig(P10))); unlike the spiral, cladding
  explicitly changes orientation. No controller compilation or run was claimed.
- Added optional flangeFromTool to the nominal DENSO presentation model so the
  supplied Tool 6 [155,0,35]/Ry90 offset and axis orientation are represented.
  FK, seeded IK wrist reconstruction, reach margins and rendered link lengths
  consume the full transform. Existing straight-tool models remain compatible.
- A local sampled placement study (143 positions, 2-degree azimuth samples at
  three heights) found nominal full-circle solutions; best sampled elbow/wrist
  sine-margin candidate was radial distance 350 mm, height 25 mm, W2 yaw -90.
  This is not a global optimum, calibrated joint-limit/FIG model or collision
  result. Keep the hardware trial at the requested front sector.
- Checks: generated ASCII/CRLF and SHA-256, track count/order, zero IO/EX and
  inward/downward vectors verified; maximum direction component error 4.8e-9.
  Tool-6 zero pose checked by independent geometry, legacy model cases retained,
  and 290 samples of the local Studio sector study resolved without diagnostics.

## 2026-09-22 — Dev map: repeats measured against "only where it gives context"

- Read-only analysis over the 704 node pages (script in the session
  scratchpad). Drawn boxes 5286, repeats 3128 (56 %). Kinds: a callee with
  a data wire on the page 2237 (71.5 %); a callee with only its invocation
  wire but carrying a condition, argument literals or state 705 (22.5 %);
  pure fan-out with nothing but the wire from `self` 71 (2.3 %, 43 pages,
  all studio); an inlined chain box repeating a declaration homed
  elsewhere 115 (3.7 %; none draws its own chain, as the rule says).
  Instances of one declaration on one page add 2041 boxes (38.6 %), the
  largest groups `render` × 31 of `$`, `createStudio` × 26 of one callable
  and × 12 of `note`, `validatePlanSelections` × 22 of `requireThat`.
  918 repeats (29 %) have their home in another region.
- Recommendation: no kind becomes a reference row. Only pure fan-out
  passes the reader-value test, and collapsing it removes 71 boxes (1.3 %)
  while flipping 8 pages to code; collapsing every no-data repeat removes
  776 (14.7 %) and flips 50 pages, and buys nothing on the two largest
  pages (`createStudio` 167 → 154). 96 % of repeats carry a wire, a
  condition or a literal. The real lever, if fewer boxes are wanted, is
  per-declaration ubiquity: 15 declarations account for 1168 repeats,
  `requireThat` alone 682, and each of those still carries its predicate
  and message.

## 2026-09-22 — Dev map: an invocation wire carries its call site's condition

- A `call-site` invocation wire carries `gate` (an index into the page's
  `gates`) when every site of its box stands under one condition, or
  `siteGates: [{order, gate}]` when they differ (`invocation.mjs`); the
  compact read keeps a `gates` table a wire references (`agent-view.mjs`).
  2357 of 6031 wires carry a gate on 569 pages. The drawing prints the
  caption on the wire only where the target box does not already state
  it: `presentation.mjs` splits a multi-site box into one instance per
  site and each instance box already carries its caption, so today 0
  wires draw one and the graph SVG is byte-identical; the code panel
  carries `data-gate` and the caption on the wire row, since it has no
  box. `coverage.mjs` accepts either surface for `wires.gate`.
- Found on the way: the only call gates no surface shows are two guarded
  calls on `dobot-lua-subset.mjs::parse` whose callees are contracted into
  the authored `@group/cursor` box, which by rule gets no call wire; the
  caption is drawn on the instance boxes inside that group's page. Left
  as is: an authored cluster is not a call box.
- `check --viewer` 85,848 of 85,848 map items and 12,842 of 12,842 code
  items, 0 gaps; `check` 3689 / 1084 / 47 / 5837 (moved earlier with the
  concurrent Denso edits); store byte-identical apart from generator
  hashes; no dropped wires.

## 2026-09-22 — Correct DENSO target to VS-068A4; preserve USB evidence

- User corrected the robot model to VS-068A4. Replaced the mistaken experimental
  VP-6242 profile with denso-vs068a4-rc8 revision 3, including registry, setup
  checks, interpreter identity, examples, Studio labels and documentation.
  Saved jobs are not silently migrated or reapproved. Robot labels now use the
  supplied machine snapshot.
- Updated nominal FK/IK geometry to VS-068 centerlines (395 mm shoulder height,
  30 mm shoulder offset, 340 mm links, 20 mm elbow offset, 80 mm flange), including
  presentation reach bounds and the rotating shoulder offset. Supplied WINCAPS
  model pivots corroborate the dimensions. No encoder/FIG mapping, installed tool
  or rotary calibration was inferred.
- Inspected the supplied STRUDER11 project: VS068A4/RC8 metadata, a small WPJ
  descriptor, companion databases and source/attribute files. User reports
  STRUDER1_1 and STRUDER1_2 load on the controller; no physical motion or printing
  result was inferred. Additional supplied arc/spiral sources remain unverified.
- Copied all 66 files and 12 directories to an ignored local snapshot, including
  both demonstrated programs. Source-before/copy/source-after SHA-256 inventories
  matched. This task made no USB writes. Rechecked the local snapshot hashes at
  completion; new demo files are separate.
- Recorded the [native-project/USB assessment](core/export/denso-usb-assessment.md):
  recommend template-based, program-only delivery before a complete project writer.
  Current SAAM output remains its experimental source ZIP. Prepared a separate
  local STRUDER_LINE1 P1/P2 Move L candidate and operator notes, without compiling,
  transferring or running it. It tests controller interpolation, not generated
  intermediate points or extrusion.
- Validation: 25 tests in denso.test.mjs and mcp.test.mjs passed; the targeted
  public-CLI unresolved-robot-setup check passed. On-demand geometry checks matched
  WINCAPS joint/flange reference positions and rotated shoulder offset; four seeded
  FK/IK and presentation cases passed (maximum TCP residual 0.0000084 mm).
  Studio snapshot labels checked. Full development map regenerated, no stale pages
  or fact errors. These are software/model checks, not hardware commissioning.

## 2026-09-22 — Dev map: the compact read carries nothing the drawing does not

- `compactPage` no longer carries per-call-site `calls` and the
  `invocationSites` flag (the drawing states a call as an invocation wire
  with its slots; `--details` keeps them in full as `callBindings`),
  `boundary` (bookkeeping already on the presented ports), or a `gates`
  table no item on the page indexes (three pages, all the same
  `peek().type !== "eof"` gate on `parse` and its two groups: its only
  references were call sites the invocation wire collapses). Compact reads
  11.45 → 10.52 MB; no other key changed on any page; `--details` proven a
  superset on ten pages. `structural`, `relationshipSummary` and
  `composition` stay and are drawn as a "this page" ledger section, since a
  reader who does not know which kind of drawing this is reads every arrow
  wrong and the summary is the only statement of how much collapsed; the
  four group pages that list a class's fields without owning the boxes
  draw them as rows; ledger values print JSON `true`/`false`/`null`.
- `check --viewer`: map pages 83,686 of 83,686 items drawn on 0 pages with
  a gap; code destinations 12,647 of 12,647. Both surfaces now show the
  same thing, and the check keeps it so. Store byte-identical to the
  generator change; `build` and `regenerate` exit 0, no dropped wires.
- The `check` totals moved with the other session's concurrent Denso edits
  in this checkout, not with this work: 3689 linked, 1084 unresolved, 47
  outside, 5837 platform. Left for the tracer: an invocation wire does not
  carry its call site's gate, so a condition guarding only calls is
  invisible on the drawing.

## 2026-09-22 — Dev map viewer: a code destination shows its whole context beside the source

- `generated-view.py::code_pane` draws the compact read of a code page as
  a panel under its source, in the map ledger's order and words: inputs
  with their call sites, outputs with the return expression, callees as
  clickable rows with call order and stub or literal slots, operators,
  invocation and state wires naming both ends, gates, state nodes with
  their owner linked, callers including active outside ones, then the
  ledger (facts, requires, couplings, parameter targets, unresolved,
  uncertainty, per-node sections, outside and platform counts) produced by
  the map's own `lists()` through a `RowSink`, so headings and markers are
  the same code. One `view/svg/<index>.ctx.js` sidecar per code page,
  fetched like a drawing; the shell's page metadata is gone (2.2 → 0.9 MB).
  A Context button folds the panel; stale and `sourceUnavailable` are warn
  rows at the top.
- `coverage.mjs::coverCode` now measures the panel item by item like a map
  page: code destinations 3,355 of 4,590 fields reaching the shell → 12,649
  of 12,649 items drawn, 0 pages with a gap; map pages unchanged at 83,559
  of 89,246. `check --viewer` runs in about 7 s. Store byte-identical,
  compact read untouched, `check` 3691 / 1084 / 47 / 5833, no dropped wires.
  Screenshots in the session scratchpad (`code-page-before/after.png`).
- This checkpoint is narrowed to `dev-map/`: another session is mid-edit on
  the Denso VS068 profile (machine JSON renamed, kinematics, rules, tests)
  in the same checkout and its work is left uncommitted for it.

## 2026-09-22 — Dev map: `check --viewer` measures what the drawing does not carry

- `dev-map/coverage.mjs` (outside `lib/`, which is hashed as a generation
  input) computes the compact read of every page, enumerates its items and
  asks the built drawing for each: a box by `data-id`, a wire by both
  endpoints after the drawing's own rewrites, a ledger row by a new
  `data-row="field#ordinal"` marker, a note by its text. `node dev-map/cli.mjs
  check --viewer [ADDRESS…]` reports the gaps by field and page; opt-in
  because it needs `build`'s 46 MB of output, which plain `check` must not
  require. Runs in about 12 s on the whole store.
- Drawing gaps closed on the way: operator gate captions (516 items on 178
  pages), `keptFor` (342), 18 gates referenced only by operators, and three
  pages whose empty caller list hid `calledFrom`. Map-page coverage 92.6 %
  → 93.6 % of 89,245 items. Remaining on map pages, all design questions:
  per-site `calls` evidence (4,488 items: argument counts and flags the
  compact read carries but the drawing states only as stubs), `boundary`,
  `composition`, `structural` and `relationshipSummary` descriptors on
  containment pages, `stateFields` on four group pages, three gates nothing
  references.
- The largest divergence is the code destination: the viewer's code pane
  renders only the caller lists, while the compact read of the same page
  carries inputs, outputs, couplings, findings, state, invocation and state
  wires, gates and facts (73 % of 4,590 items reach the shell, and the pane
  shows a fraction of those). Queued as the next viewer task.
- `check` 3691 / 1084 / 47 / 5833, clean; the JSON agents read is
  byte-identical; `build` and `regenerate` exit 0 with no dropped wires.

## 2026-09-22 — Dev map: finding rows keep their operator drawn; nested record members

- Every finding row that names an operator (`iteration-control`,
  `iteration-input`, `collection-input`, `update-input`, `choice-control`,
  `iteration-backedge-control`) is about that operator's own input or
  control, so the operator stays drawn when the liveness pass would drop it
  (`flow.mjs`, `keptFor: "finding"`, 504 operators). One with no data wire
  at all is attached to the function by an `invocation` wire with
  `provenance: "operation"` and its unknown inputs as stubs (116), so
  nothing floats; `destination.mjs` ignores kept operators and their wires
  so no page changes destination. Rows naming a missing operator 559 → 0.
- A record member joins its holder with `.` at any depth when the holder is
  a non-callable variable (`graph.mjs`): 33 renames such as
  `createStudio::lifetime.onViewers`, `moveStore::methods.reader`,
  `exportMovie::encoder.output`. Callable holders keep `::`; the four
  `PreparedGenerationJob::constructor::…` children are fields, defaults and
  an anonymous callable, not record members. A registry table inside a
  function folds like any record; module-level tables keep their key
  segment, an asymmetry for the owner. Forced flow edit: one member path in
  `flows/studio.json` (`performanceView.context`).
- Verified on the main store: `skillSettingsRows` 41 operators, 29 kept, 46
  rows all resolving; distinct finding rows 12307 unchanged; `check` 3691 /
  1084 / 47 / 5833, clean; floating boxes 0, depth 13, every declaration
  homed once, destinations unchanged. Noted: `destination.mjs::wired` tests
  "a wire on one of the two declarations", not "between them" as the guide
  says.

## 2026-09-22 — Dev map: handler-property registrations; record-member names

- A named declaration assigned to an `on<event>` property inside a function
  (`canvas.onpointerdown = beginCanvasDrag`) is an `event-listener` coupling
  from that function to the handler (`graph.mjs`, rule `handler-property`),
  drawn as a wire on the caller's page and a caller row on the handler's,
  beside the `addEventListener` registrations the scanner already drew. A
  function written at the site is already a `@handler/` declaration and is
  not doubled. Census: 19 `addEventListener` sites (18 drawn before and
  after), 35 handler functions written at the site, 7 named-value
  assignments (0 → 7 drawn), 4 `tour-ui.mjs` sites assigning an anonymous
  wrapper `attempt` returns (not drawn; no declaration to open).
  `connectCanvasPointerEvents` now carries six couplings to its drag
  handlers, so the input cluster has internal wires. `event-listener`
  relations 49 → 56; couplings never counted toward `linked`, so `check`
  is unchanged at 3691 / 1084 / 47 / 5833.
- A member of a module-level record that is not a node joins its holder
  with `.` (`studio/app.mjs::viewer.reportPerformance`, `views.facts`,
  `views.facts::textRows`, `views.settings`; 4 renames); entries a
  `registry-entry` reaches keep their key segment. Record members under a
  holder inside a function (37 nodes such as `createStudio::lifetime::
  onViewers`) still read `::`; the same rule applies and is queued.
- Verified on the main store: distinct finding rows 12307 unchanged,
  floating boxes 0, depth 13, every declaration homed once, no forced flow
  edit. Left: `studio-events.mjs:46` registers a local record's member
  (`member-receiver-unresolved`); a module-level registration has no
  declaration at its `from` end and draws against the region's `in:` port.

## 2026-09-22 — Dev map: literal arguments drawn as values

- The owner ruled literal stubs are drawn, and asked why they exist: a slot
  fed by a constant at the call site has no producer to wire from, so the
  invocation edge marked it `literal` to keep no slot silent. The stub now
  carries the value instead of the word (`invocation.mjs::literalValue`):
  the call site's own text on one line, cut past 40 characters, a plain
  number or boolean as that scalar, strings with their quotes, object,
  array, `null` and `undefined` as written; `reason` is gone from literal
  stubs. The reason is derived first, so a constant hidden by a spread
  stays `spread`/`position-unknown`. The box prints the value on the slot
  and wraps slots at 46 characters.
- Verified on the main store: 1882 slots carry `literal`, 0 carry the
  reason; every other reason count identical; string 1360, number 258,
  object 84, boolean 83, array 41, null 14, undefined 6, 36 constant-valued
  expressions drawn as their source; compact reads +0.25 %. `check` 3691 /
  1084 / 47 / 5833, clean; floating boxes 0, depth 13, every declaration
  homed once. `validatePath` draws each `requireThat` message on `arg2`.
- Not a literal slot: `setTimeout(…, 75)` in `scheduleChange`, a platform
  call with no box, so the `75` is in the platform count only; the
  expression-operator work draws platform calls as producers.

## 2026-09-22 — Dev map: module-level handlers are declarations; one wire per pair

- A callable stored at module level on a platform event property
  (`el.onclick = …`, `addEventListener`) is a `handler` declaration named
  `file.mjs::@handler/<receiver>.<event>` (`graph.mjs`), the receiver being
  an id selector's id, a binding or a static member path; a handler's body
  homes what it declares. The six studio artefacts are gone from the region
  page: the three position-named `onclick`/`onchange` lambdas are homed
  under `@handler/confirm.onclick` and `@handler/stl-file.onchange`,
  `blob::draw` and `blob::onProgress` under `@handler/export-movie.onclick`;
  `viewer::reportPerformance` stays, a genuine root (record member, not
  ambiguous). 26 declarations renamed in all; every one homed once; no root
  carries a position identity.
- Containment wires merge per pair of boxes (`overview.mjs`): one wire with
  a summed `count`, `kind` or `kinds` by mechanism, names in the label up to
  three. Pairs carrying more than one row 45 → 0; region `2` draws `2.1 →
  2.4` once as `call ×13, construct ×19`.
- The totals moved, and rightly: the 22 handler bodies in `studio/app.mjs`
  had no page before (ambiguous `onclick` anchor), so every call inside
  them was counted nowhere. `check` 3614 → 3691 linked, 1080 → 1084
  unresolved, 5798 → 5833 platform, pages 1611 → 1633, distinct finding
  rows 12187 → 12307; `outside` 47, floating boxes 0, depth 13, every
  declaration homed once. Region `8` draws 57 boxes: 21 named handler roots
  joined it while `clock`, `stepLayer`, `exportMovie` and `createLayerFade`
  moved under the handler flows that reach them.
- Forced authored edits in `flows/studio.json`: three paths renamed
  (`onkeydown`, `onsubmit`, `onmessage`), four members no longer roots
  removed, and the `playback` subgroup dropped below two boxes and was
  deleted; the authoring pass rebuilds it from the handler roots.

## 2026-09-22 — Dev map viewer: large function pages read as maps

- The owner's finding on 8.2.2 (`createStudio`, 167 boxes): a vertical
  column that could not be zoomed to read a label and still see both ends
  of a wire, so the reader cross-referenced in their head. Drawing only;
  the JSON is unchanged, the store byte-identical.
- `leveled.py`: a box's column is the longest path over value wires, with
  its own call number (ranked densely, in phases of ten) as a lower bound,
  so a body that threads no values still reads left to right and a producer
  always sits left of its consumer; state, loop and capture nodes sit just
  left of their first consumer; the drawing folds to an aspect ratio instead
  of a wrap width; a wire longer than half a stage at legible zoom (1050 px
  across, 590 down) is drawn as two named stubs, each naming the other end,
  a hub with more than six long wires dropping its own tag. `generated-
  view.py`: semantic zoom (`FAR = 0.5`: below it a box is its name alone and
  wires thicken; above it notes, ports, stub rows and labels return), a
  click-to-jump minimap, hover focus that lights a box, its wires and their
  far ends and dims the rest, `x` to pin, `]` `[` to walk the far ends, a
  click on an end tag to stand at the other end and `\` to come back; the
  finding ledger under the drawing in columns. Fixes on the resumed pass: the
  back-jump popped history twice, a peer outline leaked into nested rects,
  `fit()` went negative on a narrow stage.
- Measured (canvas px, wire length centre to centre): 8.2.2 2740×38905 →
  11042×6216, tallest rank 91 → 25 boxes, median wire 8187 → 1918, p90
  20161 → 5818, 4 of 263 long wires unnamed at both ends;
  `createViewerRenderer::draw` 1776×16634 → 7582×5273, median wire 1974 →
  957; `app.mjs::render` 1180×9796 → 3750×2936; region `8` 1438×10304 →
  6183×3890; `validatePath` and `regionComponents` still fit on a screen
  (`regionComponents` p90 wire 919 → 1423, the one measurable regression).
  Screenshots from Edge headless in the session scratchpad; the live zoom
  and focus were verified in a browser, not captured. Build reports no
  dropped wires; viewer 50.2 MB.

## 2026-09-22 — Dev map: `linked` counts relationships, code reads keep state

- `check`'s `linked` counted drawn boxes, so an authored group on a
  declaration page lowered it by one per member beyond the first (found by
  the authoring worker: the `createBundleWorkflow` grouping alone hid 23).
  `store.mjs::storeStatus` now counts each group member as the call it is;
  drawing no longer moves the total. New baseline 3614 linked (was 3553),
  1080 unresolved, 47 outside, 5798 platform.
- The compact read of a code-destination page kept a fixed key list that
  dropped `state`; it now returns `state` and the `state` wires beside the
  invocation wires, so the 28 field-state and 263 closure-state member
  pages that open as code carry their state (`SegmentIndex::add`: four
  fields, six wires).
- Authoring phase 1 (studio, core/print) is written in the worktree and
  awaits the owner's review before it lands.

## 2026-09-22 — Dev map: class instance fields as state nodes

- A class's `this.` fields are `state` nodes with `binding: "field"`
  (`static-field` implemented, unexercised: the scope has no static field),
  one convention with closure-owned bindings: on each method page a node per
  field read or written, wired into the consuming port or from the producer,
  from `self` with a stub where only the write is known; on the class page
  one node per field wired from the constructor's producer or its stub and
  to and from every member touching it. The old member-to-member field hubs
  are gone; `stateFields` stays and names exactly the drawn fields. Wire
  provenance renamed `closure-state` → `owned-state` everywhere. Private
  methods were briefly drawn as fields (`#name` never matched the member
  path); fixed, 21 spurious nodes removed. `this` aliased into a returned
  object literal (`LuaRuntime::makeClosure`) is not followed, per the
  accepted-limits list.
- Verified on the main store: 45 method pages draw 110 field nodes, 7 class
  pages 43; state read wires 1916 → 2124, write 1396 → 1530; closure state
  unchanged; distinct finding rows 12187 unchanged by kind; `check` 3553 /
  1080 / 47 / 5798, clean; floating boxes 0, depth 13, every declaration
  homed once. Pages read: `LuaRuntime` (6 fields, 23 wires),
  `LuaRuntime::execStatement` (`file` read into three `LuaSubsetError`
  arguments), `LuaRuntime::invoke` (no fields, correctly), `SegmentIndex`
  (4 fields, 19 wires), `PreparedGenerationJob::fail` (`#failure` written
  from a traced producer). The drawings carry the "owned by" state boxes.
- Gap found: the compact read of a code-destination page keeps a fixed key
  list and drops `state`, so 28 of the 45 member pages with field state, and
  263 of 565 with closure state, show it only in source. Queued.

## 2026-09-22 — Dev map: chain boxes carry rows, rows carry files, `--details` is a superset

- The containment findings pass (`store.mjs::attachContainmentFindings`) now
  runs after `drawChains`, so a leaf's chain boxes on region and group pages
  carry their rows like every other box: 39 of 65 chain boxes gained 338
  rows, 15 containment pages changed in `components` only, 43 byte-identical.
- Every finding row is stamped with its node's file at presentation
  (`presentation.mjs::located`); the compact read elides it where it only
  repeats the file in scope, so a `nodeFindings` row from another file is
  self-contained and box rows inherit the box's file. Compact reads 10.31 →
  10.59 MB.
- `read-map --details` returns `agent-view.mjs::detailedPage`, the presented
  page laid over the stored packet: invocation wires, `state`,
  `parameterTargets`, `findings`, `nodeFindings`, `inlined`/`via` plus the
  raw `flow`, `callBindings`, expressions and producers. Nothing stored is
  dropped; a caller list is carried by the first instance of a box only;
  overview pages carry both the drawn and the stored wire lists. Two lines
  in `core/agent/toolkit.mjs::readMaps`. Details reads 1.11× the store.
- Verified on the main store: region `8` chain boxes 17, 14 with rows;
  `validatePath --details` 11 invocation wires, 11 boxes with counts, 3
  sections, `flow` and `callBindings` present; `initializeAgentInterface`
  cross-file section rows all carry `file`; `check` 3553 / 1080 / 47 / 5798,
  clean; distinct rows 12187, floating boxes 0, depth 13, every declaration
  homed once.

## 2026-09-22 — Dev map: loop accumulators carried to the output

- Queue item 5, `flow.mjs` only. A binding declared before a loop and
  written in its body is that loop's accumulator, the shape `reduce`
  already drew: `initial` from the pre-loop producer, `current` into the
  body, `next` from the body's producer, `final` to the post-loop consumers.
  Nested loops compose by recursion (the inner `final` is the outer `next`);
  a self-update such as `max = Math.max(max, x)` is an `update` operator; an
  entered array callback carries accumulators the same way; bindings are
  demoted one at a time instead of the whole loop giving up; a loop shape
  that leaves the normal-completion path readable (`break`, `continue`,
  `throw`, `switch`, `try`, `await`, a nested loop) is carried with a
  `loop-exception-path` row naming the shape, and only `yield`, a `return`
  in a non-`for` loop and a branching backedge block it. Residual
  `loop-data-flow` rows carry a `reason`. `for(;;)` with `break` had been
  read as never exiting; fixed.
- Verified on the main store: accumulators carried 191 → 574 over 351 loops;
  `loop-data-flow` 882 → 129 (54 `unknown-next`, 47 `unsafe-collection`, 15
  `branching-backedge`, 8 `yield-in-body`, 5 `return-in-body`); all finding
  rows 12813 → 12187 with the rising kinds naming newly drawn gaps
  (`iteration-input` `initial`, `iteration-control`, `loop-exception-path`);
  stub slots 3484 → 3278, `loop-variable` 137 → 87; six pages code → graph
  because a `final` now wires onto a second called declaration; `check`
  3553 / 1080 / 47 / 5798 unchanged; floating boxes 0, depth 13, every
  declaration homed once. Pages read: `sampleTopSurface` (inner and outer
  accumulators for `samples`, `inside`, `steep`, `maxSlope`, all reaching
  `out1`, zero residual rows), `orderStrokes` (`while`: `ordered` to `out1`),
  `selectPrimingPath` (nested `for-of` with a gated `push`), `packZip`
  (`offset` reaches `requireThat`; its last use is a platform Buffer write
  the map does not draw).
- Left: `Set`/`splice`/`get(k).push` collections, backedges with more than
  one normal path, generators; 557 finding rows name operators the liveness
  pass drops (680 before), worth a separate look.

## 2026-09-22 — Dev map: finding rows follow their node onto function pages

- Queue item 6. On every graph page of a function, method, handler or class,
  each drawn declaration box carries `findings`, the count of that
  declaration's own `uncertainty` and `unresolved` rows (a group box keeps
  its group count), and the page carries `nodeFindings`: one section per
  distinct drawn node in drawing order, never the page's own path, after the
  page's own rows. `store.mjs::attachNodeFindings` runs after `drawChains`
  so inlined chain boxes are included, and before `renumber`;
  `presentation.mjs` reduces the rows the way the node's own page does so
  box count and rows agree; the viewer shows the count on the box and
  clickable section heads below the drawing. Root, region and group pages
  are byte-identical.
- Verified on the main store: 678 node pages carry counts, 677 have
  sections (`LuaRuntime` draws only group boxes); distinct finding rows
  12813 unchanged, shown rows sum to 20579; `check` 3553 / 1080 / 47 / 5798,
  clean; floating boxes 0, depth 13, every declaration homed once. Pages
  read: `validatePath` (eight `requireThat` boxes each `findings: 2`, one
  section), `LuaRuntime::execStatement` (46 boxes, 10 sections, 72 rows
  once), `initializeAgentInterface` (inlined chain boxes carry counts),
  region `7` unchanged. Size: compact reads 8.41 → 10.31 MB, viewer 32.4 →
  40.0 MB; `createStudio` is the one page over 300 rows (527 over 73
  nodes, compact read 222 KB), for the owner to look at.
- Left: inlined chain boxes on region pages carry no rows because the
  containment pass runs before `drawChains`; finding rows carry no `file`
  of their own (the section's `path` names it).

## 2026-09-22 — Dev map: what is not a map is drawn on the map above it

- Queue item 0, the owner's ruling of 2026-09-21. The homing walk
  (`tree.mjs`) never descends into a code destination: a leaf is homed where
  it is met, and what it calls or holds is homed and drawn on that same map,
  wired from the leaf's box, and so on while each of those is a leaf in turn.
  Nothing is numbered beneath a leaf; a leaf's chain is drawn on its home map
  only, and a repeat elsewhere is not expanded. Brought-in boxes carry
  `inlined` and `via`; `invocation.mjs` emits their wires from the leaf's box
  instead of `self`, on containment pages too; `store.mjs` keeps them out of
  `linked`. A region root that is itself a leaf has its chain drawn on the
  region page, the only map above it (studio's region page: 20 → 37 boxes,
  17 inlined). The viewer's sidebar nests every graph page under a graph
  page, and the filter finds a leaf and highlights its box on its home map.
  `destination.mjs` unchanged: the rule reads the page's own calls.
- Verified on the main store: code pages with children 98 → 0, graph pages
  with a code parent 46 → 0, sidebar rows appended un-nested 46 → 0 (752
  rows, none orphaned); max index depth 15 → 13; 189 inlined boxes; floating
  boxes 0 on node pages (10 pre-existing on 6 group pages, authored members
  with no crossing wire); every declaration homed once; finding rows 12813
  and `check` 3553 / 1080 / 47 / 5798 unchanged. Largest map pages:
  `createStudio` 166 (was 157), `createViewerRenderer::draw` 69,
  `app.mjs::render` 58. Pages read: `initializeAgentInterface` (11 boxes, 6
  inlined: `onRequests → needsTourToolpath → hasUnpreparedEdit →
  requestReceiptState`, `onRequests → scheduleChange`), `scheduleChange` (code,
  four callers, no children; homed on the session group page where the walk
  meets it first, with `poll` beside it), `poll`, `exportBambu` (leaf; its
  callee now a sibling), region `8`.
- Merged over the closure-state commit: the viewer draws the subject box
  when a wire leaves `self` or the page holds state; `README.md` 192 lines
  (was 185): both workers rewrapped it under the cap and the merge keeps the
  leaf text plus the state clause.

## 2026-09-22 — Dev map: closure-owned state as state nodes with read and write wires

- Queue item 3. A binding a factory declares and its nested members capture
  is a `state` node: on the member page (`name`, `owner`, `ownerIndex`,
  `binding`, `access`, declaration site) with read wires from the node into
  the consuming instance or operator port and write wires from the producer
  into the node, or from `self` with a stub reason (`collection-mutation`,
  `member-write`, `update`, `deleted-member`, `untraced`) when only the
  write is known; on the holder page once, wired from its initialisation and
  to and from every member that touches it. A mutating method call (`set`,
  `push`, `delete`) counts as a write, which the capture analysis alone did
  not see. The closure reference box keeps "function value" and loses its
  capture text; `presentation.mjs` drops the box's `captures`,
  `destination.mjs` ignores `closure-state` wires, `instances.mjs` no longer
  invents an invocation producer for them (92 spurious `invocation-origin`
  rows gone), `store.mjs` remaps `ownerIndex` on renumbering. The viewer
  draws state boxes with an "owned by" link and directional state wires.
- Verified on the main store: 1562 state nodes (980 on 425 member pages, 582
  on 156 holder pages), 1971 read and 1439 write wires, no floating node;
  reference boxes with capture text 529 → 0; `closure-capture` rows 701
  unchanged, all finding rows 12813 unchanged; `check` 3553 / 1080 / 47 /
  5798, clean; destinations 752 graph, 918 code; depth 15; every declaration
  homed once. Pages read: `createAgentRequests::accept` (`records`,
  `pending`, `byPrint`, `latest`; `pending` write-only), `createAgentRequests`
  (13 nodes, 56 wires), `interpretDensoFiles` (19 nodes, `execute` box with
  no text) and `::execute` (62 wires), `sourceSession::acceptPose`.
- Not done: class instance state (`this.x` on classes with `stateFields`)
  keeps the class page's field hubs only; captures inside a member's
  anonymous callbacks stay `closure-capture` rows. `README.md` at 185 lines
  by rewrapping.

## 2026-09-21 — Dev map: callback targets as references; array-method callbacks entered

- Callback targets (queue item 2). A callable a caller passes into a parameter
  is drawn on the caller's page, wired `callable → argN` into the call, and
  the callee's input port lists it as a `parameterTargets` row (`index`,
  `path`, `from`, `possible`); the callee collapses to code when nothing else
  makes it a map. Parameter-target boxes 94 → 9 (the nine remaining are
  callables destructured out of a parameter record), 85 reference rows on 44
  pages; 15 pages graph → code (`perTool`, `perFilament`, `watchStudioChanges`,
  `adoptProgramState` among them); 188 declarations changed home; a callable
  reached only as a callback is a flow root of its region (`regions.mjs`),
  so studio's region page went from 4 boxes to 20 and awaits clustering.
  `linked` now counts the reference rows so the total stays 3540 for the same
  relationships; flagged for the owner. Finding rows 13800 → 13804.
- Array-method callbacks (queue item 4). `map`, `flatMap`, `filter`,
  `forEach`, `find*`, `some`, `every`, `sort`, `toSorted`, `reduce*` callbacks
  are stages of the enclosing flow (`shapes.mjs::iterationMethods`): an
  inline callback is traced with its parameter bound to the iteration
  operator's `item`, a named callback is an ordinary call instance with the
  element as `arg1` (`graph.mjs`, `resolvedBy: iteration-callback`), and the
  method's result leaves the operator. 645 callbacks entered (620 inline, 25
  named). `linked` 3540 → 3553; `unresolved`, `outside` and `platform`
  unchanged by choice (entering a callback does not prove the receiver is an
  array). Finding rows 13804 → 12813: `callback-execution` 1010 → 172,
  `argument-origin` 2717 → 2284; two kinds rise because the gap is now named
  (`iteration-source` 221 → 496, `iteration-input` 0 → 345). Islands from
  the triage now called: `toPlanar`, `addFace`, `componentFromRoot`,
  `normalized`, `read`. `toPlanar` stopped being a root, so `spline-shells`
  in `flows/geometry.json` lost that member and its now-identical nested
  group.
- Merged store: 1611 pages (752 graph, 918 code), 0 floating boxes, every
  declaration homed once, max depth 18 → 15, stub slots 3994 → 3484,
  `check` 3553 linked, 1080 unresolved, 47 outside, 5798 platform, clean.
  Pages read: `perTool` (code, 13 rows), `resolveBambuProject` (its 13
  lambdas as boxes with callable wires), `regionComponents` (code → graph,
  `componentFromRoot` wired from the item), `toPlanar` (caller `joinChains`),
  `createAgentRequests::query` (filter, map, sort chain), `watchStudioChanges`.
- Ruling recorded in DEVELOPER-CONTEXT: what is not a map is drawn on the map
  above it; a code-destination declaration is a leaf with nothing homed
  beneath it. Today 368 code pages call a mapped declaration and 46 graph
  pages have a code parent, which the viewer's tree cannot reach.

## 2026-09-21 — Dev map: the invocation edge; no box floats

- `lib/invocation.mjs` derives one `invocation` wire per drawn box from the
  call sites, in call order (`order`), from a `self` node to the instance;
  argument slots the tracer could not source are `stubs` with a reason
  (`literal`, `nested-call`, `untraced-binding`, `property-path`,
  `loop-variable`, `branch-join`, `computed-expression`, `constructed-value`,
  `composed-literal`, `spread`, `position-unknown`, `awaited-value`). A box the
  function holds or names without calling gets a `declaration` or `reference`
  edge; authored clusters get none. Appended in `presentation.mjs` after every
  collapse; `agent-view.mjs` returns them on code pages too; the viewer draws
  them dashed indigo with the stub rows on the box. `destination.mjs` is
  untouched: a page with no data wire is still code.
- Verified on the regenerated main store: floating boxes 1434 → 0 (471 pages,
  316 drawn); 5601 invocation edges (call-site 4996, declaration 485,
  reference 120); 2669 boxes carry 3994 stubs, 1778 of them `literal`; pages
  by kind and destination, max depth 18 and one home per declaration
  unchanged. Pages read: `createAgentRequests::accept` (8 edges in line
  order, 3 stubs matching its 3 `argument-origin` rows), `griffin.mjs::
  validatePath` (11 edges, eight `requireThat` each `arg1 nested-call, arg2
  literal`), `initializeStudio` (5 boxes that floated, now wired),
  `regionComponents` (`componentFromRoot` as a `declaration` edge: the
  array-callback gap made visible), `dobot-lua-subset.mjs::parse`.
- `--details` still returns the stored packet without the wires; `README.md`
  held at 185 lines by removing sentences duplicated elsewhere. Rulings
  recorded in the handoff: repeated assertion boxes stay; the two code-shape
  sites are settled.

## 2026-09-21 — Code shape, third pass: `completeProgram` returns; ten dead declarations

- `core/export/bambu.mjs::completeProgram` no longer mutates its `program`
  parameter: it returns `{...program, moves, events, summary, code, envelope}`
  with shifted `line` values on new move and event records and the envelope
  built as one literal. Key order preserved. A/B over eight Bambu cases
  (H2D tools and nozzles, fast start, H2D and X1 colour change, mixed nozzle,
  dual verification): package bytes, program JSON, move and event line arrays
  and key orders identical, total `960aad380bd61d367b614d48fc7e6454` before
  and after. On the regenerated map the page's return reaches both callers.
- Island review (declaration pages with no caller and no coupling: 137; 41
  are defaults, anonymous callables, statics and DOM handlers; 96 triaged).
  Deleted as dead, no reference anywhere: `builder.mjs::beadVolume`,
  `reservation.mjs::intersectsReservation`, `tolerance.mjs::lerp`,
  `tessellate.mjs::lerp`, `nurbs.mjs::height`, `field.mjs::sampleTopSurface`
  (superseded by `query.mjs::sampleTopSurface`), `tour-ui.mjs::
  needsTourGeometryReview`, `app.mjs::toolpathPlaceholder` (its behaviour
  lives in `showingGeometry`), `LuaTable.fromArray`, `LuaRuntime::call`.
  Their authored memberships were pruned; `path.json` lost the one-box
  wrapper `policies-ordering`. 36 islands are entry points called from
  skills, scripts, adapters or tests; 48 are scanner limits: array-method
  callbacks not entered, module-level call sites, callbacks registered on
  platform objects or passed in records, getters read by property access or
  spread, members on instance receivers, the schema-keyed dynamic bundle
  table. Flagged, not deleted: `SegmentIndex::distanceTo` (test-only caller).
- Verified: `npm test` 210 pass, 0 fail before and after (the earlier
  known failures are gone at this head); `check` 1611 pages, 3540 linked,
  1080 unresolved, 47 outside, 5798 platform, no stale, stranded, unplaced
  or orphan facts.

## 2026-09-21 — Dev map: functional tree

- Operators no longer count toward the map-or-code rule (`lib/destination.mjs`,
  the one rule): a page is a map only with at least two called declarations
  and a wire; 129 pages became code, among them `loopArea` and 49 other
  operator-only bodies. Graph pages drawing no called declaration: 0.
- Region pages home flow roots only (declarations no declaration of the
  region calls: core 2, export 7, geom 47, machine 9, path 13, print 8,
  region 13, studio 32), optionally clustered; every other declaration is
  homed by the first flow page of its region that reaches it, depth first in
  call order; region wires contract onto the owning root. `stranded`
  (unreached from any root; currently none) replaces `unreached`. File pages
  and file addresses are removed.
- File paths are rejected as authored members; the flows were converted to
  the roots they held: 52 groups and 266 members remain (was 148 and 624, 231
  of them files); 96 groups fell below two roots and were dropped, including
  studio's interaction, requests and view groups and core/export's gcode,
  robot-commands and lua. Root clustering is the next authoring pass.
- Verified after `regenerate 0`: 1682 pages (was 1778), 0 single-box pages,
  every one of 1621 declarations homed exactly once, `check` exits 0 with
  3552 linked, 1079 unresolved, 47 outside, 5807 platform, no stale,
  unplaced, stranded or orphan facts; totals identical to before the change.
  Max index depth 7 → 18: the deepest index is a real 17-step call chain in
  studio. Pages read: `0`, `core/export` (2 clusters, 2 loose roots),
  `core/region`, `loopArea` (code, 19 callers), the deepest index.
- Documentation: the functional tree carried into DEVELOPER-CONTEXT.md, the
  map guide and the handoff; the "once per node" ruling on finding rows
  recorded (function pages should list their drawn nodes' rows once each;
  queued).

## 2026-09-21 — Maker handoff for accepted H2D colour and dual-nozzle workflows

- User requested the code/guidance rewrites needed for future maker agents,
  following AMS-19 and DUAL-20 physical passes. The v13 implementation remains
  unchanged: canonical job projections and identical rendered executable/project
  startup/shutdown are the accepted path, with no reference-file substitution.
- MAKERS links directly to the Bambu setup and both workflows. Maker onboarding
  includes MAKERS and core/print/USAGE.md, whose Bambu instructions now describe
  the accepted paths. The Bambu manual supplies per-filament/nozzle/process/feed
  setup examples, assembly-region assignment, optional fast startup, current
  profile generation and USB mapping review. Removed stale guidance saying
  same-nozzle colour changes were unsupported; kept X1 failure explicit.
- The duplication inventory now includes stored startup/shutdown. Physical facts
  and machine descriptions distinguish accepted H2D jobs from other installations.
  The regression pins both generated project and executable hashes for AMS-19
  and DUAL-20, so unchanged commands cannot conceal a project-metadata regression.
- Verification: all 31 targeted Bambu tests pass, including the strengthened
  hardware regression; git diff --check reports no whitespace errors.

## 2026-09-21 — Generated H2D DUAL-20 passes, closing dual-nozzle exporter work

- User reports "ams-20 also pass!" after the request to run the delivered
  DUAL-20-GENERATED. Archive SHA256 2a3007ea7fbc8251d199088ebfca4db630ebfd2133c1d4d675eddcdd04f25744;
  project SHA256 96efadb599441203b9156c450343acb29c8b507d713d63fb38c8825dcaba6af5.
  This accepts ordinary generated v13 output, not a reference-entry substitution:
  left 0.4 external PLA centre pad, right 0.8 blue AMS offset pad, then left,
  with correct-height deposition, Textured PEI, fast startup and no tower.
- AMS-19 had already passed ordinary generated same-nozzle blue/orange/blue.
  Both requested H2D capabilities now have physical evidence. No further
  template-isolation prints are needed to close the tested workflow.
- Maker guidance, machine evidence and hardware facts now reflect both passes.
  The regression protects generated project hashes as well as executable hashes
  for both successful jobs. Startup/shutdown duplication remains derived from
  the exact same rendered strings, and other declarations from the resolved job.
- Completed BR-056 is removed from the open backlog; BR-055 retains only X1
  and other installation acceptance work. X1's failed AMS test is not closed by
  an H2D pass. Original BR-056 provenance and pre-acceptance history follow.

### Completed BR-056 — Use both H2D nozzles with different diameters in one print

- Status: in progress
- Contributor: current user; account identity unconfirmed, no identity question required.
- Authorization: human requested — "bambu studio does not support 2-extruder prints with different nozzle sizes. On the other hand, we MUST support this. So there will be differences" (2026-09-21).
- Current hardware evidence (2026-09-21): the left-only reference, repack and producer-identity controls pass. Reduced configuration reproduces wrong-right-nozzle/elevated-height failures; alphabetizing it still fails. Full project JSON with minimal G-code CONFIG passes; full G-code CONFIG with minimal project JSON fails. Project JSON omissions are isolated, with individual keys unresolved. User requested a return to actual dual-nozzle testing: dual-project-identity-fast-06 adds three project metadata fields to the unchanged SAAM fast-05 mixed-nozzle program; it failed (no adhesion, right-nozzle dribbling; actual nozzle sequence and Z were not watched). AMS-09 and AMS-10 now pass same-nozzle AMS switching, with AMS-10 declaring actual left 0.4/right 0.8. AMS-11 failed the reusable v12 project writer (entirely orange). At the user's request, DUAL-12 is prepared while AMS-11 runs: exactly left/right/left, centre external-spool pad at Z0.2/Z0.4 and blue right-AMS pad 60 mm to the right at Z0.3. The original DUAL-12 is on hold; revised DUAL-12-PROJECT-CONTROL uses working AMS-10's exact project entry with all dual executable bytes unchanged, and is on D: with verified hash. The user now reports DUAL-12-PROJECT-CONTROL passed: physical mixed-nozzle left/right/left is demonstrated. Porting the working project representation into ordinary generated output remains open. X1 is unavailable.
- Session: current startup/nozzle/plate/AMS task; exact task title and stable ID unavailable.
- Source: follow-ups accompanying `twistedbox.gcode.3mf`; the two-nozzle references have SHA-256 `ddbea3c405b12328990c1aa6f45c106b8e6899a5807d7cc7947c23caa2835a63` (tower) and `f6bad52dc858c7a06ebdbace77b40706d8ea8d1f9afbfac26dd4e4678d03bf86` (tower-free), with actual left 0.4 / right 0.8 and a four-slot AMS connected to the right.
- Context: differing installed diameters and actual use of both nozzles are separate implemented contracts; regional filament selection drives each nozzle's process and the shared path, interpreter and package usage. The user explicitly excluded a prime tower and requires hardware-supported feed combinations rather than one fixed installation. Exact reference analysis, generated artifact hashes, implementation evidence and successive physical failures are retained in the [dual-nozzle reference](DEVLOG.md#2026-09-21--dual-nozzle-reference-distinguishes-outgoing-and-incoming-settings), [delivered verification](DEVLOG.md#2026-09-21--mixed-diameter-h2d-output-and-delivered-hardware-verification) and subsequent dated DEVLOG records.
- Remaining: make the physically successful DUAL-12 command sequence reproducible through the ordinary exporter without a substituted project entry, then verify a regenerated dual archive. Preserve the tested commands with the hardware regression and provide maker setup/review guidance. Extended AMS/HT configurations and other installations still need physical acceptance. Same-nozzle PLA AMS output now physically passes fresh generated v13 AMS-19; v12 AMS-11 is a historical failed format. Automatic power-loss recovery has no output contract; do not claim either from the dual test.
- Completion: the reviewed SAAM program deposits with both actual 0.4/0.8 tools, with correct process settings, synchronized startup/changeover/package declarations and recorded physical acceptance.


## 2026-09-21 — Fresh generated H2D AMS-19 physically passes

- User reports "ams-19 is pass". Delivered v13 archive SHA256
  30044f96b878e81bcc26795cef425658da60961c10f76096a0503c45b5d4beae.
  This was an ordinary generated bundle, strict-reopened, with no substituted
  reference project. It exercises right 0.8 PLA blue/orange/blue, installed left
  0.4, right four-slot AMS, Textured PEI, fast startup and no tower.
- Stored authored startup/shutdown plus seven empty template fields are
  sufficient for this job; individual necessity or firmware execution of those
  fields is not established. No further template isolation is needed to accept
  this tested same-nozzle workflow. Maker guidance now permits normal generation
  without reference-file patching, while preserving installation evidence limits.
- Pin generated project SHA256 c1181788a9dfab5e3934e67e65984e735e1b22cce7b8383d1df416f66491fd03
  alongside the existing successful executable hash in the hardware regression.
- DUAL-20 is on D: with verified SHA256; its generated-project dual-nozzle
  physical acceptance remains the next check before closing H2D dual work.

## 2026-09-21 — Dev-map documentation consolidated; handoff written

- DEVELOPER-CONTEXT.md now owns the map's intent: purpose, scope and active
  callers, the functional tree, page principles, findings policy, the three
  code-shape rules and the rewrite criterion, all as settled with the owner
  today (recorded as D-038). dev-map/README.md is reduced to mechanics:
  commands, addresses, page fields, staleness, authoring, checking, viewer.
  The AGENTS.md "Dev maps" section and the BUILDERS.md map contract are
  pointers with the reading rules only. BR-052 restated against the new
  intent with the remaining queue.
- New dev-map/HANDOFF.md: the owner's standard in their words, the concrete
  rulings behind each change, the code-shape criterion per pattern, what has
  landed by commit, what is in flight, the remaining work in order with
  rationale, how the work was run, and the open questions.
- Line counts: AGENTS 202 → 190, BUILDERS 421 → 399, DEVELOPER-CONTEXT
  113 → 127, dev-map/README 473 → 178; the four owners 1209 → 894, or 1087
  with the new handoff. Developer and builder onboarding still resolve.

## 2026-09-21 — Dev map: name-keyed function tables become registry entries

- `couplings.mjs` recognises a named table of functions — a `const` object
  literal, a `Map` filled with literal keys, or the object (or array element)
  a factory returns, named by the factory's path — and emits one
  `registry-entry` coupling per entry, labelled `<table>.<key>`, with lookup
  sites (`table[name]`, `table.get(name)`, `name in table`) appended as
  evidence. Computed keys and spreads are recorded as analysis-limit rows.
  Table couplings carry `table: true`; `regions.mjs` no longer counts a
  table's owner as called by its own entries.
- 48 tables, 212 new couplings (216 total, was 4); the export dialect
  registry's four are byte-identical. Islands (declaration pages with no
  caller and no coupling) 187 → 117. Largest tables: `createBundleWorkflow`
  17, `createAgentRequests` 15, `createTour` 13, `moveStore::methods` 13.
  Not recognised, by design: two-level tables whose entries are objects
  (`studio/app.mjs::views`, `registry.mjs::adapters`), tables built by
  assignment (`createStudio`), and array-of-pairs `LuaTable.from`.
- Verified after `regenerate 0`: `check` exits 0, 1621 pages, 3552 linked,
  1079 unresolved, 47 outside, 5807 platform, no stale, unplaced or orphan
  facts; `standardLibrary::tonumber` carries its incoming registry coupling.

## 2026-09-21 — H2D authored stored sections, routing and variant controls pass

- User confirms AMS-14 passes two colours and AMS-15 passes. These independently
  reduce saved routing and High Flow table rows from successful AMS-10, retaining
  other working fields. They do not validate the entire generated project.
- H2D revision 23 / contract v13 / project schema v2 now stores the exact authored
  startup and shutdown strings also used by the executable. Export and strict
  import share the materializer; no copied reference project or vendor template
  is loaded. Remaining template fields are empty. This is a repair candidate:
  AMS-13 identified a failing nine-field family, not the required individual key.
- All 31 targeted Bambu tests pass, including stored/executable equality across
  nozzle/plate/temperature choices, fast startup, tamper rejection and exact
  preservation of physically successful colour/dual executable hashes.
- Fresh normal bundles: AMS-19-GENERATED SHA256
  30044f96b878e81bcc26795cef425658da60961c10f76096a0503c45b5d4beae;
  DUAL-20-GENERATED SHA256
  2a3007ea7fbc8251d199088ebfca4db630ebfd2133c1d4d675eddcdd04f25744.
  Both pass strict reopen; neither has a reference-entry substitution. Both
  physical results are pending. D: unavailable when prepared; no USB copy claimed.

## 2026-09-21 — Dev map: active outside callers, scope-edge arrows, findings on the boxes that draw them

- `dev-map/lib/scope.mjs` gains `activeCallers`: catalogued skill
  implementations (`skills/<id>/scripts/*.mjs`, no demo or example files),
  `adapters/mcp/src`, `core/agent` and `scripts/agent-toolkit.mjs`. A caller is
  active when it runs while a person makes a part or operates Studio. Active
  outside callers are listed on declaration pages and code reads by
  declaration path with `unmapped: true`; inactive ones (skill tests and
  demos, benchmarks, the Bambu audit) are counted per directory in
  `outsideCallers` and still counted at the root.
- Calls leaving the mapped roots are drawn at every level: `out:<root>` ports
  and wires on root, region, file and group pages (root: core/print → skills
  ×47), outside invocation boxes on function pages name their target path,
  and `external` is replaced by `outside` (47) and `platform` (5807).
- The rolled-up `uncertaintySummary`/`unresolvedSummary` are gone. A
  containment map carries each drawn declaration box's own finding rows,
  identical to the node's page, and one integer on a group or file box.
  Declaration pages are unchanged: 13 829 finding rows before and after.
- Verified after `regenerate 0`: 143 declaration pages list an outside
  caller (411 rows), 96 inactive callers counted, 16 structural pages draw an
  outgoing outside port; `core/geom/query.mjs::topAt` lists four skill
  callers beside five mapped ones; `8.2` boxes carry the same rows as their
  own pages. `check`: 1620 pages, 3550 linked, 1079 unresolved, no unplaced
  or orphan facts. The store reports stale on `core/export/bambu-project.mjs`,
  which another session is editing at the time of writing.

## 2026-09-21 — Code shape, second pass: dead accessors, parameter mutation, callable closure state

- Deleted `LuaRuntime::getGlobal/setGlobal/hasGlobal` (no caller anywhere;
  authored membership removed from `flows/export.json`).
- Rule 3 (a stage does not mutate caller-owned state), 40 sites judged:
  rewritten in `fitLineWidthToSetup` (returns the plan, a copy when fitted;
  both resolvers in `resolve-plan.mjs` return it), `toolpath-view.mjs`
  (display memos moved off view/group records into `createToolpathMemo()`),
  and `server.mjs` (`annotateSourceSkew` → `noteSourceSkew` +
  `reportedMessage`, the note kept in a module `WeakMap` instead of on the
  Error). Left as the controller exception: `createTour::enter/
  editLessonBaseline/ensure`, `app.mjs::applyProgress`,
  `createTourUI::acknowledgeView`. Awaiting the owner: `drawMachineCanvas`
  (Canvas 2D `ctx` property writes, bracketed by save/restore) and the seven
  sites in `bambu.mjs::completeProgram` (genuine violation, file owned by a
  concurrent session).
- Rule 1 (no callable or state in a reassigned binding): 163 written
  captured bindings across 49 factories enumerated; exactly one held a
  callable (`geometryProject` in `createViewerRenderer`), now the
  `picking` record. The rest are controller state, accumulators, caches and
  cursors and stay as they are (triage table in the worker report).
- Verified: `node --test` on dobot, export, workflow, studio-material,
  printer-profiles, studio-generation-control, studio-open, studio-lifetime,
  studio-tour-lifetime, regional-workflow: 54 pass, 0 fail; A/B checks of
  the toolpath memo and viewer pick paths identical to HEAD. `check`: 1620
  pages, 3550 linked, 1079 unresolved, 5807 external, no stale, unplaced or
  orphan facts. The checkpoint also carries concurrent Bambu hardware
  regression work from another session.

## 2026-09-21 — AMS-13 fails; stored template family is necessary in the working control

- User reports "AMS-13 is all orange" and asks whether the reusable generator
  is done. Clarified explicitly: a generator was written, but its v12 metadata
  fails; the reusable exporter fix is not complete. Guidance and regression
  updates do not change that status.
- AMS-13 differs from successful AMS-10 only by clearing nine nonempty stored
  template fields in project_settings.config. Every other archive entry and
  serialization is unchanged. That reduction independently breaks colour
  switching; it does not identify the particular required field or establish
  that firmware executes template contents. Routing/variant controls remain
  useful independent tests. User advised to continue AMS-14.
- Prepared three independent reductions of failed AMS-13, with every executable
  and other archive entry unchanged: AMS-16 restores only machine_start_gcode;
  AMS-17 restores only change_filament_gcode; AMS-18 populates only
  machine_start_gcode with the exact SAAM-authored startup already present in
  the successful AMS-10 executable. All other stored G-code fields remain
  empty in AMS-18. This tests a direct authored replacement, not merely which
  copied field works. No shared exporter behavior changed on an unverified guess.
- Candidates in Prints/bambu-h2d-ams-template-isolation-16-18; SHA-256 values:
  - AMS-16-START-ONLY: af72b812579e9b15b2e220a2fb6d15e9472283b9d8fc7356ec23ff55cf2c59c2
  - AMS-17-CHANGE-ONLY: d6e68ea7822b946ef6042bd392580399d4e25bf761e0dbbf6127ec0296f296da
  - AMS-18-SAAM-START: 48c6385d14c4d99e5496ad342d971afa9aae376d76c636cfc2e23739be6c64ae
  D: is unavailable; these have not been copied. Prioritize the authored AMS-18
  candidate once the USB returns; 16/17 isolate the field if needed. All physical
  results are pending. A passing generated replacement remains necessary before
  declaring the ordinary dual/multicolour workflow repaired.

## 2026-09-21 — DUAL-12 physically passes; maker workflow and executable regression

- User reports: "Test 12 is a pass! We have dual-nozzle!" The delivered
  DUAL-12-PROJECT-CONTROL archive is SHA-256
  bef010be5cd763a86fecfc6432fc8eeef6ca4d1190e7021bdb1d3d8edb13c036.
  This establishes the controlled left 0.4/external PLA -> right 0.8/AMS blue ->
  left sequence, fast startup, separated pads and their expected deposition
  heights. The user is continuing AMS-13; no result for 13/14/15 is assumed.
- Preserved fact-only hashes and human observations for AMS-10, DUAL-12 and
  failed AMS-11 in the H2D hardware fixture. Added the exact DUAL-12 geometry
  and setup as a reusable test fixture. A regression regenerates both working
  controls' executable streams through the shared planner/exporter and matches
  their physically tested SHA-256 values, with the expected filament sequence
  and dual deposition stages. It passes. It deliberately does not transplant
  or approve the reference project entry.
- Added maker dual-nozzle setup/review instructions and a left-first mixed
  diameter recipe fragment to core/export/bambu.md. It distinguishes logical
  filaments, nozzle sides, heater selectors and AMS devices; explains per-nozzle
  process settings, regions/STLs, return switches, fast start, no tower and
  physical verification. The shared print-tools guide links it, covering the
  maker-context-map.html onboarding route. Machine-facing limitations now
  record physical controls passing and the generated project writer failing.
- The portable exporter is not yet repaired: DUAL-12 used the same substituted
  project entry as AMS-10; AMS-11's authored project failed. Keep the tested
  executable unchanged while isolating which project representation changes
  are necessary. Any required project/header duplicates must still derive from
  the canonical job, with explicit per-filament/tool/variant projections.
  Metadata field count or software consistency alone is insufficient evidence.
  Next: incorporate AMS-13/14/15 results into the project writer and verify
  fresh generated dual-nozzle and same-nozzle colour files.

## 2026-09-21 — Dev-map scanner: super, pattern defaults, receivers, callbacks, outside roots, subscribers

- `super(...)` resolves to the extended class (a `construct` edge, or an
  external `super-of-unbound-class` for platform classes); calls inside
  destructuring pattern defaults are collected; member calls on class
  instances and on records are followed one static selection further
  (`valuesOf`/`memberValues`), with a `possible` mark where the member holds
  a callable rather than naming a method; `new C()` of a package import is
  proven external. Parameter-call rows carry the supplying argument's
  location in `resolution` and, where unresolved, `candidates`. Receiver and
  callable resolution now runs for every scanned root, giving 33 new edges
  into mapped code (skills 19, core/agent 9, adapters 5). A callee iterated
  from a closure-local collection filled by a registration function reports
  `registered-subscriber` naming the registering declaration.
- Verified after `regenerate 0`: `check` exits 0 with 1616 declaration
  pages, 3545 linked, 1075 unresolved (971 member-receiver, 101
  parameter-target, 2 registered-subscriber, 1 local-value), 5800 external,
  no stale, unreached or orphan facts; reciprocal caller entries hold for
  every resolved binding. Sites read in source by the worker for each rule
  are listed in its report; `createAgentRequests::notify` now names
  `subscribe` as the registration.
- Deliberately unresolved: `res.end/write` on node:http parameters, members
  on reassigned `let` receivers, a policy assembled by spread, `this` inside
  object-literal methods, and `now()` whose only known value is a parameter
  default.

## 2026-09-21 — Dev map: one collapse rule, nested helpers homed with their holder, constructors folded

- One rule decides map or code: an address is a map when its drawing shows at
  least two boxes with a wire on them. File pages exist only under ungrouped
  regions and only when they draw; a region page draws a collapsed file's
  declarations in its place, and a file fact row homes on the region page when
  the file has no page. A code read also carries the boxes it would have drawn,
  so the walk continues through it.
- A declaration written inside another is homed by its holder, on the holder's
  page, and is rejected as an authored member elsewhere (the rejection names
  the holder). A class is its construction plus its members: `Class::constructor`
  is no longer a node; `new X()` reaches the class page, which keeps the
  constructor's span, calls, wires, findings and `stateFields`.
- Flows: 374 nested members, 23 never-published file-level flows and 16
  one-box groups removed from dev-map/flows/*.json; an authored group that
  would draw fewer than two boxes now fails generation; `check` fails on
  `unplaced`. The studio fragment was merged with the same-day code-shape
  renames (`beadFrame` added beside `beadSection`).
- Measured on the regenerated store: 1775 pages (was 1806); 0 single-box
  graph pages (was 37); 0 constructor pages (was 8); authored members 625
  (was 1766), of which 78 nested and all on their holder's page; unattached
  components on structural pages 14 on 10 pages (was 84 on 41); `unplaced` 0
  (was 224). `check`: 8 regions, 149 files, 1618 declaration pages, 3538
  linked, 1085 unresolved, 5797 external, no stale, unreached or orphan facts.
  Pages read to confirm: `1`, `core/export/griffin.mjs::validatePath`,
  `core/path/planning.mjs::ActionAccumulator`, the material-view beads group.
- Judgment recorded by the worker and accepted: "two connected boxes" is read
  as two boxes with a wire on one of them; the strict reading would collapse
  243 pages with real navigation.

## 2026-09-21 — AMS-11 fails; dual control and independent reductions delivered

- User reports AMS-11 is fully orange. Its executable is byte-identical to
  successful AMS-10, but the authored project writer changes 264 project field
  values. The 580-field vocabulary and passing software checks did not establish
  firmware compatibility. Maker guidance now records a known physical failure,
  not a pending first acceptance. No speculative shared-code fix was made.
  Archive comparison also finds Metadata/saam.json changed between AMS-10/11;
  the new reductions hold that context entry fixed as well. AMS-11 alone is
  therefore not a project-entry-only mutation.
- Held unprinted DUAL-12-L04-R08. Prepared DUAL-12-PROJECT-CONTROL with exactly
  AMS-10's project entry; every other dual archive entry, including the complete
  G-code and checksum, is byte-identical to the checked DUAL-12. It still requests
  actual left 0.4/right 0.8, left/right/left, centre Z0.2/right Z0.3/centre Z0.4,
  fast startup and no executable tower. This tests the successful project
  representation directly against the user's physical two-nozzle goal.
- User explicitly authorized multiple tests together. AMS-13 independently
  empties nine nonempty stored G-code-template fields in working AMS-10;
  AMS-14 changes only saved map mode, filament map and nozzle map (three fields);
  AMS-15 removes unused High Flow rows from variant table families (125 fields),
  retaining three logical filaments, both physical nozzles and non-variant device,
  dryer, geometry and flush-matrix/vector lists. These are independent controls,
  not cumulative changes. JSON serialization was first proven byte-identical
  before edits. Each changes only the project archive entry; all other entries
  and the complete executable remain byte-identical to physically working AMS-10.
- All four files and BAMBU-TESTS-12-15-README.txt copied to D: and checksums
  verified. SHA-256 values:
  - DUAL-12-PROJECT-CONTROL: bef010be5cd763a86fecfc6432fc8eeef6ca4d1190e7021bdb1d3d8edb13c036
  - AMS-13-NO-TEMPLATES: 306622d136817247635c907fb819ce6cb2a344c46b6d5421859492d6f5114403
  - AMS-14-ROUTING: a5858638575905d21b50c2e0880bee5a8ae79a787ffc73a9b6a9244adfb3662f
  - AMS-15-STANDARD-VARIANTS: e0879058f837cd649dbf8dd9214bf2eac5ce78c54d160f59a264f40448b3801e
- These project-substitution/reduction diagnostics retain foreign stored
  preferences and are not maker templates. The normal strict importer remains
  unchanged and rejects them. No vendor motion or tower was inserted into the
  executable. Results are pending. Next: record physical nozzle/height sequence
  for the dual control and colour-switch results per AMS filename, then isolate
  the failing field family or interactions before changing the shared writer.

## 2026-09-21 — Code-shape findings resolved where the code hid a relationship

- Owner authorised rewriting the sites the dev-map scanner reports as
  `mutated-binding`, `unresolved-local-value`, `unsupported-callee-expression`
  or `unaccounted`, with behaviour preserved. 14 sites reviewed; 8 rewritten,
  6 left as scanner limits (core/agent's two are now outside the map scope).
- Rewritten: `surfaceRegion::sample` chooses a named chart once
  (`splinePatchChart`/`meshStripChart`); `beadSection::end` takes its normal
  from a named `beadFrame` with four named normals; `createAgentRequests` and
  `createStudioEvents` hold waiters as records settled by a named
  `settleWaiter`; `moveStore::push` constructs the two typed arrays
  explicitly; `LuaRuntime::evalCall` routes host functions through the
  existing `invoke`; `publishFinishedBoundary` and `createViewerRenderer`
  keep their late-bound state in explicit owned records. The last two made
  the ownership visible (`member-mutation`) but the call itself is still
  unresolved: resolving it would need eager construction or dropping the
  latest-wins scheduling, both behaviour changes, so they were left there.
- Scanner limits recorded, not code problems: `super(...)` callees are
  skipped by `graph.mjs`; a call inside a destructuring pattern
  (`const {frameNow=now()}=...`) is never collected; `onGeometry` in
  `runRepairJob` is supplied only by unscanned callers (tests and the
  worker side); `listener` in `notify`/`record` is a runtime-registered
  subscriber with no static target.
- Verified: `node --test` on dobot, studio-material, denso, bambu-dual,
  studio-open, studio-generation-control, studio-tour-lifetime,
  regional-workflow and mcp: 57 pass, 0 fail. Differential old/new checks:
  `surfaceRegion` identical over 121 samples, `beadSection` identical over
  864 combinations. `check`: 8 regions, 149 files, 1626 pages, 3547 linked,
  1085 unresolved, 5797 external, no stale, unreached or orphan facts.
  `dev-map/flows/studio.json` updated for the renamed and new declarations.

## 2026-09-21 — DUAL-12 prepared while AMS-11 runs

- User requested the next test in parallel with AMS-11's physical run. Generated
  DUAL-12-L04-R08 through the shared v12 exporter: left 0.4 external PLA at
  215 C, right 0.8 blue PLA via automatic right AMS matching at 225 C. Fast
  startup, Textured PEI at 60 C, no tower. The left grey swatch is explicitly a
  placeholder; its actual colour is immaterial to this test.
- Two 12 mm square coupons: centre (175,160) has left layers Z0.2 and Z0.4;
  right (235,160) has one right layer Z0.3 between them. This yields exactly
  left/right/left with two changes, rather than additional alternating layers.
  Explicit closed meshes represent the thin coupons; normal topology, bounds,
  motion, extrusion and temperature checks pass. Estimated body time is
  0.7 minutes, excluding startup and firmware service.
- Separate source decoding matches the generated program's tool/filament/move
  sequence. Assertions inspect the three deposition stages, both changeovers'
  distinct H/temperature values, package mappings, installed diameters and AMS
  connectivity. The material-change audit reports no issues. No shared code
  changed and no physical acceptance is inferred from those checks.
- Artifact: Prints/bambu-h2d-dual-fast-12/DUAL-12-L04-R08.gcode.3mf;
  SHA-256 0e55143614dd4d5d2c00d0dba10b5aa8718dfc8dfbfc3d7b62263486e16bdce1.
  D: was unavailable after preparation, so USB copy remains pending. Test after
  AMS-11 confirms the generated project writer; success must include actual
  nozzle switching, adhesion at each expected height and the return to left.

## 2026-09-21 — AMS-10 passes with mixed declarations; generated AMS-11 sent to USB

- User reports "AMS-10 works". That archive declares left 0.4 / right 0.8
  throughout, with the same executable as AMS-09. Unequal installed-diameter
  declarations are not sufficient to cause the same-nozzle colour failure.
  This is right-nozzle AMS evidence, not dual-nozzle acceptance.
- Generated AMS-11-L04-R08 from a fresh plan and the shared v12 exporter, with
  no substituted reference project entry. Executable bytes exactly match
  successful AMS-10. Canonical diameters, two colours, right-nozzle routing,
  A/B/A sequence and tower-disabled setting are checked, as are normal bundle
  generation/interpretation and material-change audit. No shared code changed.
- Copied D:/AMS-11-L04-R08.gcode.3mf and verified SHA-256
  6c159c1ab39d41aa4dced0bc5a5acc987aada98dd46ba7b7a83c1f1c113f9199.
  Same fast startup, geometry and service commands; this isolates the authored
  project representation. The unprinted equal-diameter AMS-11 is superseded.
- Next: observe both AMS-11 colour changes and first-layer contact. On success,
  return to a separated-pad left/right/left test using the accepted writer.
  General exporter hardware acceptance and physical dual-nozzle use remain open.


## 2026-09-21 — Agent CLI toolkit moved outside the dev-map scope

- Decision (project owner, this session): the dev map covers core and Studio
  product code only. The agent CLI toolkit, `core/agent`, is not in scope.
- `dev-map/lib/scope.mjs` gains `unmappedDirs=['core/agent']` and
  `outsideRootOf`; `isMapped` excludes those directories. Region discovery,
  port naming on root/region/group pages and overview anchors use them, so
  `core/agent` is scanned as an outside caller like `scripts` and `adapters`:
  never a region, page or index. `dev-map/flows/agent.json` deleted; the
  toolkit manual moved to `outsideAreas` in `core/agent/toolkit.mjs` so
  `--area core/agent` still returns it without a map target. Scope statements
  updated in AGENTS.md, BUILDERS.md, DEVELOPER-CONTEXT.md, dev-map/README.md
  and core/agent/README.md.
- Verified after `regenerate 0`: 8 regions; `check` exits 0 with 149 files,
  1617 pages, 3521 linked, 1091 unresolved, 5794 external, no unreached,
  orphan facts or stale pages; root shows `core/agent` → core/print 4 calls and
  → studio 33 calls, and its two http-routes under an `http-route` port.
- Observed limit, not fixed: receiver-value linking in `graph.mjs accountCalls`
  runs only for mapped callers, so 7 of the toolkit's 40 former call edges into
  studio (resolved through returned records) are no longer drawn. The same
  limit applies to skills, adapters and scripts today.
- Map audit findings from the same session (measured on the stored map before
  this change): 157 one-box passthrough pages; 862 of 1833 authored members are
  nested helpers listed beside their parents; 543 boxes with no wire (455 call
  boxes on function pages whose arguments and results the tracer did not
  source, 88 home nodes on structural pages); all 5035 resolved calls carry a
  reciprocal caller entry; 127 unresolved member-call sites name a mapped
  declaration and 442 sites call through a function parameter; every one of the
  1633 scanned declarations is published. Follow-up generator work is pending
  the owner's go.

## 2026-09-21 — AMS-09 switches colours; reusable H2D project writer awaits acceptance

- User reports AMS-09 changed colours. Its executable commands and every entry
  except project_settings.config were byte-identical to the failed AMS-08 ALT.
  It declares 0.8/0.8. This proves the project-entry replacement is sufficient
  for that job; no individual key or serialization requirement is isolated.
- At the user's request, AMS-10 changes only left-diameter declarations to 0.4
  across CONFIG, project JSON, slice metadata and SAAM summary, plus checksum.
  Executable commands are identical to AMS-09. D:/AMS-10-L04-R08.gcode.3mf was
  copied and SHA-256 verified as
  `188b78db273366b7d5bf40cc22d91eb7e774cebdd6570a6bb815401661ac956b`.
  Its physical result is pending. It uses only the right nozzle.
- H2D v12 adds an authored project writer and explicitly scoped compatibility
  defaults cross-referenced to Studio 02.08.02.61. Runtime has no reference-file
  dependency. Canonical job values determine all repeated installation/material
  fields; no vendor executable template, object or spare filament is retained.
  Standard-only variants and actual filament cardinality are explicit. The
  resolved slice keeps map_2; the saved project omits that slice-only field.
  This is a broader compatibility representation, not a proven minimal schema.
- Maker guidance now includes same-nozzle A/B/A setup, automatic colour matching,
  fresh-profile generation, review, fast start and physical observation. Shared
  print usage links it, so the maker onboarding route includes this guidance.
  Copying the successful diagnostic's foreign project entry is not the workflow.
- AMS-11 is a fresh v12 development bundle with two blue/orange logical filaments
  and 580 generated project fields. Its executable is byte-identical to AMS-09;
  it deliberately preserves that control's 0.8/0.8 declarations. SHA-256:
  `d01b4347c811e477123052d7e08b6068af9256d1ecfd422f4447b99e90bbf8d1`.
  Software generation checks pass; human review and physical test remain pending.
- Targeted Bambu tests pass (30), including both nozzles, mixed diameters, AMS
  changes, one/two/three-filament project cardinalities, source decoding, package
  tampering and review/delivery. These do not prove firmware routing. Next:
  obtain AMS-10's mixed-declaration result, verify the reusable writer, then
  resume physical dual-nozzle work. X1 AMS acceptance is still open.

## 2026-09-21 — Both AMS-08 variants fail colour switching; working reference confirmed

- User reports both AMS-08 variants complete entirely orange with no colour
  switch, while twocolor.twistedbox.gcode.3mf physically prints two colours.
  First-layer height was not explicitly restated. B-1 and the equal-diameter
  ALT did not resolve the failure. The investigation had continued command
  changes without closing the isolated project-representation difference.
- Created AMS-09-PROJECT-CONTROL from failed AMS-08-ALT-L08-R08, changing
  exactly Metadata/project_settings.config to the working reference entry's
  exact bytes. All G-code, CONFIG comments, MD5, thumbnails, slice/model
  metadata and sequence entries are byte-identical to failed ALT-08. Both
  declare 0.8/0.8. The body requests two changes, with fast start and no tower.
- Local diagnostic only, not a production template. It retains reference
  project preferences (green/yellow, unused third filament, Auto For Flush,
  stored tower/template settings). The slice/body still uses SAAM's two
  blue/orange filaments on the right. User maps first used filament to blue,
  second to orange. No reference executable/tower commands were inserted.
  The normal strict SAAM importer intentionally rejects this foreign entry.
- SHA-256 f18304938c88ccd63644038b3b56769812824675b22b83bd2504f12bbab83e98.
  Copied it and AMS-09-README.txt to D: with hash verification; result pending.
  Changed-field lists and byte assertions are recorded in the local diagnostic
  bundle Prints/bambu-h2d-ams-project-isolation-fast-09/comparison.json.
- A pass establishes the complete reference project representation suffices
  with this short SAAM executable. Narrow field presence, values and serialization
  next while holding G-code fixed. A failure means this entry alone is
  insufficient for this job; examine other package/startup differences against
  the working reference. Neither outcome alone identifies a required key.
  Round-trip consistency does not verify firmware ingestion or execution.

## 2026-09-21 — Dev-map indexes are places in the map tree

- Owner's model: an index names a node's home position in the map tree, not a
  file. Every studio/core declaration is a leaf on some map, leaves sit in
  authored functional flows, nesting reaches a single `0`, and a node repeated
  on another map keeps its home index with a red link on both sides.
- Before: published indexes were source addresses (region.file.declaration,
  groups at `N.0.k`, with another `.0.` per nesting level). Only 141 of 1,827
  reachable pages had an index extending the map that showed them; 148 of 150
  file pages were unreachable from `0`.
- New `dev-map/lib/tree.mjs`: after composition, walk containment maps (root,
  region, group, file) before call-flow maps; each map numbers its home nodes
  1…n under its own index. Address fields are rewritten once across all
  published pages; repeats carry `home`, home nodes carry `alsoOn`. Pages no map
  shows (148 file pages, 83 file-level groups) are not published and are listed
  as `unplaced` by `regenerate`. Source addresses stay internal (`sourceByPath`,
  source packets) for scoped reuse; store schema 4. Viewer draws `home`/`alsoOn`
  as red links. AGENTS.md, DEVELOPER-CONTEXT.md, BUILDERS.md, dev-map/README.md
  and developer onboarding text describe the new walk.
- Verified in the shared checkout (no dev-map tests remain after the test cut):
  all 1,633 declarations reachable from `0`; all 1,827 pages are home nodes on
  their parent map with gap-free numbering; no index has a `0` segment; every
  repeat names its home; no wire end names a missing page; `regenerate 3` output
  identical to a full run; `dev-map/cli.mjs check` clean; developer onboarding
  runs; viewer shows `home 4.6` etc. on `3.2.1.1.1` (DOM read, no screenshot).
  Checkpointed in 85c9bfd with concurrent sessions' work, unreviewed.
- Open: file-level flow groupings (e.g. `core/export/dobot-lua-subset.mjs`)
  duplicate their region-level groups and now draw nothing; delete or keep as
  the owner decides.

## 2026-09-21 — Same-nozzle reference received; AMS main/ALT pair on USB

- Inspected user-supplied twocolor.twistedbox.gcode.3mf, SHA-256
  c0905ff8957f685282ba66d0795765a016d2c95246ad99183989a6600fdf5127:
  62 material changes, all through right nozzle 1. All outgoing descriptors
  retain B-1, including returns to filament 0. The prior SAAM colour candidate
  changed B to 1 after its first change. v11 now keeps remapped B-1 for
  same-nozzle changes and derives the reference thermal-sync form from owned
  temperature/rate settings. Cross-nozzle behaviour remains unchanged.
- The supplied reference uses green/yellow and declares 0.8/0.8, with a tower
  and an unused third filament. SAAM retains user-requested blue/orange, two
  logical filaments, right-only deposition and no tower. No vendor header or
  project-settings blob is copied into either generated file.
- Prepared main and user-requested ALT in Prints/bambu-h2d-ams-pair-fast-08.
  Main AMS-08-L04-R08.gcode.3mf declares left 0.4/right 0.8; SHA-256
  1207e944e38dc860edd5f512a9f14457fd6f466bac56a0262e202f851dc25d2f.
  ALT AMS-08-ALT-L08-R08.gcode.3mf declares left 0.8/right 0.8; SHA-256
  995ae7697a7c697e5901844570c345e3b55d7fafb0b63332ab80b5fa87c8327a.
  Executable bytes and decoded moves are identical across the pair. Both print
  six 0.3 mm layers, two each blue/orange/blue, centred 24×16×1.8 mm. Estimated
  body time is 3.1 minutes, excluding startup and AMS operations.
- Copied both files and AMS-08-README.txt to the user's D: USB with exact
  SHA-256 read-back verification. User starts prints; no manufacturing approval
  or hardware execution was synthesized by the agent. Physical results pending.
- 28 focused checks pass, including two changes on one nozzle, both outgoing
  selectors, purge units, thermal sync, ALT executable equality, package
  round-trip and existing dual diameter/feed tests. The minimum project record
  is unchanged; omitted project-settings dependency remains unresolved.
  B-1 is a reference-alignment change, not a proven cause of earlier failures:
  wrong nozzle/Z occurred before the first colour change, when B was already -1.

## 2026-09-21 — Shift the next hardware test to H2D same-nozzle AMS colours

- User reports dual-project-identity-fast-06 failed: nothing adhered to the bed
  and dribbling material was seen at the right nozzle. The print was not watched;
  elevated Z and right-only execution are suspected, not directly confirmed in
  this run. Adding project name/from/version alone has not repaired the dual job.
- User explicitly shifts the immediate investigation to same-nozzle colours;
  dual-nozzle support remains an outstanding goal. Confirmed test colours are
  blue and orange (correcting the earlier brown description). Planned sequence
  is blue → orange → blue on the right 0.8 mm nozzle, with fast startup and no
  prime tower. No AMS slot numbers requested.
- H2D v10 implements the same-nozzle branch in the shared regional change
  writer, using one 300 mm³ profile purge policy converted to filament length
  for both M620.10 descriptors. H2D firmware owns flushing; no duplicate explicit
  E flush is emitted. Existing dual-nozzle changes retain L0. Summary counts
  now count only same-nozzle changes as colour flushing. External-spool material
  changes are rejected. Installed H2D template dated 20260528 and upstream
  GCode.cpp provide command/unit evidence, not physical validation.
- Ten focused tests pass: H2D colour changes and rejection, existing dual
  diameter/feed cases, and X1 colour changes. New coverage verifies right-only
  body motion, 0.3 mm initial deposition, blue/orange/blue layer assignment,
  repeated logical-filament selection, descriptor volume and tamper rejection.
- Requested a dedicated Studio same-nozzle reference; existing two-colour
  twisted-box export changes nozzles and cannot establish same-nozzle behaviour.
  No new hardware success is claimed; unresolved project ingestion remains a
  material limitation before the next test is released.

## 2026-09-21 — Project JSON isolated; return to actual mixed-nozzle testing

- User reports full-gcode-config-fast-04 fails with the same wrong right nozzle
  and elevated Z, while full-project-config-fast-04 passes. Full project JSON
  suffices with the minimal 40-entry G-code CONFIG; restoring only full G-code
  CONFIG does not repair minimal project JSON. This identifies the project-file
  reduction as the relevant configuration difference in the controlled reference
  experiment. No individual omitted field or firmware parsing mechanism is proven.
- User challenged the continuing single-nozzle tests and reiterated the goals:
  working dual nozzles first, AMS colours second. The prepared three-field
  single-left identity probe is superseded without hardware testing. The next
  experiment directly uses the SAAM-authored mixed-diameter fast-05 job.
- Prepared Prints/bambu-h2d-dual-project-identity-fast-06. It adds only project
  name=project_settings, from=project and version=02.08.02.61; version is taken
  from the archive's existing X-BBL-Client-Version. Every G-code byte and every
  other ZIP entry is identical to failed fast-05. SHA-256:
  383e099acb335aaf9537ef86f8d5c812a766181423f93fb678f3422ff033c7b7.
- Expected physical sequence: left 0.4 / centre pad, right 0.8 / pad 60 mm to
  the right, left, right, left. Left uses external PLA at 215 C; right uses blue
  PLA through AMS at 225 C. Fast startup and no tower remain. Verify actual
  nozzle changes and correct-height deposition, not just cleaning visits.
- This is a clearly labeled diagnostic mutation, not a normal regenerated
  delivery: the shared interpreter/exporter is unchanged and does not accept
  the added project fields yet. If successful, implement this authored metadata
  in the canonical exporter and regenerate; if unsuccessful, broaden project
  repair on the dual job rather than extending the single-left test sequence.
  No reference header was copied into this SAAM-authored diagnostic. USB D: was
  disconnected when prepared; copy/hash verification remains pending.

## 2026-09-21 — Alphabetical minimal configuration fails; isolate configuration source

- User reports left-config-order-fast-03 uses the right nozzle at elevated
  height. Both reduced configurations fail, while the complete configuration
  succeeds with identical executable commands. Alphabetical order alone is
  insufficient. Missing information or a larger-configuration requirement is
  implicated; no particular field or count threshold is established.
- Prepared two complementary controls in Prints/bambu-h2d-config-surface-fast-04.
  First test left-full-gcode-config-fast-04: full 569-entry G-code CONFIG with
  minimal 39-entry project JSON (SHA-256
  d87f2d6ffa61970897402ae3b415a32da33651248ea853eb8506ee89ee9ee66e).
  If it fails, test left-full-project-config-fast-04: minimal 40-entry G-code
  CONFIG with full 580-entry project JSON (SHA-256
  4041bf7a6c95ee9469f2058a24842a07d1fc2ddaf6289848f85b67216dbdda50).
- The first differs from the physically successful fast control only in its
  project-settings ZIP entry. The second differs from the failed order probe
  only in that entry. Every executable byte, startup reduction, setting value
  retained on each surface, nozzle declaration and part motion is preserved.
  A pass identifies a sufficient configuration source for this reference; if
  both fail, investigate their interaction. These remain single-left reference
  diagnostics, with physical results pending and no production-header adoption.

## 2026-09-21 — Fast reference control passes: configuration differences isolated

- User reports left-reference-fast-control-02 prints correctly. Its executable
  G-code is byte-identical to failed left-minimal-config-fast-02, which printed
  using the right nozzle at elevated height. Both use the same shortened
  startup, temperatures, homing, selection and part motions. The changed
  configuration surfaces therefore distinguish the physical outcomes in this
  controlled comparison; startup reduction does not explain that difference.
- Still unresolved: omitted fields versus ordering, and G-code CONFIG versus
  project JSON. Do not identify a specific setting or firmware parsing mechanism
  as the cause yet. The prepared alphabetical-order probe changes no setting
  values, counts or executable commands and is the next test. Shared exporter
  changes and mixed-diameter acceptance follow the discriminating result.

## 2026-09-21 — Reduced configuration reproduces wrong nozzle and elevated printing

- User reports left-minimal-config-fast-02 prints with the right nozzle at the
  wrong height, reproducing both H2D failures while using the reference's
  executable commands with shortened startup. Its matching full-configuration
  fast control has not yet been reported; common startup changes remain a
  confounder until that result. Do not declare a specific missing key proven.
- Prepared left-config-order-fast-03 as the next discriminating probe if the
  full-configuration control passes. It alphabetizes exactly the same 40 CONFIG
  and 39 project entries. No value, entry count, executable command, temperature,
  nozzle map or Z move changes. This separates field order from field omission
  without introducing speculative settings. It remains a local reference
  diagnostic, not an exporter fix or dual-nozzle acceptance.
- Order probe SHA-256:
  8e9fd31cf5ebdc73871495008f4f36eff1f57f6492cb75b93309339a4e342da1.
  Archive round-trip checks verify the changed-entry set and byte-identical
  executable against failed minimal-config-fast-02. Physical result pending.

## 2026-09-21 — Packaging and producer controls pass; reduced-configuration probe

- User reports both leftnozzle-repack-control-01 and leftnozzle-origin-probe-01
  print correctly, with slow startup the only issue. This is physical H2D
  evidence against ZIP packaging or those two producer-identification fields
  alone explaining fast-05. It does not establish X1 or mixed-nozzle acceptance.
  Exact hashes and the user report are in the controls' comparison.json.
- Prepared Prints/bambu-h2d-left-config-probe-fast-02. The probe retains reference
  values but reduces/reorders CONFIG/project fields to the keys SAAM emits:
  CONFIG 569 to 40, project 580 to 39. The companion control keeps all reference
  settings. Both have byte-identical executable G-code: reference commands with
  optional leveling/flow/plate/tool-offset flags off and music/vibration removed.
  Homing, nozzle-type selection, saved compensation, heating, cleaning and Z
  registration remain. Body and shutdown are unchanged from the reference.
- Test the reduced-config probe first; if it succeeds, the second print is
  unnecessary. If it fails and the fast reference control succeeds, field
  omission/order is implicated. If both fail, the common startup reduction is
  a confounder. Both retain the reference's declared 0.4/0.4 and single-left path;
  they do not test mixed diameters. First-layer observation suffices. Results
  remain pending. No reference header or geometry entered the shared exporter.
- Probe SHA-256:
  68449ae70a29ff0ceef7e4dee404157720fc4d78230bfd40d81a178625670df8.
  Fast reference control SHA-256:
  f56dbda516e11f07829b1e7b95ee079451f1451c2556cd35fac6ea734e5861ce.
  Archive checks confirm only G-code/dependent MD5 change in the control, with
  project settings additionally reduced in the probe; retained values match.

## 2026-09-21 — Stored test suite cut to the tests that cannot be regenerated

- Premise agreed with the owner: "does this work?" can be answered by tests an
  agent writes on demand from the code. A stored test earns its place only when
  its oracle cannot be regenerated by that reasoning at the time of need.
- Four keep criteria: (1) the oracle lives outside the repository — machine,
  firmware, controller or upstream reference; (2) a safety invariant with no
  local trigger — approval invalidation, stale views, byte-identical delivery,
  manifest honesty, cancellation boundaries, lifetime and shutdown isolation;
  (3) an expensively discovered defect on its minimal fixture; (4) the MCP
  adapter surface, kept whole. Everything else is written on demand.
- Before: 200 `*.test.mjs` files, 20,928 lines, 1,182 cases. After: 42 files,
  4,152 lines (19.8%), 192 cases. Lines by criterion: 1,428 external oracle;
  1,169 safety invariants; 718 observed defects; 837 MCP. Five files were kept
  only for their criterion-3 case and trimmed to it (`studio-material`,
  `vase-wall/vase`, `vase-wall/paths`, `text/text`, `wave-overhangs/wave`).
- Removed: all of `dev-map/tests/` (analyzer oracle is JS semantics), every
  `*-stages.test.mjs` refactor characterization, Studio UI/presentation suites,
  analytical geometry/path/region suites, agent-surface tests other than MCP,
  and source-text regex tests. `package.json` drops the `dev-map/tests` glob
  and `test:maps`; `core/tests/README.md` now states the four criteria and
  lists only surviving files.
- Recovery needs no backup: every deleted file is at `git show f7ec6f6:<path>`
  (test files carrying another session's uncommitted edits recover to their
  last committed state).
- Verification: `node scripts/check-repo.mjs` passes after repairing the doc
  links this cut broke. `npm test` is 193/194 with one failure that is not from
  this change: `skills/gridfinity/tests/access.test.mjs` expects
  `toolpathApproved === false` while the new `core/print/review-state.mjs`
  projection returns `null` for an unchecked program.

## 2026-09-21 — Fast-05 fails; distinguish file recognition from firmware execution

- User reports fast-05 still starts and prints with the right nozzle at elevated
  height. Restoring early homing and adding two configuration declarations did
  not fix those symptoms. The working leftnozzle archive remains the positive
  physical control; do not ask the user to identify it again. Its SHA-256 is
  2e476df9cccd6e1b94433c9ddfc91295db9b00b9054206cfd7c4dc6c55a55be7.
- Both the working control and failed SAAM output enable M620 remapping, select
  logical filament 0 using M620/T0 H-1/M621, and command a 0.2 mm first deposition
  height. These encoded values do not establish the firmware's physical nozzle
  selection or coordinate state. A numeric first-layer-height typo is not shown.
- Official Studio desktop source gates embedded G-code configuration loading on
  producer recognition. ConfigBase::load_from_gcode_file then requires a
  `; BambuStudio` line prefix and at least 80 recognized configuration pairs.
  The working control has that marker on line 2 and 569 total pairs. Fast-05 has
  no such marker and 40 pairs. This establishes a desktop-reader compatibility
  gap, not that printer firmware applies the same gate or deliberately rejects
  SAAM. Adding the marker alone would not satisfy the desktop configuration
  loader. No borrowed header or false Studio authorship was added.
- The read-only Bambu audit now reports these necessary desktop-reader conditions
  separately from selected-field consistency. Unknown keys still count toward
  the reported total, so reaching 80 is explicitly not sufficient. Five audit
  tests pass, including the distinction between the count and schema acceptance.
- Installed Studio 02.08.02.61 CLI --help works, but attempted --info imports
  yielded no diagnostic output; an explicit process wait reported exit -6 for
  fast-05. No successful import or rejection reason was obtained. These attempts
  did not start a print or change either tested archive.
- A first-person H2C report (bambuddy issue 2800) links incorrect dispatch nozzle
  mapping to elevated printing and reports a hardware-tested correction. It is
  supporting evidence for investigating routing and Z together, not an H2D
  protocol or a fix to copy. H2D USB dispatch remains unobserved.
- Prepared two local reference controls in
  Prints/bambu-h2d-leftnozzle-origin-probe-01. Test the repack control first
  (SHA-256 fa835bca4c716bab35c6ce9a3243eebb9f4c921236ddb72661b377b66629df83):
  every one of its 17 entries is byte-identical to the working reference, using
  SAAM's ZIP writer. Only if that works, test the origin probe
  (SHA-256 a011ab35caa6184c292af7de1a1b757153898d7c04cfe3974a8c1c643d55b903):
  the G-code producer comment and 3MF Application identity change, plus the
  dependent MD5. Configuration and executable bytes remain identical. This
  staged comparison separates packaging from the identification fields as a
  group. Both retain the reference's full startup and need only first-layer
  observation; physical results are pending. These are diagnostic reference
  copies, not SAAM-generated geometry or borrowed exporter headers.

## 2026-09-21 — Corrected interpretation of homing evidence and fast-05

- User challenged the claim that missing homing explains the elevated part:
  SAAM has printed correctly on this H2D many times, and full-04's front purge
  was at the correct height. The agent's earlier explanation overstated the
  evidence. Full-04 lacks an early X/Z block, not all homing or Z calibration;
  it retains later conditional G28 R, G383/G39.1 operations, compensation and
  front-purge registration. The early omission was already documented as H10.
- No exact previously successful SAAM archive has yet been correlated and
  compared with full-04 to identify the regression. Successful older prints
  must not be discounted because that artifact-level comparison is missing.
- Fast-05 changes three groups relative to full-04: fast-start policy, restored
  early homing, and added CONFIG/project declarations. Its body and shutdown
  are unchanged. It is not a single-variable causal experiment; a successful
  result would validate that combination only. Neither homing restoration nor
  multi-material metadata has been proven to fix the physical routing/height.
- Export, audit and playback checks establish encoded intentions and consistency,
  not the printer's actual active nozzle, coordinate transforms or AMS routing.
  The height/routing root cause remains unknown. A wrong active nozzle/offset
  state is a hypothesis connecting the two symptoms, not a measured finding.

## 2026-09-21 — H2D fast-05 restores initial homing after full-04 retest

- After repairing the pinched left-feed PTFE tube, user reports full-04 now
  completes its motions without freezing, but prints both pads using the right
  nozzle at elevated height. It visits the cleaning station at changes without
  switching nozzles. Initial left-feed suggestion remains a one-slot AMS; user
  manually selects external. The obstruction explains the change in stalling
  behavior, but routing and height failures remain.
- User requested another H2D test with fast start. H2D v9/revision 19 restores
  initial X home, wipe/park and the M1009-bracketed Z home before initial load,
  matching the working left-only Studio reference's essential homing sequence.
  The earlier H10 omission had persisted even in full-04. Fast mode now retains
  this sequence while omitting optional calibration/vision/vibration blocks.
  No arbitrary numerical Z compensation or forced physical T index was added.
- Both Bambu outputs now declare single_extruder_multi_material=1 and
  printer_technology=FFF from the resolved job into CONFIG and project JSON.
  The installed common profile and H2D reference supply evidence for these
  declarations; whether they correct firmware routing is not yet established.
- Generated Prints/bambu-h2d-mixed-nozzle-fast-05, SHA-256
  99148aefa414cd763c5d3087173002271c9fd194ca7a1cdc9480c6029df57863.
  Its complete print body is byte-identical to full-04: centre left 0.4,
  offset right 0.8/blue, four switches, no tower. Startup is fast with restored
  initial homing. Audit reports no selected-field inconsistencies. 31 targeted
  Bambu/dual/X1/audit tests pass, including homing-before-load in full/fast modes.
- Studio server opened at http://127.0.0.1:56084; browser navigation was denied.
  Human review/export and physical acceptance are pending. Do not report either
  the nozzle selection or actual print height fixed without the hardware result.

## 2026-09-21 — Left-only Studio control succeeds; left feed obstruction corrected

- User reports the untouched leftnozzle.gcode.3mf prints correctly on H2D
  (reference SHA-256
  2e476df9cccd6e1b94433c9ddfc91295db9b00b9054206cfd7c4dc6c55a55be7).
  They found and corrected a pinched PTFE tube that prevented filament from
  advancing through the left external feed. They report that the printer had
  consequently treated the left external spool as unloaded. This physical
  obstruction is a confounding factor in the earlier H2D failures; it does not
  yet establish which routing, height or freeze symptoms it explains.
- User is repeating the unchanged full-04 archive after the repair (SHA-256
  a8623e7bcbbf4776b8319e32d596aafe92e796883abd2e8dc219e32c00dd60e5).
  Result pending. Preserve the executable and settings for this comparison.
- X1 is no longer available. Continue hardware testing on H2D: first verify
  left/right mixed-diameter execution and resumption after switches; then
  verify AMS colour changes. H2D same-nozzle colour changes still need an
  implemented service contract and verification. The failed X1 result remains
  unresolved; H2D success would not count as X1 physical acceptance.

## 2026-09-21 — Inclined bridge follow-up and transverse second course

- Nave requested two-loop supports, 4 mm rise, +/-Y spans, increased bridge flow,
  uphill/downhill one-way end-attachment comparisons, and a matched singleton
  second layer along +/-X. Subsequent corrections set low rims to 2 mm and all
  non-circular spans to 24 mm; circular spans retain 12 mm.
- Bridging now accepts an optional one-way end-attachment record for independent
  overlap, speed, press, jog and flow. A later course can explicitly name an
  earlier bridge as nominal strand support. Attachment checks interpolate its
  actual 3D segments; they do not promote gaps into a filled supporting sheet.
  Existing wall producers and shared composition/export remain unchanged.
- Local Array 02 contains 16 specimens, 17 bridge courses, including 100/120%
  references and one second-layer specimen. Export checks verify 1,160 wall
  circuits, 1,170 straight spans, direction/flow, matched first layers, directed
  returns and continuous paths. Whole-stack excursion is at most 4.16667 mm.
  Six bridge and twelve lifecycle tests pass. Preview motion estimate 71.6 min;
  no Array 02 physical results yet. R001 photos and operator findings are retained
  separately in the local print-test program.

## 2026-09-21 — X1 AMS failure; H2D dual-nozzle work remains first priority

- User physically tested the approved X1 fast-01 archive (SHA-256
  09b38dfef9515d83292b9e0d45f5dc7cd6bb169c96be9ec6069e04d2809524b8).
  The printer said: "The current model does not support AMS manual mapping.
  Please arrange the AMS filaments from left to right in the order of model
  filaments". After the user arranged them, the part printed entirely grey
  without the requested colour changes. Whether service visits occurred and the
  launch method are not yet confirmed. This is a failed AMS acceptance test,
  not successful three-colour printing.
- User observed some startup vibration, then explicitly deprioritized that
  observation. Priority is H2D mixed-diameter dual-nozzle execution, followed by
  AMS colour changes on either/both machines. No vibration-related executable
  changes were made in response.
- Read back the exact approved files. X1 contains M620 S1A / T1 / M621 S1A
  and then M620 S2A / T2 / M621 S2A; explicit M970/M974 tests are absent.
  H2D full-04 contains G1 Z0.2 before the centre pad and its first change is to
  logical filament 1. These are source observations, not proof of firmware
  execution. Right target 215 C still supports the first filament being routed
  to the wrong nozzle; it does not identify the cause.
- The installed Bambu common profile and supplied H2D reference declare
  single_extruder_multi_material=1 and printer_technology=FFF. SAAM currently
  omits these fields and machine_start_gcode configuration text. Their absence
  is a compatibility hypothesis, not a demonstrated firmware requirement or
  proven explanation. Do not add guessed routing overrides or misattribute
  SAAM output to Bambu Studio to mask the failure.
- Requested the untouched leftnozzle.gcode.3mf USB first-layer control with
  left external selected. Requested an X1 three-colour Studio reference for
  secondary comparison; it is not a prerequisite for continuing H2D work.
  Preserve failed artifacts and approval hashes for controlled comparisons.

## 2026-09-21 — X1 three-colour AMS test and H2D full-start failure

- User requested a second machine test: X1 Carbon, 0.4 nozzle, fast startup,
  exactly two AMS changes white -> grey -> black, and confirmed all PLA with
  Textured PEI. Added X1 v5's single-nozzle material-change contract, without a
  prime tower. H2D same-nozzle material changes remain unsupported.
- Authored an X1 cutter/load/chute-flush/wipe/handoff recipe using the installed
  X1 0.4 change_filament_gcode (20251031) as protocol comparison. Each change
  flushes 300 mm3 plus 2 mm filament priming; this is a bounded test purge policy,
  not a colour-purity guarantee. All M620/T/M621 selectors use logical filament
  identities. Incoming retraction follows its own process, including when it
  differs from the outgoing material on the same physical extruder.
- Shared planning, body export, source interpretation and package quantities
  support these changes through the existing regional selections. Studio shows
  separate chute-purge allowance. Added the new player module to Studio's
  explicit browser module allowlist after the first UI verification caught the
  missing route; no unrestricted file-serving route was introduced.
- Prepared Prints/bambu-x1-ams-white-grey-black-fast-01: centred 18 x 12 x 1.8 mm
  coupon, 0.6 mm colour bands, nine layers, two changes, 215 C nozzle / 60 C bed,
  fast startup, all feeds auto-matched by material/colour for user confirmation.
  SHA-256 09b38dfef9515d83292b9e0d45f5dc7cd6bb169c96be9ec6069e04d2809524b8.
  Body time 139.99 s, body volume 394.44 mm3; service time/material additional.
  Studio loaded the complete toolpath after the browser module fix. Human
  settings/toolpath approval was recorded at 2026-09-21T20:51:57.811Z for this
  exact hash; the UI showed Export again and Download reviewed file. No
  physical print result is claimed.
- Validation: 41 targeted tests pass (39 existing Bambu/dual/audit/source/Studio
  checks plus two new X1 cases). New checks cover exact change order, actual
  purge volume, same-nozzle retraction differences, decoded band heights and
  colour IDs, archive tampering, external-feed rejection and insufficient lift.
- Meanwhile user reported H2D full-04 reproduced the elevated first pattern and
  freeze exactly. Right nozzle stayed active at target 215 C (the first/left
  filament's requested temperature), while left cooled after startup. Left
  target was not displayed and remains unknown; do not record assumed target 0.
  Fast startup is therefore not required to trigger this H2D failure. Next
  independent H2D comparison remains the untouched Studio left-only USB file.


## 2026-09-21 — USB external-feed default observation during full-04

- While testing full-04, the user clarified that the printer correctly defaults
  right to blue AMS, but defaults the left filament to a one-slot AMS. They
  manually change left to external spool before confirming. Record this
  distinction: the final confirmed screen is correct, its initial left default
  is not. The full-04 physical result is still pending.
- Checked the exact full-04 archive: extruder_ams_count is
  [1#0|4#0, 1#0|4#1], identical to the supplied left-only Studio reference.
  This declares no left AMS devices, not a one-slot device on left. Source
  external is currently serialized only in SAAM's intent manifest/review, not
  a demonstrated printer-consumed dispatch field. The export cannot claim to
  force automatic external selection. Do not replace default_ams_type with an
  invented external selector: Studio defines it as a timing-estimate enum.
- Next: record full-04 hardware outcome, then compare the untouched Studio
  left-only reference's USB default and actual first-nozzle behavior if needed.


## 2026-09-21 — Centre-pad failure confirmed and calibration identity correction

- User tested approved fast-03 (714b84745c27efc33f627025728548405fb01e82f255b78d12539a1e21923522):
  right 0.8 physically traced the centre pad intended for left 0.4, above the
  plate, for one layer, then stopped with the head over the centre pad. The job
  was cancelled before temperatures were recorded. G1 travel did not resolve it.
  First changeover is the next planned service boundary, not a proven stall line.
- User supplied leftnozzle.gcode.3mf, SHA-256
  2e476df9cccd6e1b94433c9ddfc91295db9b00b9054206cfd7c4dc6c55a55be7.
  Its maps 1,1 / 0,0 and used nozzle group 0 confirm left-only intent. Initial
  M104 T1, G151 P1 and remapped T0 H-1 match SAAM's selected-left expressions.
  No physical result for this reference is established. Its declared diameters
  remain 0.4/0.4; they do not override the reported installed 0.4/0.8 pair.
- Found a separate duplicated startup defect: M620.17 assigned both physical
  extruders the initial temperature and hardcoded filament 0, while G383* also
  hardcoded L0. H2D v8 now resolves these fields from actual ordered filament
  use and the machine physical-extruder map; unused nozzles use the vendor's
  declared-filament-0 fallback. The initial G383* L follows the selected logical
  filament. Source GCode.cpp explicitly reorders first_filaments physically.
  This calibration branch was disabled in fast-03 and is not its root cause.
- Added independent audit checks for calibration filament/physical-extruder and
  temperature mismatches; regression checks cover opposite-side temperatures,
  both J1/J2 branches, nonzero selected IDs and unused earlier declarations.
  Targeted exporter, dual-nozzle, audit and source-player checks pass (34 unique
  tests across focused runs). Approved fast-03 bytes were not modified.
- User then explicitly requested the next SAAM test without fast start. Prepared
  Prints/bambu-h2d-mixed-nozzle-full-04, fast_start=false with bed leveling,
  flow calibration, plate detection and tool-offset calibration explicitly on.
  The G-code body is byte-for-byte identical to fast-03; normal startup scans,
  vibration checks and music are present. H2D v8's corrected calibration identity
  is also included, so this is not a pure fast_start-only A/B comparison.
  Cold interpretation and independent audit pass. Export SHA-256
  a8623e7bcbbf4776b8319e32d596aafe92e796883abd2e8dc219e32c00dd60e5.
  Presented in refreshed Studio for human settings/toolpath review; approval and
  hardware result remain pending at preparation. No change was made to fast-03.
- Pending independent comparison: start the untouched left-only Studio reference via
  the same USB flow and observe its first layer/nozzle/height. No additional SAAM
  test is presented as a routing or freeze fix. AMS mapping and mixed-nozzle
  execution remain unresolved; heater readings at any subsequent stop are needed.


## 2026-09-21 — H2D second failure, feed-rate audit and separated diagnostic

- The user confirmed fast-02's USB mapping screen explicitly selected external
  left and blue AMS right, but the printer physically loaded another AMS slot.
  It started with the right nozzle, deposited one layer several millimetres above
  the plate after a correctly placed front purge, then appeared to freeze while
  reporting Printing. Which pad it traced and heater readings remain unknown.
  Previous prints on this machine did not freeze; AMS routing has never worked
  correctly for the user. The header correction did not resolve these symptoms.
- Fast-02 was actually approved and delivered in Studio at 19:46:39Z, hash
  6447f187172833bd3d76d743fa72be424f02defae8c0662dd6f51dd14e24b202.
  Audited its exact archived G-code: deposition 16.664–40 mm/s, travel up to
  120 mm/s, Z travel 10 mm/s; decoded body total 31.34 seconds. Minimum-layer
  slowdown is zero and M220 is 100%. No body G4 dwell. Temperature waits and
  firmware nozzle-change synchronization remain possible stop points; service
  time is not included in body timing. Slow commanded motion is not the cause
  of a sustained stop in these body moves.
- Bambu bodies now use G1 for travel, matching the supplied H2D Studio body.
  H2D v7 / X1 v4 pin that choice; the shared writer keeps G0 as the default for
  other dialects. Interpretation rejects G0 in this new body contract. This is
  a bounded compatibility change, not proof that G0 caused the elevated layer
  or the stop. Static H-1 selectors are retained: Studio source explicitly uses
  -1 when dynamic nozzle mapping is disabled.
- Prepared Prints/bambu-h2d-mixed-nozzle-fast-03 with the intended first left
  pad centred at (175,160) and right/blue pad centred at (235,160). Both remain
  8 x 8 x 0.6 mm, four changes, fast startup, no tower. Production generation
  passes; SHA-256 714b84745c27efc33f627025728548405fb01e82f255b78d12539a1e21923522.
  Local-user settings/toolpath approval was recorded at 20:13:37.518Z and Studio
  delivered the same hash. Physical acceptance remains pending.
- Validation: all 38 targeted exporter, dual-nozzle, archive-audit, source-player
  and Studio-settings tests pass across the focused run and the corrected
  bounds-tamper test rerun. The new assertion checks explicit first-layer G1
  descent and rejection of a G0 substitution. General Griffin source playback
  retains its existing output and passes.
- Next evidence: identify the first physical pad/nozzle and any stop position,
  plus actual/target heater readings. Request a small single-left-nozzle Studio
  export for comparison: both supplied H2D references start on the right, leaving
  left-first startup without independent reference coverage. AMS/USB dispatch
  and physical mixed-diameter acceptance remain open.


## 2026-09-21 — USB filament header correction and reusable Bambu fast start

- The user reported the delivered mixed-nozzle test failed: USB print-screen
  mapping correctly selected blue, but a different AMS slot loaded. Startup
  reached the print position and stopped without an error; the screen said
  Printing. Heater readings and whether any pad was deposited remain unknown.
- Found a concrete cross-surface mismatch: the generated header used
  `filament: 2` as a count, whereas the reference describes IDs `1,2`. Corrected
  the header ID list and per-used-filament length/volume/weight/diameter/density
  arrays from interpreted usage. The audit now flags the exact previous file.
  This is a candidate explanation for routing, not proof of the stop cause.
- H2D v6 / X1 v3 add `setup.bambu.fast_start`, default false: supported optional
  calibration flags off, machine-owned optional music/vision/vibration blocks
  omitted, explicit conflicting calibration-on requests rejected. Necessary
  homing, Z registration, saved compensation, heat waits, loading, wipe and
  prime remain. Guidance and Studio recipe review expose the option.
- During retest preparation, the concurrent bundle-manifest change dropped a
  non-enumerable geometry artifact when cloning restored state. Preserved that
  property so generation does not write an unreadable manifest. Updated the
  two affected exporter/source tests to use the manifest program path.
- Validation: 38 targeted Bambu, audit, mixed-nozzle, source-player and Studio
  settings tests pass. Original failed delivery now reports the header defect;
  the replacement passes cold interpretation and the selected-field audit.
- Prepared `Prints/bambu-h2d-mixed-nozzle-fast-02`: same two pads and four
  changes, blue/right 0.8 and external/left 0.4, no tower; fast startup enabled.
  Export SHA-256 `6447f187172833bd3d76d743fa72be424f02defae8c0662dd6f51dd14e24b202`.
  Studio shows the checked production toolpath and Confirm settings & export;
  approval and physical execution have not been claimed. Next observation is
  actual feed selection and pad deposition; if it stalls, record both actual
  and target nozzle temperatures and whether it stopped above or at the pads.

## 2026-09-21 — Bridge-only recipe and S5 test array

- Nave requested standard one/two-loop walls with no infill, roof or floor,
  and a custom recipe owning only bridge spans and attachment motions.
  Added the bridging skill through the existing plan/composition/export path;
  no wall generator or new scheduler was introduced.
- Two sampled rim rails produce straight XYZ spans, alternating continuous
  paths or one-way diagnostic returns, supported overlap/lead/jog/press,
  and separate attachment versus unsupported speed/flow. Generation checks
  attachment coverage against emitted planar strokes and whole-bridge Z extent.
- The earlier local thin-frame full-fill preview lost long single walls through
  offset collapse; its prior geometry/export checks did not establish intended
  wall coverage. Rebuilt the local S5 array using standard planar-infill guides.
  Inclined supports are hollow towers rather than a closing wedge shell.
- Evidence: four bridge tests and twelve workflow tests pass. Independent local
  G-code checks cover 1,884 complete wall circuits and 960 straight spans over
  24 specimens; continuous cases have zero internal travel, diagnostic cases
  have 31 returns each. Export checks pass without short-travel warnings.
  Physical results remain absent. Compact records and exact recipe/program are
  in ignored `Prints/test-programs/001-s5-bridging`, current bundle `array-01-r02`.

## 2026-09-21 — Mixed-diameter H2D output and delivered hardware verification

- Continued the user's startup/nozzle/plate/AMS request through actual dual-nozzle
  body output. H2D v5 adds regional logical-filament assignment and effective
  nozzle-specific process settings, preserving the separate installed diameter,
  logical material, physical heater and feed-source identities. All output
  repetitions use the resolved settings; conflicting startup aliases fail.
- Authored a bounded tower-free changeover from protocol facts cross-referenced
  against both supplied two-colour exports and the installed template. A0/A1
  use outgoing/incoming diameters and temperatures independently. The planner
  retracts, clears deposited material and enters the common nozzle area; the
  reader independently checks handoff position/debt and exact service commands.
  Incoming recovery, outgoing hotend state, count, fan and body acceleration are
  restored explicitly. No prime tower or same-nozzle material flush was added.
- Source interpretation tracks each nozzle's bounds, temperature, withdrawal,
  bead width, colour and consumption. Package usage, layer lists and nozzle
  sequence follow actual actions. Mixed layer grids no longer collide through
  their local indices or floating-point representations of the same height.
  Studio settings/playback show the active nozzle and both material recipes.
- Normal AMS choice remains material/colour matching. Auto, external-spool and
  optional unit/slot intentions are independent per logical filament. Connection
  validation rejects an AMS request on the wrong nozzle. This does not implement
  network dispatch or guarantee a printer's physical mapping. Existing profiles
  cover H2D and X1; unsupported device/output combinations remain explicit
  rather than silently treated as this installation.
- Extended device declarations after checking manufacturer capacity information:
  H2D revision 15 permits four four-slot units plus eight single-slot HT units,
  each connected to its declared nozzle. X1 revision 4 permits four connected
  devices total, including HT; that combined limit is conservative. HT requests
  have their own identity and never invent a four-slot tray index. Per-nozzle
  count serialization follows Studio's count parser/writer. Sources and limits
  are recorded in the Bambu contract and dev-map facts; physical HT routing is
  not established. The already approved verification archive/snapshot is unchanged.
- Validation: 64 distinct targeted tests pass across Bambu export/audit/dual
  output, regions, composition, source playback, Studio settings, material and
  renderer checks. These include all nine 0.4/0.6/0.8 diameter pairs, right-first
  output, the right nozzle's additional build area, independent feed intentions,
  altered change descriptors/temperatures/retraction/detection/acceleration,
  rejected same-nozzle switching and cold archive interpretation. Maps were
  regenerated and new declarations read back. Browser inspection showed both
  pads, blue right material and correct separate nozzle/process/source rows.
- Prepared `Prints/bambu-h2d-mixed-nozzle-verification`: two 8 × 8 × 0.6 mm pads,
  left 0.4 external PLA at 215 C / 0.2 mm layers / 0.4 mm bead; right 0.8 blue PLA
  at 225 C / 0.3 mm layers / 0.8 mm bead. Textured PEI, 60 C bed, no chamber heat.
  Blue was explicitly requested; the user said left colour did not matter, so
  #808080 is a display placeholder. Body has 228 moves and four nozzle changes,
  approximately 31.34 seconds and 78.62 mm³ deposition, excluding firmware
  service material/time; zero short-travel advisory findings.
- Studio recorded local-user settings/toolpath approval at
  `2026-09-21T19:06:41.718Z` and delivered
  `bambu-h2d-mixed-nozzle-verification.gcode.3mf`. Saved delivery SHA-256:
  `63289f90c83ca4658f9de55fd5dc6c2c1c1fe0b9ef06d1e5bf982e88a16ec6fe`.
  A subsequent cold load checked the same bytes. The archive audit found four
  nozzle changes, zero tower sections and zero issues within its documented
  field coverage. This is software evidence and human job approval, not a
  physical print result. Requested observations: mixed-diameter recognition,
  blue/right AMS and external/left mapping, startup and repeat changeovers.
- Remaining physical questions include the earlier user-requested H10 omission,
  service/head clearance, offsets and actual feed selection. Automatic standby
  cooling and power-loss recovery are not verified contracts. Broader physical
  plate/feed acceptance remains in BR-055/BR-056; the task is not declared fully
  complete from software tests alone.
- Concurrent bridging-skill work subsequently added a required plan field, so
  the old verification bundle cannot be reopened through the new strict recipe
  validator without recreation. The approved bundle was not silently migrated
  or re-approved. Direct interpretation of its unchanged delivered archive and
  saved plan/machine still succeeds (228 moves, sequence 0/1/0/1/0). Preserve
  those bytes for the physical test; recreate a current-schema preview if an
  actual requested edit is needed. A concurrent map-view generation also hit a
  missing intermediate store file; a subsequent full regeneration rebuilt the
  viewer successfully, with no stale maps, orphan facts or unreached declarations.

## 2026-09-21 — Simplification review pause: UI evidence and code-line snapshot

- Baseline checkpoint: `7160421` on `codex/remettub-dev-branch`. The selected
  simplifications are conditional Studio state reads, removal of `/api/gcode`,
  and removal of the fixed export-path/default-setup aliases. Work is paused
  after completing those changes and their existing checks; other proposed
  simplifications were not started.
- Parent-agent browser use of the disposable
  `Prints/development/studio-usage-smoke-20260921` development preview found the
  missing static-module routes recorded below. After repair and final server
  restart, geometry/toolpath viewing, play/pause, next-layer navigation and
  browser reload worked. Final reload retained the paused layer 3 position.
  This is software/UI evidence only; no human approval, delivery or physical
  print was performed. Editing the export-name field exercised a draft input,
  not a persisted plan/settings change.
- During an earlier run, concurrent source edits correctly prevented loading
  source from a stale server, but the geometry view did not visibly explain why
  the toolpath became unavailable. This remains an observation, not a new task.
- Code-line snapshot at `2026-09-21T19:00:15Z`: physical lines, including blanks
  and comments, in non-ignored `.mjs`, `.cpp`, `.html` and `.css` under `core/`
  and `studio/`; `core/tests/` counted separately. Documentation, data, build
  configuration and generated map output are excluded.

  | Scope | Checkpoint | Working tree | Delta |
  | --- | ---: | ---: | ---: |
  | Core production | 11,164 | 11,391 | +227 |
  | Studio production | 4,304 | 4,308 | +4 |
  | Production total | 15,468 | 15,699 | +231 |
  | Core tests | 11,788 | 12,026 | +238 |

  These whole-checkout totals include concurrent contributions. The selected
  task's five production files (`core/print/bundle.mjs`,
  `core/print/workflow.mjs`, `studio/app.mjs`, `studio/server.mjs`, and
  `studio/tour.mjs`) have a combined net reduction of 13 physical lines.
  The concurrent static-module-list edit in `studio/server.mjs` has zero net
  line effect. The small net reduction removes two HTTP routes and two obsolete
  exported aliases; it is not a claim that the entire checkout became smaller.

## 2026-09-21 — Retired legacy Studio source and fixed-path workflow aliases

- Removed the unused `/api/gcode` route. Studio continues to load checked,
  machine-specific source inventories through `/api/sources`, including its
  print, revision, export and per-source hash checks. Source-player coverage now
  asserts that the legacy single-source route returns 404.
- Removed the unused public `EXPORT_PATH` and `defaultSetupFile` workflow
  aliases, including shell and tour adapter forwarding. Runtime export selection
  remains dynamic through `plan.output` and `state.exportName`; remembered setup
  selection remains machine-specific through `setupFor(machine)` or an explicit
  setup file. Tests that compare saved and delivered bytes now derive the actual
  current export path from state.
- The focused 79-check run passed 78 checks and exposed one regression from the
  preceding conditional-state change: successful Studio approval retained a
  call to its removed revision metadata helper. The approval route now projects
  its compact response locally. Its isolated workflow check passes and asserts
  the preserved program, export, approval and history-omission contract. The
  broad run was not repeated because no other relevant input changed. These are
  software checks, not a physical printing result.
- Regenerating the print region widened to the root because declarations were
  removed. Generation completed with 2,014 pages, 146 files, eight bound facts
  and no stale pages, orphan facts or fact errors.

## 2026-09-21 — Studio serves every direct browser bootstrap module

- A live Studio check exposed a pre-existing startup failure: `app.mjs` imported
  `viewer-renderer.mjs`, `studio-state.mjs` and `studio-controls.mjs`, but the
  server's explicit static-file list returned 404 for all three. The state API
  remained healthy, while browser module evaluation stopped before Studio could
  register its controls or render the print.
- Added those three owned modules to the existing static route. The HTTP route
  check now fetches each module, verifies JavaScript content and compares the
  served bytes with its source. The focused Studio open and startup checks pass
  13/13. This is software validation; the repaired browser startup is checked
  separately in the live Studio.
- Regenerated the Studio map; its composition dependencies widened the scan to
  the root. Generation completed with 2,003 pages, 144 files, eight bound facts
  and no stale pages, orphan facts or fact errors.

## 2026-09-21 — Studio polling uses one conditional state read

- Replaced the browser's `/api/revision` check followed by `/api/state` with a
  conditional `/api/state` request. Full responses carry a weak ETag for the
  poll-relevant view: server instance, checked bundle/source identity, exact tour
  view and in-memory generation failure or cancellation. A matching
  `If-None-Match` returns 304 after the cached fingerprint/tour check and performs
  no stable bundle load; a changed view performs the existing stable read and
  returns its full state once. `Cache-Control: no-store` and stable-read retry
  behavior remain.
- The browser adopts that returned state directly. Approval/history-only and
  tour-metadata updates still reuse the presentation without entering the busy
  overlay; source/presentation changes, reconnects and required tour toolpaths
  retain the loading lifecycle. SSE hints, visibility/reconnect checks and the
  15-second missed-event heartbeat remain. Non-tour request records continue to
  synchronize through the existing agent-request poll; tour-relevant request
  state is included in the tour view identity.
- Removed the revision route, its unused `reviewUpdate` payload and its compact
  metadata helper. Focused server/browser tests covered an unchanged 304 without
  JSON parsing or bundle loading, real bundle edits, approval-only updates,
  tour-only updates, geometry-only reads, print switching, cached presentation,
  server restart/reconnect and event/heartbeat wiring: 62 checks passed in
  10.8 seconds. These are software checks, not a physical printing result.
- Regenerated the Studio map after replacing its removed metadata group member
  with the conditional-state identity stages. The requested region widened to
  the root because a declaration was removed; generation completed with 2,000
  pages, 143 files, eight bound facts and no stale pages, orphan facts or fact
  errors. The updated `stateTag`, `matchesStateTag`, `poll` and `refresh` pages
  were read back against current source.

## 2026-09-21 — Dual-nozzle reference distinguishes outgoing and incoming settings

- Inspected user-supplied `twistedbox.2color.gcode.3mf`, SHA-256
  `ddbea3c405b12328990c1aa6f45c106b8e6899a5807d7cc7947c23caa2835a63`.
  It declares 0.4/0.4, green logical filament 0 on the right and yellow 1 on the
  left, with 124 nozzle changes and 372 tower feature sections. These are file
  observations, not evidence that the actual unequal-nozzle machine printed it.
- The installed H2D change template uses outgoing `current_nozzle_id` for
  M620.10 A0 H and incoming `next_nozzle_id` for A1 H. Thus equal-H repetition in
  this reference must become different H values on the actual 0.4/0.8 machine.
  Outgoing feeder I and incoming load/detector I also have different owners.
- Extended `scripts/bambu-audit.mjs` to pair loads and report those fields,
  transitions, cooling/retraction observations and selected-field mismatches.
  Both the supplied dual reference and existing generated right-0.8 development
  archive produce no mismatches in those bounded checks. Two regression tests
  exercise a synthetic unequal-diameter sequence and deliberately corrupt each
  selector/diameter; both pass. No firmware service sequence was changed.
- The user excluded prime-tower implementation and confirmed the current left
  feed is an external spool. They clarified that arbitrary hardware-supported
  feed combinations across machines remain the goal; this installation is only
  a test fixture. Recorded that scope in the contract and BR-056. Requested a
  tower-disabled reference because this file's cooling and return path include
  tower-specific policy. No tower or dual-tool print program was implemented.
- Follow-up: received the replacement tower-free archive at the same path,
  SHA-256 `f6bad52dc858c7a06ebdbace77b40706d8ea8d1f9afbfac26dd4e4678d03bf86`.
  It retains 124 transitions, has no tower object/feature sections, removes the
  tower approach and uses M620.15 C220 throughout. Outgoing B selectors become
  known 0/1 after initial -1; incoming H selectors remain automatic -1. Retained
  both versions' facts by hash and revised the remaining work accordingly.
- Fixed another canonical-job limitation exposed by the reference: explicit
  logical filament entries can now name their own nozzle. All four mapping
  surfaces preserve those assignments; the selected entry must match setup.tool.
  Regression checks exercise both selected sides with actual diameters 0.4/0.8,
  opposite-nozzle declared filaments, archive round trips and contradiction
  rejection. The body remains single-tool. All 28 selected Bambu, audit,
  interoperability and export tests pass; no physical result is claimed.
- Map regeneration (root and export region) was attempted but blocked by the
  concurrently changed Studio server's stale authored reference
  `studio/server.mjs::createStudio::metadata`. This task did not edit that server
  or its map. Bambu diff whitespace checks passed; map refresh remains pending
  reconciliation of the separate Studio work.

## 2026-09-21 — Bambu startup settings resolve once; hardware acceptance remains open

- Request: current user asked for all startup duplication points, exporter and
  guidance rewrites, and one source for values repeated in G-code. They then
  required both different-diameter H2D nozzles to operate within one print.
  This is developer work; pre-existing local edits were retained.
- Implemented `core/export/bambu-job.mjs`: selected/other diameter, physical and
  logical nozzle IDs, compact variant indices, logical filament identity, plate,
  temperatures, startup flags and AMS connectivity are resolved once. Both the
  G-code config and package settings consume that record; profile overrides of
  generated fields are rejected. H2D flush/detection H parameters and the
  previously fixed AMS detector I0 now follow their actual job settings.
- The machine envelopes are `h2d-saam-startup-v4` and `x1c-saam-startup-v2`.
  Their hashes now bind constraints as well as start/end arrays. Smooth PEI uses
  its detection branch and zero texture correction; Textured PEI retains each
  model's correction. Fixed calibration A0.4 and service/unload sentinels remain
  distinct from nozzle diameter or logical filament IDs. The earlier H10 homing
  omission is retained and remains a physical acceptance question.
- Removed the shared profile's installation-specific four-tray colours and the
  inference that declaring N filaments selects physical tray N. Physical tray
  intent is now explicit in the manifest/review, and declared AMS connectivity
  rejects requests through the wrong nozzle. Four-slot connection counts derive
  from that declaration. No physical dispatch mapping adapter is implemented.
- Supplied reference: `twistedbox.gcode.3mf`, SHA-256
  `3a0cf2396c1f05862945ca740bd2e3f8cd7545d9947a3bf68a28adab97fc2459`,
  Bambu Studio 02.08.02.61. The user reports left 0.4 / right 0.8 and a four-slot
  AMS feeding the right. The archive declares 0.8/0.8, so those declarations
  must not override actual hardware. Its resolved slice selects right (map 2,
  nozzle 1, heater 0, map_2 1, Manual), while project preferences retain left /
  Auto For Flush. This corrects the earlier assumption that these modes govern
  physical manual AMS tray selection. Its plate JSON IDs are zero-based.
- The reference confirms H0.8 in flush/air-print detection and A0.4 in flow
  calibration. Its service flow is 30 mm³/s; SAAM retains its distinct bounded
  25 mm³/s service recipe. Primary vendor source and installed template
  expressions were also inspected, not copied into new reference-derived headers.
- Added the read-only `scripts/bambu-audit.mjs` report and a small sanitized
  reference-facts fixture. Full local reports and a synthetic development cube
  artifact are under `.local/bambu-startup-audit/`; the cube's unit 1 slot 1
  request is a test input, not a claim about the user's intended spool. No
  development artifact was delivered, approved, sent to a printer or printed.
- Rewrote `core/export/bambu.md` with maker setup and the full duplication
  inventory; print-tool guidance links to it. Historical spool hypotheses above
  remain history; current behavior is described at the component owner.
- Verification: 25 targeted tests passed across Bambu, interoperability and
  export suites, including both H2D tools, three diameters, both plates,
  independent other-nozzle diameter, nonzero logical filament, physical-tray
  separation, connectivity, temperature, startup flags, override/tamper rejection,
  reference facts and Studio same-file approval/delivery. These are software
  checks, not firmware/service-motion or physical-print evidence.
- Remaining: controlled left/smooth references, printer AMS acceptance and cold
  startup checks (BR-055), plus actual mixed-diameter two-tool planning,
  changeover, interpretation and physical validation (BR-056). A both-nozzle
  Studio reference was requested as protocol evidence without inheriting Studio's
  equal-diameter restriction. The overall request is not yet complete.

## 2026-09-19 — layer_filament_lists decided which tray loaded

- Source: same maker session. With the inventory declared and per-tray identity
  correct, the warnings were gone and the screen offered tray A4 brown, but the
  print still came out A1 grey — no error reported.
- `slice_info.config` carries `layer_filament_lists`, whose `filament_list` is
  the zero-based filament those layers print. This exporter hardcoded `0` while
  the startup addressed the requested position, so the layer data said the job
  prints the first tray and the printer followed it. Confirmed against the one
  reference program that uses a non-first filament: it pairs
  `filament_list="2"` with `M620 S2A` and `<filament id="3">`.
- That was the last record still describing position 0. The delivered program now
  names tray 4 in the config block, `M620 S3A`, `limit_filament_maps 0 0 0 1`,
  `<filament id="4" tray_info_idx="GFA01">`, `plate_1.json` `filament_ids [3]`
  and `layer_filament_list filament_list="3"`.
- 32 tests pass. Checks pass at 145 min and 27.6 g.
- Not established: that this program prints, or that no record remains
  inconsistent. Each of the four attempts before this one was also internally
  consistent as far as it had been checked.

## 2026-09-19 — Declared trays must carry their own identity

- Source: same maker session. Declaring four entries and naming position 3
  returned "failed to get ams mapping" again, and the revert that followed
  changed three things at once. The user: "you do have to declare the inventory,
  surely, you reverted something else at the same time". Correct on both counts.
- The inventory was right; the fabricated value in it was not. All four declared
  entries repeated the one requested colour, which asks the printer to find four
  trays holding it against a single brown spool. The reference program declares
  four entries with four real tray colours,
  `#8E9089;#8E9089;#0056B8;#B15533` against `GFA00;GFA00;GFA00;GFA01`.
- Added `outputs[].package.amsTrays` to the H2D profile, read from that
  program: the installation's tray inventory. Declared entries now take their id
  and colour per tray, so with trays known the package describes the spool in the
  selected tray and `setup.filamentColor` no longer decides what is recorded.
- Two further records still described one filament while the config block
  declared four. `slice_info.config` now carries `filament_maps` per declared
  entry with `limit_filament_maps` marking the used one (`0 0 0 1` for tray 4,
  matching the reference's `1 0 0 0` for tray 1), and its `<filament>` element
  takes the used tray's one-based position, filament id and colour.
  `model_settings.config` carries the same list.
- Verified against the reference: every package record now names tray 4
  consistently — config `GFA01`/`#B15533` at position 4, `M620 S3A`,
  `limit_filament_maps 0 0 0 1`, `<filament id="4" tray_info_idx="GFA01">`,
  plate `filament_ids [3]`. 32 tests pass.
- `amsTrays` is installation data sitting in a shared profile; it belongs in the
  local machine setup, and is recorded under BR-055.
- Not established: that this program prints.

## 2026-09-19 — The declared filament list is the AMS inventory

- Source: same maker session. With the config block and `Auto For Flush` in
  place the three warnings cleared, but the printer offered tray A4 brown on
  screen and then printed A1 grey.
- Found by looking for the closest reference rather than reasoning further: the
  operator's card holds two Bambu Studio **single-filament** H2D programs, one of
  them on the 0.8 nozzle. Both declare four filament entries, one per AMS tray,
  while keeping `; filament: 1` in the header:
  `filament_ids = GFA00;GFA00;GFA00;GFA01`,
  `filament_colour = #8E9089;#8E9089;#0056B8;#B15533`,
  `filament_self_index = 1,2,3,4`, and print tray 1 with `M620 S0A`. The grey it
  printed is the same `#8E9089` the operator was getting.
- So the declared list is the AMS inventory in tray order and the startup names a
  position in it. Declaring one entry pinned every SAAM job to tray 1 regardless
  of the screen's mapping, and the earlier `M620 S3A` against a single declared
  entry named a filament that did not exist, which is what produced "failed to
  get ams mapping". Both observations now have one cause.
- `projectSettings` declares entries up to `feederSelector`'s position, with
  `filament_self_index`, `filament_is_support` and the per-filament temperature,
  density and flow arrays sized to match, and `plate_1.json` carries the used
  position in `filament_ids` and `first_extruder`. The startup names that
  position again. Verified field by field against the single-filament reference:
  identical in shape, count and separators.
- Unused entries repeat this job's own filament, because the operator's real
  inventory is not knowable from a recipe. That is the one fabricated value in
  the package and is recorded as such in the contract.
- 32 tests pass across `bambu`, `interoperability`, `export`, `workflow` and
  `regional-workflow`.
- Not established: that this program prints, or how a printer responds to
  repeated colours across declared trays.

## 2026-09-19 — M620 takes a filament index, and the map mode must be automatic

- Source: same maker session. After the config block landed, the user rejected
  the remaining `filament_map_mode = Manual` outright and declined to keep
  test-printing. Both points were correct and both are now fixed without another
  trial.
- **Map mode.** The H2D profile was the only thing in this repository asking for
  `Manual`; the X1 Carbon profile, on the machine whose prints work, already
  declared `Auto For Flush`, and so do both Bambu Studio H2D programs on the
  operator's drive. The H2D profile now matches.
- **M620 takes a logical filament index, not an AMS tray.** Bambu's own
  change-filament code is `M620 S[next_filament_id]A`, and the reference programs
  use `S2A` with three filaments and `S1A` with two — always below the declared
  filament count. This exporter declares one filament, so the only valid index is
  `0`. `feederSelector` was feeding an AMS tray number into that field, which is
  harmless only when it resolves to 0; the X1 Carbon's remembered `{unit 1, slot
  1}` always did, which is why the defect stayed hidden. Setting `{unit 1, slot
  4}` emitted `M620 S3A`, naming a filament that does not exist, and the printer
  answered "failed to get ams mapping". The startup now emits the logical index.
- This restores the original reading that `setup.ams` does not pick a tray from
  the card, which an earlier entry today wrongly revised. The tray is chosen by
  the printer from the recorded colour, exactly as the maker said; `setup.ams`
  stays a validated record of intent. Two assertions in `core/tests/bambu.test.mjs`
  encoded the tray-as-index behaviour and were corrected.
- Added `filament_self_index`, a one-based sequence in the reference programs and
  `1` for a single filament. `filament_settings_id` is still omitted: its value
  is a preset name that would have to be extrapolated rather than read.
- Verified offline against a Bambu Studio H2D program rather than on hardware:
  all 29 emitted config keys match the reference in form, with per-filament keys
  carrying one element and per-tool keys two. 32 tests pass across `bambu`,
  `interoperability`, `export`, `workflow` and `regional-workflow`.
- Not established: that this program prints.

## 2026-09-19 — Bambu programs were missing their CONFIG_BLOCK

- Source: maker session `1a69160c-5d8b-4d89-898f-cfcd81550fdb`, third failed H2D
  load. Warning `[05ff-8053 132520]` "The right nozzle is not matched with
  slicing file", a build-plate mismatch, and — new after `setup.ams` was set —
  "failed to get ams mapping". The user: "You need to KNOW what to do, not guess
  at random shit." That was fair; the preceding `printer_settings_id` change was
  reasoned from field names in `project_settings.config` and changed nothing.
- Root cause, found by diffing the G-code rather than the package metadata: no
  SAAM export has ever emitted a `; CONFIG_BLOCK_START` ... `; CONFIG_BLOCK_END`
  section. Bambu Studio writes 548 `; key = value` lines there, including
  `nozzle_diameter`, `curr_bed_type`, `printer_model`, `filament_map` and the AMS
  fields, and the printer validates against that block. Checked: two SAAM
  packages on the operator's drive have zero config blocks, two Bambu Studio H2D
  packages have one each. This explains all three warnings together, and why the
  single-nozzle X1 Carbon was unaffected.
- `projectSettings` is now one exported function in [bambu.mjs](core/export/bambu.mjs),
  rendered as JSON for `project_settings.config` and as the program's CONFIG_BLOCK.
  Per-key list separators were read from the reference program, not assumed.
  The H2D profile gained `extruder_ams_count`, `default_ams_type` and
  `enable_filament_dynamic_map` from a real slice of that operator's machine, and
  its `nozzle_type` was corrected from five entries to one per tool.
- Regenerated: the program now carries `nozzle_diameter = 0.4,0.8`,
  `curr_bed_type = Textured PEI Plate`, `extruder_ams_count = 1#0|4#0;1#0|4#0`
  and `filament_map = 2`, with the block between `HEADER_BLOCK_END` and
  `EXECUTABLE_BLOCK_START`. Checks pass at 145 min and 27.6 g. `bambu`,
  `interoperability` and `export` pass (19 tests), including the round trip that
  re-derives the header and compares it to the stored bytes.
- Not established: that this file prints. Three warnings have a named cause and a
  fix; whether any remain is the next observation.

## 2026-09-19 — H2D right-nozzle refusal, and the AMS tray the program asked for

- Source: maker session `1a69160c-5d8b-4d89-898f-cfcd81550fdb`, printing
  `chalice-drip-h2d-08` on a Bambu H2D whose right nozzle is 0.8 mm. The card
  loaded, the screen pre-selected the brown spool in AMS slot 4 from the recorded
  colour, and the printer then raised `[05ff-8053 132520]`: "The right nozzle is
  not matched with slicing file. Please initiate the print after re-slicing, or
  continue printing after replacing with the correct nozzle." Ignored, it went on
  to a build-plate warning and then loaded slot 1, grey, instead of slot 4.
- **Nozzle refusal, fixed.** `printer_settings_id` was built from the first
  tool's diameter, so a right-nozzle job on a 0.4/0.8 machine claimed
  "Bambu Lab H2D 0.4 nozzle" with a 0.8 mm nozzle fitted. It now follows the
  selected tool. Evidence: an earlier SAAM right-nozzle H2D package on the
  operator's drive carries "0.8 nozzle" with the same `nozzle_diameter`
  `['0.4','0.8']`, and a Bambu Studio H2D slice carries "0.6 nozzle" with
  `['0.6','0.6']` — the field names the nozzle that must be fitted, not the first
  one. `core/tests/bambu.test.mjs` asserted the old behaviour and was corrected.
- **Build plate.** Not ours. `plate_1.json` `bed_type: textured_plate` and
  `project_settings.config` `curr_bed_type: Textured PEI Plate` are byte-identical
  across this export, the earlier SAAM package and a real Bambu Studio H2D slice.
  `curr_bed_type` is hardcoded in the exporter, so no other plate can be
  expressed; recorded as [BR-055](build_request.md#br-055--express-plate-choice-and-close-the-ams-package-gap).
- **AMS tray.** The print carried `setup.ams: null`, so `feederSelector` wrote
  selector 0 and the program asked for the first tray. The screen's colour match
  and the program's selector disagreed for the first time here, and the tray that
  loaded was the program's. The 2026-09-18 X1 Carbon observation cannot decide
  between them: that print carried `{unit: 1, slot: 1}`, so colour and selector
  both named slot 1. Which mechanism governs is recorded as unsettled in
  [the Bambu contract](core/export/bambu.md#choosing-the-spool), with both set to
  the same spool as the working practice.
- Regenerated with `setup.ams: {unit: 1, slot: 4}` and the preset fix: the program
  now carries `M620 S3A` / `T3` / `M621 S3A` and "Bambu Lab H2D 0.8 nozzle".
  Checks pass at 145 min and 27.6 g. Delivered unmodified.
- Not established: that this file prints, or which of colour and selector governs
  tray choice. Setting both to the same spool makes the next print succeed under
  either reading, so that print will not decide it either.

## 2026-09-19 — Process validation stops shadowing the machine profile

- Source: same maker session `1a69160c-5d8b-4d89-898f-cfcd81550fdb`. A 0.8 mm
  right-nozzle H2D recipe was refused with "lineWidthMm must be between 0.3 and
  0.8" although the tool declares 0.8 mm and the profile allows a 0.6–1.6 mm
  bead. The user: "We shouldn't have arbitrary caps, fix that when you are done
  with the toolpath."
- `validatePlanProcess` carried a `planarLimits` object of chosen numbers
  (`firstLayerMm`/`layerMm` 0.3, `lineWidthMm` 0.8, `maxFlowMm3S` 15) applied
  without reference to any machine. `validateSetup` already enforced all four
  against the selected tool's `layerHeightMm`, `lineWidthLimits` and the
  material's `maxFlowMm3S`, two steps later in the same `validatePlan` chain, so
  the fixed numbers only shadowed the real limits with smaller ones.
- The fixed ceilings are removed. `validatePlanProcess` now takes the machine,
  keeps floors that say a value is not a usable process value, and bounds axis
  speeds by the machine's declared `maxFeedMmS` instead of 80/40/200. Prime-line
  width and height follow the same rule. The profile keeps every real ceiling.
- Checked on the H2D profile: a 0.8 mm nozzle now accepts a 0.9 mm bead at 0.4 mm
  layers and up to the profile's 1.6 mm, while 1.7 mm, a 0.9 mm bead on a 0.4 mm
  nozzle, a 0.7 mm layer past the tool's 0.6 mm, 5 mm³/s past PLA's 4 and a
  1200 mm/s axis speed are all still rejected — now with the profile's own
  messages. `bambu`, `workflow`, `regional-workflow`, `demos`, `composition`,
  `export`, `interoperability`, `line-network` and `workflow-generation-stages`
  pass (55 tests). One assertion in `workflow.test.mjs` expected the old
  `/layerMm/` text and now expects the profile's "Layer height outside profile
  limits"; the value is still rejected.
- The kept-limits register in [core/README.md](core/README.md#limits-that-adapt-and-limits-that-are-kept)
  now names layer height and bead width in the machine-limits row.

## 2026-09-19 — AMS spool selection follows filament colour

- Source: maker session `1a69160c-5d8b-4d89-898f-cfcd81550fdb`, printing the
  `chalice-drip-h2d` bundle on a Bambu H2D. The maker reported needing the AMS,
  asked "does the AMS only use right nozzle or something?", then stated the
  mechanism: "I think you just set color (do brown) and AMS chooses slot for
  you." They later reported the job "won't print" while mapped to the left
  nozzle and asked for the right nozzle.
- `core/export/bambu.md` already recorded colour-based tray matching for the
  X1 Carbon, but the H2D section of the same file called `setup.filamentColor`
  a value "used only for package labelling". That contradiction is corrected and
  the spool guidance is now one section covering both profiles. The matching
  comment in `core/machine/rules.mjs` said a colour "only labels the job"; it now
  points at the export contract.
- The failing export had `setup.ams: null` and `setup.filamentColor: null`, so
  `feederSelector` returned selector 0 and the exporter wrote the H2D output's
  `defaultFilamentColor` `#28A090` — a profile placeholder matching no spool the
  operator owns. A machine with no remembered setup reaches this by default.
- Nozzle mapping was checked against references on the operator's drive rather
  than inferred. Two Bambu Studio H2D packages and one earlier SAAM right-nozzle
  H2D package agree with this exporter: `filament_map` is `tool + 1`,
  `filament_nozzle_map` is `tool`, `first_extruder` tracks the filament id and
  not the tool, and a right-nozzle job starts `T0` / `G151 P0` because H2D tool 1
  declares `physicalExtruder` 0. No exporter defect was found; an earlier reading
  of `filament_map: ["2"]` as out of range was wrong.
- Regenerated the bundle on `setup.tool: 1` with `filamentColor: "#8B5A2B"`;
  checks pass at 96.9 min and 19.1 g, with the same single short-travel advisory
  in `bowl:vase-wall:wall`. Delivered to the operator unmodified.
- Not established: that colour matching selects the spool on the H2D specifically,
  or that this part prints. Both are maker reports and a software check; no
  completed print has confirmed either.

## 2026-09-19 — Bed-adhesion skill first draft, from a reported brim failure

- Source: maker session `1a69160c-5d8b-4d89-898f-cfcd81550fdb`. The user printed
  an open-bottom vase-mode part on a Bambu X1 Carbon in PLA and reported "It
  didn't adhere to the print bed", then asked for "a good solid brim to start
  out, maybe 8 layers on the outside before getting to the part, with full flow
  or maybe even a little more", clarified as "Just do the first layer and then
  vase on top of that", and finally asked for a bed-adhesion skill draft.
- Physical evidence: the failed part's only bed contact was one 0.5 mm vase-wall
  bead around an 80 mm circle, roughly 125 mm² carrying a 124 mm tall part. No
  brim has been printed; the brim figures below are software measurements.
- Added [skills/bed-adhesion/SKILL.md](skills/bed-adhesion/SKILL.md) with one
  entry, brims, and registered it in [skills/catalog.mjs](skills/catalog.mjs)
  after `supports`. Regenerated the digest.
- The documented brim uses existing components only: a flange modeled over the
  first layer height, plus a first-layer region assigning `planar-infill` with
  `density: 0` and a `perimeters` count, with a region `process` override for
  bead width and speed. `line-network` was assessed first and rejected — it is
  validated as a standalone planar path and is generated only from the global
  skill path in `core/print/generate.mjs`, so it cannot coexist with a vase wall
  or with composition regions.
- Measured on the `chalice-drip` bundles: nine first-layer loops at radii 39.75
  through 44.55 mm, matching the derivation in the manual; 3,111 mm of path at a
  measured 0.652 x 0.2 mm bead and 18 mm/s, about 2,030 mm² of bed contact. Both
  the X1 Carbon and H2D bundles check `pass`.
- The flange requirement is recorded as [BR-054](build_request.md#br-054--a-brim-producer-that-does-not-need-a-modeled-flange).

## 2026-09-19 — Developer-map scanner and architecture integration

- Post-checkpoint priority correction: the user explicitly rejected treating
  unresolved/uncertain relationships as an acceptable finished state or requiring
  every developer to reconstruct missing dependencies from source. BR-052 now
  prioritizes eliminating the gaps through scanner inference, sensible reviewed
  authorship and code-practice changes. Complete affected-caller/consumer coverage
  and useful data/control/state relationships are the acceptance criterion;
  warning suppression and payload reduction do not establish it. The broader
  goal and team remain paused; this correction updates the authorized remainder.
- Final requested checkpoint: private prepared mesh-section queries now copy
  vertices, triangle indices and bounds once, so cached indices cannot observe
  later caller geometry mutation. Returned query closures capture `fixedMesh`
  rather than caller-owned mesh geometry. This costs one geometry snapshot for
  each prepared query's lifetime; public mesh mutability is unchanged. Geometry
  behavior checks passed 23/23, including nested and top-level caller mutation.
- Ambiguous repeated-invocation endpoints now identify an unknown producer or
  consumer instead of pretending to be function parameters/returns. Canonical
  source navigation and unresolved wire evidence remain: 13 endpoints on four
  pages. Integrated map checks passed 335/335 and full regeneration produced
  1,990 destinations (142 files), with no stale pages or orphan facts.
- Final stored declaration diagnostic counts are 1,056 unresolved and 12,475
  uncertainty rows, versus 1,054/12,472 before the ownership correction. The
  added snapshot array traversals expose two further receiver-call limitations;
  these totals count analysis rows, not unique bugs or completion tasks. Runtime
  core/Studio source totals 15,345 physical lines (core 11,041; Studio 4,304),
  counting mjs/js/cjs/cpp/h/hpp/css/html and excluding tests. No commit or push
  was made at this checkpoint; existing unrelated checkout work was preserved.
- The user requested wrap-up at the next logical stopping point and explicitly
  chose "Pause at the checkpoint". Remaining conceptual review, local diagnostic
  usability and the observed Studio overview ownership-projection defect remain
  in BR-052. The whole-scope goal is not achieved. All assigned agents completed;
  no additional implementation assignment was started.
- Corrected overview reads after the user's cost report and clarification that
  maps should locate descendant detail without displaying it. Region/file/group
  diagnostics now roll up to counts and immediate child addresses; unmatched
  local findings stay explicit. Default drawings and CLI omit expanded member,
  file, child and code-target inventories. Visible boxes retain their navigation;
  raw details and complete matching code reads remain available. Fixed compact
  file reads restoring full shared-helper caller lists from child metadata.
- Equivalent fresh default CLI responses for regions `9,7,6,4,3` fell from
  402,269 to 33,350 UTF-8 bytes (392.8 to 32.6 KiB, 91.7% reduction); files
  `4.38,5.7,9.12` fell from 30,928 to 14,140 bytes (54.3%). The reported 71k
  estimated tokens were the region discovery reads, not those three file reads.
  These are payload savings, not resolved scanner findings or tokenizer counts.
  Adopted cross-level redundancy as a review metric: separate repeated descendant
  detail from necessary identities, addresses and boundary-edge perspectives.
  Summary counts across nesting overlap and are not unique-finding totals.
- Verification: all 333 map tests pass; regenerated all 1,990 destinations with
  no stale pages or orphan facts. Independent navigation check covered all 3,492
  displayed boxes. Inspected drawing and CLI for region `9`; inventories and
  verbose warning dictionaries are gone. Its large number of connections still
  makes the drawing crowded; payload reduction alone does not establish good
  visual composition.
- Resumed after the user's architecture/size reflection: conceptual simplification
  and increased code visibility remain primary; runtime size and function counts
  remain reported countermeasures. The proposed small-leaf absorption policy is
  not yet adopted. Measured 748 canonical code leaves from matching snapshot
  source spans: mean 241 characters, population standard deviation 313, median
  131, 90th percentile 542. Full-line spans include comments/whitespace and may
  overlap, so their sum is not a partition of codebase size.
- Machine mechanism selection now returns explicit gantry, aligned-arm and
  unavailable-arm records instead of reassigning shared callback bindings.
  Existing value-flow analysis can follow the actual solver/source-pose choices;
  no authored links or broader scanner guesses were added. Behavior checks,
  including scaled Dobot overlay suppression, passed 21/21; independent factory
  callback inference regressions passed 2/2. Source delta: -2 lines, +530 characters,
  unchanged function count. Five newly anchored callback entities increase map
  coverage without adding runtime callbacks. Current runtime total is 15,337 lines.
- Corrected sole local-closure invocation endpoints when a separate callable
  reference is also needed. `sweepSurfaceOffset`, `simplifySurfaceLoops` and
  `offsetSurfaceSection` no longer gain fabricated untraced return ports; their
  arguments reach the real invocation. Captures, callable returns, recursion and
  genuinely ambiguous multiple invocations remain distinct. After integration,
  333 map tests pass; regenerated canonical pages contain 1,054 unresolved rows
  and 12,472 uncertainty rows. This counts stored evidence, separately from
  presentation-only invocation-origin diagnostics.
- Consolidated local request waiting and live Studio polling's selection/claim
  policy in `createAgentRequests().selectQueued`; transports retain their own
  waiting behavior. This removes one competing policy implementation while adding
  one function and three runtime lines. Focused toolkit/work checks passed 23/23.
  Runtime core/Studio totals at this checkpoint: 11,035 + 4,304 = 15,339 lines,
  using the same runtime-extension scope as the earlier comparison.
- Mutable array receivers are classified only when initialization and every direct
  reassignment are array literals, with no own-member writes or direct call escapes.
  The conservative final rule removes 10 false unresolved sites on identical source;
  overridden methods and uncertain mutation remain unresolved. A broader candidate
  was rejected during integration review. Literal dynamic-import destructuring was
  already supported and gained regression coverage.
- Preserved adapter selection provenance through flow construction. Matching
  exporter/interpreter alternatives now have four `bytes` connections rather than
  sixteen; independent selections retain all possible pairings. No runtime export
  behavior changed. Region overview diagnostics now summarize counts by source and
  finding type, retaining flagged-limit counts and detailed drill-down in both CLI
  and drawing. Underlying findings remain intact.
- Regenerated September 20 at 04:20 UTC: 142 files, 1,567 declarations, 266 groups,
  1,237 graph pages and 748 code destinations, with no stale pages or orphan facts
  at generation. Canonical stored pages contain 1,059 unresolved rows and 12,496
  uncertainty rows (not a claim of distinct source sites). All 328 map tests passed.
  Machine solver callback selection remains the next code/graph visibility gap.
- Source: user follow-up in Codex task `01a0ba56-7b17-71e3-9219-4972a0bc5bfd`:
  remove `dev-map/audit`, use Sol agents for code-shape/scanner improvements,
  distinguish static/instance declaration identities, and implement the five
  proposed action-delta, Dobot, generation, Clipper and viewer cleanups.
  The user subsequently strengthened the goal to require architectural clarity
  and conceptual usefulness throughout core/Studio, beyond inventory coverage.
- Removed the disposable `dev-map/audit` tree. Temporary verification output now
  uses the operating system's temporary directory. Updated active guidance to use
  just the current map index; durable references continue to use declaration paths.
- The scanner no longer treats every scalar local declaration as a possible
  carried method name. A same-source comparison moved 187 call sites from
  unresolved to external while preserving all 4,922 linked sites in that scan.
  Static methods now have `@static/` declaration identities; reserved-looking
  instance names are escaped without renaming source methods. Static spread-key
  analysis also preserves return fields proved disjoint from a spread: the
  generation-check record's 17 false override findings became zero. Unknown
  spreads and unsupported value flow remain explicit.
- `materializeActions` now uses `ActionAccumulator`; planning results carry
  state/actions/decisions without copied timing/accounting fields. Dobot imports
  the existing rigid-vector helpers. Approval and machine-change transitions
  return new review records instead of mutating loaded review/history objects.
- Core `generateBundle` owns current-output reuse, development promotion and
  generation. Studio supplies computation transport only. Promotion rechecks
  plan/export/review identity after the commit hook; failed prepared jobs retain
  their existing diagnostic/retry lifecycle. The transport consumes the execution
  state supplied by core rather than an earlier Studio snapshot.
- Region operations use one lowercase Clipper adapter vocabulary with an explicit
  `open` option. The native-memory module is reached through that adapter,
  including simplification and setup verification.
- Studio's `createViewerRenderer` owns scene publication, renderers, picking,
  quality and redraw scheduling. The app assembles an explicit frame snapshot and
  applies returned DOM annotations; movie output uses the same renderer.
  Verification caught and corrected early-resize, restored-page disposal and
  coalesced-redraw races. Viewer tests live in the normal core test suite.
- Integration evidence: 195/195 Studio tests and 306/306 map tests passed after
  source/group updates. The generation agent's focused lifecycle checks passed
  47/47; the later named-transport change passed 11/11 Studio stage tests.
  Earlier slice checks covered action input identity/order, frozen review
  transitions, Clipper reference fixtures and static/instance source identity.
- Explicit regeneration at 02:34 UTC on September 20 produced 139 source files,
  1,550 declarations, 262 groups, 1,223 graph destinations and 738 code destinations
  across nine regions, with eight facts, no orphan facts and no stale sources.
  Human and CLI review exposed excessive repeated helper callers, expression
  bodies on wires and suspicious receiver-call references. Those remain follow-up
  work; this checkpoint does not certify the full conceptual goal as complete.
- The subsequent text/heat-set ownership pass moved text-layer unwrapping and
  reconstruction into `core/print/text.mjs`. Heat-set editing no longer imports
  the text compiler or owns its wrapper schema/order. The existing text and
  heat-set suites plus a frozen nested-layer reconstruction regression passed
  28/28, retaining compiled record hashes, material partitions and standalone
  stopping behavior. Local outline accumulators and compiler-owned kernel handles
  were inspected and retained; they were not caller-owned planning mutations.
- Export advisory enrichment now returns detached program/summary records while
  retaining motion payload identities. Frozen-input and export regressions passed
  40/40. Prepared contour, radial-contact and sleeve-contact query reports now
  return snapshots; all consumers were rewired. Snapshot isolation and existing
  query/skill checks passed 39/39.
- An ownership assessment covered all 39 geometry and 12 region source files.
  Pure/local algorithms and explicit cache/native-resource owners were retained;
  this is code-ownership evidence, not certification of each conceptual map.
  A subsequent exact-contract vector cleanup removed four duplicate helpers and
  reused shared operations in NURBS normal evaluation. Arbitrary-dimension mesh
  operations and the scalar 2D sleeve determinant remain distinct. Focused
  geometry tests passed 41/41.
- The next user-supplied proposals were checked against current source: accepted
  one work-status summary, one export representability guard, immutable Studio
  response adoption, control-policy derivation and DOM-update ownership. Declined
  a generic review-event helper because the pure transitions retain deliberately
  different approval policies, and declined merging print identities because the
  absolute-directory hash and library-relative request identity differ.
- Studio response adoption now returns state and presentation decisions without
  mutating fetched JSON. Successful preview publication explicitly reports
  consumption, allowing detached state/cache envelopes to release preview data
  while preserving move-buffer identity. Unavailable, failed or superseded
  publication retains that data. The control model supplies button/tab policy;
  the duplicate refresh-time skin-label write was removed. Work-status and export
  guard checks passed 56/56; the integrated Studio suite passed 199/199 after
  correcting a test fixture that failed to retain its simulated viewer response.
- The user approved naming architectural stages while permitting anonymous
  implementation callbacks. All 30 authored anonymous source-position references
  were replaced by named bindings or removed from incidental callback grouping.
  Parameter-default functions use stable `@default/NAME` identities, without
  claiming the runtime caller selected that default. Generation rejects anonymous
  position paths in authored grouping. No map-specific source IDs are introduced.
- Caller summaries now replace long off-page component lists with a count and
  canonical caller-page link. The generation-page drawing and exact default CLI
  were inspected together: the assertion summary retained all 225 off-page
  callers, and its canonical view retained 228 total callers. This reduced that
  CLI response from about 20.8k to 13.4k characters. The viewer factory was grouped
  into scene publication, frame scheduling and performance responsibilities,
  with direct teardown; it still needs shared-state presentation work.
- Regeneration at 03:28 UTC on September 20 covered 141 files, 1,560 declarations,
  266 groups, 1,231 graph destinations and 746 code destinations. The comparable
  canonical-source count was 1,075 unresolved sites and 12,414 distinct uncertainty
  findings (12,506 rows), versus the saved baseline 1,070 and 12,402. Increased or
  reclassified findings are not claimed as analysis improvement. Subsequent source
  changes correctly marked that snapshot stale while leaving it readable.
- A further user ticket batch was accepted for shared Studio rigid math, one
  polling adoption path, one normal/inspection render selection, invariant travel
  policy construction, structural planning-result fields, and a generation-input
  identity rename with persisted-record migration. Shared pure review invalidation
  was accepted; a generic bundle write loop was declined because it would not
  establish atomicity or complete file sets. The path changes passed 34 checks;
  shared invalidation passed 16 workflow/edit checks.
- Studio now shares core rigid-transform math, retains its descriptor validation,
  and uses one polling state-adoption path while preserving metadata-only playback,
  manual controls and fading. A named presentation selection skips normal table
  construction for inspection content. The core/Studio generation-input identity
  is now `generationHash`; legacy saved reviews/checks normalize at read boundaries,
  reject conflicting identities and leave source files untouched. Existing approved
  exports remain valid; old revision tokens require refresh. Runtime/API/cache
  contracts have no parallel old-name aliases.
- Bundle adapter resolution moved out of the HTTP server into one neutral module,
  with all consumers rewired. The tour adapter names its complete delegated
  interface instead of spreading an implicit export surface. Integrated map tests
  passed 320/320; Studio/workflow/handoff and wave-workflow checks passed 231/231.
  A subsequent focused presentation refinement passed 22/22. Verification also
  found a real MCP disconnect ordering bug: failure records are now persisted
  before notifying Studio, while notification still precedes shutdown. Its existing
  scoped-owner regression passed without weakening assertions.
- The final 03:47 UTC generation covered nine regions, 142 files and 1,566
  declarations, with 266 authored groups, 1,235 graph and 749 code destinations,
  eight facts and no orphan facts or stale sources. Canonical-source diagnostics:
  1,070 unresolved sites and 12,408 distinct uncertainty findings (12,500 rows),
  down five and six respectively from the previous reported snapshot. These totals
  reflect changed source as well as analysis, not a same-source scanner benchmark.
  Exact shared-state/capture duplicates now consolidate in both default views;
  the viewer controller CLI shrank from 108 to 79 wire records without merging
  invocations, ordered state transitions or distinct fields. Its 59 uncertainty
  findings remain. The generation drawing and CLI were reinspected together at
  current index 7.16.44; the exact CLI was queued in the sidebar. The controller
  still needs a clearer presentation of real owned state and repeated uncertainty.
- At the user's request, code size joins diagnostic counts in progress reports.
  Count physical lines (including comments/blanks) in runtime `.mjs`, `.js`,
  `.cjs`, `.cpp`, `.h`, `.hpp`, `.css` and `.html` files under core/Studio;
  exclude tests, node_modules, .local, docs and generated maps. Compare each
  revision's actual file set, including new untracked runtime files in the worktree.
  Current: core 11,036, Studio 4,299, total 15,335 (JavaScript alone 15,174).
  HEAD b3515d8: 10,971 + 4,223 = 15,194; a11926e and b1ef0cb:
  10,739 + 4,138 = 14,877; 36a671d: 10,269 + 4,036 = 14,305;
  ab61e96: 10,251 + 4,036 = 14,287; 5526585: 10,260 + 4,036 = 14,296.
  Thus this batch adds 141 runtime lines (+0.93%), not a net size reduction.
  App/controller/state/control extraction nets +39 lines, workflow +44, tour's
  explicit facade +24, adapter/server ownership +14. Runtime nonblank lines
  increased 126 and normalized characters increased 10,833; the increase is not
  solely blank lines. Tests are separate: 11,647 currently versus 11,215 at HEAD.

## 2026-09-18 — Remove fixed failing caps

- Source: owner rule, 2026-09-18: "fixed cap limits like that will ALWAYS fail at
  some point." Generation, import, repair and export must not refuse work because
  a count, a size or an elapsed time crossed a number chosen in advance. Real
  machine limits, input-safety limits on a network boundary, malformed-file guards
  and schema shape checks stay. Worked from a prepared queue, group by group.

### Group A — skills people hit in ordinary use

- **pipe-cladding `maxPoints` (500,000).** Threw from five places in the circular
  and surface producers and was passed into the shared surface sampler. Removed
  the setting; `sampleStepMm` and `toleranceMm` already decide the sample count,
  which is still reported. A 1.2 mm pipe at a 0.0005 mm step now generates over
  500,000 points, where the default budget used to refuse it.
- **wave-overhangs `maxWaves` (1,000), `maxPoints` (200,000),
  `maxEvaluations` (2,000,000).** All three removed. The front loop already had
  real non-progress detection — a wave that fails to enlarge the covered area
  reports that its seed cannot reach the rest of the slice — so the wave count is
  now unbounded and the post-loop "exhausted maxWaves" throw is gone with it.
  Evaluations and points are counted for the report only. Five times finer
  spacing on the test plane runs 34 fronts instead of 6 and simply finishes.
- **surface offset `maxEvaluations` (250,000), pulled forward from group B.**
  wave-overhangs fed its own budget into `offsetSurfaceRegion`; leaving the core
  default in place would have cut the canopy example from 20,000,000 to 250,000
  evaluations, so the cap went at the same time. Integration already halves its
  step until the step would stop advancing, which is the real failure. Measured:
  the same square inset runs 75,919 evaluations at a 0.05 mm step and 332,100 at
  0.02 mm — past the old ceiling — in about 10 s.
- **planar-infill `maxPatternCells` (1,000,000).** Removed; the gyroid grid
  follows `sampleStepMm` and the layer's own size. A 20 mm square at a 0.018 mm
  step is about 1.24 million cells, runs in 0.32 s and traces the same contours as
  the coarse grid. Column values are now `Float64Array` rows.
- **full-fill "Layer count exceeds the supported limit" (20,000).** Removed. The
  loop already ends at the top of the part; it now rejects only a layer height
  that would never advance. 1,800 mm at 0.06 mm layers gives 29,997 heights.
- **Bambu `c.layers < 100000`.** Upper bound removed; the count is still checked
  as a positive integer, and part height and layer height are bounded elsewhere.
- **text: baseline subdivision depth 20, Bezier depth 24, three 100,000-triangle
  limits, eight fixed refinement passes.** The two depth budgets became parameter
  underflow detection (a midpoint no longer distinct from its ends) plus a finite
  control-point check. The refinement loop now repeats while the sampled deviation
  keeps falling and reports a reference it cannot resolve when a pass no longer
  improves it. The triangle limits are replaced by the solid kernel's own
  capacity: Manifold addresses 32-bit memory, so `KERNEL_TRIANGLE_CAPACITY`
  (67,108,864) is what refuses an impossible subdivision, and an actual kernel
  failure discards the aborted instance and names the setting that caused it.
  Before this, a kernel abort poisoned the shared instance and failed the next
  five tests in the same process. "BO" at 7 mm with 0.035 mm edges now compiles
  107,484 triangles in 2.7 s; the old ceiling refused it before any work ran.
- **rimming-planar/rimming-normal `maxPoints` (100,000).** Removed, with the
  remaining-budget argument to the shared section offset.
- **Plan counts.** line-network dropped its 10-course, 20-group, 100-stroke and
  1,000-point limits; `primeLine` dropped its 8-pass limit; region and vase-wall
  start/end heights dropped their 1,000 mm and 200 mm ceilings and keep their
  finite/ordering checks. A 24-group, 2,880-stroke frame with a 2,000-point curve
  over 40 courses now validates.
- **Kept as real limits.** vase-wall's safe-integer point-count checks (a value
  that cannot be represented), the Bambu positive-integer layer shape check, and
  `layerHeights` rejecting a non-advancing layer height.
- **Not yet decided, left for the completeness sweep.** `composition.regions`
  ≤ 80, `batchLayers` ≤ 20, assembly components ≤ 20, `thick-lip.steps` ≤ 50,
  text features ≤ 40 and 2,000 characters, geometry dimension ranges (5–200 mm),
  perimeters ≤ 8 and skin layers ≤ 8.

Checks (targeted, no full suite): `core/tests/denso.test.mjs`,
`surface-cladding.test.mjs`, `surface-offset.test.mjs`, `line-network.test.mjs`,
`prime.test.mjs`, `regions.test.mjs`, `pipeline.test.mjs`, `geometry.test.mjs`,
`bambu.test.mjs`, `studio-settings.test.mjs`, `spacing.test.mjs`,
`interoperability.test.mjs`, `workflow.test.mjs`, `regional-workflow.test.mjs`,
`crossed-cladding.test.mjs`, `cladding-offset-tightness.test.mjs`,
`export.test.mjs`, `composition.test.mjs`, `printer-profiles.test.mjs`,
`text-layout.test.mjs`, `dev-map*.test.mjs`, `skill-digest.test.mjs`,
`mcp*.test.mjs`, and the wave-overhangs, planar-infill, full-fill, text,
rimming-planar, thick-lip, supports, draped-skin, vase-wall, plastic-weld,
heat-set-inserts and gridfinity skill tests. All pass except the seven failures
that predate this work. `node dev-map/cli.mjs check` passes.

### Group B — core samplers and geometry the skills call (B1–B7)

- **Ambient normal sampling `maxPoints` (100,000) and `depth < 25`.** Both gone
  from `sampleSurfaceCurve`. The chord tolerance and maximum step already decide
  how far it refines; refinement now stops only when halving the parameter no
  longer produces a distinct midpoint, and every sample is checked for finite
  coordinates. A parabolic chart at an 8e-6 mm step returns 262,000 points.
- **Section offset `maxPoints` (100,000) and `depth < 30`.** Same replacement.
  Its degenerate-span guard tightened from an absolute 1e-12 in u to exact
  equality, so a span between 1e-12 and one ulp refines instead of being accepted
  coarse. The old message told the user to raise a skill setting that no longer
  exists.
- **Surface offset subdivision `depth < 30` and disk `depth < 20`.** The last of
  the surface-offset budgets, after its `maxEvaluations` went with group A.
- **Lower-surface strokes `maxSegments` (20,000), its 12x sampling counter and
  `depth <= 30`.** All removed. Subdivision follows the observed gap error and
  the spatial step; how deep it goes is the stroke's own length over the
  coincident-point tolerance. A segment still missing its tolerance at twice that
  width is sitting on a step in the published surface, and the message says so.
  A 10 mm stroke at a 0.4 µm step is 32,768 segments, well past the old budget,
  and still integrates to the analytic material area.
- **Published surface field `(nx+3)*(ny+3) <= 1,000,000`.** The cap was guarding
  an O(n³) relaxation: a whole-grid sweep repeated once per row or column. The
  outward extension now walks its own fill front, visiting only the cells
  touching the previous pass, which is O(n²) and needs no pass ceiling either.
  On 300 random grids the result is identical except where the old pass ceiling
  ran out first and wrongly reported that no material top could be published. A
  1400×1400 grid — 1.96 million cells, refused outright before — fills in 1.4 s
  against 60.8 s for the old sweep.
- **Spline tessellation `maxTriangles` (100,000) and its 256-step ceiling.** The
  dyadic grid now doubles until the sampled chord deviation meets the tolerance,
  and reports a tolerance the shell cannot reach when a doubling stops lowering
  that deviation. A six-patch spline top at 0.001 mm needs 128 steps and 196,608
  triangles; the old budget refused it before any subdivision ran.
- **Circle resolution `<= 100,000` segments.** Removed; the safe-integer check
  stays, because a count that cannot be represented is a real limit. A 1e-9 mm
  chord tolerance on a 10 mm circle gives 222,145 segments.

Checks for group B (targeted): `core/tests/surface-cladding.test.mjs`,
`surface-offset.test.mjs`, `reservation-surface.test.mjs`, `geometry.test.mjs`,
`regions.test.mjs`, `regional-workflow.test.mjs`, `assembly-reservation.test.mjs`,
`finished-cladding.test.mjs`, `text-layout.test.mjs`, `pipeline.test.mjs`,
`crossed-cladding.test.mjs`, `cladding-offset-tightness.test.mjs`,
`spacing.test.mjs`, `studio-geometry.test.mjs`, `denso.test.mjs`,
`line-network.test.mjs`, `dev-map*.test.mjs`, and the rimming-planar, full-fill,
wave-overhangs, vase-wall, text, heat-set-inserts and draped-skin skill tests.
All pass except the pre-existing finished-cladding failure.
`node dev-map/cli.mjs check` passes.

- **Mesh sleeve `maxSectionPoints` (16,384).** Removed. The points in a complete
  fitted section already follow the section tolerance and the fitted
  second-derivative bound; what remains is a representability check. The fluted
  vase at a 1e-7 mm chord tolerance fits 25,224 segments per section.
- **Prepared contact `maxProfiles` (100,000), `maxSourceDistanceQueries`
  (4,000,000) and the depth-16 slab ceiling.** All removed. Halving a height slab
  brings its two profiles together, so the slab loop now ends where height itself
  ends: a slab that still misses its interpolation tolerance at one representable
  height is a step in the source that no mesh transition confirmed, and it says
  so. A 12→10 mm radius step reports that in 39 ms.
- **Directional contour sample count capped at 16,384.** Its own sampling-error
  message asks for a finer fixed sample count, which the cap made impossible. The
  floor of 32 stays. Its one-turn angular-room check is not a budget — the room a
  source's radial variation needs must fit in the turn an unfolded profile has —
  so it stays, with a message that says that instead of "budget".
- **Mesh intersection and adjacent-contact allowances (`max(2,000,000, faces ×
  100)`).** Both removed. One loop is over the mesh's own overlapping BVH bounds,
  the other over its own shared-vertex incidence; the mesh is its own bound.
- **Loose-offset curvature limiting: 32 passes.** Passes now repeat until every
  sample clears the area floor. Each incomplete pass shrinks at least one control
  depth, so the explicit failure is a pass that changes no depth at all.
- **DENSO inverse kinematics `maxIterations` (90).** It did not throw, but it
  gave up on solves that were still converging. The damped step now runs while
  the pose residual keeps falling and reports a solve that stopped approaching
  the pose after eight consecutive non-improving steps. Unreachable poses end
  after 299–634 iterations in 18–28 ms, so failures stay fast.
- **Jog: 48 continuation steps, 24 projection iterations, 15 bisections.** The
  step ceiling silently coarsened long drags; steps now stay within 8 weighted
  units of each other however far the drag goes. Projection continues while the
  worst boundary margin keeps improving, and the boundary search ends on its own
  0.001-unit interval. The six relaxation sweeps that build one correction vector
  stay: that is a step's algorithm, not a refusal.

Checks for group B part 2: `core/tests/mesh-sleeve.test.mjs`,
`directional-contour.test.mjs`, `prepared-radial-contact.test.mjs`,
`machine-jog.test.mjs`, `machine-presentation.test.mjs`,
`studio-kinematics.test.mjs`, `mesh.test.mjs`, `mesh-boundary.test.mjs`,
`mesh-large.test.mjs`, `mesh-distance.test.mjs`, `loose-surface-offset.test.mjs`,
`cladding-offset-tightness.test.mjs`, `surface-offset.test.mjs`,
`sleeve-frame.test.mjs`, `sleeve-contact.test.mjs` and the vase-wall skill test.
All pass. `node dev-map/cli.mjs check` passes.

### Group B — travel routing, machine commands and program readers (B12–B15)

- **Comb routing's 256 offset corners.** This one degraded silently instead of
  throwing: a layer whose inset outline carried more corners than that fell back
  to a hop, and an ordinary part reaches it easily — a 60 × 60 mm plate with 36
  holes has 3,460 inset corners, so every travel whose straight chord was blocked
  hopped. The count is gone; the route budget, which the graph already applied to
  each corner, is the only bound. Two changes keep that affordable, both
  output-identical. The search is now A* on the remaining straight-line distance,
  which is never longer than any route from that corner, so it settles on the same
  shortest route while expanding far fewer corners. And the boundary query follows
  the travel instead of enclosing it: `SegmentIndex.inCorridor` walks the chord
  column by column rather than scanning every cell of its bounding box, which took
  1,600 cell lookups to collect 220 segments for a 20 mm diagonal. One clearance
  test fell from 142 µs to 21 µs, which speeds up every direct travel check as
  well. On that plate the four sample travels take 453 ms at a 30 mm budget where
  the unbounded graph with the old query took 1,335 ms, and 2.0 s instead of 48 s
  at 60 mm; at the default 6 mm budget no travel reaches the graph at all. Routes
  are identical.
- **Griffin dwell limited to 60 s.** Firmware reads at most 60,000 ms from one
  `G4 P`, which is a property of the command, not of how long a print may pause.
  The writer now splits a longer wait into consecutive `G4` commands whose
  milliseconds sum to the requested wait, and the reader adds them back; a wait
  that fits one command is written exactly as before, so no existing export
  changes by a byte. A 150 s pause becomes 60000 + 60000 + 30000 and reads back as
  150 s.
- **Griffin "Excessive retraction" at 8 mm.** Replaced by the withdrawal the
  selected material profile allows, or the plan's own locked retraction where that
  is larger, with the millimetres in the message. S5 PLA allows 10 mm, so nothing
  that used to pass is refused.
- **Dobot Lua `stepLimit` (5,000,000).** Removed. Commanding the machine is the
  only effect the reader can observe, so a host call clears the step count, and a
  program that runs more statements between two host calls than the whole loaded
  program contains is reported as looping without commanding anything. A generated
  program is straight-line, so its statements run once each and the rule never
  reaches it, however long the part; `while true do end` is still rejected, now
  after 10,240 steps with the real cause named.
- **Dobot kinematic preview `maxSamples` (300,000).** `sampleDobotProgram` had no
  caller anywhere in the repository outside its own test. The module, its test and
  its map box are deleted rather than left carrying a budget; the rigid-frame page
  keeps three nodes by documenting the rigid inverse at the same address, and the
  contract section now describes the playback that exists.
- **DENSO 2,000-statement blocks: kept.** The helper splits a program of any
  length into blocks of that size and calls them in order, which changes no
  motion. That is segmentation, not a refusal. Only the contract wording, which
  called it a cap, was corrected.

Checks for group B part 3: `core/tests/travel.test.mjs`,
`material-travel.test.mjs`, `straight-moves.test.mjs`, `scanline-cells.test.mjs`,
`regions.test.mjs`, `perimeters.test.mjs`, `interoperability.test.mjs`,
`geometry.test.mjs`, `composition.test.mjs`, `dobot-kinematics.test.mjs`,
`dobot.test.mjs`, `denso.test.mjs`, `export.test.mjs`, `gcode-stream.test.mjs`,
`modal-export.test.mjs`, `source-player.test.mjs`, `robot-playback.test.mjs`,
`machine-presentation.test.mjs`, `bambu.test.mjs`, `pipeline.test.mjs`,
`travel-advisory.test.mjs`, `studio-kinematics.test.mjs`, `dev-map.test.mjs`,
`dev-map-reference.test.mjs` and the full-fill, planar-infill and draped-skin
skill tests. All pass. `node dev-map/cli.mjs check` passes.

### Group C — time limits

- **Native mesh repair `timeoutMs` (120,000).** Removed. A repair of a large or
  badly tangled mesh was killed at two minutes and its result discarded, however
  close it was to finishing. The CGAL child now ends when it finishes, when it
  fails, or when the caller cancels through `signal`; that path was already wired
  from the job supervisor through the worker to `spawn`, and nothing else stops a
  running child.
- **Why no liveness interval replaced it.** The queue's preferred replacement for
  a time limit is liveness — never kill a child that is still reporting. The
  pinned helper cannot support that yet. `mesh-repair.cpp` prints one line as it
  *enters* each of its four stages and nothing while a stage runs, and the two
  expensive stages, `remove_self_intersections` and `triangulate_hole`, grow far
  faster than the triangle count. A working child can therefore be silent for an
  arbitrarily long time, so any "no sign of life for N seconds" rule would just be
  a new invented number. The fix is to make those stages report, which means
  editing the C++ and rebuilding the pinned executable; that is not possible in
  this checkout (no compiler, and the source hash in the build manifest would mark
  the existing binary stale the moment the source changed), so the limitation is
  written down in the native-repair reference instead of guessed at. Until a
  heartbeat exists, a genuinely hung repair is cancelled by hand.
- **Native report size (64 KiB) kept.** The report is a single JSON line of about
  a dozen counts and does not grow with the mesh, so this is a malformed-output
  guard, not a budget. Its message now names that cause.
- **Nothing else discards work on a timer.** A sweep of `core/`, `studio/`,
  `skills/`, `adapters/` and `tools/` for `setTimeout`, `setInterval`,
  `AbortSignal.timeout` and deadline arithmetic found no other elapsed-time kill.
  The generation, source and repair workers hold no timers, and movie export
  yields every eight frames and stops only on cancellation or encoder error. What
  remains is coordination and presentation, and it stays: agent-request and event
  waits that return "nothing yet", the viewer grace period and SSE keep-alive,
  debounce and polling intervals, Windows file-sharing retry backoff, staged
  download-link expiry, animation and yield slices, and the thingi10k download
  timeout on its external HTTP boundary.

Checks for group C: `core/tests/mesh-repair.test.mjs` (13 pass, including the
four native-backend tests, which really ran here), `studio-import.test.mjs`,
`dev-map.test.mjs`, `dev-map-reference.test.mjs`, `skill-digest.test.mjs` (29
pass). The old test asserted that a 1 ms limit rejected a repair; it now asserts
that the same call completes, that a cancelled repair and a failed repair each
publish no directory. `node dev-map/cli.mjs check` passes.

### Group D — memory guard

- **Measured first.** Closed, subdivided boxes were written as binary STL outside
  the repository and run through the real stages in child processes (Node 24.19,
  4,288 MiB heap limit, 16 GB RAM):

  | triangles | vertices | file | decode | makeMesh | topology | adjacency | peak heap | peak RSS |
  |---|---|---|---|---|---|---|---|---|
  | 49,152 | 24,578 | 2.3 MiB | 0.3 s | 2.5 s | 0.1 s | 1.8 s | 31 MiB | 113 MiB |
  | 199,692 | 99,848 | 9.5 MiB | 1.1 s | 9.8 s | 0.7 s | 6.9 s | 134 MiB | 269 MiB |
  | 499,392 | 249,698 | 23.8 MiB | 2.7 s | 22.1 s | 1.3 s | 16.2 s | 216 MiB | 372 MiB |
  | 1,002,252 | 501,128 | 47.8 MiB | 4.2 s | 47.5 s | 2.9 s | 32.2 s | 245 MiB | 467 MiB |
  | 1,997,568 | 998,786 | 95.3 MiB | 8.0 s | 102.9 s | 6.3 s | 124.7 s | 771 MiB | 2,100 MiB |

- **The estimate was not a bound in either direction.** `vertices*192 +
  triangles*512 + sourceBytes` predicted 1,040 MiB for the one-million-triangle
  box on the binary file path, where measured peak heap was 245 MiB; at two
  million triangles the same formula predicted 1,159 MiB on the deduplicated
  counts while measured peak RSS was 2,100 MiB. It was several times too
  pessimistic where it refused work and too optimistic where it allowed it.
- **Where it refused.** The default budget here was 1,536 MiB, and binary STL
  import estimated three vertices per triangle before reading a single facet:
  1,088 bytes per triangle, so any binary STL over **1,480,342 triangles** was
  rejected on its 84-byte header. Checked against the retired module: 1,480,342
  allowed, 1,480,343 refused, 1,997,568 refused.
- **Where the work actually fails.** Two million triangles completes, using 771
  MiB of the 4,288 MiB heap. Shrinking the heap around the 199,692-triangle box
  puts the real requirement at about 0.29 KiB of live heap per triangle — it
  completes at `--max-old-space-size=56` and aborts at 40. Time binds long before
  memory: the pipeline costs roughly 120 us per triangle, so the two-million
  triangle box takes four minutes and 1,480,343 triangles was never the point at
  which this machine ran out of anything.
- **So the refusal is gone, everywhere.** `core/geom/mesh-budget.mjs` and its
  `SAAM_MESH_MEMORY_MIB` setting, `meshMemoryBudget()` and the
  `MESH_MEMORY_BUDGET` error are deleted. What is left is the real
  representational limit — at most 0x7ffffffe vertices and 0x3ffffffe triangles —
  in `core/geom/mesh-capacity.mjs` as `checkMeshCapacity`. The periodic re-checks
  every 4,096 facets during STL decoding and every stitched edge during cleanup
  existed only to re-test the estimate and went with it.
- **A failure that is real is reported as one.** `meshAllocation(stage, vertices,
  triangles, allocate)` converts a `RangeError` — "Invalid array length", "Array
  buffer allocation failed" — into `MESH_MEMORY_EXHAUSTED`, naming the stage and
  the mesh size. It wraps the three whole-mesh allocations in `makeMesh` (face
  normals, edge topology, the intersection index) and the streamed STL read.
  A V8 heap exhaustion on the main thread is a process abort and cannot be caught
  at all; in the repair worker, though, Node reports it to the supervisor as
  `ERR_WORKER_OUT_OF_MEMORY` (verified on this machine), so `runRepairJob` now
  turns that into "Mesh repair ran out of memory on a N MiB STL source" instead of
  an anonymous worker failure. Explicit repair still refuses to treat an
  out-of-memory error as a geometry defect worth repairing.
- **Nothing was made to work in pieces, on purpose.** Technique (c) applies when
  memory is genuinely at stake; the numbers say it is not. Deleting the refusal
  alone moves the ceiling from 1.48 million triangles to whatever the machine
  holds, which here is several times that. The obvious leanness win if that ever
  changes is the decoder's vertex table: a `Map` keyed by `"x,y,z"` strings plus
  an array of three-element arrays, which is most of the decode heap. Changing it
  would change nothing observable, but it is not needed to lift this cap.
- **Studio's 64 MiB upload limit stays** — it is an input-safety limit on the HTTP
  boundary, and it is about 1,342,000 triangles of binary STL, just under where
  the memory guard used to fire. MCP `import_stl_print` applies the same 64 MiB
  bound to a local file path; the CLI and the agent toolkit apply none. Studio is
  therefore now bounded by its upload limit and the CLI by the machine.
- **One thing is not characterised.** The mesh stages are measured above, but the
  rest of `importSTLBundle` at these sizes — unit inference, the translated vertex
  copy and bundle serialization — is not: an end-to-end import of a 1.6 million
  triangle box was still in the mesh stages after half an hour on a busy machine
  and was abandoned rather than waited out. Nobody had seen that stretch of the
  import at this size before, because the estimate refused first.
- **Output for meshes that were already accepted is unchanged.** A copy of `core/`
  with exactly these edits reversed was compared against the current tree on the
  49,152-triangle box: one SHA-256 over decoded vertices and triangles, source
  hash, bounds, all face normals, the packed edge topology, adjacent-contact and
  nearest-triangle results, four section heights, cleanup counts, the re-encoded
  repair STL and the text of three rejection paths. Identical
  (`de7707ba0037…908b`).

Checks for group D: `core/tests/mesh-large.test.mjs`, `mesh.test.mjs`,
`mesh-boundary.test.mjs`, `mesh-distance.test.mjs` (16 pass), then
`mesh-repair.test.mjs`, `studio-import.test.mjs`, `geometry.test.mjs`,
`pipeline.test.mjs` (39 pass), then `dev-map.test.mjs`,
`dev-map-reference.test.mjs`, `skill-digest.test.mjs` (25 pass); no failures, no
skips. The test that asserted the budget throws now asserts the opposite: the
196,608-face streamed import completes with `SAAM_MESH_MEMORY_MIB=16` set, which
is the setting that used to refuse it, and a separate fast test covers index
capacity at its exact boundaries, an injected allocator failure naming its stage
and size, and the worker out-of-memory mapping. `node dev-map/cli.mjs check`
passes.

### Group E — sweep, decisions and register

The owner decided which requested counts are guidance and which are intended
recipe shape. Upper ceilings on loop counts are gone: full-fill `perimeters`,
planar-infill `perimeters`, draped-skin `layers`, thick-lip per-step perimeters
and (by the same reasoning) support `perimeters` now accept any whole count from
their lower bound up. More than about eight is rarely useful, so that advice
moved into the five skill manuals, where advice belongs. Nothing downstream
assumed the old maximum: every consumer loops to the requested number or derives
its ring offsets from it. Kept, by the owner's decision: geometry dimension
ranges, `composition.regions` at most 80, assembly `parts` 2–20, text `features`
at most 40, text length at most 2,000, `thick-lip.steps` at most 50 entries, and
`composition.batchLayers` 1–20, which stands in for head clearance beside a
taller neighbour and is to be revisited with the scheduler when more multi-axis
machines join the test program.

The completeness sweep then read the whole of `core/`, `skills/`, `studio/`,
`adapters/`, `tools/` and `scripts/` again under six patterns rather than one.
That mattered: the first file list used `git ls-files 'studio/**/*.mjs'`, which
matches nothing one level deep and silently omitted every Studio file. Four
things were still refusing or degrading real work.

- **Three subdivision depth ceilings inside skills.** `depth<24` in the vase
  spiral and in mapped-motif sleeve paths, `depth<30` in wave curve refinement.
  Groups A and B replaced exactly this pattern in `core/`; these were in
  `skills/` and were missed. All three now report parameter underflow — the
  subdivided midpoint is no longer distinct from its ends — which is a fact about
  the interval rather than a number, and the `depth` argument is gone.
- **A silent fill-front ceiling in the draped-skin reserve field.** `extrapolate`
  ran at most 4,096 passes and then returned a *partly filled* field with no
  error at all, which is worse than a throw. The loop already had both real
  criteria: it returns when no sentinel remains and breaks when a pass changes
  nothing. The ceiling was simply deleted.
- **The DENSO program reader's step budget** (10,000,000 statements) and its
  per-command subdivision budget (100,000). The step budget became the same rule
  group B gave the Dobot Lua reader: emitting a move or a process event is the
  only effect a reader can observe, so each emission resets the count and the
  interpreter fails when it runs more statements between two emissions than the
  whole loaded package contains. A delivered program is straight-line, so the
  rule never reaches one. Subdivision already follows the commanded rotary sweep
  and room travel, so its cap became a representability check.
- **A regression the Griffin dwell work opened.** Relaxing the shared
  `validatePath` dwell range let a pause over 60 s reach every writer, but only
  Griffin split it. The Dobot writer emitted one `Wait(120000)` and its own
  interpreter refused to read it back. The Dobot writer now splits a long pause
  into consecutive `Wait` commands that sum to it, the reader keeps its per-command
  0–60,000 ms range, and a pause that fits one command is byte-identical as
  before — with no `Math.ceil`, because `Wait` accepts fractional milliseconds
  where `G4 P` does not.

Prose that promised budgets the code no longer has was corrected in the full-fill,
wave-overhangs and gridfinity manuals and in the STL normalization contract, and
the two "the retired `maxPoints` setting is rejected as an unknown field" notes
in the vase-wall manuals were deleted rather than kept as compatibility text.
Everything else that still names a retired budget is either history in this log,
a test comment explaining what a new test replaced, or a deliberate pin proving
the setting is inert. The stale example bundles under `examples/prints/*/prepared/`
do still carry removed keys, but that directory is git-ignored local output,
regenerated by `node examples/prints/create.mjs`.

Plenty of numbers were read and kept, and the reasons are now written down where
the next developer will find them rather than in a scratch file. `maps/reference/system.md`
gained **Limits that adapt, and limits that are kept**: the rule in three
sentences, the replacement techniques, and a table of every retained limit with
its location, what it protects and why it is real rather than a guess — machine
limits as a class, index and kernel capacity, the Studio upload and request-body
boundaries, the native report size, cache eviction, the one-turn angular
conditioning criterion, `validate` depth, jog relaxation sweeps, the one-command
dwell maximum that splits, ZIP32 container sizes, DENSO's 2,000-statement
segmentation, malformed-file guards, the schema ranges the owner kept including
`batchLayers` with its reason and the intent to revisit it, download limits and
coordination timers. `BUILDERS.md` points at it from the paragraph on what a
check must earn.

Three things are left for the owner, with no code changed. The MCP adapter still
refuses an STL source over 64 MiB even though it names a local file path, so with
the memory guard gone it is now the binding fixed limit on that import route, and
whether MCP is a boundary like Studio's is his call. `plastic-weld` accepts at
most 256 sites: it is the same class as the authored-shape bounds he kept, but
the most reachable of them, since the manual's own 12 mm pitch over a 200 mm
plate is already 256 sites on one level. And `maxHoleEdges` is capped at 100,000
because hole triangulation is cubic in the boundary edge count — bounding what
may be asked for, not what a mesh may contain.

Checks for group E: `skills/full-fill/tests/full-fill.test.mjs`,
`skills/planar-infill/tests/infill.test.mjs`,
`skills/draped-skin/tests/draped-skin.test.mjs`, `skills/thick-lip/tests/lip.test.mjs`
(28 pass), then `core/tests/workflow.test.mjs`, `studio-settings.test.mjs`,
`composition.test.mjs`, `pipeline.test.mjs` and
`skills/full-fill/tests/perimeter-wall.test.mjs` (33 pass), then
`skills/supports/tests/supports.test.mjs` (8 pass), then
`core/tests/dobot.test.mjs`, `denso.test.mjs`, `export.test.mjs` (20 pass), then
every `skills/vase-wall/tests/`, `skills/wave-overhangs/tests/` and
`skills/draped-skin/tests/` file (72 pass, and the two known pre-existing
vase-wall interoperability failures), then `core/tests/skill-digest.test.mjs`,
`dev-map.test.mjs`, `dev-map-reference.test.mjs`, `context-map.test.mjs`,
`agent-toolkit.test.mjs`, `source-player.test.mjs`, `robot-playback.test.mjs`,
`machine-presentation.test.mjs` and `skills/gridfinity/tests/` (87 pass across
two runs); no skips. Each removed ceiling is now pinned from the other side: ten
perimeters on a small box validates and deposits more wall than two, ten draped
skins reach layer index nine, a 24-perimeter lip step generates, and a 150 second
Dobot pause exports as 60,000 + 60,000 + 30,000 and reads back as 150 seconds.
`node dev-map/cli.mjs check` passes.

Repository-wide checkpoint verification on 2026-09-19 ran `npm test`: 1,096 of
1,100 tests passed. The four failures are the already recorded MCP
transport-close expectation, Studio lifetime harness, and two plastic-weld
overlap cases (the latter also fail at `6004141`); no new failure was found.
`node dev-map/cli.mjs check --json` also passed with 1,527 pages, no stale store,
no unreached pages, no orphan facts and no fact errors.

## 2026-09-18 — Finish opening Studio in a tab that is never painted

In an embedded browser pane that was not being composited, the page stayed on
"Opening Studio… Please wait" until a paint was forced. `working()` waited on two
nested `requestAnimationFrame` callbacks before running its task, so it could
give the indicator a chance to paint; a hidden or unpainted tab runs no frame
callback at all, so the task — and the overlay's dismissal — never happened.
`acknowledgeDisplayedView()` waited the same way, inside the load it gated.

Both now share one `painted()` helper: two frames when frames arrive, otherwise a
150 ms deadline. Drawing still uses `requestAnimationFrame` alone. Verification:
`studio-view-readiness` (13/13, one new case whose harness never fires a frame
callback and which hung before this change), `studio-tour-ui`,
`studio-reconnect`, `studio-playback-cache`, `studio-spinner` (22/22);
`dev-map.mjs check` passes. Not reproduced in a real unpainted browser pane.

## 2026-09-18 — Put the agent-request read back on pushes

A browser network log showed hundreds of `GET /api/agent-requests` shortly after
a page load. Two sources, both in the browser:

- `agent-ui.mjs` read the endpoint from a fixed 750 ms timer — a continuous short
  poll on an idle page, contradicting the documented rule that record changes
  arrive as `studio-change` pushes. The timer exists to re-evaluate request
  expiry and the lost-contact message locally; it had no reason to read.
- `render()` called `onPresentation()` on every pass while any unpresented
  request had a receipt against the drawn view. The server independently decides
  whether that view receipts the request and may decline (stale export, another
  instance, another print). When it declined, nothing changed, so the browser
  re-posted `/api/view-ready` at the same 750 ms cadence, and every
  acknowledgement the server did accept pushed a `requests` change that drove
  another read.

The read now follows the revision read: the `requests` push kind, a reopened
viewer stream, the page becoming visible, and a 15 s heartbeat. The 750 ms timer
renders only. Acknowledgement is asked once per displayed view and record set and
asked again whenever either moves. No throttle was added. Verification:
`studio-agent-ui` (2/2, one new case), `studio-view-readiness`, `studio-work`,
`studio-agent`, `studio-tour-ui`, `studio-reconnect` (53/53);
`dev-map.mjs check` passes. The original log was recorded while a separate
process was also polling and writing request records, which would have added
push-driven reads on top; that part is not reproduced here.

## 2026-09-18 — Let a relaunched Studio recover its agent's in-flight work

Relaunching Studio through the toolkit always minted a fresh agent owner, so
every request from the previous run became invisible to the new one: the journal
that exists for restart recovery could never be used for it. The tour's settings
lesson made that visible — its gate looks for an agent-sourced request whose
result is the displayed toolpath, and after a relaunch no such record was
visible, so Next stayed locked although the changed toolpath was on screen.

`start-tour`, `open-print` and `create-preview` now accept `--agent-owner ID`,
the `agentOwnerId` from an earlier `studio-ready` line. It is validated as an
agent-minted ID (a `studio:` session fallback is rejected) and only decides which
request store the new server gets: the relaunch still mints its own instance and
attaches to no running server, keeping one immutable owner per instance.

The tour gate keeps its intent — a participant-requested agent edit, not
automatic Studio work or a request predating the lesson, whose result is the
current displayed export — but reads the print's whole request history through a
new read-only `anyOwner` option instead of the current owner's share, so it no
longer depends on who launched Studio. Verification: `studio-tour` (11/11, one
new relaunch case that also re-checks the automatic-work rejection),
`agent-toolkit` (11/11, one new owner-resume case), `studio-agent`, `studio-work`,
`request-index`, `studio-events`, `studio-tour-lifetime` all pass;
`dev-map.mjs check` passes. The two MCP task-manual/transport-close failures in
`mcp.test.mjs` are the pre-existing ones already recorded here.

Known remainder, not addressed: a request bound to the previous instance cannot
be answered through the new instance's stdin live control, which checks
`studioInstanceId`; the CLI path answers it. A relaunch also does not re-attach
`studioOwner` in `.tour-progress.json`, so a resumed `open-print` does not become
the tour's owning Studio.

## 2026-09-18 — Report a Studio running behind the files on disk

A live Studio held the plan schema it imported at startup while its generation
worker, running in a fresh module graph, read the current files. When another
session retired a plan field, the worker rejected the recipe the server had just
written; once the recipe was corrected the server rejected it with HTTP 400 and
the page looped on "Could not update the print: Reconnecting to your print…".
Nothing named the real cause.

Detection, not hot reload, and no new endpoint or event kind: the server records
its module-graph load time and, only after a failure has already happened,
scans `core`, `studio`, `skills` and `machines` for the first `.mjs`/`.json`
modified since — skipping test and fixture directories. The notice is appended
once to that error, so the page's review note, the agent event queue, the
generation-failure request instruction and the HTTP 400 body all name the changed
file and say to restart Studio. A detected skew is remembered until the process
restarts; negatives are rechecked at most every three seconds, so a recurring
poll failure does not rescan. Verification:
`core/tests/studio-agent.test.mjs` (13/13, one new case covering an untouched
checkout, test-file churn, a changed module and single annotation).
`dev-map.mjs check` passes. Not exercised against a real concurrent edit.

## 2026-09-18 — Name the offending fields when a plan is rejected

`plan.mjs keys()` compared joined key lists and reported only "Unexpected or
missing fields in plan.skills.planar-infill.", leaving the agent or maker holding
the recipe to diff the schema by hand. It now lists them: "… in plan.process:
unexpected layerHeight; missing layerMm." The stem is unchanged, so the six
existing regex assertions still pass, and `inspect-generation-failure` gains the
detail for free through `validationError`, which is the loader message verbatim.
No migration or acceptance of retired fields was added. Verification:
`core/tests/pipeline.test.mjs` (7/7, one new case), plus the five suites that
assert the old message — crossed-cladding, spacing, full-fill, planar-infill
patterns, text interoperability and vase (51/51). `dev-map.mjs check` passes.

## 2026-09-18 — Keep the toolpath viewport occupied while its program is missing

A live tour reported an empty 3D viewport on the toolpath lesson while the
toolpath was still being calculated. The earlier fix the user remembered is
`7f2d3a5`: it retains the superseded snapshot in `stalePresentation` and fades
the canvas with `.stale-toolpath`. That covers only regeneration — the path with
a previous toolpath to keep. Nothing covered a first generation, a reload during
one, a tour lesson that starts its own generation or a failed generation, because
`draw()` gated the whole geometry branch on `tab!=='toolpath'` (the BR-029
decision to show no part geometry in toolpath view) and the toolpath branch needs
a program, so the frame held only the background gradient and the bed grid.

`draw()` now renders the part whenever the toolpath pane has nothing else to
render, two named predicates decide it (`toolpathPlaceholder`, `showingGeometry`),
and the existing 28% fade applies to both placeholders. The toolpath tab also
stays reachable while a calculation is pending, and **Confirm** on that pane
returns to it instead of launching a competing calculation. No geometry is drawn
once a program exists, so BR-029's rule is unchanged. Verification:
`core/tests/studio-view-readiness.test.mjs` (12/12) with three new cases that run
the real `draw()` over a stub 2D context; `dev-map.mjs check --since HEAD` passes.
Not visually confirmed in a browser. The same file's browser-source harness
stripped `import` lines with `/^import .*\n/gm`, which cannot match a CRLF
checkout; five of its cases failed before this change for that reason alone and
now pass.

## 2026-09-18 — Toolpath viewer lag: CPU rasterization, lossless renderer savings

- Source: user (builder task), 2026-09-18: the toolpath viewer had become slow on
  pan and tilt.
- **Cause.** Not a code regression. The person's Chrome had fallen back to the
  Microsoft Basic Render Driver (CPU), while another browser on the same PC used
  the GTX 1660 Ti. `freehand-spline-cat` (124,978 beads, 623 groups, 1366×540)
  cost 544 ms per frame there, all in the material pass; about 10 ms of
  main-thread time on the GPU.
- **Measurement.** Studio now reports interactive redraw timings and the WebGL
  renderer string to `/api/view-performance`, replacing console snippets. A hidden
  agent browser pane throttles animation frames and cannot measure frame rate.
- **Renderer.** One unblended depth-tested pass replaces the depth prepass,
  stencil and blend pass; bead templates are indexed (box 48→26, oval 192→66
  vertices) and wound outward for back-face culling; off-screen groups are
  skipped. Measured on the CPU renderer at full quality: 544 → 155 ms. A pixel
  diff against the previous renderer on 18 synthetic views (crossing, touching and
  overlapping beads, views from below, mid-print, zoomed and off-screen) stayed
  within 2/255 plus at most 14 depth-tie pixels, with identical coverage. An
  inverted front-face rule was caught by that diff before use.
- **Rejected.** Merging groups into shared buffers with a per-bead style texture
  cut 623 draws to 2 but measured slower on the CPU renderer (215–266 ms): two
  vertex texture fetches per vertex cost more than the draw calls saved. Reverted.
  Render resolution barely matters there: 9× fewer pixels saved about 5%.
- **Motion quality.** Resolution levels remain for fill-bound GPUs and undo
  themselves when they do not pay.

Checks: Studio tests pass except `studio-lifetime` "last viewer closes only its
instance", which fails identically with these renderer changes stashed.

## 2026-09-18 — Agents can reuse their Studio when switching prints

- Source: user (developer task), 2026-09-18: maker agents never followed the
  MAKERS rule to reuse the existing Studio and tab; find out why and fix the CLI
  and MCP.
- **Cause.** The rule had no tool support. Toolkit `open-print`/`create-preview`
  always created a Studio on a fresh port, the managed session's stdin had no
  print-switch command, and the only switch route (`/api/open`) needs the viewer
  token. MCP `request_review` reused an instance per print only, so a different
  print opened a second Studio unless the agent passed `studioInstanceId`.
- **CLI.** Studio gains the owner-authenticated `POST /api/agent-open`. Toolkit
  `showPrint` prepares the print exactly as a launch does, then shows it in the
  live Studio: `open-print|create-preview DIRECTORY --studio URL --agent-owner ID`
  from any process (the command exits), or the same commands on the managed
  session's stdin. Launch results carry `reuse` with the exact command, and help
  states the default. An adapter or agent open that changes the print now pushes
  a `print` change, so the tab follows at once rather than on the slow heartbeat.
- **MCP.** `request_review` falls back to the sole live instance before creating
  one; with several live instances `studioInstanceId` still chooses.
- **Guidance.** MAKERS names both reuse routes and allows another instance on the
  person's request or for a compelling reason stated to the person.

Checks: agent-toolkit (new HTTP/stdin/CLI switch cases pass; the onboarding case
fails on the unregistered untracked `studio/view-performance.mjs`, unrelated),
mcp and studio-open (pass except the known task-manual and transport-close
failures).

## 2026-09-18 — X1 Carbon output through the shared Bambu exporter

- Source: user (builder task), 2026-09-18, after printing the freehand spline cat
  on the H2D: create an X1 exporter that shares the H2D components rather than
  parallel wiring.
- **Physical report, H2D.** The user printed `freehand-spline-cat` (40 mm tall,
  left 0.4 mm nozzle, PLA, 3 perimeters, 12% gyroid, one two-tip tree support under
  the chin, v3 envelope) and reported that it completed and "looks great", and that
  the support was unnecessary. One part on one printer; no measurements.
- **One Bambu adapter.** `bambu.mjs`, `bambu-player.mjs` and the registry entry
  are unchanged in number: the X1 Carbon declares the same `bambu-gcode` output.
  Model facts moved from code into the machine files: output `constraints`
  (material, nozzles, filament, optional `bedC` window, `endLiftMm`,
  `parkLimitMm`, `parkRiseMm`, `parkHeightFactor`, `parkSettleMm`) and `package`
  (`printerModelId` plus literal `projectSettings`). Per-nozzle metadata derives
  from `machine.tools`, the printer names from `machine.name`, the body origin from
  `startupPosition`, which must match the pinned startup's final moves. New
  template values are `{wipeC}` and `{parkSettleZ}`. The artifact context schema is
  now `saam-bambu-artifact/1`; error messages say Bambu. H2D machine revision 12;
  existing H2D bundles hold an older snapshot and are recreated.
- **H2D bytes unchanged.** The pre-change cat archive, with only its context
  schema string renamed, is reproduced entry-for-entry by the generalized writer.
- **X1 reference.** The installed Bambu Studio 02.08.02.61 CLI sliced a 20 mm
  cube from flattened system presets (the CLI does not resolve `inherits` or the
  start/end `include` templates itself; an unflattened run silently produced a
  generic 33-line startup). Contract `x1c-02.08.02.61-pla-textured-v1`: 533 start
  and 67 end commands; see the [X1 contract](maps/reference/bambu.md#x1-carbon-output-contract).
  The reference archive stays outside Git; the machine file records its SHA-256.
- First X1 part: `freehand-spline-cat-x1`, 58 mm tall, no supports, 289 layers,
  about 54 min of body motion and 7.5 cm³. Software checks only; no Bambu Studio
  viewer import and no physical X1 print.

- **X1 Carbon load failures and first print (user reports, 2026-09-18, microSD,
  FAT32).** The exporter's archive froze the printer's file loader for several
  minutes and then failed without a message. Single-change archives isolated it:
  uppercase MD5 alone failed; adding Bambu Studio's G-code header and CONFIG block
  failed; Bambu Studio's complete package around the SAAM G-code loaded, with either
  SAAM's ZIP writer or a .NET one; from that package, SAAM's 256 px thumbnails loaded,
  SAAM's `project_settings.config` loaded, SAAM's `slice_info.config` froze. The ZIP
  writer, G-code, header, MD5 case, thumbnails and project settings are therefore
  cleared; `slice_info.config` is a cause. Rewriting it and `model_settings.config`
  in Bambu Studio's one-element-per-line layout did not fix the exporter's archive
  (P1 still froze), so a value in `slice_info.config` and/or an untested entry
  (empty model, `saam.json`, `plate_1.json`/`filament_sequence.json`) remains.
  Untested lead: the `X-BBL-Client-Version` value `SAAM-0.1.0`.
- The hand-assembled fallback (Bambu Studio's reference package, SAAM G-code, only
  slice_info totals changed) loaded and started printing. The user saw bed leveling,
  vibration testing and dynamic flow calibration run; the purge line could not be
  told apart from the calibration lines. This archive bypasses the exporter's
  package verification; the exporter itself still produces archives the X1 rejects.
- **AMS selector is logical, not physical.** That print used the second slot from
  the right (slot 3) although the G-code carries `M620 S0A`/`T0`/`M621 S0A`. The
  printer maps logical filament 0 to a tray at print start (its own type/colour match
  or the operator's choice on the confirmation screen). `setup.ams` therefore does
  not select a physical slot on the X1 Carbon when printing from the card; the same
  claim for the H2D is unverified.

- **Cause found (user report, same day).** The working package with SAAM's
  `slice_info.config` (new layout) and only `X-BBL-Client-Version` changed to
  `02.08.02.61` loaded. The `SAAM-0.1.0` version string is therefore a cause of the
  freeze; the layout's role is unknown (the compact layout was only tried with the
  SAAM string). Both machine files now carry `package.clientVersion` and the
  exporter writes it. The exporter's complete archive, regenerated as
  `freehand-spline-cat-x1-r2` with identical executable G-code, still awaits a load
  test on the printer.
- **Remaining entries cleared (user report).** From the working package, SAAM's
  empty model with `model_settings.config`, the extra `saam.json`, and
  `plate_1.json` with `filament_sequence.json` each loaded when swapped in singly
  (compact pre-layout versions). Every SAAM package entry has now loaded
  individually; the client version is the only cause found. All of them together,
  the exporter's own archive, remains the one untested combination.
- **Exporter archive loads (user report).** `freehand-spline-cat-x1-r2`'s export
  loaded on the X1 Carbon, confirming the client-version fix end to end. The
  printer warned that the file does not support manual AMS mapping. Per the user
  the warning is harmless in use: the gray spool was still pre-selected from the
  recorded colour and the print could be started; the Bambu-package fallback showed
  no warning. Cause open; untested isolation archives W1–W3 (Bambu project settings,
  model/object, slice info and plate JSON swapped into the exporter archive) are kept
  in the bundle's `diagnostics` folder.
- **X1 print.** The 58 mm cat printed well from the fallback archive, without
  supports; the user judged supports unnecessary for this model at either size.
- **Spool choice resolved.** With the package labelled gray (`#8E9089`, PLA) the
  printer pre-selected the gray spool. The earlier slot-3 choice was the printer's
  colour match to the reference package's green label, not a fault.
- The saved `freehand-spline-cat-x1` plan stopped validating mid-task when other
  uncommitted work changed the `wave-overhangs` plan fields; the bundle was
  recreated rather than patched.

Checks: bambu and printer-profiles tests, the H2D byte-identity comparison. The map
structure check could not run (another task's unregistered `studio/view-performance.mjs`).

## 2026-09-18 — Optional AMS and colour, no code fingerprint, plan-first writes

Follow-up to the TK-Dev port, from a map-driven review.

- **AMS and colour are optional.** `setup.ams` is null or `{unit, slot}`; the
  H2D profile's `ams` block declares two units of four slots, and slots number
  continuously across units (unit 2 slot 1 is selector 4). `setup.filamentColor`
  is null or a hex colour and falls back to the output's `defaultFilamentColor`.
  Both are blank by default and nothing prompts for them; a printer without an
  AMS uses the unchanged selector 0. `validateSetup` is the single check; the
  exporter's duplicate checks and its copies in `saam.json` are gone. Selectors
  above 3, and pairing an AMS unit with the selected nozzle, are untested on
  hardware.
- **H2D v1/v2 startup envelopes removed.** Only v3 is recognized. Local
  experiment bundles holding a v2 machine snapshot must be recreated.
- **Runtime fingerprint removed.** Plan identity is plan, machine snapshot and
  geometry bytes. A confirmation is already bound to the exact exported bytes,
  which a code change cannot alter, so editing SAAM's code no longer withdraws
  confirmations. The two hand-kept file lists (`RUNTIME_FILES` and the list in
  `runtimeHash`) are deleted; they had already drifted (the line-network
  generator, `path/material.mjs` and `region/perimeters.mjs` were unlisted).
  Every existing bundle's plan hash changes once, so saved programs read as stale
  and regenerate.
- **Non-robot machines are profile data.** `limitations`,
  `startup.handsOverRetracted` and gantry presentation from `kinematics` replace
  the S5/H2D machine-ID tests; X1 Carbon, UM2 Extended and UM3 now get the gantry
  schematic. Only Dobot and DENSO are still selected by ID. The line-width limit
  has one owner (`lineWidthLimits`).
- **plan.json is the commit point.** A new bundle writes it last; an edit builds
  geometry first, writes the plan, then the derived geometry files; a reader that
  finds older geometry beside a committed plan rebuilds it once.
- **Failed arm solve.** The provider reports the source-determined part (and tool
  point) instead of an identity part frame.

Checks: bambu, workflow, machine-presentation, studio-kinematics, intersection,
studio-settings, line-network, export and the map structure check.

## 2026-09-18 — Port TK-Dev line networks, regional process and H2D setup

Ported Timothy Keller's `origin/TK-Dev` work onto the current branch: his
line-network/H2D commit (`1cee91b`, as merged with main in `5f26d11`) and his
sequential export names (`60d61b9`).

- **line-network skill.** Explicit planar centerline networks, one bead per
  polyline, repeated for a course count, with optional per-stroke course
  selection for reinforcement. It is a standalone producer: validation rejects
  it alongside body, skin, vase, lip or regional producers. Built for the
  six-face weld-together dice.
- **Regional process overrides.** A region may override `firstLayerMm`,
  `layerMm`, `lineWidthMm`, `planarSpeedMmS` and `firstLayerSpeedMmS`; such a
  region owns its own layer grid from its start height, with global layer
  indices taken from the union of regional heights.
- **Experimental deposition.** `process.experimentalDeposition` raises the plan
  caps to 1 mm layers, 2 mm beads and 30 mm³/s, checked against a new tool
  `experimentalPlanar` envelope and material `experimentalMaxFlowMm3S`.
- **Locked prime line.** `process.primeLine` (one pass or up to eight) replaces
  profile priming and precedes every material operation.
- **Wall and spacing controls.** `perimeterScope: 'outer'` on full-fill and
  planar-infill, full-fill `holeLineWidthMm`, and `spacingFactor` down to 0.5
  for deliberate bead overlap.
- **H2D setup (machine revision 10, envelope v3).** Hardened 0.4/0.6/0.8 mm
  nozzles on either tool with per-nozzle package metadata; filament colour; AMS
  slot 1–4 rendered into the startup `M620`/`T`/`M621` commands. PLA nozzle
  limit rises to 250 °C and the standard layer range to 0.6 mm. Remembered setup
  and machine changes fit line width to the selected nozzle.
- **Studio.** Line-network recipe and preview rows; an export name containing
  `-V<n>-` advances after each successful export in the session.

Adapted to current contracts while porting: `validatePlan` stays check-only, so
TK-Dev's in-memory fills for the new fields were dropped and a recipe missing
them is rejected. Region `process` is optional and never defaulted. Approval
assertions use the single final approval. The existing `.gcode.3mf` download
naming was kept in place of TK-Dev's first-dot variant.

Follow-ups: line-network centerlines are now checked against the selected
tool's bounds (the geometry bound check does not see them); H2D package
metadata is built directly rather than by string replacement after the fact;
`holeLineWidthMm`, region process overrides, experimental deposition and the
line-network producer are documented in the skill manual and generation/regions
references.

Physical status, from Timothy's record: an earlier 0.8 mm H2D attempt showed
build-plate, nozzle-identification and AMS-selection warnings. The metadata and
command selection now address them but have not been physically retested. The
0.6/0.8 mm paths reuse the 0.4 mm firmware envelope and, with the high-flow
settings, have software checks only.

Verification ran in a clean detached worktree at 2207cb9 plus this port. The
focused suites (bambu, line-network, regions, spacing, studio-settings,
workflow, interoperability, perimeter-wall, patterns) pass. The full core and
skills suite ran 687 tests: the seven failures known before this work (two MCP,
regional base/vase cladding, two plastic-weld, two vase-wall interoperability)
remain, and five studio-view-readiness cases failed only because that worktree
checked files out with CRLF endings, which the harness's import stripping does
not handle; they pass in the LF shared checkout. The interoperability
cross-machine case now also accepts the strict setup-field rejection, since
H2D setup carries filament colour and AMS slot. `dev-map.mjs check` passes.

## 2026-09-18 — Remove print-bundle compatibility extras

Under the DEVELOPER-CONTEXT status note (no bundle back-compat until about
2026-10-01), three parallel agent packages deleted the compatibility paths the
dev-map contracts still described, instead of relocating them.

- Plan schema: `validatePlan` is check-only. Every in-memory fill, retired-field
  deletion and backfill before the strict key check is gone; a recipe missing a
  current field is rejected and recreated from its skills. The `upgrade` command,
  its unimplemented adapter hook, the Griffin/rules startup-field fallback, the
  stale `path.saampath` cleanup and the retired repair-option list are removed,
  with their contract text in lifecycle, generation, regions, geometry, bambu and
  testing references. Text records now require `materialParts`; `standalone`
  stays optional because the producer only writes it on a reference body.
- Composition: operations no longer carry `clearanceZ`. The composer never read
  it (the builder derives clearance from deposited height); ten producers and the
  composed-result field are dropped. The material-less travel-policy branch stays
  because seven current producers still build policies without a material query.
- Studio: the old single-request receipt fallback and the `requiresTarget` flag
  are gone (edit kind implies a published target); the per-file source transport,
  its route alias and the loader's dead `sourceFile` option are removed, leaving
  the streamed `/api/sources` transport and `/api/gcode`; the accepted
  `--close-when-idle` alias is removed.

Unknown STL-repair options are now ignored rather than rejected; there is no
general unknown-option gate on that path. Studio settings keeps its
`maxPoints` label row because rimming and pipe cladding still own that setting.

Verification on the merged tree: `dev-map.mjs check` passes; core suite
506 tests, 502 pass; skills suite 169 tests, 165 pass. All eight failures
pre-exist this work: the two MCP manual-path/transport cases, the two regional
stack/cladding cases (confirmed failing at 3609a20 in a detached worktree), the
two plastic-weld cases and the two vase-wall interoperability cases (confirmed
by the agents at main f352322). Each package was developed and tested in its own
worktree, then cherry-picked here.

## 2026-09-17 — One fingerprint pass per Studio state read

`readStableBundle` already bracketed each load with before/after fingerprints,
but `/api/state` then computed a presentation fingerprint and rechecked the
source fingerprint in two more passes, and resolved the request print ID twice;
`/api/revision` and the approve response also took two passes each. The workflow
now exposes `bundleFingerprints(directory,{program})`, returning `{source,
presentation}` from one snapshot pass (`bundleFingerprint` is its `source`); the
tour reference adapter and machine-study adapter provide it too. The stable
reader returns both fingerprints from its first pass, and the state, revision
and approve routes take no further passes. The `studio-view-readiness` harness
sliced `app.mjs` at the old `approval(stage)` signature from the approval
collapse; its boundary is updated and all nine cases now pass.

Verification: studio-view-readiness (9/9), read-scope, studio-reconnect,
studio-open, studio-tour, studio-agent, workflow, studio-generation-control,
machine-study, agent-toolkit and studio-tour-lifetime pass;
`dev-map.mjs check --since HEAD` passes. Local `.local/` review
tools that fake a Studio adapter with only `bundleFingerprint` need
`bundleFingerprints`.

## 2026-09-17 — One worker supervisor for STL import and repair

Studio's STL import launcher (`importInWorker` plus `studio/import-worker.mjs`)
was a near copy of the core repair supervisor. The import-or-repair step moved
to core as `importOrRepairSTLBundle` in `core/print/import-stl.mjs`: like
`repairSTLFiles`, it runs `runRepairJob` (new mode `import`) on the main thread
and works inline in the shared `mesh-repair-worker.mjs`. It reports stage codes
(`import`, `repair` with the repair step, `import-repaired`); Studio maps them
to its progress labels and builds the repair summary afterwards. The repair
eligibility classifier moved with it, and the worker's error payload now carries
`meshDiagnostic`. `runRepairJob` now settles only after terminating its worker,
preserving the import transaction's "worker stopped before the reserved
directory is removed" order for every job. Studio's worker file and its
promise/terminate plumbing are gone.

Verification: studio-import and mesh-repair pass (17/17); mcp and studio-agent
show only the two known pre-existing MCP failures; `dev-map.mjs check --since
HEAD` passes.

## 2026-09-17 — Event-driven Studio revision checks

Every Studio tab ran `poll()` each second, and each poll computed two bundle
fingerprints plus tour info on the server, although the viewer stream already
pushed print and tour changes that triggered the same poll. The request feed also
pushed `requests` changes that the app listener discarded, so tour Next gating
from request activity was only picked up by the fixed poll. The app now checks
`/api/revision` on a pushed print or tour change, on a request change while a
tour is active, on viewer-stream error or reopen (new `saam-viewer-connection`
event from `viewer-session.mjs`; the first open is skipped), on the page becoming
visible and on a 15-second heartbeat. The heartbeat covers an unavailable
watcher, request lease expiry and missed pushes; a restarted server rejects the
old stream token, whose error triggers the check that reloads the page.

Verification: studio-reconnect, studio-visibility, studio-work and
studio-lifetime pass (26/26, lifetime now asserts the connection signal);
`dev-map.mjs check --since HEAD` passes. Not exercised in a live browser.

## 2026-09-17 — One final approval record

The lifecycle contract had retired geometry approval and kept plan approval only
"for record compatibility", yet `approve` still accepted a `stage`, wrote a
mirrored `approvals.plan` beside `approvals.toolpath` and recomputed three
booleans; the loader, Studio state/approval responses, CLI, agent toolkit and MCP
summaries all reported them, and `/api/approve` special-cased a geometry stage.
Now `approve({actor, revision})` writes one `review.approvals.toolpath` record
(export hash, plan hash, `['settings','toolpath']` scope) and `toolpathApproved`
is the only derived state. Every invalidation (plan, machine, upgrade,
regeneration) resets `review.approvals` to `{}`; per the current status note,
retired records get no compatibility handling. MCP/toolkit summaries report `toolpathApproved` in place
of their `approvals` objects; the Studio tour rejects `/api/approve` outright.
The Studio change-follow rule that switched to the toolpath tab on
`planApproved` now uses `toolpathApproved`. The repair report no longer claims
`geometryApproved:false`. Lifecycle, Studio and MCP contracts updated together.

Verification: workflow, chat-geometry-confirmation, studio-agent, studio-work and
studio-tour pass (41/41); the other 28 edited test files pass except the known
pre-existing MCP task-manual/transport-close and studio-view-readiness harness
failures and two plastic-weld overlap failures that also fail at `6004141`.
`dev-map.mjs check --since HEAD` passes.

## 2026-09-17 — Bring dev maps up to date with the Studio event and vase-wall work

A map review since `7f2d3a5` found the Studio event queue, listener ownership
and stage-tab behavior documented, but several contracts behind the code. The
`9_agent` page now maps `readStudioEvents` (9.7) and the shared owned-Studio
long-poll `pollStudio` (9.8), and 9.4 reads "wait for requests / events"; the
toolkit change contract describes event streaming, the owner-authenticated
cross-process read and wait, their rejections and the new toolkit cases. The
`7c_requests` page maps `activeEditStage` (7.4.7) and the request/presentation
contract states the pane-specific fade. The motion reference no longer claims a
vase point budget and names the fitted-sleeve path; the testing inventory lists
`studio-events`, `studio-print-name` and `studio-spinner` tests and the new
vase-wall regressions. Verification: `dev-map.mjs check` and the map/context
suites pass (43/43). Documentation only; no behavior change.

## 2026-09-17 — Studio event queue, owner-locked listeners and calculation progress

Studio now writes what the person does, and what its workers produce, to one
agent-owned **Studio event queue** (`studio/studio-events.mjs`), shared by that
agent's Studio instances. Held kinds (viewer connections, displayed views,
approvals, calculation start/finish, tour play/pause, import start, example
adoption, plan updates) wait for a read. Delivered kinds (tour start/lesson/exit/
finish, queued and presented requests, failed or cancelled calculations, imports,
opened prints, exports) push at once and carry every held event with them.
Pushes never drain the queue; reads do, so a client that never surfaces a push
still receives the batch on its next tool result, listener wait or explicit
read. Channels: MCP `get_studio_events`, `studioEvents` on every tool result,
`events` in `wait_for_studio_request` returns and `saam.studio` notifications;
toolkit `studio-events` stream lines plus stdin `read-studio-events` and
`wait-for-studio-request`; and the owner-authenticated
`GET /api/agent-events` long-poll on any owned Studio, wrapped by
`read-studio-events --studio URL --agent-owner ID` and
`wait-for-studio-request --studio URL --agent-owner ID`, so a client that cannot
write to the live session's stdin still receives pushes through its bounded
wait. Every read reports `generation`: status, trigger, elapsed time and worker
progress with a percentage for each owned instance still preparing or
generating; the passive queue holds only start and finish. This also makes the
tour's change-suggestion lesson (step 6) reach the agent as a `tour-lesson` event
with the lesson instruction, beside its existing guidance request.

Confirmed and closed a listener leak: an ownerless request store (the raw
`node studio/agent-requests.mjs wait` listener, or `wait-for-studio-request`
without `--agent-owner`) saw and could claim every queued request in the library,
including requests bound to other agents' Studio instances. A store with an
owner now sees its own and ownerless records; a store without an owner never
sees or claims Studio-bound records live and reads them only as explicit
diagnostic history (`list`/`history:true`). `lifetime.mjs` reports viewer-count
changes and the start of closing so long-polls end at shutdown.

Verification: new `studio-events.test.mjs` (delivery classes, flush, drain,
dedupe, bounds, waits); new cases in `studio-agent.test.mjs` (route events,
owner-authenticated long-poll, cursor, ownerless visibility and claim refusal,
viewer events, tour lesson events, mid-flight progress), `agent-toolkit.test.mjs`
(live push, HTTP fallback wait with claim, owner rejection, in-process read) and
`mcp.test.mjs` (read/drain, wait return, notification, tool-result piggyback,
history). Two existing cases now listen with the Studio's owner ID. Verified in a
clean HEAD worktree because the checkout's concurrent vase-wall work was mid-edit.
Software behavior only; no print or approval.

## 2026-09-17 — Exact vase wall cleans mesh seam steps before the inward offset

Follow-up to the fitted-sleeve fast path below, which recorded the exact
per-section wall aborting at Z≈24.66 mm on `Prints/rocket-nozzle` with a false
"inward offset is empty, split or collapsed" rejection. Reproduced with
`generatePath` at `sleeveToleranceMm: 0` (exact path) and inspected the section:
a single healthy convex loop, ~1169 mm² and ~38.6 mm across, no holes, no thin
features. The loop carries near-collinear seam steps (~0.0166 mm edges) where the
nozzle's ruled NURBS patches meet — a collinear split vertex on an otherwise
straight edge. Quantized to the 1e-5 mm offset grid, that vertex rounds a hair
off its edge into a microscopic inward reversal; the inward bead-half-width
(0.2 mm) round-join offset amplifies it into a degenerate sliver, so the inset
returns two loops (material 1144.6 mm² plus a −1.9e-7 mm² sliver) and the wall's
single-loop requirement rejects a valid section. The offset kernel is faithful —
the map forbids small-area pruning there — so the fix belongs in the caller.

The motif path already removed these seams before offsetting (`motifContour` →
`cleanPlanarLoop`), and its comment says mesh cuts need that cleanup, but the
condition gated it to `settings.pattern`, so the standard `pattern: null` mesh
wall passed the raw cut straight to the offset. `skills/vase-wall/scripts/vase.mjs`
`section()` now runs `cleanPlanarLoop` on raw mesh cuts (`!reference &&
shell.kind==='triangle-mesh'`) at the same seam tolerance the motif path uses;
fitted-sleeve and native-spline sections stay chord-controlled and keep their
exact contour. The whole rocket-nozzle exact wall now completes; across 1075
sampled heights the cleaned inward offset never splits and the cleaned-vs-raw
material area differs by at most 0.03 mm² (of ~1145 mm²).

Verification: `skills/vase-wall` suite passes (13/13), plus `core` offset and
`skills/thick-lip` suites. A new regression extrudes the captured seam-stepped
section as a closed prism and asserts the raw section really splits the offset
while the exact wall completes as one stroke within standoff tolerance; it throws
the original error with the fix reverted. Software generation only; no physical
print or manufacturing approval.

## 2026-09-17 — Fitted-sleeve fast path for standard vase walls on meshes

Standard continuous vase mode rebuilt an exact planar section, Clipper2 offset and
arc-length contour at every rising spiral sample. Because the per-height cache is
keyed by exact Z and the spiral rises continuously, a curved wall never reuses a
section, so cost grew with sample count rather than shape. Profiling the
`Prints/rocket-nozzle` bundle (8642-vertex mesh, 107 mm, 0.2 mm layers, ~539
turns) showed 51,265 section rebuilds over the first 91 turns and hotspots in
`cleanPlanarLoop`/`chain` (14%), the Clipper2 offset (~30% across wasm frames) and
`contourPath` (7%). The exact path also aborted at Z≈24.66 mm with a false
"inward offset collapsed" rejection, although that section is a single healthy
~38 mm loop with no thin feature — a numerical artifact of the polygon offset,
recorded separately as follow-up work.

Standard mesh walls now fit one periodic NURBS sleeve to the wall interval and
follow its loose horizontal surface offset (`skills/vase-wall/scripts/reference.mjs`,
`createStandardVaseSleeve`), evaluated analytically per point instead of a planar
re-cut. The new `sleeveToleranceMm` setting (default 0.08 mm) is a target that
scales the fit's control resolution and is reported as the achieved sampled
residual. The fit is accepted when its sampled deviation meets the tolerance, or
stays within it on average with only isolated near-crease points exceeding; a
globally poor fit, a section that is not a single sleeve, or a wall thinner than
the bead (validated by sampling the offset loop for collapse/self-intersection)
returns to the exact per-section wall. `sleeveToleranceMm: 0` forces the exact
wall. Spline geometry always uses the exact path. Plan schema, defaults, Studio
recipe display and the skill manual were updated together.

Measurements (uninstrumented, this machine): the rocket-nozzle wall now generates
a complete checked program in ~2.3 s after load (generate 1.56 s, checked export
0.76 s, 110,773 moves) at an achieved max residual of 0.083 mm (RMS 0.017 mm,
cc48×hc64). The exact path did not complete: it reached only ~25 mm in 8.8 s
before the false-collapse abort. Verification: `skills/vase-wall` suite passes
except two motif tests failing on the clean tree beforehand; a new test covers the
fitted-sleeve path, its bounded standoff and the thin-wall fallback. Software
generation and checked export only; no physical print or manufacturing approval.

## 2026-09-17 — Guided-tour review and request receipt state

Revised the guided tour after a live Studio walkthrough. The change-suggestion
lesson now teaches how toolpath/process choices affect strength, finish, time and
material use without proposing geometry; independently requested geometry remains
supported through the normal confirmation return. The STL lesson points out a
disabled importer and continues with the selected part, with an orange Continue
action and a pointer-hover handoff that retires the importer blink. Playback
unlocks Next on the first Play event. Tour and maker guidance, examples and the
Studio contract were updated together, and the lesson deck version advanced.

Collapsed request presentation matching into the pure `requestReceiptState`
classifier, returning activity, receipt and confirmation-wait state for request
coordination, UI presentation and tour gates. Updated `7c_requests` and `7d_tour`
to retain only evidenced call/value-flow edges. Studio shutdown now cancels tour
work before closing its owned request store. Active tours reject STL import while
ordinary Studio retains the normal import transaction.

Verification: 85 affected Studio request, readiness, import, lifetime, playback
and tour tests passed. Syntax checks and `git diff --check` passed apart from
line-ending notices. `dev-map check --since HEAD` passed; detailed evidence for
`7c_requests` and `7d_tour` contains only supported structural flows and declared
boundaries. The generated map viewer rebuilt to 81 pages. The live walkthrough
exercised the revised tour sequence; it was software review, not a physical print
or manufacturing approval.

## 2026-09-17 — Live agent/Studio sessions and review completion

Replaced managed agent/Studio directory polling with a live request channel. One
agent-owned request store can serve multiple Studio instances, each Studio instance
has exactly one owning agent, and explicit session tools list and close those
instances. Opening the same print in more than one owned Studio requires an
instance selection before work is begun. Print bundles remain the durable,
shareable interface between agents and Studios; request files are retained as a
recovery journal and as a compatibility path for independent external writers.

Studio toolpath review now presents the agent-suggested print name in an editable
field. A person can replace it before export while the server preserves validation,
sanitization and compound machine-program extensions. Presentation acknowledgement
continues after two animation frames in the application, but the pure geometry and
toolpath readiness predicate now lives in `studio/work-state.mjs`; presentation
receipts are scoped to the Studio instance that rendered the result.

The agent toolkit, persistent launcher and MCP adapter carry owner and instance
identity through request, response, activity and presentation operations. The
managed launcher accepts correlated live commands over its existing process stream,
and the MCP adapter exposes Studio-session inventory and closure. Updated the Studio,
agent and protocol maps and rebuilt the generated viewer.

Verification: 42 focused request-index, Studio, toolkit, naming, readiness and work
state tests passed. Four focused MCP notification/session tests passed, including
one agent owning multiple Studios and same-bundle disambiguation. `git diff --check`
passed apart from line-ending notices. The map viewer rebuilt to 81 pages and
`dev-map check --built --since 0b2e1f8` passed. These are software checks; no
machine execution, physical print result or manufacturing approval is established.

## 2026-09-17 — Map-owned core and Studio reference

Implemented the requested single technical documentation structure for core and
Studio. Migrated 21 component/verification manuals into region-owned references,
preserving old paths and heading links as compatibility routes. Added the Studio
state/worker protocol reference. The system map now routes responsibilities,
contracts and representative changes; 57 pages expose implementation entry points.
Every scanned core/Studio production JavaScript module has a mapped declaration.
This does not assert that every helper or dynamic relationship is explained.

`read-map` returns one page, with separate contract-section, node, resource-inventory
and detailed-evidence reads. The viewer embeds the same 23 reference sources.
Developer onboarding no longer preloads skill catalogs or a parallel component
manual hierarchy. Skill-only builders retain their authoring material and consume
shared API contracts without needing implementation maps. Makers need no dev maps;
builders changing core/Studio use the affected maps. Skills and adapters remain
outside implementation scope while contributing caller evidence.

The containment view labels and orders expectations: required implementation with
unassessed or missing representation first, other required implementation next,
then supporting references and verification, with out-of-scope files last.
Native implementation is required but not declaration-analyzed; assets and tests
need owning references/evidence, not production function boxes. Ownership does not
turn enclosed or unrepresented declarations into explained behavior. Inventories
include native source, HTML/CSS, assets, contracts and verification files; freshness
includes those resources and the separate guidance inventory.

Validation: focused map, reference, context/onboarding and manual-path-security
checks passed, including file ordering, contract section identity, fenced code,
legacy redirects, missing ownership, stale links and non-JavaScript freshness.
Repository link/metadata checks, map build and `check --since HEAD --built` passed.
Static SVG review found and fixed overlapping disconnected boxes after layout
clamping; a regression test covers that case. Browser policy blocked local-file
viewer access, so this task used static visual inspection and local rendering/
navigation tests, not a live browser verification. No manufacturing behavior or
hardware outcome is established by these documentation checks.

Completed the subsequent semantic completeness pass after the user identified
that consolidation alone was insufficient. Audited the production-file inventory
against responsibilities and existing contracts, and added 51 source-grounded
change contracts covering all 134 core/Studio implementation files. Each records
responsibility/invariants, failures and limits, coupled changes and focused
verification scenarios with source/test links. This includes native repair,
plan compatibility and regional publication, numerical/mesh/surface operations,
motion state, dialects/archives, machine models, Studio workers/imports/requests,
rendering/resources and agent context. Supporting native build inputs and browser
assets have explicit reference routes. Private declarations can remain enclosed
by their owning responsibility; inventory ownership is not semantic coverage.

Added exact-file responsibility declarations, agent indexes and per-file viewer
links. A new production file cannot inherit a change contract through a directory
scope. Missing contracts, stale sections/source/test links, duplicate assignments
and ownership mismatch fail validation. Change reports now include the relevant
contract read command. Expanded system-map change routes to fourteen concrete
development scenarios and traced their invariants/couplings/checks against source.
Corrected the distinction between explicit solid-modifier tessellation and viewer
proxies, and between recipe review formatting and persisted display settings.
Contract-section reads now return only that section's navigation links.

Verification for this pass: all 43 focused map/context tests passed; after the
section-navigation fix, the affected 10 reference/generation tests and manual-path
security case passed. The four maintenance tests and role-onboarding case passed
after their affected changes. These checks verify reference delivery, coverage
obligations and drift detection; the authored behavioral account was reviewed
against source rather than inferred from a green structural check.
Final artifact validation resolved all 134 containment-to-contract routes and
979 rendered reference links, and checked the requested containment ordering.
The rebuilt viewer contains 57 flow pages, 23 references and containment.
Repository checks passed for 107 Markdown documents and 1,448 local links;
`check --since HEAD --built` and the final build-freshness check passed.

## 2026-09-17 — Containment and change-focused map maintenance

Kept authored abstractions and contracts while generating a complete core/Studio
containment inventory in the existing viewer. Module bars show direct, enclosed
and unrepresented declarations as proportions of each module's total. Inventory
includes wholly unmapped modules; existing gaps are not an approved baseline.

Added `check --since REF` to focus review on changed modules, named callables,
mapped state and authored regions, including additions and removals. AST comparison
ignores formatting but preserves semantic line-break changes. Module-level code,
callbacks and contracts still require review. Added hashed build inputs and outputs,
cached unchanged builds, `check --built` freshness verification and a guard against
inputs changing during rendering. Agent guidance owns the required change review;
ordinary code edits do not require per-node tests or the extractor regression suite.

Validation: all 32 focused map tests passed, including containment, change review,
stale artifacts and concurrent input changes. Real build, cached rebuild and
`check --since HEAD --built` succeeded. Browser navigation verified inventory
links return to their mapped pages. This detects drift and reduces review scope;
it does not certify semantic contracts or infer every dynamic relationship.

## 2026-09-17 — Code-derived relationships drive developer maps

Integrated the code graph into `loadModel()`, the common source for the existing
human renderer, toolkit `read-map`, and onboarding maps. All 40 pages now use
generated internal relationships; authored internal arrows survive only as
explicit semantic claims in the Doc view and agent context. Grouping, hierarchy,
labels, full component contracts and external/boundary interactions remain
authored. The approved renderer, layout and viewer design were not changed.

Extended the earlier extractor with finite returned-object registry dispatch,
selection-aware value flow, local class methods, named message handlers and
lexical state dependencies. Added the Studio source worker handler and retained
program storage to the source page. Unknown alternatives remain reported beside
known targets; direct alias mutations invalidate literal-object resolution.
Calls, returned values, argument flow, state dependencies and possible worker
delivery retain separate kinds and source evidence. Authored claims cannot keep
a deleted call's wire visible. Shared red references still calculate all other
occurrences, including same-page uses; unmapped callers receive no invented index.

The build writes the viewer, SVGs, concise region context, full graph and coverage
evidence. The supporting evidence command now consumes that same generated
model. Current extraction scans 184 modules and projects 314 displayed internal
endpoint pairs across 342 nodes. Core/Studio inventory is 162 direct, 2,673
enclosed and 4,151 unrepresented declarations; the callable subset is 160 direct,
739 enclosed and 1,541 unrepresented. These counts do not imply full behavioral
coverage. There are 8,744 unresolved/partially resolved sites, including external
APIs, and 249 discovered caller sites without direct mapped nodes.

Validation: 28 focused tests passed across `dev-map.test.mjs`,
`dev-map-evidence.test.mjs` and `dev-map-generation.test.mjs`. The code-only
mutation fixture verifies changed SVG wiring and changed agent region output
without changing the authored map; it also checks visible stale claims,
unresolved calls and rendered same-page red references. Real toolkit CLI output
matches the model's output and worker regions. The selected agent-toolkit
onboarding-role integration test passed separately. Build/check resolved all
40 pages. Browser inspection covered the real overview and rendered output,
worker-state and shared-reference diagrams. User feedback accepted the visible
appearance while explicitly not claiming code-accuracy verification.

Remaining analysis limits are explicit in map context and the map guide:
arbitrary callback/mutable dispatch, escaped mutations, inheritance, dynamic
imports, native-thread worker channels and request/response correlation are not
fully resolved. No execution order is inferred from sibling call order. Enclosed
factory code is not individually explained; new functions enter inventory but
do not automatically become boxes. Projection through unmapped helpers is
bounded to six call/handoff steps. These are static software relationships,
not runtime observations or physical evidence.

## 2026-09-17 — Report-only code-derived developer-map pilot

Implemented lexical/import/alias resolution and exact source evidence in
`dev-map/lib/graph.mjs`, with declaration containment, typed relationship
projection and shared-caller reports in `dev-map/lib/evidence.mjs`.
`node scripts/dev-map-evidence.mjs` regenerates the ignored JSON graph, comparison
report and readable report. The existing viewer, region wiring, red-link behavior
and manufacturing implementation were left unchanged. The pilot operates in the
saved checkout alongside the separately maintained human context maps.

Measured 184 .mjs modules across core, Studio and inbound skill/adapter callers.
Core/Studio inventory: 160 directly mapped declarations, 2,666 merely enclosed,
and 4,160 unrepresented. The callable subset is 159 direct, 739 enclosed and
1,542 unrepresented; local variables and callbacks explain why these denominators
differ. Parameters/destructured bindings resolve scope but are excluded from the
inventory. No combined coverage percentage is claimed.

The graph derives 5,020 calls, 1,009 assigned/returned call results, 670 direct
argument value flows and six possible worker handoffs. Of 451 authored wires,
167 have structural endpoint evidence only, 187 are boundary claims, 93 have
unresolved source sites and four lack established support in this extractor.
There are 130 omitted typed page connections and 242 caller sites of mapped
components without direct map nodes. Of 6,705 derived relationships, 458 occur
in supporting endpoint paths and 6,247 are absent from the bounded comparisons;
4,895 have an unrepresented endpoint. These are distinct measurements, not counts
of proven runtime behaviors or declarations that require individual boxes.

The 9,122 unresolved call/constructor sites comprise 7,287 dynamic members,
942 external/unbound identifiers, 539 unresolved imports, 249 unresolved local
values, 87 parameter targets, 13 mutated bindings and five unsupported callee
expressions. External APIs and deliberate extractor limits contribute to this
count. Unresolved is not absent; unsupported is not disproven.

The 6_output pilot derives pipeline-to-outputAdapter and pipeline-to-advisory
calls plus the adapter result return, while leaving object-dispatched exporters
unresolved. The 7b_source pilot derives the fetch result supplied to decodeSource
and paths from sourceSession through the Worker handler to fetch/decode/bind.
Session-to-decode and session-to-bind endpoint paths are omitted from that page.
Mutable program state, response-ID routing and control sequence are not inferred.
The registry's interpretGriffin wrapper is an example of a discovered unmapped
caller, separate from the two existing calculated mapped occurrences.

Validation: 22 focused tests passed using
`node --test core/tests/dev-map-evidence.test.mjs core/tests/dev-map.test.mjs`.
They cover shadowing, aliases/imports/re-exports, mutation, default parameter
scope, anonymous functions, value-flow evidence, both worker directions,
reassigned workers, unsupported/unresolved/omitted cases, containment, all current
map anchors, same-page shared indexes and non-mutation of the map model.
Proposed relationship typing and evidence-backed authoring changes are reported
for review; broad replacement of the forty authored pages was not performed.

## 2026-09-17 — Documentation revamp audit

Audited the three-role restructure and the dev maps. Verified against source:
`dev-map check` reports the recorded 40 pages and 340 nodes; `check-repo` reports
only the six known issues; 24 focused map/role/manual-access tests pass;
onboarding context sets for maker, builder, builder `--area`, and developer
`--area` match their manuals exactly; `read-map` on a child returns its whole
owning region with shared contracts. 86 documents were link- and anchor-checked.

Context maps corrected against the toolkit. The user's point was that the maps
must reflect what onboarding actually returns. They did not. `builder-onboarding`
returns six documents and no maps, but the map drew only three as delivered and
showed MAKERS, print tools and skill authoring as merely mentioned; those three
wires are now the blue-dashed delivered set, so all six read as one call. A panel
now states the base set explicitly and tables every `--area` flag against the
contracts and region maps it adds, and nodes were added for the area contracts that
had none: MCP development, tests, machine models, plus benchmarks, the region
verification reference and the fourth skill `DEVELOP.md`. On the maker map the tour
path was invisible although it replaces onboarding and delivers a different set;
`start-tour` now shows as its own action delivering MAKERS with tour participation,
and the prose records that `begin-studio-work` returns no manuals at all.

[Context-map tests](core/tests/context-map.test.mjs) now assert the blue-dashed sets
equal the toolkit's maker and builder context sets exactly, that both return no maps,
that every `--area` contract has a node, and that no node links to a missing file.
Hand-drawn maps drifted twice; this makes the drift fail a check instead.

Corrections made. The user spotted the stale context maps: the maker map's four
slice tooltips still routed implementation content to the abolished developer bin
and to a `DEVELOPER-CONTEXT.md` section that moved into `maps/9_agent.md`, while
the same file's header prose had already been updated — they now name the owning
region maps and `scripts/bench/region-reference.md`. The builder map's two map
nodes had no wires at all, so nothing showed how a builder reaches them and hover
did nothing; they are now wired from `BUILDERS.md` with a `read-map` action, a
`dev-map/README.md` node was added because the map guide was unreachable, and the
generated viewer node says to build first. Its legend gained the blue-dashed
swatch its prose already promised.

`GLOSSARY.md` still defined two agent roles and none of the map vocabulary; it now
defines maker, builder and developer agents, keeps `development agent` as the
umbrella for the latter two, and adds dev map, region, map page, operation address,
shared component, shared-use reference and context map. Ownership entries were
added for the map guide, the region index and the two context maps, which had no
recorded owner. `dev-map.mjs read` was removed as a duplicate of `read-map`, and
`maps/0_system.md` now points agents at `read-map`; the viewer was rebuilt.

[D-033](DECISIONS.md#d-033--three-agent-roles) and
[D-034](DECISIONS.md#d-034--adopt-the-packit-region-map-contract-for-core-and-studio)
record the three-role split and the map-contract adoption, which had no decision
records. D-002 and D-013 are marked superseded with their original approval
metadata preserved. Both new records are retroactive summaries of DEVLOG-recorded
direction, not verbatim quotations.

Findings left open. `.github/workflows/test.yml` runs only `npm run setup:check`,
so the map checks and `check-repo` — the mechanical half of the maps' freshness
guarantee — are enforced only when a contributor runs them locally. `check-repo`
walks `*.md` only, so the two context-map HTML files are never link- or
coverage-checked; that is why the stale nodes survived. The viewer's Doc pane
renders region-prose Markdown links as literal text, because `md_to_html` in
`dev-map/lib/viewer.py` handles code, bold and italic but not links, so the
routing half of the map contract does not reach people. The builder map still
omits nodes for the test reference, benchmarks, MCP development, machine models
and `skills/wave-overhangs/DEVELOP.md`. `--area path` returns `core/path/README.md`
without `2_generation`, whose caller contract is that same file. No skill has a
`DEVELOPER.md`, so `read-skill --developer` is a documented but empty tier.
Smaller text errors remain in `core/agent/README.md` ("both examples" for three
tour examples, a mislabeled `maps/9_agent.md` link, `record-request-activity`
absent from the command table) and in `core/region/README.md` (two links to the
benchmark reference labelled "developer maps"). No code or manufacturing behavior
changed; nothing physical was tested.

## 2026-09-17 — Core and Studio developer maps

Implemented 40 pages (340 nodes) from ten region Markdown sources, using the
PackIT leveled layout and viewer. The user reviewed offset/perimeter examples
and approved continuation. The system overview leads to lifecycle, generation,
geometry, regions, motion, output, Studio, machine presentation and agent tools.
Skill implementations and client adapters remain outside the mapped boundary.

The generator resolves named JavaScript declarations through Acorn, checks
hierarchy and boundary labels, rejects two-node pages and ambiguous/raw repeated
anchors, and calculates every other mapped occurrence for each shared component.
Human diagrams show those occurrences as red downward arrows and indexes;
agent packets expose the same references with the shared input/output contracts.
The viewer retains the exemplar layout and optional code/Doc interactions;
supporting prose stays behind Doc. Generated artifacts are ignored and rebuilt
from source, while agent reads resolve the current checkout without Python.

Added `read-map PAGE` and selected-area map packets to onboarding. Developers
receive the system overview; skill-only builders and makers receive no maps.
Repeated regions are deduplicated. Developer onboarding does not force maker
workflow or individual skill manuals. The implementation bin is absorbed into
region context, with numerical reference procedures under benchmark guidance.
Both role context viewers and owning manuals now point to these sources.

Tracing the maps corrected a draft travel sequence: recovery precedes combed
travel and follows clearance travel. No manufacturing implementation changed.
Maps and checks establish a structural account, not a proof of behavior or an
exhaustive inventory of every helper/caller.

Verification: all 40 pages built and passed declaration/boundary/shared-use
checks; 17 focused tests passed for map drift/reuse, role/context selection and
manual access. All 89 checked guidance links and headings resolved. Browser
review covered overview, offset/perimeter recovery, radial contact, travel and
Studio drawing layouts, navigation, declaration code and shared references.

## 2026-09-17 — Selective skill-role reads

`read-skill ID` now accepts independent `--maker`, `--builder` and `--developer`
flags, selecting package `SKILL.md`, optional `DEVELOP.md` and optional
`DEVELOPER.md`. No flags preserves the maker read. Combined flags return only
the selected source documents; missing optional roles are reported explicitly.
The existing file split is reused rather than duplicating manual content.
Builder guidance now requires maps for core/Studio changes or investigation of
their internals, not every skill-script change. Dev maps cover core and Studio.

Verification: focused CLI onboarding and role-selection tests passed (2 tests),
including combined reads, builder-only reads, source equality, absent optional
manuals and rejection of unknown skills. No manufacturing behavior changed.

## 2026-09-17 — Reconcile role context and the map contract

The user approved the documentation reconciliation after reviewing checkpoint
`04f66db`, with no temporary map-unavailability routing. [AGENTS.md](AGENTS.md)
and [BUILDERS.md](BUILDERS.md#maps-and-local-documentation) distinguish inherited
responsibilities from required reads. Builders read relevant maps for skill,
Studio and isolated core changes; reading an implementation reference does not
change their role. Caller-facing contracts remain available to the roles using
them instead of classifying whole mixed manuals as developer-only.

The map contract records one region source for agent text and human rendering,
shared components only under the same input/output semantics, and calculated
red vertical arrows listing every other map occurrence by node index. Both agent
and human views must expose these references. Structural checks do not establish
behavioral truth or caller completeness. Maps carry the structural account;
comments/docstrings assume the map has been read and require specific local
value. Concise useful rationale and contracts remain permitted. PackIT's region
source, vision and style were the reference; its strict documentation and
atomization policies were not adopted.

The [developer bin](DEVELOPER-CONTEXT.md) now contains the implementation slices
previously left in its manifest: region kernel/construction and verification
details, Studio request indexing/presentation, and output dispatch/validation
integration. Owning manuals retain caller behavior, limitations and links.
The scoped reference index includes machine presentation and distinguishes
contracts from internal mechanics. Developer onboarding reads only the bin's
orientation/index; implementation slices are separate existing `read-guidance`
section reads. Role labels and both documentation-navigation HTML maps were
reconciled. No code-anchored region maps or new skill-section flags were built.

Verification: the focused three-role CLI onboarding test passed, including exact
orientation text and a selected implementation-section read without neighboring
sections. `git diff --check` passed. `check-repo` reports only existing issues:
BR-045's `open.` status and five links to removed `build_request.md#br-*` anchors.
No printing or physical behavior changed or was tested.

## 2026-09-16 — Three agent roles and documentation restructure

The current user directed a move from two agent contexts (maker, developer) to
three: **maker** (uses skills, makes parts, gives printing advice, operates
Studio; changes no shared code), **builder** (changes skills, extends Studio,
makes isolated local core changes, makes test parts), and **developer** (works on
core and across components; maps-native). The agent determines its role from the
initial prompt, defaults to maker when unclear, escalates maker→builder on any
build request (announced, then `builder-onboarding`), and reaches developer only
on the person's explicit request or an accepted proposal for major core work.
Maker and builder agents suggest a fresh session past ~250k tokens on an
unrelated pivot; developers are exempt.

Structure changes: [AGENTS.md](AGENTS.md) now routes by role, escalation and
session-switch. `DEVELOP.md` moved to [BUILDERS.md](BUILDERS.md) (builder
orientation, includes maker context) with its externally-referenced anchors
preserved; all root `DEVELOP.md` links were repointed there (component
`DEVELOP.md` files untouched). A new transitional [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md)
is the developer handoff: it holds the developer-only sections physically lifted
from `core/agent/README.md` (implementation and verification),
`core/export/README.md` (stationary-extrusion motion writer) and
`studio/README.md` (historical toolpath inspection), plus a dev-bin manifest
that catalogues, with anchors, the interwoven dev-only material still living in
the region READMEs (Clipper2 kernel, export interoperability internals, Studio
request-index/work-state internals) for the dev maps to absorb, and an index of
the wholesale developer-only documents.

Onboarding now takes roles maker/builder/developer
([core/agent/toolkit.mjs](core/agent/toolkit.mjs), [scripts/agent-toolkit.mjs](scripts/agent-toolkit.mjs));
`developer-onboarding` was renamed to `builder-onboarding` and a new
`developer-onboarding` added. [manuals.mjs](core/agent/manuals.mjs) admits the new
root docs and aliases. The [agent toolkit manual](core/agent/README.md) documents
all three. The [maker](maker-context-map.html) and [builder](builder-context-map.html)
context maps were updated to the new state (the developer context map became the
builder map); the code-anchored developer region maps are the next phase.

Judgement call on the reorg depth: cleanly-detachable dev-only sections were
physically moved to the handoff; large interwoven ones were catalogued in place
with precise anchors rather than butchered, since the dev maps are meant to
re-own that content and most of the handoff is expected to disappear once they
exist. Verified: `agent-toolkit` (three-role onboarding) and `mcp` tests pass;
`check-repo` shows only pre-existing `build_request.md#br-*` anchor issues. The
prior working tree was checkpointed first (commit before this work).

## 2026-09-16 — X1 Carbon, Ultimaker 2 Extended and Ultimaker 3 profile definitions

The current user requested an X1 Carbon profile, confirmed the standard hardened
0.4 mm nozzle with PLA, and clarified that materials must remain changeable.
They also requested Ultimaker 2/3 profiles, correcting the installed 2-series
model to the original "ultimaker 2 extended" after initially choosing 2+.
The resulting IDs are `bambu-x1-carbon`, `ultimaker-2-extended` and `ultimaker-3`.

The profiles declare hardware/coordinate bounds, conservative rectangular tool
areas outside cutter/clip regions, temperature/feed limits, installed nozzle
assumptions and editable PLA defaults. X1 also declares PETG, ABS, ASA, PC and
95A-class TPU; both UltiMakers also declare ABS. These are bounded starting
settings, not a general material-library port or physical calibration.
Official Cura/Bambu profiles and manufacturer documents are linked in the files.
Shell defaults now enable drape only for a machine declaring nonplanar support.

The definitions are usable for geometry/setup review and remembered settings.
All three explicitly declare unavailable output, and the shared lifecycle now
reports the output reason before path generation. H2D firmware routines are not
reused on X1; S5 startup is not reused on UM3; UM2 Extended's volumetric UltiGCode
is not treated as filament-length Griffin. No startup position was invented.
The remaining output work is [BR-051](build_request.md#br-051--complete-output-for-the-three-new-printer-profiles).

Verification: all 9 tests in `printer-profiles.test.mjs` and
`interoperability.test.mjs` passed, plus the focused MCP SDK catalog/persistence
test. This covers material/temperature changes, remembered setup, tool-bound
rejection, core/tool selection, planar defaults, early unavailable-output errors,
and catalog discovery. Existing S5/H2D default and H2D export checks pass.
No physical printing or new machine output was tested. Changes are uncommitted.

## 2026-09-16 — S5 sacrificial priming before shell prints

The user reported missing priming on the desktop `stress-mesh-hi-fi-20260916.gcode`.
Inspection read only the first 3,072 and last 2,048 bytes of the 98,930,655-byte
file, as requested. It starts with `G92 E0` and a stationary `G1 E6.5 F1500`
before the first model wall; its last E move withdraws 6.5 mm. Thus that file
already matches the configured terminal retraction, but has no sacrificial
priming strokes. This does not establish any additional firmware withdrawal
or the physical reason for failed initial extrusion.

S5 profile revision 7 supplies two connected 100 mm passes to shell generation.
The shared path helper places them outside geometry and generated stroke bounds,
including supports, with 4 mm clearance and bead-width allowance at the bed edge.
It uses locked first-layer settings and normal flow caps, restores the initial
retraction at the prime, then retracts/lifts before entering the model. Ordinary
SAAMpath/export interpretation includes prime material, timing, bounds and Studio
playback. Insufficient space is reported rather than silently omitting priming.
The bounded wedge retains its existing prime line; older snapshots and other
profiles retain their startup. The desktop export was not modified or regenerated.

All 26 selected tests passed across priming, pipeline, export, modal emission,
travel and source playback. Coverage includes both S5 nozzles, zero/6.5 mm
retraction, support extents, bed-edge fallback, no-space rejection, snapshot
compatibility and exact-source Studio playback. No physical print was performed.

## 2026-09-16 — Shared Thingi10K search and download

The user requested built-in mesh retrieval for descriptive searches such as
"fetch me a bunny", plus mirror lookup for supplied Thingiverse links and a
manual-download fallback when absent. The existing preference for tailored
geometry remains in MAKERS, clarified to apply when making it is attractive.
Every downloaded mesh now returns a brief source notice and its license link;
the maker guidance and [task manual](skills/thingi10k/SKILL.md) require that link
in chat even when strict mesh import fails. The mirror provides unversioned
per-file license labels, so the link goes to the original model's license section
and no exact legal version is inferred.

The shared skill implements keyword/name/tag/filename search, per-file selection,
Thingiverse thing lookup, bounded individual HTTPS downloads and cached metadata
from Hugging Face revision `2d5d3b2f3cd3711028ad75b12788c13b25559ec6`.
CLI and MCP use the same library and STL importer. Downloads retain source bytes,
hash and attribution; successful imports carry attribution in the saved source
record and delivery copies it beside the reviewed machine program. Failed import
retains the original for explicit preparation. No new dependency, remote scraping,
automatic repair or manufacturing approval was introduced.

Six skill tests and four existing MCP-access tests passed. Coverage includes
quoted CSV names, keyword and Thingiverse/file identity, pagination, persisted
cache reuse, incomplete metadata, network errors, redirects, download limits,
interrupted streams, failed-import recovery, and the SDK MCP search/import/Studio
review route. Synthetic fixture delivery preserved exact reviewed bytes and
source attribution through unit correction. Live CLI checks found 67 bunny files,
resolved Thingiverse thing 151081 to file 293137, and returned the user-download
fallback for an absent thing. One upstream file (68807) lacks contextual metadata;
it remains discoverable with an explicit missing-creator indication.

The live import downloaded Low Poly Stanford Bunny by johnny6, listed as
[CC BY-SA at its source](https://www.thingiverse.com/thing:151081#license), into an
isolated unapproved local test bundle. Source SHA-256 was
`4a222346223cf2c207c34d7a3d4e8ea297b004ff862b06b6e4c7c2eeac9f761a`.
This establishes software download/import behavior, not physical printability.
The refreshed capability digest and new manual links passed their relevant
checks; the repository-wide documentation check still reports the pre-existing
BR-045 status and stale backlog anchors for BR-005, BR-018, BR-023 and BR-039.

## 2026-09-16 — Stress mesh hi-fi completion and separate vase manuals

The user established **stress mesh** as the term for the local Spiral Vase input
and requested the single hi-fi alias for full mesh fidelity. They also explicitly
chose separate standard/advanced vase manuals and separate skill-digest entries,
clarifying that the distinction is in discovery and documentation. Standard
`vase-wall` and `advanced-vase-wall` now have separate manuals/catalog entries
while retaining the same `skills.vase-wall` recipe and generation implementation.
[D-032](DECISIONS.md#d-032--separate-standard-and-advanced-vase-mode-manuals) records
that instruction; the glossary identifies the stress mesh and both modes.

The latest saved recipe from the previous evening was
`.local/motif-speed/worktree/Prints/development/correct-cgal-medium-fidelity`.
It retained the repaired 8,076-triangle stress mesh, the 33-point motif with
4.8 mm depth, 36 cells per turn and 579 body courses plus two flat ends.
The motif hash is `734d7f601aadcdebdb4f1b5d7d92f07d4ef9142b69f5ee2ad3c61bd2e90fc99b`.
Only `meshSleeve.fidelity` changed from 0.5 to 1; the latest recipe's independent
0.2 mm detail tolerance, loose offsets, Bambu H2D and PLA settings were retained.
The prior 0.1 mm contact-detail rejection therefore does not describe this recipe.

Public bundle initialization preserved source bytes and left the old print intact.
Development generation at `Prints/development/stress-mesh-hi-fi-20260916`
completed all 581 courses at 125.242 s, composition at 127.726 s, and checked
export/persistence at 143.475 s. It produced 2,163,709 checked moves, with export
SHA-256 `b6caeff64020e151a3e5497748f1cfd221c6c88ca78b4133349698092059d285`.
The complete observed slicing time was 2 minutes 23 seconds; no remaining-time
extrapolation was needed when completion was reported. This is a development
preview with no new human approvals or physical print result. Progress and the
result record are under `.local/vase-speed-20260916/stress-hifi-*`.

The three skill-digest tests passed, and the regenerated digest includes both
manuals. The repository documentation check reported no errors for the new
manuals/catalog or relocated references; it still reported unrelated existing
backlog status and stale backlog-anchor errors.

## 2026-09-16 — Vase contact speed and local loose-offset curvature limiting

The user requested a bounded high-fidelity motif-vase timing run, followed by
slicer speed improvements, then requested over-curvature handling that preserves
one smooth sleeve by limiting offsets locally. The shared manuals define motif
mapping and numeric fidelity, but do not identify a named “gauntlet” example or
“hi-fi” preset. The diagnostic therefore used the saved repaired stress-vase
candidate at `.local/motif-speed/worktree/Prints/development/correct-cgal-full-fidelity`;
that identification remains provisional. Its source is the 8,076-triangle CGAL
repair `aec0bf6018d998ce743c2c4cdb4158e47c37caca7ae20a60d8fb803b46ecd0db`,
with fidelity 1, 0.1 mm contact detail, 36 cells per turn and 581 total courses.

On Node v24.19.0 / Intel i7-9750H, the initial generation rejected a source-contour
fold at Z 27.565625 mm after 108.210 s; a repeated baseline reached the same
rejection in 89.344 s. Early throughput suggested approximately 5–10 minutes for
a complete job if subsequent geometry were accepted, but the actual rejection
precludes a completion estimate for that unchanged recipe. A separate bounded
CPU profile attributed roughly half its sampled time to triangle-distance
arithmetic and temporary vectors during mesh-ledge validation. Scalar arithmetic
replaced those vector allocations without changing the distance method or budgets.
The same full-height input then reached the identical rejection in 46.088 s.

A separate 26.8 mm / 131-course fixture retained the source, motif, fidelity and
tolerances for a completed-output comparison. Generation changed from 75.052 s
to 43.767 s, and checked export from 4.017 s to 4.095 s: 79.069 s versus 47.862 s
after geometry load (1.65× faster). Plan/machine hashes matched between trials,
as did all 564,318 checked moves, travel metrics and the 9,156,497-byte export:
`53f4112814c63f5f353280fedc710e7708f2b3fe4a6444a65c0fd7f6a14e7a3e`.
The final trial includes the curvature limiter. These are individual local
measurements, not a statistical hardware comparison or a full-height success.
Evidence and original module snapshots are under `.local/vase-speed-20260916`.

The loose-offset implementation now reduces local control depths when its sampled
Jacobian would fold, preserving the same NURBS control layout and periodic seam.
It checks the displacement path as well as its endpoint, retains ordinary offsets,
and reports reductions. This is separate from source-mesh contact; it does not
resolve the source-contour rejection above or certify global self-intersections.
The shared geometry manual owns the algorithm and limits. All 27 selected distance,
contact, loose-offset, sleeve, vase, cladding and rimming tests passed, including
deep over-curvature, local retention, seam/weight preservation and checked export.
The benchmark now retains progress, errors and CPU profiles after cooperative
time-budget interruption. No saved print approvals or source bundles were changed,
and no machine execution or physical validation occurred.

## 2026-09-15 — Browser control and download completion

The inherited download investigation reproduced canceled ordinary agent clicks
for both the small text control and the streamed medium-vase package. Installed
Codex desktop 26.908.4834.0 cancels ordinary downloads during agent browser
control unless its supported download action has registered the download. That
action reached save-path assignment but reported a local-policy block in this
session. No security settings were changed.

After browser control returned to the person, the same streamed package saved
successfully to the configured Desktop folder without Save As. The browser
record reports completion and 31,991,449 bytes; the saved file SHA-256 matches
the approved package:
`0c24656319d52d7e064c0cf4e94565bd59046c93f7eca9987ba4deace3cb7310`.
This establishes successful large-file delivery and a control-state failure
in the automated reproduction. It does not establish the cause of every earlier
human-click failure or retest Studio's final confirmation button. The working
procedure is documented at Studio's client guidance; no further download code
change was required for this successful transfer.

## 2026-09-15 — Shared checkpoint and publication

The user requested committing and pushing the checkout's pending work on
`codex/provisional-goalpost`. Existing geometry and workflow verification above
was reused. Focused Studio material, settings and movie checks passed (19 tests)
for the pending playback changes; the diff whitespace check passed. Large-file
browser download completion remains unresolved as described below.

## 2026-09-15 — Loose spline mapping and full-height dense vase preview

The approved extension to pipe cladding and both rimming skills is integrated.
Their default remains exact-distance offsetting; explicit spline references can
choose the loose/exact continuum. Independent review fixed an ownership guard
that had skipped the cladding option during normal generation, and retained
planar rimming's projected full-normal direction on rising-U charts. Mesh strips
and circular pipe behavior remain unchanged. Root integration checks cover
these cases, nominal material rims, composition, plan settings and checked
mesh-motif export. A prior rim test assumed exact bead-width separation at the
new loose default; it now checks the intended side/footprint contract, while
the dedicated exact-offset tests retain distance assertions.

The same-size Greville direction control field replaced repeated polygon offsets
for fitted mesh sleeves. Its loose endpoint preserves spline degrees, knots,
weights and all 90 stored controls (72 independent); intermediate offset
tightness blends toward exact unit reference normals at query time. Mesh contact
fidelity remains a separate parameter. The five-course reproduction near course
465 completed in 2.327 seconds total, including 0.0734 seconds mapping, with
7,651 output points. Loose distance is approximate and reported as such.

The complete 117 mm preview then generated successfully at zero mesh fidelity.
The user accepted it and requested three times the circumferential loop density.
Changing 12 to 36 cells per course retained the motif, 581 courses, flat ends,
height and tolerances. Normal Studio generation took 27.092 seconds on S5,
producing 1,242,934 mapped points and 1,248,514 checked moves. Switching the same
recipe to Bambu H2D completed in 28.378 seconds. These timings include the
normal generation request, not browser rendering or download time.

The user approved both exports in Studio, but reported failed browser downloads.
Server delivery files existed: the S5 file was 57,394,818 bytes and the H2D
package was 20,680,260 bytes, each matching its approved SHA-256 exactly. The
browser used a temporary blob URL and marked export complete when its synthetic
anchor click returned; that does not establish a successful host download.
The approved H2D delivery file was supplied as a local link while the handoff
was investigated. No new physical print result was reported.

The current CGAL-repaired source was then evaluated separately, preserving the
approved old-source print. Strict full fidelity with 0.1 mm contact detail failed
on a local unfolding limit at Z 27.565625 mm after 91 seconds. The medium
candidate used fidelity 0.5 and 0.2 mm contact detail and completed the entire
581-course, 36-cell, flat-ended Bambu job in 250.469 seconds. It produced
1,959,821 checked moves and a 31,991,449-byte package, SHA-256
`0c24656319d52d7e064c0cf4e94565bd59046c93f7eca9987ba4deace3cb7310`.
The source remains the current CGAL repair `aec0bf6018d998ce743c2c4cdb4158e47c37caca7ae20a60d8fb803b46ecd0db`.
There were 2,638 contact profiles and 13 sampled 3D ledge transitions; maximum
sampled combined profile error was 0.199711 mm and maximum sampled mesh distance
on ledge checks was 0.072739 mm. These are sampled numerical checks, not a global
mesh-error or physical-clearance guarantee. The completed preview was displayed
in Studio, then accepted by the user and promoted to production without changing
the export bytes. The user subsequently confirmed settings and toolpath in
Studio; normal delivery succeeded. The exact approved package was also copied
to the requested local Downloads folder and its hash verified. Its 758
short-travel advisories remain recorded; no automatic geometry or process change
was made. No physical result was reported.

Contact preparation now permits bounded unfolding of section folds and deducts
the measured profile certificate from the interpolation allowance. Narrow ledge
transitions use sampled distance checks against the original triangles. Larger
folds still reject; the medium result does not establish that every mesh or the
strict full-fidelity setting is supported. Current contracts live in the
[advanced vase manual](skills/advanced-vase-wall/SKILL.md) and
[prepared contact reference](core/geom/README.md#prepared-mesh-contact).

Browser delivery remains unresolved. User-clicked 1 KB text saved, while both
the approved 20.7 MB package and an independent 32 MB plain-text response showed
“Stopped,” including on a fresh Studio instance. The HTTP attachment/retry path
and compound filename fix are implemented and covered by focused checks, but
are not evidence that the host saved a large file. A chunked-transfer diagnostic
was prepared but no user result was obtained. On September 15 the user ended
this task's download investigation and assigned further debugging and eventual
commit/publication to other tasks; this team retains vase documentation work.
The intended browser behavior remains one click to the default download folder.

The vase manual was condensed and checked against the implemented settings. It
includes a mesh preparation example, motif authoring and density, flat ends,
separate fitting/contact/offset controls, composition and numerical limits.
Shared lifecycle links and the discovery digest were updated; manual links,
public anchors, example JSON and skill metadata checks passed. No runtime change
or further generation was required for this documentation pass.

## 2026-09-15 — Motif mapping performance, fitted mesh sleeves and artifact provenance

After checkpoint `7638383`, the user requested a composable skill, flat motif
courses at both ends, faster generation, and mesh inputs with a smooth fitted
reference plus continuous one-sided conformance. Development was isolated under
ignored `.local/motif-speed/worktree`; the downloaded irregular vase program
was not edited. The owning vase, geometry and region manuals describe current
settings and limits.

The original 30 mm irregular-mesh recipe measured 239.773 seconds generation
plus 1.195 seconds checked export. Exact mesh connectivity reuse and cheaper
contour cleanup retained its program bytes. Prepared height/offset mapping then
measured 43.263 seconds generation plus 1.383 seconds checked export with the
same saved plan/machine inputs, using CPU profiling in both reported trials.
Moves changed from 208,414 to 237,423 because the remaining chord budget caused
more subdivision. Path length changed from 97,302.331 to 97,308.939 mm (0.00679%).
No courses were trimmed or tolerances relaxed. A separate 10,000-point comparison
against exact queries on the actual mesh measured 0.001196 mm maximum and
0.0000587 mm RMS mapping discrepancy, within the reserved 0.0025 mm allowance.
These are sampled comparisons, not global error certificates. Earlier faster
experiments lacked the retained numerical margin and are not the final timing.

The fitted mesh reference uses 12 periodic circumferential by 6 height controls
by default: 72 independent controls, with three repeated seam columns. On the
local 100,000-face stress artifact, isolated fitting took about 0.2 seconds after
roughly 1.8 seconds loading/validation. The ordinary plan and imported-bundle
tests exercise continuous fidelity, flat ends, source preservation, regional
composition and checked machine output. At this stage, directional contact
required a star-shaped contour about the fitted center; source folds failed explicitly.
Full fidelity on the local legacy stress artifact fails this requirement at
several sampled heights. Zero-fidelity fitting remains independent of that
contact limitation. No physical mesh-motif print result was supplied.

During preview review the user identified the selected stress artifact as the
output of a purged repair. The source had been read from the older local SAAM
checkout's ignored `prints/spiral-vase-h2d/geometry/source.stl`, not repaired in
this task. Its repair report identifies `winding-grid-marching-tetrahedra/1`
followed by `quadric-edge-collapse/1`; its SHA-256 is
`39b8a8d0019d625833c92b31ab39a14ee61d6f9ad1b4136e08617720d25091c8`, identical
to the retained preview source. Saved review history dates it to September 11,
before the September 14 removal. Commit `c545d8f` removed `reconstructMesh` and
the dependent simplifier; active source in both current checkouts contains no
restored implementation or new repair calls. The separate root STL removal was
`45d788f`; voxel authoring removal was `d686269`. Selecting the artifact without
checking its repair provenance was an agent error. The user acknowledged the
distinction and authorized continuing the preview with that artifact.

The full 117 mm, 581-course zero-conformance preview exposed a downstream stall
within course 186. The initial mesh fit was fast; a three-course CPU profile
instead counted 12,771 polygon offsets. A shifted reproduction isolated the
per-height simplification of the already smooth fitted sections as a source of
repeated preparation. Removing that redundant simplification reduced a shifted
three-course reproduction from 19.18 to 0.78 seconds of mapping, with 6,717 mapped
points in both runs and unchanged tolerances. Offset preparations fell from
11,708 to 550. A geometric regression compares the flat fitted ring to its
independently constructed inset and detects the previous simplification error.
The full preview retry is separate from the original-recipe benchmark above.

That retry passed course 186 but slowed again around course 320. A bounded
five-course shadow profile exceeded 45 seconds after only three courses.
The fitted spline's own per-height adaptive tessellation still changed vertex
selection. A shared U grid, sized from the periodic polynomial spline's global
second-derivative bound, completed all five in 6.503 seconds (3.448 seconds of
mapping), with 396 section segments and a 0.002473 mm chord bound against the
0.0025 mm target. Fit coefficients and sampled residuals were unchanged. The
bound was independently reviewed and tested across held-out heights and U
positions. These shadow profiles ran alongside the preview and do not establish
an isolated full-job speed ratio.

The fixed-grid full run later slowed near course 465. A continuous offset-row
atlas prototype exposed a 0.00128 mm projected-seam shift over a 0.000098 mm
offset interval even though the corresponding contours retained 396 vertices
and smoothly changing lengths. Thus repeated grid-rounded polygon offsets and
seam reprojection still disrupted the reference correspondence. The user then
explicitly required loose offsets with no growth in control-point count. The
unfinished tight-offset run was cancelled through Studio's normal cancellation
API. The replacement mapping must retain the fitted spline's control structure
and U/Z correspondence; these cancelled runs are not completed preview results.

The current CGAL patch repair was also rerun on the preserved original stress
mesh in an isolated output directory. It reproduced the previously recorded
8,076-face output SHA-256
`aec0bf6018d998ce743c2c4cdb4158e47c37caca7ae20a60d8fb803b46ecd0db` in 1.90 seconds,
with no holes filled. Its sleeve detector retained the full 0–117 mm interval.
Directional-contact probes passed at four heights but rejected folds at three
others, so the conformance limitation also affects the correctly repaired mesh.

The user also reported a stationary Studio spinner. Live computed styles showed
`prefers-reduced-motion: reduce`, `animation-name: none` and zero duration. The
spinner now retains slow 2.4-second rotation in that mode, compared with its
ordinary 0.8-second rotation. A focused regression and live computed-style
inspection confirmed the fix; other motion preferences remain unchanged.

## 2026-09-15 — Irregular broad-loop example and pre-performance checkpoint

The user requested a wider motif on an irregular sleeve, accepted the displayed
result and requested a checkpoint before investigating generation speed. The
reusable vase-wall irregular demo now contains the exact demonstrated host and
motif recipe: a waisted, leaning oval solid, 20 connected cells per course and
145 full courses. The owning skill manual includes the command, adjustment
entry point, progress, mapping limits and duplicate-generation guidance.

The saved print generated 207,671 mapped motif points and 208,414 checked machine
moves; the actual motif Z interval is 0.8–29.940035 mm. All shared generation
checks passed. The 287 short-travel advisories were retained as nonblocking
evidence in the private print. Geometry was confirmed by the human in Studio.
The user intends to print; no physical result is yet recorded. An earlier host
with rotating and changing-aspect oval sections failed the contour subdivision
check near Z 2.23 mm; that trial generated no complete path. The displayed host
retains oval aspect ratio while its section size and center change. No contour
tolerance was relaxed and no course was trimmed.

The checkpoint includes concurrent Studio coordination work as required by the
repository's checkpoint policy; it is not a claim that all carried work is
complete. Previous focused test evidence remains applicable. Performance work
and any measurements begin after this checkpoint.

## 2026-09-15 — File-compatible handoff work after SQLite withdrawal

The user briefly approved SQLite while asking about update/version risks, then
withdrew that option: **"2. I don't think it's worth it but start the rest."**
Removed the partial database implementation before it was executed. No database,
data migration, package dependency or Node engine change occurred. The existing
JSON files and Node >=22 requirement remain. The earlier approved tour-disconnect
policy remains in effect. Continued on the existing contributor branch without
staging, committing or publishing, preserving concurrent skill/generator edits.

### Implemented choices

| Choice | Reason and boundary |
|---|---|
| Rebuildable request index in memory | Avoid migration and a second persistent authority. Normal queries retain unfinished work, undisplayed completed results and the latest edit outcome per print; full diagnostic history remains explicit. Watch hints plus five-second metadata reconciliation cover external changes. Cold scans and memory still scale with history; this does not provide cross-process transactions. |
| Real request-specific activity | MCP print tools accept explicit `requestIds` and renew owned working requests at tool entry/exit. CLI agents can report actual work through `record-request-activity`. Waiting/listener helpers never renew leases; activity preserves pause, baseline and target. Long work with no observable contact may still expire. |
| Cancel Studio calculation before saving | An authenticated cancel route bypasses the mutation queue and arbitrates with the worker using a shared atomic flag. If cancellation wins, the worker stops; if saving wins, its write sequence finishes. Cancellation does not queue generator repair or immediately auto-retry. Explicit retry works. Input-change notifications cancel obsolete Studio calculations. Direct CLI/MCP generation still needs a shared owner. |
| Separate review updates from displayed-source identity | Approval, delivery history and generation-mode changes update controls after fresh validation. Compact updates omit accumulated history and retain playback/source state; input/export and other generation-identity changes still reload. Full approval/delivery byte checks remain. |
| Reject late tour start-layer choices | MCP supplies the original run/lesson identities to the tour mutation. An ended or replaced lesson cannot accept that background choice. File-based cross-process read/modify/write races remain. |
| Retry Windows file sharing conflicts | Browser verification reproduced EPERM while replacing review.json during generation. Shared single-file replacement now uses unique temporary names and bounded Windows EPERM/EACCES/EBUSY retries, preserving prior complete contents on failure. This is not a multi-file transaction. |

### Verification and findings

With 1,000 historical JSON requests, five warm operational queries performed zero
file reads and zero directory scans. Explicit history remains complete, and the
tests retain waiting requests and undisplayed results. Found and fixed a watcher
startup gap (files created before attaching) and released idle watches for
short-lived callers. Browser snapshots retire omitted resolved work while
retaining updates that arrived after an older poll began.

Selected software tests cover request discovery/activity, real SDK ownership and
listeners, CLI participation, tour lifecycle, scoped stale choices, cancellation
and retry, commit arbitration, exact-byte delivery, compact review updates,
playback preservation, source invalidation, Windows retry/permanent failure and
concurrent temporary-file isolation. The browser Cancel calculation action worked
on an isolated synthetic 80 mm box. After the Windows fix and server restart,
retry produced the playable toolpath and normal review controls. Browser warning
and error logs were empty; the audit tab and its server were closed. No real
manufacturing approval, hardware operation or physical print was performed.

One earlier import/generation run reported a prepared-runtime mismatch while
generator source was also changing in this shared checkout; subsequent stable
runs passed. Reconnect test harnesses required the browser's URLSearchParams
global after the poll URL gained a fingerprint parameter. These observations are
not evidence of transactional safety. The documentation checker retains the six
pre-existing status/link diagnostics. Remaining authorized ownership and broad
read-audit work is tracked in [BR-050](build_request.md#br-050--finish-studio-coordination-and-read-path-handoff).

## 2026-09-15 — Single-motif vase tiling made explicit

The user specified one selected motif, mandatory cell endpoint connections,
optional transverse tilt, upward repetition on a regular parameter strip, and
mapping to the actual sleeve. They confirmed the displayed overlapping loops
and authorized resolving either missing implementation or documentation. Session:
`01a0a731-c52c-7f81-b60e-c20895d6661f`.

Existing sleeve mapping and advanced repeated paths already supported the
geometry. The loop demo authored a whole course, however, and saved no separate
cell/layout recipe. Vase-wall now accepts one motif plus cells per turn, course
rise, course count and tilt, expanding through the existing mapper. Cell joins
are explicit and mandatory; course grouping retains cooling and layer identity.
The loop demo uses that form. Normal recipe changes can switch authoring forms,
and Studio reviews the cell layout. Skill discovery, the owning manual and the
glossary describe the workflow and its actual-section mapping limits.

Generation now reports completed motif courses through the existing progress
callback, including regional work, instead of retaining the preceding base-fill
stage. This adds progress visibility, not a slicing-performance claim.

All 23 selected motif, mapped-path and Studio-settings tests passed. Coverage
includes independently authored course equivalence, tilt, rejected gaps,
inside/outside loop placement, changing hosts, persistence, form changes and
S5/H2D/configured Dobot command interpretation. A saved development print retained
one 17-point motif, tiled eight times per course across two courses, generated
372 checked moves, and reported progress 0/2, 1/2 and 2/2. It had no human
approvals. No physical printing or clearance validation is claimed.

The repository-wide documentation scan reported an unrelated completed BR-045
status and existing links to removed backlog headings BR-005, BR-018, BR-023 and
BR-039. It reported no motif documentation or capability-digest errors.

## 2026-09-15 — Tour disconnect policy approved and implemented

The user answered **"1. yes"** to keeping a tour through brief browser disconnects
and ending it on exit or Studio shutdown. For **"2. what is the case for it"**, the
agent explained the proposed SQLite scope, atomic claims/indexed queries, the
coordinator and file-lock alternatives, and schema/migration/runtime costs.
That question is not approval to adopt SQLite or change the Node minimum.

Studio now associates a live tour with its owning instance. The existing browser
grace period retains that run across reconnection; owner shutdown clears it and
cancels its pending work after accepted operations drain. Closing an observer or
an older owner cannot end a later run owned by another Studio. Saved example
prints remain, and opening one after shutdown does not restore the tour. Startup
through the toolkit attaches the run created before server launch. New tours
started through Studio record their owner directly.

All 20 selected lifetime, reconnect, toolkit and tour-lifetime tests passed,
including end-of-grace shutdown and cross-instance isolation. This implements
normal shutdown and browser-disconnect behavior. Forced process death, atomic
claims and cross-process mutation races remain part of coordination-store work;
the file-backed owner field does not establish transactional ownership.

## 2026-09-15 — Handoff implementation: tour scope and read boundaries

The user asked to read the handoff, start work, explain decisions and ask about
genuine ambiguity. Continued on the existing contributor branch and preserved
the preceding uncommitted flow-audit work. This entry records the implemented
portion; the broader coordination/read-path work remains in progress.

### Choices implemented and their reasons

| Choice | Alternatives considered and reason |
|---|---|
| Remove tour resume and identify runs/lesson visits. | Hiding the button alone would retain the API and obsolete teaching. Exit/cancel now clears an unfinished run; fresh starts create new example copies and a run ID. Leaving a lesson cancels scoped teaching, and revisiting creates a new lesson ID. Existing print copies remain saved. Individual edit cancellation does not end the tour. |
| Select MCP read scope by operation. | Loading a full program and then shortening its response retains unnecessary decoding/copying. Discovery now returns names/machines/timestamps with unchecked export status. Checked summaries use the existing metadata-only program contract; edit dispatch omits old exports. Check/approval/delivery still verify bytes. |
| Use catalog membership for selected manual reads. | Scanning every manual to establish a known ID adds no validity guarantee. A shared skill read now reads one manual; unknown IDs can consult the local extension. |
| Retain the fresh mutation-boundary read. | Passing an earlier mutable snapshot into a writer without checking current inputs could accept stale edits. Adjustment now reuses updatePlan's returned state, while updatePlan retains its fresh revision check. Further snapshot reuse needs an owning concurrency contract. |
| Separate geometry fingerprint scope from export scope. | A blanket cache bypass would repeat unrelated reads. Geometry fingerprints now omit exports while retaining original-STL integrity. Review and delivery still read current bytes. |
| Share bounded file-digest reuse with machine studies. | Rehashing the motion source on every idle poll adds no new change information. Studies reuse metadata-bound digests and omit motion decoding for geometry-only reads; changed bytes still invalidate checked source. |
| Report lease expiry as lost contact. | A helper heartbeat proves helper survival, not continued agent reasoning. No helper heartbeat was added. Ten-minute request leases remain; confirmed transport closure remains a distinct signal. |

Also added direct request-ID lookup and malformed-JSON isolation, reused supplied
plans for print names, shared a request snapshot within a tour state response,
restricted the tour picker to its known example directories, removed duplicate
signature reads, and stopped request-only events from scheduling generic revision
polls (target publication still schedules needed generation). Runtime provenance
keeps its manifest entries/order but reads repeated file paths once.

### Additional read-path evidence

The ignored `.local/read-path-followup.mjs` probe created its own small synthetic
box, 1,000 historical requests and 21 ordinary prints. Its JSON report is
`.local/read-path-followup-results.json`; results do not depend on private data.
The application filesystem instrumentation records returned bytes, parsing,
cloning and response sizes, not physical disk traffic or end-to-end user latency.
Module/runtime caches were warmed by fixture construction. Concurrent filesystem
notifications can contribute background reads; per-operation timings are not
isolated microbenchmarks. Streams and worker processes are excluded.

| Measured path | Result and disposition |
|---|---|
| Selected MCP `text` manual | One manual instead of the previously observed 17 reads. The manual response is about 30 KB; that is requested context, not a hidden full-catalog read. |
| One/21-print discovery | 2/42 plan-and-machine content reads; no native geometry or exports. Responses approximately 120/2,600 bytes. Recursive link confinement remains and contributes metadata calls. |
| Checked MCP summary | No motion arrays cloned; current program checks remain. |
| Direct lookup with 1,000 historical requests | One record read, no directory scan. |
| Operational request polling at that size | Approximately 534 KB response; full-history scanning and overlapping notification work remain. |
| Tour geometry state | One request-directory scan shared by the state and lesson gate, but that scan still reads all history. The tour picker likewise still incurs gate-related request reads despite enumerating only its known prints. |
| State → sources → view-ready | Approximately 88/88/101 KB read in this small fixture; source/geometry rereads remain across independently fresh boundaries. A shared verified-source handle remains a proposal. |
| No-op/settings/geometry MCP edits | Old export reads removed. Nested geometry/recipe reads remain (19/23/23 readFile calls including metadata/notifications); eliminating them safely needs the mutation owner. |
| Two simultaneous viewer state requests | Both perform their own reads; shared concurrent read work remains unimplemented. |

The dedicated audit is **not complete**: fresh-process cold paths, large STL and
native/source assets, growing review history, worker-side parsing/hashing/copies,
generation cancellation/recovery, approval/delivery measurement and simultaneous
agent-process ownership still need measurement. Existing software tests cover
integrity and delivery, but are not latency measurements for those workloads.

### Decisions awaiting clarification and remaining implementation

1. **Disconnect policy:** asked whether a live tour should survive a brief browser
   disconnect until explicit exit/cancel or Studio shutdown (recommended), or end
   on browser disconnect. Shutdown/crash invalidation is not implemented in this
   tranche; transient progress is still file-backed and can be observed by another
   process. No resume UI/API remains, but that alone does not complete run lifetime.
2. **Transactional storage compatibility:** compared an authoritative service
   (requires discovery/startup and a standalone-CLI lifecycle), filesystem locks
   (stale-lock ownership and crash recovery), and SQLite (atomic claims/indexed
   queries with independent CLI operation). Recommended SQLite and asked whether
   the minimum Node version may rise from 22 to 22.13 for its built-in module.
   [Node's version history](https://nodejs.org/api/sqlite.html) records removal of
   the startup flag in 22.13; the API remains experimental in that release.
   No dependency or engine requirement has changed pending that answer.
3. Indexed operational queries, atomic request/tour transitions, request-scoped
   renewal from real tool activity, generation cancellation/supersession and compact
   review updates remain. Implementing separate indexes or heartbeat helpers on the
   existing nontransactional files would add a second consistency problem. These
   should follow the chosen owner, retaining explicit history diagnostics and
   completed work awaiting presentation. Late start-layer writes also need scope
   validation at that owner, beyond cancellation of their guidance request.

### Verification

Targeted Studio tour/UI/import/agent tests, MCP tests, shared program-cache tests,
machine-study tests, toolkit, geometry confirmation, work state, opening,
reconnect and view-readiness tests passed across the relevant runs. New
`read-scope.test.mjs` assertions cover scoped reads/copies, malformed request
isolation, machine-study invalidation and altered-export rejection. An early MCP
run hit an intermittent Windows EPERM replacing a request JSON file while a
listener was active; the affected suite passed subsequently. This is further
evidence for storage ownership, not evidence that the race is fixed.

An isolated browser tour verified lesson-one geometry, absence of Resume, exit
restoring ordinary controls, and Tour starting a fresh `handle-2` at lesson one.
Browser warning/error logs were empty. Closed only the audit tab and managed
server. All fixtures and approvals used here were synthetic software exercises;
no physical print, hardware action or real manufacturing approval was performed.

## 2026-09-15 — Studio flow audit and preview readiness

Audited the user/agent/Studio boundary across startup, edits, guidance, imports,
geometry confirmation, generation, playback, saved-print selection, export,
tour navigation, failures, interruption and reconnect. The user's reported
inconsistency had concrete sources: request completion, displayed-result
identity, browser loading and lesson gating used different rules. The dots and
dimmed viewport are now called **Updating preview**; the user rejected "print
activity" because it sounds like exporting. Normal capabilities remain available
from any view, subject to their actual inputs and human confirmation dependencies.
Only the tour's teaching path narrows requests, with a gentle redirect and an
explicit exit to ordinary work.

### Findings addressed

| Finding | Change and owning boundary |
|---|---|
| A single request could finish visually after any changed input, including an intermediate save or unchanged geometry after a settings change. | Every new edit requires a saved result target. The shared [work state](studio/work-state.mjs) matches the target's inputs and geometry/toolpath stage. Legacy inference is conservative. |
| Waiting for one shape confirmation suppressed unrelated active edits; pausing and claiming work discarded its original baseline and target. | Waiting applies only to the matching prepared target. [Request persistence](studio/agent-requests.mjs) retains identity through pause/resume. |
| Browser polling could replace newer request state with an older response, and targets published after rendering lacked a persisted display receipt. | [Agent UI](studio/agent-ui.mjs) merges by update time and asks the existing view-ready path to acknowledge already displayed targets without reloading. Presentation and disconnect writes advance update time. |
| Early completion could leave an absent toolpath busy indefinitely; CLI begin-work could not reclaim a failed request. | Pending presentation has the request lease, and failed/expired work can be reclaimed. Successful presentation remains independent of final chat bookkeeping. |
| Guidance dimmed usable geometry, and tour gates separately treated queued edits and advisories as blockers. | Guidance/advisories stay visually quiet. Tour gates consume the same request-activity function as the viewport; only active unfinished edit work blocks a delivered edit lesson. |
| Ordinary geometry review started speculative workers; production generation could perform preparation before rejecting missing confirmation. | Ordinary state reads do not slice. Studio checks geometry confirmation before starting production work. Tour speculation is confined to the selected confirmed part in the import lesson. |
| Tour auto-generation could slice intermediate saves while the agent was still assembling an edit. Geometry-only reads could also prepare an already generated part. | Automatic tour generation waits for active edits' published input targets. A matching stored generation suppresses speculation; later review still checks its bytes. |
| Starting an edit checked the old export even though the agent was about to invalidate it. | [CLI begin-work](core/agent/toolkit.mjs) returns recipe/revision/geometry context without old-program validation and labels the unperformed check explicitly. It also returns the geometry hash. |
| Lesson gates and late start-layer choices changed the full-view fingerprint, stopping playback and entering the loading state. | [Studio revision responses](studio/server.mjs) separate tour metadata from bundle/data-mode identity. [Browser polling](studio/app.mjs) updates metadata without source loading. Unchanged activity polls no longer rerender lesson guidance. Compact approval responses use that same fingerprint. |
| Imported-model guidance could change settings and regenerate merely to find an infill layer; a now-invalid explicit layer could strand playback readiness. | Start-layer selection is quiet guidance over existing output. Missing or unavailable layers use deposited-layer fallback. It never requires a recipe change or reslice. |
| Download progress implied preview work, and manuals mixed geometry completion, generation, chat replies and listener waits. | Downloads use their own progress state. [MAKERS](MAKERS.md#existing-studio-work) now owns an explicit situation/action table; toolkit, MCP and tour guidance point to compatible result-publication and response rules. |

### Verification and limits of evidence

All 81 selected software tests passed across `studio-work`, `studio-agent-ui`,
`studio-view-readiness`, `studio-tour-ui`, `studio-tour`, `studio-agent`,
`studio-open`, `studio-reconnect`, `agent-toolkit`, `mcp` and
`chat-geometry-confirmation`. Coverage includes ordinary and tour edits,
overlapping work, stale responses, same-lesson geometry recovery, worker failures,
approval preservation, source reuse, S5/H2D/Dobot adapter paths and exact-byte
delivery. After the final activity/receipt changes, their 52 affected
Studio tests passed again. `git diff --check` passed.
The repository documentation check reported the same six pre-existing diagnostics
recorded in publication preparation below: BR-045 status punctuation and five
links to removed backlog headings. It found no new link diagnostics for this work.

An isolated browser run under ignored `Prints/studio-flow-audit-20260915` verified
initial geometry, visible edit activity, an intermediate save remaining active,
target publication clearing the indicator and unlocking Next before final agent
completion, saved selection and generated playback. Changing the tour's start
layer while playing preserved Pause, continued the timeline, and showed no busy
indicator. Exiting restored ordinary geometry/toolpath, open, import and export
controls. Browser error/warning logs were empty. Only the audit's tab and managed
server were closed. These were synthetic software exercises, with no final
manufacturing approval or physical print. No end-to-end latency benchmark or
new evidence for the deposition algorithms was claimed.

### Remaining structural findings and recommendations

These are audit findings and proposals, not implemented capabilities or newly
commissioned backlog work:

1. **Shared storage has no transactional owner across processes.** Request and
   tour files use atomic replacement, but read/modify/write transitions and claims
   are not cross-process transactions. CLI, Studio and MCP can race; tour playback
   writes can race a CLI start-layer change. Removing overlap rewrites and merging
   browser responses reduces exposure but does not solve storage ownership.
   Consolidating mutations behind one authoritative coordinator or transactional
   store should precede claims of exclusive handling or simultaneous agents on
   one part. The coordinator should own legal transitions and result receipts.
2. **Generation is serialized but not user-cancellable.** Request/progress reads
   stay responsive, while ordinary mutations queue behind a running generation
   and the browser disables navigation. A changed recipe cannot receive an old
   candidate, but obsolete computation may continue until that check. An explicit
   cancellation/supersession contract at the generation owner would let a new
   intent release obsolete work without restarting Studio. This needs coherent
   CLI/MCP/Studio ownership, not a new lesson-specific exception.
3. **The indicator observes request leases, not host reasoning.** A dead host
   turn need not close MCP; conversely a live long edit can exceed the ten-minute
   lease without renewing it. Geometry approval waits are now explicit, and the
   maker guidance names renewal, but reliable host cancellation/heartbeat events
   require client integration. An open viewer must not manufacture evidence that
   its agent is still working.
4. **Request history is scanned as a whole.** `list()` reads every saved record,
   and UI polling returns the library's history. One malformed JSON record can
   fail the batch. Bounded queries and per-record failure isolation belong with
   the storage owner; no growth benchmark was performed in this audit.
5. **Queued teaching can outlive its lesson.** Exit cancels tour work, but moving
   back within a tour does not scope every queued signal to a live lesson. The
   manual now tells agents to cancel obsolete guidance. Explicit event scope and
   cancellation at the coordinator would make this independent of agent memory.
6. **Review metadata and scene identity are still partly coupled.** Tour-only
   metadata no longer causes reloads, and normal approval responses reconcile
   their fingerprint. Tour export still changes review data and removes a marker,
   so subsequent bundle polling can enter refresh, although matching source and
   material buffers are reused. A shared compact review-state transition would
   remove that remaining presentation detour without another export-only flag.

### Follow-up handoff: tour lifetime, activity signals and design options

The user specified the following tour intent after reviewing finding 5:
**do not save tours for later resumption or expose resume in the UI.** Exiting
or cancelling a tour ends that run; the next tour starts again from the beginning.
Agent-mediated recovery on a specific user request remains a possibility to
consider, not an approved exception or a required capability. This is recorded
intent for follow-up implementation; the audit changes above do not implement it.

Transient coordination state may still be needed while a tour is running; it
must not become an implicit saved session. A recommended implementation is a
unique run identity with lesson-scoped requests. Exit/cancellation invalidates
that run and its pending teaching; starting again creates a new identity. Lesson
changes must also invalidate obsolete teaching within a live run, so removing
resume alone does not fully address finding 5. Whether a brief browser disconnect
ends the run, and the exact treatment of unexpected host loss, remain unspecified.
Cancelling an individual edit must remain distinct from cancelling the whole tour.

For finding 3, the user proposed a cleanup listener launched with Studio and
expressed a preference toward a heartbeat as the simpler approach. Neither is
implemented by this handoff. A launcher-side listener can observe its own process
and Studio work, but needs explicit host lifecycle events to know whether the
agent's turn is active or cancelled. A heartbeat from a surviving helper proves
only that helper is alive. The recommended portable fallback is request-scoped
lease renewal on actual agent/tool activity, with expiration reported as lost
contact rather than proof of model inactivity. Studio-owned workers can report
their own liveness independently; geometry approval waits remain explicit states.
A host adapter could add prompt cancellation signals without making host
integration a prerequisite for ordinary use.

The user found the remaining directions reasonable and asked to retain them as
**suggestions, with explicit consideration of other options**. A follow-up
implementer should compare alternatives against actual consumers, ownership,
failure recovery and complexity before selecting a design. These suggestions
are not fixed architecture decisions or a claim that the work is implemented:

- **Storage ownership (1):** consider one authoritative coordinator for request
  transitions and presentation receipts. Compare a coordinator process with
  transactional storage, including CLI-only operation and process failure; do
  not add both without a concrete need.
- **Generation cancellation (2):** consider a shared cancellation/supersession
  contract. The suggested product policy is that a newer edit supersedes obsolete
  generation for the same print, while merely changing views does not cancel it.
  Evaluate explicit cancellation and reuse of still-valid computation before
  choosing worker and queue behavior.
- **Agent liveness (3):** consider request leases as the portable baseline and
  host lifecycle events as an optional improvement. Compare renewal sources and
  timeout behavior; a helper's survival must not renew an agent request forever.
  Tune expiration against observed workloads and distinguish lost contact from
  confirmed cancellation, worker execution and waiting for a person.
- **Request retrieval (4):** consider direct ID lookup, bounded operational
  queries, change notifications and per-record failure isolation. Paginated
  history is useful only where an actual diagnostic consumer needs it; do not
  build a history feature merely to repair an inefficient active-request query.
  Compare indexed storage with a bounded active set and optional archive.
- **Tour scope (5):** apply the user's no-resume intent above. Run and lesson
  identities are suggested mechanisms, not prescribed storage formats. Evaluate
  brief-disconnect and host-loss behavior separately from explicit tour exit.
- **Review updates (6):** consider updating review metadata independently of
  geometry/toolpath loading through the shared state contract. Compare compact
  updates with separated revision identities; avoid another export-only flag.

#### Why history is currently read

This is request-record history under `.studio-requests`, not chat transcripts or
manufacturing review history. `list()` currently reads/parses every request file
and normalizes lease expiration before consumers filter the returned records:

| Consumer | Actual information needed |
|---|---|
| Studio browser polling (every 750 ms), state responses and disconnect notifications | Relevant request activity, pending presentation and failure notices. The server currently sends the library-wide list. |
| CLI/MCP request wait loop (75 ms delay between scans while waiting), MCP queued-request notifications and queued-request checks | Queued requests; no completed history is needed for dispatch. |
| CLI/MCP begin-work with a request ID | One request and its print identity; direct lookup would suffice. |
| Presentation acknowledgements, owner disconnect cleanup and print cancellation | Unpresented work or cancellable requests for the relevant print/owner. A completed request awaiting presentation still belongs in the operational set. |
| Tour lesson gating and edit evidence | Current work and qualifying edits within the lesson, including completed edits. Current code also collects prior IDs and recovers older saved-lesson baselines; those resume paths should be reconsidered under the new tour intent. |
| Explicit failure inspection and MCP/CLI request listing | Selected historical records for diagnosis; explicit listing currently permits the full library history. |

No recurring operational consumer inherently needs to scan all historical
requests. Some need recently resolved records or current-lesson evidence, so
filtering solely to `status === 'working'` would be incorrect. Preserve those
semantics and explicit diagnostic access while avoiding full-history reads on
the live path. This trace establishes unnecessary read scope, not a measured
latency regression; no history-growth benchmark was run.

### Follow-up: unnecessary reads and dedicated read-path audit

The user challenged whether fixing request-history retrieval was enough. A
follow-up source trace and isolated read-count probe found additional unnecessary
scope and repeated work. The user then asked to adopt all findings/directions
and recommend a dedicated read-path audit in this handoff. Carry the items below
forward as accepted audit concerns and starting recommendations; compare other
solutions before choosing implementation. This follow-up records evidence and
intent, not implementation of these additional fixes. The earlier flow audit
was broad behavioral coverage, not an exhaustive inventory of reads.

#### Confirmed findings and suggested direction

| Finding | Evidence and suggested direction |
|---|---|
| Request retrieval reads the whole library repeatedly. | The consumer trace above still applies. The probe observed five full scans in a 300 ms listener wait with existing IDs excluded, and two scans within one tour geometry state response. Use scoped operational queries/direct lookup and shared snapshots or notifications; retain pending-presentation and lesson evidence. |
| MCP uses full bundle/program reads for operations that do not need the old toolpath. | `adapters/mcp/src/server.mjs` routes `adjust_print`, text/insert edits, machine changes, `check_path`, `remember_setup` and geometry confirmation through `read()`, which calls `loadBundle()` with full program decoding enabled. The owning operations then read their inputs again. Select read scope by operation; do not check/decode a soon-to-be-invalidated export merely to dispatch an edit. |
| MCP listing and summaries load more than they return. | `list_prints` first enumerates summaries, then fully validates every bundle, including available programs. `get_print` also loads full motion even though its response omits motion arrays. Separate discovery/recipe metadata from explicitly requested validated export status, label unchecked fields, and use metadata-only checked program results where sufficient. Preserve the guarantees of explicit check/approval tools. |
| Reading one MCP skill reads every skill first. | `read_skill` calls `skills()` to establish membership, which reads all 16 shared manuals, then reads the selected manual again. The probe confirmed 17 manual reads for one `text` request. Use the existing shared catalog for known IDs and a scoped local-extension lookup; listing metadata and reading a selected manual should not require the same full-manual scan. |
| Nested workflow functions multiply input loads. | Even a no-op MCP recipe patch read native geometry, geometry descriptor, machine and review four times each; plan five times, plus the existing export once. `adjustBundle -> updatePlan -> loadBundle`, optional `rememberSetup`, and final summaries introduce separate loads. Evaluate one validated operation snapshot and reuse of returned results, retaining a fresh concurrency check at the actual mutation boundary. |
| Preview preparation, transfer and acknowledgment repeat bundle reads. | A normal `/api/state -> /api/sources -> /api/view-ready` sequence rereads the native geometry and export at every endpoint. CLI preview launch also performs an initial geometry read and then a checked summary read for non-tour opens before the browser performs its own load. Consider a bounded verified snapshot/source handle shared by consumers, with explicit invalidation and freshness checks. Do not remove exact-byte protection across independently mutable files. |
| Geometry-only reads can still discover/read export bytes through fingerprinting. | `readStableBundle(..., {program:false})` still calls the broad `bundleFingerprint()`, which includes the export and original STL. Thus omitting program loading does not ensure an export-free cold read. A cold revision probe read the saved export; the warm shared-workflow probe correctly reused its digest. Evaluate separate change identities/read scopes rather than a blanket cache bypass. |
| Tour/library reads have excessive scope and duplicate derivation. | `tour.info()` reads persisted progress and resolves the saved selection even outside an active tour; active edit lessons also query requests and may reread the recipe for gate signatures. POST dispatch obtains progress before handlers that obtain it again. `/api/prints` scans all prints before filtering to known tour choices; `printName()` rereads a plan already read by listing/state code. Reuse per-operation inputs and list the known tour choices directly. The no-resume direction should remove inactive saved-tour dependencies. |
| Polling and change notifications overlap. | Agent UI polls at 750 ms, revision polling at one second, request waits rescan after 75 ms, and generic Studio change events also schedule revision polling, including request-only changes. Playback adds its own tour updates. Evaluate one scoped notification/snapshot path with bounded fallback polling and no overlapping in-flight work; account for missed filesystem events and multiple processes. |
| The machine-study adapter rereads the entire motion source on revision polls. | Its `bundleFingerprint()` reads plan, machine and `motion.json` contents each time, unlike the shared print workflow's metadata-assisted digest reuse. `loadBundle({program:false})` also reads/interprets motion to construct study metadata. Apply an equivalent change-detection contract and determine which study metadata truly requires decoding. This was source-traced, not measured in the probe. |

Additional lower-priority evidence: the first shared-workflow state read hashes
the broad runtime manifest, including unused skill dependencies, and overlapping
manifest entries read some files twice. The probe's cold state read included 118
`readFile` calls and about 2.51 MB total, including runtime identity inputs. This
does not mean all 118 reads are unnecessary: runtime provenance is intentional
and cached per adapter. Deduplicate identical entries and evaluate reuse across
processes/adapters only with a sound code-change invalidation contract; do not
silently narrow the generator identity to improve a benchmark.

#### Probe evidence and limits

An ignored local probe at `Prints/studio-read-audit-20260915/probe.mjs` copied the
previous synthetic tour fixture into an isolated library and instrumented Node
filesystem promise calls. Detailed counts are in that directory's `results.json`;
these local artifacts are not required to read this handoff. Selected results:

| Operation | Observed reads |
|---|---|
| Warm ordinary revision | Two `readFile` attempts (tour progress and absent tour marker), ten `stat` calls; no geometry/export content reread. |
| Idle request listener, 300 ms, three existing IDs excluded | Five directory scans, 15 request-file reads. |
| Tour geometry state | Two request-directory scans, each reading the same three records. |
| MCP read `text` skill | All 16 distinct shared manuals, with `text` read a second time, plus one request scan. |
| MCP list two prints | Each plan read four times; both native geometries and the one available export read. |
| MCP no-op recipe edit | Four native-geometry reads, four descriptor/machine/review reads each, five plan reads, one existing-export read. |

The generated handle's program was available with no program error. The probe
used ordinary state/source/view-ready endpoints, tour geometry metadata/listing,
an in-memory MCP client, and a no-op recipe patch. All owned servers/transports
were closed. It performed no new generation, manufacturing approval, delivery
or physical action. Counts are application filesystem calls and returned bytes,
not physical disk traffic, CPU cost or end-to-end user latency; OS caching may
serve reads. Instrumentation excludes module-loader internals, stream reads
(including original-STL hashing), and separate worker processes. Shared process
caches were warm for the later MCP probes, so these are not cold-client timings.

#### Recommended dedicated audit still outstanding

This follow-up is a partial read-path audit, **not completion of the dedicated
audit**. Trace reads, parsing, hashing, decoding, copying and response payloads
across CLI, MCP, Studio server, workers and browser. For each consumer record
the minimum data, required freshness, purpose, trigger frequency and owner.
Measure cold/warm startup, unchanged idle, geometry-only edits, settings-only
edits, source loading, generation, approval/delivery, recovery and tour exit.
Include large STL/native/source files, growing request/review history, many
prints, machine studies, multiple viewers and simultaneous agent processes.
Measure agent-facing payload/context size as well as runtime I/O: shorter output
alone can hide expensive reads and decoding behind the summary.

Distinguish unnecessary reads, repeated reads within one logical operation,
premature reads that will be invalidated, and necessary freshness/approval checks.
Protect original-STL integrity, exact reviewed export bytes, stale-revision
rejection and path/link confinement. Compare scoped queries, shared operation
snapshots, versioned source handles and event-driven invalidation; choose the
simplest design that meets those contracts. Verify improvements against the
measured paths and add targeted regressions for the specific repeated/unrelated
reads removed. Do not treat fixing request-history access alone as completion.

## 2026-09-15 — Publication preparation

Prepared the shared Studio, text-material and travel changes for the user's
requested commit and push on `codex/provisional-goalpost`. The remote branch
had been deleted after PR #10; its merge on main introduced no further file
changes, so the local branch fast-forwarded to that base. Generated .NET
benchmark `obj` files are removed from tracking and retained locally; `obj`
and `bin` output directories are now ignored.

Reused the focused software and browser verification recorded below, with no
implementation changes during preparation. `git diff --check HEAD` passed.
The repository documentation check found and prompted correction of BR-049's
status punctuation and work-record field. Six pre-existing diagnostics remain:
BR-045 status punctuation and five stale links to removed BR-005, BR-018,
BR-023 and BR-039 headings. These do not represent software test failures.
The other generator improvements in BR-049 remain explicitly deferred.

## 2026-09-15 — Local material clearance and curved comb routing

The user authorized a general shared repair after the wavy roof with draped
lettering exposed 1,281 locally permitted short connections blocked by the
highest prior planar layer, regardless of its footprint. The implementation
keeps planar footprints and heights in shared material queries and adds a
height-field surface policy reusable by producers. Drape supplies its allowed
footprint and each skin's own height. Shared combing samples curved edges,
checks every emitted segment against completed operations, and routes within
the endpoints' connected component. Global lifted clearance is unchanged;
policies without local material geometry retain conservative legacy checks.

Nine new analytical regressions cover holes/islands, collinear contact, narrow
obstacles, large translations, descending crossings, surface heights, curved
detours, blocked route edges, disconnected components and legacy policies.
All 68 selected tests passed across those checks, existing travel/composition,
straight moves, reservations, spacing, full-fill, planar-infill, draped-skin
and curved text. The surface adapter uses the producer's sampling step and sag
limit; this remains a nominal material-region model, with sampled surface
limits rather than a full swept-head or physical clearance validation.

The exact local wavy-roof/lettering fixture was regenerated before and after
the shared changes (`Prints/development/text-material-demo-verification`, plan
SHA-256 `e4338e63f3e0a2e2761af5ad6ac20295993f6e94a058b1a427efa5da82e06744`).
The same recipe, placement and deposition ordering were used for both runs.

| Measurement | Before | After |
|---|---:|---:|
| Whole-print retract/lift cycles | 3,144 | 1,332 |
| Whole-print travel, mm | 96,156.585 | 72,158.716 |
| Lettering retract/lift cycles | 1,428 | 60 |
| Lettering cycles with endpoints within 1 mm | 1,290 | 6 |
| Lettering travel, mm | 19,864.000 | 1,859.840 |

All 2,257,835 depositing moves retained identical start/end coordinates,
speed, volume and metadata: SHA-256
`28272dd558f605a5ee6e3eefad4be98238db024d293280ac2c7bb316fd0fda47`.
Total deposited volume stayed 33,105.96831755667 mm³. A flat 12 × 10 × 2 mm
box retained its entire path object, including all travel, exactly. These
comparisons are software evidence, not a physical print. Single generation
measurements were 331.8 seconds before and 654.8 seconds after, taken alongside
other local diagnostic/test work; they are not a controlled performance benchmark.
The local comparison scripts and compact measurements are retained under
`.local/travel-*`. Other advisory-identified generator cases remain deferred in
BR-049; the advisory continues to report without blocking or repairing exports.

## 2026-09-15 — Advisory for travel endpoints within 2 mm

The user explicitly authorized a runtime toolpath check despite the normal
guidance against additional check burden: report bad paths to the agent, without
blocking or repairing them. The implementation uses an inclusive 2 mm XYZ
endpoint threshold on complete non-depositing trips, including lifts/detours and
robot sampling. Shared machine interpretation and Studio machine studies return
bounded source examples and operation counts; cached source metadata retains the
result. Matching displayed exports notify the agent once through an advisory
request, preserving evidence without busy dots or timeout errors. Generation,
approval and exact-byte delivery retain their existing behavior.

Generator improvements requested “at some point” remain deferred in BR-049.
All 47 selected software tests passed across `travel-advisory`, `program-cache`,
`studio-open`, `machine-study`, `studio-work` and `mcp`. These cover analytical
endpoint cases, S5/H2D source parity,
warm/cold reuse, advisory listener delivery/deduplication and approval/delivery
with findings. No physical print or generator repair was performed.

## 2026-09-15 — Lettering material interoperability

The user redirected a wavy-roof lettering experiment to improving the text skill
across applicable printing patterns. Text compilation now retains separately
selectable base and raised-feature material with one merged review solid.
Earlier material owns overlaps; later engraving cuts all affected partitions.
Regional plans resolve those selections with assembly placement and detect
whole/partition ownership conflicts. Changing the deposition pattern preserves
geometry approval. Legacy records remain readable and gain partitions on rebuild.
Standalone text retains its original surface as an unprinted guide through edits.
Feature removal can replace dependent regions in the same validated operation.

Draped-only regions consume finished lower surfaces using their actual first-bead
gap, including curved glyphs above a native roof. Removed planar start-height and
nominal-reserve restrictions that incorrectly rejected those skins; missing
support and nonpositive deposited gaps still fail. Lettering selections preserve
heat-set reinforcement metadata and its planar-owner validation, while standalone
reference bodies contribute no reinforcement. Other skills' selection interfaces
were not broadened.

Focused checks passed: the text suite (13 tests), interoperability suite (6),
curved-text suite (2), existing regional suite (5), and heat-set suite (7), using
reused results where inputs were unchanged. Checks cover holes/disconnected
glyphs, four curved layers, measured first-bead gaps, operation order and exported
curved moves; disjoint volumes/sections; translated assembly; retained approvals;
atomic edits; imported references/source hashes; legacy records; side lettering;
and preserved insert loops/fins. The public draped example created an unapproved
`remettub` plan using native `top` and `base` / `text/label` selections. These are
software results; no physical print or nozzle-clearance validation was performed.

A side-letter O trial with continuous vase-wall generation failed at contour
subdivision; planar side lettering passes. Pattern limits remain explicit. The
user-requested read-only subagent sweep identified independent follow-up candidates
in Gridfinity construction partitions, heat-set feature selection, wave surface
publication and thick-lip continuation. They were handed off as findings, not
added as authorized implementation work or represented as reproduced failures.

## 2026-09-15 — Tour cues, repaired STL review and playback reuse

Approved follow-ups add one temporary geometry review within any toolpath lesson.
The selected print and lesson stay fixed; explicit geometry confirmation returns
to that lesson. Generic navigation grants no approval. The import lesson's
explicit continue/confirm action now checks the displayed revision and geometry
hash before approving. Both ordinary Studio and the tour also accept explicit
human chat geometry confirmation through a narrow shared CLI/MCP operation,
retaining the statement and chat reference against the current revision/hash.
Final settings/exact-toolpath approval remains in Studio; MCP tour generation
cannot bypass geometry confirmation through development mode.

The chat-edit lesson accepts geometry or settings changes after their confirmed
current toolpath is displayed. Existing request baselines distinguish participant
edits from unchanged/automatic work and survive temporary review and resume.
Queued guidance does not block a completed edit; pending edits still do. New
geometry awaiting human confirmation clears work fading while keeping a requested
toolpath pending. Browser checks exercised button and chat recovery in an isolated
synthetic library. Focused tests cover stale confirmations, CLI/MCP scope, every
toolpath lesson's review UI, same-lesson generation, early-tour preservation,
request correlation, import review and ordinary readiness/cache behavior.

The user requested eight tour-focused fixes and investigations, then added the
ordinary geometry-confirmation acknowledgement bug and approved automatic STL
repair followed by explicit geometry review. They also requested layer 2 as a
fallback when the agent supplies no playback layer.

Tour-only changes: Next highlights after displayed edits on the first two
geometry lessons; the optional roof lesson locks Next with active-work dots and
fading. Removed the preparation sentence from the optional STL lesson. Play's
highlight stops on first use. Missing agent layer selection uses the second
deposited layer (or the only layer), counts normal viewing time and does not
reposition an already-started playback when late guidance arrives. Model selection
does not depend on a playback layer. A repaired import stays on the geometry
lesson until **Confirm repaired geometry & continue**; switching away and back
does not bypass that review. Successful generation recovery queues a missing
start-layer request.

General Studio changes: ordinary geometry confirmation renders the toolpath
before sending its view receipt, clearing activity after successful loading.
One current-print playback cache reuses source decoding and material scenes on
same-print reopening and tour Back/Continue, with plan/export/print invalidation.
Same-directory reopening retains preparation. A completed speculative diagnostic
is surfaced once without repeating its calculation; crashed workers and explicit
retries remain recoverable. Visible loading/saving copy no longer calls the
toolpath "checked". Choosing an STL stops the previous selection's speculation.

STL import now runs off the server event loop. It first validates normally, then
automatically applies the existing exact-cleanup/native repair operation to
recognized mesh defects. No hole filling is enabled. Original/repaired STLs and
the existing repair report remain in the print; repair results are unapproved
geometry in both modes. Progress names checking, repair and opening; failed
imports clean only their reserved destination. CLI/MCP import remains strict.
Real native self-intersection repair ran successfully in the focused tests.
The participant's exact original failing STL was not supplied, so that particular
file is not claimed as reproduced.

The surprise-slide investigation found an agent-initiated process change in the
local Claude transcript: it disabled draped skin after requested roof lettering,
created another edit request to keep the part generatable, and explained the
workaround afterward. Geometry approval remained valid. A later lettering move
was explicitly requested. No evidence showed a Studio geometry mutation on
entering the saved-print lesson. The proposed guidance correction—ask before a
compatibility workaround changes the intended shape/process, and use read-only
status for revision retrieval—was left awaiting the user's requested approval.
Private transcript content was not copied into shared files.

Verification used the focused Studio tour, agent, import, opening, readiness,
playback-cache and program-cache suites. The latest affected-server/tour/import
run passed 35 tests; browser readiness/cache tests and unchanged-byte lifecycle
checks also passed. Browser checks on an isolated library verified both edit
cues, roof locking/fade, Play/Pause highlighting, Back/Continue, import loading,
failed-import selection preservation, repaired-geometry confirmation, and layer-2
playback completing without an agent layer. The final browser had no warning/error
logs. These are software results, not physical-print evidence. Test viewers and
their owned server sessions were closed.

The prework audit confirmed that worker checking and generation share their
candidate, and current development-to-production promotion/export do not reslice.
The remaining priority gap is cross-process: separate Studio/CLI/MCP jobs have no
shared computation coordinator. Proposed follow-up: one bounded, cancellable
speculative job that foreground work can adopt or preempt, before starting earlier
or alternative-choice preparation. Another optional improvement is a before/after
repair comparison view. These are proposals, not newly authorized backlog work.

## 2026-09-14 — Goalpost setup fix and removal of extra mesh CI

The user confirmed the intended branch rule as "at most one active pending
branch per account" and requested removal of the added mesh CI job. Applied
that wording to existing agent guidance and removed `mesh-repair.yml`; broader
policy rewrites were discarded. The existing runtime setup workflow and local
regression tests remain unchanged.

The GitHub runtime setup failure reproduced locally: Studio's activity metadata
required the temporary setup print to belong to the configured Prints library,
so `/api/state` returned 400. External saved prints now load without library
request records, and their view receipts skip that ledger. Starting agent edit
requests still requires a print inside the configured library. The setup
assertion now includes the server's error message when state loading fails.

The existing setup check passed after the fix, as did 15 existing Studio opening
and agent-request tests. Those results were reused after the documentation-only
follow-up. No test or CI job was added, and the user will handle GitHub review
and merging without an additional agent verification run there.

## 2026-09-14 — Branch repair and recipe-only tour packages

The user identified Timothy Keller's direct main commit `164d3e5` as work that
belonged on its own branch. Preserved it on `codex/tkeller-vase-wall` and applied
the authorized revert `93d2a2a` to main. The revert tree exactly matches its
pre-change parent `21f8cf4`; shared main history was not rewritten. Development
guidance now defaults to contributor branches and PR integration.
Reapplied Timothy's change as `989bf64` on top of repaired main on his branch,
preserving authorship and making it independently reviewable in a new PR.

The provisional checkpoint's unpublished parents included an approximately
99 MB display cache and 80 MB machine program for the wavy roof. The user chose
to keep the current handle/fin block and wavy-roof recipes, initialize both through
the shared bundle lifecycle, and generate toolpaths when the tour needs them.
Removed tracked prepared packages and their retired cache loader/packaging tool;
optional Nudge Cup and DENSO source recipes remain. Earlier local generated data
stays ignored. The original checkpoint is preserved locally on
`codex/provisional-goalpost-original`; the replacement publication omits its
unpublished binary history.
After publication, the user clarified one active development branch per developer
account. Removed the temporary repair branch, repair worktree and local safety
branch, and made that branch-reuse rule explicit in the owning guidance.

Verification: all 13 focused tour, agent-toolkit and demo tests passed, including
current roof geometry, no inherited generation, fresh copies, preserved edits,
HTTP startup and toolpath preparation after selection. Browser application and
source-worker syntax checks passed. No new browser or physical trial was run;
milestone acceptance remains provisional.

## 2026-09-14 — Provisional goalpost checkpoint

The user requested a checkpoint of all current shared work as the provisional
goalpost for the first milestone, published on an agent branch for a web PR and
human merge. If the implemented behavior holds up under further testing, this
state meets the first milestone target; milestone acceptance remains provisional.

The checkpoint includes the accumulated local development and the latest agent
toolkit, onboarding, Studio tour/activity, plastic-weld and heat-set gusset work.
The entries below retain the actual focused software checks and browser evidence.
No additional software or physical tests were run for this checkpoint. Further
testing remains necessary; this record does not establish physical print results.

## 2026-09-14 — Direct startup and ordered context reads

The user reported that tour agents still read MAKERS and other references before
launching the bundled command, then requested a trace of ordinary maker and
developer entry paths. The entry table still required manual reads first, and
the MCP initialization guidance independently repeated that routing. AGENTS now
puts the exact tour launch command first, followed by opening its returned URL
and consuming the returned context/listener. MAKERS, the toolkit manual, tour
manual and MCP guidance agree on this ordering. The CLI readiness/result messages
also state the next action at each stage.

Ordinary new-part and developer entry routes now call their onboarding command
only for missing context, use its returned documents directly, and choose
individual follow-up reads. Existing-print requests begin/claim work before
loading missing context; their common instructions now have their own MAKERS
section. Developer onboarding no longer returns the already-loaded AGENTS.
All routes reuse current context and setup; linked documents already supplied
by onboarding do not create repeated reads. The toolkit manual records these
four request flows in a read-order table.

Two focused checks passed: both-role context coverage and deduplication, and the
actual CLI tour launch with Studio readiness before participation context. The
MCP entry module also passed its syntax check. These checks establish command
and context behavior; no new-agent timing measurement was performed.

## 2026-09-14 — Remove the Studio tour welcome pane

The user reported the Welcome to SAAM pane on port 52107 and required tours to
start in the handle part view. Browser inspection confirmed the inactive-tour
fallback over the saved handle's toolpath view. Removed the welcome markup and
its rendering branch. The header's Tour button starts a fresh tour directly;
Resume tour is a separate header control for paused progress. Active Tour toggles
lesson guidance, and completion uses a dedicated congratulations panel.

Removed the delayed Exit handler's visibility assignment so an old exit cannot
hide a subsequent lesson. Four focused tour UI tests and the existing fresh-copy,
resume and exit integration test passed. Browser checks on port 52107 confirmed
direct handle startup and ordinary geometry after exit without an introductory
pane. The saved edited handle and its delivered program were preserved; fresh
local tour copies were created for the browser checks. No print approvals or
hardware actions were performed during this development follow-up.

## 2026-09-14 — Onboarding leaves skill selection to the agent

The user clarified that both onboarding paths should include the complete skill
digest while skill manuals remain individual follow-up reads, chosen by the
agent's judgment for the task. Both paths now return the existing digest and
explicit follow-up guidance. Removed onboarding's manual-bundling options and
added `read-skill` and `read-guidance` for one chosen manual or section at a time.
Failure inspection returns skill references instead of full manuals; tour
participation guidance remains bundled. The user rejected an added catalog
label, so existing skill descriptions and catalog presentation are preserved.
All seven toolkit tests passed, including complete catalog links in both roles,
separate manual reads, reference-only failure inspection and tour startup.

## 2026-09-14 — Tour cues and shared Studio activity (BR-048 completed)

The current user requested that live tour reports be banked without fixes, then
released the hold: “Okay tour is done, you are go to make changes.” Contributor
account, exact conversation title and stable session reference are unavailable.
The same conversation requested step-3 geometry fading, two step-4 arrows,
an audit of dots missing during rebuilds or lingering after results arrive, and
viewport fading during shared Studio activity. Later requests added Exit tour
on Congratulations, “request any other change”, and equal colors and blinking
for Continue with this part and Import STL.

Completed all four reports. The tour alone dims geometry at its saved-print
lesson and gives both step-4 choices large arrows and matching slate-blue
highlights. Congratulations offers Exit tour and stays dismissed after exit.
Shared Studio dots and the 28% viewport opacity now use one work state. Requests
record their input baseline and optional prepared-result target; visible result
receipts stop activity independently of delayed agent acknowledgements. Viewer
loading also contributes activity. Source inspection established that the old
request ledger and viewer readiness could disagree; the exact cause in the
original live run was not recorded.

The user clarified that waiting for an answer is idle and intermediate display
is optional. Other active edits may keep activity visible after an intermediate
result lands; pauses, errors, interruption and supersession do not obligate the
agent to deliver abandoned edits or intermediate previews. The tour manual
summarizes this in one sentence; Studio owns the coordination details.

Verification: 26 focused Studio work, UI, tour and agent tests passed, plus three
focused MCP checks. The completion integration check passed again after marking
the closing message as guidance. Browser checks showed equal step-4 choices,
the requested fade, activity stopping at playable-result readiness while its
request still said working, and dismissal of the Congratulations panel through
Exit tour. Fixtures used isolated libraries and synthetic approvals/completion
receipts; this is software evidence, with no hardware trial. Removed resolved
BR-048 from the outstanding queue.

## 2026-09-14 — Bundled agent CLI operations

The user requested the proposed onboarding, tour, preview, work-context,
wait/claim and failure-inspection bundles as a CLI toolkit, with a breakdown of
each command. Added `scripts/agent-toolkit.mjs` over shared exported APIs and the
`npm run agent` alias. Studio commands also run through the existing
`node studio/server.mjs --toolkit` launcher, emit the URL before the remaining
context, and retain the managed process. Onboarding reads the current owning
manuals and selected references; it observes dependency availability without
running setup or regression checks. Later failures report retained bundles and
close the call's own server. The [toolkit manual](core/agent/README.md) records
each command's contents and limits.

Moved the published-manual reader behind a CLI/MCP shared owner, retaining the
adapter import path, and shared the existing browser opener. The shared request
wait accepts optional claiming, including through MCP. Toolkit request responses
also pass through the current prepared-result and guidance semantics. Updated an
older STL-access regression to reflect the existing documented automatic-units
default rather than expecting mandatory explicit units.

Verification: all 36 selected tests in `agent-toolkit.test.mjs`,
`mcp-access.test.mjs`, `mcp.test.mjs` and `studio-agent.test.mjs` passed. A subsequent
focused SDK check of the added `claim:true` route also passed. Fixtures use
isolated temporary libraries and synthetic approvals; coverage includes fresh
tour geometry over HTTP, the actual CLI launcher, preserved approved export
bytes on reopening, STL bytes/units, request correlation and partial failure.
This establishes software behavior, not browser-render timing or physical print
results. No end-to-end time/token savings were measured.

## 2026-09-14 — New tours begin at the first lesson

The user required new tours to begin at the beginning. The Studio launcher
without a print path now starts a fresh tour instead of resuming saved progress.
Start and restart reset to lesson one, retain earlier saved parts, and clear the
old model's playback layer; a launcher-supplied layer is applied to the new tour.
Explicit resume retains the saved lesson. Four focused state and UI checks pass,
including restart from a later lesson and separate start/resume button actions.

The user clarified that both examples must be pristine bundled versions and
reported 75 seconds of orientation before launch. Fresh start now creates both
copies immediately. The extended restart regression edits both old copies and
checks the new plans against their original bundled sources, including the roof
manifest, while retaining previous edits. It passes. A single isolated startup
measurement took 1,410 ms: module imports 378 ms, fresh copies/start layer 805 ms,
and server plus first geometry response 226 ms. This excludes agent orientation,
browser rendering and the CLI's preliminary bundle read; it does not attribute
the reported 75 seconds. The entry-point guidance now routes tour requests through
a short launch section, defers skill reads until edits and loads participation
guidance while lesson one is visible. No end-to-end latency claim is established.

## 2026-09-14 — Experimental plastic-weld skill

The user requested injected plastic rivets: blind shafts with wider bottom
basins, individual reinforcement sites and staggered overlapping heights. They
emphasized reuse of the shared core and interoperability, then explicitly
accepted sparse hosts when each cavity has a sealed envelope. Added adjustable
1.2 mm shafts, 3 mm tapered basins and a 4 mm example depth, with metered volume,
flow, nozzle seating, hold and optional operation temperature. These are trial
values, not physically established settings.

Shared planar reservations leave cavities empty; existing complementary
full-fill masks enclose them in sparse interiors. The shared composer orders
stationary injection before cover layers and carries normal travel and cooling.
Regional surface publication can expose a completed mouth with its injection
dependency. Added shared stationary extrusion and nozzle-temperature actions,
S5/H2D E-only output and source interpretation, and Studio injection markers.
Relay robot output and nonplanar deposition through a cavity fail explicitly.

Verification covers an independently calculated stepped cavity volume,
solid/sparse ownership, staggered heights, flat region boundaries, completed
surface consumption, translated mesh/vase composition, temperature restoration,
source playback and exact-byte delivery with synthetic test approvals. Focused
composition, modal export, pipeline, regional workflow and infill regressions
pass. The unapproved CLI coupon in `Prints/plastic-weld-trial-20260915` generates
9,950 moves with two approximately 8.18 mm³ injections. Browser inspection shows
the first injection's fixed position, volume and temperature in Studio. No
hardware ran; pressure sealing, fusion, strength and thermal behavior need
physical tests.

Source-player, skill-digest and material rendering checks pass, including the
updated expectation that stationary deposition uses an event marker. The broad
documentation check reports unrelated existing backlog statuses/anchors
(BR-045 and references to BR-005, BR-018, BR-023 and BR-039); no weld manual link
failure is reported. Whitespace checks pass.

## 2026-09-14 — Tapered heat-set gussets

The user revised the heat-set fins to brace the sleeve/front-face joint with
approximately double root thickness, taper and a triangular vertical profile.
Radial reach now grows linearly from the blind-hole floor to the full length at
the insertion face. Thickness tapers from twice the nominal fin width at the
sleeve to nominal at the outer tip. Shared scanline fill supplies each trapezoid
layer and the existing material reservations keep ordinary fill out of it.
Targeted tests verify the diagonal boundary, 1.6 mm nominal roots for 0.8 mm fins,
actual joint bead coverage, six unchanged loops, and composition without duplicate
fins. The existing development example is regenerated; physical behavior remains
unmeasured.

## 2026-09-14 — Heat-set inserts and standard parameter policy

The user requested catalog-specific receiving holes, exactly six local loops,
and fins joining the sleeve to the front insertion face, then confirmed radial
fins and authorized selecting one initial manufacturer. Added 60 SPIROL Series
19/29 metric/imperial variants with primary-source dimensions. The named standard
parameter policy now has one owner in MAKERS.md, referenced by the shared tools,
Studio and skill-author guidance. Reuse remains distinct from job approval.

The feature compiles through the shared solid kernel and adds local deposition
details to the shared planar producer, preserving full-fill, sparse/solid masks,
assembly placement, material regions, text, normal export and Studio review.
Initial holes are blind with flat Z-normal insertion faces; other axes require
part reorientation. Catalog dimensions, loop counts, material exclusion, edits,
regional composition and MCP routing have software coverage. The development
example is a 54 × 32 × 12 mm block with M3-long and 4-40-short bores; no physical
fit, strength or manufacturing approval is claimed.

Date entries by the work or observation when evidence supports it; cite the
dated source or commit and distinguish request, checkpoint and completion dates.
Preserve explicit follow-up dates and timezones. If the work date is unknown,
say so and record the recording or migration date separately; never infer it from
file modification time. Record actual verification scope, without copying entire
contracts or turning test counts into claims of physical success. New entries
need no build-request ID; preserve an existing ID when moving its work record.

## 2026-09-14 — Timed tour pass and approved speed fixes

The participant used Adam for the maker role while developer commentary tracked
the tour. The pass ran on September 15 UTC (September 14 Pacific). Source fixes
waited until the participant completed the tour and received the timing workbook;
the subsequent audit preceded the approved performance implementation. Gyroid
contour optimization was explicitly deferred to a later session, with the user
carrying that request.

Observed baseline boundaries, including agent/tool orchestration where stated:

| Operation | Observed time |
|---|---:|
| Adam on base: request to resolution / text command | 27.205 s / 0.934 s |
| Adam on roof: request to resolution / text and adjustment commands | 52.264 s / 10.926 s |
| First roof: entering toolpath lesson to saved generation | 36.296 s |
| Infill edit: request to resolution | 184.706 s |
| Avoidable wait before starting infill generation | approximately 113 s |
| Bambu edit: request to saved generation | 44.293 s |
| Completion event to agent claim | 19.558 s |
| Isolated final-roof generation, 799,015 moves | 14.152 s |

Request durations include orchestration and are not pure model CPU time. The
tour's final-lesson-to-download interval included human dwell and cannot measure
export latency alone. Ignored `.local/tour-speed-20260915/` holds observer events,
the timing workbook, audit, profiles and replay scripts. The workbook separates
operation boundaries, command times and unattributed remainder.

Implemented: selected-part preparation during step 4; automatic generation after
tour process/machine edits; current checked development-to-production reuse;
compact CLI adjustment output; scratch-row material construction; and completion
rendering without a full source reload. The CLI listener can claim in its wait
call, and maker guidance prioritizes ordinary completion chat over bookkeeping.
Step 4 now explains preservation of saved copies and labels its keep route.
The viewport shows a spinner with actual stage percentages through generation
and loading, including printer-change generation. Notification errors no longer
mask the originating generation error.
Viewer labels also refresh when the printer, name or generation mode changes
without replacing the displayed motion buffers.

The same isolated Bambu export changed to production mode in **0.172 s**, with
identical bytes/hash and no toolpath approval. This measures a warm checked-source
transition, not a full cold opening. A same-process material comparison, with
before/after order reversed on the second pair, measured old construction at
18.835/23.080 s and new construction at 10.105/11.667 s: **48.1% lower mean**.
Machine load varied substantially, so these absolute durations are not a promise
of browser latency. Both versions retained all 799,015 moves and 240 material
groups. The earlier profiled baseline was 6.955 s for material construction;
do not compare it directly with the later contended run.

Verification: targeted program-cache, source-player, Studio opening, tour,
tour-UI, material, agent-request and reconnect checks passed after correcting
outdated completion expectations and a progress fixture. Coverage includes stale
bytes/recipes, geometry and final-review gates, worker retry, stage counts,
single-call request claim and identical material buffers across chunk boundaries.
Browser inspection of a separate audit print verified the centered loading card,
live percentage/progress bar and completed toolpath view. No second maker tour
has yet measured total interaction time, and these software checks establish no
physical printing result. Concurrent mesh/text work was preserved separately.

## 2026-09-14 — Shared CGAL mesh repair and larger STL handling

Nave requested replacement of the rejected repair implementation and removal of
its code and documentation. Shared core now owns exact cleanup, CGAL 6.2.1 patch
repair, explicitly bounded hole filling, shape-change reporting and source/output
validation. Smoothing is disabled. The retired implementation, its dependent
simplifier and their tests/instructions were removed at the user's request.
Current behavior is in the [geometry reference](core/geom/README.md#explicit-mesh-repair).

The supplied 8,220-face vase passes the shared file repair entry, exact STL
reimport and full-fill/planar-infill slicing. Cleanup removes 96 degenerate faces;
CGAL replaces 75 cleaned source faces with 27 faces, retaining 8,049 original
faces geometrically unchanged. Output has 8,076 faces. The measured file repair
trial took 2.891 seconds, including checks and serialization; its CGAL step took
0.472 seconds. Sampled distances reached 0.816 mm source-to-result and 0.622 mm
result-to-source. Samples include vertices and face centroids, and do not certify
a continuous error bound. The software slicing result contains 427,200 moves.
Temporary models and bundles were deleted; the supplied original was preserved
and the accepted review retained in RAM. This is not a physical print result.

The CGAL patch function is distinct from experimental self-union, which fails on
this vase. Local probing also found that snap-rounded autorefinement followed by
self-union retains that exception, while autorefinement followed by patch repair
fails validation. Those chains were not adopted as automatic fallbacks. Broader
exact Boolean repair remains a potential evaluation of established kernels,
including [libigl arrangements](https://libigl.github.io/tutorial/#boolean-operations-on-meshes),
not an implemented capability or a new deferred request.

STL paths now stream through import and repair, source hashing and output writing.
Validation uses packed edge incidence, an AABB hierarchy, compact cached normals
and fixed-size content hashes, with 32 MiB of retained derived cache data. A
configurable working-set estimate replaces the fixed face-count gate. Repair
runs off the caller's main thread. Accepted geometry is emitted in full-quality
chunks with stage percentages and consumer backpressure; native patch progress
is indeterminate. No Studio source was edited by this task. Indexed meshes,
CGAL and downstream bundle serialization still require memory; this does not
establish unlimited or fully disk-backed mesh handling.

Verification: focused tests exercise cleanup/stitching, a penetrating-fold repair,
unchanged remote facets, hole limits, orientation repair, timeout/cancellation,
shape-change rejection, source preservation, exact geometry chunks and S5/H2D
unapproved import. A 196,608-face ASCII fixture streamed, validated and sectioned
without simplification; its complete test took 10.75 seconds in the measured run.
Existing mesh slicing/lifecycle tests passed. Native compilation was tested on
Windows; a separate Linux CI workflow builds pinned CGAL before these tests.
Native repair has its own [build and license notice](core/geom/native/README.md).

## 2026-09-14 — Mesh compatibility, memory work and experiment boundary

Nave clarified in “Find permitted 3D model sources” (session
`01a0a26a-f0d5-7dc2-976f-bdc942252d21`) that production mesh import, repair, memory
handling and geometry progress are shared core work intended for remote
contribution. Test runners, downloaded evaluation dependencies, profiles, raw
research and reports remain ignored under `.local`. The scope audit found no
unresolved category ambiguity. Core has no runtime dependency on the experiment
directories. No publication was performed by this task.

Cura research examined pinned upstream development revisions on September 14.
[Uranium's STL reader](https://github.com/Ultimaker/Uranium/blob/94404148091d157b29ba080acd47b5949c9d0bb8/plugins/FileHandlers/STLReader/STLReader.py)
sets a 100-million-facet parsing ceiling; this is not a demonstrated memory
capacity. Its mesh arrays use compact NumPy storage. CuraEngine retains mesh
data during sectioning, releases mesh data after cross-sections, and advances
through a bounded layer-plan buffer; it is not wholly out-of-core. Relevant
sources are [mesh storage](https://github.com/Ultimaker/CuraEngine/blob/5abf5ec15b4d9f57b45a71401bd7d5f4fb1db20c/include/mesh.h),
[stage lifetime](https://github.com/Ultimaker/CuraEngine/blob/5abf5ec15b4d9f57b45a71401bd7d5f4fb1db20c/src/FffPolygonGenerator.cpp)
and [layer buffering](https://github.com/Ultimaker/CuraEngine/blob/5abf5ec15b4d9f57b45a71401bd7d5f4fb1db20c/include/LayerPlanBuffer.h).
The applicable direction is compact storage and deliberate intermediate lifetimes,
measured before increasing SAAM's limits. Raw source copies and revision manifests
remain in `.local/cura-research`; no upstream algorithm was ported by this audit.

## 2026-09-14 — Shared circular text and tour failure recovery

The participant requested a checkpoint before touring, then raised “groucho”
lettering on the fin and in a circle on the wavy roof. The initial full-circle
spacing was too wide; the participant accepted the closer upper arc and requested
that surface support be generalized into core. Local checkpoint `ec697ac` saved
all pre-tour non-ignored work. Subsequent development remains uncommitted.

Shared text layout now supports an explicit circular baseline alongside the
existing straight and Bezier layouts. A `top` reference reuses spline/mesh height
and normal queries in physical XY, replacing the example-specific sampled guide.
Existing UV and independent references remain supported. Public editable recipes
retain the original body, font and features. The same wavy-roof geometry was
rebuilt in `Prints/development/groucho-core-top` with the new concise recipe,
without altering the tour participant's geometry during playback.

The participant reported geometry remaining visible at the playback lesson,
missing dots/toolpaths, and a later reconnect failure. Toolpath lessons now select
the toolpath view before a program exists and show preparation status. Failed
transitions refresh the saved lesson before reporting the error, so later refreshes
do not erase it. Ready programs clear old preparation text. Explicit generation
failures queue the exact cause to the maker agent; guidance requires diagnosis
and appropriate corrections before regeneration, followed by visible verification.
Repeated identical failures for the same plan reuse the request.

The lettered roof's draped-skin generation failed on discontinuous glyph roofs.
The agent explained the switch to planar printing, generated its preview, then
applied the participant's concentric infill choice. A server running earlier code
initially rejected the new output as stale. Restarting without refreshing the page
also left obsolete session credentials, causing repeated acknowledgement failures.
Server instance identities now trigger a browser reload before new requests;
obsolete session tokens remain rejected. The live tour recovered after reload.

Verification: existing text tests plus analytical circle direction/arc-length and
spline-height/normal checks, mesh top references, and a public circular-lettering
regression all passed. The latter verifies deposition above an analytical wavy
roof for every letter of “groucho”. Studio tests cover pre-program tab selection,
ready seeking, retained errors, correlated failure requests, corrected generation,
actual browser polling after restart, changed server identities and old-token
rejection. An isolated browser also recovered automatically after a real
server restart, returning to usable controls without manual reload. The live concentric toolpath and the isolated core-top geometry were visually
inspected. The repository documentation check still reports unrelated backlog
status and missing backlog-anchor issues; the text manual’s existing underside
anchor is preserved. No physical print result
or manufacturing approval was supplied by the agent.

## 2026-09-14 — Prompt tour updates, listener delivery and completion panel

The participant reported stationary dots/highlights, late geometry unlocking and
chat messages, a missed infill request, early toolpath loading, and one transient
saved-print load failure. Selected simple bold tour copy for every lesson and
requested a finished panel plus prompt chat congratulations, printing help and
a next-project invitation. These changes preserve the Studio-first introduction.

Removed the reduced-motion rule that disabled these two animations; both now use
opacity/color changes without movement. Tour highlights use a simple slate-blue
outline. Library file events notify Studio immediately, with polling retained as
fallback. The geometry-edit gate opens on the exact rendered update, independently
of the agent's later acknowledgement. Toolpath state, decoding and speculative
generation stay absent until the optional STL lesson is completed. Import-layer
requests are queued after generation, so the requested toolpath exists when the
agent receives them. Reads spanning plan/geometry replacement retry briefly;
persistent validation errors still fail. The participant's original one-off load
error did not reproduce during this check.

MCP begin/respond/wait calls no longer wait behind other tool calls. Pending
Studio requests produce standard MCP logging notifications and appear in ordinary
object-valued tool results, supplementing the authoritative wait/list endpoint.
Guidance requires begin-work before acknowledgement and sends edit responses in
commentary before waiting. CLI guidance now explains that a returned running
session ID must be followed until its JSON event arrives; starting a background
listener and ending the turn loses that delivery. Notifications cannot guarantee
that an ended host turn wakes. Completion guidance explicitly offers help with
difficulties printing the downloaded file. The panel shows congratulations and
invites the next project; stale lesson-status text clears on transition.

Targeted tests covered nonblocking waits/status updates, pushed MCP notifications,
independent disk writers (51 ms in the notification test), geometry unlocking with
an outstanding request, both STL-lesson exits, preserved approval/export behavior,
transient-read retry and completion guidance. Browser inspection confirmed changing
dot opacity, active outline blinking, uniform bold copy, geometry-only step 4,
toolpath after Next, and the finished panel. Isolated test prints were removed;
the live Studio was refreshed with the participant's completed tour preserved.
These checks establish software behavior, not physical printing results.

## 2026-09-14 — STL flow, geometry selection and agent connection closure

The participant approved the panel expansion/hiding and tour locks, replaced the
STL units popup with a size-based assumption across ordinary and tour imports,
and clarified that selecting the print is geometry confirmation before toolpath.
The shared importer now records assumed units and supports later correction of
plain imported meshes without losing mesh edits or settings. [D-030](DECISIONS.md#d-030--provisional-stl-units-assumption)
records the deliberately provisional policy. Studio records the chosen geometry
before preparing its tour toolpath; final export confirms settings/toolpath.
Normal fresh imports remain in geometry review.

The participant kept the ten-minute request timeout and requested a connection
close handler. MCP ownership follows requests created or claimed by that adapter
and requests queued by its Studio servers. Transport close fails its unfinished
requests and pushes a viewer event before server shutdown. The indicator replaces
dots with italic “(connection closed)” or “(request timed out)”; other active
requests retain dots. The client also evaluates cached expiry if polling fails.
An ended chat turn need not close MCP, and abrupt process death may skip cleanup.

Targeted request/tour, STL, MCP and Studio open/lifetime checks passed, including
an actual SDK transport close with independent outstanding work and an SSE viewer.
Two test expectations were corrected during verification: floating-point scaling
uses a tolerance, and the EventSource stub now supports event listeners. An
isolated browser showed the italic close message replacing dots beside the logo
before its server disappeared. Test bundles were removed. Studio was restarted
on its existing port and refreshed at lesson 1 with progress preserved and no
unsolicited maker-chat prompt. These are software checks, not physical prints.

## 2026-09-14 — Preserve Studio-first tour guidance

The participant corrected the unsolicited first-task chat prompt: the tour's
early guidance belongs in Studio, with proactive chat teaching introduced later
at the designated infill lesson. Removed the first-task invitation and post-import
Play invitation from agent guidance, and distinguished silent start-layer
preparation from chat teaching in the maker, tour and MCP instructions. The tour
was not advanced or restarted during this audit. Other discretionary flow choices
were disclosed for review rather than changed as part of this correction.

## 2026-09-14 — Stitch collapsed-face seams during mesh cleanup

The disposable Thingi10K test exposed incomplete cleanup: removing four collinear
triangles from file 63535 left one long edge opposite five shorter edges. Cleanup
now splits the surviving face at existing vertices when a complete, oppositely
directed collinear boundary chain is available. This retains coordinates and
winding. Shared Studio files were not edited.

All 12 mesh-repair tests passed, including a subdivided tetrahedron with unchanged
analytical volume, rotated/translated coordinates, source preservation,
idempotence, public repair/reimport and rejection of an actual missing face.
Thingi10K 63535 then repaired and sliced successfully: four collapsed faces
removed, one edge stitched, four triangles added, 1680 output triangles, unchanged
bounds and zero sampled vertex distance in both directions. Its checked toolpath
was opened through the local in-memory Studio inspection adapter; downloaded and
generated files were deleted. This is software evidence, not a physical print.

## 2026-09-14 — Tour feedback, STL lesson and agent coordination

Completed BR-046 after the participant explicitly released the earlier deferral
in task 01a0a19d-25eb-7fa3-9e55-d1b97ee544fc (exact title unavailable; participant
addressed as Nave, contributor account unconfirmed). The pass requested flashing
highlights, recognizable filenames, immediate advancement on file selection,
automatic maker guidance and Next remaining locked until updated output is shown.
Later messages added global dots beside the logo, an optional STL lesson, eight
different copy treatments, and required downloading to complete the tour.

Studio now uses eight lessons. Existing seven-lesson progress migrates without
discarding edits. Print selection advances directly to optional STL import;
Next retains the selected part, while importing a valid model advances to
playback and requests an explicit infill layer from the maker agent. The ordinary
Import STL button uses the shared importer, explicit units and retained source
bytes, opening unapproved geometry. UI names and downloads describe the part.

Edit gates require an acknowledgement of the current rendered revision/export;
outstanding agent requests also keep them locked. Correlated persistent requests
cover ordinary Studio work and tour events, with bounded MCP/CLI waits and
ten-minute leases. Only three animated dots appear beside the logo while requests
are pending. Maker guidance requires immediate begin/claim and matching response,
and active waits between lessons. The transport reaches an active connected
agent; no idle-host wakeup or disconnected-chat delivery is claimed.

The final confirmation prepares production output, checks it against the displayed
export, downloads the same bytes and completes the tour. There is no Finish tour
button; Exit restores normal controls without completion. A browser test exposed
a worker-cloning failure when approvals changed but source bytes did not; rebinding
now uses the fresh source metadata before reusing the decoded move store.

Software evidence: targeted Studio tour/request and MCP integration checks passed,
including ordinary overlapping requests, import success/failure and units, both
import-lesson routes, stale preview rejection and exact-byte tour export. Browser
checks used an isolated synthetic handle for file selection, five seconds of
playback, guidance dots, generated gyroid/four-wall update, printer/material and
download completion. These are software checks, not physical print evidence.
Repository documentation validation also reported pre-existing missing backlog
anchors and an unrelated BR-045 status-format issue; these were not changed here.
The edge-selection follow-up was held until the next pass was launched, then
completed as recorded below.

## 2026-09-14 — Edge names after launching the next tour pass

Completed BR-047 after its explicit deferral condition was met: the new eight-step
tour was opened on its first lesson at the same Studio URL before implementation.
The participant (addressed as Nave, account unconfirmed) requested “edge select in
the geometry preview, like the current surface select ... (to see names)” in task
01a0a19d-25eb-7fa3-9e55-d1b97ee544fc; exact task title unavailable.

Geometry preview now picks visible boundaries/creases within six screen pixels,
highlights the chosen edge in orange and shows adjacent feature names plus its
edge number. Surface-interior picking is preserved. Chains join curved rims but
split at junctions; hidden edges, holes and triangulation diagonals do not become
false hits. These are revision-scoped display identifiers; no source geometry or
manufacturing approvals changed. Eleven geometry/visibility tests passed, and
the live tour handle showed “Fin/front / Fin/top · edge 1” with its orange highlight.

## 2026-09-14 — Combined confirmation and interactive maker tour

The user expanded the Studio/tour scope in this task: remove standalone settings
confirmation and teach geometry edits, saved-print switching, playback, chat-led
toolpath changes, printer/material choices and export.

- Studio now has geometry confirmation followed by a combined settings/toolpath
  confirmation. The latter binds both hashes in one human event and preserves
  the existing persisted plan fields for compatibility. Full settings are
  expandable in toolpath view. Production generation requires geometry approval;
  delivery retains exact-export approval and byte-identity checks.
- Added a raised-fin starter and seven lessons with geometry, file-selection,
  five-second visible-playback and settings-change gates. Agent-selected sparse
  infill start positions leave the speed and timeline controls free. Exit and
  finish restore normal controls; edits and saved copies survive navigation.
- Added tour progress/chat instructions, bounded MCP progress waiting, explicit
  start-layer control and printer changes through shared tools. Maker guidance
  now establishes known last-used printer/material choices, or asks when unknown,
  before toolpath view, and retains chat adjustments afterward. Completion
  guidance asks the maker agent to congratulate the participant and invite her
  next creation. Export guidance explains USB transfer directly to the printer.
- Verified workflow, cache, Studio opening, MCP, tour gates and affected machine/
  skill lifecycle tests. Updated obsolete three-confirmation test expectations;
  focused reruns passed. Walked all seven lessons in an isolated browser tour,
  including edited-copy selection, layer-13 infill start, free scrubbing/speed,
  playback unlock, changed infill, printer highlight, export and completion.
  Restarted the user's tour at the unchanged starter with Next locked.
- The repository documentation checker reported concurrent backlog status/link
  issues (BR-005, BR-018, BR-023, BR-039 and BR-045), outside this tour change.
  No manufacturing approval or hardware action was performed.

## 2026-09-14 — Large wavy canopy on all four box sides

`remettub`, in “Add wave overhang spline skill”
(`01a0a191-8027-7f13-bf42-7b88316cc5ed`), requested a much bigger wavy spline
surface projecting beyond all four sides of the box.

- Added the reproducible `canopy-example.mjs` recipe: a C2 bicubic surface
  with a 24 mm flat seed aligned with the top perimeter centerline of a
  24.4 × 24.4 × 10 mm box. Its rounded outline follows about 33 mm of surface
  growth on every side. The manual links the preparation and preview commands.
- The larger example exposed thin residual strips from constrained polygon
  construction at the rim. Terminal handling now tests whole-residual
  containment in a small expansion of reached material, scaled by sampled
  native derivatives and the existing physical tolerance, before extracting
  another front. Residuals stay explicit; this does not add deposition or relax
  the single-pass requirement. Earlier fixed-grid and sub-tolerance closures
  passed a small fixture but failed the full placed example and were replaced.
- Verification: 12 focused wave and public-workflow checks passed, including
  a canopy-rim regression at original and translated coordinates. The actual
  `Prints/wave-overhangs-four-sided-20260914` bundle generated in 57.6 seconds:
  110 fronts in one pass, 34,665 interpreted wave movements, all extruding,
  with no internal rapid move or dwell. Its wave extent is 89.78 × 89.79 mm,
  Z=8.334–11.666 mm. The report retains 129 thin residual regions with a
  derivative-scaled UV band of 0.0000412924; their long diameters are not
  mislabeled as sub-tolerance lengths. Inspected partial/live playback and the
  completed canopy in Studio with travel visible. This remains a development preview,
  without physical printing evidence or manufacturing approval.

## 2026-09-14 — Wave continuity correction; hole case remains incomplete

`remettub`, in “Add wave overhang spline skill”
(`01a0a191-8027-7f13-bf42-7b88316cc5ed`), reported broken loops and travels and
required unbroken continuous passes per layer. The user then supplied
[Janis Andersons's short](https://www.youtube.com/shorts/RxPW5A4__X4) and clarified
that the perpendicular glue jogs came from SAAM, not a requested exemplar.

- Removed coincident-outline clipping that discarded front segments, and removed
  stationary perimeter tails from the extrusion paths. Constrained offset
  cleanup now uses Clipper2 simplification with native derivative scaling,
  preserves boundary contacts, treats small boundary-tangent drift, samples
  obstacle tangents and refines boundary interactions more closely. Collapsed
  contours remain as explicit sampled-width diagnostics rather than bead loops.
- Accepted slices use one atomic operation/stroke with short in-domain surface
  turns. Travel, retract and cooling are absent between their fronts. Separate
  passes cause a generation error; the earlier hole recipe is now refused.
- Inspected the supplied short's visible frames and linked explanation/description,
  and the slicer fork's settings/traversal source. Its Zig Zag mode permits branch
  restarts. No special glue-jog method or universal single-pass guarantee was
  established. No research/slicer source or asset was copied into SAAM. The
  published paper and dataset version 2 were located; full paper text and video
  transcript remained unavailable.
- Verification: 33 selected wave, public workflow, surface-offset and shared
  boolean/offset checks passed. The export continuity assertion also passed
  after strengthening it to inspect actual G-code lines. The new local
  `Prints/wave-overhangs-continuous-20260914` diagnostic example intentionally has
  no hole: 16 fronts, one operation, 271 interpreted wave movements, all extruding.
  Generation took about 1.2 seconds locally. Studio partial and live playback
  were inspected with travel visible. No physical print or approval occurred.
- The original hole recipe is preserved and fails with five required passes.
  Matching reference-style branch restarts versus enforcing a whole-slice
  continuous path remains a pending human clarification. Whole-slice continuity
  remains enforced; no exception is inferred. The new example does not establish
  completion of the requested hole capability; see BR-045 in
  [outstanding work](build_request.md#outstanding-work).

## 2026-09-14 — Tour continuity and a stronger opening roof

- Applied the collected tour feedback: wavy roof, Nudge Cup, then DENSO;
  sequential Next/Back navigation; personal-print choices after completion.
- Separated tour membership from packaged-preview validity. Chat adjustments
  retain the current step and edited copy across navigation and reopening.
  Changed toolpaths use the shared generation worker in development mode,
  without granting human approvals.
- Replaced the opening roof with a 100 × 60 mm wave surface and a 6 mm fall
  toward one edge. Generated and packaged its current source and display.
  The generation check reports a 14.574° maximum roof slope and zero excluded
  roof area; drainage and physical printing remain untested.
- Eight focused checks cover navigation, finish gating, edit persistence,
  development generation after edits, cache handling and downhill roof geometry.
  Inspected the restarted first screen with its disabled early-exit controls.

## 2026-09-14 — Wave overhangs on bivariate spline slices

- Contributor: `remettub`, explicitly identified in this conversation.
- Authorization: human requested — identify the wave-overhang technique seen in
  a YouTube short, check applicable licenses, and build it generalized to SAAM's
  bivariate spline slices. Clarification explicitly selected curved spline
  surfaces with flat slices as a special case.
- Session: “Add wave overhang spline skill”
  (`01a0a191-8027-7f13-bf42-7b88316cc5ed`).
- Source: current conversation, 2026-09-14: “We need that capability, but
  generalized to our bivariate spline slices … then build that skill”. The
  user also reported X-wise artifacts during playback and confirmed Grasshopper
  is available as an optional reference host; no Grasshopper execution was needed.
- Context: match the published laterally attached expanding-wave technique,
  retaining native spline geometry and the existing review/delivery workflow.
- Implementation: [wave-overhangs](skills/wave-overhangs/SKILL.md) uses original
  SAAM constrained geodesic growth, explicit seeds and component dependencies,
  shared operations/export and catalog/Studio integration. The research dataset
  is CC BY 4.0; the Prusa/Orca integrations are AGPL-3.0. No third-party algorithm
  source or research assets were incorporated. Provenance and numerical limits
  are at the [implementation owner](skills/wave-overhangs/BUILDER.md).
- Software evidence: physical-spacing checks on inclined/rescaled planes and
  an independently unrolled rational cylinder; doubly curved native surface,
  hole splitting/rejoining, disconnected seeds, budgets, component/slice ordering,
  shared export and public CLI/MCP-manual/Studio settings checks. All 49 selected
  numerical, pipeline, workflow, ordering and Studio checks passed across the
  relevant runs. The skill validator and catalog/manual digest check also passed.
- Playback correction: tiny rounded E increments divided by very short Y moves
  produced spurious X-wise bead widths (one 0.00001 mm move displayed as a
  31.897 mm bead). Wave output has no retained across-path surface normal, so
  Studio uses its existing curved-surface centerline display. The machine program
  is unchanged by this display fix; partial and live browser playback were checked.
- Reproducible development example: a 5 × 5 × 1 mm box anchors a saddle surface
  extending 5 mm around a hole. With 0.3 mm front/propagation spacing it generated
  18 fronts, 2719 sampled points and 249425 surface evaluations; its two retained
  corner residuals have a maximum sampled diameter of 0.005647 mm. Local public
  bundle generation took approximately 2.7 seconds in this session. The finer
  0.1 mm propagation experiment exhausted the 2000000-evaluation budget; this is
  recorded performance behavior, not evidence that finer settings always cost more.
- Physical evidence: none. The local preview is unapproved development output;
  no printer execution, job approval, checkpoint or publication is implied.

## 2026-09-14 — Build-request provenance audit

Follow-up correction from `remettub` in the same conversation: the initial guidance
caused agents to ask for contributor identity during ordinary builds and appeared
to require creating a request for each task. Removed the instruction to ask for
identity and the extension of backlog metadata requirements to ordinary devlog
entries. Current work proceeds directly; the queue preserves deferred/incomplete
work beyond the active task or explicitly requested backlog entries. Missing
metadata remains labeled without prompting or historical investigation during
ordinary work. The provenance audit below records the earlier findings; its
unresolved attribution does not require other tasks to ask the user again.

- Contributor: `remettub`, explicitly confirmed in this conversation.
- Authorization: human requested — recover contributor accounts, session titles
  and originating context for existing requests; check completion/applicability;
  require explicit human requests or human-approved agent proposals going forward.
- Session: “Audit build request provenance”
  (`01a0a188-d7e2-7020-8927-966a5cc4c146`).
- Source: current request, 2026-09-14: “We need provenance for all build requests”
  and “All build requests should be explicit human requested or agent proposed and
  human approved”. This authorizes the audit and guidance, not the underlying work.
- Context: The queue contained eight remainders whose generic “user” attribution
  and links to checkpoint records obscured who requested them and whether later
  acceptance work had actually been commissioned.

Reviewed the eight entries at `d686269`, their introducing/history commits, current
owning sources and available local Codex conversations from September 8–14.
Recovered human messages from primary sessions, including archived continuations;
subagent prompts were not used as human authorization. Session titles are the
exact titles in the local session index as observed on the audit date; they can
have been renamed since the original request. UTC timestamps below come from the
message records, and can fall on the day after an older local-date devlog entry.
This was a documentation/status audit, with no new printing, benchmark or live
Claude Code experiment. Private transcripts remain local and untracked.

Account attribution is the remaining evidence gap. “SAAM reset”
(`01a08244-f5ff-79b2-a3ab-869b8a2fd04b`), at 2026-09-08T20:07:35Z and its
20:25:19Z continuation, explicitly says “tkeller, and remettub (us)”. That
establishes `remettub` for that session. This audit's speaker also confirmed
`remettub`. The other originating sessions do not explicitly name their speaker;
same-computer continuity and Evan Buttemer/remettub Git authorship suggest an
attribution but do not confirm it. Their Contributor fields remain unconfirmed
pending the requested historical-account clarification. `tkeller` being the author
of an old material-library concept does not identify the human approving BR-044.

| Prior request | Disposition and evidence |
|---|---|
| BR-005 | Narrowed to the explicitly requested S5 wedge print. “Build Ultimaker S5 wedge demo” and “Fix S5 export and wedge extrusion” contain direct implementation/print requests; the source excerpts and IDs are in the surviving request. Software and partial physical reports exist, but no recovered complete outcome for the corrected startup. The broader evaluation extends the agent's first-proof recommendation in “SAAM reset” and the comparative proposal preserved by `e87477a`; no explicit approval of a novice/comparative study was recovered. It remains a labeled proposal, outside this request. |
| BR-018 | Retained. Human requested H2D support, reported layer-two over-extrusion, then said to remove H10 and try that revision. The current Bambu contract still uses v2 and calls for physical testing. No corrected physical result or independent program-viewer acceptance was recovered; model-import rejection is a different check. |
| BR-023 | Retained with later partial evidence. “Benchmark spline slicing speed” explicitly requested Cura/Bambu and Studio comparisons. “Speed up studio confirmations” later records a human Cura result of 7.2 seconds and agent-reported SAAM timings, but no recovered controlled Bambu comparison or full matching profiles/repeats across clients. |
| BR-034 | Retained as unfinished acceptance of approved implementation. In “Scope agent Studio permissions”, the agent proposed repository launcher rules at 2026-09-10T16:26:59Z; the human approved and added Claude at 16:27:53Z. The implementation report states that Claude Code was absent. No later live Claude permission result was recovered. This does not expand into a new permission feature. |
| BR-039 | Retained. The human explicitly requested the 10–12 second target and cross-skill validation cleanup, then renewed the speed overhaul. Later measurements still miss that target. Current `generatePath` in core/print/generate.mjs and skills/wedge-demo/scripts/path.mjs calls plan validation; `translateShell` rebuilds via `makeShell`, which computes closure; surfaceRegion and plan validation (through validateCladding) both call validateSurfaceSelection. These observations support rechecking those boundaries; they do not prove each call is unnecessary. |
| BR-040 | Removed from the queue: the requested audit and guidance were delivered. The former queue entry converted the agent's remaining priorities into a blanket obligation to resolve every finding; no approval for that expanded program was recovered. Findings remain in the original BR-040 history as proposals for consideration within future authorized work. Specific speed/validation fixes remain covered by BR-039's own human instructions. |
| BR-043 | Diagnosis/research completed in the originating conversation; the “file unidentified” remainder was stale. The requested startup-retraction software fix was also implemented. Missing physical confirmation is retained once under BR-005; it does not reopen the diagnosis or authorize firmware modification. See the recovered BR-043 record below. |
| BR-044 | Retained with its explicit deferral. The human committed to a future material-library port while withdrawing four contributions; the request approves selective conceptual adoption, not restoring the previous implementation. No port is present in the shared scope reviewed here. |

BR-040 source: contributor unconfirmed; session “Repair mesh for Bambu print”
(`01a08f18-9d61-7d90-b3c0-2c9088c6cefc`), 2026-09-11T07:38:28Z:
“We need another audit agent looking for inappropriate or mismatched precision
issues project wide” and “and guidance so it doesn't happen again”. This arose
while diagnosing the repaired vase mesh's slicing latency. The
[original audit](#br-040--dimension-aware-precision-audit-and-developer-guidance)
records findings, guidance, corrections and verification. Removing the expanded
request does not claim every numerical issue is fixed or justified.

The later “Speed up studio confirmations” record, at 2026-09-12T00:06:49Z,
reports 25.8→17.0 seconds for generation plus checked export of the repaired mesh,
about 23.5 seconds after an immediate Generate click, and about 1.3 seconds when
preparation had already finished during review. The human's 7.2-second Cura result
is at 2026-09-11T23:15:41Z. Output move counts and precision changed during that
work; these are historical task-reported results, not newly reproduced timings,
unchanged-setting comparisons or proof of the 10–12 second target. The queue's
earlier Clipper2-only context was incomplete.

Guidance now requires Contributor, Authorization, Session, Source and explanatory
Context in addition to status/remainder/completion. Completed or removed records
retain provenance and disposition. The existing optional repository checker checks
field presence and authorization vocabulary; it cannot verify human identity,
approval scope or factual completion.

Verification: the repository checker passed for 61 documents and 703 local links;
whitespace checks passed. Targeted checker probes rejected missing provenance
fields and an unapproved agent proposal while accepting the revised queue. No
manufacturing regression suite was needed for these documentation/metadata edits.

## BR-043 — S5 startup diagnosis

- Work date: 2026-09-10 for the file investigation and firmware research; recovered
  and removed from the queue on 2026-09-14. The startup retraction fix was separately
  requested at 2026-09-11T04:50:40Z.
- Contributor: Unconfirmed; neither source session explicitly names its speaker.
- Authorization: human requested — investigate observed S5 startup, verify the USB
  export, research skipping bed leveling, and fix startup retraction. No printer
  firmware modification was authorized or performed in the recovered record.
- Session: “Remove bed leveling startup”
  (`01a08c8f-9e65-71c0-8712-c73f53c0f5be`); retraction follow-up in
  “Review full repository code” (`01a08eb4-4fa4-7dc0-bfff-827d989d6192`).
- Source: 2026-09-10T18:34:07Z requests verification of `flange.gcode` on USB;
  18:45:51Z: “Confirmed that we are still doing bed leveling, even with that exact
  file you just verified.” The 18:46:46Z reply clarifies “skip bed leveling”.
- Context: Observed S5 startup contradicted the agent's inference that omitting
  explicit leveling commands would skip leveling.
- Result: At 18:35:51Z the agent reported `D:\flange.gcode` byte-identical to the
  local `pipe-flange-five-bolt-taller` export, with S5 profile revision 5 header,
  startup and shutdown, Griffin 4.4.0 compatibility, right nozzle at 215°C and bed
  at 60°C, and no explicit leveling/unused-heater commands. The human then confirmed
  leveling with that checked file. This is recovered task evidence; the file was
  not freshly read during this audit.
- Research result: At 18:48:01Z the agent corrected its earlier inference, citing
  the S5 manual's automatic active leveling. It reported an UltiTuner firmware-side
  option, with compatibility limitations and no verified per-file bypass. That
  completed the requested research; no installation, firmware change or successful
  bypass is claimed. The agent asked for firmware information and no further
  response was recovered in that session.
- Disposition: Remove stale BR-043 diagnosis from the queue. The shared first-move
  recovery correction is implemented as described in the
  [S5 observations](#2026-09-08-to-2026-09-10--s5-startup-observations);
  its unreported physical outcome is part of the
  [S5 print record](#br-005--first-complete-print).

## 2026-09-14 — Ready examples and guided Studio tour

Built the tour in SAAM_tkeller. The normal bare Studio launcher opens packaged
examples, saves copies in ignored Prints/tour, and remembers tour progress. Nine
steps cover the user’s selected rolling-hills bivariate roof, wavy DENSO cladding
and Nudge Cup. The welcome and first step explain that the agent operates SAAM
while the person guides the design through conversation and reviews the result.

Prepared snapshots and display caches use the existing source interpreter,
material renderer and machine presentation. Opening a demo needs no slicing or
extraction command. Geometry appears before the saved toolpath finishes loading.
Reference previews grant no manufacturing approvals; source/delivery and review
mutations require returning to the ordinary workflow. Changed copies use live
validation, and revisiting the tour preserves them by creating a fresh example.

Verified all nine steps in the browser, including settings without approval,
playback, DENSO Machine view, completion and reopening saved examples. Focused
tour, source-player, Studio opening and instance-lifetime checks passed 22 tests.
These are software previews, not physical print or calibration evidence.
Runtime packaging remains on the separate first-run-bundle branch.

## 2026-09-14 — Remove voxel authoring and experimental web connections

Applied the user's revised scope: removed voxel field authoring, refinement,
extraction, geometry records, CLI/MCP entry points and Studio-specific labels,
plus their dedicated tests and manuals. Removed the experimental HTTP/OAuth
bridge, tunnel launcher, Claude web-plugin packager and web-runtime probes,
including their tests, setup guidance and deferred acceptance request BR-026.
Historical records remain; the removed field manual's historical link points to
its unchanged source commit.

Text, specialized rimming, Gridfinity, ordinary stdio MCP and local-extension
hooks remain. Manifold and fontkit remain required by retained text/Gridfinity
work. Removed the direct Express dependency and refreshed the lockfile offline;
Express remains transitively required by the MCP SDK. Removed the solid helper
whose only production consumer was voxel extraction.

Verification: the complete ordinary suite passed all 425 tests with no failures
or skips in 91.8 seconds, including retained text, rimming and Gridfinity coverage.
Repository checks passed for 61 documents, 695 local links and 29 decisions; the
whitespace check passed. Existing voxel geometry is no longer a supported input;
use supported mesh geometry for further slicing. These checks establish software
behavior, not physical print success. No Git staging, commit or push was performed.

## 2026-09-14 — Remove Splitty and add three shared demos

At the user's request, removed the remaining Splitty model/profile, variants,
research lab, simulation dialect, npm launchers and associated coverage. Removed
the lab's separate Dobot viewer as explicitly requested: Studio remains the single
viewer for S5, H2D, Dobot and DENSO. Generic machine-study creation, source playback,
manual posing and the newer Euler-interpolation test remain. Adapted the fixed-rail
regression to the S5 instead of deleting that generic check.

Added the surface-drape, wavy-DENSO and Nudge Cup recipes, creation command and
individual guides, with discovery from README, maker/developer guidance and the
relevant skill manuals. Generated all three as unapproved development workspaces
under Prints/tour. The command refuses existing destinations. No private setup,
saved approvals or experimental-fork changes were copied.

Verification: all 27 selected tests passed across machine presentation, studies,
Studio kinematics, jogging, Dobot kinematics/playback and demo lifecycle. All three
demo generations passed. Repository checks passed for 64 documents, 733 local links
and 29 decision records; the whitespace check passed. An active-source scan found
no remaining Splitty registration, dialect, launch command or separate machine
viewer. These are software checks, not physical print results.

Preserved the existing SETUP.md withdrawal and DEVLOG edits, current source-time
behavior, thick-lip finishing, branding and layer controls. The broader feature
reduction remains pending user review; other skills and bridge interfaces are
unchanged. No manufacturing approval, Git staging, commit or push was performed.

## 2026-09-14 — Withdraw Windows setup guidance

Removed the Windows checkout ownership section from SETUP.md at the user's
request. The local permission repair remains in place; its historical record
below is retained. No software behavior changed.

## 2026-09-14 — Remove obsolete root files

Removed `CONTRIBUTORS.txt` and `sotvl_Spiral-Vase_repaired.stl` at the user's
request. A checkout search found no references to either filename. Current
contributor guidance remains in DEVELOP.md and CONTRIBUTING-AGENTS.md. No
software tests were needed for removing these unreferenced files.

## 2026-09-14 — Windows checkout ownership recovery

Diagnosed shell and Node REPL startup failures in a copied Windows checkout.
The Codex sandbox log showed `SetNamedSecurityInfoW` error 5 while applying a
protective deny access rule to `.git`; its owner was `CodexSandboxOffline`.
Git also rejected the checkout as owned by another account. The system and
bundled Node executables ran successfully outside the sandbox.

Restored the user's ownership of `.git` and its contents and granted that user
Full Control through an administrator-approved repair, preserving existing
access rules. Ownership repair processed 124 entries without failures. Normal
sandboxed shell execution and a minimal Node REPL call then succeeded; Git
status also succeeded under the user's account. Added prevention and diagnostic
guidance to SETUP.md. No source, remote, or runtime installation change was
needed, and no application regression tests were run for this permissions and
documentation work.

## 2026-09-14 — Remove private machine integration

Removed the private machine profile, model, study tools, associated coverage and
documentation from the shared project at the user's request. Studio retains the
shared machine viewer and supported public-machine studies.

Verification: checkout setup passed. All 27 selected tests pass across machine
presentation, constrained jogging, study transport, Studio kinematics and source
playback. Repository checks passed for 61 documents, 724 local links and 29
decision records. A current-tree scan found no remaining private-machine names
or mechanism-specific references. Git history is unchanged.

## 2026-09-13 — Publication review before fork transition

Reconciled GitHub's PR #4 merge through local merge `f4ea2d8`; its tree and
the existing uncommitted diff were unchanged. Reused the focused verification
recorded below; the whitespace diff check passed without another software run.
The user requested publication before creating a fork. Review observations
remain unresolved: tracked .NET build artifacts in `scripts/bench/obj/`, an
apparently unreferenced repaired STL at the root.

At the user's subsequent request, `npm test` passed all 465 ordinary software
tests in 72 seconds with no failures or skips. Stress tests remain separate.

## 2026-09-13 — Human contributor rules and agent guidance placement

At the user's direction in the contributor-guidance conversation, CONTRIBUTING
became human-facing and left the default agent reading path. Setup and test
references moved to focused owners. DEVELOP retained the during-work context,
selective-adoption, shared-edit, durable-knowledge and anti-check-spiral rules;
checkpoint and remote guidance moved to CONTRIBUTING-AGENTS for reading at that
stage. Blanket preliminary checkpoints, an assumed Git coordinator and mandatory
human PR review were removed. Existing authorization remained applicable.

The user's follow-up established whole-checkout commits as the default for an
authorized checkpoint: all non-ignored work, including concurrent contributions
and unfinished increments, unless explicitly excluded. Recording shared state
did not establish completion, review or selective-adoption approval.

The user also distinguished local checkpoints from remote publication: the
pre-push guidance favored a complete result at the outgoing branch head while
allowing intentional work-in-progress pushes with their purpose and remaining
work stated. This added no hard gate, approval requirement or verification pass.

The verification wording reused valid evidence instead of triggering new checks
at publication or from skill manuals. The repository document check passed for
60 documents, 725 local links and 29 decision records, including open requests
and skill metadata. This guidance edit changed no software behavior and ran no
software tests; concurrent implementation work retained its own work records.

## 2026-09-13 — Retain the assembly during manual pose requests

Fixed manual-slider blinking by retaining the last complete model pose at the
frozen source time while a new worker request is pending or unsuccessful. The
exact request cache remains separate, so drawing the retained assembly does not
suppress the new solve or claim its requested coordinates were reached. Source
and model changes clear the retained state. The focused Studio kinematics checks
pass, including retained geometry during a pending request and disposal cleanup.

The user clarified that used rail length belongs to the machine definition and
slider spans should cover the machine's motion independently of the source.
Removed source-dependent rail cropping and its snapshot field. The existing
working rail endpoints now drive both geometry and limits. Slider spans derive
conservative bounds from mechanism dimensions and installation transforms.

Implemented local constrained jogging: prioritize the selected coordinate,
project corrections against model-owned signed boundary margins, and stop at a
valid local boundary. Returned slider values follow the accepted pose. Splitty
and Dobot expose their existing numeric limits. DENSO uses nominal wrist reach plus its seeded IK
acceptance. Cartesian sliders enforce axis travel, with the bed rail geometry
aligned to that travel. Missing physical socket/collision limits remain missing.
This does not claim global reach optimization or hardware motion validation.

Regression evidence includes analytical curved-boundary coupling, fixed rails
independent of source, source/override cache separation and Cartesian end stops.

## 2026-09-13 — Manual machine positioning and used rail travel

Added model-owned tool-position controls to Studio Machine view: XYZ for all
aligned models, Dobot yaw and Splitty/DENSO Euler
orientation. Slider input pauses playback and invokes the same model solver in
the source worker. Manual/source requests have distinct cache identity; obsolete
requests cannot replace the displayed pose. Play, seeking, return-to-playback,
mode/stage/source changes and movie export clear temporary manual posing.
No source bytes, job approvals or hardware commands are changed.

Rails now display sampled source carriage travel plus the exact current pose,
with 10 mm end clearance. Optional normalized line spans crop the existing
primitive geometry; rods retain their configured lengths. Source sampling is
bounded, is only for display, and retains no viewing-history dependency.
Machine fit uses the cropped assembly.

Focused provider, study, session/renderer and movie checks pass. Regressions
cover manual source preservation, model control sets, manual/source cache
separation, rail cropping/extension/reset and fixed rod length. This is software
simulation evidence, not hardware motion validation.

## 2026-09-13 — Studio machine ghost and Machine view

Implemented the complete Studio consumer of the [v1 presentation contract](studio/KINEMATICS.md):
simple links, rails, carriages, joints, bed and tool; neutral ghost composition;
Machine view with independent saved camera; shared reference-frame transforms;
worker sampling, unavailable-model fallback, stale-response rejection and movie
parity. Existing material geometry, operation colors and part-fit detail remain
the baseline. Provider geometry and kinematic equations remain in the separate
shared-model implementation. This work followed the updated AGENTS/D-029 context
boundary and fresh Studio sessions.

Verification: 31 selected tests pass across Studio kinematics, cameras, material,
movie export and source transport. These cover nonzero-placement/moving-bed
contact, invalid/stale/partial poses, worker failure/disposal, camera restoration,
projected machine fitting and asynchronous pose-before-video capture. Fresh
browser inspection covers the actual 8,343-move development S5 wedge, DENSO
study, and 48,430-move development pipe. No manufacturing approvals were created.

Paired browser measurements at 848 × 404 compare real WebGL material rendering,
Canvas composition and a forced pixel readback, with 60 frame pairs after 10
warmups and alternating order. Wedge baseline/ghost median: 5.3/6.1 ms; p95:
10.3/9.5 ms. Pipe baseline/ghost median: 4.5/5.2 ms; p95: 6.2/6.5 ms. These
measure drawing at source time 1190 with varying orbit, excluding source decode
and worker transport; they are not end-to-end interactive FPS guarantees. No
toolpath simplification or detail reduction was added. The ignored local harness
and screenshots are under `.local/studio-machine-presentation/`. Repository
document/link checks pass. Model poses and previews remain nominal software
evidence; collision, installation calibration and physical results are unverified.

## 2026-09-13 — Shared machine providers and mechanism studies

The user authorized implementation after the contract review and minimal-core
guidance and requested a checkpoint. Commit
`cf6856f` checkpoints the shared checkout before this implementation; generated
benchmark caches and the loose STL are excluded. Reoriented to D-029 and the
updated entry point before editing; no withdrawn component is restored.

Implemented [machine providers](core/machine/README.md) for the current catalog,
sharing source-time evaluation with Studio. S5/H2D use schematic XY
carriage/Z-bed motion; Splitty reuses its reference model; MG400 reuses nominal
FK/IK with explicit alignment. The new VP-6242 model uses DENSO's dimension
drawing and explicit seeded model angles, without claiming RC8 encoder/FIG
parity. Dobot's standalone sampler reuses the shared acceleration
evaluator instead of maintaining a second timing equation.

Added [read-only Studio studies](tools/kinematics/README.md), including unchanged
original Splitty `.sdgcode` input.
These use the shared viewer and hashed source transport, with no manufacturing
approval, generation or delivery. Default robot studies explicitly use synthetic
nominal floor installations. The separate Studio task owns consumer rendering,
camera behavior, worker lifecycle and visual verification.

Verification: independent DENSO drawing poses, complete deterministic provider
samples, source-hash invalidation, manufacturing-operation refusal and Splitty
source/timing parity
pass. Existing Dobot, source-player, split-delta and DENSO export/lifecycle checks
pass. A 0.1-second sampling sweep of each 24-second Splitty and DENSO study
returns complete poses throughout; this is sampled nominal software evidence,
not continuous reach, collision, calibration or physical printing evidence.

## 2026-09-13 — Withdraw September 12 contributions and establish context boundary

- The user reports that the originating agent context combined a pre-GitHub repository with modern SAAM and explicitly authorizes withdrawal of e3dc134, f2a97d8, 6e11afd and ce61c69. The old repository and transcripts are unavailable; no claim is made that every changed line was copied from them. The material-intent addition and revert cancel exactly.
- Withdraws the net incoming setup/tour, material catalog, nozzle-selection UI, generic compatibility/default changes, expanded H2D output and related portability changes. Retains the independently authored lightweight setup check, shared geometry/skills, kinematics, local-extension boundary, Studio lifetime work, test-worthiness changes and September 13 minimal-core guidance. No repository reset, history rewrite or blanket file restoration is used.
- Resolves the 44-path incoming footprint in an isolated copy of 357 tracked/nonignored working paths. Seven incoming-only files are removed; the independent setup-check implementation is retained. Existing missing tracked files remain missing. The recovery directory under ignored .local/contribution-withdrawal-20260913 contains the source snapshot, original working patch, path dispositions and verification record; ignored personal experiments, Prints and installed dependencies remain in place.
- Entry and contribution guidance require reorientation to live contracts when arriving from superseded repositories or transcripts, and explicit selective adoption before old components or methods enter the ecosystem. Routine authorized development gains no additional approval or test gate. [D-029](DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission) records three conceptual intents; [BR-044](build_request.md#br-044--port-a-vetted-material-library) records the committed but explicitly deferred material-library port. No port is implemented.
- Verification: the recovered candidate passes the lightweight runtime/geometry/Studio setup check and all 72 selected tests covering shared lifecycle, both recipe adapters, S5/H2D/configured-Dobot MCP workflows, actual-source review/delivery, setup persistence, malformed outputs, Studio lifetime and independent intersection references. The first candidate run failed because its explicit dependency-hash paths lacked node_modules; linking the installed dependencies resolved that isolated-environment problem. These are software checks, not physical printing evidence.

## 2026-09-13 — Studio and kinematic-model presentation contract

The user selected a machine ghost plus Machine view toggle, retaining manual
zoom and Studio's simple lines/shapes/cones with careful visual hierarchy.
They clarified that Studio needs the complete links/rails/print-carriage
presentation integrated with its existing bed/tool; only the model builder
works incrementally. Recorded the direction in D-028 and authored the shared
[integration contract](studio/KINEMATICS.md), reachable from Studio, rendering,
core architecture and machine references.

The contract specifies primitive geometry, component roles, resolved frames,
source-time poses, identity, partial/unavailable data, asynchronous responses,
camera/visibility behavior, movie parity and task ownership. It preserves the
existing toolpath renderer and exact-source review boundary. Synthetic providers
support complete Studio development while actual model components arrive.
The earlier generated-image concepts are presentation illustrations, not graphics
requirements. No runtime integration, new model or machine execution is included
in this documentation work. Verification is source/document inspection and
focused local-link checking; no software regressions are needed for these edits.

## 2026-09-12 — Fixed150 mm rods, maximize unchanged wavy-part scale

The user replaced the rod-minimization objective with fixed150 mm rods and maximum
part size. First showed a normalized regular six-anchor plate at the previous
66.7 mm pivot diameter. Then searched other physical dimensions with paired-edge
ordering enforced and the existing source unchanged except uniform XYZ scale.
Rail placement is free within the recorded symmetric-family bounds. Neutral
feasible mutations can replace equal-score candidates so geometry can change before
scale improves. Two2200-candidate passes found scale2.107361: diameter51.419 mm,
top Z63.221 mm, tool offset55.550 mm, paired plate center radius32.547 mm and pair
spacing16 mm. Operating rail travel is152.419 mm; minimum sampled assembly surface
gap3.365 mm. The standalone and machine profile revision5 show this candidate.

Evidence:64,833 operating samples pass modeled assembly and progressive rod/part
checks;45,225 cladding endpoints pass rod/plate checks;70 operating poses plus1820
raw angular probes pass kinematics. Rods remain exactly150 mm, paired-edge ordering
passes, and non-XYZ source words are identical. Results and search bounds are in
`Prints/development/splitty-fixed-150-rods/search.json`. This is the best found by a
bounded search, not proof of a global maximum. Previous unmodeled-body and physical
validation limitations remain.


## 2026-09-12 — Reject interleaved Splitty plate attachments

The user identified that the optimized plate had collapsed toward a triangle. Its perimeter order was C1,B2,A1,C2,B1,A2, violating the intended three paired edges. Added a design-family constraint requiring each pair to stay in its tower sector and a convex A1,A2,B1,B2,C1,C2 perimeter. The optimizer rejects this layout; the viewer flags it instead of falsely saying all pairs occupy their own edges. Three focused analytical/layout tests pass. The recorded full-rod and half-rod comparisons retain this rejected plate arrangement; no replacement physical search has been performed after this correction.

## 2026-09-12 — Splitty assembly clearance and angular-margin correction

- Corrected double application of the angular reserve: operating tilt stays 40 degrees; rod/joint margins apply once at operating poses, and separate probes test raw kinematic boundaries without another margin or collision requirement. Operating motion determines rail travel. Cylinder assessment follows the same distinction; finite probe directions do not prove distance to every parallel singularity.
- Added finite-segment rod/rail and rod/rod checks, rod/bed and physical rail/rail clearance. Rails retain their full configured extent for checks and the objective. The assumed physical rail bodies are 20 mm diameter with spherical pivots on 25 mm inward mounts; entire rods are checked against their own rails. No near-joint rod segment is exempted. Mount brackets, carriage/joint bodies, frame beams and drives remain unmodeled; nozzle is excluded by user direction.
- Reused the fixed source with XYZ scaling only. Rod/part travel checks use progressively deposited height; startup is not compared against a finished part. Plate/part checks remain at cladding endpoints. The earlier skinny candidate is superseded because it omitted rod/rail collision checks.
- Selected the candidate in `Prints/development/splitty-assembly-search/search.json`: scale 5.23524, deposited centerline diameter 127.739 mm, top Z157.057 mm, rods544.502 mm, tool107.118 mm, frame height958.720 mm, average physical envelope diameter285.904 mm. Operating carriage interval589.471–851.661 mm, travel262.189 mm. Updated the standalone and machine profile revision4; no Studio integration or hardware program was built.
- Evidence: 81,453 operating interpolation samples pass modeled assembly and progressive rod/part checks; minimum assembly surface gap1.777 mm. All45,225 cladding endpoints pass rod/plate checks. Angular checks cover70 operating poses and1,820 raw limit probes. Source non-XYZ words are identical. Nineteen focused kinematics/interpreter tests and two analytical assembly-clearance tests pass. These are sampled geometry results, not full mechanical certification or a global optimum.


## 2026-09-12 — Splitty standalone kinematics and profile clearance

- Added shared six-carriage fixed-rod inverse/seeded-forward kinematics, nominal Dobot MG400 kinematics and standalone source playback. DENSO joint modeling remains deferred at the user’s direction. No Studio integration or hardware firmware was built. The preview interpreter samples TCP/Euler motion before IK and does not produce steps or thermal/IO control.
- Adapted the local wavy DENSO source to a stationary bed with an explicit tilt cap. Added a Dobot vase-wall simulation with synthetic placement. The user selected 40° head tilt, at most two joint layers with one effective pivot center, and a 4° angular reserve.
- Explored smaller plate/nozzle dimensions and outward rail inclinations. Then fixed the top endpoints and widened the base for inward 5° rails: top radius 180 mm at Z=900 mm, base radius 258.7398 mm, rail coordinate 903.4379 mm. Selected plate pair-center radius 34 mm, pair spacing 86 mm, rods 450 mm, tool offset 64 mm.
- Built the requested lightweight part-profile check: 41 circular profiles, analytical rod/frustum intersections and plate horizontal cuts. On the 235.2 mm wavy path, full-height cladding collides. The unchanged approach passes at 61.5 mm diameter / 75.6 mm height at all 45,225 source cladding endpoints. Rods alone limit the coarse study to about 64.3 mm diameter. Constant radial 40° approach gives about 63.2 mm; ±15°/30° side approaches slightly reduce capacity.
- The 235.2 mm path passes the same endpoint/profile check with hypothetical 50 or 60 mm build/clad stages; 70 mm stages fail. Stage ordering and between-stage transitions have not been generated. The standalone now displays the smaller full-height cladding example, with the machine dimensions retained.
- Evidence: 23 focused kinematics/interpreter tests passed before the profile collision addition; five direct analytical collision cases passed for rod intersections, stage clipping, plate intersections and separated bodies. The full selected operating preview was sampled once; finite 4° reserve directions were checked separately. Collision assumptions are 6 mm rods, 1 mm clearance, 5 mm plate rim, 6 mm plate thickness and all-shell radial inflation. Hotend checking is intentionally excluded. These are mathematical/sampled studies, not physical printing evidence or a continuously certified collision envelope.

## 2026-09-12 — Reconcile shared branches and restore normal PR checks

Integrated the new remote nozzle/material selection work with the pending shared
geometry, skill and Studio changes, preserving both sides of overlapping imports,
routes and documentation. The six older local tasks share one recorded branch;
they do not own six separate feature branches. Contributor guidance permits tasks
to share a commit while coordinating changes to shared lines and Git operations.
The normal pull-request `test` job checks fresh-runner setup using read-only source
permissions; no commit-status write permission is added. Local setup passed in
0.27 seconds; the combined source passed all 434 regression tests.


Completed work, development checkpoints, measurements and scoped observations.
[Build requests](build_request.md#outstanding-work) contains only outstanding or
incomplete work; component references and skill manuals describe present behavior.
[Decisions](DECISIONS.md) preserves contributor direction and approval provenance.

## 2026-09-12 — Sweep test worthiness and establish useful examples

- The user requested evaluating the existing suite as an example for future
  builders. Surveyed the 74 test files present at the start, including two files
  from concurrent kinematics work that were left unchanged. Retained analytical
  geometry, upstream references, malformed-program cases, changed-input cache
  behavior, and distinct transport/output boundaries.
- Removed 15 tests or repeated matrix cases: tour wording and repeated setup,
  a retired command, copied camera and former offset implementations, function
  alias identity, duplicated bundle and viewer lifecycles, a generic boolean case
  in the infill suite, a recursive live-document crawl, and three repeated MCP
  vase lifecycles. Removed incidental wording, markup and cosmetic assertions.
  Input preservation remains in the independent offset-reference test; bounded
  synthetic fixtures cover the manual reader's relative links and private paths.
- Moved four real size-boundary regressions to `core/tests/stress/`, selected by
  `npm run test:stress`: 200,000 moves, Griffin/H2D bodies above 25 MB and a ZIP
  member above 64 MB. The stress command runs them sequentially to limit concurrent
  large allocations. Ordinary chunk-boundary and invalid-command tests remain
  in `npm test`. This preserves defect coverage without paying its cost routinely.
- Strengthened two approval-invalidation tests to start from an approved plan.
  Fixed source-player teardown to shut down Studio before deleting its temporary
  bundle. Added [test-worthiness guidance and examples](core/tests/README.md#worthwhile-tests)
  and updated the test registry; no additional mandatory gate was introduced.
- The initial full-suite run reported 446 passes and two failures. A source-player
  cleanup failed with Windows `EBUSY` and left a worker stalled; the audit's worker
  was stopped after identifying it. The document crawl also found the concurrent
  split-delta link in `core/export/README.md` outside the MCP reader's allowed
  documentation roots. Removing the crawl does not make that link available through
  MCP; the unrelated manual-access issue was left unchanged. The stalled run is
  not a useful performance baseline.
- Verification after edits: 105 focused ordinary tests passed, including all 12
  MCP tests, and all four stress cases passed across the stress run and a focused
  rerun. The first stress run exposed an erroneous corruption offset introduced
  while moving the ZIP case; restored corruption of the compressed payload and
  reran that case successfully. No full-suite speedup is claimed. Changes remain
  local and uncommitted.

## 2026-09-12 — Remove blanket agent verification gates

- The user authorized removing purposeless and repeated agent checks, keeping
  first-use environment checks and locally resolving checks required for publication.
- Live GitHub inspection found main protected by the GitHub Actions `test` status;
  the connected account had write access but no admin access. Remote main still
  ran the full suite on pushes and pull requests, despite local guidance claiming
  the status was not required. Sources: [main branch metadata](https://api.github.com/repos/Struder-AI/SAAM/branches/main)
  and [remote workflow at the inspected main commit](https://github.com/Struder-AI/SAAM/blob/6e11afd8718182ebecadc4373e226ae4378c9d50/.github/workflows/test.yml).
- Changed the local workflow to preserve `test` and run the existing runtime
  setup smoke check on fresh pull-request runners, with optional manual dispatch
  and no duplicate push run. This edits the check's implementation without
  altering branch protection. These changes have not been published.
- Removed full-suite requirements for commits, checkpoints and skill edits,
  the task-completion documentation gate, and the document-check prefix from
  `npm test`. Setup results carry across agent tasks. Focused verification follows
  relevant changes and concrete failure cases; the full suite and document checker
  remain available when useful. Removed the redundant print-check command from
  the setup example.
- Verification: the replacement CI command, `npm run setup:check`, passed locally
  on Windows in 0.40 seconds for dependency entry points, geometry kernels and an
  unapproved Studio preview. Reviewed the workflow and affected guidance. No full
  regression suite, documentation checker or physical test was run for these edits;
  the Linux runner result remains for publication.

## 2026-09-12 — Consolidate shared work toward main

- The user requested frequent returns to main, at most one active pending branch
  per account, and discussion when an unmentioned merge has no clear answer;
  purpose-saved side branches are exempt. Added one line at the contribution owner.
- Removed the checkout's uncommitted Codex approval override as requested.
  Shared MCP tests distinguish installed local extensions from cataloged manuals
  and exercise viewer reconnection plus adapter-owned shutdown under the longer
  Studio grace period. All 427 tests passed before the shared-work checkpoint.
- Integrated the existing local main setup work while preserving its local-test
  policy. Saved experiments and generated local artifacts stay outside publication.
- Combined remote main's cached first-run command, Node 26 test compatibility
  and geometry material-intent display with the shared text and field workflows.
  Kept the faster dependency-entry checks and installed Manifold smoke check;
  the MCP guidance reader exposes both the devlog and first-use guide.

## 2026-09-12 — Preserve Studio sessions across task switches

- Extended the default last-viewer disconnect grace from three seconds to
  30 minutes. First viewing still has no deadline, connected viewers have no
  idle deadline, and reconnecting resets the disconnect grace. Explicit owner
  shutdown remains immediate and drains accepted work.
- Shared one default between the server and lifetime helper, updated the CLI
  startup message and Studio/MCP guidance. This addresses users returning to
  previews several minutes after switching tasks or replacing browser tabs.
- All nine focused `studio-lifetime.test.mjs` tests pass, including mocked-time
  coverage of the full grace period, reconnection and connected-viewer lifetime.
  No npm test was run under the user's session restriction.

## 2026-09-12 — Expanding vase contour reference

- Source: the user requested fixing the subdivision error encountered while
  reopening Nudge Cup's toolpath. Reproduced it on the saved cup component at
  Z 3.119693 mm: the fixed first-section seam lies inside the expanding inset,
  and its nearest projection switches between the two edges beside a corner.
  The approximately 0.020 mm phase jump cannot converge through subdivision.
  This differs from the earlier patterned-wall triangle-seam cleanup below.
- The vase mapper projects a fixed reference outside the geometry's maximum X
  onto later sections. It preserves the first maximum-X seam and requested
  settings while preventing that interior-reference switch. Pattern offsets
  translate the same reference. Existing topology, boundary, angle and point
  budget checks remain in place; no tolerance was relaxed.
- Added a 120-sided expanding-frustum regression at the origin and translated
  to the saved print placement. It checks complete turns, monotone progression,
  maximum segment length, level ending and endpoint/midpoint distance from an
  independently constructed polygonal boundary. The complete saved spiral also
  generated 84 turns through Z 17.8 mm with 16010 points.
- Verification: all 31 selected vase, motif, finished-cladding and regional
  workflow tests passed, along with documentation and diff checks. The public
  development workflow generated the full cup in
  `Prints/development/nudge-cup-contour-fix`: 104593 interpreted moves, 83.1
  estimated minutes, and passing export checks. Reopened the checked source in
  Studio's toolpath viewer. Original print approvals remain unchanged. These
  are software results, not physical print evidence.

## 2026-09-12 — Lightweight first-use setup

- The user rejected duplicate local/GitHub full-suite runs and clarified that
  checks belong locally, where failures can be fixed before committing. Kept
  the local pre-commit full-suite requirement and made the GitHub workflow
  manual-only. The user explicitly authorized removing main's remote `test`
  requirement. First-use maker setup remains the lightweight smoke check.
- Replaced mandatory onboarding regression tests with `npm run setup:check`.
  It resolves declared dependency entry points, exercises Rhino, Clipper and installed
  Manifold WASM, creates a temporary unapproved wedge and checks its geometry
  through Studio HTTP. It needs no Git metadata or slicing and removes its
  temporary print. Full checks remain a contributor and release responsibility.
- The user authorized fast-forwarding remote main to the shared-code head and
  adding this setup improvement there; full packaging stays on a separate branch.
- On Windows x64 / Node 24.19.0, the main check took 0.58 seconds before the
  shared-code update and 3.52 seconds with its additional dependencies after a
  fresh install. These are software timings, not clean-machine download or
  desktop client permission measurements. No real job approvals were created.

## 2026-09-12 — Shared geometry and local extension partition

- The user requested keeping private experimental code, manuals, tests and UI in
  ignored local storage while sharing spline-field geometry and the text skill.
  Added a minimal conditional onboarding note and generic local MCP/Studio hooks;
  ordinary checkouts advertise only their installed shared capabilities.
- Shared scalar fields retain native storage, rational evaluation, sparse local
  refinement, mesh extraction, slicing and Studio review. Text tools and their
  manuals remain in the shared skill catalog.
- The user requested immediate commit and push with checks skipped. No checks
  were run for this partition. The public commit excludes private history.

## 2026-09-12 — Wider overlapping motifs on a wavy guide

- Source: the user accepted the motif-only preview and requested wider motifs
  that overlap, mapped onto a wavy surface. Generated the private
  `Prints/development/wavy-overlapping-motif-vase` with 8 mm nominal motif width
  (previously 5.6 mm), 4.8 mm depth straddling the guide, 20 motifs per course,
  36 courses and two axial waves with 0.6 mm radial variation. Adjacent motifs
  have two crossings in the unwrapped pattern; no exact contact was inferred.
- The larger inward offsets exposed unstable contour correspondence caused by
  simplifying from an arbitrary moving triangle seam. Patterned contour cleanup
  now starts at a consistent geometric extreme. Added a regression covering the
  failing wavy section and updated the vase-wall manual.
- Public export check reported 46083 moves, 46080 extrusion moves, about 10.5
  minutes, no program error and all human approvals false. Inspected the overlap
  in Studio's top view and the stacked pattern in 3D; left the preview open.
- Full suite: 443 of 444 tests passed, including all vase tests. The unrelated
  evolution stop/cleanup test failed with Windows EBUSY removing a temporary
  candidate file; all six evolution-workflow tests passed on focused retry.
  Documentation and whitespace checks passed. No physical print, manufacturing
  approval, staging, commit or publication occurred.

## 2026-09-12 — Patterned vase deposits only its motif

- Source: the user clarified that the wall is only a reference guiding the motif,
  not an additional wall to print. This supersedes the connecting-stroke approach
  in the preceding scalloped examples.
- Removed implicit foundation and lead-in strokes from patterned vase generation.
  Only supplied motif paths deposit, with nominal requested bead heights. Plain
  spiral mode retains its existing behavior. The loop example now advances within
  the looping curve itself, without separate guide-ring connectors; its signed
  depth straddles the reference to leave both edges scalloped.
- Stabilized patterned contour cleanup within the configured tolerance budget
  before and after offset-grid rounding, and retained outer offset boundaries
  when tracing the guide. Regression coverage includes motif-only deposition,
  an entirely offset motif, continuous looping and changing wavy solid guides.
- Updated the vase-wall manual, shared path reference and Studio settings text
  to identify the host surface as a reference only. All 441 tests passed, as did
  repository documentation and whitespace checks.
- Generated `Prints/development/motif-only-loop-vase`; its public check reported
  30723 moves (30720 extrusion moves), about 5.8 minutes, no program error and
  all human approvals false. Relaunched its Studio server at the user's request.
  Browser automatic approval review timed out on opening the new preview and its
  permitted retry, so this version has no completed visual inspection. These are
  software checks, not evidence of physical contact or strength. No manufacturing
  approval, staging, commit or publication occurred.

## 2026-09-12 — Motif with scalloped inner and outer edges

- Source: the user requested a motif leaving both the outside and inside bumpy.
- Added the `both-scalloped` loop example: loops straddle the guide by 2.4 mm in
  either direction and connect at their tangential tips through the middle of
  the wall. The same pattern mapper and continuous extrusion workflow are used;
  neither exposed boundary has a smooth circular connecting stroke.
- Generated `Prints/development/both-scalloped-loop-vase` and inspected both
  scalloped edges in Studio's top view. The public check reported 34843 moves,
  about 7.2 minutes, no program error and all human approvals false. Documentation
  and whitespace checks passed. This is recipe/export/visual evidence; physical
  contact and strength are not established. No core generator change or new
  manufacturing approval was made.

## 2026-09-12 — Scalloped motifs on solid and wavy vase guides

- Source: the user accepted the tilted-loop appearance, chose the term motif,
  requested a visibly bumpy exterior and asked about changing host curvature.
  They clarified that an ordinary solid is the standard vase-mode input and
  that exact registration with the previous course is unnecessary.
- Extended the loop example with an outward/scalloped arrangement, configurable
  motif size and a wavy solid guide. It uses the existing signed-offset mapping;
  no new generator, automatic resizing, contact solver or registration gate was
  added. Demo inputs are capped solids without a bore. The manual distinguishes
  normalized perimeter mapping and horizontal contour depth from 3D normal
  projection, and describes the effects of changing circumference and radius.
- Put solid-input guidance in [vase-wall](skills/vase-wall/SKILL.md#input-geometry-normally-a-solid),
  with a maker-entry pointer. Added the accepted term to [GLOSSARY](GLOSSARY.md).
  The user confirmed the preceding example's appearance; that is visual evidence,
  not a physical strength result.
- Generated and inspected `Prints/development/scalloped-loop-vase` in top view
  (34842 checked moves, 7.7 minutes) and `Prints/development/wavy-scalloped-loop-vase`
  in 3D (51544 moves, 9.7 minutes). The latter uses 0.6 mm radial waves and smaller
  3.2 mm wide / 2.4 mm deep motifs, 32 per course over 36 courses. Both public
  checks reported no program error and all human approvals false.
- Added regression coverage for outward lobes, a solid input section and radial
  movement between courses on a wavy host; all 24 focused vase/settings tests and
  repository documentation/whitespace checks passed. The full-suite run reported unrelated
  evolution-worker tests returning interrupted rather than completed, including
  an optional local experiment test; that implementation was unchanged.
  Manufacturing contact and strength remain unvalidated. No staging, commit,
  publication or human manufacturing approval occurred.

## 2026-09-12 — Overlapping tilted loops on the vase spiral

- Source: the user clarified that the intended pattern adds small overlapping,
  nearly flat circles to the ordinary rising vase path, warped around the host.
  The outer envelope should follow the original geometry. Pattern tilt and
  inter-course overlap remain judgments, not new numerical acceptance gates.
- Added signed per-point contour offsets to sleeve motifs, continuous rising
  lead-ins for raised first motifs, offset-aware endpoint matching and Studio
  offset summaries. Pattern slope is reported without a tilt gate. The plain
  spiral retains its existing angle behavior. The [manual](skills/advanced-vase-wall/SKILL.md#sleeve-patterns)
  owns the current mapping and extrusion conventions.
- The full example exposed false offset micro-holes from triangle seams and
  unbounded retention of section/offset curves. Pattern contours now remove
  sub-grid seams on the shared offset grid, and both caches have bounded size.
  The ordinary spiral's contour preparation remains unchanged.
- Opened and visually inspected `Prints/development/tilted-loop-vase` in Studio's
  top view: 20 overlapping loops per revolution, 24 courses, 4.8 mm inward depth,
  28 mm outside diameter and approximately 5.46 mm overall height. Checked export:
  34842 moves, about 6.7 minutes, no program error and all human approvals false.
- Verification: 23 focused vase/settings checks passed. A full run passed 429
  of 430 tests; its only failure was a temporary-file EBUSY during cleanup in
  program-cache tests, whose six tests subsequently passed. An earlier full run
  exposed the missing DEVLOG entry in the connector's published-document list;
  that entry was added and all four access tests passed. Documentation and
  whitespace checks passed. Physical contact/strength remain unvalidated; no
  manufacturing approvals, staging, commit or publication occurred.

## 2026-09-11 — gridfinity

[gridfinity](skills/gridfinity/references/development-record.md)

## 2026-09-11 — Volumetric field geometry and Studio slicing

Implemented scalar voxel fields and trivariate rational B-spline control fields
in `core/geom/voxel.mjs`, reusing the existing basis evaluator. Added physical
gradients and control-value influences, explicit Manifold 3.5.3 level-set
extraction with exact domain clipping, and a persisted source/mesh record.
Connected the record to shared plan validation, mesh queries, mixed assemblies,
native-file checks, approval invalidation and exact-byte delivery. Added CLI and
MCP creation/editing, the voxel task manual, and sampling facts in Studio.

The first focused run passed 36 tests across voxel, mesh, MCP and skill-digest
coverage. A subsequent run passed 17 tests across expanded voxel coverage and
Studio geometry/settings, including an enclosed cavity and CLI request updates.
Analytical checks covered affine gradients, a quadratic cylinder and section-area
convergence; rational gradients matched finite differences. Repository link/digest
checks and `git diff --check` passed. These were focused checks, not a full-suite
or physical print run.

Generated `Prints/voxel-field-demo` through the public task demo and development
bundle workflow: a cubic-XY field in a 24 × 24 × 4.8 mm domain, sampled at 0.6 mm,
with a roughly 20.5 mm outer footprint and lobed through-hole. The checked S5
export contained 12117 moves over 24 planar layers. Visually inspected the
geometry and toolpath in Studio. No approvals, solver results or physical
validation were created. The future solver requirements and extraction limits
are documented in [the field reference](https://github.com/Struder-AI/SAAM/blob/ddb704a70d022a1810c8db52a2ac3d44a55aacf1/core/geom/VOXEL.md).

## Dates and historical scope

This log consolidates existing records on 2026-09-12 UTC (2026-09-11 in
America/Los_Angeles). Work dates below come from the original dated requests and
observations, supplemented by the first committed record where available.
A request date or commit checkpoint is not proof of the exact completion time.
Original dates retain their stated convention; undated source dates have no
invented timezone. Explicit later follow-ups keep their own dates. Undated work
is marked as such instead of being assigned the migration date as its work date.

The migrated BR identifiers and headings remain stable for evidence links; new
completed work needs a dated descriptive entry, not a build-request number.
The records preserve checkpoint wording, including then-current status, proposals,
test counts and limitations. They are historical snapshots, not current guidance
or fresh verification. Later entries can supersede their technical details.
Only the build-request list identifies work that is still open; a historical
limitation does not create a new implementation commitment. Software checks,
visual feedback and physical observations retain their distinct evidence scope.

## Initial refresh scope — historical snapshot, 2026-09-08

Authorized by remettub on 2026-09-08: finish a clean refreshed repository, commit,
and push a new `refresh` branch directly to `Struder-AI/SAAM`.

The initial delivery was a clean skeleton, local architecture map, repository
checks/CI, maker/developer routing and decision/vocabulary records. Runtime
geometry, toolpath generation and Studio were deferred at that checkpoint and
implemented in subsequent requests.

Legacy reference: commit `54093cadbe87020836916d53dd29a45a06bf5528`.
Working-folder archive destination: `../SAAM-legacy-20260908/legacy-reference/54093cadbe870/`.
Old source, dependency and local fill-review work were preserved outside SAAM;
personal `Prints/` and `.saam/` were excluded from that move. Licenses/notices
were retained. This restart did not authorize adoption of the legacy runtime.

## BR-001 — Local architecture map

- Work date: 2026-09-08. First committed record: `3cffb22` (2026-09-08T15:59:08-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: complete locally
- Requested by: remettub, 2026-09-08, restart conversation R3
- Result: ignored `.local/architecture-map/`, with maker/project views, 16 source anchors, selection/navigation, search/focus, themes and persistent dragged positions checked locally. No legacy runtime adopted.

## BR-002 — Simplify restart terminology and guidance

- Work date: 2026-09-08. First committed record: `3cffb22` (2026-09-08T15:59:08-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: complete
- Requested by: remettub, 2026-09-08, restart conversation R3
- Build: Maker-agent vocabulary, glossary, three approvals, direct generation from the locked plan, skill packages, local Prints, and concise developer documentation.
- Verify: Consistent current documents; superseded decisions preserved in the log.

## Initial foundation verification — historical snapshot

- Work date: 2026-09-08, initial refresh context.

All 114 archived files were checked against their original SHA-256 hashes.
Initial checks covered document links, decision metadata and private-file
exclusions; they did not validate manufacturing behavior. Current checks are
described in the [check policy](BUILDERS.md#avoid-check-spirals).

## BR-003 — Resolve native path versus machine file

- Work date: 2026-09-08 (initial request/resolution context; not a completion date). First committed record: `3cffb22` (2026-09-08T15:59:08-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: resolved
- Source: R3 refers to both a native-format path and an output toolpath in a print.
- Result: R4/R5 establish SAAMpath as the internal representation, with a separate export using an output option in the machine file. Encoding and bundle layout were open at this point; see DEVELOP.md for the implemented formats.

## BR-004 — Rhino geometry integration

- Work date: 2026-09-08 (initial request/resolution context; not a completion date). First committed record: `3cffb22` (2026-09-08T15:59:08-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: wedge integration implemented; general integration deferred
- Historical direction: remettub selected Rhino/3DM; later mesh/direct-spline direction is recorded in [D-021](DECISIONS.md#d-021--native-mesh-geometry).
- Result needed: Choose and test the Rhino integration method, preserve spline surfaces and feature references, and establish runtime/install/licensing requirements.
- Wedge result: pinned rhino3dm creates a capped extrusion and six named NURBS reference surfaces; 3DM round-trip tests pass. General spline intersections and edited-file import remain deferred.

## BR-005 — First complete print

- Work date: 2026-09-08 (initial request/resolution context; not a completion date). First committed record: `3cffb22` (2026-09-08T15:59:08-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: software demo implemented; physical print pending
- Result needed: One specified printer/material/nozzle, geometry edit, three approvals, direct generation, automated checks, same-file preview/delivery, and save/reopen of the print bundle.
- Depends on: BR-003, BR-004, and selection of the first printer/setup.
- Current implementation: BR-007 supplies the S5 wedge workflow. Each job requires three actual print approvals; software tests do not complete a physical print. Standard S5 startup is assumed without requiring firmware identification.

## BR-006 — SAAM Studio interaction and export interpretation

- Work date: 2026-09-08 (initial request/resolution context; not a completion date). First committed record: `3cffb22` (2026-09-08T15:59:08-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: bounded S5 demo implemented; general interpreter deferred
- Result needed: Shared geometry references and a viewer that interprets the actual export, including its helper files and declared machine state. Detect unsupported behavior before review; tie approval to the reviewed version and invalidate affected approvals after changes.
- Proposed interaction: Click-to-select geometry with shared labels; compare a feature tree and screenshot markup during usability testing. See [developer proposals](studio/README.md#studio-feature-references).
- Verify: A novice can identify a feature, request an edit, approve the three stages, and reopen the print. The delivered export is byte-identical to the reviewed export.
- Current result: named face selection, geometry/process editing, three version-bound approvals, exact Griffin export playback, save/reopen, and byte-identical delivery tests. Novice usability and physical validation remain pending.

## BR-007 — S5 inclined-wedge demo

- Work date: 2026-09-08. First committed record: `43c6635` (2026-09-08T17:52:22-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: implemented locally; physical validation pending
- Source: user in the S5 wedge conversation, 2026-09-08: "looks good, go ahead". Setup clarified as AA 0.4, right nozzle #2, PLA at 215°C.
- Result: the initial Rhino/S5 wedge demonstrated horizontal body fill, inclined skin and the shared review/export workflow. [BR-020](#br-020--eight-point-wedge-with-a-planar-roof) records its replacement with the bounded native-mesh geometry.
- Clearance scope: user explicitly said "Don't worry about clearance for this one. I'll make sure it clears." Physical head collision checking is deferred for this demo; bounds, motion and extrusion checks remain.
- Software checks covered geometry, generation, interpreted export and the three-approval/exact-delivery lifecycle. The [wedge manual](skills/wedge-demo/SKILL.md) owns current setup and checks.

## BR-008 — Root developer and maker guidance

- Work date: 2026-09-08. First committed record: `43c6635` (2026-09-08T17:52:22-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: complete locally
- Source: user correction during the S5 wedge conversation, 2026-09-08.
- Historical result: consolidate developer rules and development notes into root DEVELOP.md; move maker guidance to root MAKERS.md; remove docs/ and update active references. The instruction at this checkpoint defaulted unspecified agents to developer and required every developer to read both root files. Current context selection is in [AGENTS.md](AGENTS.md#choose-your-role) and the [builder orientation](BUILDERS.md).
- Approval scope: this records the user's development instruction, not an inferred contributor decision approval.

## BR-009 — Accessible chat-driven review and wedge refinement

- Work date: 2026-09-08. First committed record: `43c6635` (2026-09-08T17:52:22-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: implemented locally; physical validation remains pending.
- Source: user in the S5 wedge conversation, 2026-09-08.
- Result: concise geometry → settings → toolpath review, chat-only recipe edits with automatic viewer updates, playback speed selector, adjustable sloped-layer count, 0.2 mm nominal layers, alternating sloped strokes and alternating flat-layer traversal.
- Historical travel policy: every horizontal move lifted to the full part maximum plus 2 mm. Later wedge work added direct nearby travel; the current manual owns that behavior.
- Setup: remove installed-firmware approval requirement; assume standard S5 startup, resolve concrete questions in chat, and remember setup locally for later prints.
- Guidance: MAKERS.md owns the review/revision flow and setup conversation; DEVELOP.md documents implementation and setup persistence; the wedge manual documents adjustment tools.

## BR-010 — Split the wedge patterns into general skills

- Work date: 2026-09-08. First committed record: `bb17774` (2026-09-08T19:01:00-07:00); this is a checkpoint, not an exact completion timestamp.

Historical result at completion; Studio/delivery limitations below were replaced by BR-011.

- Status: implemented locally; untested beyond software checks
- Requested by: remettub, 2026-09-08: split the wedge skill in two, a "full fill"
  skill doing the first pattern for any shape, and a non-planar top surface skill
  doing the final pattern for any shape, limited by a max-nonplanar-angle machine
  setting (15 degrees for the S5). Also: improve on the wedge's travel moves, and
  leave the wedge skill as it is.
- Naming and behavior chosen by remettub during the work: the second skill is
  `draped-skin`; surface steeper than the limit is excluded from the skin and
  reported rather than rejecting the job.
- Geometry scope agreed in the same conversation: closed breps of untrimmed
  bivariate spline surfaces. Intersections between several such solids are
  computed at the toolpath, not as boolean geometry. Running a Rhino Compute
  server was rejected.
- Result: shared geometry/region/path core and the two skill packages, checked
  against analytical geometry and rhino3dm with software export regressions.
  Studio and the approval/delivery workflow followed in BR-011. Current
  numerical and shape limits belong to the skill manuals and DEVELOP.md.
- The wedge skill was left unchanged, as requested.

## BR-011 — Make full-fill, draped-skin and the core usable

- Work date: 2026-09-08. First committed record: `f7881ac` (2026-09-08T20:59:38-07:00); this is a checkpoint, not an exact completion timestamp.

Historical result at completion; later shape additions and shared lifecycle are recorded below.

- Status: implemented locally; untested beyond software checks
- Requested by: remettub, 2026-09-08: "We need to be able to use the drape and
  fill skills and the geometry core." Scope confirmed in the same conversation
  as the full maker workflow, at parity with the wedge, leaving the wedge alone.
- Result: full-fill/drape bundles gained Studio review, chat adjustment,
  remembered setup, three revision-bound approvals and exact-byte delivery.
  Software tests covered native geometry identity, stale revisions and the
  distinction between development fixtures and real approvals. The wedge
  package remained unchanged while Studio became bundle-agnostic. Later shape,
  import and composition requests expanded the initial bounded geometry.
- Remaining: physical printing and novice usability were not established.

## BR-012 — Spline-sided shell plan shape

- Work date: 2026-09-08. First committed record: `f7881ac` (2026-09-08T20:59:38-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: implemented locally; untested beyond software checks
- Requested by: maker, 2026-09-08: expose spline side support through the
  geometry core rather than limiting spline geometry to the roof.
- Build: `spline-shell` adds a closed shell with a control-point-grid roof and
  four untrimmed ruled spline side patches. The plan exposes symmetric
  `longSideInsetMm` and `shortSideOutsetMm` parameters, validates the flared
  bounding box against printer placement, and shows the taper in Studio.
- Verify: geometry closure and every sampled horizontal section; both slicing
  skills generate from the locked shape and report excluded over-limit tapered
  surfaces. No physical print or clearance validation has been performed.

## BR-013 — Vertical spline-side shell

- Work date: 2026-09-08. First committed record: `f7881ac` (2026-09-08T20:59:38-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: implemented locally; untested beyond software checks
- Requested by: maker, 2026-09-08: keep the walls vertical while bulging them
  outward along X and inward along Y, with a stronger domed roof.
- Build: `vertical-spline-shell` uses the same spline footprint for the base
  and roof, so its ruled side patches are vertical. It exposes `xBulgeMm` and
  `yInsetMm`, supports a 4 × 4 roof control grid, and validates its X bulge
  against printer placement.
- Verify: matching roof/base XY points, equal body sections at distinct heights,
  closed-shell checks, locked-plan generation and Studio presentation. No
  physical print or clearance validation has been performed.

## BR-014 — Experimental per-print non-planar override

- Work date: 2026-09-08. First committed record: `f7881ac` (2026-09-08T20:59:38-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: implemented locally; untested beyond software checks
- Requested by: maker, 2026-09-08: test a 45° draped-skin path without changing
  the S5 machine file's declared 15° limit.
- Build: `maxAngleDegOverride` is an explicit draped-skin plan setting. It
  changes only that print's effective survey/generation limit, while checks and
  Studio show both the 15° profile declaration and the experimental override.
- Boundary: it creates no approval, delivery or machine action, and does not
  establish physical clearance or deposition behavior at the override angle.

## BR-015 — Consolidation, interoperability and general operation weaving

- Work date: 2026-09-08. First committed record: `e87477a` (2026-09-09T09:19:20-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: implemented; software verification recorded in the associated tests
- Requested by: user in the repository assessment conversation, 2026-09-08.
- Scope: fix documentation drift; make parallel pipelines exceptional and normally
  require prior user agreement; establish interoperability as an ideal with justified
  exceptions; remove standalone shell preview; share G-code generation and the
  bundle-to-delivery lifecycle; enable generalized weaving of skill results.
- Clarification: weaving applies to compatible skill operations, including separate
  full-fill instances. Supporting body fill must complete before draped-skin. A
  two-column/spanning-roof example motivates alternation and AA–BB batching but
  does not define or limit the generic composer.
- Implementation: machine-owned program templates; one exporter/interpreter;
  adapter-based shared lifecycle; one bundle in development and production modes;
  operation results with layers/surfaces, dependencies, deterministic order and
  batching; assembly component selection through the existing shell plan.
- User observation: the last S5 wedge change achieved no routine bed leveling and
  no unused-nozzle heating. Preserve that header/startup/shutdown behavior. Earlier
  first-layer under-extrusion was reported; complete physical validation is open.
- Verify: exact S5 envelope regression, strict temperature/modal/numeric checks,
  shared workflow tests for both adapters, generic composition and same-layer order,
  batch clearance, support-before-roof rejection, and woven bundle delivery.
- General mesh input, automatic overlap/support inference, and physical bridge or
  collision validation are not implemented. Developer details live in DEVELOP.md.
- Approval scope: this records the user's implementation instruction and observation;
  it does not infer either contributor's approval of new decision wording.

## 2026-09-08 to 2026-09-10 — S5 startup observations

- Date basis: Explicit observation dates; the intervening first-recovery correction is undated and is present by d8ed7a9 (2026-09-11T17:36:21-07:00).
- Original owner: [core/export/griffin.md](core/export/griffin.md). Preserved observation/checkpoint wording follows.

On 2026-09-08 the user reported that the **last wedge change** achieved no routine
bed leveling and no heating of the unused nozzle. The reported envelope used
Griffin compatibility `4.4.0`, SAAM's own version field, build date, material GUID,
build-volume metadata, active-tool temperature commands, no G280, and shutdown.
The default recipe uses nozzle #2/T1. Earlier that day the user reported initial
under-extrusion; the wedge recipe then accounted for its terminal retraction on
the next start. These observations apply to that export revision, not every S5 run.

The user subsequently reported having to push filament to compensate on every
start. The shell generator had treated the S5 handoff as unretracted, leaving
the preceding job's withdrawal outstanding after its initial retract/recover
pair. Shell and wedge generation now share the interpreter's S5 startup-state
rule: recover the configured retraction once at the first deposition location,
without another initial withdrawal. H2D retains its unretracted handoff; zero
retraction and relay output add no recovery. The emitted commands are corrected;
physical startup with the correction has not yet been reported.

On 2026-09-10 the user reported that their observed S5 startup differs from the
listed template behavior; the exact file and extra actions are not yet identified.
Absence of explicit leveling or unused-heater commands does not establish that
Griffin firmware skips those actions. Retained snapshots and delivered bytes can
predate the current profile. Diagnose the actual file and printer behavior before
applying the earlier observation. Complete physical print validation remains open.

## 2026-09-08 — S5 metadata and firmware acceptance

- Date basis: Explicit date in the original user observations; committed in 191af69 (2026-09-08T19:00:39-07:00).
- Original owner: [skills/wedge-demo/references/s5-export.md](skills/wedge-demo/references/s5-export.md). Preserved observation/checkpoint wording follows.

On 2026-09-08 the user reported firmware 8.3.1 rejecting the 0.2.0 file while
selecting it from USB. That export omitted the required build date. Version
0.2.1 adds it without changing executable commands. Reader compatibility checks
do not establish acceptance by that physical printer or successful printing.
The public libCharon reader was run locally against both files: it rejected
the original with `GENERATOR.BUILD_DATE must be set` and accepted the correction.
All bytes after `END_OF_HEADER` matched the previously reviewed export.
At the user's explicit request, the corrected file was copied to the S5
removable drive and its SHA-256 verified. The printer then reported "does not
contain the necessary data" for the corrected file. Passing libCharon alone is
therefore insufficient to establish S5 firmware 8.3.1 compatibility.

The user's Cura 4.12.0 reference (`wedge.ufp`, also supplied as
`wedgeCURA.gcode`) contains `BUILD_VOLUME.TEMPERATURE:28` and Generic PLA's
material GUID; both were missing from 0.2.1. Version 0.2.2 adds these to the
locked setup and export, and checks their presence. All reference header keys
are now present for the active tool. The reference uses both extruders; this
demo still declares only the requested right nozzle. No slice UUID was present
in that reference, so one was not invented to address this error. The user
subsequently confirmed that firmware 8.3.1 accepted the 0.2.2 file. That result
applies to the then-current command body, not the later no-routine-leveling
startup or Griffin-4.4 compatibility declaration. Those changes have software
checks only and do not establish a completed physical print. Brief guidance is
recorded in the S5 machine file.

## What should earn adoption next

- Date: initial evaluation proposal, recorded by `e87477a` (2026-09-09T09:19:20-07:00); not a completed evaluation. The [provenance audit](#2026-09-14--build-request-provenance-audit) recovered no explicit approval of the comparative novice study, so it is excluded from the outstanding-work queue.

Recommend proving one complete print before adding a catalog of operations.
The value to test is whether SAAM reduces setup, clarification and recovery work
compared with the same agent using existing CAD and slicing tools. Extra agent
instructions alone are not enough. Test repeatable generation, useful machine
checks, shared geometry references, and review of the exact delivered program.
This is a proposed evaluation direction, not a claim of implemented advantage.

## BR-016 — Printing and geometry design for review

- Work date: 2026-09-09. First committed record: `d2a1214` (2026-09-09T09:38:15-07:00); this is a checkpoint, not an exact completion timestamp.

Historical design snapshot; implementation followed in BR-017 and BR-018.

- Status: design completed; subsequent implementation recorded in BR-017 and BR-018.
- Requested by: user, 2026-09-09, this repository task; explicitly scoped to “Design and requirements for me to review. Let's keep it lean.”
- Documentation completed: README now owns the introduction and product direction; PROJECT_CHARTER is a compatibility pointer. Developer guidance explains node_modules and routes skill authors to shared requirements.
- Task: Add planar-infill (suggested name): wall count, sparse alternating rectilinear infill, travel reduction and combing. Reuse full-fill for solid top/bottom masks with one layer grid and no duplicate walls/material. Include local top/bottom detection and bridging/support limits.
- Task: Centralize whole-plan maximum-height clearance for lifted travel, cooling and parking; preserve verified joined/combed moves and test cross-skill obstacles and machine bounds.
- Task: Make mesh native part geometry (D-021); add validated ASCII/binary STL import with locked units and conversion tolerances. Adapt full-fill and draped-skin to shared geometry queries; preserve the bounded wedge exception and one export/review lifecycle.
- Task: Add a Bambu H2D machine profile and general machine interoperability. Move S5-specific setup validation out of shared plan code. Declare machine/tool/material capabilities and supported outputs; keep machine behavior out of pattern skills. Implement the H2D-compatible exporter/interpreter and packaging needed for the exact reviewed artifact, using verified machine documentation or a user-supplied known-good program for the intended configuration.
- H2D scope to resolve before implementation: target nozzle/tool and material setup, firmware/output packaging, startup/shutdown behavior and machine limits. Do not copy the S5 Griffin envelope or assume an H2D profile alone enables support. No hardware execution is requested.
- Verify: equivalent geometry across backends, material ownership, travel limits, deterministic generation, profile-specific setup rejection and supported machine-program interpretation. Exercise both machine profiles through the same skills, three approvals and exact-byte delivery. Report software checks separately from physical printing.
- Design: [geometry](core/geom/README.md#geometry-interoperability-for-skill-authors), [travel](core/path/README.md#whole-plan-travel-requirement), [planar-infill](skills/planar-infill/BUILDER.md#planar-infill-design), [machines](core/export/README.md#machine-interoperability-design).
- Approval scope: records requested work, not contributor consensus or manufacturing-job approval. Existing runtime remains unchanged.

## BR-017 — Implement interoperability first, then planar infill and import

- Work date: 2026-09-09. First committed record: `48e4e8c` (2026-09-09T10:22:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Status: geometry/skill/machine interfaces, planar-infill and STL import implemented; H2D output completed as experimental software in BR-018.
- Source: user, 2026-09-09, this task: “the interoperability work should come first” and “finish out the task list”. User confirmed both geometry backends, H2D left 0.4 mm nozzle/PLA, and experimental 15° draping.
- Completed: shared mesh/spline queries, native mesh storage and ASCII/binary STL import with explicit units/source hash; geometry validation and mixed assemblies; machine-owned defaults/capabilities and separate remembered setups; selected-tool bounds and machine-independent SAAMpath checks; H2D profile with official source references; output-adapter dispatch with explicit unsupported-output rejection.
- Completed: whole-plan lifted travel and cooling, bounded comb routes around holes; planar-infill with walls/density; full-fill solid-surface masks and single wall ownership; local top/bottom regions, drape reservation and dependencies; common booleans handle coincident boundaries and close level sets at their domain boundary.
- Completed at this checkpoint: README/charter consolidation, skill manuals and shared authoring guidance; Studio shows machine, mesh dimensions, sparse/solid settings and unavailable output status. Later H2D wedge support is in BR-019.
- Software verification: both backends × S5/H2D × full-fill/drape/planar-infill, material/setup rejection, wedge exception, mesh holes/islands/invalid input, changed STL source, mixed assemblies, whole-plan clearance/cooling, comb routing, sparse density/solid-layer ownership, S5 native mesh review/delivery and preservation of the prior S5 envelope. Tests create no real approvals or hardware actions.
- Remaining at this checkpoint: H2D exporter/interpreter plus sliced-3MF packaging; addressed in BR-018 using the supplied reference exports. A profile/SAAMpath pass alone does not claim output compatibility.
- Physical validation remains open. Trimmed CAD import, rotary/tool-changing extensions, automatic supports and bridge optimization were outside this request; subsequent requests and current manuals own their present scope.

## BR-018 — H2D output from the supplied nozzle references

- Work date: 2026-09-09. First committed record: `e04d1d6` (2026-09-09T11:13:25-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user-supplied right-nozzle `example.gcode.3mf` and left-nozzle `wedge.gcode.3mf`, 2026-09-09; this continues BR-017. Checkpoint `48e4e8c` preserves the earlier implementation before this work.
- Status: experimental H2D output implemented through the shared lifecycle. One selected 0.4 mm nozzle, PLA, Textured PEI and no chamber heat; left remains default, with both nozzle maps covered by software tests.
- Completed: pinned firmware start/end contract, explicit print-body handoff, whole-plan shutdown clearance, shared modal interpretation, deterministic sliced-3MF packaging with fresh metadata/thumbnails/checksums, binary artifact hashing/reopening, Studio review and exact-byte delivery. No reference object or private project is copied into generated files or Git.
- Verification: 89 passing software tests; both nozzle maps, three skills and mesh/spline paths, invalid temperatures/tool bounds, corrupt ZIP, altered envelope/metadata/body, synthetic approvals and HTTP archive delivery. Independent Python ZIP/CRC, XML, JSON and MD5 checks passed. Existing S5 behavior is retained. Bambu Studio's CLI model-import check rejected both sliced reference and generated files with -6; program-viewer import acceptance is unconfirmed.
- Boundary: firmware service routines are matched to a fixed contract, not simulated. Print-body time/material excludes those routines. No physical validation or hardware execution. See the [H2D contract](core/export/bambu.md#h2d-output-contract) for exact scope and remaining validation.

## BR-019 — H2D wedge and Studio reopen/activity

- Work date: 2026-09-09. First committed record: `8158312` (2026-09-09T18:41:35-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-09, requested H2D wedge support, opening previous local prints and visible activity while toolpathing/exporting. Clarified that only SAAM bundles are opened, retaining current approvals and going straight to a ready toolpath.
- Implemented: the bounded wedge uses S5/H2D profile setup, tool bounds and shared output; H2D left/right software round trips, unretracted firmware handoff, sliced-3MF review and exact archive delivery. Geometry/generation remain in the wedge package.
- Implemented: Studio local bundle picker and folder/file path opening, version-bound approval retention, ready-toolpath playback, stale-program rejection, failed-open recovery and old-tab mutation rejection. Opening changes no saved print files or approvals.
- Implemented: accessible busy banner during load, generation/export/checks and delivery, duplicate-action blocking, error cleanup and reduced-motion styling.
- Verification: automated H2D wedge and Studio reopening regressions alongside the existing suite. No physical printing or fabricated job approval.
- Collision avoidance options are a requested design review, not authorization to adopt a robotics library or implement a second pipeline.
- Physical finding and correction, 2026-09-09: the user's first H2D run reached
  the part, then showed severe over-extrusion on flat layer two. The H2D body had
  incorrectly used cumulative `M82` extrusion although the supplied Bambu Studio
  reference uses relative `M83`. H2D emission now uses relative per-move E values;
  S5 retains its Griffin `M82` contract. Software regression is required before
  a corrected export is reviewed, and physical retesting remains open.

## BR-020 — Eight-point wedge with a planar roof

- Work date: 2026-09-09. First committed record: `8158312` (2026-09-09T18:41:35-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-09, this task: generalize to any eight-point set with an axis-aligned rectangular base and vertical corner pairs; use mesh and “limit to a flat roof”. Follow-up requests Studio with the original H2D wedge, tall side left, six skins and doubled printing speeds.
- Implemented: unordered point input, base translation, coplanarity and total-slope validation; native eight-vertex/twelve-triangle mesh with named faces; body half-plane clipping and roof rastering for either axis, diagonals and level roofs through the existing wedge generator and shared export/review lifecycle.
- Printing-speed targets use machine XY limits rather than the former demo-only caps, with material-flow and Z-speed limits still applied to actual moves. Doubling deposition targets gives 40/20/24 mm/s for flat/skin/first-layer; travel and other process settings remain separate.
- Explicit older-bundle upgrade verifies native geometry, converts to eight-point mesh and requires fresh geometry review; old native, export and delivery bytes are retained. New mesh bundles do not require Rhino computation or 3DM storage.
- Verification covers all slope quadrants, level roofs, six parallel skins, volume, travel height, mesh identity, malformed inputs, explicit migration and S5/H2D export round trips. No contributor consensus, job approval or physical print validation is implied.

## BR-021 — Selective local MCP, Dobot and vase-wall adoption

- Work date: 2026-09-09. First committed record: `8158312` (2026-09-09T18:41:35-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-09, legacy-adoption session. Authorized restoration of MCP access, Dobot machine/Lua support and vase-wall through the reset's interoperable shared workflow. The subsequent single-location clarification defers automatic discovery; see [D-022](DECISIONS.md#d-022--defer-automatic-capability-discovery).
- Implemented: a local SDK stdio MCP adapter with fixed known profiles/manuals, persistent named Prints, revision-checked adjustments, shared checks and Studio review, fresh approval status, approved generation and exact-byte delivery. It has no approval tool, alternate compiler/review server or global plan overwrite. Local client setup is documented; arbitrary browser-chat access and automatic client configuration are not implemented.
- Implemented: Dobot profile and bounded Lua export/interpreter using the same SAAMpath, native geometry, three human approvals and delivery. Installation defaults remain unconfigured. The selected CP=0 relay policy stops at each segment and reports estimated material separately from intended bead volume. Delivered ZIP packages source files; vendor project import, controller execution and physical behavior are unverified. See [Dobot scope](core/export/dobot.md#dobot-output-contract).
- Implemented: [vase-wall](skills/vase-wall/SKILL.md) queries actual changing-Z sections on supported mesh/untrimmed spline geometry, optionally above a full-fill base, through the common composer and export lifecycle. It requires one supported convex outer section without holes/islands and enforces bounded standoff, overlap, angle and sampling checks. Other unsupported topology and trimmed CAD remain outside its scope.
- Verification: final `npm test` passed all 131 software tests and repository checks. Coverage includes Lua semantics/rejection, shared skills and bounded wedge, both geometry backends, S5/H2D/configured Dobot paths, actual SDK subprocess clients, current approval binding, stale revisions/artifacts and exact reviewed-byte delivery. All approval/calibration fixtures are explicitly synthetic in temporary bundles; no physical validation is claimed.
- Follow-up source clue: the other developer suggested “textured or patterned wall”. Searches for those terms in messages, historical diffs and archives found no implemented match. `f015cf1:ROADMAP.md` calls vase/spiral-wall strategies the private source project's most-developed pattern family, strengthening that source lead; this does not identify either sample or establish that its source was lost.
- Approval scope: this records authorized work and implementation status, not either contributor's unstated agreement or a real manufacturing-job approval. Further legacy adoption still requires specific authorization.

## BR-022 — Same-part skill composition correction

- Work date: 2026-09-09. First committed record: `8158312` (2026-09-09T18:41:35-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, this legacy-adoption session: full interoperability between ecosystem components wherever possible, including same-part skill composition. Acceptance example: flat base/vase wall, flat cap, normal walls/infill to a wavy roof, drape, then full fill above the drape with a wavy bottom. User confirmed that final fill uses horizontal layers.
- Implemented: shared material-region assignments, per-region skill settings, component layer grids, material ownership/dependencies, level vase ending with tapering final-turn deposition, and producer-bound lower surfaces for subsequent horizontal fill. The existing skill generators, geometry, SAAMpath, exporter and three-approval lifecycle remain shared.
- Corrected audit findings: spatial roof reservation no longer truncates unrelated taller components; first drape gap uses actual supporting layers including translated geometry; numerical mesh-top roundoff no longer drops a valid final layer. Consumed surfaces and their coverage/order are checked instead of inferring compatibility from skill names. Fully reserved bodies are rejected, and inward offsets collapse thin remnants instead of allowing acute miters to escape the source material.
- Corrected workflow gaps: shared remembered-default/STL-import helpers, MCP import/upgrade/setup/path-check/guidance tools, safe nested print names matching Studio, geometry bounds in MCP summaries, CLI revision guards and consistent geometry-only checks. Studio shows effective regional settings, surface references, support choices, pattern settings, dependencies and robot calibration/workspace parameters.
- Verification: final `npm test` passes all 156 software tests and repository checks. Includes the requested stack across S5/H2D/configured Dobot and mesh/spline geometry, per-move exported coordinates/material, the complete regional spline/S5 synthetic approval/Studio/exact-delivery workflow, spatial reservations, offset remnants, surface coverage and access parity. Studio's regional settings were also checked in the browser with a software-only fixture. The full suite took about six minutes; the user deferred broader speed work to the next cycle.
- Remaining boundaries: supported height-field surfaces, bounded numerical section/gap sampling, vase convex sections and continuous-stroke chronology, explicit experimental bridging, and actual machine output constraints. Dobot's fixed-rate relay cannot meter arbitrary variable bead volumes; commanded intent and modeled relay output remain separate. No blanket assertion that every physical combination is printable, no automated support/collision proof, and no physical validation is implied.

## BR-023 — Slicing performance baseline

- Work date: 2026-09-09. First committed record: `d7acfc3` (2026-09-09T22:47:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Requested by: user, 2026-09-09. Start the speed cycle with equivalent spline/mesh tests, use a twisted box and multiple slicing skills, compare planar slicing with Cura/Bambu Studio, and recommend subsequent optimizations/diagnostics.
- Implemented: opt-in reproducible developer benchmarks over shared geometry queries, full-fill, planar-infill, draped-skin, composition, machine checks and export/interpretation; analytical fixture checks, Rhino 6 exchange files, sampled mesh convergence, STL precision diagnostic, serial repeats and phase/failure reporting. Commands, boundaries and findings are in [slicing speed benchmarks](scripts/bench/README.md#slicing-speed-benchmarks).
- User reference: standard Rhino-exported STL (1078 triangles); Cura 4.12 reported 14 seconds to load and 2.3 seconds to slice with two walls and 100% infill. Loading and slicing are separate, and non-planar work is excluded from the Cura comparison.
- Findings: direct spline section/height queries are slower than modest meshes, but complete planar full-fill can be faster because mesh contours amplify downstream region work. The supplied mesh reveals an offset/index memory blow-up and a solid-mask boolean failure. Keep failures separate from successful timings; the test does not justify switching native geometry architecture.
- Boundary: developer measurements do not add a public twisted-box shape, create job approvals, demonstrate physical prints, or establish a controlled overall speed ranking against external slicers. Bambu Studio timing and matched public-workflow load/check/generation measurements remain next-stage work. Existing production geometry, skills and review semantics are unchanged by the benchmark additions.

## BR-024 — Remove vase heuristics and bridge permission policy

- Work date: 2026-09-09. First committed record: `d7acfc3` (2026-09-09T22:47:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-09, explicitly in developer mode. Remove the turn-overlap gate unless evidence establishes recurring slicing defects it catches; make compute-budget exhaustion obvious and easy to raise; explain tolerance coupling; treat level-ending selection and bridge feasibility as maker guidance. The earlier maker's bridge comment did not authorize changing skill policy.
- Implemented: removed the per-point previous-turn section/radial-overlap calculation and regional bridge-permission gates, including foundation-ring support coverage. Older `supportPolicy` fields are inert compatibility data. New recipes and Studio omit the policy. This supersedes BR-021's overlap gate and BR-022's experimental bridging restriction.
- Implemented: vase point budgets retain a 100000 default with no preset 200000 ceiling; exhaustion identifies usage, region, height and the setting to raise without degrading contour quality. Contour subdivision and numerical boundary allowances are separate settings; older recipes normalize their prior boundary allowances explicitly.
- Guidance: choose a level ending for a flat cap while proposing the recipe. Developer checks must justify their compute cost and false rejections with concrete failure evidence. Ask the user when a gate's value is ambiguous in toolpathing, geometry, extrusion or 3D printing; this reflects their stated expertise, not a blanket requirement to ask about every software check.
- Scope: shared region, skill, review and export pipeline; no new approvals, changed real-job geometry, physical validation or machine execution.
- Verification: all 165 repository software tests pass. The public path check also passes for a development copy of the full twisted house at 0.2 mm pitch, 0.02 mm contour tolerance and three cap layers, with 241074 wall points under a 400000 allowance and no bridge policy.

## BR-025 — Shared Clipper and surface offsets

- Work date: 2026-09-09. First committed record: `d7acfc3` (2026-09-09T22:47:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, this offset-function task. Adopt the trusted `ClipperComponents 0.3.2.0` offset identified in `offset.ghx`; keep the general intersection-engine decision separate. Build shared planar and surface offsets, migrate existing skill offsets, avoid repeated inverse mapping, and guide authors toward robust established algorithms with measured performance. Development checks were authorized with the existing cost guidance retained.
- Implemented: pinned Clipper 6.4.2 JavaScript port behind `core/region/offset.mjs`; upstream construction, winding/union cleanup and topology reused. Material-region semantics deliberately use closed polygons rather than the Grasshopper wrapper's closed-line band mode. Input normalization and Clipper's simple-loop cleanup handle nesting and point-touching components. Removed the previous offset/pruning/splitting implementation; compatibility export aliases the shared function.
- Integrated: full-fill, planar-infill, draped-skin's existing projected footprint, vase-wall, shared combing/rim coverage and the bounded wedge's section/roof insets. The wedge remains its eight-point generator. Runtime identity includes the adapter and installed Clipper source/lockfile. General intersection functions were not replaced.
- Implemented experimentally: `offsetSurfaceRegion` generates distance-based geodesic strips/round joins from a native spline patch, then uses actual Clipper union/difference/winding code for material topology. UV and cached XYZ correspondences stay attached; no inverse mapping or global flatten/warp round trips. Surface-distance code is new SAAM implementation, not a copy of Rhino's unavailable native routine. Single regular C2 patch, closed UV loops and bounded domain are the current scope; no skill silently adopts it.
- Evidence: the JavaScript adapter exactly matches every coordinate and loop in 90 cases generated by the unmodified plugin C# Clipper 6.4.2 kernel using the same material-region adapter options. Surface tests include analytic derivatives, flat nesting/collapse, inclined-plane UV rescaling, independent cylinder unrolling, and convergence of nested regions on a doubly curved patch. No Rhino surface-output comparison or physical validation has been performed.
- Diagnostic: the supplied 1078-triangle Rhino STL passes every full-fill layer in the offset diagnostic. Its separate solid-mask intersection still produces an open contour; that known failure is not hidden or fixed by adopting the offset.
- Guidance and measurements: [shared numerical foundations](core/geom/README.md#shared-numerical-foundations) and [offset contracts](core/region/README.md#shared-offset-functions) record provenance, precision, limits, reference reproduction and opt-in timing. Baseline `npm test` passed 170 tests; final `npm test` passes all 180 tests and repository checks, including mesh/spline, S5/H2D/configured Dobot, public workflow and exact export/delivery regressions. The documented .NET reference project also builds successfully. No contributor consensus, human manufacturing approval, commit or publication is inferred.

## BR-026 — Temporary web-chat connection

- Work date: 2026-09-09. First committed record: `d7acfc3` (2026-09-09T22:47:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-09 local time, requested immediate ChatGPT and Claude web access to the existing implementation and a temporary locally run relay. See [D-024](DECISIONS.md#d-024--temporary-web-chat-access-to-the-existing-local-workflow); packaged applications remain deferred.
- Implemented: a Streamable HTTP/JSON bridge forwarding the existing MCP tools to one local adapter, OAuth SDK routes with local pairing, client-bound PKCE grants, expiring tokens/refresh rotation/revocation, and a launcher for an outbound temporary HTTPS tunnel. Studio, its approval routes and print files remain local.
- Verification: 180-test baseline passed; the final full run passes 182 tests. One existing stdio workflow test failed and the first full run stalled; that failure did not reproduce in its targeted rerun or the full rerun. SDK HTTP/OAuth tests exercise unauthorized access, origins/redirects, PKCE/replay/resource checks, rotation/revocation/expiry, two clients sharing state, retained Studio lifetime, approval gates with isolated synthetic fixtures, and exact-byte delivery.
- Public connection check: verified a temporary Cloudflare endpoint with OAuth/PKCE, 18-tool discovery and read-only maker guidance; unauthenticated MCP was rejected and the Studio approval route returned 404. No real print was changed. The user is driving their external browser; Claude reached the pairing page but reported "Invalid origin". Actual vendor connection acceptance remains pending.
- Browser pairing correction: reproduced the native form's `Origin: null` under `Referrer-Policy: no-referrer`. Switched to `same-origin` and allowed the SDK-validated callback origin in the authorization page's form policy, which Chromium also applies to the OAuth redirect. A disposable browser fixture now completes the form and cross-origin callback; absent, null and foreign origins remain rejected.
- Alpha onboarding follow-up: user chose an uploadable Claude plugin, prioritizing onboarding over ChatGPT's developer-mode connection test. The launcher now builds a ZIP containing the connector address and a maker skill that reads current guidance through MCP. The package excludes local credentials and files and does not install or start SAAM. Claude upload acceptance and actual tool use are still the user's external-browser test; a stable shared alpha service is not implemented.
- Follow-up verification: `npm test` passed before the pairing/plugin edits (191 tests) and afterward (195 tests in the concurrent working tree). The plugin CLI/archive regression, independent Python ZIP check and skill validation passed. Restarted the temporary bridge and verified public OAuth/PKCE, 18-tool discovery and read-only maker guidance again. The browser fixture completed a native form submission and cross-origin callback; real Claude plugin upload remains the next user-driven check.
- Limits: single installation, temporary credentials/URLs, same-computer Studio review and delivery, and tunnel/client timeouts for long calls. No packaged app, multi-user hosted service, automatic connector installation, hardware action or physical validation.

## BR-027 — Minimal shared Clipper2 intersection tool

- Work date: 2026-09-09. First committed record: `d7acfc3` (2026-09-09T22:47:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-09 local time, authorized building/testing a Clipper2-based tool, replacing existing skill operations when tests pass, and updating documentation. Scope shared components to current needs and extend them when necessary; consider CGAL only if the Clipper2 tests are insufficient.
- Implemented: closed planar material-region intersection, union and difference behind one small adapter to pinned `clipper2-wasm@0.4.0` (upstream C++ Clipper2 2.0.1). Existing shared imports route full-fill, planar-infill, draped reservations and regional composition through it. The handwritten general booleans were removed; established offset kernels and sampled section/level-set constructors retain their scope. No open-path, 3D, CAD, UV intersection API or alternative backend was added.
- Integration correction: accurate booleans exposed artificial corner gaps from coarse bead-coverage arc approximation. Coverage expansion now uses the existing 0.001 mm chord target instead of hiding gaps with area pruning. Runtime identity hashes the actual JS/WASM bytes. Tests compare decoded numeric areas within declared precision while retaining exact upstream reference comparisons.
- Evidence: 138 cases match unmodified upstream C# results exactly, including coordinates and topology; analytic/adversarial tests and 200 seeded rectangle-set cases pass. The original 1078-triangle Rhino STL passes every offset/solid-mask diagnostic layer. Full, planar and draped benchmark modes pass for both spline and that STL. The actual public STL importer, adjustment, development generation/export and cold CLI reopen also pass, with no human approvals or delivery.
- Guidance: [minimal component scope](core/README.md#interoperability-and-one-workflow) and [intersection contract, provenance and reference reproduction](core/region/README.md#shared-planar-intersections). No CGAL was needed, and no physical validation or contributor consensus is inferred.
- Verification: baseline `npm test` passed 182 tests; the final suite passes all 195 tests and repository checks. Includes S5/H2D/configured Dobot, both geometry backends, same-part skill composition, MCP/Studio synthetic approval workflows and exact-byte delivery. Development source changes remain uncommitted.

## BR-028 — Travel above deposited material

- Work date: 2026-09-09. First committed record: `d7acfc3` (2026-09-09T22:47:54-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, this travel task: use the current highest thing on the bed plus clearance; allow zero and default to 1 mm.
- Implemented: one shared `PathBuilder.travelTo` for full-fill, planar-infill, draped-skin, vase-wall and the bounded wedge. The wedge retains its eight-point geometry and nearby-start policy; shared motion replaces its duplicate travel/retraction implementation.
- Height follows both endpoints of each emitted positive-volume segment across the print, including prime lines and sloped strokes. Lifted travel, cooling and final SAAMpath parking use deposited maximum plus `process.liftMm`, floored at departure/destination height. Future strokes, unselected geometry and non-depositing lifts do not increase material height. New recipes default to 1 mm; existing explicit settings remain locked values.
- Updated skill/developer manuals, wedge runtime identity and H2D context validation so actual print-body height may be below unprinted geometry. H2D firmware service/shutdown heights retain their fixed export contract. Existing direct/combed policies remain; no fixture sensing or swept-head collision model is added.
- Verification: baseline `npm test` passed 195 tests; final suite passes 199 tests and repository checks. Regression coverage includes rising/falling strokes, within-operation chronology, taller-to-lower transitions, repeated cooling/parking, zero-clearance S5/H2D shell and wedge export round trips, unselected tall geometry, and the existing configured Dobot/public workflow checks. No physical validation or human manufacturing approval is implied.

## 2026-09-09 — Initial slicing benchmark findings

- Date basis: Explicit run date in the original report.
- Original owner: [scripts/bench/README.md](scripts/bench/README.md). Preserved observation/checkpoint wording follows.

The initial 2026-09-09 run found slower direct spline queries but faster **planar
full-fill** than the generated twisted meshes. The 24 mm spline took roughly
0.34–0.40 s, versus 0.76 s / 2.10 s / 5.77 s for 768 / 3072 / 12288 triangles
at the three mesh targets. The doubled fixture took 1.17 s for splines and
14.13 s for its 12288-triangle 0.025 mm mesh. These are prepared-geometry skills
plus composition/checks, excluding export and public workflow overhead. The
mesh sections contain many more vertices, so downstream region work outweighs
their cheaper intersections. Existing planar-infill/region-reservation failures
prevent successful timings for several mesh combinations.

At the finer 0.00125 mm mesh target (49152 triangles), full-fill took 22.26 s
versus 0.39 s for splines in the same run. With the production planar-support
callback included, the non-planar body+drape pass took 18.42 s for splines and
5.00 s for the double-precision 3072-triangle mesh. The binary STL version
failed region reservation. The successful drapes do not have identical coverage:
faceted normals change the included skin area, so this is a backend diagnostic,
not an equal-output speed claim. Earlier pilot drape data in local reports used
the skill's default support callback and is superseded by `slicing-drape-final`.

The user's normal Rhino export has 1078 triangles. It passes mesh validation
and query checks but exposes a full-fill outward-offset/index blow-up at Z=12.2
mm and a solid-mask intersection failure between Z=0.2 and Z=0.4 mm. Do not
treat its failed generation as a speed measurement or disable checks to make
the comparison succeed. The user's Cura 4.12 report is 14 s to load and 2.3 s
to slice, two walls and 100% infill; the load boundary and layer height were
not specified. Record load and slice separately, and compare only planar full
fill with Cura. Non-planar measurements compare SAAM backends only.

Prioritize bounded/robust offset and boolean processing, then an explicit
error-bounded contour simplification experiment, indexed mesh Z/XY queries and
redundant spline height-solve diagnostics. Keep native spline input while testing
these shared-interface improvements. A language/runtime rewrite or forced mesh
conversion is not justified by these measurements. Measure public bundle
load/check/generate separately next, then repeat matched planar tests in Cura
and Bambu Studio with saved profiles, exact versions, thread counts and repeated
timings. No architecture decision or contributor approval is recorded by this
benchmark.

## 2026-09-09 — Clipper 6 and surface-offset measurements

- Date basis: BR-025 context; first committed record d7acfc3 (2026-09-09T22:47:54-07:00).
- Original owner: [core/region/README.md](core/region/README.md). Preserved observation/checkpoint wording follows.

Historical Clipper 6 Windows/Node 24 measurements were about **0.67 ms** warm median for
the 16-vertex nested planar case, **35 ms** for all 90 planar cases, and **18 ms**
for the four-vertex cylinder offset at 0.005 mm tolerance (1287 evaluations,
zero inverse mappings). The runner reports cold time, three warm samples,
source/output hashes and usage. These small fixtures establish local costs,
not a general speed ranking; complex surface offsets remain more expensive.
The original Rhino STL now passes all full-fill layers in the offset diagnostic;
its separate solid-mask intersection failure was subsequently resolved by the
shared Clipper2 tool below.

## 2026-09-09 — Intersection and twisted-fixture measurements

- Date basis: BR-027 context; first committed record d7acfc3 (2026-09-09T22:47:54-07:00).
- Original owner: [core/region/README.md](core/region/README.md). Preserved observation/checkpoint wording follows.

A historical initial Windows/Node 24 run took about 15 ms to import/initialize the adapter,
27 ms for the first 138-case batch and 9.3 ms warm median over seven repeats.
The benchmark records CPU, Node, samples and source/output hashes. These are
local software measurements, not universal speed or physical-print claims.

The follow-up twisted-fixture run passes full-fill, planar-infill and draped
generation/export/interpretation for both native splines and the user's original
Rhino STL. Prepared-geometry warm median slice times were approximately
0.35/0.61/17.82 s for spline full/planar/draped and 1.17/1.34/2.02 s for that STL,
three repeats per mode. Different draped coverage remains a backend limitation,
so these are not equal-output surface-speed claims. Results are ignored local
data in `.local/intersection-slicing/`. The public STL import/adjust/development
generation workflow also passes all three modes; a cold CLI reopen verifies the
last export. No job approval or physical validation was performed.

## 2026-09-09 to 2026-09-10 — H2D reference and startup checks

- Date basis: explicit dates in core/export/bambu.md; BR-018 and BR-019 preserve
  the implementation and physical report.
- The user supplied Bambu Studio 02.08.02.61 right/left sliced exports on
  2026-09-09. Only envelope and format facts informed the implementation.
- The installed Bambu Studio CLI model-import (`--info`) check reported -6,
  "The input model file to the slicer can not be parsed," for the reference and
  generated archive, including a retry outside the sandbox. This did not test
  the program-viewer route or execute a printer. Independent viewer acceptance
  remained unconfirmed.
- On 2026-09-09 the first physical attempt reached the part, but the user reported
  severe over-extrusion on flat layer two. The delivered body used cumulative
  `M82` instead of the reference's relative `M83`. The exporter correction and
  second-layer regression did not establish a successful physical retest.
- On 2026-09-10 the user requested removal of startup triage item H10: initial X
  homing, early wiping-area moves, `M972 S24` and the `M1009`-bracketed
  Z-clearance/center-positioning/Z-homing sequence. Revision 4/v2 omitted those
  13 lines; adjacent object/bin checks and later probing/calibration/priming
  remained. Physical testing of that revision was still required.

## 2026-09-09 — Intersection construction correction

- Date basis: BR-027 context and checkpoint `d7acfc3`
  (2026-09-09T22:47:54-07:00); preserved from core/region/README.md.
- Full-fill's former 0.02 mm bead-coverage chords left four artificial corner
  gaps totaling about 0.000252 mm² in a rectangular solid top. The handwritten
  boolean's area pruning hid them. The construction used the existing 0.001 mm
  chord target to resolve the gaps without deleting material or changing
  deposition strokes.

## BR-029 — Flange toolpath size, ordering and Studio visibility

- Work date: 2026-09-10. First committed record: `f52c524` (2026-09-10T00:39:19-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user switched this flange task to development and requested removal of the arbitrary file-size cutoff, shared region ordering around holes, straight-line compaction in all skills, nearby-stroke travel reduction, and clearer geometry/toolpath views.
- Implemented: incremental text/chunk parsing in the common Griffin/H2D modal reader; removed the 25 MB G-code and 64 MB ZIP policies while preserving command, archive-integrity and actual ZIP32 representation checks. Bundle/playback objects still scale with job size in memory; this is not fully streamed artifact storage or paged browser playback.
- Shared scanline ordering now completes uninterrupted row cells on each side of holes/concavities as well as disconnected islands. PathBuilder compacts compatible collinear commands for every skill and uses direct non-extruding repositioning for permitted gaps within 1 mm. Hole, surface, previous-operation, process and flow boundaries remain meaningful.
- Studio hides mesh edges below a 3-degree crease angle, shows no part geometry in toolpath view, and emphasizes the current layer over faded previous layers. Changes use the same Studio/export/review lifecycle.
- Baseline: 199 tests passed. The original full-size flange generated 37,843,427 G-code bytes, 15,389 retractions and 547,974 mm of travel. Ordering alone reduced this to 1,888 retractions and 73,837 mm of travel without changing deposition strokes. Development reproduction retains the original dimensions in an isolated local print, without human job approvals or physical validation.
- Verification: all 211 tests and repository checks pass, including files over 25 MB, an archive member over 64 MB, chunk-boundary/modal/error handling, scanline coverage and S5/H2D round trips, straight-run semantics and nearby travel. The final original-size flange passes public development generation/export checks: 28,360,548 bytes, 596,728 interpreted moves, 1,884 retractions and 73,829 mm of travel. Studio was restarted on the isolated development bundle and visually checked in geometry and toolpath views. No real job approval, delivery, machine execution or physical validation was performed.

## BR-030 — Export-only bundles and measured flange speed

- Work date: 2026-09-10. First committed record: `f52c524` (2026-09-10T00:39:19-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-10, requested implementing the Cura comparison findings and remeasuring the same flange. Scope includes shared contour cleanup, modal G-code output, removal of mandatory saved SAAMpath and regeneration on Studio reopen, and applicability across skills. [D-027](DECISIONS.md#d-027--export-only-print-persistence) records the persistence direction and its approval boundary.
- Implemented: mesh sections remove numerical triangle seams before offsets with the existing 0.0000001 mm plane tolerance. Full-fill/planar-infill reuse that helper on offset deposition contours; closed-region boolean results retain the original Clipper contract. Corners, reversals, narrow features and cumulative curvature are covered by regression tests. No curve-resolution, offset precision, geometry dimension or locked process setting was relaxed.
- Shared S5/H2D motion output omits unchanged XYZ/feed fields and retains explicit extrusion values and mode. Bounds/feed/flow checks run on interpreted export commands, including selected-tool bounds. Exporter round-trip comparisons remain regression tests. Dobot checks reconstructed Lua commands through the shared machine checker.
- Bundles save the export, check report and small generation summary, with transient motion objects retained only while generating. No new SAAMpath file/hash is written; regeneration removes a legacy intermediate. Cold opening interprets the saved export without invoking the generator or exporter. Playback and delivery use that export. Plan/export identity still controls stale approvals; editable local hashes are not authenticated provenance signatures. A complete replacement of transient motion objects with G-code, streaming generation and paged playback are not implemented.
- Measurement fixture: original 88.9 mm diameter, 25.4 mm tall flange, 6.35 mm plate, four walls, 35% infill, 0.2 mm layers and five top/bottom layers. The isolated `Prints/pipe-flange-speed-review` copies the exact plan, machine and geometry from the previous flange bundle, with no human approvals. Cura's supplied four-wall/35% file is 4,879,289 bytes and uses two top/bottom layers, so it is a comparison rather than an identical process plan.
- Final export is 15,551,433 bytes and 422,708 interpreted moves, versus 28,360,548 bytes and 596,728 moves before this change. The previous 183,926,147-byte intermediate is absent. A serial same-input generation/export/interpretation benchmark measured 91.27 seconds before and 41.06 seconds after (55% less time); the isolated baseline loader reproduced the old export byte-for-byte. Generation alone measured 80.03 versus 33.31 seconds. Separate final bundle generation/check/save trials took 43.94 and 51.89 seconds; cold Studio state requests took 12.92 and 13.32 seconds, including interpretation, serialization, HTTP transfer and JSON parsing, but excluding browser painting. Timings varied with machine load. The response still contains about 123 MB of interpreted move objects, and the 15.55 MB export still exceeds Cura's 4.88 MB; this is an improvement, not performance parity. Raw scripts/results are in ignored `.local/flange-dev/`.
- Verification: final `npm test` passes all 214 tests and repository checks. Coverage includes all skill families, S5/H2D/configured Dobot output, numerical seams and curvature, modal fields and extrusion round trips, cold/warm reopening without generation, legacy intermediate removal, edited exports, synthetic approval invalidation and exact-byte delivery. The new development bundle passes export checks and retains byte-identical plan/native geometry inputs. No human approvals or machine execution were added.

## BR-031 — Studio plays machine source in the browser

- Work date: 2026-09-10. First committed record: `f667205` (2026-09-10T02:51:13-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user requested replacing expanded motion JSON transport with a G-code player without breaking Studio, and clarified that Dobot must play the actual Lua that will run. Existing work was checkpointed first as requested.
- Implemented: a small state response plus exact checked source downloads. S5 sends its G-code; H2D sends the unchanged G-code member of the checked 3MF; Dobot sends each unchanged Lua file from the checked ZIP. Print/revision/export identity and per-source hashes bind loading to review. Archive validation and byte-identical delivery remain in the common workflow.
- Browser workers use the same G-code/Lua interpreters as export checks, with compact chunked numeric storage for local drawing/timing. No move/event JSON crosses the server/browser boundary, and no replacement path file is saved. H2D firmware routines remain outside simulated playback; Dobot retains actual Lua execution and modeled Cartesian acceleration. Geometry, settings, approvals, travel visibility, layer emphasis and the renderer remain shared. Full paged playback and replacement of transient generation SAAMpath remain outside this change.

## BR-032 — Infill choices and judgment-assigned supports

- Work date: 2026-09-10. First committed record: `f667205` (2026-09-10T02:51:13-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user requested four additional infill choices, standard and tree supports, and two rimming skills comparing horizontal versus surface-normal offsets of an assigned bivariate spline surface. [D-025](DECISIONS.md#d-025--support-areas-assigned-through-judgment) records the explicit prohibition on automatic whole-part angle-based support assignment.
- Implemented: grid, triangles, concentric and gyroid alongside existing rectilinear infill, using shared material regions, offsets, Clipper2 open clipping and full-fill stroke generation. Gyroid field-contour assembly reuses spatial endpoint buckets; an isolated 16-phase 48 mm square measurement fell from 24.604 s to 1.175 s without changing measured average density. Pattern manuals describe tradeoffs and numerical limits.
- Implemented: explicitly assigned standard footprints and authored tree skeletons with shared wall/interface ownership. Trees are an initial SAAM branch producer, not Bambu's automatic router. No upstream slicer source or skill prose was copied.
- Implemented experimentally: rimming-planar and rimming-normal share spline sectioning and adaptive section offsets at 0.5 and 1.5 line widths. Bed/edge bases, curved boundaries and outward lean are supported within the manuals' control-net limits; 45 degrees is guidance only. No conventional top gap is introduced. Normal offsets report height shifts; automatic endpoint correction and physical bead/contact validation remain open.
- Ordering clarification: both rim skills wait for the entire base edge, and the entire rim finishes before any supported feature starts. The shared composer favors similar actual deposition heights among ready operations, subject to dependencies and selected batching. Rim pairs still use increasing original horizontal intersection height. Atomic operations remain intact; component bindings conservatively approximate edge ownership and do not infer arbitrary CAD edge matches.
- Integration: common plan, regional composition, fixed MCP manuals, Studio settings, transient motion, machine exporters and export-only bundle lifecycle. Development comparison bundles exercise both offset metrics without manufacturing approvals. Final focused verification passes 102 software tests, including sloping-edge completion and physical-height scheduling regressions; repository documentation checks also pass. No physical print, machine execution, contributor consensus, commit or publication is inferred.

## BR-033 — DENSO RC8 rotary pipe demo

- Work date: 2026-09-10. First committed record: `8b147cb` (2026-09-10T12:03:01-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user requested a transferable robot/rotary pipe demo through the existing ecosystem, then selected the DENSO VP-6242 and confirmed RC8. Ceiling mounting with robot base axis coaxial with the rotary is provisional. User authorized implementation and explicitly deferred robot reach, IK solving in SAAM, joint/motion-limit checks and collision avoidance.
- Implemented: native annular mesh recipe; full-fill concentric substrate using shared sections, offsets and Clipper2; alternating axial/helical radial shells with inward/downward 45-degree nozzle orientation. The shared composer retains its scheduler and explicit dependencies; point-aligned poses and unwrapped rotary angles extend its existing stroke/motion boundary. Ordinary fixed-axis skill paths continue through the same writer and output registry.
- Implemented experimentally: VP-6242 / RC8 profile, literal PacScript source ZIP, bounded interpreter of actual T/EX/TIME/IO commands, and part/room coordinate transforms. Studio plays those exact sources with a rotating bed or Follow build plate view and nozzle direction, without invented arm joint animation. Setup identity, checks, MCP catalog, approvals, cold reopening and exact-byte delivery use the existing lifecycle.
- Limits: actual rotary interface/calibration and controller source compilation remain unverified. The development fixture explicitly assumes RC8 relative EX extended-joint control; a separately controlled rotary needs an execution adapter. Nominal timing assumes external speed 100% and synchronized linear command progress; @0 endpoint stops, acceleration, IO and relay deposition are not physically established. Constant relay rate and commanded bead-volume intent remain distinct. General cylindrical CAD recognition, radial material-region assignments and arbitrary oriented stroke reordering are unimplemented.
- Development result: `Prints/development/denso-rc8-pipe` contains a 16 mm bore, 20.8 mm outside diameter, 12 mm high pipe with 1.6 mm substrate and four 0.2 mm radial shells. Current export has 56,988 interpreted moves and 27.7 minutes of requested motion. Synthetic calibration is labeled and is not retained as user setup. Studio was launched for the user and visually inspected at axial and circumferential portions and in both coordinate perspectives. No manufacturing approvals or hardware execution were performed.
- Verification: seven focused RC8 tests pass, including mesh/spline base-vase-cap-infill-drape composition, bounded wedge, native pipe on S5, full-turn source reconstruction, orientation preservation, radial order/ownership, cold reopen and synthetic approval/exact-byte delivery. The first broad regression attempt reported an MCP test failure and stalled; that test passed immediately in isolation. The complete rerun with concurrency 2 and a 120-second test timeout passed all 261 tests in 71.2 seconds; repository documentation checks also pass. No contributor consensus, staging, commit or publication is inferred.

## BR-034 — Shared Studio permissions for Codex and Claude Code

- Work date: 2026-09-10. First committed record: `8b147cb` (2026-09-10T12:03:01-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user requested repo-shared permission scope for agents to open, use and close their Studio instances without repeated prompts, then authorized implementation for Codex and Claude on 2026-09-10.
- Implemented: a trusted-project Codex rule and shared Claude Code Bash/PowerShell rules for `node studio/server.mjs`, with a matching Claude Bash sandbox exclusion. [Studio permissions](studio/README.md#studio-agent-permissions) owns setup, direct launch and instance closure.
- Scope: project trust and browser permissions remain client-owned; restrictive policies still apply. Rules trust the script and its imports and do not create an OS-level Studio-only boundary. Claude Desktop/web MCP setup and the three human manufacturing approvals remain separate.
- Verification: the installed Codex CLI accepts the rule's positive/negative examples, allows the Studio launch and leaves inline Node execution unmatched. Claude settings parse as JSON and use documented rule forms; Claude Code is not installed here, so live Claude behavior and browser permission persistence across ports are unverified.

## BR-035 — Studio movies, material rendering and color comparison

- Work date: 2026-09-10. First committed record: `8b147cb` (2026-09-10T12:03:01-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user requested offline movie export matching Studio's selected speed, camera, visibility, rotary view and fade, followed by viewer material and color refinements.
- Implemented: deterministic 30 fps WebM export without live playback; shaded oval current beads; completed layers retain source curves using cached instanced rectangular sweeps. Old layers retain 50% opacity with gentle color fading. Normal two-second fades shorten only when the next layer arrives sooner. Material estimates use the requested fixed 1.2 g/cm³ conversion to grams.
- Color comparison: lighter sky-blue body and six successive axial colors (sky blue, teal, lime, lavender, rose, silver), with orange circumferential layers. Named viewer buttons jump to each sample. At the user's request the local development pipe now has a 22.8 mm outside diameter, unchanged 16 mm bore and 12 mm height, 1 mm substrate, and twelve 0.2 mm outer shells (six axial and six circumferential).
- Verification: focused viewer/movie/material tests and repository checks pass; the updated pipe regenerates and reopens through the shared checked development lifecycle with 100,472 moves. Browser inspection verified the color sample controls and rendering. No manufacturing approvals, hardware execution or physical validation were performed.
- User color selection: sky blue (slightly darkened), orange, teal and lavender are recorded as the visually verified set, with other colors allowed when needed. Final assignments are sky-blue body, orange circumferential shells and teal axial shells. The current pipe has three body loops per layer (1.2 mm substrate), 23.2 mm outside diameter, unchanged bore/height and twelve outer shells. Full-fill's existing interior-stroke hook supports odd native-pipe loop counts when separate perimeter bands are disabled; positive perimeter settings retain the prior behavior. The remade export has 100,449 moves. Twenty focused RC8/viewer tests pass, including three-loop coverage through composition and actual source interpretation.
- Geometry-view follow-up: user requested all proposed visual improvements and assigned the skill fix to another task. Geometry now uses opaque shaded sky-blue surfaces, smooth curved normals with crisp corners, subtle ground shadow, quiet outlines and selective highlighting. The user then requested restoring the original grid contrast. Picking uses depth at the pointer, including open bores. Twenty focused geometry, camera, visibility and material tests pass. This follow-up does not change skills or regenerate the print.

## BR-036 — Closest-entry ordering for segmented fill

- Work date: 2026-09-10. First committed record: `6b9ebdb` (2026-09-10T14:53:09-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-10, requested a simple closest-entry implementation and review on the flange before considering more complex routing. [D-026](DECISIONS.md#d-026--closest-region-entry-first-defer-heat-considerations) records the explicit deferral of heat considerations. Writing was authorized after the user's remote sync completed.
- Implemented: shared scanline cells retain their identity through full-fill, rectilinear/grid/triangle infill and draped-skin generation. Within each operation, the composer selects the closest endpoint of either end row (up to four entries), completes that cell, then repeats. Row order and stroke direction vary independently, preserving segment volumes/metadata. Stable ties retain producer order. Existing support/layer dependencies and travel checks remain in effect.
- Scope: straight-line XYZ distance only, without lookahead, travel-time scoring or heat balancing. No reordering across operations. Closed concentric/gyroid paths, the bounded wedge and oriented/continuous operations retain existing behavior. The shared lifecycle and machine exporters are unchanged.
- Flange comparison: the isolated `Prints/pipe-flange-closest-entry-review` uses the same plan and machine snapshot as `Prints/pipe-flange-speed-review`: 88.9 mm diameter, 25.4 mm height, 6.35 mm plate, four walls, 35% infill, 0.2 mm layers and five solid top/bottom layers. Current pre-change source was measured from Git HEAD through a scratch loader, without altering the checkout. Travel fell from 74,075.177 to 51,726.662 mm (30.2%); retractions fell from 1,888 to 1,587 (15.9%). Estimated export time fell from 377.3 to 366.7 minutes. Deposition length remains 386,043.527 mm and checked volume remains 30,883.482 mm³. Scratch measurements are in ignored `.local/closest-entry/`.
- Verification: 63 focused tests pass across scanline coverage/group integrity, closest entry, reversal of variable segment data, composer constraints, travel, mesh/spline skills, material-region stacks and S5/H2D/configured Dobot exports. The flange development export passes shared checks with 422,089 interpreted moves. No human job approvals, hardware execution, physical validation, staging, commit or publication were performed by this task.
- Correction evidence: the user's follow-up identified missed entries in playback near 5:08. The initial two-entry implementation coupled row order and stroke direction, leaving two valid starts unexamined. Regression tests cover the four-entry behavior above for odd/even row counts, unchanged geometric coverage, segment volumes/metadata and uninterrupted zigzags. Shared full-fill carries it into conventional/tree support fill and interfaces; concentric, gyroid, vase, rimming and bounded wedge ordering remain unchanged.
- Corrected flange: `Prints/pipe-flange-four-entry-review` retains byte-identical plan, machine snapshot and mesh inputs, with no approvals. Travel is 49,960.820 mm, retractions 1,437, estimated export time 364.0 minutes and interpreted moves 421,782. Deposition length and checked volume remain unchanged. All 71 focused tests pass, including support integration and the regional multi-machine/multi-backend stack; shared flange export checks pass.
- Jump investigation: in the earlier two-entry export, the jump near 12:55 starts at about 12:52.5 and travels 31.656 mm. Eight cells remain; the nearest of all four valid entries is still 28.028 mm away. The missing entries explain only part of this jump. Avoiding that late long transfer would require different earlier choices; lookahead remains deferred. These are straight-line entry distances, separate from the shared route/clearance handling.

## BR-037 — Bumpy spline substrate and surface cladding

- Work date: 2026-09-10. First committed record: `6b9ebdb` (2026-09-10T14:53:09-07:00); this is a checkpoint, not an exact completion timestamp.

- Requested: 2026-09-10, current user. Replace the proposed dogbone with a circular bore and a randomly bumpy 16-by-8 outer spline, approximately 2–8 mm full-fill thickness, three perimeters, and alternating horizontal/vertical normal-offset cladding including partial vertical passes.
- Boundary clarification: the latest request identifies the spline as the full-fill exterior. Cladding builds outward from that substrate. This supersedes the earlier dogbone discussion's finished-exterior/inward-reservation assumption for this demo.
- Implemented: native periodic cubic `spline-tube` geometry and rational circular bore; ordinary full-fill sections/perimeters; explicit native spline and mapped triangle-strip surface queries; shared normal-offset curve sampling; local arc-length cells with partial axial courses and circumferential helices. Existing composer, oriented travel, RC8 exporter/interpreter, bundles and Studio remain the workflow.
- Example: `Prints/development/denso-bumpy-spline`, 16 mm bore, 32 mm substrate height, sampled 2.00–7.99 mm radial thickness, three perimeters, six 0.2 mm cladding shells. First two body layers yield five perimeter loops each where opposing fronts meet locally. The first axial shell has 48 partial and 199 full-height passes. The geometry-only review copy is `Prints/development/denso-bumpy-spline-geometry`; approvals there are separate from the development bundle and are not copied.
- Supporting fixes: Studio obtains shaded bead normals from interpreted tool frames; its settings identify substrate versus finished-pipe boundaries. ZIP32 supports more than 64 source helpers. One streamed, revision-bound source inventory replaces per-helper archive reloads, retaining per-file browser hashes and exact-source interpretation. Chat adjustment can replace a null or differently typed surface selector through normal validation.
- Scope: one periodic rectangular surface chart and one full-fill substrate. Explicit mesh mapping is required. Automatic charting, arbitrary holes/multi-patch seams, inward volume reservations, general offset self-intersection resolution and robot feasibility remain unimplemented. Coverage and normal-field interpolation are experimental and documented in the cladding manual. No physical execution or manufacturing approval by the agent.
- Verification: full suite and focused surface/source/workflow checks; see the task report for final counts. No staging, commit or publication requested.

## 2026-09-10 — Gyroid contour construction measurement

- Date basis: BR-032 checkpoint f667205 (2026-09-10T02:51:13-07:00); exact run time is not recorded.
- Original owner: [skills/planar-infill/BUILDER.md](skills/planar-infill/BUILDER.md). Preserved observation/checkpoint wording follows.

A 48 mm square gyroid construction over 16 phases at 0.2 mm sampling and
0.4 mm line width measured 24.60 s
before and 1.18 s after in this checkout; mean line-volume fraction was identical
(20.52% for requested 20%). This measures contour construction/clipping only,
not full bundle generation, export or Studio. The manual owns pattern limits.

## 2026-09-10 — Studio color review

- Date basis: explicit date in studio/RENDERING.md and BR-035.
- The user verified sky blue, orange, teal and lavender as visibly distinct with
  Studio's shaded beads. Sky blue was reviewed at `#62a9df`; the requested slight
  darkening became `#5b9fd3`. This was visual feedback, not physical validation
  or contributor consensus.

## 2026-09-10 — Rimming specification clarifications

- Date basis: dated user specification in skills/rimming-planar/DEVELOP.md and
  D-025; related implementation is BR-032.
- The user requested comparison of horizontal and normal offsets on an assigned
  bivariate support surface. The agent's phrase “reference slice” meant a
  horizontal intersection curve on the original surface, not a new geometry
  object. Choosing that starting family was an implementation choice, not a
  requirement in the user's original definition.
- Subsequent instructions required the entire base edge before either rim and
  the entire rim before any supported feature, with similar printing heights
  among ready operations across skills. Physical contact was not established.

## BR-038 — General explicit STL self-intersection repair

- Work date: 2026-09-11. First committed record: `d8ed7a9` (2026-09-11T17:36:21-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user requested repair of a supplied spiral-vase STL before Bambu printing, confirmed millimeter units, and explicitly requested an original generalized mesh fixer rather than a vase-specific patch.
- Current implementation is documented at [explicit mesh repair](core/geom/README.md#explicit-mesh-repair). Obsolete implementation details and measurements were removed at Nave's request on September 14.
- Follow-up: On 2026-09-11 the user explicitly authorized zero-infill support and ordinary planar printing after clarifying that the source defines a solid envelope. Planar infill now accepts zero alongside the existing positive range, preserving walls and full-fill's selected solid masks. The proposed H2D print uses two 0.4 mm walls, 0.2 mm layers, five bottom layers and no top layers. The existing three human reviews remain; no continuous vase-wall operation is selected.

## BR-039 — Remove repeated validation and make slicing progress truthful

- Work date: 2026-09-11. First committed record: `d8ed7a9` (2026-09-11T17:36:21-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-11, reported minutes spent under approval-saving labels, cited an approximately eight-second Cura slice and set a 10–12 second target. Explicitly requested a delegated audit of all skills, durable guidance against unnecessary/repeated/misplaced checks, pan controls and developer awareness of avoidable travel. Travel awareness is guidance, not permission to add validation gates.
- Implemented: exact-content mesh validity reuse; workflow reuse of matching geometry/plan verification; approval writes return the updated verified state without another bundle load; planar slicing shares prepared mesh sections. H2D returns its already interpreted emitted body with the packaged bytes through the common export-and-interpret entry point and renders each thumbnail size once. Griffin removes the duplicate input-path pass; H2D removes a second per-move bounds pass already enforced by the shared interpreter. Dobot required setup validation no longer repeats its optional pass. Support/rim producers consume the validated plan; rimming native control-net validity is reused by content. New/changed geometry, plans and external exports still enter their owning validation boundaries.
- Guidance: [validation ownership](core/print/README.md#validate-at-the-boundary-that-owns-the-data) distinguishes input validity from conditions first knowable on a newly constructed section or machine command. [Travel guidance](core/path/README.md#whole-plan-travel-requirement) asks developers to consider endpoints, seams, wall/component order and short transitions while constructing paths, without quotas, rejection rules or another approval. Audit includes full-fill, planar-infill, drape, vase, supports, both rim modes, pipe/surface cladding and the bounded wedge.
- Initial measurement: the isolated old zero-infill recipe measured generation about 285 seconds before and 145 seconds after geometry/section reuse; Clipper offset/normalization remained a major cost. These measurements did not meet the requested 10–12 seconds. This initial change included no Clipper replacement or new seam algorithm; the later kernel migration is recorded in BR-041. The user subsequently changed the ordinary test print to 15% rectilinear infill with five top and bottom layers; prior recipe timings are not a benchmark of that new recipe.
- Viewer: the parent task adds pan, uses “Calculating toolpath” consistently, removes redundant status copy and keeps the busy spinner animated (with slower rotation for reduced-motion preference).
- Remaining audit work: direct shell/wedge generation still calls plan validation after workflow loading; expensive mesh validity is reused, but smaller settings checks can repeat. Spline placement rebuilds a shell and recomputes numerical closure under rigid translation, and selected surface construction repeats the selector's field validation. These remaining sites were identified but not changed during the already approved active generation. The audit must not be described as proof that all duplication is eliminated.
- Verification: 48 focused audit tests pass: 19 H2D/Griffin/modal/browser-source/wedge export checks and 29 support/rimming/Dobot/DENSO checks. Coverage includes fresh versus cold program equality, unchanged bytes, archive/setup tampering, changed control nets, caller mutation, skill composition and exact delivery. Repository documentation checks and whitespace checks pass. Parent workflow/mesh/section/viewer checks are reported separately with the task result. No agent-created manufacturing approval or hardware execution occurred.

## BR-040 — Dimension-aware precision audit and developer guidance

- Work date: 2026-09-11. First committed record: `d8ed7a9` (2026-09-11T17:36:21-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-11, explicitly requested another audit agent to find inappropriate or mismatched precision throughout the project and write guidance preventing recurrence. The comparison target remains roughly 10 seconds in Cura, not simply fewer decimal characters in files.
- Guidance: [precision belongs to a quantity and an operation](core/geom/README.md#precision-belongs-to-a-quantity-and-an-operation) covers coordinate grids, curve deviation, spatial sampling, repair resolution, coincidence/topology predicates, area/volume, UV parameters, angular tolerances, independent XYZ/E/feed/time/pose rounding and visual approximation. It records primary-source Cura examples as distinct quantities, suggests process-aware experiments and requires measured cost alongside shape/volume effects. This adds no production verification pass or approval.
- Corrected: the level-set constructor no longer compares area in mm² against a linear chord tolerance or silently discards small nonzero material. PathBuilder preserves short XYZ motions that remain distinct at the actual coordinate rounding, including tiny grid-boundary crossings; this repairs the next variable-gap segment's length/volume correspondence exposed by the parent's coarser offset-grid experiment. The existing regional physical-volume assertion was retained unchanged. Tolerance-module commentary now distinguishes native parameter units from mm and avoids claiming machine accuracy from a chord target.
- Verification: 9 focused regional/modal/straight-motion checks passed, including six-stage variable-gap composition across S5/H2D/Dobot and mesh/spline backends. After adding dedicated regressions, 25 geometry/straight-motion/draped-skin checks passed. Separate parent offset experiments and performance measurements are reported by that task; this audit does not establish the requested slicing latency.
- Remaining priorities: polygon coordinate/vertex budgets; dimensionally inconsistent and scale-dependent determinant thresholds in repair/projectors; UV-to-physical error mapping; separate export field budgets and accumulated relative-E error; tiny-segment volume handling for actual coordinate collapse; oriented-motion small-move policy. These are concrete audit findings, not an assertion that every tolerance should be coarsened. No print approvals, server restart, hardware execution, staging or commit occurred.
- Export follow-up: profiling found repeated formatting and modal self-parsing in the shared G-code writer. XYZ/E now quantize once for text, state and flow calculations; changed XYZ/F fields are emitted directly. A captured pre-change fixture preserves exact absolute/relative-E bytes across rounding, negative zero, modal changes, retraction and flow limiting. Nine focused modal/H2D/large-export checks pass. An isolated 20000-move benchmark retains exact bytes and measures median absolute output 167.2→82.6 ms and relative output 172.0→54.4 ms. These bounded measurements are not an end-to-end job timing; interpreter and packaging costs remain separate.

## BR-041 — Complete shared Clipper2 integration

- Work date: 2026-09-11. First committed record: `d8ed7a9` (2026-09-11T17:36:21-07:00); this is a checkpoint, not an exact completion timestamp.

- Source: user, 2026-09-11, clarified that the prior instruction applied Clipper2 to all skills and requested a timing comparison on the current vase before further integration. Investigation found that general booleans used Clipper2 while offsets and their normalization still used Clipper 6 JavaScript.
- Implemented: one shared C++/WASM instance in `core/region/clipper2.mjs` now owns closed planar booleans, open-path clipping, polygon inflation and offset normalization. Bulk integer buffers cross the native boundary. All skill consumers use the shared adapters; experimental surface-offset swept-band cleanup does too. Clipper 6 is removed from runtime dependencies, with no fallback. Both shell and wedge bundle identities include the shared kernel and exact dependency JS/WASM bytes. The offset `1e-5` mm and boolean `1e-9` mm grids remain unchanged.
- Scope: full-fill/perimeters, all planar-infill patterns and masks, drape, vase, supports, wedge, pipe substrate, material regions and comb travel share these planar operations. Rimming and surface cladding retain their shared 3D differential-offset algorithms; mesh/spline sectioning retains native geometry queries. CLI/MCP commands, machine output selection and human reviews use the existing workflow.
- Independent reference: the new Clipper2 C# runner and 90-case fixture retain upstream source hashes, input hashes and construction options. Historical Clipper 6 reference data remains explicitly historical; it is not relabeled or regenerated from production WASM. Existing analytical, nesting, touching-junction, collapse, perimeter and surface-convergence cases remain relevant. Final migration test counts are reported with the implementation result.
- Measured before integration: identical plan/machine hashes for the 15% rectilinear vase produced 38.600 s generation plus 10.581 s checked export with the optimized Clipper 6 adapter (49.181 s), versus 30.128 s plus 13.038 s in the scratch Clipper2 comparison (43.166 s). The latter exercised 5810 native offsets. Move counts differed, 1147567 versus 1201157, so this is a same-input kernel comparison rather than byte-identical output.
- Integrated measurement: the same inputs produced 31.735 s generation plus 14.929 s export/interpretation, totaling 46.664 s after geometry load; the separate cold geometry/plan stage took 7.425 s and file reading/parsing took 0.142 s. The integrated and scratch Clipper2 runs produced the same 1201157 moves. These individual runs vary with machine load and do not establish a stable speedup percentage. None meets 10–12 seconds. The independent C# oracle matches all 90 offset cases exactly; focused offset/junction/vase tests pass after removing the redundant post-inflation union.
- Related performance work: operation material regions are computed when consumed, comb corners/indexes and constant clearance are reused, ZIP uses compression level 1, and the G-code writer avoids repeated formatting while preserving emitted command bytes. These changes retain the shared slicing/export pipeline. The opt-in [print benchmark](scripts/bench/README.md#slicing-speed-benchmarks) records stage timings and optional CPU profiles outside the print bundle, with no production timing gate or added approval. No physical print or hardware execution is established by these measurements.

## Independent spacing and finished-surface cladding — 2026-09-11

- Source: user requested independent line spacing behind one setting, brief discovery in the capability digest, alternating helix winding, and cladding over a wavy vase wall with ten times tighter spacing. Implementation was authorized on the condition that this task leave vase mode itself unchanged.
- Implemented: the shared [spacing contract](core/path/README.md#line-spacing) covers seven patterns without requiring matched pitch and bead-width parameters. Explicit cladding consumes a [published finished boundary](core/path/README.md#finished-surfaces) and its source dependencies instead of requiring full-fill. Shared adapters publish fill, infill, automatic vase sides and draped roofs, including regional and selected assembly components. The existing vase generator is unchanged by this work; authored paths retain their no-implicit-surface contract.
- Preview: `Prints/development/wavy-vase-crossed-helices` has a 30 mm hollow wavy vase wall and four alternating helical shells. Spacing factor 3 replaces 30: nominal 1.2 mm instead of 12 mm with the same nominal 0.4 mm bead width. The checked development export has 61,488 interpreted moves and about 29.6 minutes nominal motion. The user confirmed the Studio result working and looking correct.
- Evidence: all 395 tests passed at the implementation checkpoint. Dedicated spacing, crossed-cladding and finished-cladding tests cover deposition volume, unchanged vase paths, producer dependencies, published extents, regional/assembly selection, source playback and checked reopening. This is software and visual evidence; no physical print or manufacturing approval is recorded.
- Scope: explicit cladding still requires a supported rectangular periodic mesh or spline chart. Nominal finished boundaries do not establish continuous coverage or physical contact; arbitrary chart unwrapping, open patches and offset self-intersection resolution remain outside this change. The legacy circular recipe retains its full-fill reserved-band adapter.

## 2026-09-11 — External precision reference inspection

- Date basis: explicit inspection date in core/geom/README.md; related work is BR-040.
- The CuraEngine coordinate reference described integer micrometres. The Cura
  base definition inspection found separate defaults of 0.5 mm segment resolution,
  0.025 mm maximum deviation and 50000 µm² (0.05 mm²) extrusion-area deviation.
  Machine/quality overrides and the user's effective settings were not established.
  These were examples of different precision quantities, not a SAAM speed guarantee.
- Sources: [coordinate concepts](https://github.com/Ultimaker/CuraEngine/wiki/Concepts)
  and [base settings](https://github.com/Ultimaker/Cura/blob/main/resources/definitions/fdmprinter.def.json).

## Text geometry — 2026-09-12

- Source: user requested raised/recessed text in supplied fonts, shaped on a part's spline surface or an independent reference, and accepted flat construction followed by surface warping.
- Implemented: [text task skill](skills/text/SKILL.md), CLI `text` and MCP `apply_text`; saved fonts, layout/variation controls, Bezier baseline, rigid or bent glyphs, normal relief, independent rational spline/plane references and named original-part patches. Text modifies selected assembly components or becomes standalone geometry. Edits rebuild from the retained original part.
- Geometry: existing planar Clipper2 union owns outline normalization; pinned Fontkit supplies shaped outlines and Manifold supplies shared 3D solid union/subtraction. Text-modified spline targets are explicitly tessellated; their recipes are retained. The actual resulting mesh is shared by Studio and slicing, with normal review invalidation and original STL integrity checks.
- Evidence: analytical volume/section checks, glyph counters, curved spline convergence, cylindrical and doubly curved references, baseline/mirror/normal direction, persistent edits, CLI/MCP and shared generation tests. Twelve text tests pass at this checkpoint, including a regression that checks deposition above the curved roof for every letter. The saved G-code was independently interpreted to verify those deposition moves; this is software evidence, not a physical print result.
- Correction and user confirmation: the user reported that the curved-roof example's visible text was not reproduced by its toolpath. The 6 mm Abel font lost narrow C/U strokes with the selected 0.4 mm bead. Explicit `outlineOffsetMm: 0.15` expands each stroke boundary before layout and warping; the revised saved export contains deposition for all five letters of CURVE, reaching approximately 0.77 mm above the roof for the requested 0.8 mm relief. After inspecting the updated Studio result, the user confirmed it working. This records visual/toolpath confirmation; no physical print outcome is claimed. Reproduction commands are in the [text manual](skills/text/SKILL.md#reproduce-the-development-examples).
- Limits: current font/geometry/precision boundaries are owned by the [manual](skills/text/SKILL.md#supported-scope-and-quality) and [geometry reference](core/geom/README.md#text-and-solid-modifiers). Automatic mixed-script paragraph layout, arbitrary trimmed CAD surfaces and a certified global surface-error bound are not implemented.

## 2026-09-12 — Separate current documentation from work history

- Work date: 2026-09-12 UTC / 2026-09-11 America/Los_Angeles.
- Source: the user required build requests to contain only outstanding or
  incomplete work, requested a backdated devlog sweep, and specified present
  tense for current documents.
- Moved all 42 numbered request checkpoints and the spacing/cladding and text
  work records into this log. Also moved dated benchmarks, S5/H2D observations,
  color-review evidence and implementation explanations out of current manuals.
  Original dates and commit checkpoints supplied the dating evidence; unknown
  work dates stayed unknown. Historical status and test counts retained their scope.
- Reduced build requests to eight unresolved follow-ups: complete-print/novice
  evaluation, H2D acceptance/retest, matched slicer timing, actual web-client/plugin
  acceptance, live Claude Code permissions, slicing latency/validation duplication,
  precision follow-through and the existing S5 startup discrepancy. Current
  limitations and deferred proposals did not become new implementation requests.
- Updated the entry point, developer orientation and contribution rules for
  build-first work, current-tense ownership and devlog closeout. Decision provenance,
  exact quotations and license/source/fixture notices retained narrow exceptions.
  The repository check gained open-request structure and devlog-presence checks.
- Corrected the wedge export reference's stale regeneration-on-reopen claim to
  match saved-export interpretation and the planar-infill reference's stale
  description of vase convexity. These were documentation corrections.
- Verification: repository checks passed for 49 Markdown documents and 579 local
  links; 11 isolated guard fixtures covered valid/empty queues, Windows line
  endings, completed/conflicting statuses, historical headings/fields, duplicate
  requests and missing fields. All 42 historical BR identifiers and both newer
  work records were present. No manufacturing tests or physical runs were part
  of this documentation sweep.

## 2026-09-12 — Map vase motifs around a required solid or sleeve

- Source: the user corrected the standalone-path interpretation: vase mode
  requires a solid or closed sleeve, with a pattern mapped iteratively around it.
  Open zigzags are valid motifs; continuous extrusion defines vase mode, while
  explicit segmented paths permit travel.
- Replaced XYZ paths with repeatable perimeter/height motifs in the existing
  vase-wall skill. Each mapped point uses the host's actual-Z inset contour;
  endpoint matching includes periodic seams and repetition boundaries. Solid
  and single-bore sleeve hosts share the same mesh/spline query path. Old XYZ
  recipes fail explicitly rather than silently acquiring different geometry.
  The [manual](skills/advanced-vase-wall/SKILL.md#sleeve-patterns) owns the coordinate,
  extrusion-height, sampling and endpoint conventions.
- Verified all 406 tests at the implementation checkpoint, then all 18 focused
  vase tests after adding an explicitly tapered-host fixture. Coverage includes
  concavity, sleeve bores, continuous joins, segmented travel, volume integration,
  source round trips on S5/H2D/Dobot and synthetic exact-byte delivery.
- Opened and visually inspected `Prints/development/continuous-sleeve-zigzag`
  in Studio: 50 repetitions around a 28 mm diameter closed sleeve, 7143 checked
  machine moves and about 5.2 minutes estimated motion. The public check reported
  no program error and all three human approvals false. This supersedes the
  standalone examples in BR-042; contact, physical strength and printing remain
  unvalidated. No commit or publication occurred.

## BR-042 — Generalize vase traversal and distinguish segmented paths

- Work date: not recorded; present in the working tree at migration on 2026-09-12 UTC. No committed record is available for dating this work.

Historical initial implementation; standalone paths below were corrected by the
sleeve-pattern follow-up. They are no longer the current skill contract.

- Source: current user selected vase-wall generalization, proposed tilted overlapping loops, then clarified that paths may instead be open noncrossing zigzags or other shapes, with an agent-chosen endpoint/travel convention. Follow-up explicitly requires vase mode to retain continuous extrusion and a separate name when travel is needed.
- Implemented: [arc-length contour traversal](core/geom/contour-path.mjs) replaces the fixed interior polar origin for automatic walls, supporting concave mesh/spline sections while their inset remains one outer loop. The first seam is selected geometrically and projected onto subsequent contours. Existing actual-Z queries, offsets, boundary sampling, volume ramps, level ending, operation composition and exporters remain shared.
- Authored paths: the existing skill accepts ordered XYZ polylines and constant or pointwise bead heights through `paths`. `pathMode: continuous` requires consecutive shared endpoints; `segmented` is presented as **segmented paths** and permits the shared composer to travel across gaps. All segments inside a path deposit; closure is explicit; no automatic closure, reversal or hidden travel is added. Shared deposition construction integrates linear bead height. Both positive and negative slopes respect the machine limit. Plan/regional validation, source identity, CLI/MCP adjustment, Studio labels and review/delivery use the current lifecycle.
- Limits: automatic section splits, islands and holes remain unsupported. Arc-length correspondence is not arbitrary feature tracking or topology matching. Authored paths are explicit approximating polylines, not an automatic contact/overlap or structural-strength solver; they publish no fictitious area or rim support. The [manual](skills/advanced-vase-wall/SKILL.md#sleeve-patterns) owns coordinates, height and continuity conventions.
- Development examples: `Prints/development/continuous-zigzag` uses tapered alternating open passes; `Prints/development/segmented-zigzag` uses level passes with shared travel. Both reach 3.2 mm and use an S5 reference box. Checked exports have 5740 and 160 interpreted moves respectively; counts differ because tapered volumes retain subdivisions and constant-volume collinear paths compact. Both reopen through the public CLI with all approvals false. Studio source playback and travel visibility were inspected.
- Verification: all 389 tests passed in the full suite. After final Studio label changes, 20 focused path/settings/material tests passed. Coverage includes concave mesh/spline geometry, cyclic contour ordering, open endpoints, continuous joins, segmented travel, variable-volume integrals, descent limits, translated regions, S5/H2D/configured Dobot source round trips and synthetic exact-byte delivery. Repository documentation/whitespace checks pass. No human print approvals, hardware execution, physical strength validation, staging, commit or publication.

## Undated — Studio browser cap measurements

- Date basis: Original run is undated; preserved by d8ed7a9 (2026-09-11T17:36:21-07:00).
- Original owner: [studio/RENDERING.md](studio/RENDERING.md). Preserved observation/checkpoint wording follows.

The initial browser cap sweep used 23,953 and 383,248 interpreted moves, with
10k, 20k, 40k, 80k and 160k endpoint budgets and 15 camera frames per case.
At 40k the larger repeated-path stress fixture drew 21,446 endpoints in about
2.9 ms median / 4.9 ms maximum in the isolated canvas loop; whole-layer selection
can leave the budget partly unused. Its initial detail preparation was about
148 ms. The 160k budget drew 84,694 endpoints in 10.4 / 12.9 ms. The 40k default
leaves room for Studio's other frame work and slower hardware; it is a local
empirical default, not a universal frame-rate guarantee. Raw local results are
in `.local/studio-fast/cap-results.json`; the original Studio baseline is in
`.local/studio-bench/findings.md`. Keep browser drawing measurements distinct
from server generation, cold verification, JSON transfer and UI-ready time.

## 2026-09-12 — Skill audit for assumptions hidden in first demos

- Source: user requested an audit of every skill for knowledge available only to
  its first maker agent, authorizing workflow or concise manual fixes. Follow-up
  excludes vase-wall edits while another task works there.
- Audited all 13 cataloged manuals against their entry points, defaults, demo
  preparation and relevant input requirements. Added guidance for complete shell
  recipe creation, inherited draped-skin selection, assembly roof selection,
  wedge nozzle/material restrictions and the text example's packaged font.
- Documented existing reusable DENSO and Dobot synthetic setup helpers for new
  provisional shapes, plus spline-tube control heights, angular/bore constraints,
  actual UV domains and native mesh-strip indexing. No new machine requirement,
  production validator or manufacturing approval stage was introduced.
- Shell and wedge CLI status now expose the existing output-availability and
  missing-configuration result before generation. Added CLI integration coverage
  for unconfigured DENSO/Dobot on both adapters. Contribution guidance now makes
  a demo's reusable preparation discoverable from its skill manual.
- Verification: five MCP/CLI access tests pass, including four fresh robot
  adapter combinations. Fresh temporary box bundles generate checked development
  output on S5, DENSO and Dobot without approvals. A new 12-column/6-control spline
  tube and its non-demo UV domain pass construction and surface selection.
  Repository documentation and whitespace checks pass; no physical test occurred.
- Vase-wall audit only: its motif demos initialize a non-null pattern directly,
  whereas adding a pattern to a fresh bundle through `adjustBundle` fails with
  `Cannot convert undefined or null to object` in the shared merge of a null
  setting. Its simple recipe also leaves disabling the template's draped skin
  implicit. These findings are reported to the user; this task makes no vase-wall
  edits. Supports, both rimming skills, mesh-tools, voxel-tools and Gridfinity
  have no additional hidden prerequisite identified in this audit.

## 2026-09-17 — Vase walls take the points their geometry requires

- Source: user, as builder work on the vase-wall skill: a fixed point budget
  that fails is unacceptable in vase mode; if a memory limit were real, the
  work would have to be segmented rather than fail.
- Measured before the change: an ordinary 100 mm diameter, 250 mm tall vase at
  0.2 mm pitch needs 640513 wall points, over six times the former 100000
  default, so the default cap rejected everyday parts. With the cap lifted, a
  2560001-point wall (0.1 mm pitch, 0.5 mm step) generated in 10.6 s and
  exported a 120 MB program in 7.5 s within 578 MiB of heap on a 4.3 GB Node
  heap, about 0.2 KB per point end to end. No vase-level memory limit is
  warranted; the only bound is the Node heap shared by every skill's program.
- Implemented: removed the vase-wall point and section-query budgets from the
  plain spiral, the mapped-pattern path and motif tiling. Every loop is finite
  (turns, authored courses, bounded subdivision depth), so the wall takes the
  points its geometry, pitch and tolerances require. `maxPoints` left
  `VASE_WALL_DEFAULTS`, plan validation and the mesh-vase preparer; older
  recipes and region overrides carrying any value are read and the field
  dropped, never enforced. Reports no longer carry `maxPoints` or
  `maxSectionQueries`. The exact per-section cache now keeps a 256-height
  window in every mode, so a curved exact wall no longer retains every section
  and its offsets for the entire print. Manuals and the nudge-cup example
  updated; other skills' budgets are untouched.
- Verification: the vase-wall suites and affected core suites pass, except
  three region-composition failures that already fail on a clean checkout of
  `e783862` and are unrelated to this change. A new regression generates a
  wall above 100000 points on the exact path and reads old budgets as inert.

## 2026-09-18 — Nearby strokes connect by deposition; the short-travel advisory reports only bad paths

- Source: user, as developer work: fix all skills and toolpath generation so the
  short-travel advisory essentially never triggers, then have the agent always
  mention it when it does (BR-049).
- Measured before the change, by regenerating saved prints in memory and
  bucketing every travel of at most 2 mm by its neighboring operations: tour
  handle 2074 of 2950 travels, freehand cat mesh 1718 of 3876, wavy roof 10959 of
  14471, DENSO surface cladding 17372 of 18135. About 95% were fill row to next
  row, wall loop to wall loop and wall to fill, written as non-extruding direct
  moves; on curved mesh outlines 337 wall-to-wall steps of 0.4 mm were full
  retract/lift/descend hops because the outer wall centerline sits exactly on
  the half-line-width combing standoff. The rest were layer changes that started
  near the previous layer's end (hops), the 1 mm final park, axial cladding index
  steps, sub-micron gyroid segments whose E rounded to zero, and the vanishing
  end of a level vase rim.
- Implemented: `PathBuilder.connectTo` and `connectNearby` operations — a stroke
  starting within 2 mm of the preceding deposition continues as one printed
  connector carrying the next stroke's bead, under the same region, surface and
  completed-material checks as a direct travel, with a 0.05 mm released standoff
  for wall centerlines; connector moves carry `connector: true` and
  `summary.travel.connected` counts them. Full-fill (and planar-infill, supports
  and regional fill through it), draped-skin, thick-lip and axial pipe/surface
  cladding opt in; authored-gap producers do not. Thick-lip travel now uses the
  ring band it deposits rather than the wall section. A nearby start on the next
  layer up is one rising `layer-step` move without retraction. Level vase rims
  end where the remaining taper holds under 0.001 mm3. Relative-E export carries
  its rounding remainder, which the many equal connectors exposed as a 0.003 mm3
  drift on H2D. The advisory no longer flags the first approach, the final
  departure, travels between different known layer labels, or segments of at
  most 0.001 mm; it reports `liftedCount` and a per-sample `lifted` flag, and its
  message and the Studio advisory request tell the agent to inform the person.
- Measured after: handle 3 (lifted travels between letter islands 1.2 mm apart),
  cat 0, gyroid check 0, cylinder vase 0, thick-lip example 0, plastic-weld trial
  0, wave-overhang example 0, heat-set example 0; DENSO surface cladding 17372 to
  shell changes only. Across every program the test suites export, thirteen
  still report 1–20 findings each; BR-049 lists their causes. Connectors add
  material: 0.46% on a five-loop 2 mm ring wall, the usual zigzag turn on solid
  fill. No physical print has tested them.
- Verification: affected core and skill suites pass in the shared checkout after
  updating expectations that encoded the former non-extruding steps. Still
  failing and unrelated: the known mcp, finished-cladding, plastic-weld and vase
  interoperability cases, `studio-lifetime` "last viewer closes only its
  instance" (fails identically without this change), and dev-map suites under
  concurrent edit by another session.

## 2026-09-18 — Dev map generated from code, alongside the authored maps

- Source: user, as developer work: agents orient from graph structure only; node
  set, grouping, addresses, labels, boundaries and couplings come from a scan, and
  map prose is to be removed.
- Implemented, additive: `read-map TARGET --generated` (`dev-map/lib/projection.mjs`).
  Identity is the declaration path; a numeric handle is recomputed every scan and
  stored nowhere. Nodes are named callables with a unique, non-positional path;
  other code is enclosed in its nearest such ancestor or a module node. Pages are
  directories, page reads return a file-level index, file and node reads return
  per-node edges with labels taken from parameter, argument and result names.
  `dev-map/lib/couplings.mjs` links literal worker message types, HTTP
  method/path, file writer/reader names and registry entries; `--tests` lists
  importing tests on request. Authored reads, build and check are unchanged.
- Measured 2026-09-18: 9 pages, 134 files, 1274 nodes, 6119 enclosed
  declarations, 4070 edges; couplings linked 24 worker-message, 26 http-route,
  84 file, 4 registry-entry; not linked 24 http and 59 file sites. Packets:
  `core/path` page 9.8 KB (authored `5_motion` 12.6 KB), `studio` page 57 KB,
  one declaration 1.5 KB.
- Found without a matchable signature: `/api/download/<id>` followed from a
  returned URL, the export file name computed from plan data, zip entry names.
  File links ignore directories. Anonymous route and message handlers project
  onto `createStudio` or a module node.
- Verification: the six dev-map test files pass 50 of 50; `dev-map.mjs check` passes.

## 2026-09-18 — Flow pages generated from function bodies

- Source: user, as developer work: the by-file generated map says where code
  lives, not what happens; the map wanted is a Grasshopper-style leveled flow.
- Implemented, additive: `read-map DECLARATION --generated --flow` and
  `dev-map.mjs build --flow DECLARATION` (`dev-map/lib/flow.mjs`, `flow.py`).
  One function is one page: parameters are input ports, distinct callees are
  components in first-appearance order, local def-use gives named wires, a
  mutated receiver gives a state thread, the enclosing test gives the gate,
  returns are output ports. Every element records the mechanism that produced
  it and the drawing carries a provenance legend; nothing is authored. Method
  calls on a receiver resolve through the value a caller passes (opt-in
  `receiverCalls`), which supplies the ten `builder.*` calls of
  `composeResults` that extraction previously missed.
- Measured 2026-09-18: `composeResults` page 15 components, 47 wires, packet
  24 KB; `travelTo` 16 boxes, 27 wires. Repo-wide receiver-value links 43. The
  unique-method-name fallback made 1939 links, about 1900 of them built-in
  `map/push/every/some/has` calls matched to unrelated object methods; it is
  quarantined and due for removal. Of 4086 other unresolved method calls in
  core and Studio, 2258 use a name no core/Studio declaration carries.
- Reads worse than the authored `5_motion`/`5a_travel` pages where parallel
  wires repeat one variable name, gates are raw test text, one callee box
  merges several branches, and literal-tagged returns carry nothing.
- Verification: seven dev-map test files pass 55 of 55; `dev-map.mjs check` passes.

## 2026-09-19 — Generated flow map: complete call accounting, stored map, explicit regeneration

- Source: user, as developer work: one agent path `0` -> region -> page -> code;
  scanning is an explicit `regenerate`; no prose in packets; no authored lists
  or thresholds.
- Implemented, additive (`--generated` gate; authored reads, build and check
  unchanged): every call site in core and Studio is LINKED, EXTERNAL by a named
  mechanical rule, or UNRESOLVED; the unique-method-name fallback is deleted;
  value following covers factory-returned objects and destructuring. Flow pages
  resolve def-use through scopes, draw early returns and throws as output
  ports, list assertion-shaped calls as `requires`, keep formula-shaped callees
  off the page with wire continuity, and carry `calledFrom` and couplings.
  `dev-map/lib/store.mjs`, `regions.mjs`, `shapes.mjs`: a stored map under
  `dev-map/generated/`, `regenerate [INDEX]`, region-local canonical numbering,
  page 0 and region pages, `unreached`, stale marking by file hash on read,
  `read-map INDEX --generated [--code]` with `--code` refused on root and
  region pages.
- Measured 2026-09-19: call sites LINKED 4633, EXTERNAL 5657, UNRESOLVED 1298
  (was 6019 incl. 1523 junk / 0 / 5572). 9 regions, 1275 pages, 615 leaves, 273
  formulas, 4 assertions, 2 unreached nodes. Full regenerate 9.3 s: link 8.0 s,
  parse 0.14 s, shapes 0.17 s, pages 0.61 s, write 0.18 s. Region-scoped
  regenerate 8.6-8.8 s: scoping rebuilds only that region's pages and numbers
  but the link phase is still whole-program. Reads from the store 0.09-0.13 s
  wall (were 4-8 s). Store 2.6 MB, 135 files. Packets: median 771 B, p90 2.1 KB,
  max 20 KB (`createStudio`); `composeResults` 7.0 KB (was 23.9 KB).
- Open: 211 formula/assertion nodes have an index and page but no page lists
  them as components; `addEventListener` handlers and CLI dispatch under
  `scripts/` are not detected as entry points; `core/geom` region page admits
  106 entries; class pages have no wires; 7 gate texts render `??` as `== null`.
- Verification: seven dev-map test files pass 71 of 71; `dev-map.mjs check`
  passes; scoped regenerate of every region with no source change leaves the
  store byte-identical (subagent-run); audit of all pages: 2475 call sites,
  2711 wire labels, 10027 index references, 0 failures.

## 2026-09-19 — Generated flow map: faster linker, file level, class pages, entry points

- Source: user, as developer work: density is solved by more nesting; nothing
  unlisted; no thresholds; benchmark regeneration.
- Implemented, additive: linker hot spots removed (per-node `children`,
  per-function returns, memoised value resolution) with the store byte-identical
  before and after. Index path is now `0` -> region -> file -> entry -> callees;
  `--code` is allowed on a file page and refused on `0` and region pages. Every
  page lists its formula-shaped callees; formulas additionally exclude async,
  `await`, `new`, nested block functions and unresolved calls (273 -> 201).
  Class pages draw method calls and shared `this.` fields as state wires.
  `dev-map/lib/scope.mjs` is the one authored scan scope (mapped: core,
  studio; outside callers: skills, adapters, scripts). Event-listener
  registrations are entry points. `??` gates show the source slice.
- Measured 2026-09-19: full regenerate 7.7 s wall (link 5.6 s, pages 0.9 s,
  parse 0.36 s), was 9.3 s; on the former 180-file scope the link phase is 2.6 s
  (was 8.3 s); the added `scripts` root and listener pass account for the rest.
  Region-scoped regenerate 6.9-7.1 s: the link phase remains whole-program.
  Reads: `0` 4.7 KB, `core/path` region 3.8 KB (was 10.5 KB), `compose.mjs`
  file page 1.0 KB, `composeResults` 7.9 KB. `core/geom` region page 39 KB ->
  17 KB. `PathBuilder` class page: 12 method calls, 128 state wires over 15
  fields. Entries 451; unreached list empty. Call sites linked 4633, external
  5653, unresolved 1302, of which about 726 are `map/every/slice/filter/some/
  push/at` on untyped receivers, kept unresolved because
  `studio/move-store.mjs` defines methods with those names.
- Verification: seven dev-map test files pass 78 of 78; `dev-map.mjs check`
  passes; whole-store audit (subagent-run): 0 index, calledFrom, gate-slice or
  call-site failures, 0 nodes off the map.

## 2026-09-19 — Whole generated map drawn for the owner

- Source: user, as developer work: put everything generated so far where it can
  be viewed.
- Implemented, additive: `node dev-map/cli.mjs build --generated` draws the
  stored map (`dev-map/lib/generated-view.mjs`, `generated-view.py`) into
  `dev-map/generated-view/`: page `0`, region, file, class and function pages in
  the leveled layout, click-through between levels, breadcrumb to `0`, a URL
  hash per index, search by index or declaration path, a source pane, page
  lists (`requires`, `formulas`, `calledFrom`, couplings, unresolved, external
  count), stale pages framed in red with the `regenerate` command, and one
  legend as the only prose. It reads only the store and exits non-zero when the
  store is missing or stale. Class `this.` field wires are drawn bundled per
  field. `leveled.py` no longer fails on a page without boxes.
  `.claude/launch.json` serves the output for the desktop browser pane.
- Measured 2026-09-19: 1419 pages (root 1, region 9, file 134, function 1023,
  method 223, handler 21, class 8), 8442 boxes, 7008 wires; build 2.6 s;
  output 13.6 MB in 1421 files, shell 0.77 MB with one script sidecar per page;
  inlining every drawing made the shell 13.3 MB and opening took 18.7 s
  against 0.1 s. Full regenerate 4.4 s on an idle machine.
- Reads badly when drawn: `core/geom` and `studio` region pages, `studio/app.mjs`
  and `core/geom/tolerance.mjs` file pages, `createStudio`, `validatePlan`
  (60 assertions), `PathBuilder` and `LuaRuntime` class pages, and pages whose
  parameters fan to every component such as `exportAndInterpretProgram`.
- Verification: eight dev-map test files pass 82 of 82; `dev-map.mjs check`
  passes; viewer opened in the browser pane at `0` and `#6.3.1`; the first-open
  fit was wrong and is fixed.

## 2026-09-19 — Switch-over: the generated map replaces the authored maps

- Source: user, as developer work: "go ahead and switch"; old maps remain
  readable at commit 5526585.
- Implemented: `read-map INDEX|DECLARATION [--code]` is the only map read and
  `regenerate [INDEX]` the only scan; `--generated` and the authored flags are
  gone; `--code` is refused on `0` and region pages. Store `dev-map/store/`,
  viewer `dev-map/view/` (`node dev-map/cli.mjs build`). Developer and
  builder onboarding return page `0` and, for `--area REGION`, that region
  page. Deleted: 10 authored region files, 23 `maps/reference/` files, 21
  redirect-only component READMEs, the authored pipeline (model, generate,
  evidence, containment, reference, maintenance, render) and six test files.
  Every inbound link was removed; AGENTS, BUILDERS, DEVELOPER-CONTEXT, SETUP,
  README, the context-map pages and `dev-map/README.md` now describe the walk from
  `0`, discourage text search for orientation, and drop the responsibilities
  and contract authoring procedure. `dev-map/facts.tsv` (header only) is the one
  authored map content: rows attach to pages, orphans are reported, malformed
  rows fail `dev-map.mjs check`, which also fails on a missing or stale store.
- Lost with the reference prose and not yet re-homed: operator-facing Studio
  guidance that lived in `maps/reference/studio.md` (agent permissions, opening
  local prints, agent request coordination, event queue, STL import), machine
  program notes for Griffin, Bambu, Dobot and DENSO, and the caller contracts
  skill manuals linked to. AGENTS.md still says SETUP.md covers Studio client
  permissions; SETUP.md no longer does. The subagent listed 25 candidate
  external facts by old location; none were added to `dev-map/facts.tsv`.
- Not built: `check --since REF`.
- Verification: `dev-map-flow`, `dev-map-view`, `agent-toolkit`, `context-map`
  and `mcp-access` tests pass 56 of 56; `mcp.test.mjs` 16 of 17 with the same
  transport-close failure present at 5526585; `dev-map.mjs check` exit 0 (2128
  linked, 1285 unresolved, 5383 external, 0 unreached); `check-repo.mjs` reports
  only BR-049's existing "Remaining" format error; no reference to the deleted
  system remains outside DEVLOG and DECISIONS history.

## 2026-09-19 — Maker and builder manuals restored; three reading roles; viewer follows the map

- Source: user correction: makers and builders keep their prose documentation;
  developers read the generated map and one small orientation file. The
  switch-over (ab61e96) had deleted the component manuals along with the map
  prose, because since 8b4b148 (2026-09-17) their content had lived under
  `maps/reference/` behind redirect stubs.
- Restored at their own paths, newest text from 5526585: 21 component manuals
  (`core/README.md`, `core/agent`, `core/export` and its four machine manuals,
  `core/geom` and `native`, `core/machine`, `core/path` and its collision
  proposal, `core/print`, `core/region`, `core/tests`, `machines`,
  `scripts/bench` and its region reference, `studio` README, KINEMATICS and
  RENDERING). Dropped from them: every `Implementation responsibilities` section
  and every `Changing ...` section with the Contract/Failures/Change
  together/Verification shape, which were added on 2026-09-17 for the deleted
  responsibilities check. `maps/reference/generation.md` was that apparatus only
  and is not restored; the ordinary sections of `studio-protocols.md` are now
  `studio/README.md#studio-state-and-worker-protocols`. Nothing is restored
  under `maps/`. 136 inbound links restored across MAKERS, SETUP, GLOSSARY,
  USAGE, skill manuals, adapters, AGENTS and BUILDERS; both context-map pages
  have their nodes back, pointing at the component manuals.
- Roles: maker reads prose, no maps; builder reads prose and may walk the map
  for the region touched (`builder-onboarding --area core/path` returns the
  builder documents, `core/path/README.md` and region page 6); developer reads
  the map from `0` and `DEVELOPER-CONTEXT.md` only (66 lines; developer
  onboarding no longer returns BUILDERS.md).
- Viewer: index rows were not clickable; fixed. The index is indented,
  collapsible and can be hidden. `dev-map/view/index.html` is overwritten in
  place and reloads itself when a new drawing lands; every `regenerate` redraws
  it (8.6 s together); a stale store is still drawn with the affected pages
  marked, and `build` fails only when there is no store.
- Not documented anywhere but this log: a locked `process.primeLine` replacing
  profile priming (was in the dropped generation apparatus).
- Verification: `check-repo.mjs` passes link and anchor checks (only the known
  BR-049 format error); toolkit, context-map, mcp-access, dev-map-flow and
  dev-map-view tests pass 56 of 56; `mcp.test.mjs` 16 of 17 with the known
  transport-close failure; no tracked file mentions `maps/reference`,
  `saam-map-reference`, `Implementation responsibilities` or `map-owned`.

## 2026-09-19 — Generated-map integrity and explicit path-planning pilot

- Source: current user in task `01a0ba56-7b17-71e3-9219-4972a0bc5bfd`
  requested completion of useful graph-native developer maps, approved authored
  flow grouping, and selected path planning for an explicit-state coding pilot.
  [D-035](DECISIONS.md#d-035--authored-flow-composition-over-generated-code-relationships)
  and [D-036](DECISIONS.md#d-036--explicit-planning-stages-and-state-in-the-path-planning-pilot)
  record the direction. Maker and builder manuals remain their prose context.
- Map repair: canonical declarations belong to their own files; scoped
  regeneration updates affected references and preserves unrefreshed source
  fingerprints. Inventory, outside callers, generator dependencies, grouping
  and facts participate in freshness. Invalid partial refreshes widen explicitly;
  full regeneration removes obsolete pages. Region/group source reads work,
  while root source reads remain refused. Terminal addresses open source in
  both CLI and viewer; the left page index omits code-only destinations.
- Flow repair: nested gates and per-use assignment origins are retained;
  unsupported joins, loops and mutation are reported rather than supplying
  guessed values or execution order. Called pure functions remain visible.
  Authored membership contracts only generated relationships; group diagnostics
  belong to their members or link the owner's analysis context. Seven external
  facts were restored with provenance. The first utility grouping did not
  provide a coherent high-level flow; the user retained it for comparison.
- Path pilot: production generation enters `toolpath.mjs::planToolpath`, passing
  explicit state through startup, priming, composition and finishing. Travel,
  connection, deposition and layer cooling return new state and action deltas.
  `PathBuilder` and `composeResults` are adapters to shared planning code, not
  separate planning algorithms. Earlier action objects survive collinear
  merging unchanged; the accumulated path is assembled at the boundary.
- Initial behavior evidence: 7 new immutable-state tests and 49 affected
  existing tests passed. Eight scenarios exactly matched isolated original
  implementations, including complete S5, Bambu and oriented DENSO output and
  summaries. Their combined serialized-output SHA-256 was
  `9be0e5ededd2903f8cd1bd081198a0bf00c2779c89ae7e908abeb064ee0a373a`.
  Removing duplicate composer logic retained those exact comparisons and all
  eight composition tests. Baseline artifacts are ignored under
  `dev-map/audit/pilot-baseline`.
- Initial integration evidence: 83 map/toolkit/context checks passed after
  updating the root-code-refusal assertion to its revised message (82 in the
  combined run, the corrected onboarding test separately). Map check reported
  fresh source and no orphan or malformed facts. Repository checks still report
  the pre-existing BR-049 missing `Remaining` field.
- Follow-up authorized during review: generated choice/iteration connections
  are needed because explicit state still disappeared at branch and loop
  boundaries. A single 50,000-collinear-segment measurement returned the same
  one action in both planners; observed temporary heap growth was about 2 MiB
  before and 15 MiB after, with 80/94 ms elapsed respectively. This is a synthetic
  observation, not a general performance result. The user approved stage-local
  compaction of superseded move deltas while preserving input/result immutability.
- Compaction evidence: a stage-local accumulator retains surviving appends and
  at most one replacement of the incoming tail. Twelve immutable-state tests
  passed, including cross-stage replacements, process-action barriers, detached
  accumulator reuse and 10,000 collinear segments producing one retained action.
  All eight baseline outputs still match the same hash. A fresh single synthetic
  run observed about 3 MiB temporary heap growth and 70 ms for the compacted
  planner, versus 3 MiB and 71 ms for the original implementation; timings are
  indicative only.
- Subsequent review accepted the density and comprehensibility of the operation
  composition page, while identifying sparse scheduler helpers, disconnected
  progress input, duplicate caller references and navigation friction. Source
  destinations now use a distinct color; the viewer has actual-route Back and
  Escape-to-close. Callers already represented on a page use connecting call
  arrows; only other callers retain red address references. Class membership
  was removed from incoming-call accounting.
- Source snapshots now accompany generated file records. CLI and viewer use
  the same matching source while stale; scoped regeneration retains unrefreshed
  snapshots. Legacy source is accepted only after a hash match. Shifted/deleted
  source, partial regeneration and emitted-source parity were checked.
- The user selected scheduling as the next bounded code-and-map section.
  Validation, priority preparation, prerequisite preparation and topological
  ordering now return explicit records, with heap mutation confined to ordering.
  Eight composition tests and all eight baseline comparisons passed unchanged;
  fourteen planning-state tests include frozen scheduler inputs, stable priority
  ties, repeatability and cycle rejection without consuming prerequisites.
- Known direct parameter-callback invocations now have callable and payload
  connections, source locations and nullish optional gates. Concrete targets
  remain unresolved. Independent negative cases caught and fixed false constant
  claims for partly unknown values and computed payload keys. The eleven
  external sites in planComposition were verified as Map/Array operations;
  generic external counts no longer claim application-boundary semantics.
- Integration evidence: 93 map tests passed, followed by 10 invocation and
  independent callback checks. Regeneration produced 651 graph pages and 813
  code destinations, with zero stale pages and no orphan or malformed facts.
  Browser checks verified the scheduler's four connected stages, source color,
  Escape, caller navigation and Back. Accumulator contents, scheduling-ledger
  inputs and summary-field origins still have bounded analysis gaps; those
  omissions are explicit uncertainty, not certified connections.
- Subsequent boundary review: generated call-site evidence now traces input
  arguments and returned-value bindings/known uses into port references. Each
  caller and invocation keeps its source context; defaults, spreads, unknown
  origins and untraced consumers stay explicit. Independent tests cover record
  field isolation, escape invalidation and preserved source sites during scoped
  renumbering. Forty-six boundary/store/view checks passed. Regeneration and
  browser inspection verified scheduler port references, compatible wire bundles
  and outward arrows attached to nodes or the expanded function frame. Local
  collection/counter analysis remains the next active scanner increment.

## 2026-09-19 — Cloudflare relay milestone specification

- Source: “Plan Cloudflare MCP relay” (`01a0baba-5902-7c41-8e9e-19d95fe2c81c`).
  The user selected active Studio-driven interaction through pending MCP calls
  and requested a specification/roadmap rather than a capability experiment.
- Added the [milestone plan](adapters/mcp/RELAY-PLAN.md) and recorded the selected
  direction in [D-037](DECISIONS.md#d-037--cloudflare-relay-and-studio-driven-chat-sessions),
  with a follow-up link from D-023. Windows/macOS packaging carries forward
  D-023's recorded scope; a shared relay object and local review are explicit
  planning defaults rather than newly attributed human decisions.
- Specified session ownership, bounded event waits and renewal, durable event
  replay/acknowledgment, independent local jobs, pairing/access boundaries,
  installer/update behavior, failure recovery and six implementation stages.
  Integration acceptance requires actual model responses to Studio requests
  without routine chat intervention; it is not satisfied by an open socket.
- Platform documentation consulted on 2026-09-19 describes a 240-second Claude
  tool-call deadline and Cloudflare's shared allowances and duration metering.
  The plan links those sources and budgets listener renewals separately from
  the 900,000 ordinary monthly calls. One continuously active standard object
  over 30 days calculates to 331,776 GB-seconds; this is a planning calculation,
  not measured SAAM usage or a guaranteed total bill.
- This task changed planning documentation only. No connector capability test,
  relay deployment, installer build or manufacturing execution was performed.
  Implementation remains future work; no implementation backlog entry was
  created from engineering recommendations alone.
- Documentation check: `node scripts/check-repo.mjs` reported no new plan-link
  or decision-metadata errors. The repository-wide check remains failing on the
  pre-existing BR-049 `Remaining` field format in build_request.md; that unrelated
  queue entry was left unchanged.

## 2026-09-19 — Refine relay sessions, account access and wait targets

- Revised the relay plan in response to review: one active paired installation,
  no routine device picker, explicit replacement, and new chats that reopen
  saved print bundles without transferring chat sessions. Part creation is
  agent-led, with loading an STL as the alternative starting point.
- Replaced the ambiguous cloud-state wording with explicit local revision
  checks. Reduced interruption recovery to retained requests/outcomes, safe
  retries and visible unavailable state; stopping the assistant does not cause
  automatic restart. Normal listener renewal is not an interruption.
- The user replaced the ten-minute quiet-wait request with 7:30 and explicitly
  requested that timeout for ChatGPT too. The plan targets a 450-second ChatGPT
  call and two 225-second Claude calls, with one renewal. Claude documents a
  240-second per-call limit; the cited ChatGPT documentation supplies no matching
  deadline. Its 450-second value is a requested implementation target, not a
  verified client capability. No live capability test was performed.
- Added sourced account/workspace and tool-consent requirements, distinguished
  web connectors from other client surfaces, and expanded the transport/cost
  model. A 450-second interval on one standard active object calculates to
  57.6 GB-seconds; one such interval per print adds 30,000-60,000 monthly wait
  calls depending on client mix. These are scenarios, not usage measurements.
- Re-ran `node scripts/check-repo.mjs`: the same pre-existing BR-049 `Remaining`
  format error is the only reported content failure. Left it and concurrent
  implementation work unchanged. This revision changes planning documents only.

## 2026-09-19 — Alpha permissions and beta distribution context

- Added the intended first-use permission flow and distinguished device pairing,
  OAuth access, provider tool consent and local output approval. Fetched official
  OpenAI submission/OAuth/permission documentation and Anthropic connector policy
  documentation; the plan links the sources and labels unimplemented screens.
- Clarified that RELAY-PLAN owns the alpha milestone. Developer mode is acceptable
  there; reviewed ChatGPT publication remains beta context and is excluded from
  the alpha roadmap and acceptance gates. No external submission was made.
- The user requested consolidation proposals for review. No proposed structural
  consolidation or content deletion was applied; only the explicit alpha scope
  correction was made after that request.

## 2026-09-19 — Apply reviewed relay-plan consolidation

- Applied the user's item-by-item review: preserved Goalpost, Selected scope and
  planning defaults, and Person's workflow; retained a shorter permission-screen
  section; limited eligibility to target web clients; consolidated architecture
  boundaries and session/recovery rules. Moved the shortened cost discussion
  directly after architecture, linked roadmap stages to one acceptance checklist,
  and reduced beta publication to context. The plan shrank from 5,862 to roughly
  3,600 whitespace-delimited words without changing the wait targets.
- Replaced the wide Mermaid diagram with a portrait SVG using explicit dark
  backing, larger labels and thick high-contrast arrows. Rendered it through
  Sharp and visually inspected the result. The approved preserved sections were
  checked against their exact pre-edit text; no incoming links to removed
  section anchors were found. No implementation code was changed.
- `node scripts/check-repo.mjs` still reports only the pre-existing BR-049
  `Remaining` field format failure; the plan's links introduced no new errors.

## 2026-09-19 — Recheck alpha and future beta account setup

- Re-fetched official OpenAI developer-mode, plugin-installation, workspace and
  submission documentation, plus Anthropic custom-connector, directory and
  plugin documentation. Added the requested future-beta column, made ChatGPT
  Free/Go eligibility explicitly unconfirmed for the published route, and split
  Claude Free from Pro/Max to distinguish its one custom connector from paid-plan
  bundled plugins. Retained per-user authorization and organization policies.
- Moved beta context into one explicitly deferred paragraph in Goalpost and
  removed its standalone section. Beta publication remains outside alpha scope;
  no new distribution or implementation work was performed.

## 2026-09-19 — Compact developer map reads

- Made agent map reads a compact presentation of the existing stored graph:
  inclusive line ranges, inherited file locations, empty-list omission and
  deduplicated inventory/caller metadata. Calls retain argument expressions and
  producer sites; repeated invocations retain result uses. `--details` returns
  the unchanged rich packet without scanning.
- Source reads omit the graph body while preserving provenance, freshness and
  edit-safety metadata. Automatic terminal reads also retain input/output
  boundary references. The human viewer and stored graph representation are
  unchanged by this CLI presentation change.
- Measured the full scheduler CLI response, including its current stale notice
  and trailing newline: 5,198 characters against 5,483 source characters for the
  scheduler and its four stages. The equivalent detailed response is 9,545
  characters; the compact response without a stale notice is 4,764. Source-only
  scheduler output is 1,480 characters excluding its trailing newline.
- Five focused compact-packet tests and the targeted toolkit onboarding/map
  integration test pass. Independent review caught and verified fixes for
  repeated-call producer identity and automatic terminal boundary provenance.
  Shared regeneration is held while the user considers the separate renderer
  fix for missing collection/update expressions, constants and optional gates.

## 2026-09-19 — Integrate local state analysis and rendering

- Following user approval to proceed, completed the renderer's local-state
  display: collection argument expressions, certified constant operands,
  iteration initial constants and optional collection/update gates. A real
  scanner-to-SVG fixture verifies these details without claiming dynamic values
  are constants.
- Regenerated all nine regions and 136 files. The viewer now has 688 graph pages
  and 776 code destinations, with no stale pages or orphan facts. Inspected the
  actual composition page in the browser: six components, 22 flow operators and
  56 wires. Escaped deposited state, custom accumulator effects and unsupported
  returned-array/callback provenance remain explicit limitations.
- Seventeen viewer tests, twenty store integration tests and five compact-read
  tests pass. Updated the old disconnected-helper fixture because its array
  operations now generate real state flow; kept a separate genuinely disconnected
  helper case and asserted both source and graph destinations independently.
- The regenerated scheduler's compact CLI response is 4,886 characters including
  its newline against 5,483 source characters; all four stages still open code.
  No additional core behavior changes were made in this integration.

## 2026-09-19 — Reduce map detail and separate source from navigation

- Recorded the reviewed composition page as a rough upper density reference,
  not a target to fill. Private state bookkeeping remains a candidate for
  operator-aware grouping; that structural change has been proposed to the
  user and has not been implemented.
- Human and agent default views now share a presentation layer: boundary ports
  show a short caller-site reference with uncertainty flags, rather than copied
  argument/result and producer/consumer context. Detailed evidence remains in
  the store and `read-map --details`. Callback object payloads show field names;
  redundant operator port lists, AST tags and initializer boilerplate are omitted.
  Conditions, transformations, constants and graph connections remain visible.
- Back tracks map pages only. Source open/close creates no map-history entry;
  Back leaves an open pane untouched. Clicking the body of a source-addressed
  operator opens its matching source span. Verified in the browser that both
  Back with source open and Back after Escape behave this way.
- Seventeen viewer tests and eight compact-presentation tests pass. Independent
  review caught an overly broad return-label abbreviation; it now requires
  direct-return AST evidence and preserves arithmetic, member and conditional
  return expressions. No core planning behavior changed.

## 2026-09-19 — Keep operator implementation behind source access

- The user clarified that operator implementation is unnecessary for developer
  orientation too. Removed expressions, alternative values, payloads, constants,
  prefix/postfix mechanics and loop bookkeeping from default operator boxes and
  the shared default agent presentation. Boxes retain identity, operation, source
  location and a concise unresolved marker. Wires, gates and page uncertainty
  remain; matching source and `--details` retain the implementation evidence.
- Seventeen viewer tests and eight compact-presentation tests pass. The view
  tests check all five operator types for absent implementation bodies while
  preserving edge endpoints and source click behavior.

## 2026-09-19 — Derive the alpha relay hosting budget and user cap

- Rechecked Cloudflare Workers/DO pricing and replaced the relay plan's loose
  capacity discussion with per-user request and monthly hosting tables. Set
  the planning target to $5/month for the relay and derived 150 active users
  from 6,000 metered DO requests/user/month with 10% included-request headroom.
  Kept the user's five prints/day and 30 ordinary calls/print; additional event,
  listening, transport, CPU, SQLite and log quantities are explicitly unmeasured
  engineering budgets. Updated scope and alpha acceptance to the derived cap.
- Calculated all request components and thresholds: 166 users fit without
  reserve, the first rounded overage begins at 167, and the original 200-user
  scenario projects to $5.15/month. The request-only marginal rate is $0.0009
  per additional scenario user/month, distinct from the $0.15 invoice steps.
  The one-object projection and all other allowance assumptions are retained;
  this is a cost model, not measured capacity or a provider-enforced spending cap.

## 2026-09-19 — Whole-scope map rollout and smaller review checkpoints

- User direction: preserve the Grasshopper-style code-and-map objective, remove
  superseded implementations after rewiring every consumer, and review smaller
  sections before repeating an approach. Each proposed review now includes an
  inspected default CLI response opened beside the drawing.
- Shared generation at 22:42 UTC covered 9 regions and 138 mapped files, with
  1,415 declarations, 267 authored containment groups, and 1,830 destinations.
  It reported no orphan facts or malformed facts and was current at publication.
  Coverage is not completion: region/file capability inventories and remaining
  weak orchestration pages are tracked separately in the ignored rollout audit.
- Distinct invocations retain separate stage identities. Function grouping now
  rejects contractions that hide an outside stage between two group members and
  would therefore draw false feedback. Invalid Studio draw/service contractions
  were removed; structural navigation groups remain.
- Full gate predicates moved behind source/details; exit control wires connect
  unsupported-format exceptions to their deciding inputs. The user visually
  accepted studio/source-player.mjs::decodeSource (then 9.23.1). Accuracy remains
  the developer's responsibility. Full conditions and matching stale source are
  retained for inspection.
- Default CLI calls no longer duplicate argument expressions, producer traces or
  result-use lists. Generated argument-slot wires preserve order and repeated
  arguments; spread-affected positions remain explicitly uncertain. Compatible
  argument values share a drawn link without losing individual slot labels.
- Removed PathBuilder, composeResults, primeBeforePart, planOperationControls,
  generateFullFill and generateDrapedSkin after rewiring their live consumers.
  Functional trimming and finished-boundary publication preserve incoming
  values. Regional cladding now receives the same shell identity used by its
  producer. Thirteen captured paths remained exact; 25 focused checks passed.
- At this checkpoint all 181 map tests passed. Subsequent review work continues
  on compound-gate identities, returned record labels, possible-target markers,
  live browser freshness, external call boundaries, and named worker/tessellation
  stages. These outstanding items are not claimed complete by the coverage count.

### 2026-09-19 — Interpreter and service-stage review checkpoint

- At 23:11 UTC the shared snapshot covered 138 core/Studio files and 1,441
  declarations across nine regions: 1,123 graph destinations, 729 source
  destinations and 263 containment groups. It was current at publication;
  subsequent edits are reported by the live freshness watcher without replacing
  the matching source snapshot. All 212 map checks passed at this checkpoint.
- Griffin interpretation now exposes initialization, stream processing,
  completion validation and program construction. Twenty captured success/error
  outcomes remained exact; 16 focused checks included a 200,000-move replay.
  The drawing and exact default CLI response for interpretGcode (then 3.9.10)
  were inspected and offered for review. Lower stream feedback and switch
  analysis remain incomplete; a clean top page does not resolve those limits.
- Machine presentation separates mechanism assembly, controls, descriptor and
  sampling. Seven profile descriptors and 38 captured poses matched; 20 checks
  passed. Bundle workflow separates candidate reuse, generation, verification,
  checks and persistence, with 12 focused/integration checks passing. Returned
  callback captures and dynamic adapter targets remain explicit analysis gaps.
- Parameter-owned method invocations now show receiver, argument and result
  connections while keeping their targets unresolved. Full source spans prevent
  nested logical expressions from colliding into false feedback. Condition
  captions open their caller predicate source; whole awaited-call result labels
  and returned-record labels no longer repeat implementation expressions.
- Whole-scope execution-flow completion remains open. Active follow-ups cover
  adaptive-loop state, toolkit preview ownership, and mesh-repair worker dispatch
  and lifetime. Inventory coverage is not used as evidence that these flows are
  complete.

## 2026-09-19 — Developer-map wrap-up checkpoint

- The user ended the active rollout with "We are in good shape on this, we can
  wrap up." The team stopped new refactors and finished the stable integration.
  Remaining authorized work is deferred in BR-052; inventory coverage is not a
  claim that every flow or scanner limitation is resolved.
- Active map tooling, authored grouping, tests and generated assets now live
  under `dev-map/`; historical comparison assets live under `dev-map-OLD/`.
  Toolkit entry commands remain unchanged. Maker/builder documentation maps
  remain separate. Cross-project compatibility was explicitly not added as an
  objective. Fixed the guidance reader's document root after relocation.
- Scanner improvements resolve supported re-export chains, exported factory
  destructuring and awaited literal dynamic imports, retaining conservative
  ambiguity and unsupported-call diagnostics. Numeric helper destinations can
  open directly as code. Presentation keeps distinct invocation identities,
  short boundary/caller references and implementation behind source/details.
  Error labels and condition wires no longer repeat full diagnostic/predicate
  text. Class overviews consolidate repeated relationships.
- The user approved private Lua interpreter variables, tables, scopes and call
  stack behind an explicit stateful boundary. This is recorded in D-036 and the
  developer orientation. Generated class fields carry distinct instance/static
  identities and matching source spans through authored groups. Yellow hubs open
  those spans, including stale/deleted live-source cases. Proved incoming class
  construction/member calls connect to their actual target groups.
- Planning/geometry changes include explicit comb routing, priming, perimeter
  recovery, scanline and surface-offset stages, owned Bézier samples and NURBS
  basis results, and staged sleeve fitting and directional regularization.
  Studio changes include pointer planning, generation orchestration and source
  sampling decisions; workflow edits return explicit replacement records.
  Completed slices retain their captured outputs/error ordering under focused
  tests. The last geometry batch passed 40 targeted checks with exact captured
  outputs; its alternating NURBS benchmark improved, while directional sampling
  showed no measured regression. These are software observations only.
- Final integration passed all 302 map tests. Generation at 2026-09-20 00:48 UTC
  (September 19 local time) covered nine regions, 138 files and 1,527 code
  declarations: 1,218 graph destinations, 718 code destinations and 261 authored
  groups. Eight external facts bound with no orphan/malformed facts; the final
  map check passed with no staleness. The default LuaRuntime CLI packet and its
  drawing were inspected together; clicking callStack opened the matching line
  606, and Escape closed it. Its CLI packet was queued in the sidebar.
- Forty-two service files and all 39 geometry files have recorded source
  assessments; remaining Studio assessment and source/refinement priorities are
  explicit. Immutable program enrichment and review transitions were not started
  in the final slice. The Bambu source-offset tradeoff remains unresolved: early
  final offsets alter partial sink rows on failure, while an offset view changes
  result identity. Existing behavior remains intact. No new stateful exception
  was silently introduced.
- Local ignored evidence is in `dev-map/audit/`, including final test/generation
  logs, exact review packets and source-hashed assessments. Current source/tests
  and this log are the durable implementation record. This closeout does not
  include a new commit or remote push after the earlier backup checkpoint.

## 2026-09-21 — Wiring simplification: WS-01, WS-03, WS-05, WS-08 and WS-12

- The user assigned WS-01, WS-03, WS-05 and WS-08, then added WS-12. The shell
  print lifecycle now has one mutable commit point: top-level recipe fields and
  a reserved `bundle` envelope in `plan.json`. The envelope owns machine,
  review/check evidence and immutable content-addressed geometry/program
  references. Existing parallel-file bundles migrate on first load.
- Configuration precedence moved to `core/print/resolve-plan.mjs`. Initial
  defaults, remembered setup, machine-owned changes and interactive patches now
  share one strict resolver boundary; firmware changes still clear startup
  verification unless explicitly re-confirmed.
- Generation now reads as prepare candidate → revalidate identity → commit
  checked output. Studio's worker passes that candidate into the commit instead
  of running a diagnostic calculation and a second production calculation.
  Delivery continues to copy the exact reviewed artifact without regeneration.
- Studio's normal and tour export routes share generation, approval and delivery
  operations. Tour-only teaching policy remains outside those lifecycle
  operations. Browser presentation now has one identity/model and explicit
  replace, retain and clear effects; the separate stale-state and playback-cache
  owners were removed.
- The print and Studio dev-map regions regenerated with no stale pages, orphan
  facts or fact errors. Focused lifecycle, migration, worker, tour and browser
  presentation checks passed. The final full parallel core run passed all 675
  tests. This is software evidence only.

## 2026-09-21 — Maker and builder guidance synchronized after wiring simplification

- Updated the print, export, Studio and rendering contracts for the atomic
  `saam-print-bundle/2` manifest, the single prepare/commit generation candidate,
  shared normal/tour lifecycle operations and the browser's one presentation
  model. Maker behavior and the tour sequence did not change.
- Removed the duplicated per-skill registries from both human context maps. The
  maps now route through the catalog-backed `skills/README.md` digest, identify
  the shared H2D/X1 contract and use executable dev-map entry `0`.
- Strengthened context-map coverage so copied skill registries, the invalid
  `0_system` command and a stale H2D-only label cannot return. Repaired two dead
  test-manual links and normalized the outstanding-work queue; dated Bambu
  implementation and hardware evidence remains in this log rather than the queue.
- `node scripts/check-repo.mjs` passed across 76 documents and 1,085 local links.
  Fifteen focused context-map, manifest, generation-worker and presentation tests
  passed. This is software/documentation evidence only.

## 2026-09-21 — Job-scoped checked-output handoff

- Replaced Studio's process-global worker attachment and checked-source slot with
  a handoff owned by each prepared generation job. The handoff owns the worker
  message subscription, supplies the job an opaque, single-use ticket alongside
  the successful message, and removes the subscription when disposed. Pending
  sources are keyed by generation/export identity, capped at 32 entries and
  expire after one minute, so concurrent jobs remain independent without
  retaining abandoned source indefinitely.
- The handoff rejects stale, disposed, cancelled, mismatched and forged results,
  strips motion arrays and returns defensive metadata/source copies. Workflow
  reuse still follows a reread and hash of the current output bytes; cold and
  full-motion loads continue through the interpreter.
- Forty-five focused handoff, worker/job, Studio opening, read-scope and workflow
  tests passed, including concurrent tickets and saved-output tamper rejection.
  This is software evidence only.

## 2026-09-21 — Coherent Studio operation snapshots

- Conditional state reads now use one stable bundle snapshot for both their ETag
  decision and response instead of discarding a first lifecycle read on cache
  misses. The tag includes the request, import-repair, tour, generation-failure
  and cancellation metadata returned by the route.
- Machine-source reads use one source-bearing snapshot for request identity and
  streaming instead of a fingerprint/read/fingerprint sequence. Atomic manifests
  therefore use one lifecycle read per state or source GET; machine-study keeps
  its existing legacy stability retries. Geometry-only state still omits export
  bytes, and source state still omits full motion.
- Thirty-four focused read-scope, source-player, state metadata, Studio opening,
  tour and reconnect tests passed. Instrumentation covered conditional hits and
  misses, source success and stale-byte rejection at one snapshot each. This is
  software evidence only.

## 2026-09-21 — Ordered Studio updates and explicit refresh stages

- The existing viewer stream now carries ordered state and preparation updates.
  Connected clients coalesce state triggers into one conditional read and apply
  identity-scoped progress without a full-state read. State and progress polling
  run only as a disconnect fallback; late subscription and reconnect recover
  current progress and state, while visibility recovery checks state changes.
- Refresh now has explicit load/adopt, presentation and tour-generation stages.
  Tour generation adopts and presents its result directly instead of recursively
  entering refresh. Disposal clears queued refresh and fallback work.
- Viewer progress uses the Studio instance and hashed viewer print identity;
  agent generation events retain their request-derived print identity. The
  server and UI share the same cancellation-capable preparation status, including
  commit-phase cancellation semantics.
- Sixteen focused scheduler/lifetime tests and 53 Studio integration tests passed.
  An actual SSE generation test verified the payload consumed by the UI and the
  separate agent identity. This is software evidence only.

## 2026-09-21 — Shared lifecycle review decisions

- Kept current-byte validation, generation identity and exact approval hashes in
  the bundle workflow. Added a pure projection for the smaller decisions that
  Studio controls, toolkit summaries and MCP summaries had derived separately:
  checked currency, production readiness, effective toolpath approval and next
  review action.
- Geometry-only reads now consistently report output currency and approval as
  unknown instead of inferring either from the manifest. UI labels, output
  availability, calculation/cancellation activity and request presentation keep
  their existing owners.
- A focused matrix covers no output, unavailable output, development and
  production generation, approved output, changed bytes and unchecked reads.
  Cross-consumer assertions confirm Studio, toolkit and MCP use the same derived
  decisions; existing workflow tests retain exact-hash and promotion coverage.

## 2026-09-21 — Shared incremental STL decoding

- Replaced the independent buffer and file STL parsers with one incremental
  decoder for binary records and ASCII tokens. Complete buffers and 64 KiB file
  streams now share recognition, grammar, unit scaling, finite checks, exact
  vertex indexing and capacity enforcement. File I/O still owns hashing,
  progress, cancellation and changed-length detection without retaining another
  full source or text copy.
- Standardized ASCII on the existing streaming line-oriented grammar. Leading
  whitespace, CRLF, split UTF-8 header text and closing solid names remain
  accepted. The buffer-only acceptance of a same-line `solid ... endsolid` file
  was removed because it cannot contain standard facet records.
- Eighteen focused large-mesh, repair and decoder tests passed, covering varied
  one-byte through record-sized chunks, malformed/truncated/extra data and
  trailing lines, nonfinite scaling, progress, cancellation and capacity failure.

## 2026-09-21 — Output contract ownership assessment

- Reviewed exporter selection, locked machine output declarations, lifecycle
  filenames, Studio source playback and delivery MIME handling. The production
  exporter registry already solely owns exporter/interpreter implementation
  dispatch. Locked `outputs[]` entries separately and legitimately own each
  machine's enabled outputs, extension, constraints and optional MIME metadata;
  workflow consumes those declarations without inferring a machine from a name.
- Studio's source-player switch is a browser boundary over streamed text/source
  maps and browser move storage, not a second production exporter. Merging it
  into the Node registry would add Node/browser coupling or another catalog.
  Delivery's small extension-to-MIME mapping and compound-extension naming are
  presentation concerns; moving them would require another bundle read or a
  breaking change to the path-returning delivery API.
- No implementation changed. Bambu resolution/settings and concurrent work were
  left untouched. Existing output bytes, interpreter behavior, filenames,
  availability and content types therefore remain the evidence for this review.

## 2026-09-21 — Explicit legacy print-bundle migration

- A bounded read-only inventory of repository `Prints/` and `examples/` found
  130 ordinary bundles: 6 current `saam-print-bundle/2` manifests and 124 legacy
  split-file bundles. It found no machine-study bundles or unclassified plans.
  None of the inventoried bundles was converted or deleted.
- Ordinary legacy reads and fingerprints are now effect-free and return the
  exact explicit CLI migration command. `cli.mjs migrate` preflights legacy
  plan, machine, review, geometry/source and program bytes, stages missing
  immutable artifacts, rechecks captured presence and bytes before atomically
  replacing `plan.json`, then reloads the manifest for verification. It retains every legacy
  sidecar and unknown file and reports all created, updated, removed and retained
  paths; current bundles are idempotent no-ops.
- Valid current legacy programs retain their exact approval identity. Stale
  programs remain retained and explicitly unapproved; corrupt bytes and malformed
  inputs fail before the manifest commit. Eight focused tests cover effect-free
  reads, explicit reports, current no-op/CLI access, malformed and corrupt input,
  concurrent input changes including absent files appearing, stale approval, and
  fresh-process reopen with current-byte invalidation. Compatibility remains
  until supported/distributed split-file inventory reaches zero and its migration
  window is closed in a documented release.

## 2026-09-21 — BR-057 recommendation queue completed

- Authorization: the current requester asked to "Quickly regen our dev maps now"
  and to "Synthesize both sets of recommendations into a task queue, organized by
  priority/value, and assign them one at a time to a single worker agent (sol)."
  Contributor account and exact originating task title are unconfirmed. One Sol
  worker implemented the queue sequentially under parent review.
- Completed six retained tasks: job-scoped checked-output handoff, coherent
  Studio snapshots, ordered updates and explicit refresh stages, shared lifecycle
  review decisions, incremental STL decoding, and explicit legacy migration.
  Their behavior and focused verification are recorded in the entries above.
- Dropped output-catalog consolidation after finding distinct legitimate owners;
  also omitted already-shared generation, cosmetic extractions and speculative
  wholesale configuration/schema changes. The final migration checks passed 8/8,
  including fresh-process reopen. Maps were regenerated and relevant pages reread
  without orphan or fact errors. Concurrent test reductions were preserved.
- Removed BR-057 from outstanding work. BR-050's broader cross-process and
  performance audit remains separate; the migration currentness check is not a
  cross-process lock or compare-and-swap. No inventoried user bundle was migrated,
  no hardware execution was performed, and no changes were published.

## 2026-09-21 — S5 bridge interpolation trial and narrower array

- Nave reports that physical inclined extrusion spans change Z too early in both
  directions. The previous export commanded each free span with one coordinated
  G1; software straightness did not establish physical axis coordination.
- Added optional bridging `maxSegmentMm`, using collinear XYZ samples and distinct
  segment metadata to retain commanded intervals through path compaction. Array 02
  uses 0.5 mm maximum intervals with constant speed and volume per length, no
  inserted pauses, and no added travel in continuous courses. Physical mitigation
  remains unvalidated; a one-line S5 note is now in builder guidance.
- Halved rectangular X widths to 13.8 mm while retaining 24 mm first-layer Y spans;
  transverse second-layer spans now measure 12 mm. Circular supports are unchanged,
  with bridges only over their left 180 degrees. Preserved previous array inputs.
- Export audit passed for 624 spans, all intermediate XYZ endpoints and lengths,
  flow, matching first layers, attachment controls, and 1,160 standard wall loops.
  Generated estimate: 46.4 minutes. Exact program identity and compact report are
  in PT-001 Array 02; physical success is still to be assessed.

## 2026-09-23 — USB orientation test and 180-degree staging package

- User requested a simple vertical orientation test on D: while preparation of the
  full current 180-degree export continued. Added SAAM_ORIENT1.pcs to the existing
  STRUDER11 source/test folder and appended its ordinary-program manifest entry.
  Before/after SHA-256 inventory proved those were the only two changed USB files.
- The test captures CurPos after selecting T6/W2, rises 20 mm while tilting 45
  degrees toward +Y, returns to the captured pose, then repeats toward +X. Four
  stopped Move L commands, no process/rotary output, no taught-position mutation.
  CurPos and component extractors were checked against the DENSO command manual
  and preserved controller source. Controller compilation/run awaits user report.
- Preserved the current USB source template locally, then stopped USB access so
  the user can test. Prepared a local 180-degree staging ZIP containing the existing
  continuous tube/first-shell source, a separate extrusion-off positioning helper,
  checked program hashes, instructions and a manifest-preserving staging script.
  The positioning endpoint exactly matches the continuous program's first pose.
- ZIP round trip preserves all six files. Local staging fixture verified original
  manifest bytes/unrelated files, idempotence and rejection of conflicting output.
  No full-job files were staged on USB. Full path and helper still await controller
  syntax checks and Teach Check; the software model has no controller joint limits.

## 2026-09-25 — Relay stage 1: operations separated from MCP registration

- Started BR-058 on the user's request to begin the relay plan; developer role.
- Moved every agent operation, its strict schema, the print-work queue and the
  Studio/request state into [the local runtime](adapters/mcp/src/runtime.mjs)
  (`createLocalRuntime`: `operations`, `invoke`, request/event subscriptions,
  `close`). [The MCP server](adapters/mcp/src/server.mjs) now only registers the
  operations as tools, forwards notifications and serves stdio. Tool names,
  schemas, annotations, instructions, results and close behavior are unchanged;
  the local extension's `registerMcp({tool,…})` hook keeps its interface.
  `summary` is now imported from the runtime; the unused `openBrowser`
  re-export was dropped.
- Verification, in the shared checkout (concurrent edits there touch only
  `dev-map/lib`): the six MCP-related suites passed 32/32 before the change and
  33/33 after, including a new test that drives the runtime without a transport,
  matches its operation list to MCP discovery and checks strict-schema rejection.
- Not yet done: connection-independent runtime lifetime, recorded idempotent
  operations and generation job receipts (see BR-058).

## 2026-09-25 — Relay stage 1: the runtime outlives its sessions

- User direction: a closed connection is not resumed; the bundle holds the work
  that matters and a new chat opens it. Recorded under D-037 and in the relay
  plan's interruption table.
- `createLocalRuntime().beginSession()` returns `{id, invoke, end}`; one session
  is active at a time. Ending it drains the print-work queue, fails that owner's
  unfinished requests with `connectionClosed`, releases pending
  `wait_for_studio_request` calls without claiming, notifies Studio viewers and
  discards held events. Studio instances and the runtime stay; late calls from the
  ended session are rejected. `createMcpAdapter({runtime})` ends only its session;
  without one (stdio) it owns and closes the runtime as before.
- The request store's `endSession()` is split from `disconnect()`, which still
  permanently closes it. Studio's connection-closed notice carries `closedAt`, so
  a later session of the same owner is no longer shown as "(connection closed)".
- Verification, shared checkout: 98/98 across the MCP suites and every test
  touching the request store, Studio lifetime/open/tour/generation and workflows,
  plus the new sequential-sessions test (Studio reused, pending wait released
  unclaimed, fenced late call) and a work-state test that fails under the old
  per-owner Set. The sessions tests exit cleanly without `--test-force-exit`.
  Dev maps were not regenerated: a concurrent session is editing the generator.
