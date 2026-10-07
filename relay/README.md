# SAAM release and diagnostics service

This Cloudflare Worker offers optional alpha activation, release lookup and live
diagnostic receipt. SAAM works locally without it. It has no chat OAuth, MCP,
WebSocket, remote tool dispatch or offline event queue. Existing Durable Object
storage preserves invites, installation credentials and received records.

## Device contract

All requests use JSON over HTTPS. Only activated installations can query
releases or submit diagnostics.

| Endpoint | Request | Response |
|---|---|---|
| `POST /device/register` | `{ "invite": "XXXX-XXXX-XXXX-XXXX" }` | `201 { "deviceId": "…", "secret": "…" }`; invalid, used or expired invite: `403 { "error": "…" }` |
| `POST /device/release` | `Authorization: Bearer <secret>` | `200 { "release": { "version": "…", "assets": { … } } }`, or `null` when no valid manifest is configured |
| `POST /device/events` | Bearer credential; `{ "event": { … }, "about": { … } }` | `200 { "received": true }` after immediate storage |

Unknown or removed credentials receive `401`. Malformed JSON or event shape
receives `400`; registration/operator bodies over 16 KB or events over 64 KB
receive `413`. Diagnostic storage failure receives `503`. A service failure
must never stop local SAAM work. `LATEST_RELEASE` retains the existing
`{version, assets: {platform: {url, sha256}}}` format.

The service bounds diagnostic depth, arrays and strings, redacts credential,
chat, transcript, URL and path fields, and scrubs URLs, absolute paths and
Bearer tokens from remaining text. Error messages and operation facts remain
available for diagnosis. It does not accept bulk files. It keeps received
records for `RECORD_DAYS` (30 by default; 0 disables storage). No events are
collected before activation and no missed events are backfilled.

## Operator

The operator's routes require the `OPERATOR_TOKEN` secret. Without it they do
not exist. The token can be supplied to the CLI as `SAAM_OPERATOR_TOKEN` or
the first line of `.local/relay-operator-token`.

```sh
node relay/scripts/operator.mjs invite --for "Name" [--days 14]
node relay/scripts/operator.mjs invites
node relay/scripts/operator.mjs revoke-invite NAME
node relay/scripts/operator.mjs devices
node relay/scripts/operator.mjs remove NAME [NAME…]
node relay/scripts/operator.mjs pull --device NAME | --since 7d
node relay/scripts/operator.mjs reports [--device NAME] [--since 7d]
```

Commands name invites and installations by the `--for` name; an ID, shown in
brackets, is needed only when two share a name or for a removed installation's
records. The CLI reads `SAAM_RELAY_URL` or `--relay URL`, otherwise the deployed origin.
`pull` writes JSONL under `.local/relay-records/`; `reports` prints Studio and agent
bug reports, each with its installation's records from the 30 minutes before.
Removing a device invalidates its credential, not its retained records. Routes:
`GET/POST /operator/invites`, `DELETE /operator/invites/:id`, `GET /operator/devices`,
`DELETE /operator/devices/:id`, paged `GET /records?device=&since=&until=&after=`.

## Local run and deployment

```sh
cd relay && npm ci
npx wrangler dev
```

[wrangler.jsonc](wrangler.jsonc) holds the deployed origin and `LATEST_RELEASE`.
A new environment sets `OPERATOR_TOKEN` with `npx wrangler secret put
OPERATOR_TOKEN`; never reuse an operator token as an installation credential.
