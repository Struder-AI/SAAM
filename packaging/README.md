# Packaging SAAM

[Agent installation instructions](INSTALL.md) are published at the stable [latest-release URL](https://github.com/Struder-AI/SAAM/releases/latest/download/INSTALL.md) for desktop Claude Code and Codex. SAAM installs per user with an app icon. Prints and optional release-service state stay outside the replaceable application: `%LOCALAPPDATA%\SAAM` on Windows or `~/Library/Application Support/SAAM` on macOS (`SAAM_DATA` overrides either). The bundled Node runtime runs the local Studio and stdio MCP adapter; an invite is optional for making and enables official updates and live diagnostics.

Build one ZIP per platform from a clean tracked snapshot:

```sh
node packaging/build.mjs --platform darwin-arm64 --version 0.3.1 --relay-url https://saam-relay.remettub.workers.dev --update-host https://github.com/Struder-AI/SAAM/releases/download
```

Platforms are `win-x64`, `darwin-arm64`, and `darwin-x64`. `--relay-url` remains the package CLI/`release.json.relayUrl` key for the optional release service; the local launcher interprets it as a service URL. The build downloads and checksum-checks the official Node runtime, or accepts `--node PATH` for a target-platform binary. Optional native mesh repair is included only when the helper matches the target. Each ZIP has an adjacent `.zip.sha256` for agent installation verification.

For an isolated candidate before the release sources are committed, pass `--review` and one `--review-file <relative path>` for each untracked application module or asset. Modified tracked files are copied as they stand; omitted untracked application files fail the build. The manifest records `reviewBuild:true`; production builds require a clean tracked snapshot.

The ZIP contains `app.tar`, the platform installer, a short README and the installer scripts used by in-app updates. The installer stages extraction before replacing the application, creates a SAAM shortcut/icon, and refuses to replace a running SAAM. `packaging/launch.mjs` is the installed entry point; the same per-user data survives installs and updates. Alpha packages are unsigned. Windows packaging can inspect a macOS archive, but macOS installation must be accepted on a Mac.

## Releasing an update

Build the selected shipping platforms from the approved clean release commit. Record each printed ZIP SHA-256 and size. Publish the ZIPs, `.zip.sha256` sidecars **and** generated `dist/INSTALL.md` as assets of `v<version>` in [Struder-AI/SAAM Releases](https://github.com/Struder-AI/SAAM/releases). Set the release-service `LATEST_RELEASE` to the printed asset entries, deploy that service, then verify the installed app's Update button restarts into the new version without moving the data folder. These publication/deployment steps require the owner's release decision; a local review ZIP is never a published release.
