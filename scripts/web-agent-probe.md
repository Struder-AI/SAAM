# Web-agent runtime experiment

Protocol and evidence requirements for the standalone platform probe. This is
separate from the [MCP connection](../adapters/mcp/README.md).

## Web-agent runtime probe

[The standalone probe](web-agent-probe.mjs) tests whether a maker can
interact with a server in a web agent's temporary execution environment.
It is a transport experiment, not another manufacturing pipeline. Upload the
script and [experiment prompt](web-agent-probe-prompt.txt) to the target
web chat; no repository access or npm installation is required. Use Node.js 22+.

```sh
node scripts/web-agent-probe.mjs serve --host 127.0.0.1 --port 4321
node scripts/web-agent-probe.mjs status --url SESSION_URL
node scripts/web-agent-probe.mjs update --url SESSION_URL --control CONTROL_TOKEN --message "Updated through chat"
```

The server prints the session URL, instance ID, control token and fixture SHA-256.
In an isolated cloud environment, use `--host 0.0.0.0` if required by the
platform's native forwarding mechanism. Preserve the random session path and
trailing slash in the maker's preview URL. The probe uses relative client routes
and allows preview framing; its random path limits access to this non-sensitive
test session. It is not the authentication model for a production service.

The maker enters a phrase in the live page, the agent reads it from server state,
and an agent update appears through polling. The maker then confirms a receipt
download and repeats a check after completed chat turns and an idle interval.
Compare instance IDs to detect restarts. Browser endpoint logs identify the
request path, not a verified human, and a download request is not proof that a
file reached the person's device. Automated tests use explicitly synthetic input.

Report shell reachability, cloud-browser reachability, maker interaction,
message round trips, download and session lifetime separately. A static artifact,
screenshot or shell HTTP request does not establish live maker access. Do not
substitute deployment, an external tunnel or a local companion for the platform
capability being tested. Vendor web-session results remain untested until a
person performs the protocol on that surface. Stop only the probe process owned
by the experiment when finished. The probe stores state in memory and creates no
print files, job approvals or machine programs.
