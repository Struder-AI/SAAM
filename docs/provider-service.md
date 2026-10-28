# Provider service boundary

SAAM is independently usable open source software. Its CLI, local Studio, Bundle
authority, numerical engines, contracts, examples and published source navigation
ship together. Installed desktop making and local extension authoring work without
provider activation. The same installation may also accept paired web calls.

The provider owns the hosted relay, authentication/pairing and MCP connector in a
separate private source project. That source is excluded from the public SAAM
tree and release application files. The public application retains its ordinary
local invocation interface and optional release/diagnostic client; provider
transport adapters call the same operation owners and preserve runtime, chat,
request, revision and job identities. A hosted connection grants no human Export
approval or hardware-operation authority.

## Existing installed release client

The current optional HTTPS service supports these JSON operations:

| Endpoint | Purpose |
| --- | --- |
| `POST /device/register` | Activate a selected installation using its invite; return its device credential. |
| `POST /device/release` | Read the selected service's release manifest using the installation credential. |
| `POST /device/events` | Submit consented compact diagnostics and receive an acknowledgment. |

Unactivated installations send no diagnostics. Missing credentials and service
failures do not disable local making, review or Export. Public client behavior
and update integrity belong to [packaging](../packaging/README.md) and
[release-service.mjs](../packaging/release-service.mjs). Provider operator tools,
deployment configuration, credentials and server implementation belong to the
private project; they are not required for SAAM contributor onboarding.

## 0.4.0 web connector

Web access requires pairing/relay activation to a running local installation.
Desktop-local access does not. The [installation guide](../packaging/INSTALL.md)
covers the desktop route and the installed contributor workflow and marks web
access as not yet available. The private
project now contains an opt-in Streamable HTTP/OAuth endpoint, per-installation
durable invocation records and a local bridge to SAAM's public control interface.
Isolated local probes cover pairing/PKCE, authenticated calls, deduplication,
chat isolation, complete chunked result delivery and uncertain delivery recovery
without replay. A further custom HTTP-client probe exercises the real private
bridge against an extracted installed review artifact: distinct chat identities,
local extension selection, generation, exact request forwarding and completed
handback, saved source/schedule identities and nondestructive repeated queries.
That frozen artifact predates later migration edits. Real chat-client pairing,
connector distribution and cross-device review/download still require end-to-end
verification. No hosted deployment changed.

The relay assessment in [the architecture review](../plans/0.4.0-design.md#mcp-and-the-relay)
records the structural issues to resolve: concurrent chats, durable local jobs,
ambiguous mutation retries, authenticated target identity, disconnect versus
cancellation, and inspection payload size. The private adapter must use the
current public contracts rather than restore the old prototype's local runtime.

Earlier public Git history contains the former provider implementation. Moving
current source does not rewrite that history or remove already published copies.
