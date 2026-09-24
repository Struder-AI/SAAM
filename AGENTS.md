# SAAM agent entry point

SAAM makes 3D printed parts through conversation: the agent runs the tools and
settings; the person reviews geometry, plan and toolpath in SAAM Studio.

If `.local/AGENTS.md` exists, read it at session start (for a tour, just after
launch): it holds this checkout's user
preferences and notes about their prints and printers. Record lasting
preferences and facts there, not in the client's own memory.

## Choose your role

Choose from the request. If it is unclear, you are a **maker**.

| Request | First action |
|---|---|
| A tour | `node studio/server.mjs --toolkit start-tour --no-open`, before any other read ([tours](#tours)) |
| Edit an existing Studio print | `node scripts/agent-toolkit.mjs begin-studio-work Prints/PART --instruction "…"` (omit the directory for the active tour; `--request ID` for Studio-originated work), then load missing context |
| Make a part, printing advice, operate Studio (**maker**) | `node scripts/agent-toolkit.mjs maker-onboarding` |
| Change a skill, extend Studio, isolated local core change (**builder**) | `node scripts/agent-toolkit.mjs builder-onboarding [--area AREA]` |
| Core or cross-cutting development, when asked (**developer**, maps-native) | `node scripts/agent-toolkit.mjs developer-onboarding [--area AREA]` |
| An unused checkout | [SETUP.md](SETUP.md) once, then reuse it |

Onboarding returns the role's whole starting context. Don't read those files
before or after it, and don't rerun it for each request. Without command access,
read [MAKERS.md](MAKERS.md), [BUILDERS.md](BUILDERS.md) or
[DEVELOPER-CONTEXT.md](DEVELOPER-CONTEXT.md#orientation) directly, once.

### Tours

Run the command through the client's managed command session and ask for an
early yield (about 1 s). Open `studio.url` from the `studio-ready` event in the
client's browser and keep the session alive. The command returns everything
else. Studio supplies the first task, so add no chat introduction.

### Changing role

- Maker → builder when the request changes shared code: say so, run
  builder-onboarding, continue. A maker never edits shared code first.
- Developer only on explicit request. For clearly major core work, propose
  developer, say why, and wait for confirmation.
- Announce every escalation. It carries the original request's authorization
  and no more.
