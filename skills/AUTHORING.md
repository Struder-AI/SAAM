# Skill and extension authoring

Builders compose published interfaces into guidance, recipes, assets, workspaces and
extensions, which do what SAAM's operations do not ([working boundaries](../MAKERS.md#working-boundaries)).
Core/shared changes require the developer role. Read [builder orientation](../BUILDERS.md) and the consumed contracts.

`SKILL.md` owns maker operations, settings, limits and recovery; optional
`BUILDER.md`/`DEVELOPER.md` own author guidance. Mark machine-specific sections
`<!-- requires: capability -->` and on-request sections `<!-- layer: advanced -->`;
the [manual reader](../core/agent/README.md) opens them by machine or by name. Maps own implementation; keep each fact at one owner.
Example recipes are `examples/NAME.json` files holding `{machineId, plan}` (a
`create_bundle` input less `bundleId`), written from a verified bundle's recipe,
linked from `SKILL.md` and read with `read_guidance`. SAAM never runs them.

Manual frontmatter uses `metadata.saam-kind: geometry`, `hybrid` or `guidance`.
Descriptions guide selection; prefix unvalidated techniques with “Experimental.”
Keyword descriptions contain only that keyword. [catalog.mjs](catalog.mjs) orders built-ins;
refresh with `node scripts/skill-digest.mjs` after description/catalog/gate edits.

An extension is a folder `<SAAM home>/local/extensions/ID/` holding `extension.json`,
`SKILL.md`, scripts and assets. Its manifest declares `schema: "saam-extension/1"`,
a lowercase hyphenated `id`, `dependencies`, `entries`, `license` and `provenance`.
Missing dependencies and cycles stop execution. Entries name `.mjs` functions for
geometry, deposition, record or resource operations; machine extensions follow [adding a machine](../machines/README.md#adding-a-machine). Runtime factories receive named
public Geometry and Toolpath operations; private core imports are not a portable
interface. Extension code uses its operations' tolerances or a [tolerance class](../core/README.md#dimensions-and-tolerances)
and adds no fixed budget ([limits](../core/README.md#limits-that-adapt-and-limits-that-are-kept)).

Workspace extensions declare `kind: "workspace"`, `workspace: {"ui":"ui"}` and a
`workspace-runtime` factory receiving `Geometry.loftPolygons`,
`Geometry.clipLineToRegion`, `Toolpath.recipeDefaults` and `Toolpath.curveAssignment`.
It returns `defaults`, `normalize`, `preview`, `pieces`, `construct` and optional `resources`.
`construct(design, pieceId)` returns `{plan, source, requirements, report}`; preview is explicit.
The [host](../workspaces/server.mjs) saves designs and self-contained Bundles with historical
source/requirements provenance. Ordinary sessions edit, generate and share parts using
current recipe dependencies. Extensions own construction/UI, not Bundle authority.

`saam call extension_library` manages the library (`list_skills` lists it): `checkout`
copies a release default into the local folder as an editable override that survives
updates; `export` packages manifest, manuals, scripts, assets and hashes; `import`
validates without executing code or replacing changed copies. Share explicitly; release
promotion needs review. Document resource identity, provenance and license; callers save
assets. Extensions have no technical sandbox or automatic I/O permission. Follow [parameter policy](../MAKERS.md#standard-parameter-policy) and [verification guidance](../BUILDERS.md#avoid-check-spirals).
