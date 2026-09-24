# Developing skill manuals and discovery

Follow [builder orientation](../BUILDERS.md) and the owning component contracts
when implementing a skill. A skill's manual owns its available operations, settings,
limits and recovery. Extend a related package or create a focused one when an
operation lacks a suitable manual. Geometry skills cover preparation and recovery;
toolpath skills cover deposition.

Skill use and skill implementation are different reads. `read-skill ID --maker`
reads the package's `SKILL.md` (operations, settings, limits and recovery);
`--builder` reads its optional `BUILDER.md` (skill-authoring details); `--developer`
reads its optional `DEVELOPER.md` (additional implementation context). Combine
flags for missing context, for example `--maker --builder`; no flags means maker.
Flags select independent reads, not an inheritance chain. Missing optional files
are reported in `unavailableRoles`, without substituting another role's text.
Keep each fact at one owner; create optional manuals only when they add context.
The CLI returns the source files unchanged, and ordinary file/section reads remain
valid. Reuse previously read context rather than requesting it again.

Shared geometry and composition contracts are builder context when a skill
consumes them. Dev maps cover core and Studio. Changes confined to skill scripts
need skill guidance and consumed API contracts, not an automatic map read.
Read the affected maps and shared-use references when changing core/Studio or
investigating their internals for a skill change.
Map ownership and the value required of comments/docstrings are defined by the
[map contract](../BUILDERS.md#maps-and-local-documentation). Do not copy the map's
implementation account into a second skill narrative. Reuse skill context already
read; the existing `read-guidance PATH#HEADING` command supports section reads.

Geometry skill manuals declare `metadata.saam-kind: geometry` in frontmatter. The explicit
[catalog](catalog.mjs) controls discovery and ordering; each manual owns its
description and classification. The description is one line that helps an agent
choose: one or two sentences on what the skill does, when to choose it and any
boundary that rules it out, starting with "Experimental." for a new printing technique whose physical
behaviour is still unknown. A
[keyword skill](../GLOSSARY.md)'s description is only its keyword. Details that
matter once the skill is chosen belong in the manual. The description is reused
by the [digest](DIGEST.md) and MCP catalog. After changing descriptions or catalog membership, run
`node scripts/skill-digest.mjs` from the repository root to refresh the digest.
Generated agreement does not establish that capability claims are true.

Keep setup, reusable assets and recipe assumptions accessible through the manual.
Reference the shared [standard parameter policy](../MAKERS.md#standard-parameter-policy)
for choosing and reusing settings; manuals own their specific defaults and limits
without restating that interaction policy.
Place recovery references at the operation or failure that needs them. When those
routes change, assess access through both local files and the connector's manual
reader. Select relevant verification under [Avoid check spirals](../BUILDERS.md#avoid-check-spirals).
