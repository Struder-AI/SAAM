# Thingi10K: development

The [library](scripts/library.mjs) pins one Hugging Face repository revision for
metadata and meshes, reads the three CSV indexes per request, downloads only the
selected file and stores nothing. It follows HTTPS redirects only within the
mirror's hosting domains, limits metadata files to 4 MiB and meshes to 64 MiB,
and times out each request chain after 60 s. Updating the snapshot means checking
the metadata schema and changing `REVISION` there. Downloads return bytes and
attribution; Application imports them in a job folder and keeps a failed
original as diagnostics evidence.

The [tests](tests/library.test.mjs) cover search and link lookup, download
boundaries, failure evidence and the Application import route with synthetic
meshes. Live mirror checks are development evidence, not test-suite network
dependencies.
