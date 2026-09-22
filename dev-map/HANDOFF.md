# Dev map handoff

State of the dev-map work as of 2026-09-21, for whoever continues it. Intent is
owned by [DEVELOPER-CONTEXT.md](../DEVELOPER-CONTEXT.md); this file explains
the reasoning behind that intent, records what has been built against it, and
lists what remains, in priority order, with the rationale for each item. It is
not a manual and not a record of evidence; dated evidence is in
[DEVLOG.md](../DEVLOG.md) under the 2026-09-21 entries.

## Why the map exists, in the owner's words

The owner's standard, stated during the 2026-09-21 review: a visual knowledge
graph interface lets a reviewer go ten times faster with four times the
confidence, and gives an agent an orientation that is inherently trustworthy,
because the person can trace the same path. An agent reads from map 0 and
reads downward until it finds the leaf it needs. From every map it must be
clear which map to open next to reach any given functionality. Standing on a
leaf, the agent must fully know that leaf's context, so it can edit the code
knowing the consequences, without a separate trace call and without anything
extra in its head. Some duplication is necessary for complete context within
one view; if a repeat does not give that, the agent should not be reading it
twice. The maps should contain exactly everything, and nothing more.

Everything below follows from that standard. When a judgment call comes up,
apply it directly rather than a proxy such as a box count.

## What "useful" meant in practice

These are the concrete rulings, each from a page the owner looked at.

- **A page that draws one box conveys nothing.** Map `1.2` was a file page
  pointing at its one declaration; `validatePath::point`, a one-line boolean,
  had its own page because one gate counted as an operator. Ruling: one rule
  decides map versus code, and operators alone never make a map. A map draws
  at least two called declarations with a wire.
- **A floating box conveys nothing, but the call it stands for does.** The 455
  floating call boxes were calls whose arguments and results the tracer could
  not source (nested-call arguments, module constants, loop variables,
  destructuring, `Promise.all`). Ruling: the invocation edge is drawn from the
  function to every call it makes, with untraced arguments shown as marked
  stubs; the tracing gaps are generator work. Built 2026-09-21 (queue item 1).
- **Nested helpers are not siblings of their parent.** Listing them as group
  members added a nesting level everywhere and made up nearly half the
  authored membership. Ruling: a declaration written inside another is homed
  by its holder, automatically, and is rejected as an authored member.
- **The tree is functional, not a file tree.** "Where the code lives does not
  enter into it" was already written and still contradicted by file-based
  grouping: `core/region/region2d.mjs::regionComponents` was homed on a group
  that meant only "declarations of region2d.mjs", while its flow page and its
  callers' pages already represented it fully. Ruling: a region page shows its
  flow roots (declarations nothing in the region calls); everything else is
  homed by the first flow page that reaches it; file paths are rejected as
  members; authored groups only cluster roots, by link relationships,
  visibility and saliency. Measured before the change: every non-root
  declaration in every region is reachable from a root by in-region calls.
- **Callers outside the map are part of a leaf's context.** Zero declaration
  pages listed an outside caller although skills call core/geom over four
  hundred times. Ruling: an active caller set, authored in `lib/scope.mjs`, is
  drawn on the pages it calls; a caller is active when it runs while a person
  makes a part or operates Studio. Everything else scanned is counted only.
- **Calls leaving the map are part of context too.** They were folded into
  one `external` count with platform calls. Ruling: headless arrows naming the
  target at every level; `outside` and `platform` counted separately.
- **Findings are never removed, and they follow their node.** The owner
  rejected pruning uncertainty rows outright: the rows stay until the intent
  discussion says a kind is not a problem. A finding about a node is shown on
  every map that draws that node, once per node however many boxes draw it:
  the box carries a count and the rows sit in the page's finding list below
  the drawing, sectioned by node. The implementation applies this to
  containment maps; function pages do not yet list the rows of the nodes they
  draw (ruled on 2026-09-21: they should, once per node). See the queue.
- **Scope is product code.** The agent CLI toolkit is not core; it is scanned
  as an outside caller. The Lua interpreter stays in scope: name-keyed
  function tables are a normal boundary pattern here (eight of them in core
  and Studio), so they became `registry-entry` couplings rather than an
  exclusion. Its three uncalled global accessors were dead code and were
  deleted.

