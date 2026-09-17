# SAAM agent entry point

## Tour requests — launch first

For a tour request, the first tool action in a set-up checkout is this command
from the repository root, through the client's managed command session:

```sh
node studio/server.mjs --toolkit start-tour --no-open
```

Use an early yield (about one second when supported). Open `studio.url` from
the `studio-ready` event immediately with the client's browser integration and
keep the server session. Then consume the returned participation context and
keep the returned request listener active. The command creates fresh examples,
starts lesson one and supplies the instructions needed to continue.

Do not read MAKERS, the toolkit manual, skill manuals, or run onboarding before
this launch. Do not add a chat introduction or question; Studio supplies the
first task. Reuse known setup and permissions; a new chat is not an unused
checkout. Follow SETUP only for a known unused checkout or a concrete setup
problem, and follow any required client instructions for browser access.

SAAM helps people make parts through conversation with an AI agent, without
requiring CAD, slicing or programming expertise. The agent handles the tools
and printing settings; the person guides the result and reviews geometry,
the process plan and toolpath in SAAM Studio before receiving a machine program.

The project develops composable printing skills and shared interfaces for
geometry, motion and machine output. Its direction is to combine patterns across
geometry types and machines through one generation, review and delivery workflow.
[README.md](README.md) introduces that direction; the references below describe
implemented scope.

## Choose your role

SAAM work is done by three kinds of agent. Each has its own onboarding and its
own reading. Determine your role from the initial request; when the request does
not clearly call for more, **default to maker**.

