# SAAM application

One application per home owns Studios, chats, jobs and release services. [Startup](../../packaging/application.mjs) acquires the OS listener, starts the tray and publishes readiness.
[saam](../../scripts/saam.mjs) starts it when needed. Command exit, chat closure and browser closure leave it running.
Quit and updates warn about jobs; startup/network deadlines report failures without expiring work.

The home is `C:\SAAM` on Windows or `~/SAAM` on macOS: replaceable `app/`, user-owned `local/` and persistent `state/`.
Bundles live in `local/Prints/` and user extensions in `local/extensions/`; last-export setups are in `local/machine-setups/`. Source/installed runs share the home/credential; `SAAM_DATA` isolates another home.
Startup generates home `AGENTS.md`, `CLAUDE.md` and client skills from [AGENTS.md](../../AGENTS.md), resolving home folders/manual links.
[Installation](../../packaging/INSTALL.md) owns migration, client registration and permissions, including absent clients.

`saam help` lists operations; `saam help OP` supplies schemas. Pass inputs by file, stdin or scalar flags.
`saam start-tour` starts the tour; `saam wait` reads Studio requests/events.
`apply_extension` uses `bundleId`, current `expectedEditRevision` (or strict legacy `expectedRevision`), `extensionId`, `request` and optional `part`; its selected manifest/manual owns request fields.
It shares revisioned edits with text, heat-set and gridfinity; [standard support](../../skills/standard-support/SKILL.md#choose-the-patches) explains editable mesh-roof construction.
`share_bundle` / `import_bundle` use `bundleId` and an absolute `packageFile` ZIP; [portable exchange](../print/README.md) owns editable inputs. Preparation is cancellable until publication; recipients regenerate/review before export.
`saam` is the only agent route, maintenance included: `migrate_bundle`, `get_bundle_instance`/`recover_bundle_instance` after a Studio crash, `repair_stl` and `extension_library`.
Before the application can run, the [installer](../../packaging/INSTALL.md) migrates the home.
Claude/Codex session IDs identify chats; otherwise retain returned `chatId` and pass `--chat-id ID`, including retries. `--chat-name` sets its label.

[Runtime](runtime.mjs) retains queues/windows; edits establish [work and hand-back](../../studio/README.md#carrying-a-maker-request). Saved revisions display throughout work.
Naming an available open bundle selects its window; ambiguous populated windows need a target. Empty windows are interchangeable; chats resume windows; one Studio owns each bundle.
`saam call capture_bundle --bundle-id PART` transfers that Studio, preserving reservation/window. Capture rejects active edits, imports, generation, construction and export; waiting requests are not active work.
It cancels the previous chat's unfinished requests and rejects its later writes. Studio-first requests survive initial attachment; elapsed time or missing connection never grants capture.

Connect says “Mention SAAM in your chat client.” Installed guidance handles attachment. `repair_client_setup` repairs registration; existing clients may need restarting.
The consented release service observes operations and Studio/workspace events once; `saam diagnostics` waits for sends and returns the last receipt.
[The service](../../packaging/release-service.mjs) owns consent/redaction; Bundle owns revisions, confirmation and exact-byte delivery.

## Local agent notes

Every role's onboarding returns the complete Markdown at `<SAAM home>/local/LOCAL-AGENT-NOTES.md` with `home`, `path` and `revision`; missing notes have empty text and null revision.
`read_local_agent_notes` refreshes it. `update_local_agent_notes` takes that explicit `home`, `expectedRevision` and replacement `text`; keep entries brief, update in place and remove stale ones.
Atomic updates reject busy/stale writers: read again and combine changes. Preferences belong here, outside client memory and generated guidance; no checkout personal notes are imported automatically.
Checkout development notes remain in `.local/AGENTS.md` and `.local/DEVELOPMENT.md`.

## Client queue monitoring

Claude Code may run `saam wait` in a managed background session for 30 minutes; requests or delivered events end it early. Silence/expiry need no chat message.
Renew during bundle work/tours; let idle monitoring lapse. Lapse preserves attachment, queued work and SAAM. Follow tour participation context and hand back before monitoring.
Codex reads `get_studio_requests` / `get_studio_events` explicitly; `saam wait` defaults to 25 seconds. Automatic wakeup after a chat turn remains unverified.

Bundle switches preserve attachment and original request targets. Carry `studioInstanceId`, intended `bundleId` and originating `requestIds` on the first needed operation,
or `expectedStudio: {studioInstanceId, bundleId}` on any operation (null bundle for an empty Studio). An unchanged association needs no refresh.
A mismatch rejects before attachment, claims or edits with `STUDIO_TARGET_CHANGED` and `currentStudio` (null if closed); resolve the target explicitly.
Hand-back can settle the original `workRequest.id` after a switch; resuming stale work rejects. Chat-only answers may stay stale until SAAM interaction.
