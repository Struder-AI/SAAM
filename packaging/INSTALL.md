# Install SAAM with a desktop coding agent

Give [this stable release URL](https://github.com/Struder-AI/SAAM/releases/latest/download/INSTALL.md) to desktop Claude Code or Codex and ask it to install SAAM. The agent needs local command access. SAAM runs locally; no web-chat connector or repository checkout is needed.

The release source is [Struder-AI/SAAM](https://github.com/Struder-AI/SAAM). Use its [latest release metadata](https://api.github.com/repos/Struder-AI/SAAM/releases/latest), not a guessed download URL. Require a `v0.3.0` or newer stable release. Choose an asset actually listed for this computer: `SAAM-<version>-win-x64.zip` or `SAAM-<version>-darwin-arm64.zip` in the 0.3.0 tester cut. If no matching asset is listed, report that this OS/architecture is unavailable in the release and stop.

Download the matching ZIP and its `.zip.sha256` asset from that release into a temporary directory. Compare the downloaded ZIP's SHA-256 to the sidecar before extraction; stop on any mismatch. Extract the entire ZIP. On Windows run the extracted `app/packaging/windows/install.ps1` with Windows PowerShell (`-NoProfile -ExecutionPolicy Bypass -File`); on macOS run `app/packaging/macos/install.sh` with `bash`. The installer creates the SAAM app shortcut/icon, starts Studio, and keeps user data outside the replaceable application. Do not run an installer from inside an existing SAAM installation or replace a running SAAM; use Quit first.

After the app is installed, connect **the desktop agent that received this page** to SAAM's local stdio MCP server. Use the bundled Node executable and these installed paths:

| Platform | Node | MCP server | Data folder |
|---|---|---|---|
| Windows | `%LOCALAPPDATA%\Programs\SAAM\runtime\node.exe` | `%LOCALAPPDATA%\Programs\SAAM\adapters\mcp\src\server.mjs` | `%LOCALAPPDATA%\SAAM` |
| macOS | `~/Applications/SAAM/runtime/node` | `~/Applications/SAAM/adapters/mcp/src/server.mjs` | `~/Library/Application Support/SAAM` |

Set `SAAM_DATA` to the data folder and `SAAM_PRINTS_ROOT` to its `Prints` subfolder in the MCP configuration. Use absolute expanded paths. For Codex, use `codex mcp add saam --env SAAM_DATA=<data> --env SAAM_PRINTS_ROOT=<data>/Prints -- <node> <server>` and verify with `codex mcp list`. For Claude Code, use `claude mcp add --scope user saam -e SAAM_DATA=<data> -e SAAM_PRINTS_ROOT=<data>/Prints -- <node> <server>` and verify with `claude mcp get saam`. Quote paths containing spaces. If an existing `saam` entry points to a previous SAAM install, update that entry; do not overwrite an unrelated custom server.

Open SAAM from the new icon. Studio offers an optional alpha invite on first launch. Skipping it leaves local making, viewing and exporting available. Entering a valid invite enables official updates and live diagnostics. Later updates use the **Update** button in Studio; the agent should not download another ZIP for an ordinary update. Confirm the app opens, the MCP server is listed, and a local SAAM tool such as `maker_onboarding` is available before reporting installation complete.
