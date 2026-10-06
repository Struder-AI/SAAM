# Deployment and releases

The SAAM home, installation, updates, the relay and diagnostics, packaging and releases. [Index](README.md)

## Desktop agents only
> "Do we need MCP at all? We are explicitly scoped to claude code desktop and codex desktop." — owner, 2026-10-02 (Claude 47e7c07a 20:27)

Summary: people use SAAM through desktop Codex or desktop Claude Code; web-chat operation and its relay machinery are gone.

Sources: [0.3.0](../plans/0.3.0.md); [0.3.2 SAAM application](../plans/0.3.2.md#saam-application-chats-and-folders); owner's guidance prompt 2026-10-02 (web relay listed as a deliberate removal); [D-023](../DECISIONS.md#d-023--future-deployment-local-saam-application-with-a-hosted-relay), [D-024](../DECISIONS.md#d-024--temporary-web-chat-access-to-the-existing-local-workflow), [D-037](../DECISIONS.md#d-037--cloudflare-relay-and-studio-driven-chat-sessions) are history.

## One home folder
> "The thing I dislike most is new folders being created all the time. We can't have that. I don't see the need for registered workspaces. We need a single directory for print bundles, a directory for saam installation, and a directory for local extensions. I would much rather have these all under the same parent directory rather than separated into user folders, document folders, etc, like windows wants you to do, but it's dumb. SAAM doesn't present different faces to different windows users, it's just there." — owner, 2026-10-02 (Claude 47e7c07a 20:35)
>
> "Good, user-authored extensions definitely. … Caches and temporary jobs should be in a folder called tmp that we have solid hygene about." — owner, 2026-10-05 (Codex 01a10903 01:20)
>
> "We aren't renaming any folders" — owner, 2026-10-05 (Claude 764ea5bb 22:13)

Summary: everything SAAM lives under one home (`C:\SAAM` or `~/SAAM`): a replaceable app folder, the person's `local/` (prints, extensions, notes, machine setups) and a `tmp/` folder kept clean; SAAM creates no other folders, and updates preserve user data.

Sources: [0.3.2 SAAM application](../plans/0.3.2.md#saam-application-chats-and-folders) ("No per-chat folders or alternate Prints roots"); [0.3.3 "Local notes and user data" and "Temporary data hygiene"](../plans/0.3.3.md); [0.3.0](../plans/0.3.0.md) (user storage outside the replaceable installation); [packaging/INSTALL](../packaging/INSTALL.md).

## Install by asking an agent
> "This is very sloppy. The alpha tester agents don't know what to do. We want to be able to say "install from [url]" and it works, not download a guide first." — owner, 2026-10-02 (Codex 01a0fe5d 23:02)
>
> "I want saam connector or skill or whatever awareness is needed to be installed into both codex and claude code upon saam install, so that all agents are aware of saam after that, and all the user has to do is mention SAAM in any desktop chat session." — owner, 2026-10-02 (Codex 01a0fe5d 21:33)
>
> "mac user gets a fresh install from telling a codex or claude agent to download and installs SAAM (exact  prompt compatibility: "download and install SAAM 0.3.4 from [url]" )" — owner, 2026-10-05 (Claude 764ea5bb 21:31)

Summary: a person installs SAAM by telling Codex or Claude Code "download and install SAAM [version] from [url]"; installation registers SAAM with both clients so mentioning SAAM is enough afterwards.

Sources: [0.3.2 "Client/UI direction"](../plans/0.3.2.md#saam-application-chats-and-folders); [0.3.4 "Fresh agent install by prompt, then Update"](../plans/0.3.4.md); [0.3.0](../plans/0.3.0.md).

## The installer asks for permission itself
> "the spec discussed was installer pulls up an admin prompt, user confirms -> installed. These hoops were not presented to me when I made the spec request." — owner, 2026-10-05 (Claude 764ea5bb 20:07)
>
> "We really want normies to test this, I think a terminal paste is scary too. It's gotta be a click. OR we exclusively do claude/codex-led install for first time. Then they don't have to do any of that again, for updates, right?" — owner, 2026-10-05 (Claude 764ea5bb 20:18)

Summary: the installer raises the system's own permission prompt only where needed (Windows UAC, the macOS equivalent), keeping registration with the original user; on macOS the first install is a click or is led by Codex or Claude, and updates need nothing more.

Sources: [0.3.3 "Installer-owned permission requests"](../plans/0.3.3.md) (Codex 01a0fe5d 23:27-23:31, Codex 01a102a0 17:20 "make sure this works for both windows and apple stuff"); [0.3.4 "macOS first install is agent-led"](../plans/0.3.4.md); [D-037](../DECISIONS.md#d-037--cloudflare-relay-and-studio-driven-chat-sessions) ("We shouldn't need apple developer for alpha.", 2026-09-25).

## Updates
> "We will have all alpha testers with 0.3.2 update to 0.3.3 immediately upon release, no further 0.3.2 support needed." — owner, 2026-10-05 (Claude 98e25b54 04:02)
>
> "I'm not worried about 0.3.2 still being installed (1), we can have everyone update. But if a similar pattern would still happen between *future* versions, that's not okay." — owner, 2026-10-05 (Claude 98e25b54 14:59)

Summary: updates come from the in-app Update button, testers move to each release, and every future update must install cleanly from the previous one; installing an older release is the rollback.

Sources: [0.3.0](../plans/0.3.0.md); [0.3.4 intro](../plans/0.3.4.md) ("we are going to fast-track 0.3.4 followed immediately by 0.3.5 specifically to verify end to end", Claude 764ea5bb 20:23); [D-037](../DECISIONS.md#d-037--cloudflare-relay-and-studio-driven-chat-sessions) (no rollback machinery).

## SAAM works without the service
Agent wording, no approval found: SAAM works without activation; an invite enables only official updates and live diagnostics; missing codes or service failure never disable making, viewing or exporting.

Sources: [0.3.0](../plans/0.3.0.md); [0.3.2 "Updates-and-diagnostics attachment"](../plans/0.3.2.md#installed-031-tour-bugs).

## Diagnostics go live to the relay
> "The important thing is that alpha testers and contributers are using the version connected to the relay, so we can capture diagnostics." — owner, 2026-10-02 (Codex 01a0fe17 19:28)
>
> "FIrst-run could warrant a log, I admit. Pushing it on first relay connect is a great idea. We may also log up to one (most recent) network-related issue, and push that too on next connect. Everything else should be live to the relay, or not at all" — owner, 2026-10-05 (Codex 01a10903 01:34)
>
> "Yes, I explicitly requested an install log that sends to relay, wtf" — owner, 2026-10-05 (Claude 764ea5bb 20:31)

Summary: diagnostics go live to the relay through the consented connection; locally SAAM keeps only first-run evidence (including the installer's log) and the latest network problem, pushed on the next connection; every startup failure is received.

Sources: [0.3.3 "Relay diagnostics and local retention"](../plans/0.3.3.md); [0.3.4 installer-log and startup-failure rows](../plans/0.3.4.md); [D-039](../DECISIONS.md#d-039--alpha-relay-records) ("the first focus should be to capture as much as we can from the relay itself", 2026-09-27); Codex 01a10903 01:20 ("I'm not convinced why logs and connection records need to exist").

## Source checkouts report to the relay
> "Yes, but I don't want to have to generate a separate invite code for the source checkout, OK? The main risk is that tkeller will not be able to keep it straight, and not realize he's working on a source checkout, and think he's encountering issues, and I need to be able to look at the relay to understand what is actually happening. I do NOT necessarily need full reporting requirement for everything on source checkout, just enough to sort out any of that type of confusion, OK?" — owner, 2026-10-05 (Claude c6c50c08 18:05)

Summary: a source runtime reports enough to the home's relay connection, named by checkout and commit, to show when someone is running a checkout, without a separate invite.

Sources: [0.3.3 "One SAAM orchestrator per OS"](../plans/0.3.3.md); Claude c6c50c08 17:22 ("Do source checkout runtimes not connect to relay? That's a problem if so.").

## Releases
> "Aren't there three builds? There were before. Why/why not?" / "No no no - we push to remettub-dev-branch" / "And change the update service offer version once everything is up." — owner, 2026-10-01 (Codex 01a0f8f8 23:49-23:51)
>
> "We don't care about second windows user. We need all three release packages published, we don't have a mac available, so will test on mac after release." — owner, 2026-10-02 (Codex 01a0fe8b 21:45)
>
> "9. Rebase and include in 0.3.3, we always test on mac after release, until further notice, then just immediately patch with 0.3.4 if we must." — owner, 2026-10-05 (Claude 98e25b54 04:10, queued)

Summary: each release publishes Windows x64, Apple Silicon and Intel Mac packages from `remettub-dev-branch`; the update offer changes only once everything is up; Mac is tested after release and patched at once if needed.

Sources: [0.3.2 "Publication scope"](../plans/0.3.2.md#saam-application-chats-and-folders); Codex 01a0f8f8 20:17 ("We require mac packaging tkeller can run for 0.3.1 readiness, but he tests it after release."); [packaging](../packaging/README.md).

## Release scope
> "We put anything that is ready into 0.3.4 and 0.3.5" — owner, 2026-10-05 (Claude 764ea5bb 20:25, queued)
>
> "No longer completely bug fix scope - bug fix primary but we can also add value" — owner, 2026-10-02 (Codex 01a0fa1c 04:49)

Summary: a release takes whatever approved work is ready; a bug-fix release can still carry selected value work.

Sources: [0.3.2 intro](../plans/0.3.2.md); [0.3.4 intro](../plans/0.3.4.md); [0.3.6 "Approved 0.3.4/0.3.5 rows"](../plans/0.3.6.md).

## The public website
> "Include instruction to reduce gratuitous chatter around the page. It's too immediately obvious that this is claude or codex, with the decorative text vibe, if you know what I mean." — owner, 2026-10-01 (Codex 01a0f8f8 20:07)
>
> "what do you mean "public website alignment"? That resource is not ours to maintain" / "public website alignment handoff is premature" — owner, 2026-10-02 (Codex 01a0fdfa 19:21-19:22)
>
> "Check out Struder.com/saam, we are in charge of sending notes to the webmaster. They don't have detailed technical knowledge or many user test result, we just want to make sure they know how to best represent us" — owner, 2026-10-06 (Claude 0778893a 02:52)

Summary: the webmaster maintains struder.com/saam; SAAM's team sends them notes so the site represents SAAM accurately, in plain copy without decorative chatter. The 10-06 message replaces "premature".

Sources: [0.3.1 webmaster request](../plans/0.3.1-webmaster-request.md); [0.3.2 "Website handoff — deferred"](../plans/0.3.2.md#inherited-unfinished-intent); [0.3.1 discussion items](../plans/0.3.1-discussion.md) (release language: alpha tester release).
