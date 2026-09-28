# Packaging SAAM

Builds the installable Windows and macOS ZIPs described in the
[relay plan](../adapters/mcp/RELAY-PLAN.md#local-execution-and-packaging). The
[relay](../relay/README.md) must be deployed first: every build names its relay.

```sh
node packaging/build.mjs --platform win-x64 --version 0.1.0 --relay-url https://relay.example.com
node packaging/build.mjs --platform darwin-arm64 --version 0.1.0 --relay-url https://relay.example.com
```

`--platform` is `win-x64`, `darwin-arm64` or `darwin-x64`. The build downloads
the official Node release (`--node-version`, default the building Node) and
checks it against the release's SHASUMS256; `--node PATH` bundles a given binary
instead. Output is `dist/SAAM-<version>-<platform>.zip`.

The application is the tracked files except development maps, tooling, tests
and the relay service; production dependencies (`npm ci --omit=dev
--ignore-scripts`) less those only manifold-3d's CAD tooling uses, listed in
[build.mjs](build.mjs); the Node runtime and its licence; and `release.json`.
The ZIP holds it as one `app.tar`, which the installer from [windows/](windows/)
or [macos/](macos/) unpacks straight into the installation, and `app/` with only
`release.json` and the installer scripts, where updates run them.

- [launch.mjs](launch.mjs) is the installed entry point. Prints, the pairing
  credential and logs live in a per-user data folder (Windows
  `%LOCALAPPDATA%\SAAM`, macOS `~/Library/Application Support/SAAM`, override
  with `SAAM_DATA`), outside the application, so install, update, rollback and
  uninstall never touch them. One SAAM runs per user, without a window
  (`SAAM.vbs`, `SAAM.app`); launching again shows Studio; Quit in Studio stops it.
- Installers are per-user and need no administrator rights. Installing refuses
  while SAAM is running, so an update never replaces code under a running
  generation. To roll back, install the older ZIP.
- A computer whose SAAM speaks another device-relay protocol than the relay is
  refused with an update message shown in Studio.

Alpha builds are unsigned and need no Apple Developer account. On macOS the
installer is `install.sh`, run from Terminal with `bash`, which Gatekeeper does
not block; it writes `SAAM.app` on the computer, so it carries no download
quarantine, and the bundled Node is the official notarized build.
Windows may warn about an unsigned download; the README says to run it anyway.

## Releasing an update

Releases are GitHub Releases on the public Struder-AI/SAAM repository, so SAAM
downloads them without a login. Builds pass
`--update-host https://github.com/Struder-AI/SAAM/releases/download`, and an
installed SAAM accepts only `<update host>/v<version>/SAAM-<version>-<platform>.zip`
for a plain `major.minor.patch` version, with the checksum the relay names.

The build copies tracked files as they are on disk, so it runs in a detached
worktree of the pushed commit, never in a checkout other sessions edit.

1. Choose a version above every one built so far (`dist/`), including unpublished
   builds and the installed `release.json`.
2. In that worktree, build `win-x64`, `darwin-arm64` and `darwin-x64` with it,
   the deployed relay's `--relay-url`, that `--update-host` and `--out` the
   checkout's `dist`. Each build prints its `LATEST_RELEASE` asset entry.
3. Add a DEVLOG entry (version, sizes, sha256s), commit and push.
4. Publish with the [GitHub CLI](https://cli.github.com) signed in to an account
   that can write the repository: `gh release create v<version>
   dist/SAAM-<version>-*.zip -R Struder-AI/SAAM --target <pushed commit>`.
5. Set `LATEST_RELEASE` in [the relay configuration](../relay/wrangler.jsonc) to
   `{"version":…,"assets":{…}}`, merging the printed entries, and
   [deploy the relay](../relay/README.md#deploy). Devices reconnect and Studio
   offers the update. Commit and push the configuration.

Builds before 0.1.5 cannot update themselves: their updater starts the
installer without a console, so Windows PowerShell exits without running it
and SAAM just quits. Install those from the ZIP.
