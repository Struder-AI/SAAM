# Source agent toolkit

Making, Studio, tours, chat attachment, requests and workspace jobs belong to the
[SAAM application](../application/README.md). This toolkit reads published source
guidance; it creates no runtime, Studio, request journal or diagnostics service.
[MAKERS](../../MAKERS.md), [BUILDERS](../../BUILDERS.md) and
[developer context](../../DEVELOPER-CONTEXT.md) own their roles.

Run from the checkout root:

```powershell
node scripts/agent-toolkit.mjs builder-onboarding --area skills
node scripts/agent-toolkit.mjs developer-onboarding --area core/geom
node scripts/agent-toolkit.mjs read-guidance architecture
node scripts/agent-toolkit.mjs read-guidance docs/adr/0001-text-architecture-and-local-dev-maps.md
node scripts/agent-toolkit.mjs read-skill text --maker --builder --machine ultimaker-s5
node scripts/agent-toolkit.mjs read-guidance MAKERS.md#standard-parameter-policy
node scripts/agent-toolkit.mjs context-budget
```

Developer onboarding delivers the glossary, full developer context and
[architecture specification](../../ARCHITECTURE.md). Repeated --area options add
the named component manuals; an unknown area is reported. The shared specification
and decision records are Markdown versioned with source. Optional local development
tools are described in the checkout's local notes and run independently.

All roles receive [shared local notes](../application/README.md#local-agent-notes).
Installed maker work uses `saam call maker_onboarding`; maker-onboarding here is a
source context read. Skill reads default to maker; --maker, --builder and --developer
select roles. Missing optional manuals are reported. ID#heading reads a complete
maker section; --machine opens applicable advanced sections and --all opens everything.
The reader returns published links, omitted headings/gates and unreadable markers.

context-budget measures assembled manuals and the application operation catalog
without starting the app or release service. Its isolated temporary print library
is disposed after measurement. Outputs are JSON; failures set a nonzero exit code.
