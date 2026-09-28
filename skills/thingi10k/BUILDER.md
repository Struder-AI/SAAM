# Thingi10K: development

The [library](scripts/library.mjs) pins one Hugging Face repository revision for
metadata and meshes, caches the three CSV indexes and downloads only the selected
file. It follows HTTPS redirects only within the mirror's hosting domains, limits
metadata files to 4 MiB and meshes to 64 MiB, and times out each request chain
after 60 s. Updating the snapshot means checking the metadata schema and changing
`REVISION` there. The [import entry](scripts/import.mjs) delegates to the shared
STL importer and keeps attribution in `plan.geometry.source.attribution` beside
the source hash; unit corrections preserve it.

The [tests](tests/library.test.mjs) cover search and link lookup, download
boundaries, source preservation and the MCP import and review route with
synthetic meshes. Live mirror checks are development evidence, not test-suite
network dependencies.
