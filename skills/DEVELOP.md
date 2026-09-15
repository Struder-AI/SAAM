# Developing skill manuals and discovery

Follow [developer orientation](../DEVELOP.md) and the owning component contracts
when implementing a skill. The task manual owns its available operations, settings,
limits and recovery. Extend a related package or create a focused one when an
operation lacks a suitable manual. Task skills can cover preparation and recovery
as well as deposition patterns.

Task manuals declare `metadata.saam-kind: task` in frontmatter. The explicit
[catalog](catalog.mjs) controls discovery and ordering; each manual owns its
description and classification. Its description explains the capability, value
and essential selection boundaries, and is reused by the [digest](README.md) and
MCP catalog. After changing descriptions or catalog membership, run
`node scripts/skill-digest.mjs` from the repository root to refresh the digest.
Generated agreement does not establish that capability claims are true.

Keep setup, reusable assets and recipe assumptions accessible through the manual.
Reference the shared [standard parameter policy](../MAKERS.md#standard-parameter-policy)
for choosing and reusing settings; manuals own their specific defaults and limits
without restating that interaction policy.
Place recovery references at the operation or failure that needs them. When those
routes change, assess access through both local files and the connector's manual
reader. Select relevant verification under [Avoid check spirals](../DEVELOP.md#avoid-check-spirals).
