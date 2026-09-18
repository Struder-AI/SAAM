# Studio

```saam-components
receiptState | @studio/work-state.mjs::requestReceiptState | request; time; closed owners; Studio state or displayed view | activity; receipt; awaiting confirmation | Pure classification unifies geometry/toolpath readiness, exact result matching and working/waiting/settled state; completion alone does not prove display.
```

```saam-page 7_studio
title 7 — Studio review
sub Level 1 · source identity binds the displayed result
parent 0_system studio
in session / requests
in bundle
in poses
out review actions
out source / time
port session | session / requests
port bundle | bundle
port poses | poses
box server | 7.1 | serve local session | >7f_server
box view | 7.2 | refresh preview | >7a_preview
box source | 7.3 | decode source | >7b_source
box requests | 7.4 | coordinate edits | >7c_requests
box tour | 7.5 | guide lessons | >7d_tour
box lifetime | 7.6 | retain live viewer | >7l_session
port actions | review actions
port time | source / time
session > server | launch | data
session > requests | agent work | data
bundle > server | current bundle | data
server > view | state snapshot | data
view > source | checked source identity | data
source > view | decoded moves | data | norank
source > time | program and time | data
poses > view | model frames | data
requests > view | pending / presented | data
server > tour | lesson action | data
tour > view | lesson metadata | data
view > actions | human confirmations | io
server > lifetime | session server | data
box 7j | 7.7 | play and export movies | >7j_playback
ext 7jCaller | shared callers
7jCaller > 7j | decoded moves / frame clock | data
7j > 7jCaller | display frames / WebM | data | norank
box 7k | 7.8 | present recipe and tour | >7k_controls
ext 7kCaller | shared callers
7kCaller > 7k | plan / setup / tour state | data
7k > 7kCaller | review controls and labels | data | norank
```

```saam-page 7a_preview
title 7.2 — Refresh preview
sub Level 2 · metadata changes preserve unchanged playback
parent 7_studio view
in state snapshot
in decoded moves
in model frames
in pending / presented
in lesson metadata
out checked source identity
out human confirmations
port state | state snapshot
port moves | decoded moves
port poses | model frames
port work | pending / presented
port lesson | lesson metadata
box refresh | 7.2.1 | refresh | @studio/app.mjs::refresh
box geometry | 7.2.2 | build geometry view | @studio/mesh-view.mjs::buildGeometryView
box path | 7.2.3 | index toolpath | @studio/toolpath-view.mjs::buildToolpathView
box material | 7.2.4 | build material scene | @studio/material-view.mjs::buildMaterialScene
box draw | 7.2.5 | draw view | >7i_draw
box ack | 7.2.6 | acknowledge display | @studio/app.mjs::acknowledgeDisplayedView
box approve | 7.2.7 | submit confirmation | @studio/app.mjs::approval
ext person | reviewer
port source | checked source identity
port action | human confirmations
state > refresh | latest snapshot | data
work > refresh | request state | data
lesson > refresh | tour metadata | data
refresh > source | new program identity | gate
moves > refresh | decoded program | data
refresh > geometry | changed geometry | gate
refresh > path | changed moves | gate
refresh > material | changed moves | gate
geometry > draw | selectable surfaces | data
path > draw | path index | data
material > draw | material buffers | data
poses > draw | machine transforms | data
refresh > ack | render scheduled | data
draw > ack | frame displayed | data
draw > person | displayed result | io
person > approve | explicit confirmation | io
approve > action | actor and revision | data
```

```saam-page 7b_source
title 7.3 — Decode source
sub Level 2 · worker decodes exact checked source once
parent 7_studio source
in checked source identity
out decoded moves
out program and time
port in | checked source identity
box fetch | 7.3.1 | fetch and hash sources | @studio/source-player.mjs::fetchSources
box decode | 7.3.2 | decode dialect | >7e_dialects
box session | 7.3.3 | load worker session | @studio/machine-session.mjs::sourceSession
box bind | 7.3.4 | bind machine model | @studio/source-worker.mjs::bind
box worker | 7.3.5 | handle worker request | @studio/source-worker.mjs::onmessage
state program | 7.3.6 | decoded program | @studio/source-worker.mjs::program
port moves | decoded moves
port time | program and time
in > session | print / revision / export | data
session > fetch | worker load request | data
fetch > decode | source text and settings | data
decode > session | move records | data
decode > bind | interpreted program | data
session > moves | installed compact buffers | data
bind > time | provider and source clock | data
```

