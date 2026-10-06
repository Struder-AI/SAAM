# Application

The SAAM application: the tray orchestrator, runtimes, the single `saam` route, chats and their attachment. [Index](README.md)

## One orchestrator in the tray
> "0.3.3 should lock to one instance of the SAAM orchestrator, as seen from system tray, per OS. It coordinates multiple runtimes (this is probably a change), saam studio windows, etc." — owner, 2026-10-05 (Claude 98e25b54 03:53)
>
> "Okay I like that we can (presumably) have an icon in the system tray, and exit SAAM from there, rather than relying on ephemiral chat window or browser windows to exit." — owner, 2026-10-02 (Claude 47e7c07a 20:27)
>
> "only one orchestrator per home ever runs" — agent clause added to the owner's second-launch quotes ([0.3.4 "Second launch brings Studio forward"](../plans/0.3.4.md))

Summary: one SAAM orchestrator runs, shown as the only tray icon, and coordinates every runtime and Studio window; Quit lives in the tray. **Owner question pending**: "per OS" (owner) or "per home" (agent clause, and how the lock is built).

Sources: [0.3.3 "One SAAM orchestrator per OS"](../plans/0.3.3.md); [0.3.2 SAAM application](../plans/0.3.2.md#saam-application-chats-and-folders); Claude 764ea5bb 21:00 ("Pretty sure I just saw two in the system tray just now"); Claude c6c50c08 18:13 ("It needs to be in the tray").

## Everyone uses the installed release, on one home
> "Installed release is supposed to be what everyone uses, even if you also have a source checkout on your system." — owner, 2026-10-05 (Claude 98e25b54 04:02)
>
> "Yes use real home and prints even if you have a source checkout. One place for SAAM things, or people will get confused." — owner, 2026-10-05 (Claude 98e25b54 04:09)
>
> "Deployment - agree, ordinary making should use the **installed release** whether the person starts in Studio or in Codex/Claude. A builder can author user-local extensions against installed public interfaces. Changing shipped guidance needs *developer role* which needs a local checkout. A checkout's working directory must not silently override a newer installation." — owner, 2026-10-02 (Codex 01a0fa1c 05:24)

Summary: the installed release is the orchestrator everyone uses; a source checkout an agent selects runs as another runtime on the same home and prints, and never silently replaces the installation.

Sources: [0.3.3 "One SAAM orchestrator per OS"](../plans/0.3.3.md); [0.3.2 deployment direction](../plans/0.3.2.md); Codex 01a0f9f1 00:10 ("Okay, so you don't know to use the installed release version."); `.local/AGENTS.md` ("Ordinary maker work uses the installed release").

## Runtimes
> "Don't quietly move it over. SAAM should refuse as described." — owner, 2026-10-05 (Claude 98e25b54 15:12, queued)
>
> "So what? Can't we just open that print on the new source runtime again? … what we need is for every agent looking at that bundle to understand which runtime to use for it, correct?" — owner, 2026-10-05 (Claude 98e25b54 14:59)
>
> "This is terrible. What? Why would we restart a runtime on every file change?" — owner, 2026-10-05 (Claude 98e25b54 14:59)
>
> "Confirmed, developer agents should know to use scratch bundles to test their runtime, or bundles that are being worked on concurrently in the same session as the runtime work (the most likely case). I just don't think we need to *do* anything about this" — owner, 2026-10-05 (Claude 98e25b54 15:17)

Summary: each print records the runtime that last worked on it; another runtime's agent is refused with the owning runtime named, and moving a print is explicit; a source runtime keeps its code until a developer reloads it. The rest of the 0.3.3 "runtime model" (results name the runtime, Studio opens a print on its own runtime, two-way compatibility checks, Quit and Update list jobs by runtime) is agent wording, no specific owner agreement found: the owner answered the summary "Great, I think that all works, right?" (15:09), and the same summary's "source runtimes send no relay diagnostics" was later reversed.

Sources: [0.3.3 "One SAAM orchestrator per OS"](../plans/0.3.3.md) ("Runtime model confirmed by the owner"); Claude 98e25b54 14:59-15:17; [Deployment](deployment.md#source-checkouts-report-to-the-relay).

## One route through Application
> "Clearly there should be no duplicate routes, the question is which one to choose." — owner, 2026-10-05 (Claude 28ca77c4 01:30)
>
> "Well I think that resolves it then, if the non-application route can't get to studio, it shouldn't exist. Everything should be through application." — owner, 2026-10-05 (Claude 28ca77c4 01:38)
>
> "I don't want to deny the agents a diagnostic that has no corresponding studio display, that class of tool is fine, but the agent toolkit should face them as one unified interface, and anything that *does* have a natural or existing studio display should display." — owner, 2026-10-05 (Claude 28ca77c4 02:15)

Summary: agents reach SAAM only through `saam`, one unified toolkit through Application, maintenance included; diagnostics without a Studio display stay available there, and anything with a natural Studio display shows in Studio.

Sources: [0.3.3 "One route: everything through Application"](../plans/0.3.3.md); [0.3.2 SAAM application](../plans/0.3.2.md#saam-application-chats-and-folders) (replaces MCP: "Do we need MCP at all? We are explicitly scoped to claude code desktop and codex desktop.", Claude 47e7c07a 20:27); Claude 28ca77c4 02:03 ("make all buttons that the agent presses look similar and work in a similar way").

## Starting a chat with SAAM
> "we want a straightforward robust model with maybe two initialization variants (but everything else the same): #1 saam studio is opened first, then a launcher button opens a codex or claude code chat and automatically connects to the opened instance. OR #2 the desktop AI client is opened first, user requests saam from the chat, and that chat session opens a saam instance and pairs with it." — owner, 2026-10-02 (Claude 7587d307 19:16; Codex 01a0fe17 19:28)
>
> "correction: decision is to REmove both launch buttons" — owner, 2026-10-05 (Codex 01a10903 01:05)

Summary: one lifecycle for instances and chats; a person mentions SAAM in any Codex or Claude Code chat and that chat opens or joins a Studio (the Studio-first launch buttons were removed on 10-05).

Sources: [0.3.2 SAAM application](../plans/0.3.2.md#saam-application-chats-and-folders); [0.3.3 "Studio chat entry"](../plans/0.3.3.md); Codex 01a0fb05 05:39 ("Different entry points - sounds like like unnecessarily complexity").

## Attachment and capture
> "if a new chat calls saam and references a print bundle, and that bundle is available and open (we retain the rule that a bundle can only be worked on by one instance at a time), we connect to the open session. If the studio window has no bundle attached yet, then it doesn't matter who gets what." — owner, 2026-10-02 (Codex 01a0fe5d 20:54)
>
> "However there SHOULD be a way for a new chat to capture a bundle and start working on it, even if open in an existing studio window, but not being actively worked on by the old chat anymore." — owner, 2026-10-02 (Codex 01a0fe5d 20:58)

Summary: a chat naming an open bundle joins its Studio; a new chat can explicitly take over an idle bundle, and the old chat's later writes are refused; stale work is rejected inside the first SAAM operation, never silently retargeted.

Sources: [0.3.2 "Attachment"](../plans/0.3.2.md#saam-application-chats-and-folders); [0.3.3 "Client-specific queue monitoring"](../plans/0.3.3.md) (owner: "Yeah but that'll add delay." / "Yes, that works", Codex 01a0fec9 23:12-23:13).

## Claude Code queue monitor
> "it seems that claude code can use a (30 minute) monitor that handles our saam->agent message queue. But the agents shouldn't necessarily expect anything to come through it. Claude can renew the monitor when it expires if work on that bundle is ongoing, or not renew it if the session appears idle." — owner, 2026-10-02 (Codex 01a0fec9 23:08)

Summary: Claude Code listens to SAAM through a 30-minute monitor that may stay silent, renewing it while bundle work continues.

Sources: [0.3.3 "Client-specific queue monitoring"](../plans/0.3.3.md).

## The tray menu
> "I would like a right-click on the system tray icon to show all saam runtimes and be able to select them and that will open a browser window showing that runtime." / "I would like the system tray to NOT say upgrade unless the service is paired and an update is available" / "I would like the system tray to always have a new instance option … The new instance would not be attached to a chat" — owner, 2026-10-02 (Codex 01a0fec9 22:52-22:56)
>
> "I don't like how I have to go through 3 submenus on the system tray menu to see the instances. Can you make it work so they are all on the first menu, no submenus whatsoever?" — owner, 2026-10-06 (Claude 14d40329 17:19)

Summary: the tray's first menu lists every runtime/instance directly, always offers New Instance (unattached), shows Update only when paired and an update exists, and offers Quit.

Sources: [0.3.3 tray rows](../plans/0.3.3.md); [0.3.6 "Tray instances on the first menu"](../plans/0.3.6.md); Codex 01a102a0 17:21 (green light).

## Launching again brings Studio forward
> "If I double click saam but it's already running, no duplicate, but also doesn't bring the existing window to the fore, make sure it does for 0.3.4" — owner, 2026-10-05 (Claude 764ea5bb 21:03)
>
> "second double click goes to whatever studio window, whatever runtime is most recent, and starts those if none is active" — owner, 2026-10-05 (Claude 764ea5bb 21:19)

Summary: launching SAAM while it runs brings the most recent Studio window forward, or starts one, without duplicates; focus changes only in answer to the person's own launch.

Sources: [0.3.4 "Second launch brings Studio forward"](../plans/0.3.4.md); Claude 764ea5bb 21:18 ("Second launch isn't allowed, wtf"), 22:01 ("fine").

## Waiting without arbitrary timeouts
> "Keep the 35s limit." — owner, 2026-10-06 (Claude 14d40329 03:38), on `saam` control commands
>
> "I already approved update no time limit, wtf." — owner, 2026-10-06 (Claude 14d40329 05:08)

Summary: `saam` control commands keep their 35-second limit; tray opens and update wait for the orchestrator without a limit and report failures when they fail.

Sources: [0.3.5 "Tray open without a fixed timeout"](../plans/0.3.5.md); `.local/team/questions-036.md` 3 and 19 (19 still says "owner yes pending"); Claude 14d40329 03:40, 03:43 (status must always answer promptly).

## Bug reports
> "If saam can do it, use saam. If it can't, build an extension that can. … if you have to build outside of extensions that's a bug for us, please file a bug report! (I like that last part - put a cli command that goes to relay for this)" — owner, 2026-10-06 (Claude 14d40329 03:02)
>
> "Report bug can be an empty field. You always overbuild everything." — owner, 2026-10-06 (Claude 14d40329 05:08)

Summary: agents file bug reports with a `saam` command that goes to the relay, with optional text; the person can also send one from Studio.

Sources: [0.3.4 "Bug report button"](../plans/0.3.4.md) ("We also need bug report button for 0.3.4.", Claude 764ea5bb 20:23); [0.3.6 "Use SAAM, else an extension"](../plans/0.3.6.md); Claude 14d40329 18:23; Claude 764ea5bb 21:00 ("1000 is enough for bug report.").
