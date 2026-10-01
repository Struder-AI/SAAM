# Skill and extension authoring

Core skills expose developer-owned capabilities. Builders write guidance,
recipe helpers, assets and examples against published interfaces; web agents
remain makers. Geometry skills change geometry, toolpath skills deposit, and
hybrid skills do both. A core change needs the developer role wherever its file
lives. Read [builder orientation](../BUILDERS.md) and the consumed contracts.

`SKILL.md` owns maker operations, settings, limits and recovery. Put builder
guidance in `BUILDER.md` and core implementation notes in `DEVELOPER.md` only
when needed. Mark command sections `<!-- layer: script -->` and machine sections
`<!-- requires: capability -->`; unmarked text must work for web agents.
See [context layers](../core/agent/README.md#context-layers). Keep each fact at
one owner; maps own the account of core and Studio implementation.

Manual frontmatter uses `metadata.saam-kind: geometry`, `hybrid` or `guidance`
where appropriate. Its one-line description helps the agent choose the skill;
start unvalidated techniques with “Experimental.” Keyword descriptions are
only the keyword. The release [catalog](catalog.mjs) orders built-in discovery;
`node scripts/skill-digest.mjs` refreshes its digest after description, catalog
or gate changes. The MCP list also reads installed extension manifests.

An extension folder contains `extension.json` and `SKILL.md`, plus any scripts,
assets and optional author manuals it uses. The manifest declares
`schema: "saam-extension/1"`, a lowercase hyphenated `id`, `dependencies`,
`entries`, `license` and `provenance`. Each dependency names an `id`; missing
copies and cycles stop execution. Entries map names such as `geometry-edit`,
`geometry-create`, `deposition-edit`, `deposition-runtime` or `resource-client`
to an `.mjs` function. A runtime factory receives named public Geometry and
Toolpath operations and returns the technique's composition functions. Import
validates and saves files without running scripts.

`node scripts/extensions.mjs list|resolve ID...|checkout ID|export ID FILE|import FILE`
manages extensions. `checkout` copies a release extension into the user data
folder (`SAAM_DATA/extensions` when set); builders edit that copy. User copies
win over release defaults and are retained when SAAM updates. `export` writes
a portable JSON package containing the manifest, guidance, scripts, assets and
per-file hashes. `import` refuses to replace a changed local copy. Share the
package explicitly; promotion into a release requires review.

Keep external resource use in the manual and return assets with available
identity, provenance and license metadata. The caller saves imported assets in
the bundle. Extensions are ordinary local code and carry no technical sandbox
or automatic I/O permission. Use [standard parameter policy](../MAKERS.md#standard-parameter-policy)
for settings, and [verification guidance](../BUILDERS.md#avoid-check-spirals)
for changes.