```saam-page 7e_dialects
title 7.3.2 — Decode dialect
sub Level 3 · the same interpreters check export and playback
parent 7b_source decode
in source text and settings
out move records
out interpreted program
port in | source text and settings
box select | 7.3.2.1 | select dialect | @studio/source-player.mjs::decodeSource
box s5 | 7.3.2.2 | interpret Griffin | $griffin
box h2d | 7.3.2.3 | interpret H2D | @core/export/bambu-player.mjs::interpretBambuSource
box dobot | 7.3.2.4 | interpret Lua | @core/export/dobot-player.mjs::interpretDobotFiles
box denso | 7.3.2.5 | interpret PACScript | @core/export/denso-player.mjs::interpretDensoFiles
box study | 7.3.2.6 | interpret study | @core/export/machine-study.mjs::interpretMachineStudy
port moves | move records
port program | interpreted program
in > select | selected output | data
select > s5 | Griffin | gate
select > h2d | H2D | gate
select > dobot | Dobot | gate
select > denso | DENSO | gate
select > study | machine study | gate
s5 > select | program | data | norank
h2d > select | program | data | norank
dobot > select | program | data | norank
denso > select | program | data | norank
study > select | program | data | norank
select > moves | compact moves | data
select > program | program metadata | data
```

```saam-page 7c_requests
title 7.4 — Coordinate edits
sub Level 2 · live owned channel with durable recovery journal
parent 7_studio requests
in agent work
out pending / presented
port in | agent work
box records | 7.4.1 | manage request records | @studio/agent-requests.mjs::createAgentRequests
box index | 7.4.2 | reconcile recovery journal | @studio/request-index.mjs::createRequestIndex
box save | 7.4.3 | replace request file | $save
box ui | 7.4.4 | merge UI snapshots | @studio/agent-ui.mjs::createAgentUI
box receipt | 7.4.5 | classify receipt state | $receiptState
box events | 7.4.6 | queue Studio events | @studio/studio-events.mjs::createStudioEvents
box fade | 7.4.7 | scope pane fade | @studio/work-state.mjs::activeEditStage
port out | pending / presented
in > records | begin / claim / respond | data
in > events | person and worker observations | data
events > records | delivered event wakes wait | gate | norank
events > out | held and delivered events | data
records > index | recovery query and change hint | data
index > records | externally changed records | data | norank
records > save | updated JSON | data
records > receipt | persisted request / view receipt | data
ui > receipt | merged requests / rendered state | data
receipt > ui | activity / receipt / confirmation | data | norank
ui > fade | active edits / loading stage | data
fade > ui | dimmed pane scope | data | norank
ui > out | current presentation | data
```

```saam-page 7d_tour
title 7.5 — Guide lessons
sub Level 2 · navigation does not imply approval
parent 7_studio tour
in lesson action
out lesson metadata
port in | lesson action
box tour | 7.5.1 | manage tour | @studio/tour.mjs::createTour
box enter | 7.5.2 | enter lesson | @studio/tour.mjs::createTour::enter
box ensure | 7.5.3 | prepare example | @studio/tour.mjs::createTour::ensure
box describe | 7.5.4 | describe readiness | @studio/tour.mjs::createTour::describe
box receipt | 7.5.5 | inspect request receipt | $receiptState
port out | lesson metadata
in > tour | requested action | data
tour > enter | accepted navigation | gate
enter > ensure | selected example | data
tour > describe | observed state | data
describe > receipt | matching requests | data
describe > out | gates and agent instruction | data
```

```saam-page 7f_server
title 7.1 — Serve local session
sub Level 2 · serialize mutations; verify read snapshots
parent 7_studio server
in launch
in current bundle
out state snapshot
out lesson action
out session server
port launch | launch
port bundle | current bundle
ext browser | browser API requests
box server | 7.1.1 | serve authenticated API | @studio/server.mjs::createStudio
box state | 7.1.2 | read stable snapshot | @studio/server.mjs::readStableBundle
box generate | 7.1.3 | generate in worker | >7g_generation
box import | 7.1.4 | import STL | >7h_import
box changes | 7.1.5 | watch print changes | @studio/changes.mjs::watchStudioChanges
port snapshot | state snapshot
port lesson | lesson action
port lifetime | session server
launch > server | directory and options | data
bundle > state | selected adapter | data
browser > server | token / origin checked | io
server > state | state / revision request | gate
state > snapshot | consistent content identity | data
server > generate | generate request | gate
generate > server | checks / diagnostic | data | norank
server > import | uploaded STL | gate
import > server | selected print | data | norank
server > changes | library root | data
changes > server | change notification | data | norank
server > lesson | tour route | data
server > lifetime | live HTTP server | data
box study | 7.1.6 | read simulation study | @studio/machine-study.mjs::loadBundle
```

