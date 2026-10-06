# SAAM application

The installed [orchestrator](../../packaging/application.mjs) owns the OS listener, optional tray, release service and stable Studio window addresses. Each selected code root runs operations in one child [runtime](../../packaging/runtime-host.mjs); children stop with the orchestrator. `saam` selects installed code; `node CHECKOUT/scripts/saam.mjs` selects that checkout while retaining the installed orchestrator. Source changes restart an idle runtime; active work rejects reload. The tray lists runtimes/windows; `stop-runtime` stops the invoking checkout's runtime. Quit/Update cover all runtimes and warn about active jobs. Opening SAAM (shortcut, SAAM.app, tray) while it runs or starts waits for that orchestrator, then brings forward the Studio window focused last, else opens one on the most recent window's runtime; only that launch or click takes the foreground, never an agent.

The shared home is `C:\SAAM` on Windows or `~/SAAM` on macOS: replaceable `app/`, user-owned `local/` and persistent `state/`. Bundles, extensions and last-export setups live in `local/Prints/`, `local/extensions/` and `local/machine-setups/`; requests/setup records are private to `state/runtimes/ID/`. Only the orchestrator migrates the home, generates client guidance and registers clients ([installation](../../packaging/INSTALL.md)). Each runtime checks its own setup. Developer verification uses `node scripts/dev-instance.mjs <saam args>` then `stop`: an isolated background home, no tray or browser.

`saam help` lists operations; `saam help OP` supplies schemas. Pass inputs by file, stdin or scalar flags.
`saam start-tour` starts the tour; `saam wait` reads Studio requests/events.
`apply_extension` uses `bundleId`, current `expectedEditRevision` (or strict legacy `expectedRevision`), `extensionId`, `request` and optional `part`; its selected manifest/manual owns request fields.
It shares revisioned edits with text, heat-set and gridfinity; [standard support](../../skills/standard-support/SKILL.md#choose-the-patches) explains editable mesh-roof construction.
`share_bundle` / `import_bundle` use `bundleId` and an absolute `packageFile` ZIP; [portable exchange](../print/README.md) owns editable inputs. Preparation is cancellable until publication; recipients regenerate/review before export.
`saam` is the only agent route, maintenance included: `migrate_bundle`, `get_bundle_instance`/`recover_bundle_instance` after a Studio crash, `repair_stl` and `extension_library`. Home migration, which runs before the Application can, belongs to the installers ([migrate-home](../../packaging/migrate-home.mjs)).
Claude/Codex session IDs identify chats; otherwise retain returned `chatId` and pass `--chat-id ID`, including retries. `--chat-name` sets its label.

[Runtime](runtime.mjs) retains queues and Studio state; edits establish [work and hand-back](../../studio/README.md#carrying-a-maker-request). Saved revisions display throughout work.
Naming an available open bundle selects its window; ambiguous populated windows need a target. An idle owned window is reused before opening another. Chats resume their window; one Studio reserves each bundle. IDs, credentials and addresses restore across restarts; changed runtime code reloads the viewer.
`saam call capture_bundle --bundle-id PART` transfers ownership within a runtime; across runtimes it closes the previous Studio and opens the bundle in the target runtime's reusable window. Capture rejects active edits, imports, generation, construction and export; waiting requests are not active work.
Capture cancels prior unfinished requests and rejects old writes. Studio-first requests survive attachment; a restart reclaims only its own matching dead-process reservation.

Connect says “Mention SAAM in your chat client.” Installed guidance handles attachment. `repair_client_setup` repairs registration; existing clients may need restarting.
The consented release service observes startup from the home lease, operations, Studio/workspace events and installer stages once; offline, only first-run evidence and the latest network issue wait in `tmp/`. `saam diagnostics` waits for sends and returns the last receipt. Connect's Report a bug sends the person's text with its window, print and runtime as one event the relay must acknowledge.
[The service](../../packaging/release-service.mjs) owns consent/redaction; Bundle owns revisions, confirmation and exact-byte delivery.

## Local agent notes

Every role's onboarding returns the complete Markdown at `<SAAM home>/local/LOCAL-AGENT-NOTES.md` with `home`, `path` and `revision`; missing notes have empty text and null revision.
`read_local_agent_notes` refreshes it. `update_local_agent_notes` takes that explicit `home`, `expectedRevision` and replacement `text`; keep entries brief, update in place and remove stale ones.
Atomic updates reject busy/stale writers: read again and combine changes. Preferences belong here, outside client memory and generated guidance; no checkout personal notes are imported automatically. The one machine-readable preference, [phase colours](../print/USAGE.md#phase-colours), is `phase-colours.json` beside the notes.
Checkout development notes remain in `.local/AGENTS.md` and `.local/DEVELOPMENT.md`.

## Client queue monitoring

Claude Code may run `saam wait` in a managed background session for 30 minutes; requests or delivered events end it early. Silence/expiry need no chat message.
Renew during bundle work/tours; let idle monitoring lapse. Lapse preserves attachment, queued work and SAAM. Follow tour participation context and hand back before monitoring.
Codex reads `get_studio_requests` / `get_studio_events` explicitly; `saam wait` defaults to 25 seconds. Automatic wakeup after a chat turn remains unverified.

Bundle switches preserve attachment and original request targets. Carry `studioInstanceId`, intended `bundleId` and originating `requestIds` on the first needed operation,
or `expectedStudio: {studioInstanceId, bundleId}` on any operation (null bundle for an empty Studio). An unchanged association needs no refresh.
A mismatch rejects before attachment, claims or edits with `STUDIO_TARGET_CHANGED` and `currentStudio` (null if closed); resolve the target explicitly.
Hand-back can settle the original `workRequest.id` after a switch; resuming stale work rejects. A Claude Code turn end hands back the chat's active work; in Codex, chat-only answers may stay stale until SAAM interaction.
