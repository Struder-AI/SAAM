# Unmodelled code: decisions for the owner

[Dev maps intent](../../plans/dev-maps.md#banned-code): code the analysis does not model is banned, and each shape is a model-or-ban decision. This lists every shape the influence analysis reports in the whole scope (`node dev-map/influence/run.mjs --depth 2 all`, 2026-10-03), with its sites, what the code does, the cost each way and a recommendation. Platform APIs have their models in [platform-models.mjs](platform-models.mjs); `--platform FILE` writes the per-site inventory.

## Summary

| Shape | Sites | Recommendation |
|---|---|---|
| Getters and setters (accessors) | 24 | Ban; rewrite as methods |
| Generators and `yield` | 8 functions, 14 yields | Model |
| `Object.defineProperty(ies)` | 9 | Model data descriptors (done); ban accessor descriptors (1 site) |
| `Proxy` and `Reflect` | 2 | Ban; rewrite as an explicit indexed reader |
| Non-literal dynamic `import()` | 2 | Model as the declared extension boundary |
| Callee expressions (`(await f())()`, `(a??b)()`, `(c?f:g)()`, `f()()`) and computed callees | 20 | Already modelled; drop the notes |
| JSON module import | 1 | Modelled (done) |
| In-scope code importing `examples/` | 10 | Scope decision |
| `arguments`, `with`, `eval`, `Function` | 0 | Ban (no sites) |
| Platform APIs without a model | 58 APIs, 141 sites | Imprecision, not code to rewrite (below) |

## Shapes

**Accessors (24 sites, 13 objects).** `get` (and no `set`) on object literals and classes: queue sizes and lengths (`studio/studio-events.mjs:36`, `core/export/bambu-player.mjs:40`, `core/export/dobot-lua-subset.mjs:51`, `core/print/program-handoff.mjs:49`, `studio/move-store.mjs:20`), derived reports (`core/geom/sleeve/mesh-sleeve.mjs:100-102,137-139`, `core/print/slices.mjs:547`), cancellation and status reads (`core/print/generation-control.mjs:7-8` over `Atomics.load`, `studio/machine-session.mjs:66,85`, `studio/view-performance.mjs:28`, `studio/prepared-generation-job.mjs:33-34`). The analysis records the getter function as the field value, so a read never reaches the getter: the trace check finds 5 calls the map lacks this way. *Model*: a load that meets a getter becomes a query call with the object as `this` (moderate: every field load must check for accessors). *Ban*: each becomes a method (`size()`, `cancelled()`), about 13 small edits plus their readers. Recommendation: ban; a read stays a read and the rewrite is small.

**Generators (8 functions, 14 yields).** Streaming chunk producers: `core/export/gcode-lines.mjs:8`, `core/geom/mesh-repair.mjs:126`, `core/print/repair-stl.mjs:69` (async), `core/geom/mesh-native.mjs:20` (async), `core/path/action-context.mjs:13`, `core/region/region2d.mjs:215`, `skills/advanced-vase-wall/scripts/runtime.mjs:12`, `studio/move-store.mjs:65` (`[Symbol.iterator]`). *Model*: calling a generator returns a fresh iterator whose elements are what it yields (`yield*` adds the delegate's elements); its body runs as part of the call (sound for influence; small, about 20 lines in either engine). *Ban*: return arrays, which loses streaming for large STL and G-code output. Recommendation: model.

**`Object.defineProperty` / `defineProperties` (9 sites).** Hidden or fixed fields: `core/print/workflow.mjs:338,354,361,390,416` (non-enumerable artifacts on state), `core/geom/mesh.mjs:35,37,119` (mesh fields and a copied descriptor set). One accessor: `studio/server.mjs:721` defines a `studioEvents` getter on the server. Data descriptors are now modelled as a store of `descriptor.value` (platform-models.mjs). Recommendation: allow data descriptors; ban accessor descriptors (rewrite `server.mjs:721` as a method), consistent with accessors above. The constraint walker still notes every call; drop the note for data descriptors once decided.

**`Proxy` and `Reflect` (2 sites).** `studio/move-store.mjs:74` and `studio/source-player.mjs:11-12` make compact move storage look like an array (`moves[i]`, `push`). Modelling a `get` trap means every field load on the proxy is a call into SAAM code, with the key as a value: expensive and it defeats field sensitivity. *Ban*: expose `at(i)` and `push` explicitly; callers that index use `at`. Recommendation: ban.

**Non-literal dynamic `import()` (2 sites).** `core/local-extension.mjs:11` and `core/extensions/library.mjs:136` load extension entry points by path. The intent's scope says extensions installed outside the repository meet SAAM only at the extension interface. Recommendation: model these two sites as that declared boundary: the imported namespace is an extension value whose callables follow an authored contract (what they may read and return), checked at the boundary. In-repository extensions under `skills/` then need a path from these loaders to their modules, or are analysed as their own entry points.

**Callee expressions (20 sites).** `(await loadExtensionEntry(...))(...)` (`skills/records.mjs:76-96`, `skills/deposition.mjs:8-13,51`), `(a??b)(...)` (`core/geom/mesh-native.mjs:40`, `core/path/modulation-field.mjs:79`), `(c?f:g)(...)` (`skills/gridfinity/scripts/cli.mjs:17`), `f(x)(y)` (`core/agent/toolkit.mjs:51,110` through `promisify`, `core/geom/curve-offset.mjs:247`) and computed callees `fields[i](depth)` (`core/geom/curve-offset.mjs:259-260`, `studio/machine-view.mjs:23`). The walker already evaluates the callee expression and dispatches on whatever it may hold; the notes are cautionary only. Recommendation: modelled; remove these notes. (`promisify` results are unknown functions: see platform below.)

**JSON module import.** `core/export/bambu-project.mjs:2` imports `bambu-project-fields.json`; it is now a value of the plain-data family.

**Imports of `examples/` from in-scope code (10 sites).** `core/print/cli.mjs:12`, `studio/tour.mjs:8,43` (the tour runs example recipes in use), `skills/text/scripts/draped-demo.mjs:5`. The scope excludes `examples/`, so these calls reach nothing. Decision for the owner: bring the tour's examples into scope (they run when Studio is used), or make the tour load them through a declared boundary.

## Platform APIs

Every platform call now goes through a model lookup (`lookupPlatform`): 761 API models plus 10 families (dom 96 members, webgl 97, zod 83, manifold 36, rhino 26, clipper 17, filehandle 10, fflate 10, fontkit 6, json by method name). Of 13,213 call sites reaching platform code, 12,464 resolve to a runtime value with a model, 1,668 to a family member, 64 by method name or path; 141 sites (58 API names) have no model and fall back to the old generic treatment, recorded as `platform:` notes. None of the 58 is code to rewrite: each is the analysis calling a method on a value it lost track of:

- Unknown values called with SAAM or array method names (`?.addEventListener`, `?.optional`, `?.snapshot`, `?.offsetLines`, `?.plan`): values that arrive through unmodelled flows (event-loop entry, untyped promise results, `promisify`).
- Family values flowing into plain data through imprecise points-to (`dom.every` in `core/machine/`, `json.optional` in `core/application/deposition-schemas.mjs`, `Array.*`/`Function.*` in `core/export/dobot-lua-subset.mjs`, a Lua interpreter with dynamic dispatch).
- `new Proxy`, `Reflect.get`: the Proxy shape above.

Two model gaps remain by design and are recorded: prototype getters the analysis process cannot run (28 paths such as `Map.prototype.size`, `URL.prototype.pathname`) are assumed to return primitives unless `PROPERTIES` declares a type (`run.mjs` lists them as `platformGettersAssumedPrimitive`); buffer sharing between typed-array views (`new Uint8Array(buffer)`, `SharedArrayBuffer` with `Atomics` across workers) is not modelled beyond `subarray` aliasing.

Channels to other processes (Worker `postMessage` and message listeners, HTTP server and `fetch`, files) are modelled only as world effects and reads (`effect`/`reads`); linking a sender to its receiver across a channel is a separate item of milestone 2.