```saam-page 7g_generation
title 7.1.3 — Generate in worker
sub Level 3 · preparation and explicit commit share one candidate
parent 7f_server generate
in generate request
out checks / diagnostic
port in | generate request
box generate | 7.1.3.1 | request generation | @studio/server.mjs::createStudio::generate
box prepare | 7.1.3.2 | prepare candidate worker | @studio/prepared-generation-job.mjs::PreparedGenerationJob
box control | 7.1.3.3 | control cancellation | @core/print/generation-control.mjs::generationControl
box candidate | 7.1.3.4 | check candidate | @studio/generation-worker.mjs::ready
box provenance | 7.1.3.5 | retain checked source | @core/print/program-handoff.mjs::attachCheckedProgramWorker
ext worker | explicit generate message
port out | checks / diagnostic
in > generate | mode and current identity | data
generate > prepare | no valid saved program | gate
prepare > control | shared cancel flag | data
prepare > candidate | directory; plan hash | data
prepare > provenance | owned worker / identity | data
candidate > generate | prepared / failed | data | norank
generate > worker | persist exact candidate | data
worker > provenance | checked source response | data
provenance > out | source metadata / checks | data
generate > out | failure / reused checks | data
```

```saam-page 7h_import
title 7.1.4 — Import STL
sub Level 3 · recognized geometry defects may enter repair
parent 7f_server import
in uploaded STL
out selected print
port in | uploaded STL
box import | 7.1.4.1 | reserve print directory | @studio/import-stl.mjs::importStudioSTL
box worker | 7.1.4.2 | start import worker | @studio/import-stl.mjs::importInWorker
box choose | 7.1.4.3 | import or repair | @studio/import-worker.mjs::importOrRepair
box core | 7.1.4.4 | import into lifecycle | @core/print/import-stl.mjs::importSTLBundle
box repair | 7.1.4.5 | preserve and repair | $repairFiles
port out | selected print
in > import | bytes; name; units | data
import > worker | confined directory | data
worker > choose | worker data | data
choose > core | original STL | data
core > choose | imported / diagnostic | data | norank
choose > repair | recognized defect only | gate
repair > core | repaired STL in mm | data
choose > out | bundle and repair summary | data
```

```saam-page 7i_draw
title 7.2.5 — Draw review
sub Level 3 · display detail never changes exported commands
parent 7a_preview draw
in selectable surfaces
in path index
in material buffers
in machine transforms
out frame displayed
out displayed result
port geometry | selectable surfaces
port path | path index
port material | material buffers
port machine | machine transforms
box draw | 7.2.5.1 | draw frame | @studio/app.mjs::draw
box projection | 7.2.5.2 | project view | @studio/camera.mjs::createProjection
box time | 7.2.5.3 | sample source time | $sourceTime
box detail | 7.2.5.4 | select visible detail | @studio/toolpath-view.mjs::toolpathFrame
box mesh | 7.2.5.5 | shade geometry | @studio/mesh-view.mjs::createGeometryRenderer::draw
box beads | 7.2.5.6 | shade deposited material | @studio/material-view.mjs::createMaterialRenderer::draw
port frame | frame displayed
port out | displayed result
geometry > draw | mesh scene | data
path > draw | source moves and index | data
material > draw | bead instances | data
machine > draw | bound model pose | data
draw > projection | bounds; camera; viewport | data
projection > draw | screen projection | data | norank
draw > time | playback seconds | data
time > draw | active move and fraction | data | norank
draw > detail | visible moves / travel | data
detail > draw | display segments | data | norank
draw > mesh | geometry tab; WebGL available | gate
mesh > draw | shaded canvas | data | norank
draw > beads | supported material scene | gate
beads > draw | shaded canvas | data | norank
draw > frame | rendered frame | data
draw > out | scene / fallback lines | io
```

Display reduction and line fallback affect only the preview. Unsupported surface
frames keep their source lines; stationary injections use source-event markers,
not an invented bead direction. `draw` also serves movie export with explicit
time/canvas and without mutating live playback. Source identity remains the
review and delivery boundary.

