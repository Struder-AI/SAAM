# SAAM agent entry point

SAAM lets you describe a part to an AI agent, inspect the toolpath it proposes,
approve it, and get a file your machine can run. The aim is to lower the barrier
to 3D printing, including for people without CAD, slicing, or programming experience.

## Choose your context

| Your task | Read next |
|---|---|
| Developer agent (default): build, fix, or document SAAM | Read both [DEVELOP.md](DEVELOP.md) and [MAKERS.md](MAKERS.md) |
| Maker agent: help a person make a part | Read [MAKERS.md](MAKERS.md) **before responding to the maker** |
| Developer agent exercising maker skills/tools | Read both files and apply DEVELOP.md's development testing boundary |

These are task roles, not different models or permanent agent identities.
When the role is not specified, default to developer for now. Every developer
agent reads both DEVELOP.md and MAKERS.md. A role does not expand the user's
authorized task scope. Load a skill's instruction manual when that skill is relevant.
Use [GLOSSARY.md](GLOSSARY.md) for shared terms; proposed terms are marked there.

README.md owns the project introduction and direction for people and agents;
PROJECT_CHARTER.md is a compatibility pointer. Skill authors must read DEVELOP.md's
geometry, machine interoperability and whole-plan travel requirements.
Use the [shared geometry operations](DEVELOP.md#shared-offset-functions) for
offsets; skill authors must follow the [numerical reuse guidance](DEVELOP.md#shared-numerical-foundations).
Closed planar booleans use the [shared Clipper2 tool](DEVELOP.md#shared-planar-intersections).
Scope shared components to current needs and extend them when needed; see
[developer guidance](DEVELOP.md#interoperability-and-one-workflow).

## Shared context

- Describe capabilities and limitations as implemented. A proposal, preview,
  or passing software test does not establish a successful physical print.
- Adapt guidance to the person's knowledge. Clarify choices that affect their
  result; do not require them to learn the implementation to use the product.
- Do not invent human approval, measurements, or contributor agreement.
  Project decisions and approval of a manufacturing job are separate records.
- The maker workflow has three human approvals: geometry, locked process plan,
  then toolpath. Generate directly from the approved locked plan without a
  separate planning stage or new process choices. Generate the export in an
  output option declared by the machine file. Intermediate motion is transient;
  bundles do not require a saved SAAMpath or regenerate when reopened.
  Automated checks precede SAAM Studio's program viewer, which runs the same
  export that will be delivered. Delivery does not require a fourth approval.
- [DECISIONS.md](DECISIONS.md) records project decisions and their approval status.
  Approval from both `tkeller` and `remettub` makes a decision accepted; one makes
  it provisional. Do not treat an agent recommendation as either person's approval.

## Restart state

The restart includes an eight-point wedge development demo with native mesh geometry,
SAAMpath, Griffin export, software checks, and a local Studio review workflow.
Read [the wedge skill](skills/wedge-demo/SKILL.md) when working on that demo.
No physical print has been validated. The local architecture map is a development
aid. The user authorized selective restoration of MCP, Dobot machine/Lua support
and vase-wall on 2026-09-09; see the current skill manuals and DEVELOP.md for
implemented scope. Automatic capability discovery is deferred by D-022.
The old source is preserved in Git history and a separate local archive,
outside the active tree. New wedges use native indexed meshes; full Rhino computation and
general surface slicing remain deferred.

The [full-fill](skills/full-fill/SKILL.md), [planar-infill](skills/planar-infill/SKILL.md),
[draped-skin](skills/draped-skin/SKILL.md) and [vase-wall](skills/vase-wall/SKILL.md) manuals own their current shape and
process limits. They share operation composition, export, Studio review and
bundle delivery. They accept validated STL/mesh input and supported spline shells
through shared queries. Vase-wall is limited to one convex outer section with
no holes or islands. [Material regions](DEVELOP.md#material-regions-and-shared-interfaces)
compose skills on one part, including a level-ended vase, cap, infill/draped roof,
and horizontal fill above a consumed nonflat surface. Interoperability across
skills, geometry, machines and public workflow is a core requirement; assess
existing boundaries when changing a component and report concrete remaining limits.
S5, H2D and configured Dobot have software checks through the
shared lifecycle; H2D output is experimental with a fixed firmware-service contract.
See [H2D output scope](DEVELOP.md#h2d-output-contract). Arbitrary trimmed CAD import remains unimplemented.
The [Dobot output](DEVELOP.md#dobot-output-contract) requires installation setup
and interprets the delivered Lua source ZIP; robot reachability, continuous
relay deposition and vendor project-import acceptance are not established.
The [local MCP adapter](adapters/mcp/README.md) exposes this same workflow to a
compatible local chat client, with fixed known profiles/manuals and no approval
tool. Its [temporary web-chat connection](adapters/mcp/README.md#temporary-web-chat-connection)
adds an OAuth-protected HTTP bridge and outbound HTTPS tunnel for compatible
web clients; Studio and generation stay local. Actual vendor-account acceptance
requires a separate connection check; arbitrary browser-chat access is not implied.
See [the developer guide](DEVELOP.md#skill-result-composition) for weaving and
[machine observations](DEVELOP.md#machine-program-templates-and-s5-observations)
for the user's scoped S5 startup report; complete physical validation remains open.

The current entry documents are this file, `CLAUDE.md`, `README.md`,
`PROJECT_CHARTER.md`, `DECISIONS.md`, `GLOSSARY.md`, `build_request.md`,
`DEVELOP.md`, and `MAKERS.md`. Skills package their own manuals and tools.
Developer rules, setup, organization and open design proposals live together
in [DEVELOP.md](DEVELOP.md). There is no separate docs folder.
Do not load the old architecture or operation instructions as always-on context.

The historical StruderBot skill manuals were explicitly authorized for import
on 2026-09-10 and are preserved under `skills/dobot-*` and
`skills/multiaxis-*`. They are discoverable migration sources, not registered
SAAM operations. Read `skills/STRUDERBOT_SKILL_MIGRATION.md` and the relevant
manual before porting one. Preserve its evidence labels, but use the current
shared geometry, composition, machine export, Studio review and approval
pipeline; do not revive the older parallel preview-to-Lua workflow.

For the bounded wedge, retain `skills/wedge-demo/` and its eight-point
mesh geometry/generator: axis-aligned rectangular base, vertical corner pairs,
and a planar roof sloping in any direction. Use the shared export and bundle lifecycle; do not substitute
the shell slicer for its bounded geometry.

Prefer shared interfaces and one pipeline. Skills should aspire to work across
machines and other elements should generalize where practical, with documented
exceptions. Normally ask before introducing a genuinely necessary parallel
pipeline. Studio is the toolpath preview; intermediate developer tests are
scratch using the same components. See [the principles](DEVELOP.md#interoperability-and-one-workflow).
