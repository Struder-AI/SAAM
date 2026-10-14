# Skill and extension authoring

Builders compose published interfaces into guidance, recipes, assets, workspaces and extensions ([orientation](../BUILDERS.md), [boundaries](../MAKERS.md#working-boundaries)). Core/shared changes need the developer role; maps own implementation.

`SKILL.md` owns maker operations/settings/recovery; optional `BUILDER.md`/`DEVELOPER.md` own author guidance. Keep facts at one owner. [Manual markers](../core/agent/README.md) select machine-specific and on-request sections; unreadable markers remain noted text.
Frontmatter uses `metadata.saam-kind: geometry`, `hybrid` or `guidance`; descriptions guide selection, with “Experimental.” for unvalidated techniques and keywords alone for keyword skills. [catalog.mjs](catalog.mjs) orders built-ins; refresh `node scripts/skill-digest.mjs` after catalog/description/gate changes.
Verified examples are `examples/NAME.json` containing `{machineId,plan}` (create input without bundleId), linked from the manual and read through `read_guidance`; SAAM never runs them.

Extensions live in `<SAAM home>/local/extensions/ID/`: manifest, manual, scripts and assets. The `saam-extension/1` manifest names a lowercase hyphenated id, dependencies, .mjs entries, license and provenance; [machine entries](../machines/README.md#adding-a-machine) have their own contract.
Optional `credits:[{name,role}]` and `support:{status,maintainer,scope}` travel with packages. Status is community/supported/unsupported/unspecified; maintainer is a name or null. Workspace UIs provide `[data-saam-workspace-info]` for host display.
Unreadable copies list reasons; missing dependencies/cycles stop use. Factories compose named public Geometry/Toolpath operations; private core imports are outside this portable interface. Use operation [tolerances](../core/README.md#dimensions-and-tolerances), with [no fixed budget](../core/README.md#limits-that-adapt-and-limits-that-are-kept).

Every editor, deposition factory and workspace uses Geometry’s [canonical operations](../core/geom/operations.mjs): construction, sections, offsets, clipping, mapping, fonts and queries. Use `await Geometry.buildGeometry(...)`; construction returns numerical values without native handles. Editors also receive the same named functions directly; dependency compilers belong to the host.
`matchCurveControls(base,landing,mapping)` preserves shapes while matching control nets. The single `ribbon({curve,vertical,depthMm,geometry?,materialSide?})` accepts curves only and any reference direction; adjacent geometry selects the exterior. Surface operations keep distinct interfaces; Geometry owns algorithms/lifetime.

A generated Trace declares `source:{extension,assignment,parameters}`, `curves:[]`, `repeat:null`. Its manifest `trace-source` factory receives `{Geometry,Toolpath}` and returns a synchronous `constructLayer({source,parameters})` callback yielding ordinary `{curves,report}`.
Source context supplies the prepared main layer’s chart, settings, nominal perimeters and solid/sparse material intent, computed by Slice’s shared layout, plus stack/index identity. Extensions trust these commitments; dependencies use prepared work IDs. Trace retains the reference stack and runs after the host layer before its successor.
Recipe identity/parameters participate in generation dependencies/provenance; static Trace remains readable. A source failure reports a limitation while preserving the source body.

Layer Geometry supplies `section`, `intersectSurfaceSheet`, `offsetSliceRegion`, `strokeSliceRegion`, `clipSliceCurves`, `evaluateSurface`, and ordinary mesh/region operations. Sheets are bounded planar degree-one 2×2 spline surfaces; their frames belong to Geometry.
Intersections/clips return `{curves,report}`, strokes `{loops,report}`, offsets chart loops. Distances are physical millimetres on native/evaluated UV charts; `metric:'projected'` retains explicit mm-chart offset behavior. Unsupported/singular charts report causes. `Toolpath.fillSliceRegion` returns ordinary solid chart-fill curves without creating a stack or material claim.

Workspaces declare `kind:"workspace"`, `workspace:{ui:"ui"}` and a `workspace-runtime` factory receiving the same Geometry operations, Toolpath’s `recipeDefaults`/`curveAssignment`, and `Extensions.text.compileText` (`{geometry,notes}`) with a text dependency.
The factory returns `defaults`, `normalize`, `preview`, `pieces`, `construct`, optional `resources`; `construct(design,pieceId)` returns `{plan,source,requirements,report}`. Preview is explicit.
The [host](../workspaces/server.mjs) saves designs/self-contained Bundles; source/requirements are historical provenance. Sessions edit/generate/share using current recipe dependencies. Extensions own construction/UI; Bundle owns saved parts.

`saam call extension_library` manages the library (`list_skills` lists it): checkout copies a release default into an override surviving updates; export packages manifests/manuals/scripts/assets/hashes; import validates without execution or replacement of changed copies.
Share explicitly; release promotion needs review. Document resource identity/provenance/license; callers save assets. No technical sandbox or automatic I/O permission is provided. Follow [parameter policy](../MAKERS.md#standard-parameter-policy) and [verification guidance](../DEVELOPER-CONTEXT.md#avoid-check-spirals).