## Request persistence

Read [Studio contracts](reference/studio.md), [rendering](reference/rendering.md)
or [kinematics](reference/presentation.md) when changing those boundaries.
An agent-owned live store is the operational channel shared by that agent's Studio
instances, toolkit stream and MCP adapter. Saves publish directly to subscribers;
bounded waits sleep on events rather than scanning on a timer. JSON records are the
durable recovery journal. The process-local index watches independent writers and
reconciles metadata every five seconds; explicit history listing forces a full
reconciliation. One agent may own multiple identified Studio instances, while
each Studio instance has one immutable agent owner. Print bundles, not Studio
instances, are the sharing boundary between agents. Cold/reconciliation work and
index memory still scale with history size. Claims are not transactional across
processes: use one handling agent per request.
Print, request and tour writes use unique temporary files and bounded Windows
sharing retries; failed replacement preserves the previous file.

## Presentation identity

`work-state.mjs` owns one pure receipt-state classifier for geometry/toolpath
readiness, exact result matching, confirmation waits and request activity across
the UI, persistence and tour gates. `app.mjs` retains
the two-animation-frame wait before acknowledging a presentable snapshot.
`agent-ui.mjs` merges snapshots by update time, preventing old
responses from reviving finished work. `app.mjs` reloads only for changed bundle
content or geometry/program requirements; tour readiness and start-layer metadata
alone preserve playback. View-ready responses carry the receipts they wrote,
allowing settlement without another acknowledgement or full state read. Agent
listener waits are coordination, not preview work.

## Historical inspection

Historical inspection uses an explicitly supplied `resolveBundle` adapter over
the shared lifecycle, not module paths loaded from a print. Its optional
inspection presentation hides approval controls; the adapter must also reject
approval and delivery. Preserve the original revision and distinguish old
stroke geometry from current export assumptions.
Record original settings as well, and compare interpreted deposition with the
source generator. Injection is an explicit development choice; default CLI and
known adapters retain their normal behavior.


```saam-scope
studio/ | Browser presentation, local API, worker sessions and request coordination
```

```saam-references
studio-protocols | maps/reference/studio-protocols.md | State ownership, worker correlation, cancellation, disposal and focused verification
studio | maps/reference/studio.md | Studio interaction, serving, review and agent coordination
rendering | maps/reference/rendering.md | Rendering, playback, display resources and movie export
```


```saam-page 7j_playback
title 7.7 — play and export movies
sub Shared responsibility · contracts remain with the owning region
parent 7_studio 7j
in decoded moves / frame clock
out display frames / WebM
port in | decoded moves / frame clock
port out | display frames / WebM
box n0 | 7.7.1 | retain compact moves | @studio/move-store.mjs::moveStore
in > n0 | retain compact moves inputs | data
n0 > out | retain compact moves result | data
box n1 | 7.7.2 | advance source clock | @studio/playback.mjs::advancePlayback
in > n1 | advance source clock inputs | data
n1 > out | advance source clock result | data
box n2 | 7.7.3 | export movie | @studio/playback.mjs::exportMovie
in > n2 | export movie inputs | data
n2 > out | export movie result | data
box n3 | 7.7.4 | schedule movie frames | @studio/playback.mjs::movieTimeline
in > n3 | schedule movie frames inputs | data
n3 > out | schedule movie frames result | data
box n4 | 7.7.5 | package WebM | @studio/playback.mjs::createMovieWebM
in > n4 | package WebM inputs | data
n4 > out | package WebM result | data
```


```saam-page 7k_controls
title 7.8 — present recipe and tour
sub Shared responsibility · contracts remain with the owning region
parent 7_studio 7k
in plan / setup / tour state
out review controls and labels
port in | plan / setup / tour state
port out | review controls and labels
box n0 | 7.8.1 | describe recipe | @studio/settings.mjs::recipeRows
in > n0 | describe recipe inputs | data
n0 > out | describe recipe result | data
box n1 | 7.8.2 | describe regional skills | @studio/settings.mjs::regionRows
in > n1 | describe regional skills inputs | data
n1 > out | describe regional skills result | data
box n2 | 7.8.3 | describe robot setup | @studio/settings.mjs::robotRows
in > n2 | describe robot setup inputs | data
n2 > out | describe robot setup result | data
box n3 | 7.8.4 | operate tour controls | @studio/tour-ui.mjs::createTourUI
in > n3 | operate tour controls inputs | data
n3 > out | operate tour controls result | data
box n4 | 7.8.5 | describe lesson task | @studio/tour-catalog.mjs::tourAgentInstruction
in > n4 | describe lesson task inputs | data
n4 > out | describe lesson task result | data
box n5 | 7.8.6 | name download | @studio/print-name.mjs::downloadName
in > n5 | name download inputs | data
n5 > out | name download result | data
```


