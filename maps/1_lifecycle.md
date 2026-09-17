# Print lifecycle

```saam-components
load | @core/print/workflow.mjs::createBundleWorkflow::loadBundle | directory; program-read options | current state and content identities | Reads current bytes; validates changed inputs and requested export; approvals are always fresh; may reject invalid files.
save | @core/file-write.mjs::replaceFile | destination path; bytes or text | completed file replacement | Unique temporary file; bounded Windows sharing retries; no multi-file transaction.
verifyGeometry | @core/print/geometry.mjs::verifyGeometry | native bytes; descriptor | completion or validation error | Millimetres; checks byte identity and native round trip; does not approve geometry.
```

```saam-page 1_lifecycle
title 1 — Print lifecycle
sub Level 1 · current bytes determine identity and approval
parent 0_system life
in print commands
in path
in checked program
in review actions
out locked plan
out path / plan
out bundle
port commands | print commands
port actions | review actions
port path | path
port checked | checked program
box init | 1.1 | initialize | @core/print/workflow.mjs::createBundleWorkflow::initBundle
box edit | 1.2 | update recipe | @core/print/workflow.mjs::createBundleWorkflow::updatePlan
box load | 1.3 | read current | >1a_read
box generate | 1.4 | prepare and save | >1b_generate
box review | 1.5 | approve / deliver | >1c_review
port plan | locked plan
port emit | path / plan
port bundle | bundle
commands > init | new print | gate
commands > edit | recipe edit | gate
commands > load | open | gate
commands > generate | generate | gate
init > load | saved files | data
edit > load | saved files | data
load > bundle | current state | data
actions > review | human action | data
review > bundle | review / delivery | data
generate > plan | plan | data
path > generate | generated path | data
generate > emit | path and settings | data
checked > generate | bytes and checks | data
generate > bundle | saved generation | data
box runtime | 1.6 | bind runtime and commands | >1d_runtime
ext bootstrap | CLI / module initialization
bootstrap > runtime | command and runtime dependencies | data
```

```saam-page 1a_read
title 1.3 — Read current
sub Level 2 · unchanged identities reuse validation
parent 1_lifecycle load
in open
in saved files
out current state
port open | open
port files | saved files
box load | 1.3.1 | load bundle | $load
box verify | 1.3.2 | verify native | $verifyGeometry
box handoff | 1.3.3 | reuse checked source | @core/print/program-handoff.mjs::checkedSourceFor
box decode | 1.3.4 | interpret saved bytes | $interpret
port result | current state
open > load | directory | data
files > load | directory | data
load > verify | changed geometry | gate
verify > load | verified | data | norank
load > handoff | source read; cache miss | gate
handoff > load | matching checked source | data | norank
load > decode | cold / full read | gate
decode > load | interpreted program | data | norank
load > result | hashes and approvals | data
box snapshot | 1.3.5 | snapshot file identity | @core/print/file-snapshot.mjs::createFileSnapshot
```

```saam-page 1b_generate
title 1.4 — Prepare and save
sub Level 2 · production requires geometry confirmation
parent 1_lifecycle generate
in generate
in generated path
in bytes and checks
out plan
out path and settings
out saved generation
port request | generate
port path | generated path
port checked | bytes and checks
box commit | 1.4.1 | generate bundle | @core/print/workflow.mjs::createBundleWorkflow::generateBundle
box read | 1.4.2 | read current | $load
box prepare | 1.4.3 | prepare candidate | @core/print/workflow.mjs::createBundleWorkflow::prepareProgram
box save | 1.4.4 | replace files | $save
port plan | plan
port emit | path and settings
port done | saved generation
request > commit | mode | data
commit > read | current inputs | data
read > commit | identity and approval | data | norank
commit > prepare | no reusable production bytes | gate
prepare > plan | locked recipe | data
path > prepare | path | data
prepare > emit | path and settings | data
checked > prepare | checked candidate | data
prepare > commit | prepared bytes | data | norank
commit > save | identity rechecked | gate
save > done | export; checks; review | data
```

```saam-page 1c_review
title 1.5 — Approve and deliver
sub Level 2 · delivery copies the exact reviewed bytes
parent 1_lifecycle review
in human action
out review / delivery
port human | human action
box chat | 1.5.1 | bind chat confirmation | @core/print/workflow.mjs::createBundleWorkflow::confirmGeometryFromChat
box approve | 1.5.2 | record approval | @core/print/workflow.mjs::createBundleWorkflow::approve
box deliver | 1.5.3 | deliver reviewed bytes | @core/print/workflow.mjs::createBundleWorkflow::deliver
box read | 1.5.4 | read current | $load
port done | review / delivery
human > chat | geometry statement | gate
chat > approve | matching geometry identity | data
human > approve | Studio confirmation | gate
human > deliver | export request | gate
approve > read | requested stage | data
read > approve | current revision | data | norank
deliver > read | source bytes | data
read > deliver | exact export approval | data | norank
approve > done | recorded decision | data
deliver > done | verified delivery file | data
```

Caller contracts: [print lifecycle](reference/lifecycle.md). The workflow factory
binds geometry and generator adapters; the shell and bounded wedge share its
approval, identity and delivery behavior. Development generation does not create
human approval. Identity includes runtime and actual file bytes, not mtimes.


```saam-scope
core/print/ | Bundle lifecycle, persistence and command entry points
core/file-write.mjs | Atomic individual-file replacement shared with Studio
```

```saam-references
lifecycle | maps/reference/lifecycle.md | Bundle formats, identity, validation, approval and delivery
```


```saam-page 1d_runtime
title 1.6 — Bind runtime and commands
sub Shared workflow configuration and command dispatch
parent 1_lifecycle runtime
in command and runtime dependencies
port in | command and runtime dependencies
state dependencies | 1.6.1 | fingerprint runtime inputs | @core/print/bundle.mjs::RUNTIME_FILES
box limits | 1.6.2 | select declared limitations | @core/print/bundle.mjs::limitationsFor
box command | 1.6.3 | dispatch print command | @core/print/cli.mjs::run
in > command | arguments / revision guard | data
in > dependencies | bound module dependencies | data
in > limits | plan / machine | data
```


```saam-responsibilities
workflow | core/print/workflow.mjs, core/print/bundle.mjs, core/print/cli.mjs | lifecycle#changing-lifecycle-identity-and-persistence | core/tests/workflow.test.mjs, core/tests/chat-geometry-confirmation.test.mjs, core/tests/read-scope.test.mjs
file-state | core/file-write.mjs, core/print/file-snapshot.mjs | lifecycle#changing-file-replacement-and-refresh-snapshots | core/tests/file-write.test.mjs, core/tests/read-scope.test.mjs
generation-handoff | core/print/generation-control.mjs, core/print/program-handoff.mjs | studio-protocols#changing-cancellation-and-checked-source-reuse | core/tests/studio-generation-control.test.mjs
```
