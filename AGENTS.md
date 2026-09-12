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
For a new download, run the single [setup command](CONTRIBUTING.md#setup-and-checks)
before skill tools. It supplies Node and dependencies; do not send makers to a
system installer or run the full regression suite as first-use setup.
With the private runtime, translate manuals' `node`/`npm` commands through
`.\saam.ps1 node`/`npm` on Windows or `sh saam.sh node`/`npm` on macOS/Linux.
Launch Studio with the launcher's `studio` command.
These are task contexts, and they do not expand the user's authorization.
If `.local/AGENTS.md` exists, consult it when the user refers to a local experiment.
Local capabilities are not part of shared SAAM and must not be assumed elsewhere.
Read linked reference sections when their responsibilities affect the task;
follow their dependencies as needed rather than loading every document.

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