```saam-page 7l_session
title 7.6 — Retain live viewer
sub Server lifetime, host browser dispatch and browser reconnection
parent 7_studio lifetime
in session server
port server | session server
box lifetime | 7.6.1 | retain viewers and sockets | @studio/lifetime.mjs::viewerLifetime
box open | 7.6.2 | dispatch host browser | @studio/browser.mjs::openBrowser
box connect | 7.6.3 | reconnect browser events | @studio/viewer-session.mjs::connect
ext browser | browser page lifetime
server > lifetime | live HTTP server | data
server > open | Studio URL | data
browser > connect | load / restored page | data
```


```saam-responsibilities
studio-server | studio/server.mjs, studio/changes.mjs | studio-protocols#changing-studio-http-and-change-notifications | core/tests/studio-agent.test.mjs, core/tests/studio-work.test.mjs, core/tests/studio-reconnect.test.mjs, core/tests/studio-generation-control.test.mjs
studio-lifetime | studio/browser.mjs, studio/lifetime.mjs, studio/viewer-session.mjs | studio#changing-browser-and-viewer-lifetime | core/tests/studio-open.test.mjs, core/tests/studio-lifetime.test.mjs, core/tests/studio-tour-lifetime.test.mjs, core/tests/studio-visibility.test.mjs
studio-requests | studio/agent-requests.mjs, studio/request-index.mjs, studio/studio-events.mjs, studio/agent-ui.mjs, studio/work-state.mjs | studio-protocols#changing-agent-request-state-and-presentation | core/tests/request-index.test.mjs, core/tests/studio-events.test.mjs, core/tests/studio-agent.test.mjs, core/tests/studio-agent-ui.test.mjs, core/tests/studio-work.test.mjs
studio-generation | studio/prepared-generation-job.mjs, studio/generation-worker.mjs | studio-protocols#changing-generation-workers | core/tests/studio-generation-control.test.mjs
studio-import | studio/import-stl.mjs, studio/import-worker.mjs | studio#changing-studio-import-transactions | core/tests/studio-import.test.mjs, core/tests/mesh-repair.test.mjs
studio-source | studio/source-player.mjs, studio/source-worker.mjs, studio/machine-session.mjs | studio-protocols#changing-source-workers-and-machine-sessions | core/tests/source-player.test.mjs, core/tests/studio-kinematics.test.mjs, core/tests/studio-generation-control.test.mjs
studio-app | studio/app.mjs | studio#changing-studio-application-coordination | core/tests/studio-view-readiness.test.mjs, core/tests/studio-reconnect.test.mjs, core/tests/studio-spinner.test.mjs, core/tests/studio-work.test.mjs
studio-rendering | studio/camera.mjs, studio/material-view.mjs, studio/mesh-view.mjs, studio/toolpath-view.mjs, studio/machine-view.mjs | rendering#changing-camera-and-displayed-geometry | core/tests/studio-camera.test.mjs, core/tests/studio-material.test.mjs, core/tests/studio-detail.test.mjs, core/tests/studio-geometry.test.mjs, core/tests/studio-kinematics.test.mjs
studio-playback | studio/move-store.mjs, studio/playback.mjs | studio-protocols#changing-compact-moves-and-playback-caches | core/tests/studio-movie.test.mjs, core/tests/studio-playback-cache.test.mjs, core/tests/source-player.test.mjs
studio-controls | studio/settings.mjs, studio/print-name.mjs | studio#changing-recipe-review-and-display-names | core/tests/studio-settings.test.mjs, core/tests/studio-print-name.test.mjs
studio-tours | studio/tour-catalog.mjs, studio/tour-ui.mjs, studio/tour.mjs | studio#changing-guided-tours | core/tests/studio-tour.test.mjs, core/tests/studio-tour-ui.test.mjs, core/tests/studio-tour-lifetime.test.mjs
studio-studies | studio/machine-study.mjs | studio#changing-the-mechanism-study-adapter | core/tests/machine-study.test.mjs, core/tests/machine-jog.test.mjs
```
