# Install SAAM with a desktop coding agent

Give [this stable installer guide](https://github.com/Struder-AI/SAAM/releases/latest/download/INSTALL.md) to desktop Codex or Claude Code and ask it to install SAAM. Local command access is required.

Read [release metadata](https://api.github.com/repos/Struder-AI/SAAM/releases/latest). Require a stable v0.3.2 or newer and select an actually listed `SAAM-<version>-win-x64.zip`, `darwin-arm64.zip` or `darwin-x64.zip` asset. Download it and its `.zip.sha256` sidecar into a temporary folder; verify SHA-256 before extracting the entire ZIP. Stop if no matching asset or checksum exists, or verification fails.

On Windows run extracted `app/packaging/windows/install.ps1` with Windows PowerShell `-NoProfile -ExecutionPolicy Bypass -File`; on macOS run `app/packaging/macos/install.sh` with bash. Quit an existing SAAM from its tray menu first; run installers from the extracted release.

The installer uses **C:\SAAM** on Windows or **~/SAAM** on macOS: `app/` is replaceable, while `Prints/`, `extensions/` and `state/` persist. It migrates the previous per-user application/data locations, including `.studio-requests`, and keeps old files recoverable in `state/migration/`. Windows grants the Users group Modify access; an ACL failure stops installation before replacement.

Installation adds `saam` to PATH and registers its skill and command permissions in both clients, including absent clients. Mention SAAM in a new desktop chat; restart an existing client to load the setup. The agent can use `saam call repair_client_setup` for registration problems; unrelated settings survive. Use stdin or `--input FILE` for JSON and retain any returned chat ID. Studio launches require the first Send. Launching Claude Code from Studio needs 2.1.285 or later; older versions can connect from an existing chat with `saam call maker_onboarding`. Codex background wakeup remains unverified.

Start from the SAAM icon or the chat's first command. Closing Studio tabs or chats leaves the tray app running; use its Open Studio, Update and Quit menu. A valid optional alpha invite enables official updates and consented diagnostics; later ordinary updates use SAAM's Update action. Verify Studio opens and the client can call `saam call maker_onboarding` before reporting installation complete. Client setup errors do not break the installed app.
