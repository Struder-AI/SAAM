# Skill and extension authoring

Builders compose published interfaces into guidance, recipes, assets or
workspaces. Core/shared changes require the developer
role. Read [builder orientation](../BUILDERS.md) and the consumed contracts.

`SKILL.md` owns maker operations, settings, limits and recovery; optional
`BUILDER.md`/`DEVELOPER.md` own author guidance. Mark machine-specific sections
`<!-- requires: capability -->` and on-request sections `<!-- layer: advanced -->`;
the [manual reader](../core/agent/README.md) opens them by machine or by name. Maps own implementation; keep each fact at one owner.

Manual frontmatter uses `metadata.saam-kind: geometry`, `hybrid` or `guidance`.
Descriptions guide selection; prefix unvalidated techniques with “Experimental.”
Keyword descriptions contain only that keyword. [catalog.mjs](catalog.mjs) orders built-ins;
refresh with `node scripts/skill-digest.mjs` after description/catalog/gate edits.

An extension contains `extension.json`, `SKILL.md`, scripts and assets. Its
manifest declares `schema: "saam-extension/1"`, a lowercase hyphenated `id`,
`dependencies`, `entries`, `license` and `provenance`. Missing dependencies and
cycles stop execution. Entries name `.mjs` functions for geometry, deposition,
record or resource operations. Runtime factories receive named public Geometry
and Toolpath operations; private core imports are not a portable interface.

Workspace extensions declare `kind: "workspace"`, `workspace: {"ui":"ui"}` and a
`workspace-runtime` factory receiving `Geometry.loftPolygons`,
`Geometry.clipLineToRegion`, `Toolpath.recipeDefaults` and `Toolpath.curveAssignment`.
It returns `defaults`, `normalize`, `preview`, `pieces`, `construct` and optional `resources`.
`construct(design, pieceId)` returns `{plan, source, requirements, report}`; preview is explicit.
The [host](../workspaces/server.mjs) saves designs and self-contained Bundles with historical
source/requirements provenance. Ordinary sessions edit, generate and share parts using
current recipe dependencies. Extensions own construction/UI, not Bundle authority.

`node scripts/extensions.mjs list|resolve ID...|checkout ID|export ID FILE|import FILE`
manages the shared library. `checkout` creates an editable user copy, under
`SAAM_DATA/extensions` when set; it overrides release defaults and survives updates.
`export` packages manifest, manuals, scripts, assets and hashes; import validates
without executing code or replacing changed copies. Share explicitly; release
promotion needs review. MCP discovery also reads installed manifests.

Document resource identity, provenance and license; callers save assets. Extensions have no technical sandbox or automatic I/O permission.
Follow [parameter policy](../MAKERS.md#standard-parameter-policy) and [verification guidance](../BUILDERS.md#avoid-check-spirals).