## The code-shape criterion

The owner's framing: map compatibility is worth adjusting how code is
written, so judge per pattern whether teaching the scanner or restricting the
code is cheaper and more trustworthy. The outcome:

| Pattern | Ruling |
|---|---|
| `super(...)`, calls in destructuring defaults, loop variables, nested-call arguments, `Promise.all` wrapping, method calls on instances and records, callbacks passed as parameters | Scanner work. Well-defined syntax; restricting it would touch ordinary code for nothing. |
| Runtime subscriber lists | Scanner reports `registered-subscriber` naming the registration; no static target exists. |
| A callable or state held in a reassigned binding | Restricted (rule 1). A human reviewer cannot see it either. |
| A callee chosen by an expression | Restricted (rule 2). |
| A stage mutating caller-owned state | Restricted (rule 3), with the explicit-controller exception. |
| String-keyed dispatch tables | Allowed; drawn as registry entries. |

The rules are "strongly preferred; the restricted form needs the owner's
permission for a compelling case". A rewrite is a code-shape fix only if the
map draws the relationship afterwards; two of the first-pass rewrites made
ownership visible without resolving the call and were kept because they match
the explicit-state guidance, and the owner was told.

Both sites are settled (2026-09-21): `studio/machine-view.mjs::drawMachineCanvas`
keeps its Canvas 2D property writes bracketed by save and restore, and
`core/export/bambu.mjs::completeProgram` now returns a new program record.

## What has been built (dev branch, 2026-09-21)

In commit order. Each has a DEVLOG entry with the measurements.

1. `32c8b40` core/agent moved outside the scope (`unmappedDirs`).
2. `4fc5a3b` first code-shape pass: 8 sites rewritten, 6 recorded as scanner limits.
3. `cdb6cb2` one collapse rule; nested helpers homed by holder; constructors folded; 374 nested members, 23 dead file flows and 16 one-box groups removed; `check` fails on unplaced.
4. `c494be0` scanner: `super`, pattern defaults, instance and record receivers, callback provenance and candidates, resolution for outside roots, `registered-subscriber`.
5. `5f8941b` second code-shape pass: dead Lua accessors deleted; parameter mutation judged at 40 sites, 4 declarations rewritten; closure state triaged (163 bindings, one callable rewritten).
6. `c7f1ad7` active callers on declaration pages; scope-edge arrows at every level; `outside`/`platform`; findings on the boxes that draw them.
7. `86c37cf` function tables become registry entries (48 tables; islands 187 to 117).

8. The functional tree (DEVLOG 2026-09-21, "Dev map: functional tree"):
   operators no longer count toward the collapse rule (129 pages became code);
   region pages home flow roots only, with wires contracted onto the owning
   root; the walk is confined to a declaration's own region; file pages and
   file addresses are gone, `stranded` replaces `unreached`; file members
   rejected and the flows converted, which dropped 96 of 148 groups and left
   52 clusters over 266 members. No relationship or finding row changed.

Two consequences of the tree to look at before settling:

- **Depth.** Max page depth went from 7 to 18. The deepest index is a genuine
  17-step call chain inside studio (`studio/machine-view.mjs::require`), not
  an artefact: depth-first homing along real calls makes a long chain a long
  index. Breadth-first would home shared helpers shallower but would no longer
  read as a flow. The owner set no cap; decide whether a very deep chain wants
  a different presentation.
- **Lost labels.** Whole named layers fell below two roots and vanished:
  studio's interaction, requests and per-view groups; core/export's gcode,
  robot-commands and lua; most of core/print, which now shows one cluster and
  four loose roots. That is the mechanical result of the rule and the reason
  the thoughtful clustering pass (queue item 8) is next.

## What remains, in order

0. **Leaves drawn on the map above.** Built 2026-09-22: the walk never
   descends into a code destination; a leaf's callees are drawn on its home
   map wired from its box (`inlined`, `via`); a leaf root's chain is on the
   region page, with their rows. Left: a map calling the same leaf twice
   hangs the chain off the first instance; only leaf data wires with both
   ends in the chain are carried.
1. **The invocation edge.** Built 2026-09-21 (`lib/invocation.mjs`): every
   drawn box is wired to its function in call order, untraced argument slots
   are marked stubs with a reason, and a held or referenced declaration gets a
   `declaration` or `reference` edge. Floating boxes 1434 to 0; `--details`
   carries them since 2026-09-22. Left open: `literal` stubs (1778 of 3994)
   mark constants rather than tracing gaps.
