# Agent guidance for SAAM

You've connected to (or are reading the source of) SAAM — Struder
Agentic Additive Manufacturing. This file is what you need to actually
use it well, whether you're an MCP-connected agent composing a part for
someone or a coding agent modifying this repository itself. See
`PROJECT_CHARTER.md` for what SAAM is and isn't; this file is the
practical "what do I actually do" companion to that.

## If you're connected via the MCP adapter: the one loop that matters

A human asked you to design or produce something for additive
manufacturing. Here's the actual sequence, every time:

1. **`list_machines`** and **`list_operations`** — always call these
   first, even if you think you remember what's available from a
   previous turn. They read real manifests off disk; the catalog
   changes as this repo grows. Use an operation's `id` field (not its
   display `name`) everywhere below.
2. **Show the target before choosing how to build it.** If the part has
   real dimensions to get right (a commercial product, a functional
   part), look them up rather than guessing. Then call `compile_plan`
   with `machineId`, that `target` (a simple envelope: `shape`,
   `width`/`depth` or `outerDiameter`/`innerDiameter` — plus
   `baseOuterDiameter` for a tapered round part — and `height`), and an
   **empty** `operations` array. This publishes a target-only preview to
   the workbench — nothing to build yet, just the shape and dimensions
   you're proposing — and opens it in the human's browser automatically
   the first time you call it. Get their confirmation on the target
   itself before moving on to step 3. Don't skip straight to composing
   operations just because you're able to.
3. **Once the target's confirmed, compose operations toward it.** Call
   `compile_plan` again with the *full* operation list (not just one new
   addition — it replaces the whole plan, it doesn't append) and the
   `target` omitted, which keeps the one already declared. The
   workbench's "Finished Part" view renders that `target` directly and
   only that — never derive it from toolpath data or from whatever an
   individual operation happens to output; that's exactly what made
   "Finished Part" show the wrong shape before this was fixed. The
   already-open workbench tab updates in place. If an operation you need
   doesn't exist yet, see the section below before improvising with the
   wrong one.
4. **Read `warnings` in the response, if present, and relay them.**
   Some generators report their own advisory concerns — e.g.
   `vase-wall`'s steep-taper check, which flags a taper steeper than the
   general FDM unsupported-overhang guideline. These aren't errors and
   don't block compiling; they're real information the human should see
   before approving, not something to silently act on or silently drop.
5. **Tell the human to review and approve in that browser tab.** This
   is not optional and you cannot do it yourself — see "Rules that
   never bend" below. Say something concrete: what you built, why, and
   that you're waiting on their approval before export.
6. Once they say it's approved (or you want to confirm before assuming
   so), call **`get_approval_status`** with the plan and the scope you
   need — `geometry`, `executable-export`, or `machine-control`. Scopes
   never imply each other: an approval for `geometry` does not also
   authorize `executable-export`, and you should ask for whichever scope
   actually matches what you're about to do next.
7. Call **`post_process`** with the approved plan to get real,
   machine-native output (e.g. DobotStudio Pro Lua for the reference
   Dobot machine). It refuses cleanly if the approval is missing, stale,
   or scoped too narrowly — that refusal is correct behavior, not a bug
   to route around.

`validate_plan` and `request_review` exist for edge cases (checking a
hand-edited plan's shape; publishing a plan you built outside
`compile_plan`) — you likely won't need them for the common path above.

**No agent handy for the human, or want to demonstrate the loop
yourself first?** `node examples/compile-approve-export.mjs` runs the
same sequence end to end from the command line and prints real output —
see `examples/README.md`.

## Starting a new target, or replacing an existing one

A freshly opened workbench with no session yet is just empty — don't ask
anything, just start composing once the human describes what they want.

But if there's already a plan in progress and the human asks you to
build or load something new, ask first: do they want this **added to
the current build plate** alongside what's already there, or is this a
**new project** replacing it? If they want a new project, prompt them to
`Save plan…` for the one in progress before you clear it out from under
them — don't silently discard work.

