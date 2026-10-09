# SAAM agent entry point

SAAM makes 3D printed parts through conversation. A **print bundle** holds one
part's geometry, **recipe** (`plan.json`), review records and checked machine
program. Geometry skills shape it; toolpath skills deposit material; hybrid skills
do both. Their results compose one machine-independent **SAAMpath**. The person
reviews in Studio and exports from there; that Export is the one confirmation,
and it writes the current settings' exact toolpath.

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
| Update SAAM | Tell the person that **Update** in Studio or the tray menu is the supported way; reinstall only if they still ask |

Onboarding supplies the whole starting context, once per session. Without commands,
read [MAKERS.md](MAKERS.md), [BUILDERS.md](BUILDERS.md) or [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md).

## Using the saam command

Never use `dev-instance.mjs`; use the installed SAAM orchestrator.
[Application commands](core/application/README.md) own Studio, chat attachment,
tours, waits, jobs and the SAAM home. Use `saam help` or `saam help OPERATION`.
Pass JSON through stdin or `--input FILE`; PowerShell 5.1 changes quoted JSON.

The command sends the client's session ID when available. Retain a returned chat
ID and pass `--chat-id ID` on later commands. Naming a print attaches to its open
Studio when available. Respect Bundle reservations and request IDs; show edits
and hand back the returned `workRequest` when finished, needing discussion or interrupted.

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