| Role | Does | Onboarding | Reads |
|---|---|---|---|
| **Maker** | Uses skills to make parts, gives printing advice, operates Studio for a person. Changes no shared code. | `node scripts/agent-toolkit.mjs maker-onboarding` | [MAKERS.md](MAKERS.md) and the maker context it bundles. No maps. |
| **Builder** | Changes skills, adds functionality to Studio, and makes isolated, local changes to core; makes parts to test that work in development. | `node scripts/agent-toolkit.mjs builder-onboarding [--area AREA]` | [BUILDERS.md](BUILDERS.md) (with maker workflow in onboarding) and the [dev maps](#maps) for the region being touched. |
| **Developer** | Works on core and any other component as the work needs; owns cross-cutting design. Maps-native. | `node scripts/agent-toolkit.mjs developer-onboarding [--area AREA]` | The [dev maps](#maps) as the primary account, plus the [developer bin orientation](DEVELOPER-CONTEXT.md#orientation) for scoped implementation reads. |

Builders inherit maker responsibilities; developers inherit both maker and
builder responsibilities. This is not a requirement to load every lower-role
manual. Onboarding supplies the role's starting context; read additional workflow,
skill and implementation context only when the task needs it. Reuse material
already consumed, including when changing roles. Run onboarding once for missing
role context; its returned text satisfies those reads.

### Determining and changing role

- **Decide from the initial prompt.** Making a part, printing advice, running a
  tour or operating Studio is maker work. If the role is unclear, act as maker.
- **Escalate maker → builder when the work is a build.** If the request asks to
  change a skill, extend Studio, or make an isolated local change to core (rather
  than only use what exists), say so plainly to the user, run builder-onboarding,
  and continue as a builder. A maker never edits shared code without escalating
  first.
- **Escalate to developer only on an explicit request, or by proposal.** Do not
  self-promote to developer. Act as developer from the first prompt when the user
  explicitly asks for core or cross-cutting development. When a requested task is
  clearly major core work but the user has not named the role, propose developer,
  say why, and wait for confirmation before running developer-onboarding.
- Escalation carries the same authorization as the original request and no more.
  Announce it; do not perform it silently.

### Suggesting a fresh session

Maker and builder agents should suggest the user start a new chat session when
**both** hold: the current session has exceeded roughly 250k tokens, **and** the
new request is an unrelated task or a substantial pivot from the current one.
Make it a suggestion, not a refusal, and only when both conditions are met.
Developer agents are exempt; they are expected to run longer sessions under
experienced management.

## Maps

Dev maps are the primary structural account of the system. One region file
supplies the agent-readable map and its human rendering; each box resolves to a
child map or a code declaration. The [map contract](BUILDERS.md#maps-and-local-documentation)
owns boundaries, shared components, calculated red links and documentation rules.
The [maker](maker-context-map.html) and [builder](builder-context-map.html) context
maps show documentation navigation; they are distinct from code-anchored maps.
[DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md) holds the material for maps to absorb.

Developers read the system overview, the affected region and the code it names.
Dev maps cover core and Studio. Builders read the relevant regions when changing
those components or investigating their internals, including shared components
and their other uses. Skill-script changes require the skill guidance and consumed
API contracts, not an automatic map read. Makers operating existing tools need no code maps. Reading a
map or shared contract does not itself change an agent's role or authorization.

## Getting to work

Choose the context for the requested work rather than reading everything.

| Task | Start here |
|---|---|
| Start a guided tour | Execute the tour launch command above first, open its Studio URL, then use its returned context and listener. |
| Start a new custom part (maker) | Run `node scripts/agent-toolkit.mjs maker-onboarding` if maker context is missing. It supplies MAKERS, the complete skill digest and shared print tools. Then choose and read relevant skill manuals before preparing the preview. |
| Edit an existing Studio print | First run `node scripts/agent-toolkit.mjs begin-studio-work Prints/PART --instruction "Requested change"` (omit the directory for the active tour). For Studio-originated work use `--request ID`. Then load only missing context and apply the edit. |
| Change a skill, extend Studio, or make an isolated core change (builder) | Run `node scripts/agent-toolkit.mjs builder-onboarding` (add `--area AREA` for a known component) if builder context is missing. Read the dev map for the region before editing. |
| Develop core or work across components (developer) | Run `node scripts/agent-toolkit.mjs developer-onboarding [--area AREA]`. Work from the region maps; consult [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md) for text not yet mapped. |
| Set up an unused checkout | Follow [setup and checks](SETUP.md), including [Studio client permissions](studio/README.md#studio-agent-permissions), before using it. |

Develop on a contributor branch. If the checkout is on main, create a branch
before editing; publish through a pull request unless direct main work is
explicitly authorized. Keep at most one active pending branch per account and
reuse it across tasks rather than creating task-specific branches.
The [agent CLI toolkit](core/agent/README.md) bundles the owning context reads,
tour startup, preview creation/opening and request coordination. Text returned
by these commands satisfies the corresponding manual reads. Do not read a manual
before onboarding and then load it again, rerun onboarding for every request, or
follow a link to a document/section already present in context. Read missing
context when the task needs it, and refresh affected guidance only when its
source changed or the prior context is unavailable. In clients without command
access, read the same owning manuals through their available file/MCP reader
once; the CLI is a convenience, not an additional context gate.
These are task contexts, and they do not expand the user's authorization.
If `.local/AGENTS.md` exists, consult it when the user refers to a local experiment.
Local capabilities are not part of shared SAAM and must not be assumed elsewhere.

## Current context boundary

This checkout's current instructions and implemented shared contracts govern SAAM
work. When arriving from an older repository or conversation, reorient here before
editing; do not carry its component architecture, methods or workflow rules forward
as current requirements. Prior material is reference for explicit selective adoption
under [the contribution boundary](BUILDERS.md#context-and-selective-adoption).
The [withdrawal and deferred intents](DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission)
identify the September 12 work that must not be restored wholesale.

## First invocation

On first use of a checkout, follow [setup and checks](SETUP.md).
Reuse completed setup across tasks; a new agent or print does not require another
setup or regression run. Setup creates no manufacturing approval.

Development checks follow [change-based selection](BUILDERS.md#avoid-check-spirals).
Commits and task completion add no test gate; skill manuals do not add a second
verification pass. Run a check to resolve a concrete uncertainty, then reuse its
result until relevant inputs change.

## Find the owning source

- [MAKERS.md](MAKERS.md) owns guidance for helping a person make a part (maker context).
- [BUILDERS.md](BUILDERS.md) owns builder orientation — changing skills, extending Studio, isolated core changes — and routes to the relevant implementation references. Builder onboarding includes maker workflow context.
- [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md) indexes the implementation bin by scope; region maps absorb its matching content.
- [SETUP.md](SETUP.md) owns installation and reusable first-use checks.
- [CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md) owns checkpoint and remote contribution guidance; read it after implementation, immediately before those activities, or earlier when they are the task.
- [Component references](core/README.md) own shared implementation contracts; [Studio](studio/README.md) owns its interaction and runtime behavior.
- [Skill manuals](skills/README.md) own pattern and preparation-task tools, settings and limits; [shared print tools](core/print/USAGE.md) owns common operations.
- [The MCP adapter manual](adapters/mcp/README.md) owns chat-client connection and tool use.
- [GLOSSARY.md](GLOSSARY.md) owns shared terms.
- [DECISIONS.md](DECISIONS.md) owns contributor decisions and their approval status.
- [build_request.md](build_request.md#outstanding-work) owns outstanding or incomplete work only.
- [DEVLOG.md](DEVLOG.md) owns dated work records, measurements and development history.

Keep present behavior and contracts at their owners, future work and proposals
clearly marked, and past work and observations in the devlog. Work build-first
within the user's authorization: implement current requests directly without first
writing a build request. The backlog holds authorized work deferred or left
incomplete beyond the active task, or explicitly requested backlog entries.
Remove completed requests from the open list. Follow [documentation maintenance](BUILDERS.md#documentation-maintenance)
for dates, evidence and the limited historical-provenance exceptions.

When a backlog entry is needed, record available [request provenance](BUILDERS.md#build-request-provenance).
Reuse known contributor identity; leave uncertain metadata marked as such without
asking identity questions or delaying ordinary work. Agent proposals and missing
results do not create authorization.

Use implemented behavior and recorded evidence when describing SAAM. A software
check or preview is evidence about software; a physical result needs physical
evidence. Human job approvals, contributor decisions and authorization to develop
the project are distinct and must be recorded as given.
