# Developing skill manuals and discovery

Core skills expose shared capabilities and are authored or changed by developers.
Builders author guidance, recipe helpers, assets, examples and diagnostics using
published interfaces; follow [builder orientation](../BUILDERS.md). Web agents
are makers only. A core change requires the developer role, regardless of which
directory contains it. Geometry skills change geometry, toolpath skills deposit,
and hybrid skills do both. Guidance teaches compositions of those operations.

Skill use and skill implementation are different reads. `SKILL.md` holds
operations, settings, limits and recovery for makers. Guidance authoring and
helper examples go in `BUILDER.md`; core implementation belongs in `DEVELOPER.md`.
Builder-only utilities such as mesh repair have no maker manual. In `SKILL.md`, tag
command-line sections `<!-- layer: script -->` and machine-dependent ones with
`<!-- requires: capability -->` ([context layers](../core/agent/README.md#context-layers));
untagged text is what every agent reads, so keep it to what a web agent can act
on. Keep each fact at one owner; create optional manuals only when they add context.

Shared geometry and composition contracts are builder context when consumed,
not permission to change those contracts. Dev maps cover core and Studio.
Guidance/helper changes need the consumed API contracts.
Read the affected maps and shared-use references when changing core/Studio or
investigating their internals for a skill change.
Map ownership and the value required of comments/docstrings are defined by the
[map contract](../BUILDERS.md#maps-and-local-documentation). Do not copy the map's
implementation account into a second skill narrative. Reuse skill context already
read; the existing `read-guidance PATH#HEADING` command supports section reads.

Geometry, hybrid and guidance manuals declare `metadata.saam-kind: geometry`, `hybrid` or `guidance`. Guidance teaches how to compose existing operations; it adds no tool or deposition family. The explicit
[catalog](catalog.mjs) controls discovery and ordering; each manual owns its
description and classification. The description is one line that helps an agent
choose: one or two sentences on what the skill does, when to choose it and any
boundary that rules it out, starting with "Experimental." for a new printing technique whose physical
behaviour is still unknown. A
[keyword skill](../GLOSSARY.md)'s description is only its keyword. Details that
matter once the skill is chosen belong in the manual. The description is reused
by the [digest](DIGEST.md) and MCP catalog. After changing descriptions, catalog membership or advanced markers, run
`node scripts/skill-digest.mjs` from the repository root to refresh the digest.
Generated agreement does not establish that capability claims are true.

Keep setup, reusable assets and recipe assumptions accessible through the manual.
Reference the shared [standard parameter policy](../MAKERS.md#standard-parameter-policy)
for choosing and reusing settings; manuals own their specific defaults and limits
without restating that interaction policy.
Place recovery references at the operation or failure that needs them. When those
routes change, assess access through both local files and the connector's manual
reader. Select relevant verification under [Avoid check spirals](../BUILDERS.md#avoid-check-spirals).
