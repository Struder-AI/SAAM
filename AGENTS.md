# SAAM agent entry point

SAAM makes 3D printed parts through conversation. A **print bundle** holds one
part's geometry, **recipe** (`plan.json`), review records and checked machine
program. Geometry skills shape it; toolpath skills deposit material; hybrid skills
do both. Their results compose one machine-independent **SAAMpath**. The person
reviews in Studio and gives one confirmation of current settings and exact
toolpath before export.

If `.local/AGENTS.md` exists, read it at session start (for a tour, after launch).
Record lasting preferences there, never in the client's memory.

## Choose your role

Choose from the request; default to maker. Web agents remain makers.

| Request | First action |
|---|---|
| A tour | `saam start-tour`, before any other read |
| Edit an existing Studio print | Use its bundle/request identity on the first needed operation; load missing context as needed |
| Make a part, printing advice, operate Studio (**maker**) | `saam call maker_onboarding` |
| Author guidance, recipe helpers, assets or examples through existing interfaces (**builder**) | `node scripts/agent-toolkit.mjs builder-onboarding [--area AREA]` |
| Change a core skill, core capability, Studio or shared interface (**developer**) | `node scripts/agent-toolkit.mjs developer-onboarding [--area AREA]` |
| An unused checkout | [SETUP.md](SETUP.md) once, then reuse it |

Onboarding supplies the whole starting context; do not reread it or rerun it per
request. Without commands, read [MAKERS.md](MAKERS.md), [BUILDERS.md](BUILDERS.md)
or [DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md) directly, once.

[Application commands](core/application/README.md) own chat attachment, tours,
Studio, waits, jobs and the SAAM home. Use the returned chat ID on later commands
when the client's environment supplies none. Commands ending and browser tabs
closing do not stop SAAM; Quit does. Follow the tour's returned participation
context and keep responding to its requests through `saam wait`.

## Changing role

Command-access makers may become builders for guidance or extensions using
existing interfaces. Core/shared changes require developer authorization;
explain and ask when none exists. Announce every escalation and carry only the
original request's authorization. Makers never edit shared implementation first.
