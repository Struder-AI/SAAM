# MCP access to local SAAM

This stdio adapter lets an MCP client use SAAM's existing shell/wedge bundles
and SAAM Studio. It has no compiler, private review bridge, model calls, or
hardware connection. Machine outputs and skill compatibility remain governed
by the shared plan, generation and interpreter checks.

For ChatGPT and Claude web chats, use the [temporary web-chat connection](#temporary-web-chat-connection).
The same tools run locally through an OAuth-protected HTTP bridge and HTTPS
tunnel. No desktop application package is required.

Install the root dependencies with `npm ci` using Node.js 22+, then launch:

```sh
node adapters/mcp/src/server.mjs
```

For an MCP desktop client, add this entry to that client's local configuration,
substituting the actual absolute repository path:

```json
{
  "mcpServers": {
    "saam": {
      "command": "node",
      "args": ["C:/CodeProjects/SAAM/adapters/mcp/src/server.mjs"],
      "env": { "SAAM_PRINTS_ROOT": "C:/CodeProjects/SAAM/Prints" }
    }
  }
}
```

No client settings are installed automatically. All protocol output uses stdout;
launch errors use stderr. The repository is resolved relative to the adapter,
so the client's working directory does not matter. Direct `node` launch avoids
npm's script banner on the protocol stream. SDK and schema packages are pinned
in the root lockfile.

`SAAM_PRINTS_ROOT` defaults to the repository's ignored `Prints/` directory.
Every call selects a persistent `printId` relative to that root. Up to three
folder levels match Studio's library, including existing names such as
`Customer A/Job 2/Part`. Use forward slashes; absolute paths, traversal, hidden
folders, Windows reserved names, trailing dots/spaces and invalid path characters
are rejected. Names have at most 128 characters per segment and 384 overall.
Links/junctions in path ancestors and bundles, and hard-linked bundle files,
are refused. The default Prints root reuses the CLI's
shared `.local/machine-setups/` store, separately per machine. A custom Prints
root uses its own `.machine-setups/` folder to isolate tests. A restart reopens the same
saved IDs; there is no single global plan that overwrites another job.

| Tool | Role |
|---|---|
| `list_machines`, `list_skills`, `read_skill` | Read this checkout's known profiles and manuals. These small fixed lists are not an automatic discovery or installation system. |
| `read_guidance` | Read fixed guidance IDs: `makers`, `development`, `glossary`, `mcp`, `wedge-generation`, `wedge-s5-export`. Root manuals and required wedge references are available without shell access. |
| `get_plan_template` | Read a complete proposed shell or wedge recipe, reusing remembered setup. |
| `create_print` | Initialize a new unapproved bundle, optionally from a complete recipe. |
| `import_stl_print` | Read an absolute local `.stl` source path with explicit `mm`/`inch` units; preserve its bytes/hash and use the shared CLI importer and remembered setup. Sources are limited to 64 MiB. |
| `list_prints`, `get_print` | Reopen saved prints and read their current state/recipe. `get_print` omits geometry and marks `planComplete:false` unless `includeGeometry:true` is supplied. |
| `adjust_print` | Apply a recipe patch with the latest `expectedRevision` from state. |
| `check_print` | Revalidate native geometry, plan and any stored export; no generation. |
| `check_path` | Check path feasibility through the shared generator without approvals or persisted artifacts; production export/review are still required. |
| `remember_setup` | Save this print's setup as editable defaults for the next print, shared with the CLI. |
| `upgrade_print` | Run the owning adapter's explicit migration for an old bundle, preserving delivered files and invalidating affected approvals. |
| `request_review` | Start/reuse the shared Studio for this print and return its loopback URL. |
| `get_approval_status` | Read the current hash-bound three-stage status from disk. |
| `generate_print` | Generate and check the machine export from approved geometry and settings. |
| `deliver_print` | Copy the exact current approved export into the print's delivery directory. |

Read `read_guidance` with `guidanceId: "makers"` and the skill manual, create the first reasonable geometry, and call
`request_review`. Studio opens in the default browser where available; the
returned URL remains usable if browser launch fails. Set `SAAM_NO_AUTO_OPEN=1`
for tests or a headless client. Studio servers are owned by the MCP process,
use free loopback ports, and close when the client disconnects. Repeated review
requests reuse the print's server. A separately launched CLI Studio remains
independent and is never terminated by this adapter.

Only the person approves geometry, then the locked settings, then the exact
toolpath in Studio. No MCP tool can approve, accept approval fields, select
development generation, write arbitrary files, or send a job to a machine.
Status is loaded from disk rather than accepted from the agent. Recipe edits
invalidate the affected shared approval hashes. Delivery adds no fourth approval
and does not regenerate. A catalog entry or passing software checks do not
establish physical printing, clearance, or a compatible recipe for every machine.

Shell recipes and patches expose the shared geometry, assembly selections,
skill settings and composition fields; the adapter does not keep a smaller
parallel recipe schema. Use `includeGeometry:true` for a complete recipe and
read the owning manuals before editing it. `check_path` reports operation order
and feasibility without becoming a separate preview or approval route. STL
import reads only the chosen source; it writes the new bundle inside the configured
Prints root. `upgrade_print` remains available when current-version validation
prevents normal reopening; it does not silently migrate on read.

The legacy `compile_plan` is replaced by `create_print` / `adjust_print` followed
by the shared approvals and `generate_print`. `validate_plan` becomes
`check_print`; `post_process` becomes shared generation and `deliver_print`.
`list_operations` is replaced by the small known-manual list. `request_review`
and `get_approval_status` now accept only a persisted print ID. The legacy
revision-only approval and global live-session plan are deliberately not adopted.

Run the SDK subprocess integration checks with:

```sh
node --test core/tests/mcp.test.mjs core/tests/mcp-access.test.mjs
```

Tests use isolated temporary Prints roots and synthetic approval records written
by test fixtures outside the adapter protocol. They never approve a real print.

## Temporary web-chat connection

This is a single-user development connection to this computer, intended for
ChatGPT and Claude custom remote MCP connections. SDK integration tests establish
the HTTP/OAuth and shared workflow behavior; actual vendor-web-chat acceptance
must be checked separately in the user's account. Account plans and administrator
settings may restrict custom connections.

Install the root dependencies with `npm ci`. Install the official
[Cloudflare tunnel client](https://developers.cloudflare.com/tunnel/setup/),
then run from the repository root:

```sh
npm run web-chat -- --cloudflared /absolute/path/to/cloudflared
```

On this Windows development checkout, the verified local binary can be used as:

```powershell
npm run web-chat -- --cloudflared .local/bin/cloudflared.exe
```

The command reserves loopback port 4322, starts a temporary Cloudflare HTTPS
tunnel, and writes the public `/mcp` URL and pairing code to the ignored
`.local/web-chat/connection-4322.json`. The code is a credential: read it locally
and enter it only on the SAAM OAuth page, never in a chat or a public URL.
The launcher does not print the code. No project files or Studio routes are
served by the public bridge. Cloudflare carries requests and responses, so tool
arguments/results are not private from the tunnel provider or selected AI service.

1. Add the generated `/mcp` URL as a custom connection in the web chat. Select
   OAuth; dynamic client registration supplies the client ID and secret where
   needed, so normally leave those fields empty.
2. The chat opens the SAAM authorization page. Check the client and return
   address, then enter the local pairing code to connect that client. This is
   connection authorization, separate from the three manufacturing approvals.
3. Ask the agent to read `read_guidance` with `guidanceId: "makers"`, read the
   relevant skill, create an unapproved print, and request review.
4. Review in the Studio window opened on this computer, approve geometry and
   the locked plan, then ask the agent to generate. Review and approve the exact
   toolpath in Studio; the agent can then deliver the same bytes locally.

ChatGPT: use its custom MCP/plugin connection flow in developer mode where
available. Claude: use Customize/Settings > Connectors > Add custom connector.
See the current official [ChatGPT connection instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt)
and [Claude connection instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
This repository does not change client settings automatically or publish a
directory integration.

### Claude plugin upload

For the alpha onboarding test, use the Claude plugin generated by `web-chat`:
`.local/web-chat/saam-claude-4322.zip` (the suffix follows `--port`). In Claude
web, open Customize > Plugins > Upload a plugin and select that ZIP. Connect
the bundled SAAM connector, then enter the current pairing code on the SAAM
authorization page. Start a chat with the plugin enabled and describe a part.
Claude plugins are available on paid plans; see
[Claude's plugin guide](https://support.claude.com/en/articles/13837440-use-plugins-in-claude).

The package contains a Claude manifest, the current remote MCP address and a
short maker skill that loads the canonical manuals through MCP. It contains no
pairing code, token, print files or executable local server. It does not start
SAAM, replace OAuth, or expose local Studio through the tunnel. The person must
keep SAAM running on the computer used for review. Each temporary tunnel has
its own URL: use the newly generated package after restarting that tunnel.
One user's development package points to that user's installation, not to the
recipient's computer. A shared alpha release still needs stable hosting and
installation pairing; that hosted multi-user service remains deferred.

To regenerate a package for an already-running connection:

```sh
node adapters/claude/package.mjs --connection .local/web-chat/connection-4322.json --out .local/web-chat/saam-claude-4322.zip
```

The templates are in `adapters/claude/plugin/`. Packaging uses an explicit file
allowlist and the existing ZIP helper. Local packaging and browser OAuth checks
do not establish that Claude has accepted an upload; the external-client test
records that separately.

The launcher owns the tunnel and bridge. Keep it and the computer running;
Ctrl+C closes the listeners and marks the connection file stopped. A process
restart invalidates all tokens and registrations; a quick-tunnel restart also
changes the URL, so reconnect both clients. The connection file records the
launcher and tunnel PIDs for stopping a background development run. Do not
terminate unrelated Node or tunnel processes.

`--port` chooses another loopback port. `--prints-root` (or `SAAM_PRINTS_ROOT`)
selects the bundle library; the default is this checkout's `Prints`. Use an
isolated root for synthetic tests. `SAAM_NO_AUTO_OPEN=1` disables automatic
browser opening. `--public-url https://your-host.example` uses an already
configured reverse proxy instead of starting Cloudflare. That proxy must forward
to this command's loopback port and preserve either the configured public Host
or its loopback Host. Issuer/resource URLs come only from startup configuration.

## Development connection security and limits

- The local tunnel connects outbound. No inbound router port is required.
  The bridge binds to loopback and refuses unexpected Host/Origin headers.
  Studio retains its own loopback, origin and session-token checks.
- The MCP SDK provides OAuth discovery, dynamic registration, redirect matching,
  PKCE S256 verification and bearer-token middleware. SAAM adds the local pairing
  screen, expiring in-memory grants and tokens, resource/scope checks and token
  revocation. Discovery is public; MCP tools require a token for this installation.
- Pairing requests last five minutes; authorization codes last one minute and
  are single-use and client-bound. Access tokens last one hour; rotating refresh
  tokens last at most eight hours from connection. Restart revokes everything.
  Registrations, pending requests and tokens have bounded in-memory capacity;
  OAuth endpoints and pairing attempts are rate-limited.
- This is one installation's library, not multi-user hosting. Every paired
  client can use the existing MCP tools on that library, including the explicit
  local STL importer. There is no arbitrary shell or general file-reader tool.
  Pair only chat clients you intend to give those capabilities.
- One local adapter serializes tool calls across all HTTP clients and retains
  Studio listeners across individual requests/client disconnects. Existing
  revision/hash checks and human approvals are unchanged. The bridge does not
  retry writes automatically. After a timeout, read current print state before
  deciding whether to retry; a local operation may have continued.
- Quick tunnels do not support SSE, so this bridge uses stateless Streamable
  HTTP with JSON responses and no GET event stream. Long generation calls can
  exceed the tunnel/client request timeout. Persistent hosting and asynchronous
  generation are not part of this development connection.
- Studio URLs and delivered file paths are local. Use the web chat on the SAAM
  computer for the complete review/delivery flow. A phone or different computer
  cannot open those local URLs or retrieve local files through this bridge.

Run `node --test core/tests/mcp-http.test.mjs` for OAuth rejection/rotation/
revocation, two-client state, preserved Studio lifetime, synthetic approval gates
and exact-export delivery. No test authorizes a real print or starts hardware.
