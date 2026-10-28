# SAAM application

[Owned jobs](owned-jobs.mjs) supplies one Runtime lifetime for geometry, imports
and portable exchange: stable chat/target/job identity, current progress,
cancellation before commit and shutdown that awaits actual settlement. Studio
projects the captured geometry job; its target admission still rejects stale or
busy selections. Notification/cleanup failures cannot replace the operation's
outcome. `get_studio_events.jobFindings` exposes their count and first/last facts
for the calling chat, independently of generation status. Numerical workers and
their resource settlement remain with their operation owners.

The installed [orchestrator](../../packaging/application.mjs) owns the OS listener, tray, release service and stable Studio addresses. Each code root uses one child [runtime](../../packaging/runtime-host.mjs); children stop with the orchestrator. `saam` selects installed code; `saam --code-root CHECKOUT` selects that checkout with the same orchestrator and library. Missing installations or incompatible contracts are refused; older checkouts must merge the routing contract. Runtime code changes only through `reload-runtime`, which active work rejects. The tray lists runtimes/windows; `stop-runtime` stops the selected runtime and retires its windows. Tray Quit, `saam quit` and Update stop all runtimes, warning about active jobs; restart begins empty. Studio closes only its window when hidden sessions share its runtime; otherwise Quit stops that runtime, or SAAM if no other runtime runs. Opening SAAM uses installed code and reuses its newest visible Studio, or creates one. Explicit targets select their recorded code; only a launch or click takes focus, never an agent.

The shared home is `C:\SAAM` on Windows or `~/SAAM` on macOS: replaceable `app/`, user-owned `local/` and persistent `state/`. Bundles, extensions and last-export setups live in `local/Prints/`, `local/extensions/` and `local/machine-setups/`; requests/setup records are private to `state/runtimes/ID/`. Only the orchestrator migrates the home, generates client guidance and registers clients ([installation](../../packaging/INSTALL.md)). Each runtime checks its own setup. Show person-requested parts in a visible Studio as work progresses, including source-checkout runs. Reserve `--background` for agent-only diagnostics or an explicit request to hide Studio. Every runtime uses this home's library; agent disposables belong in its `tmp/`, and internal Node tests inject disposable paths.

