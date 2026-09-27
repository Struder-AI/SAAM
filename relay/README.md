# SAAM relay

A Cloudflare Worker and one shared Durable Object that let ChatGPT or Claude web
reach SAAM on a paired computer. The [relay plan](../adapters/mcp/RELAY-PLAN.md)
owns the design; this file covers running it.

- [worker.mjs](src/worker.mjs): OAuth for chat clients (dynamic registration and
  client metadata documents), the pairing-code consent page, device endpoints and
  the operator's routes. `/mcp` passes the verified device id to the relay object.
- [relay-object.mjs](src/relay-object.mjs): invites, paired devices, chat sign-ins,
  single-use link codes, each device's current chat session and the calls in
  flight to its WebSocket. It keeps no print state, only the alpha records
  (below). It answers
  one JSON-RPC message per request: a call for any session but the device's
  current one gets 404 at once, so the chat starts a new session, and a call
  that waits streams its one result as server-sent events with a keepalive every
  20 s. A dropped device link fails its in-flight calls at once; nothing is
  retried. There is no server-initiated stream.
- [relay-device.mjs](../adapters/mcp/src/relay-device.mjs): the computer's side.
  It pairs once with an invite, keeps its credential in `.local/relay-device.json`, holds one
  outbound WebSocket and serves each chat session as an ordinary MCP adapter
  session of the local runtime. A new chat replaces the previous session; an idle
  session ends after 30 minutes. A relay session may listen for up to 225 s per
  call, or 450 s when the client name looks like ChatGPT; stdio stays at 25 s.

## Pairing

There are no SAAM accounts: pairing the computer is the identity, and pairing
needs an invite from the operator.

1. **Computer.** SAAM starts unpaired; the person pastes their invite (16
   characters, single use, 14 days by default) into Studio's Connect panel, and
   the first light turns on. `MAX_PAIRED_DEVICES` (150) caps paired computers
   behind the invites; a computer registered but never connected within a day
   gives its slot back. A computer the operator removes, or that unpairs,
   forgets its credential and needs a new invite.
2. **Chat.** The chat app adds `PUBLIC_URL/mcp` as a connector and asks for the
   code Studio shows (8 characters, two minutes, single use). A code is checked
   only within a sign-in the consent page started; five wrong codes end that
   sign-in and twenty in ten minutes pause the caller's address, so nobody can
   lock anyone else out. `/device/chats` lists the chat apps holding a grant, so
   the panel offers the URL and code only while none is authorized (or for
   "Connect another chat app"). Unpairing or removal revokes every chat grant.

Sign-ins go only to the origins in `CHAT_REDIRECTS` ([wrangler.jsonc](wrangler.jsonc)),
Claude and ChatGPT; adding one is a deploy that leaves existing connections as
they are. OAuth client registrations and consent pages are limited per address,
a computer has at most 8 calls in flight, and a request over 1 MB is refused
before it is read.

## Operating

The operator's routes need the `OPERATOR_TOKEN` secret
(`npx wrangler secret put OPERATOR_TOKEN`), kept locally in
`.local/relay-operator-token`. Unset, the routes do not exist.

```sh
node relay/scripts/operator.mjs invite --for "Name" [--days 14]   # prints the code once
node relay/scripts/operator.mjs invites                          # open, used, expired
node relay/scripts/operator.mjs revoke-invite ID
node relay/scripts/operator.mjs devices     # label, online, SAAM version, chat apps
node relay/scripts/operator.mjs remove DEVICE [DEVICE…]
```

The alpha records ([D-039](../DECISIONS.md#d-039--alpha-relay-records)), kept
`RECORD_DAYS` days; `pull` writes JSONL and a Markdown timeline per session to
`.local/relay-records/`:

```sh
node relay/scripts/operator.mjs sessions --since 7d
node relay/scripts/operator.mjs pull SESSION          # or --device ID, --since 1d
```

## Run locally

```sh
cd relay && npm ci
npx wrangler dev --var PUBLIC_URL:http://localhost:8787
SAAM_RELAY_URL=http://localhost:8787 node adapters/mcp/src/relay-device.mjs
```

Studio opens unpaired; paste an invite from the local relay (run the operator
script with `--relay http://localhost:8787` and a local `OPERATOR_TOKEN` var), or
use `relay-device.mjs pair INVITE`. `relay-device.mjs link` prints a chat code;
`relay-device.mjs unpair` unpairs. A chat product needs a public
HTTPS origin, so web clients need a deployment or a tunnel.

## Test

```sh
node --test relay/test/relay.test.mjs
```

Runs the Worker under `wrangler dev` with a real runtime as the device and an SDK
MCP client over Streamable HTTP: invites and the pairing cap, OAuth with a wrong and a right
code, tool discovery, calls, a stale repeat, a streamed 21 s listener with a
keepalive, link loss, reconnection, a new chat replacing the session (the old one
answered 404), offline and unpairing.
It is not part of the root `npm test`.

## Deploy

Deployed at https://saam-relay.remettub.workers.dev (free plan is enough for testing; the plan budgets Workers Paid for the alpha load). For another account, create the KV namespace
(`npx wrangler kv namespace create OAUTH_KV`) and put its id in
[wrangler.jsonc](wrangler.jsonc), set `PUBLIC_URL` to the deployed origin, then
`npx wrangler deploy`.