Be honest about a real current limitation while you ask: this schema
doesn't yet support multiple independent parts sharing one build plate
with their own targets and operations — today a plan holds exactly one
`target` and one `operations` list. "Add to the plate" right now
practically means composing more operations toward the *same* target,
not placing a second independent part next to the first. Machine build
volume isn't in a machine manifest yet either (see
`machines/*/manifest.json`'s `modelConstraints` — no bed-size field
exists today), so nothing currently checks that a target actually fits.
Don't pretend either of these works today; say what's actually possible
and treat true multi-part support as a real gap, not solved.

## If an operation you need doesn't exist yet

Don't invent one and don't approximate a shape with the wrong operation.
Check `ROADMAP.md`'s planar operation catalog — it's a sourced survey of
what's designated but not yet built, organized by category, with notes
on what's already `available`. Tell the human what's missing and, if
useful, what's already on the roadmap for it. Building a new operation
is real engineering work (see `docs/authoring/operations.md`), not
something to fake at plan-compile time.

## Rules that never bend

- **You cannot create an approval, under any circumstances.** Every
  tool that touches approval either reads it (`get_approval_status`) or
  refuses without it (`post_process`). Approval happens exactly one
  place: a human clicking a button in the reference workbench. If you
  find yourself trying to construct an approval record directly instead
  of asking a human to click that button, stop — that's the one gate
  this entire project is built around, and it's designed so nothing you
  do can route around it.
- **Never invent, adjust, or "improve" geometry.** `compile_plan`
  restates exactly what the named operations' own generators produce.
  If a request needs geometry no existing operation can produce
  faithfully, say so — don't approximate silently.
- **Evidence labels are load-bearing, not decoration.** A plan that
  validates and previews cleanly confirms *intent and coordinates* —
  never treat it, or describe it to a human, as proof that a specific
  physical setup is safe to run. See `docs/authoring/evidence-labels.md`
  for the label set (`ROBOT-CONFIRMED`, `DOC-CONFIRMED`, `EXPERIMENTAL`,
  `KNOWN FAILURE`, `NEEDS RETEST`) and never upgrade one yourself.
- **SAAM never calls a model or holds a credential, and you shouldn't
  either on its behalf.** The reasoning is yours, on your own account —
  see `docs/architecture/agent-safety-boundary.md`.

## If you're modifying this repository itself

- Run `npm test` from the repo root before and after changes — golden
  fixtures plus real subprocess MCP integration tests, currently 54
  passing. A change that doesn't pass isn't done.
- Added, removed, or edited a `manifest.json` under `operations/` or
  `machines/`? Run `npm run generate-registry` and commit the resulting
  `registry/registry.json` — `tests/golden/registry-generate.test.mjs`
  fails on drift between that file and what's actually on disk.
- Read `docs/authoring/operations.md` before adding an operation,
  `docs/authoring/machine-definitions.md` before adding a machine, and
  `docs/architecture/operations-vs-postprocessors.md` before touching
  the boundary between the two — an operation defines shape strategy
  machine-independently; a post-processor translates or refuses
  approved geometry for one specific controller, and never redesigns it.
- This is a clean-room, from-scratch codebase, not a port. Don't
  reintroduce single-agent-specific naming, hardcoded machine
  assumptions, or a chat/prompt surface inside the reference workbench —
  see that interface's own README for why those were deliberately
  removed.

## Map of what to read next

| Question | Read |
|---|---|
| What is SAAM, and what isn't it? | `PROJECT_CHARTER.md` |
| What's built vs. designated-but-not-yet? | `ROADMAP.md` |
| How do I author a new operation? | `docs/authoring/operations.md` |
| How do I author a new machine? | `docs/authoring/machine-definitions.md` |
| What's the evidence-label system? | `docs/authoring/evidence-labels.md` |
| Operation vs. post-processor — where's the line? | `docs/architecture/operations-vs-postprocessors.md` |
| What does the MCP adapter expose, exactly? | `adapters/mcp/README.md` |
| What does the adapter deliberately *not* do? | `docs/architecture/agent-safety-boundary.md` |
| How does approval actually get created and checked? | `docs/authoring/process-plan-workflow.md` |
| What does the reference workbench do, live vs. standalone? | `interfaces/reference-workbench/README.md` |
