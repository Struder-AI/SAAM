# Jelly benchmark: reuse, study or drop

Benchmark of [Jelly](https://github.com/cs-au-dk/jelly) (Aarhus, BSD-3) against the influence analysis and the runtime traces, 2026-10-04, for the [dev maps intent](../../plans/dev-maps.md#analysis). Jelly was installed outside the repository for this benchmark only, with the owner's approval. It is not a SAAM dependency.

**Recommendation: study two techniques and drop Jelly as an engine.** Its call-graph recall on our traces matches ours (93.9% against 93.3%), and its speed and memory are in the same range. It gives none of what the intent needs beyond call edges: roles, state arrows, call-site context, soundness and incremental refresh are all missing. The technique to port is how it handles unknown values. A value from an unknown source becomes a symbolic token, and every function passed to a call on that token is assumed to be invoked. That technique accounts for most of what Jelly finds and we miss (103 of 114 pairs).

## Setup

- **Version:** `@cs-au-dk/jelly` 0.13.0 (npm). Installed with `npm install @cs-au-dk/jelly` in `%TEMP%\jelly-bench`. Node 24.19.0, Windows 10, 12 logical CPUs, 16 GB.
- **Scope:** the 344 in-scope files of `run.mjs` (its `inScope` rule), passed as entry files.
- **Commands** (run from the worktree; `FILES` is the 344 paths):
  - Ours: `node --max-old-space-size=6000 dev-map/influence/run.mjs --depth 2 --out ours.json all`
  - Jelly A, without dependencies: `node --max-old-space-size=8000 %TEMP%\jelly-bench\node_modules\@cs-au-dk\jelly\lib\main.js -b . -j jelly-cg.json --no-tty --no-print-progress FILES`. With the worktree as base directory, `node_modules` (a junction) resolves outside it, so Jelly skips every package.
  - Jelly B, with dependencies: the same command with `-b C:\CodeProjects\SAAM_tkeller`. This analyses 18 packages: zod, fflate, fontkit, rhino3dm, manifold-3d, clipper2-wasm and their dependencies.
  - Jelly C: B plus `--approx` (approximate interpretation). See [Capabilities against the intent](#capabilities-against-the-intent).
  - Traces: `node dev-map/influence/trace/trace.mjs run --dir traces`, covering all six workflows with disposable SAAM homes.
  - Comparison: [`trace/jelly-to-keys.mjs`](trace/jelly-to-keys.mjs). `convert --jelly jelly-cg.json --out jelly.json [--strip .claude/worktrees/<agent>/]`, then `diff --dir traces --jelly jelly.json --ours ours.json --out diff.json`.
- **Key mapping:** Jelly reports 1-based line:column spans from Babel. The script maps each span to the acorn node that starts at the same position:
  - a function maps to its own node;
  - a class or object method (Babel starts it at the key, after `static`) maps to its value function;
  - a class maps to its explicit constructor, or to the class node when it has none;
  - module code (a span from 1:1 over the whole file) maps to the Program node.

  All 6,865 in-scope Jelly callables map onto exactly the analysis's 6,865 keys. Jelly functions outside the scope (packages, the six out-of-scope SAAM files it reaches) count as platform code: a path A → platform… → B becomes the edge A → B, as the traces record it. Jelly's 1,084 module-load edges into module code are left out, as they are in the traces and our map.

## Time and memory

The machine was shared with other agents' analysis jobs during the runs (CPU load 48–68% from other processes), so wall times vary up to 3×. The table shows the best of three runs, with the range in brackets. "Peak" is the OS peak working set.

| Run | Analysis time (tool's own) | Wall | Peak |
|---|---|---|---|
| Ours, `--depth 2` | 8.7 s [8.7–14.8] (parse 0.6, constraints 2.2, solve 5.1, derive 0.8) | 12.6 s [12.6–17]; 30 s with `--out` | 1.5–1.7 GB |
| Jelly A, no dependencies | 7.1 s [7.1–28.6] | 8.5 s [8.5–32.5] | 1.0–1.5 GB |
| Jelly B, 18 packages (2.1 MB more code) | 11.4 s [11.4–21.1] | 13.7 s [13.7–24.6] | 1.6–2.1 GB |
| Jelly C, `--approx` | did not finish (hung, killed after 11 min) | — | — |

Sizes:

| Run | Functions | Reachable | Call edges | Call sites with several callees |
|---|---|---|---|---|
| Jelly B | 9,989 | 4,813 | 16,157 function → function | 1.2% |
| Ours | 6,865 callables | — | 9,852 (from 9,859 arrows) | — |

## Recall against traces

The traces cover six workflows (starter-griffin, stl-bambu, denso-cladding, studio-session, agent-session, agent-toolkit) in 12 threads: 760.6 M calls and 2,343 observed caller → callee pairs between distinct SAAM callables. 1,689 callables (27.6%) were exercised.

An observed call counts as covered:

- **For Jelly:** when Jelly has the edge.
- **For ours:** when our map has the role-consistent arrow, as `compare.mjs` defines it. Treating our arrows as plain call edges changes nothing (2,187 either way).

| | Covered | Misses |
|---|---|---|
| Jelly A (no packages) | 2,195 (93.7%) | 148 |
| Jelly B (packages) | **2,199 (93.9%)** | 144 |
| Ours (exact keys) | **2,187 (93.3%)** | 156 |
| Union of Jelly B and ours | 2,301 (98.2%) | 42 |

**Comparator finding.** `trace.mjs compare` reports only 2,158 covered pairs for our map. It indexes folded callables (1,813 arrows name one) by line and name rather than by `foldedKeys`. Anonymous callbacks on one line then collapse, which undercounts us by 31 pairs. The exact-key numbers above come from `jelly-to-keys.mjs diff`. `compare.mjs` should index arrows by `fromKey`/`toKey`.

### What each misses (Jelly B against ours)

Causes are `compare.mjs`'s classification.

**Missed by ours only, Jelly has them (114):**

- 103 callbacks run synchronously by a platform call on a receiver whose points-to set is empty for us. Examples:
  - `layers.map(cb)`, `record.spec.layers.filter(cb)`, `courses.reduce(cb)` and `stroke.points.map(cb)` on data from parameters or JSON;
  - `section.requires.some(cb)` in `core/agent/layers.mjs:54`;
  - zod `z.toJSONSchema` and `schema.unwrap` calling SAAM lazy-schema callbacks.

  Jelly covers these because an unknown value is an access-path token. Calling a method on it is an external call, and each function argument of an external call is assumed invoked, with unknown parameters (`operations.js` `invokeExternalCallback`). No array model is needed.
- 4 getters entered by a property access, such as `PreparedGenerationJob.cancellable` and the forwarding getters in `core/geom/sleeve/mesh-sleeve.mjs:101`. Jelly models accessors; we record them as unmodelled.
- 4 asynchronous callbacks: `syncStatus` `.then` callbacks and `announcePreparation`.
- 1 direct method call: `previous.material.blocksSegment`.

**Missed by Jelly only, ours has them (102):**

- 83 callbacks whose receiver Jelly's native models leave empty:
  - `Object.entries(x).map/filter`, `Object.keys(x).sort().map`, `Object.values(x).every`;
  - the `mapFn` of `Array.from` and `Uint32Array.from`, and typed-array `.sort`;
  - `JSON.stringify` replacers;
  - zod `safeParse`/`parse` into SAAM refinements, even with zod analysed;
  - option callbacks such as `allocate` and `policy.combCorners`.

  Our platform models (`platform-models.mjs`) cover these.
- 16 direct method calls on objects that arrive through a parameter or a dynamic `import()`:
  - `(await bundleModule()).loadBundle` and `.proposedPlan`;
  - `recipe.validatePlan` and `bundle.initBundle` (`core/application/runtime.mjs:493`);
  - `args.operationDependencies` and `args.finishResults` (`core/print/slice-deposition.mjs`);
  - `adapter.interpret` and `index.contains` (`core/path/comb.mjs:22`);
  - `current.generateBundle` and `current.updatePlan` (`studio/server.mjs`).

  This needs our call-site context or dynamic-import handling; Jelly is context-insensitive.
- 3 direct calls by name through destructured options: `progress` and `dispatchComputation`.

**Missed by both (42):**

- 19 synchronous callbacks:
  - arrays from strings: `text.split('\n').filter`, `m[1].split(',').map`, `markdown.replace(re, fn)`;
  - `onProgress` passed through options to `studio/generation-worker.mjs:10 reportProgress`;
  - `instanceContext.run` (AsyncLocalStorage).
- 10 asynchronous callbacks:
  - worker `MessagePort` messages into `core/print/program-handoff.mjs:11`;
  - `process.nextTick` into `studio/lifetime.mjs` `release`;
  - server `onUpdate`.
- 9 direct method calls on dynamically imported bundle modules: `bundle.generateBundle`, `loadBundle`, `prepareGeneration`, `commitGeneration` and `withBundleInstance` in `runtime.mjs:761` and `generation-worker.mjs`; also `current.exportReviewed` and `surface.at`.
- 2 direct calls by name: `dispatchComputation` and `beforeCommit` (`workflow.mjs:604`, `workflow.mjs:622`).
- 1 accessor and 1 generator resumed by its consumer.

These are the common blind spots, channels and dynamic imports above all, which [UNMODELLED.md](UNMODELLED.md) already tracks.

### Static edges and precision spot checks

Among callables both analyses know:

| | Edges |
|---|---|
| Jelly B | 9,802 |
| Ours | 9,852 |
| Shared | 9,245 |
| Jelly only | 557 (160 from callers the traces exercised) |
| Ours only | 607 (170 from exercised callers) |

**Spot checks** (`jelly-to-keys.mjs diff` lists, random samples):

- **Jelly-only, from exercised callers (12):** all 12 are real possibilities. They are inline callbacks to array methods on data we hold no objects for: `prepareSliceContexts` → `box.min.map` callback, `finalizedSliceResults` → `node.requires.every` callback, `machineHint` → `filter` callback, `contextBudget` → zod lazy-schema callback.
- **Jelly-only, any caller (14):** 13 are callbacks of the same kind. One is a getter that forwards to an inner getter (`mesh-sleeve.mjs:101` → `:138`), which is real.
- **Ours only, from exercised callers (12):** all 12 are real possibilities:
  - `Object.entries(...)` and `Array.from` callbacks;
  - option callbacks (`args.operationDependencies?.(op)` → `skills/deposition.mjs:44`);
  - registry dispatch to another skill (`geometryTemplate` → `skills/records.mjs:24 heatSetTemplate`, `validatePlanGeometry` → `skills/records.mjs:32 validate`);
  - an alternative policy method (`canPlanComb` → `core/path/builder.mjs:49 canTravelDirect`, where the trace saw `slices.mjs:455`);
  - a dynamically imported `loadBundle`.
- **Ours only, any caller (14):** the same kinds, plus `startStudio` → a closure in `studio/server.mjs` reached through the returned session, and a Lua `length` accessor that we model.

No sampled edge in either analysis was infeasible. At this level the extra edges are each other's recall gaps on unexercised code, not imprecision. Neither analysis is more precise than the other here.

## Capabilities against the intent

| Intent need | Jelly 0.13.0 |
|---|---|
| Absent arrow means no influence (sound) | **No.** Unsound by design. Heuristics cover unknown values: callbacks of external calls are invoked, plus `this` patching, escape patching and optional dynamic-property and method-call patching. Unresolved code is skipped with a warning (2,177 warnings in run A). Measured recall is 93.9%, the same as ours. |
| Call-site context | **No.** Context-insensitive (one points-to set per variable), with call-graph-level heuristics only. Our 16 direct-method misses that Jelly lacks come from this. |
| Field reads and writes for state arrows | **Not exposed.** The solver is field-sensitive: `--tokens-json` prints `Object[file:span].field => tokens`. Nothing maps reads and writes to the function performing them; mod/ref would have to come from Jelly's internals (`FragmentState.registerPropertyRead`, property constraint variables), with no stable API. |
| Command/query roles, outcomes | **No.** Output is a call graph, points-to tokens, API-usage patterns and vulnerability reachability. |
| Platform: Node built-ins, ESM, packages | **Yes, partly.** ESM and CommonJS. ECMAScript and Node globals are modelled in `natives/ecmascript.js` and `nodejs.js`. Imported built-in modules (`node:fs`, `node:worker_threads`) are not modelled: their values are access-path tokens. Packages are analysed as source when inside the base directory, but analysing zod gained only 4 pairs (2,195 → 2,199), and neither WASM libraries nor worker or HTTP channels are modelled. |
| Library modelling by summaries | **No.** Packages are either analysed whole or replaced by access-path tokens (`--ignore-dependencies`). There are no declarative effect models like `platform-models.mjs`. |
| Approximate interpretation (`--approx`) | **Fails on SAAM.** It executes modules in a forked, proxied sandbox: non-whitelisted built-ins are proxies and timers and `fetch` are stubbed. `core/region/clipper.mjs:5` has a top-level `await createClipper()` (WASM), and the sandbox never resolves it, so the run hangs (log stops while loading `core/region/offset.mjs`). It also runs SAAM code, which our analysis never does. |
| Incremental refresh | **No.** Every run is whole-program. `jelly-server` is a stdin JSON loop (`options`, `files`, `expandpaths`, `exit`) that re-analyses on each request. `--eager-propagation` only reorders solving. |
| Uses the existing parser | **No.** Babel and the TypeScript compiler; adopting it would be a new dependency stack. |
| Unmodelled-shape reporting | **Partly.** `--warnings-unsupported` lists unhandled shapes (dynamic `require`, spreads into external calls, dynamic property writes). This is comparable to our `unmodelled` notes, but as warnings, not errors. |

## Techniques worth porting

1. **Unknown values as tokens, and callbacks of unknown calls as invoked.** Jelly represents a value from outside its model (an unmodelled platform result, a parameter of an exported function, `JSON.parse` output) as an access-path token, never as an empty set. A method call on such a token is an external call: every function argument is assumed called, with unknown parameters and `this`. This closes 103 of our 114 Jelly-covered misses, the largest miss group.

   For our soundness goal this is an over-approximation in the safe direction. Today an empty receiver set means no edge, so an arrow is absent without evidence. Port it as an `unknown` object kind in `points-to.mjs`. Reading a field of it, or the result of calling it, gives `unknown`. Calling a method on it invokes each function argument, with `unknown` arguments, and records the site as unknown-dispatch, so the checks can flag it.

2. **Escape-based callback discovery.** `findEscapingObjects` (`analysis/escaping.js`) marks functions reachable from exports or from values handed to external code. Their parameters get unknown values, so a function handed to the platform is still analysed with inputs. The same rule would give the 4 asynchronous and option-callback cases a caller-independent entry.

3. **Accessors** (4 pairs). Jelly treats a property read whose base holds a getter as a call. [UNMODELLED.md](UNMODELLED.md) recommends banning accessors. If the owner prefers to model them, Jelly's handling is the reference: a read or write site invokes `get`/`set` on every receiver token.

Not worth porting:

- analysing packages as source (small gain here, and our declarative models already cover zod's callback behaviour better);
- approximate interpretation (it executes code and fails on top-level await);
- the patching heuristics (they trade soundness for precision, against the intent).

As a development cross-check, Jelly is a useful second opinion: the union of the two leaves only 42 misses, and each analysis lists the other's gaps. `jelly-to-keys.mjs` makes that repeatable without making Jelly a dependency.
