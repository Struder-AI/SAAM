# Developing skill manuals and discovery

Follow [builder orientation](../BUILDERS.md) and the owning component contracts
when implementing a skill. The task manual owns its available operations, settings,
limits and recovery. Extend a related package or create a focused one when an
operation lacks a suitable manual. Task skills can cover preparation and recovery
as well as deposition patterns.

Skill use and skill implementation are different reads. `SKILL.md` owns maker
operations, settings, limits and recovery; package `DEVELOP.md` references own
skill-authoring details. Shared geometry and composition contracts are builder
context when the skill consumes them. Builders and developers changing a skill
read its relevant region maps and the shared-use references before source edits.
Map ownership and the value required of comments/docstrings are defined by the
[map contract](../BUILDERS.md#maps-and-local-documentation). Do not copy the map's
implementation account into a second skill narrative. Reuse skill context already
read; the existing `read-guidance PATH#HEADING` command supports section reads.

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
reader. Select relevant verification under [Avoid check spirals](../BUILDERS.md#avoid-check-spirals).
