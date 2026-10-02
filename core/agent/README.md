# Source agent toolkit

Making, Studio, tours, chat attachment, requests and workspace jobs belong to the
[SAAM application](../application/README.md). This toolkit reads source guidance
and dev maps; it creates no runtime, Studio, owner, request journal or diagnostics
service. [MAKERS](../../MAKERS.md), [BUILDERS](../../BUILDERS.md) and
[developer context](../../DEVELOPER-CONTEXT.md) own their roles.

Run from the checkout root:

```powershell
node scripts/agent-toolkit.mjs builder-onboarding --area skills
node scripts/agent-toolkit.mjs developer-onboarding --area core/geom
node scripts/agent-toolkit.mjs read-skill text --maker --builder --machine ultimaker-s5
node scripts/agent-toolkit.mjs read-guidance MAKERS.md#standard-parameter-policy
node scripts/agent-toolkit.mjs read-map 0
node scripts/agent-toolkit.mjs read-map 2 --set 030-architecture
node scripts/agent-toolkit.mjs regenerate 6 --set 030-architecture
node scripts/agent-toolkit.mjs context-budget
```

`maker-onboarding` remains a source context read; installed maker work uses
`saam call maker_onboarding`. Skill reads default to maker and accept `--maker`,
`--builder`, `--developer`; missing optional manuals are reported. `ID#heading`
reads one complete maker section regardless of its gate. `--machine` opens
applicable advanced sections; `--all` opens everything. The reader returns
published source links and the headings/gates it omitted. Local extensions use
the selected catalog and manual reader; their source remains outside the app.

The [map guide](../../dev-map/README.md#commands) owns the single read contract.
`read-map` returns visible relationships and exact source ranges; leaves are read
with ordinary file tools. Link/contract addresses return complete interfaces.
Reads never return code or scan. Choose `030-architecture` for product work,
`030-deployment` for installation, and `default` for scanned implementation.
Indexes belong to their set and may change; record stable identities.
`--area` accepts component manuals or map addresses and may repeat. Design
regeneration redraws authored maps; implementation audit is separate.

`context-budget` measures assembled manuals and the full application operation
catalog without starting the app or its release service. Its isolated temporary
print library is disposed after measurement. It does not omit capabilities to
meet a context target. Outputs are JSON; failures set a nonzero exit code.
