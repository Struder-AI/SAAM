# MCP implementation

Adapter boundaries and integration tests. [The adapter manual](README.md)
owns client configuration and tool usage; [the print lifecycle](../../core/print/README.md)
owns manufacturing state.

## Local MCP access

The adapter uses fixed known profiles and skills under [D-022](../../DECISIONS.md#d-022--defer-automatic-capability-discovery). It delegates manufacturing state to the shared print lifecycle.

[The manual reader](src/manuals.mjs) accepts published repository Markdown paths
and returns the document's own links as resolved IDs. New references therefore
use ordinary links without a parallel per-document registry. It confines reads
to the public documentation trees and rejects private locations and filesystem
links. Optional heading fragments select one section, including its subsections.
The fixed skill catalog distinguishes task manuals from printing patterns;
making a manual readable does not register a new plan operation or MCP tool.
Its IDs and frontmatter reader come from the shared [skill catalog](../../skills/catalog.mjs),
which also supplies the generated maker digest.
Task manuals identify themselves with `metadata.saam-kind: task` in their
frontmatter; existing printing manuals retain the default `printing` kind.

`apply_text` delegates to [shared text preparation](../../core/print/text.mjs),
including local font reading, stale-revision checks and geometry updates. The
adapter does not own a separate text schema, boolean pipeline or approval route.

`core/tests/mcp.test.mjs` uses actual SDK clients and child processes, temporary
bundles and synthetic approval fixtures outside the adapter protocol.
