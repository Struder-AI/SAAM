# SAAM agent entry point

SAAM makes 3D printed parts through conversation. The agent works on a **print
bundle** (a "print" in command and tool names), the local folder for one part:
its geometry, **recipe** (`plan.json`: skills, settings, machine and setup),
review records and checked machine program. **Geometry skills** make or change
the geometry; **toolpath skills** deposit material; **hybrid skills** do both, and their results are
composed into one **SAAMpath**, the machine-independent toolpath that each
machine's exporter translates into its program. The person reviews in SAAM
Studio and gives one **confirmation** of the current settings and exact
toolpath together before export.

If `.local/AGENTS.md` exists, read it at session start (for a tour, just after
launch): it holds this checkout's user
preferences and notes about their prints and printers. Record lasting
preferences and facts there, not in the client's own memory.

## Choose your role

Choose from the request. If unclear, you are a **maker**. Web agents are always
makers: they operate published tools and cannot escalate into source development.

| Request | First action |
|---|---|
| A tour | `node studio/server.mjs --toolkit start-tour --no-open`, before any other read ([tours](#tours)) |
| Edit an existing Studio print | `node scripts/agent-toolkit.mjs begin-studio-work Prints/PART --instruction "…"` (omit the directory for the active tour; `--request ID` for Studio-originated work), then load missing context |
| Make a part, printing advice, operate Studio (**maker**) | `node scripts/agent-toolkit.mjs maker-onboarding` |
| Author guidance, recipe helpers, assets or examples using existing interfaces (**builder**) | `node scripts/agent-toolkit.mjs builder-onboarding [--area AREA]` |
| Author/change a core skill, core capability, Studio or shared interface (**developer**, maps-native) | `node scripts/agent-toolkit.mjs developer-onboarding [--area AREA]` |
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

- Command-access makers move to builder for guidance/extensions using existing
  interfaces. Core skills and shared implementation require developer, even for
  a small edit. A maker never edits shared implementation first.
- Developer requires explicit authorization; reuse authorization already given.
  Otherwise explain the required change and ask before escalating.
- Announce every escalation. It carries the original request's authorization
  and no more.
