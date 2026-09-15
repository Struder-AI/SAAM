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

Choose context for the requested work: helping a person make a part or developing
SAAM itself.

## Choose your context

| Task | Start here |
|---|---|
| Start a guided tour | Execute the command above first, open its Studio URL, then use its returned context and listener. |
| Start a new custom part | Run `node scripts/agent-toolkit.mjs maker-onboarding` if maker context is missing. It supplies MAKERS, the complete skill digest and shared print tools. Then choose and read relevant skill manuals individually before preparing the preview. |
| Edit an existing Studio print | First run `node scripts/agent-toolkit.mjs begin-studio-work Prints/PART --instruction "Requested change"` (omit the directory for the active tour). For Studio-originated work use `--request ID`. Then load only missing maker/skill context and apply the edit using the returned print and revision. |
| Build, fix, investigate or document SAAM | Run `node scripts/agent-toolkit.mjs developer-onboarding` if developer context is missing; optionally add `--area AREA` for a known affected component. It supplies developer orientation, architecture and the complete skill digest. Then choose the relevant implementation and skill references. |
| Exercise maker tools during development | Follow [development testing through the use context](DEVELOP.md#testing-through-the-use-context) and the maker/skill instructions for the workflow being tested. |
| Set up an unused checkout | Follow [setup and checks](SETUP.md), including [Studio client permissions](studio/README.md#studio-agent-permissions), before using it. |

Choose by the requested work; when unspecified, use the developer pathway.
Develop on a contributor branch. If the checkout is on main, create a branch
before editing; publish through a pull request unless direct main work is
explicitly authorized. Keep at most one active pending branch per account;
reuse it across tasks rather than creating task-specific branches.
The [agent CLI toolkit](core/agent/README.md) bundles the owning context reads,
tour startup, preview creation/opening and request coordination. Use onboarding
for ordinary maker or developer work. A tour request goes straight to the launch
command above, which supplies its own participation context after the Studio URL.
Text returned by these commands satisfies the corresponding manual reads. Do
not read a manual before onboarding and then load it again, rerun onboarding for
every request, or follow a link to a document/section already present in context.
Read missing context when the task needs it, and refresh affected guidance only
when its source changed or the prior context is unavailable. In clients without
command access, read the same owning manuals through their available file/MCP
reader once; the CLI is a convenience, not an additional context gate.
These are task contexts, and they do not expand the user's authorization.
If `.local/AGENTS.md` exists, consult it when the user refers to a local experiment.
Local capabilities are not part of shared SAAM and must not be assumed elsewhere.
Read linked reference sections when their responsibilities affect the task;
follow their dependencies as needed rather than loading every document.

## Current context boundary

This checkout's current instructions and implemented shared contracts govern SAAM
work. When arriving from an older repository or conversation, reorient here before
editing; do not carry its component architecture, methods or workflow rules forward
as current requirements. Prior material is reference for explicit selective adoption
under [the contribution boundary](DEVELOP.md#context-and-selective-adoption).
The [withdrawal and deferred intents](DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission)
identify the September 12 work that must not be restored wholesale.

## First invocation

On first use of a checkout, follow [setup and checks](SETUP.md).
Reuse completed setup across tasks; a new agent or print does not require another
setup or regression run. Setup creates no manufacturing approval.

Development checks follow [change-based selection](DEVELOP.md#avoid-check-spirals).
Commits and task completion add no test gate; skill manuals do not add a second
verification pass. Run a check to resolve a concrete uncertainty, then reuse its
result until relevant inputs change.

## Find the owning source

- [MAKERS.md](MAKERS.md) owns guidance for helping a person make a part.
- [DEVELOP.md](DEVELOP.md) owns developer orientation and routes to the relevant implementation references.
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
Remove completed requests from the open list. Follow [documentation maintenance](DEVELOP.md#documentation-maintenance)
for dates, evidence and the limited historical-provenance exceptions.

When a backlog entry is needed, record available [request provenance](DEVELOP.md#build-request-provenance).
Reuse known contributor identity; leave uncertain metadata marked as such without
asking identity questions or delaying ordinary work. Agent proposals and missing
results do not create authorization.

Use implemented behavior and recorded evidence when describing SAAM. A software
check or preview is evidence about software; a physical result needs physical
evidence. Human job approvals, contributor decisions and authorization to develop
the project are distinct and must be recorded as given.
