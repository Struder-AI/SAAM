# SAAM relay

A Cloudflare Worker and one shared Durable Object that let ChatGPT or Claude web
reach SAAM on a paired computer. The [relay plan](../adapters/mcp/RELAY-PLAN.md)
owns the design; this file covers running it.

- [worker.mjs](src/worker.mjs): OAuth for chat clients (dynamic registration and
  client metadata documents), the pairing-code consent page, device endpoints and
  `/mcp`, which forwards one JSON-RPC message per request. Responses are JSON;
  there is no server-initiated stream.
- [relay-object.mjs](src/relay-object.mjs): paired devices, single-use link codes
  (two minutes, failures limited per minute) and the calls in flight to each
  device's WebSocket. It stores no print data. A dropped device link fails its
  in-flight calls at once; nothing is retried.
- [relay-device.mjs](../adapters/mcp/src/relay-device.mjs): the computer's side.
  It registers once, keeps its credential in `.local/relay-device.json`, holds one
  outbound WebSocket and serves each chat session as an ordinary MCP adapter
  session of the local runtime. A new chat replaces the previous session; an idle
  session ends after 30 minutes.

There are no SAAM accounts: pairing the computer is the identity.
`MAX_PAIRED_DEVICES` caps how many computers can pair (2 while testing, 150 for
alpha); registration beyond it is refused and unpairing frees a slot. Connecting a
chat asks for a code the computer shows; unpairing revokes every chat grant.

## Run locally

```sh
cd relay && npm ci
npx wrangler dev
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
MCP client over Streamable HTTP: OAuth with a wrong and a right code, tool
discovery, calls, a stale repeat, link loss, reconnection, offline and unpairing.
It is not part of the root `npm test`.

## Deploy

Needs a Workers Paid account. Create the KV namespace
(`npx wrangler kv namespace create OAUTH_KV`) and put its id in
[wrangler.jsonc](wrangler.jsonc), set `PUBLIC_URL` to the deployed origin, then
`npx wrangler deploy`.