2. **Callback targets as references, not boxes.** Built 2026-09-21:
   `parameterTargets` rows on the callee's port, boxes on the caller's page.
   Left: 9 boxes where the callable is destructured from a parameter record;
   a supplier with no page (ambiguous `onclick` anchors) falls back to the
   file; `linked` now counts the rows.
3. **Closure-owned state on member pages.** Built 2026-09-22: `state` nodes
   with read and write wires on member and holder pages; capture text off
   the reference box. Left: class instance state (`this.x`) is still only
   the class page's field hubs; captures inside anonymous nested callbacks.
4. **Enter array-method callbacks.** Built 2026-09-21: iteration methods
   are stages with the item as input (`shapes.mjs::iterationMethods`); 645
   callbacks entered. Not in the table: `Array.from(x, fn)`, `flat()`. A
   throw inside an entered callback is not yet an exit port.
5. **Loop accumulation.** Built 2026-09-22: 574 accumulators carried,
   `loop-data-flow` 882 → 129 with a `reason` each. Left: `Set`, `splice`
   and `get(k).push` collections; multi-path backedges; generators; finding
   rows naming operators the liveness pass drops (557).
6. **Finding rows on function pages.** Built 2026-09-22: `findings` on
   every drawn box, `nodeFindings` sections once per node; chain boxes and
   `file` on rows followed on 2026-09-22. Left: `createStudio` shows 527
   rows.
7. **Repeated invocations of one declaration.** Ruled 2026-09-21: kept.
   Every source call is its own box, assertions included.
8. **Thoughtful root clustering.** After the tree reshape lands, the region
   pages show their roots; cluster them by link relationships, visibility and
   saliency where a label helps, and drop groups that only restate a file.
9. **The two code-shape sites above.** Done 2026-09-21.
10. **Unreached declarations and dead code.** Reviewed 2026-09-21: of 137
   declaration pages with no caller and no coupling, 96 were triaged by hand;
   10 were dead and deleted, 36 are entry points called from outside the
   scanned roots, 48 are calls the scanner does not resolve (the DEVLOG entry
   lists them by limit). Re-measure after the array-callback work.

Scanner limits recorded and accepted, not to be "fixed" in code: `res.end` and
`res.write` on node:http parameters; members on reassigned `let` receivers;
a policy assembled by spread; `this` inside object-literal methods; `now()`
whose only known value is a parameter default; callbacks supplied only by
unscanned callers (`onGeometry` in `runRepairJob`).

## How the work was run

- The owner assigns the number of concurrent workers per chat; each worker is
  told to stop and report at roughly 300k tokens, and the main session
  verifies every claim itself (reruns the tests, runs `check`, reads the pages)
  before checkpointing. Checkpoints commit everything in the checkout,
  including other sessions' concurrent work, per
  [CONTRIBUTING-AGENTS.md](../CONTRIBUTING-AGENTS.md); a narrower commit was
  used only when another worker was mid-edit in the same checkout.
- Generator work runs in an isolated worktree from the current head so the
  main checkout's store is not written concurrently. A worktree has no
  `node_modules`; create a junction to the main checkout's before generating.
  Code-shape work runs in the main checkout because it needs the tests.
- Every generator brief carries a before/after measurement script and names
  the pages the worker must read to confirm the change; the useful counts are
  pages by kind, index depth, single-box graph pages, unattached boxes on
  structural pages, declarations published exactly once as home, authored
  members, unresolved rows by rule, and `check` totals.
- Another session was editing the Bambu H2D exporter throughout; its files
  were never touched by map workers and `check` reported them stale whenever
  they moved. Expect the same.

## Open questions for the owner

- Should `literal` argument stubs be drawn, or only genuine tracing gaps?
- A 17-step call chain is a 17-step index; does a very deep chain want a
  different presentation, or is that clustering's job?
- Interpreter-style methods (`LuaRuntime::execStatement`: one switch over
  statement kinds, 46 boxes, 43 of them repeats) draw faithfully but read
  badly; a per-kind dispatch table would draw as registry entries. Code
  shape or leave it?
