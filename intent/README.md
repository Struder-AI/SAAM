# SAAM intent tree

What the owner wants SAAM to be, by area, in the owner's own words. Owner, 2026-10-06: "I want an intent tree. The versioned intent docs essentially define the spec unless something overrides it."

## How to read it

Each leaf is one current intent:

1. **Owner's words**, quoted exactly, with date and source.
2. **Summary**: one plain sentence, written by an agent. Where no owner words exist, the leaf says "agent wording, approved DATE" (the owner's own answer to that item exists), "agent wording, no specific owner agreement found" (only a stamp such as "owner confirmed" on a summary the owner read), or "agent wording, no approval found".
3. **Sources**: every plan row, decision entry or chat message that contributed.

"Owner question pending" marks a leaf whose sources conflict, or whose recorded wording may carry an agent's addition. Both statements are quoted and nothing is settled until the owner answers.

The tree holds intent only. Status, evidence and scheduling stay in the [release plans](../plans/) and [DEVLOG](../DEVLOG.md). Mechanism appears only where the owner asked for it.

**Resolution rule** (owner, 2026-10-06): the versioned plans define the spec cumulatively, read in order 0.2.0, 0.3.0, 0.3.1, 0.3.2 … 0.3.6, then 0.4.0 and 0.5.0 (future intent, labelled with their version). A later statement overrides an earlier one only where they actually conflict.

**Forward intent** (owner, 2026-10-06: "Did we not also institute forward intent reading? That's a part of the tree everyone should know about too."): future versions' intent (0.4.0, 0.5.0) is read too, so work done now does not contradict or block what is already planned. [DECISIONS](../DECISIONS.md) is history but holds many exact owner quotes.

**Source notation.** Plan rows are named by file and row title. Chat sources are `Claude <id>` (Claude Code session, first 8 characters) or `Codex <id>` (Codex session), with the transcript's UTC time; plan dates are Pacific, so "owner, 2026-10-04" in a plan can be a 10-05 UTC message. `queued` marks a message typed while the agent was mid-turn.

## Index

| Area | What it covers |
|---|---|
| [Maker context](maker-context.md) | Guidance, manuals, onboarding and the tour as the agent reads them |
| [Geometry](geometry.md) | Authoring, meshes, blob fields, Booleans, offsets, import and repair |
| [Toolpath](toolpath.md) | SAAMpath, Inject/Trace/Slice, supports, vase, modulation, ordering |
| [Extensions](extensions.md) | Skills and extensions, local copies, example recipes, "use SAAM, else an extension" |
| [Bundle](bundle.md) | Part state, revisions, saved work, export history |
| [Studio](studio.md) | The viewer, windows, dimming, export button, colours, Connect pane, tour |
| [Workspace](workspace.md) | Specialized workspaces such as Wing |
| [Export and machines](export-and-machines.md) | Machine adapters, output, printer facts, checks |
| [Settings](settings.md) | Machine/material profiles, remembered setups, local preferences |
| [Application](application.md) | The tray orchestrator, runtimes, the one `saam` route, chats |
| [Deployment and releases](deployment.md) | Home folder, installer, update, relay and diagnostics, packaging, releases |
| [Development](development.md) | Dev maps, dev tools, how agents work with the owner |
| [Principles](principles.md) | Code shape, complexity, tolerances, limits and checks, rules |

## Cross-cutting principles

### Who SAAM is for
> "a non-technical person should be able to point their agent at the repo" — owner, 2026-09-08 ([D-004](../DECISIONS.md#d-004--preserve-the-mission-and-serve-non-technical-users))
>
> "We really want normies to test this, I think a terminal paste is scary too. It's gotta be a click." — owner, 2026-10-05 (Claude 764ea5bb 20:18)

Summary: SAAM lowers the barrier to 3D printing; a non-technical person works through their agent, and nothing in first use should feel technical or scary.

Sources: [D-004](../DECISIONS.md#d-004--preserve-the-mission-and-serve-non-technical-users); [D-005](../DECISIONS.md#d-005--build-an-ecosystem-of-slicer-components) ("We ARE building a slicer, or rather, we are building an ecosystem of slicer components."); Claude 764ea5bb 20:18.

### Recording intent
> "Rubber stamp confirmation systems don't work. Recording specific segments of my actual words seems good. Marking agent-determined aspects of the intent seems good. Agents shouldn't always assume that I agree with anything you've sent to me, just because I've read it." — owner, 2026-10-06 (Claude 3594b461)
>
> "An agent reacting to a complaint writes guidance or proposes a rule. It becomes hard only with your wording or approval" — agent wording the owner answered "YES keep this, it's great", 2026-10-04 (Claude ec6035d1 05:53)

Summary: intent is recorded as the owner's own words, with anything an agent determined marked as agent wording; reading a summary is not agreeing to it, and only the owner's wording or specific approval makes a hard rule.

Sources: Claude 3594b461 (2026-10-06); `.local/AGENTS.md` "Agreement is explicit"; Claude ec6035d1 05:53; [DEVELOPER-CONTEXT rules 1, 6, 8](../DEVELOPER-CONTEXT.md#rules).

### Positive intent, one owner
> "My general philosophy is "Bans go stale; positive statements of intent don't."" — owner, 2026-10-04 (Claude 28ca77c4 16:30)
>
> "9. This seems bad, what if we change our mind again? Obviously a reactive application, since we keep bringing ghosts back to life, despite having a decisions doc (right?). But can you think of a structural solution to replace this?" — owner, 2026-10-04 (Claude ec6035d1 05:37)

Summary: state what SAAM does, at one owner; a ban has to be remembered and revoked, while a statement of current intent stays true until edited.

Sources: Claude 28ca77c4 16:30; Claude ec6035d1 05:37; [DEVELOPER-CONTEXT "Intent and rules"](../DEVELOPER-CONTEXT.md#intent-and-rules) (agent wording from that review).

### Complexity reduction
See [Principles](principles.md#complexity-reduction-and-special-cases): special cases are a red flag, and SAAM is pulled toward a few deep, general operations. It applies to every area.
