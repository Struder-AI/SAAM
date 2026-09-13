# SAAM Studio

Launch and client access, instance ownership, review interaction and opening saved
prints. Rendering and playback implementation live in [RENDERING](RENDERING.md).
The [shared lifecycle](../core/print/README.md) owns bundle validity and approval state;
[MAKERS](../MAKERS.md) owns the interaction with the person making a part.

[Machine presentation integration](KINEMATICS.md) specifies the planned complete
ghost/Machine-view upgrade and its boundary with incrementally built kinematic
models. It is an implementation contract, not a claim of current UI support.

## Studio agent permissions

The checkout includes [Codex rules](../.codex/rules/studio.rules) and
[Claude Code settings](../.claude/settings.json) for the same direct launcher:

```sh
node studio/server.mjs Prints/my-part
```

Run from the repository root, quote a print path containing spaces, and keep
`node studio/server.mjs` literal. The bare command opens the existing default
demo bundle. Use the client's managed terminal/background session so it can
retain the process handle. The human-facing `npm run studio` alias still works,
but the shared permission targets the direct command. Shell wrappers, different
script spellings, inline Node code and custom development launchers are outside
this rule. Do not replace it with a blanket Node, PowerShell, process-kill or
all-command allowance.

First-use setup is part of the agent's work; the user need not ask for it:

1. **Codex:** have the person trust this checkout through Codex's project trust
   flow. The [project config](../.codex/config.toml) carries no general permission
   overrides. Trusted project rules load at startup, so restart Codex after
   adding or updating them. If a running session has not loaded the rule and a
   launch needs escalation, request the specific launcher permission through
   the client, offering the `node studio/server.mjs` prefix when supported.
   Do not silently install a global rule. See
   [Codex rules](https://learn.chatgpt.com/docs/agent-configuration/rules).
2. **Claude Code:** have the person accept the workspace trust prompt. Shared
   `permissions.allow` entries cover the direct launcher in Bash and PowerShell;
   `sandbox.excludedCommands` runs that Bash launcher outside the sandbox so
   local listening does not need a separate sandbox exception each time.
   Restart the client after updating this setup. Use `/permissions` to inspect
   the loaded rules if a prompt persists. Personal overrides belong in ignored
   `.claude/settings.local.json`. See
   [Claude Code settings](https://code.claude.com/docs/en/settings),
   [permission rules](https://code.claude.com/docs/en/permissions), and
   [sandboxing](https://code.claude.com/docs/en/sandboxing).
3. **Browser:** open the printed `http://127.0.0.1:<port>` URL using the client's
   browser integration. Use its site permission flow if needed; keep any request
   scoped to Studio. Codex manages allowed sites in Settings > Browser; see
   [browser permissions](https://learn.chatgpt.com/docs/browser). Claude browser
   integrations have their own setup and permissions. These command rules do
   not preauthorize browser tools. Persistence across Studio's different ports
   is client-dependent and has not been verified; do not promise exactly one
   prompt. Claude Desktop/web MCP connections also retain their separate
   [connection setup](../adapters/mcp/README.md); Claude Code settings do not configure them.

During work, inspect geometry, source and playback and use camera/view controls
without another conversational permission question. Keep each instance's print,
URL and terminal handle together. To finish or restart it, close that instance's
viewer tabs; after 30 minutes without a viewer its server exits. To stop it
immediately, stop only its recorded terminal task or send Ctrl+C through that
session. For a server
with no viewer connection yet, or a stuck server, stop only its recorded terminal task
or send Ctrl+C through that session. A client's stop-tool permission can still
apply. Do not scan for and kill all Node processes. Leave a viewer open while
the person is expected to review it. Existing manufacturing approvals still
belong to the person.

These allowances trust the launcher and its imported repository code; they are
command matches, not an OS boundary restricting the process to previews or the
print argument to `Prints/`. They do not pin a code hash or a working directory.
Keep the rules in the trusted project and use the repository root as instructed.
More restrictive client or administrator policies can still block or prompt.
No global approval mode or full-access setting is changed.

To check Codex matching without launching Studio:

```sh
codex execpolicy check --rules .codex/rules/studio.rules -- node studio/server.mjs Prints/my-part
codex execpolicy check --rules .codex/rules/studio.rules -- node --eval 1
```

The first must report an allow match; the second must have no matching rule.
The rule file also includes positive and negative examples validated on load.

## Studio feature references

Implement the [maker interaction flow](../MAKERS.md#maker-interaction-flow): geometry
review and its revision loop, settings review and its revision loop, then
toolpath review followed by confirm and export. Keep the interface concise and
accessible. Use chat for all recipe adjustments; expose camera, playback speed,
scrubbing and travel visibility as viewer controls. Layer height means deposited
layer thickness; the old "horizontal body" label referred to the flat-layer
portion of the wedge, not a separate height setting.

The agent applies patches with the owning package's `adjust` command - the wedge
CLI for a wedge, `core/print/cli.mjs` for a shell print. Studio polls a bundle
fingerprint and reloads changed data automatically, keeping the view when nothing
changes and returning to the affected approval step after edits.
Geometry edits invalidate all three approvals; settings edits preserve geometry
approval and invalidate settings/toolpath approval. A server running old imported
code must be restarted after runtime changes. Each agent owns its Studio instances;
do not adopt another agent's viewer or terminate another agent's process. Independent
CLI launches and separate local MCP adapter processes use separate free loopback
ports. Identify the current work's print and URL before restarting its viewer.
Check the loaded geometry and export afterward.

If generation reports "The prepared print changed. Reload before generating."
after source changes, a browser refresh alone may leave an older server runtime
active while a new preparation worker imports current code. Restart the owning
Studio server, reconnect its viewer and check the fresh state. Geometry approval
can remain valid when geometry is unchanged; settings approval is also bound to
the generator runtime and may require the person to confirm settings again.
Do not rewrite approval hashes to make an old approval match new code.

Studio tracks open pages through authenticated persistent viewer connections,
independent of revision polling and background-tab timer throttling. There is no
deadline to open the first viewer, for either CLI or MCP launches. Once opened,
Studio closes 30 minutes after its last viewer disconnects, allowing task switches,
browser suspension and refreshes to reconnect. Each reconnection cancels the
pending shutdown; the next final disconnect starts a fresh 30-minute grace period.
Connected viewers have no idle deadline. An accepted bundle write finishes before shutdown
completes. Saved bundles are retained and can be opened in a fresh instance later.
The old `--close-when-idle` flag is accepted but no longer needed. The CLI process
exits when its work drains. In MCP, only that Studio listener and session are
released; the adapter and its other viewers stay available. Repeated
review requests within the same adapter can use that print's still-open session.
The temporary web-chat bridge shares one adapter across clients; it does not
provide per-agent identity or locking. Independent agent ownership requires
separate adapters. Distinct instances do not lock a shared bundle against edits
from another process, so concurrent agent work should use separate bundles.

### Historical toolpath inspection

For an explicitly requested historical toolpath inspection, a local scratch
launcher may pass `resolveBundle` to `createStudio`. The resolver supplies a
scratch adapter over `createBundleWorkflow`; Studio keeps its existing source
playback, print picker and lifecycle. The default CLI and known adapters are
unchanged. This is explicit development injection, not automatic discovery or
permission to load module paths from a print. Record the original revision and
settings, distinguish historical stroke geometry from modern export assumptions,
and verify the interpreted deposition against the source generator.
An adapter's optional `inspection` presentation supplies a title, description,
facts/settings rows and note for a development tour. Studio then exposes settings
for reading and hides its approval button; the scratch adapter must independently
reject approval and delivery. This presentation does not grant production rights.

### Remembered printer setup

The [shared print-tool manual](../core/print/USAGE.md#remember-machine-setup) owns
setup persistence and reuse; [machine contracts](../core/export/README.md) own
installation requirements. Studio displays the proposed setup with its assumption
and verification metadata for the current job's settings review.

### Geometry and program views

The wedge viewer provides click-to-select faces and matching feature buttons.
Features identify the geometry version and native object UUID or mesh face identity. Geometry edits
recreate those identifiers and invalidate geometry, plan and toolpath approvals.
Generic edge/object selection and freeform geometry editing remain deferred.

For toolpath review, the interpreter must support the selected export language
and required machine state. Unsupported commands, missing helper files, or
incompatible setup must be resolved before production review. The S5 subset
interpreter checks the actual export and rejects unsupported commands. Griffin
firmware startup is external and its internal motions are not simulated. The S5
wedge export does not issue G280 or run a bed-leveling routine. An unknown installed firmware version does not block review;
the standard profile assumption is shown with the settings. Development preview
creates no approvals and cannot authorize delivery.
A path display alone cannot establish arbitrary machine-program behavior.

## Opening local prints in Studio

**Open print** lists saved bundles below `Prints/` (up to three directory levels).
It also accepts a local bundle folder, `plan.json`, or an export/delivery file
inside the bundle. It opens the owning bundle through the same adapter and
integrity checks; standalone machine-program import is not implemented.
Selecting another bundle updates this Studio server's active print, including
other tabs attached to that server. The client sends the current print identity
with mutations, so an old tab cannot approve, generate or deliver the new print.

Opening does not regenerate stored files or write approvals. Unchanged approvals
retain their existing version binding: geometry-only confirmation resumes at
settings, and a current export opens directly in the toolpath viewer. A development
export can be viewed but cannot authorize delivery. A stale or edited program
stays unavailable for approval. Failed opening retains the previous print.

An accessible, animated busy banner covers initial loading, reopening, changed
bundle validation, toolpath/export generation and delivery. It remains visible
through checks and playback loading, disables duplicate actions, and clears on
success or error. Settings confirmation says saving/preparing/checking the toolpath; it does not expose the internal export step. After a successful download, that exact print/export shows "Export again" for the current page session, including after switching away and reopening it. Animation respects reduced-motion preferences. It represents
indeterminate work, not a fabricated percentage or hardware status.
