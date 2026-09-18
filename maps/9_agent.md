# Agent toolkit

The map-owned `agent` reference specifies the command interface. The shared
manual reader also resolves old component-manual paths to their canonical
map-owned text, retaining section identity and rejecting unsafe filesystem paths.
The thin CLI in `scripts/agent-toolkit.mjs` owns argument parsing and process
lifetime. `core/local-extension.mjs` loads only the explicit checkout extension;
local experiments and their manuals are not published as shared capabilities.

Map implementation is maintained through [the map guide](README.md): model parsing
and reference ownership, graph extraction, evidence projection, maintenance and
the Python renderer all feed one model. These development tools support this
documentation structure; they do not expand the core/Studio runtime boundary.

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
box wait | 9.4 | wait for requests / events | @core/agent/toolkit.mjs::waitForRequests
box respond | 9.5 | report result | @core/agent/toolkit.mjs::respondToRequest
box inspect | 9.6 | inspect generation failure | @core/agent/toolkit.mjs::inspectFailure
box events | 9.7 | read Studio events | @core/agent/toolkit.mjs::readStudioEvents
box poll | 9.8 | poll owned Studio | @core/agent/toolkit.mjs::pollStudio
port print | print commands
port studio | session / requests
in > context | onboarding / manual read | gate
in > preview | tour / open / create | gate
in > begin | edit instruction | gate
in > wait | recovery listener | gate
in > respond | result / status | gate
in > inspect | generation diagnostic | gate
in > events | event read | gate
preview > print | create / load | data
preview > studio | identified live session / event stream | data
begin > studio | claim and edit context | data
wait > studio | persisted queued work / claim | data
wait > poll | Studio URL / owner ID | data
events > poll | Studio URL / owner ID | data
events > studio | in-process queue drain | data
poll > studio | owner-authenticated long-poll | data
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
box local | 9.1.6 | load checkout extension | @core/local-extension.mjs::loadLocalExtension
```

## Implementation and checks

[CLI contracts](reference/agent.md) own flags and returned packets. The thin
launcher validates arguments and process lifetime; the toolkit composes owning
APIs. The manual reader is shared with MCP. Preview commands retain their live
server and bidirectional newline-delimited agent channel. Studio requests stream
from the owned instance on stdout and begin/respond/activity commands return on
the same managed session; a tour emits `studio-ready` before its context so the
client can open the first lesson immediately. The persisted event-driven wait is
the recovery path for independent processes. Delivered Studio events stream as
`studio-events` lines on the same session; `read-studio-events` and
`wait-for-studio-request` drain the owning agent's event queue in process, or
through the owned Studio's owner-authenticated long-poll when given its URL and
agent owner ID, so an independent process still receives events and
calculation progress.
The browser opener and request store implementation are shared with MCP;
manuals use its compatibility re-export. CLI onboarding does not register new
MCP tools. [Toolkit tests](../core/tests/agent-toolkit.test.mjs) cover current
context, role selection, setup reuse, reopening approvals/exports, STL imports,
tours, coordination, partial failure and the managed CLI launcher. Manual-access,
MCP and Studio request tests exercise the shared boundaries. Select checks for
the change under [check policy](../BUILDERS.md#avoid-check-spirals).


```saam-scope
core/agent/ | Agent context and workflow toolkit
core/local-extension.mjs | Explicit local extension loading boundary
```

```saam-references
agent | maps/reference/agent.md | Toolkit command and response contracts
```


```saam-responsibilities
guidance | core/agent/manuals.mjs | agent#changing-guidance-and-map-reads | core/tests/mcp-access.test.mjs, core/tests/dev-map-reference.test.mjs
toolkit | core/agent/toolkit.mjs, core/local-extension.mjs | agent#changing-toolkit-context-and-workflow-composition | core/tests/agent-toolkit.test.mjs, core/tests/context-map.test.mjs
```
