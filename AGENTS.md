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

Choose context for the requested work: helping a person make a part or developing
SAAM itself.

## Choose your context

| Task | Start here |
|---|---|
| Help a person make a part | Read [MAKERS.md](MAKERS.md) before the first maker-facing response, then the relevant [skill manual](skills/README.md). |
| Build, fix, investigate or document SAAM | Read the orientation at the start of [DEVELOP.md](DEVELOP.md), then follow its task-specific references. |
| Exercise maker tools during development | Follow [development testing through the use context](CONTRIBUTING.md#testing-through-the-use-context) and the maker/skill instructions for the workflow being tested. |
| Set up an unused checkout | Follow [setup and checks](CONTRIBUTING.md#setup-and-checks), including [Studio client permissions](studio/README.md#studio-agent-permissions), before using it. |

Choose by the requested work; when unspecified, use the developer pathway.
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
under [the contribution boundary](CONTRIBUTING.md#context-and-selective-adoption).
The [withdrawal and deferred intents](DECISIONS.md#d-029--withdraw-september-12-contributions-and-vet-readmission)
identify the September 12 work that must not be restored wholesale.

## First invocation

On first use of a checkout, follow [setup and checks](CONTRIBUTING.md#setup-and-checks).
Reuse completed setup across tasks; a new agent or print does not require another
setup or regression run. Setup creates no manufacturing approval.

Development checks follow [change-based selection](CONTRIBUTING.md#checks).
Commits and task completion add no test gate; skill manuals do not add a second
verification pass. Run a check to resolve a concrete uncertainty, then reuse its
result until relevant inputs change.

## Find the owning source

- [MAKERS.md](MAKERS.md) owns guidance for helping a person make a part.
- [DEVELOP.md](DEVELOP.md) owns developer orientation and routes to the relevant implementation references.
- [CONTRIBUTING.md](CONTRIBUTING.md) owns setup, work agreements, test selection and documentation maintenance.
- [Component references](core/README.md) own shared implementation contracts; [Studio](studio/README.md) owns its interaction and runtime behavior.
- [Skill manuals](skills/README.md) own pattern and preparation-task tools, settings and limits; [shared print tools](core/print/USAGE.md) owns common operations.
- [The MCP adapter manual](adapters/mcp/README.md) owns chat-client connection and tool use.
- [GLOSSARY.md](GLOSSARY.md) owns shared terms.
- [DECISIONS.md](DECISIONS.md) owns contributor decisions and their approval status.
- [build_request.md](build_request.md#outstanding-work) owns outstanding or incomplete work only.
- [DEVLOG.md](DEVLOG.md) owns dated work records, measurements and development history.

Write current guidance in present tense. Work build-first within the user's
authorization; a build request is useful only for work that remains outstanding
or incomplete. Record completed work in the devlog and remove completed requests
from the open list. Follow [documentation maintenance](CONTRIBUTING.md#documentation-maintenance)
for dates, evidence and the limited historical-provenance exceptions.

Use implemented behavior and recorded evidence when describing SAAM. A software
check or preview is evidence about software; a physical result needs physical
evidence. Human job approvals, contributor decisions and authorization to develop
the project are distinct and must be recorded as given.
