# MCP implementation

Adapter boundaries and integration tests. [The adapter manual](README.md)
owns client configuration and tool usage; [the print lifecycle](../../core/print/README.md)
owns manufacturing state. The separate [web-runtime probe](../../scripts/web-agent-probe.md)
is an optional platform experiment.

## Local MCP access

The adapter uses fixed known profiles and skills under [D-022](../../DECISIONS.md#d-022--defer-automatic-capability-discovery). It delegates manufacturing state to the shared print lifecycle.

[The manual reader](src/manuals.mjs) accepts published repository Markdown paths
and returns the document's own links as resolved IDs. New references therefore
use ordinary links without a parallel per-document registry. It confines reads
to the public documentation trees and rejects private locations and filesystem
links. Optional heading fragments select one section, including its subsections.
The fixed skill catalog distinguishes task manuals from printing patterns;
making a manual readable does not register a new plan operation or MCP tool.
Task manuals identify themselves with `metadata.saam-kind: task` in their
frontmatter; existing printing manuals retain the default `printing` kind.

`core/tests/mcp.test.mjs` uses actual SDK clients and child processes, temporary
bundles and synthetic approval fixtures outside the adapter protocol.

`npm run web-chat -- --cloudflared /path/to/cloudflared` starts the temporary
connection. `adapters/mcp/src/http.mjs` forwards SDK HTTP requests over an
in-memory transport to one existing adapter; it owns no manufacturing schema or
approval route. `dev-oauth.mjs` adds single-installation pairing to the SDK's
OAuth routes. `web-chat.mjs` owns the tunnel, the loopback pairing page and the ignored
connection file. It starts either a quick tunnel or, given `--public-url` and a
named-tunnel token, a stable named tunnel; the token comes from a file or the
environment so it never appears in process arguments.
`core/tests/mcp-http.test.mjs` exercises the HTTP/OAuth boundary and shared
workflow with synthetic approvals. See the adapter README for startup, security,
timeouts and same-computer review limits.
