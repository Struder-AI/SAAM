# SAAM relay

A Cloudflare Worker and one shared Durable Object that let ChatGPT or Claude web
reach SAAM on a paired computer. The [relay plan](../adapters/mcp/RELAY-PLAN.md)
owns the design; this file covers running it.

- [worker.mjs](src/worker.mjs): OAuth for chat clients (dynamic registration and
  client metadata documents), the pairing-code consent page and device endpoints.
  `/mcp` passes the verified device id to the relay object.
- [relay-object.mjs](src/relay-object.mjs): paired devices, single-use link codes
  (two minutes, failures limited per minute), each device's current chat session
  and the calls in flight to its WebSocket. It stores no print data. It answers
  one JSON-RPC message per request: a call for any session but the device's
  current one gets 404 at once, so the chat starts a new session, and a call
  that waits streams its one result as server-sent events with a keepalive every
  20 s. A dropped device link fails its in-flight calls at once; nothing is
  retried. There is no server-initiated stream.
- [relay-device.mjs](../adapters/mcp/src/relay-device.mjs): the computer's side.
  It registers once, keeps its credential in `.local/relay-device.json`, holds one
  outbound WebSocket and serves each chat session as an ordinary MCP adapter
  session of the local runtime. A new chat replaces the previous session; an idle
  session ends after 30 minutes. A relay session may listen for up to 225 s per
  call, or 450 s when the client name looks like ChatGPT; stdio stays at 25 s.

There are no SAAM accounts: pairing the computer is the identity.
`MAX_PAIRED_DEVICES` caps how many computers can pair (2 while testing, 150 for
alpha); registration beyond it is refused and unpairing frees a slot. Connecting a
chat asks for a code the computer shows; unpairing revokes every chat grant.

## Run locally

```sh
cd relay && npm ci
npx wrangler dev --var PUBLIC_URL:http://localhost:8787
SAAM_RELAY_URL=http://localhost:8787 node adapters/mcp/src/relay-device.mjs
```

The device prints the connector URL and a code. `relay-device.mjs link` prints a
fresh code; `relay-device.mjs unpair` unpairs. A chat product needs a public
HTTPS origin, so web clients need a deployment or a tunnel.

## Test

```sh
node --test relay/test/relay.test.mjs
```

Runs the Worker under `wrangler dev` with a real runtime as the device and an SDK
MCP client over Streamable HTTP: the pairing cap, OAuth with a wrong and a right
code, tool discovery, calls, a stale repeat, a streamed 21 s listener with a
keepalive, link loss, reconnection, a new chat replacing the session (the old one
answered 404), offline and unpairing.
It is not part of the root `npm test`.

## Deploy

Deployed at https://saam-relay.remettub.workers.dev (free plan is enough for testing; the plan budgets Workers Paid for the alpha load). For another account, create the KV namespace
(`npx wrangler kv namespace create OAUTH_KV`) and put its id in
[wrangler.jsonc](wrangler.jsonc), set `PUBLIC_URL` to the deployed origin, then
`npx wrangler deploy`.
