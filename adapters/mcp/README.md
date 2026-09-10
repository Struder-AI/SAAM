# Local MCP adapter

This stdio adapter lets an MCP client use SAAM's existing shell/wedge bundles
and SAAM Studio. It has no compiler, private review bridge, model calls, or
hardware connection. Machine outputs and skill compatibility remain governed
by the shared plan, generation and interpreter checks.

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
| `generate_print` | Generate/check SAAMpath and the machine's export from approved geometry and settings. |
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
