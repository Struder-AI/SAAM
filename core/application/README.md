# SAAM application

One application per SAAM home owns Studios, chats, jobs and release services.
[Startup](../../packaging/application.mjs) acquires an OS loopback listener,
starts the tray, then publishes its control record. [saam](../../scripts/saam.mjs)
starts it when necessary and sends commands; command exit, chat closure and
browser closure never stop the app. Quit and updates warn about running jobs.
Startup and network waits report bounded failures; they do not expire work.

The home is `C:\SAAM` on Windows or `~/SAAM` on macOS: replaceable `app/`,
`Prints/`, `extensions/` and persistent `state/`. Source runs use the same home
and credential. `SAAM_DATA` selects a disposable home for installation trials.
At each start the home's `AGENTS.md`, `CLAUDE.md` and the clients' `saam` skill
are regenerated from the program's [AGENTS.md](../../AGENTS.md), with the home's
folders and links into the program's manuals.
[Installation](../../packaging/INSTALL.md) owns migration and client setup.

`saam help` lists operations; `saam help OP` returns their complete schemas.
Use `saam call OP --input FILE`, `--stdin`, or scalar flags. `saam start-tour` starts the tour; `saam wait` returns Studio requests/events.
`apply_extension` takes `bundleId`, `expectedEditRevision` from current `editRevision`, `extensionId`, `request` and optional `part`; strict legacy `expectedRevision` remains accepted. Its selected manifest/manual owns request fields.
It shares the revisioned geometry/deposition edit with `apply_text`, `apply_heat_set` and gridfinity updates; read [standard support](../../skills/standard-support/SKILL.md) for mesh-roof construction. Saved ordinary results remain editable.
`share_bundle` and `import_bundle` take `bundleId` and an absolute `packageFile` ZIP path; [portable exchange](../print/README.md) carries editable inputs. Worker preparation is cancellable until publication; recipients regenerate and review before export.
The environment's Claude or Codex session ID identifies a chat. Otherwise retain returned `chatId` and pass `--chat-id ID` on later commands, including retries. `--chat-name NAME` supplies the Studio label.

[Runtime](runtime.mjs) retains each chat's queues and windows. Edits establish
[work context and hand-back](../../studio/README.md#carrying-a-maker-request);
saved revisions display throughout the work. Naming an available open bundle
selects its window; ambiguous populated windows require a target. Empty windows
are interchangeable. A chat resumes its windows; there is one Studio per bundle.

`saam call capture_bundle --bundle-id PART` explicitly transfers its existing
Studio, preserving the reservation and window. Capture rejects active edits,
imports, generation, construction and export. Waiting requests are not active
work. The previous chat's unfinished requests are cancelled and its later
writes rejected. Studio-first requests survive initial attachment. No elapsed
time or missing chat connection grants capture.

Connect launches supported desktop clients and refreshes SAAM registration;
the agent can call `repair_client_setup` when setup needs repair. Installation
registers the skill and command permissions in both clients, including absent
clients for later discovery. Existing clients may need restarting. Claude Code
below 2.1.285 can connect from an existing chat with `saam call maker_onboarding`;
that minimum applies only to Studio launch. Codex Desktop has no established
minimum version gate. Both launches require the user's first Send. Claude's
background wait can resume its agent; equivalent Codex wakeup is unverified.

The app attaches the consented release service once to all runtime operations
and Studio/workspace events. `saam diagnostics` waits for outstanding sends and
returns the latest acknowledged receipt. Consent and redaction are owned by
[the service](../../packaging/release-service.mjs). Bundle revisions,
confirmation and checked-byte delivery remain owned by the print lifecycle.