`saam help [OP]` describes the selected code's operations; it, `status`, `quit`, `stop-session` and `stop-runtime` start nothing. Omitted visibility preserves the chat's choice: use `--background false` when returning from diagnostics to visible work. `saam open --studio-instance-id ID` or tray Open shows that Studio in the default browser. Tray Stop closes an idle session, preserving siblings and refusing busy edits. If its runtime exited unexpectedly, Open restarts its recorded identity; Stop retires it without starting a runtime. Pass inputs by file, stdin or scalar flags; `start-tour` starts the tour, `wait` reads requests/events. Unread arguments and review-state fields are dropped and named in `ignoredArguments`; a known argument of the wrong type fails.
`apply_extension` uses `bundleId`, current `expectedEditRevision` (or strict legacy `expectedRevision`), `extensionId`, `request` and optional `part`; its manifest/manual owns request fields. Text, heat-set and gridfinity share revisioned edits; [standard support](../../skills/standard-support/SKILL.md#choose-the-patches) owns editable mesh-roof construction.
`share_bundle` / `import_bundle` use `bundleId` and an absolute `packageFile` ZIP (sharing adds a missing `.zip`); [portable exchange](../print/README.md) owns editable inputs. Preparation is cancellable until publication; recipients regenerate/review before export.
`saam` is the only agent route, maintenance included: `migrate_bundle`, `get_bundle_instance`/`recover_bundle_instance`, `repair_stl` and `extension_library`. The same chat/runtime reclaims its dead Studio reservation on opening; others use explicit recovery/capture. Home migration belongs to the installers ([migrate-home](../../packaging/migrate-home.mjs)).
Claude/Codex session IDs identify chats; otherwise retain returned `chatId` and pass `--chat-id ID`, including retries. `--chat-name` sets its label.

[Runtime](runtime.mjs) owns queues and [work/hand-back](../../studio/README.md#carrying-a-maker-request). Edits, generation and `request_review` return `visualCheck` from the connected Studio canvas at the saved inputs. Viewer failures return errors. Read the [temporary PNG](result-images.mjs) before hand-back; replacement, closure or shutdown also expires it.
Naming an open bundle selects its window; ambiguous windows need a target. An idle owned window is reused; `saam new-instance` opens a separate Studio. Chats resume their window; one Studio reserves each bundle. IDs and addresses survive runtime reloads; changed code reloads the viewer.
`saam call capture_bundle --bundle-id PART` transfers ownership within a runtime; across runtimes it closes the previous Studio and opens the bundle in the target runtime's reusable window. Capture rejects active edits, imports, generation, construction and export; waiting requests are not active work.
Capture cancels prior unfinished requests and rejects old writes. Studio-first requests survive attachment; a reload reclaims only its own matching dead-process reservation.

Connect says “Mention SAAM in your chat client.” Installed guidance handles attachment. `repair_client_setup` repairs registration; existing clients may need restarting.
The [release service](../../packaging/release-service.mjs) owns consent/redaction and observes startup, operations, Studio/workspace and installer events once; offline, first-run evidence and the latest network issue wait in `tmp/`. `saam diagnostics` awaits receipts; Bundle owns revisions and exact-byte export.

## Bug reports

Before `report_bug`, understand the reported problem well enough to point to it
simply. State the expectation, the actual behavior and the gap so the reader can
judge a proposed solution. A clear behavior or guidance mismatch can establish
the bug without tracing its implementation. Include relevant functions or source
findings when they help explain that bug.

Keep each report focused and efficient: aim for an easy read on one phone page.
Use short **Problem**, **Cause** (or investigation findings), and **Evidence**
lines, with only the detail needed to understand and assess the reported gap.
Separate confirmed findings from hypotheses. Omit transcripts, raw logs, tool-call
history and context the service already attaches; 1000 characters is a ceiling,
not a target.

For a difficult unresolved problem, invest in checks that distinguish plausible
explanations. A report at that stage should say which specific diagnostic areas
were investigated or ruled out, what established those findings, and what remains
unknown. Time spent or a list of observations alone does not do this.

When a broader investigation reveals a small, understood bug, report that bug
compactly on its own merits. If continuing the broader investigation, hold its
report until there is a useful diagnosis or substantive narrowing to hand over.
If stopping, report only the established bug. For example, missing export progress
can be a complete small report while the freeze that exposed it remains
unexplained.

Model from the relay's saved-cat preparation report:

```text
Problem: Preparing a saved cat at a requested size prompted unnecessary setup questions before showing a preview.
Cause: Maker guidance was applied as an upfront questionnaire instead of using saved defaults and deferring export-specific checks.
Evidence: Asked for material, colour, plate and unused-nozzle diameter; user replied, “None of that should matter.”
```

Require relay acknowledgement and show the person what was sent.

## Local agent notes

Every role's onboarding returns the complete Markdown at `<SAAM home>/local/LOCAL-AGENT-NOTES.md` with `home`, `path` and `revision`; missing notes have empty text and null revision.
`read_local_agent_notes` refreshes it. `update_local_agent_notes` takes that explicit `home`, `expectedRevision` and replacement `text`; keep entries brief, update in place and remove stale ones.
Atomic updates reject busy/stale writers: read again and combine changes. Preferences belong here, outside client memory and generated guidance; no checkout personal notes are imported automatically. The one machine-readable preference, [phase colours](../print/USAGE.md#phase-colours), is `phase-colours.json` beside the notes.
Checkout development notes remain in `.local/AGENTS.md` and `.local/DEVELOPMENT.md`.

## Client queue monitoring

Native adapters report turn/contact/closure evidence to authenticated local `/control`; evidence survives restart and disconnect alone never ends work. Contact settles same/earlier work after underway operations and presentation or terminal failure; failures grant no receipt or tour gate. Both clients read one durable inbox with stable IDs: Codex through trusted UserPromptSubmit/PostToolUse context, Claude through native initial-turn/tool-result context; SAAM results/waits also carry events. Selection/input changes and person-requested work can wake an idle chat with a “file changed” prompt; restoration, progress, presentation and advisories stay in context. Waking preserves the inbox until context delivery. Explicit waits remain 25 seconds for Codex, 30 minutes for Claude.

Successful native context delivery explicitly acknowledges its exact event IDs. The durable inbox forwards those IDs to their recorded producing runtime and matching client/session before removing them; failures retain delivery for retry. It never starts or attaches a runtime, acknowledges a newer event by inference, or claims work. Repeated delivery after a lost acknowledgment is possible: ignore already-handled stable IDs. Older persisted inbox entries without producing-runtime metadata cannot clear a Runtime queue through this route.

`get_studio_events`, ordinary result event attachments and Runtime waits retain observations. After handling a returned batch, use `saam call ack_studio_events --input FILE` with `{"eventIds":["RETURNED_EVENT_ID"]}`, retaining the original chat ID and runtime. A repeated acknowledgement of the same IDs is harmless. `throughSeq` acknowledgement is retired: sequence numbers can recur after a Runtime queue is replaced. `afterSeq` and returned cursors only filter reads.

The CLI acknowledges wait events after its stdout write succeeds; a custom writer must complete before acknowledgement. Output failure leaves events pending. If acknowledgement fails after output, the CLI reports `delivery-ack-retry` with `delivered:true` and exits unsuccessfully: retry those exact IDs rather than repeating the wait's claim or fabrication work. The stdout callback proves output at that boundary, not that a person or model read it. Runtime protocol 4 rejects mixed older components before routing this behavior. Web callers use a separate acknowledgement after assembling the complete result; result-page reads stay pure. Current desktop evidence does not establish live web delivery.

Open, successful Import, tours and capture commit the same Studio selection transition. A switch retires old presentation obligations without reporting them shown; underway work keeps its original bundle. Carry `expectedStudio: {studioInstanceId, bundleId, selectionVersion}` and originating `requestIds`; A→B→A and capture-back reject old authority with `STUDIO_TARGET_CHANGED`. Hand-back still settles the original `workRequest.id`. [Setup](../../packaging/INSTALL.md) registers adapters; no agent starts a relay or heartbeat.

[`command-results.mjs`](command-results.mjs) owns immutable reports in the home's
`local/bundle-command-results`, separate from live part folders and optional debug
observations. Queries verify the content identity and target; they neither create
folders nor consume results. Reports survive later edits and failed creation and
have no automatic expiry. If report retention fails after a committed operation,
the response preserves its committed outcome and explicitly reports unavailable
report data. It must not encourage retrying the successful edit.
