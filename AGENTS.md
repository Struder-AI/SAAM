# SAAM agent entry point

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
| **Builder** | Changes skills, adds functionality to Studio, and makes isolated, local changes to core; makes parts to test that work in development. | `node scripts/agent-toolkit.mjs builder-onboarding [--area AREA]` | [BUILDERS.md](BUILDERS.md) (with maker workflow in onboarding) and the [dev map](#dev-maps), walked from the region being touched. |
| **Developer** | Works on core and any other component as the work needs; owns cross-cutting design. Maps-native. | `node scripts/agent-toolkit.mjs developer-onboarding [--area AREA]` | The [dev map](#dev-maps) as the primary account, walked from `0`, plus the [developer orientation](DEVELOPER-CONTEXT.md#orientation). |

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

## Tour requests — launch first

For a tour request, before any other reading or onboarding, run this from the
repository root through the client's managed command session:

```sh
node studio/server.mjs --toolkit start-tour --no-open
```

Open `studio.url` from the `studio-ready` event immediately with the client's
browser integration and keep the command session alive. Then use the returned
participation context and keep the returned request listener active. The command
bundles maker context, creates fresh examples and starts lesson one, so no
onboarding or manual reads are needed before or after it. Do not add a chat
introduction or question; Studio supplies the first task.

### Suggesting a fresh session

Maker and builder agents should suggest the user start a new chat session when
**both** hold: the current session has exceeded roughly 250k tokens, **and** the
new request is an unrelated task or a substantial pivot from the current one.
Make it a suggestion, not a refusal, and only when both conditions are met.
Developer agents are exempt; they are expected to run longer sessions under
experienced management.

### Report sync state at session start

At the start of a maker or builder session — after launching a tour, or before
taking on any other request — tell the user in one line the date of this
checkout's last pull from `main`, the current commit hash and how many commits `main` has advanced since,
so they can pull the latest first if they want.

If the checkout also holds local work the user wants to publish, it belongs on
that user's contributor dev branch, never on `main` directly; keep one such
branch per account and reuse it across tasks. Publishing itself follows
[CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md). Developers manage their own git.

## Dev maps

The dev map is generated from the code and is the account of core and Studio.
Developer and builder agents orient by walking it from page `0`: `0` is the
regions, `N` a region and its files, `N.F` a file and its entry points, `N.F.E`
a declaration with what it calls, what calls it and what it is coupled to.
Makers operating existing tools need none of it.

```sh
node scripts/agent-toolkit.mjs read-map 0
node scripts/agent-toolkit.mjs read-map core/path/compose.mjs::composeResults
node scripts/agent-toolkit.mjs read-map 6.3.1 --code
node scripts/agent-toolkit.mjs regenerate 6
```

**Text search for orientation is discouraged.** Searching finds names; the walk
tells you who calls and consumes what you are about to change. Nothing on a page
is authored, so there is no map to keep current — after an edit, `regenerate`
and read again. Indexes are regenerated and may change: say the index and the
name when talking about a page, and write the declaration path when something
must keep pointing at it. The [map guide](maps/README.md) owns the commands and
the page fields; the [map contract](BUILDERS.md#maps-and-local-documentation)
owns the reading rules.

## Getting to work

Choose the context for the requested work rather than reading everything.

| Task | Start here |
|---|---|
| Start a guided tour | Execute the tour launch command above first, open its Studio URL, then use its returned context and listener. |
| Start a new custom part (maker) | Run `node scripts/agent-toolkit.mjs maker-onboarding` if maker context is missing. It supplies MAKERS, the complete skill digest and shared print tools. Then choose and read relevant skill manuals before preparing the preview. |
| Edit an existing Studio print | Start work early: run `node scripts/agent-toolkit.mjs begin-studio-work Prints/PART --instruction "Requested change"` (omit the directory for the active tour) to claim the request — you can acknowledge the person first. For Studio-originated work use `--request ID`. Then load only missing context and apply the edit. |
| Change a skill, extend Studio, or make an isolated core change (builder) | Run `node scripts/agent-toolkit.mjs builder-onboarding` (add `--area core/path` or `--area 6` for a known region) if builder context is missing. Core/Studio changes walk the dev map; skill-only changes use skill guidance and consumed API contracts. |
| Develop core or work across components (developer) | Run `node scripts/agent-toolkit.mjs developer-onboarding [--area AREA]`, where `--area` is a region path or index. Walk the map from the returned page with `read-map INDEX|DECLARATION`. |
| Set up an unused checkout | Follow [setup and checks](SETUP.md), including its Studio client permissions, before using it. |

The agent CLI toolkit (`node scripts/agent-toolkit.mjs --help`) bundles these
onboarding reads, tour startup, preview creation/opening and request coordination; its returned
text satisfies the matching manual reads. Do not reread context already present
or rerun onboarding per request; read missing context when the task needs it, and
refresh guidance only when its source changed. Clients without command access read
the same owning manuals directly once — the CLI is a convenience, not a context
gate. These are task contexts and do not expand the user's authorization. Git
handling follows [the sync note above](#report-sync-state-at-session-start) and
[CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md). If `.local/AGENTS.md` exists,
consult it when the user refers to a local experiment; local capabilities are not
part of shared SAAM.

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
- [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md) owns developer orientation: how the generated map is walked and what still has its own owner.
- [SETUP.md](SETUP.md) owns installation and reusable first-use checks.
- [CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md) owns checkpoint and remote contribution guidance; read it after implementation, immediately before those activities, or earlier when they are the task.
- The [dev map](#dev-maps) owns core/Studio implementation structure; it is generated from the source and read with `read-map`.
- [Skill manuals](skills/README.md) own pattern and preparation-task tools, settings and limits; [shared print tools](core/print/USAGE.md) owns common operations.
- [The MCP adapter manual](adapters/mcp/README.md) owns chat-client connection and tool use.
- [The map guide](maps/README.md) owns the map commands, the fields each page carries, the scan scope and the external-fact rows; the [map contract](BUILDERS.md#maps-and-local-documentation) owns its reading rules.
- `maker-context-map.html` and `builder-context-map.html` own documentation navigation for people; they are a human reference, not an agent read.
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
