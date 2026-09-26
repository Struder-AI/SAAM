# Packaging SAAM

Builds the installable Windows and macOS ZIPs described in the
[relay plan](../adapters/mcp/RELAY-PLAN.md#local-execution-and-packaging). The
[relay](../relay/README.md) must be deployed first: every build names the relay
it pairs with.

```sh
node packaging/build.mjs --platform win-x64 --version 0.1.0 --relay-url https://relay.example.com
node packaging/build.mjs --platform darwin-arm64 --version 0.1.0 --relay-url https://relay.example.com
```

`--platform` is `win-x64`, `darwin-arm64` or `darwin-x64`. The build downloads
the official Node release (`--node-version`, default the building Node) and
checks it against the release's SHASUMS256; `--node PATH` bundles a given binary
instead. Output is `dist/SAAM-<version>-<platform>.zip`.

A build contains the tracked application files except development maps,
tooling, tests and the relay service; production dependencies installed with
`npm ci --omit=dev --ignore-scripts`; the Node runtime and its licence;
`release.json` (version, relay, platform, Node); and the platform installer
from [windows/](windows/) or [macos/](macos/).

- [launch.mjs](launch.mjs) is the installed entry point. Prints, the pairing
  credential and logs live in a per-user data folder (Windows
  `%LOCALAPPDATA%\SAAM`, macOS `~/Library/Application Support/SAAM`, override
  with `SAAM_DATA`), outside the application, so install, update, rollback and
  uninstall never touch them. One SAAM runs per user; launching again shows
  Studio. It opens Studio with its Connect chat panel.
- Installers are per-user and need no administrator rights. Installing refuses
  while SAAM is running, so an update never replaces code under a running
  generation. Installing replaces the application; to roll back, install the
  older ZIP.
- A computer whose SAAM speaks another device-relay protocol than the relay is
  refused with an update message shown in Studio.

Alpha builds are unsigned and need no Apple Developer account. On macOS the
installer is `install.sh`, run from Terminal with `bash`, which Gatekeeper does
not block; it writes the launcher on the computer, so the launcher carries no
download quarantine, and the bundled Node is the official notarized build.
Windows may warn about an unsigned download; the README says to run it anyway.
