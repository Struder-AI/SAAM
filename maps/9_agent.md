# Agent toolkit

```saam-page 9_agent
title 9 — Assist
sub Level 1 · CLI commands compose existing workflow owners
parent 0_system agent
in request
out print commands
out session / requests
port in | request
box context | 9.1 | select context | >9a_context
box preview | 9.2 | prepare and open | @core/agent/toolkit.mjs::preview
box begin | 9.3 | begin Studio work | @core/agent/toolkit.mjs::beginWork
box wait | 9.4 | wait for request | @core/agent/toolkit.mjs::waitForRequests
box respond | 9.5 | report result | @core/agent/toolkit.mjs::respondToRequest
box inspect | 9.6 | inspect generation failure | @core/agent/toolkit.mjs::inspectFailure
port print | print commands
port studio | session / requests
in > context | onboarding / manual read | gate
in > preview | tour / open / create | gate
in > begin | edit instruction | gate
in > wait | listener | gate
in > respond | result / status | gate
in > inspect | generation diagnostic | gate
preview > print | create / load | data
preview > studio | live server and context | data
begin > studio | claim and edit context | data
wait > studio | queued work / claim | data
respond > studio | target / response | data
inspect > studio | failure and guidance | data
```

```saam-page 9a_context
title 9.1 — Select context
sub Level 2 · roles select reads; prior context is reused
parent 9_agent context
in onboarding / manual read
port in | onboarding / manual read
box onboarding | 9.1.1 | choose role context | @core/agent/toolkit.mjs::onboarding
box skill | 9.1.2 | select skill roles | @core/agent/toolkit.mjs::readSkill
box packet | 9.1.3 | assemble context | @core/agent/toolkit.mjs::contextPacket
box read | 9.1.4 | read owning guidance | @core/agent/manuals.mjs::readGuidance
box maps | 9.1.5 | read region maps | @core/agent/toolkit.mjs::readMaps
ext agent | agent context
in > onboarding | role / areas | gate
in > skill | skill / flags | gate
in > packet | guidance path | gate
onboarding > packet | scoped source IDs | data
onboarding > maps | developer / selected areas | gate
in > maps | map key | gate
maps > agent | region and shared uses | data
skill > packet | selected manuals | data
packet > read | unique document / heading | data
read > packet | current text and links | data | norank
packet > agent | text / source / hash | data
```

## Implementation and checks

[CLI contracts](../core/agent/README.md) own flags and returned packets. The thin
launcher validates arguments and process lifetime; the toolkit composes owning
APIs. The manual reader is shared with MCP. Preview commands retain their live
server and request listener; a tour emits `studio-ready` before its context so
the client can open the first lesson immediately.
The browser opener and request wait/claim implementation are shared with MCP;
manuals use its compatibility re-export. CLI onboarding does not register new
MCP tools. [Toolkit tests](../core/tests/agent-toolkit.test.mjs) cover current
context, role selection, setup reuse, reopening approvals/exports, STL imports,
tours, coordination, partial failure and the managed CLI launcher. Manual-access,
MCP and Studio request tests exercise the shared boundaries. Select checks for
the change under [check policy](../BUILDERS.md#avoid-check-spirals).
