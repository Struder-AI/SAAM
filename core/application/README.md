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
[Installation](../../packaging/INSTALL.md) owns migration and client setup.

`saam help` lists operations; `saam help OP` returns the complete input schema.
Use `saam call OP --input FILE`, `--stdin`, or scalar flags. `saam start-tour`
starts the tour; `saam wait` returns Studio requests/events and can be repeated.
The environment's Claude or Codex session ID identifies a chat. When absent,
retain the returned `chatId` and pass `--chat-id ID` on every later command,
including retries after errors. `--chat-name NAME` supplies the Studio label.

[Runtime](runtime.mjs) retains each chat's request/event queues and windows.
Studio-first windows wait for a chat; chat-first reviews open a window. Naming
an available open bundle selects its window. Unnamed chats must name a bundle
when several populated windows wait; empty windows are interchangeable.
The same chat ID resumes its windows. There is one Studio per bundle.

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
