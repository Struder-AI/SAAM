# SAAM agent entry point

SAAM makes 3D printed parts through conversation. A **print bundle** holds one
part's geometry, **recipe** (`plan.json`), review records and checked machine
program. Geometry skills shape it; toolpath skills deposit material; hybrid skills
do both. Their results compose one machine-independent **SAAMpath**. The person
reviews in Studio and gives one confirmation of current settings and exact
toolpath before export.

This entry point serves source and installed SAAM. Every role's onboarding reads
shared `<SAAM home>/local/LOCAL-AGENT-NOTES.md`; [local notes](core/application/README.md#local-agent-notes)
own reads and updates. Source checkout notes stay in `.local/AGENTS.md`; builders
and developers also read `.local/DEVELOPMENT.md`. For tours, read notes after launch.

## Choose your role

Choose from the request; default to maker. Developer work, and builder work other
than extensions in the home's extensions folder, needs a source checkout.

| Request | First action |
|---|---|
| A tour | `saam start-tour`, before any other read |
| Edit an existing Studio print | Use its bundle/request identity on the first needed operation; load missing context as needed |
| Make a part, printing advice, operate Studio (**maker**) | `saam call maker_onboarding` |
| Author extensions, guidance, recipe helpers, assets or examples through existing interfaces (**builder**) | `node scripts/agent-toolkit.mjs builder-onboarding [--area AREA]` |
| Change a core skill, core capability, Studio or shared interface (**developer**) | `node scripts/agent-toolkit.mjs developer-onboarding [--area AREA]` |
| An unused checkout | [SETUP.md](SETUP.md) once, then reuse it |

Onboarding supplies the whole starting context, once per session. Without commands,
read [MAKERS.md](MAKERS.md), [BUILDERS.md](BUILDERS.md) or [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md).

## Using the saam command

The installed `saam` command makes parts, opens Studio and starts the tour;
[application commands](core/application/README.md) own chat attachment, tours,
Studio, waits, jobs and the SAAM home. `saam help` lists operations and
`saam help OPERATION` describes one. Pass JSON through stdin or `--input FILE`,
because Windows PowerShell 5.1 changes quoted JSON arguments.

The command sends the client's session ID when available. If a response supplies
a chat ID, retain it for this chat and pass `--chat-id ID` on every later command.
Naming an existing print attaches to its open Studio when available. Respect
Bundle reservations and request IDs. Show intermediate edits; use the returned
`workRequest` to hand work back when finished, needing discussion, or receiving
a user interjection.

Follow [client queue monitoring](core/application/README.md#client-queue-monitoring)
and a tour's returned participation context. Commands ending and browser tabs
closing do not stop SAAM; Quit does.

If client registration needs repair, run `saam call repair_client_setup` and
handle its errors; the person may need to restart the client to reload permissions.

## Changing role

“If saam can do it, use saam. If it can't, build an extension that can.” (owner,
2026-10-05): makers become builders for extensions or guidance using existing
interfaces ([working boundaries](MAKERS.md#working-boundaries)); work those cannot
express is a SAAM bug to file with `saam call report_bug`. Changing core or shared
code requires the developer role and the person's authorization; without it,
explain the change and ask. Announce a role change; it carries only the original
request's authorization.
