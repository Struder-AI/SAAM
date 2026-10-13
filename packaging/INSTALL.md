# Install SAAM

These steps are for the agent asked to install SAAM, a desktop application for making 3D printed parts, on Windows x64 or macOS.

## Before installing

1. **Desktop agents only.** SAAM supports only desktop Claude Code and desktop Codex. If you cannot run commands on the person's own computer, install nothing; tell them to ask again in desktop Claude Code or desktop Codex.
2. **Existing installations update themselves.** If SAAM is already installed (`saam` runs, or `C:\SAAM\app` or `~/SAAM/app` exists), first tell the person that **Update** in SAAM Studio or the SAAM tray menu is the supported way to update, then stop. Reinstall only if they still ask after that.

## Install

1. Read the [latest release](https://api.github.com/repos/Struder-AI/SAAM/releases/latest), or `releases/tags/v<version>` if the person names a version.
2. Download `SAAM-<version>-win-x64.zip`, `-darwin-arm64.zip` or `-darwin-x64.zip` to match this computer, and its `.zip.sha256`, to a temporary folder. Stop if the ZIP's SHA-256 does not match.
3. Extract the whole ZIP and run its installer as the normal user, not as administrator or with sudo:
   - Windows: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <extracted>\app\packaging\windows\install.ps1`
   - macOS: `bash <extracted>/app/packaging/macos/install.sh`

   It writes `C:\SAAM` or `~/SAAM`, PATH and both clients' settings, outside your workspace. If your sandbox blocks it, request approval for this command; if approval is unavailable, give the person the command to run. Windows may ask the person for administrator approval to create `C:\SAAM`.

## After installing

Studio opens. Have the person activate updates with their invite under **Connect**, restart an open client, start a new chat and mention SAAM.
Initial setup remembers only SAAM command access: Codex's `~/.codex/rules/saam.rules`, and Claude Code's `Bash(saam *)` / `PowerShell(saam *)` rules in user settings. Manual users can remove these grants (Claude: `/permissions`); updates and repairs preserve edits/removals and other client policies. Use the stable `saam` prefix so new recipe files, operations and print IDs reuse the same grant.
Codex separately requires review of SAAM's four hooks in `/hooks`; unchanged definitions retain trust across updates. [Codex rules](https://learn.chatgpt.com/docs/agent-configuration/rules), [hook trust](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks) and [Claude permissions](https://code.claude.com/docs/en/permissions) own client behavior; explicit ask/deny or managed policies take precedence.
If the new chat cannot use `saam`, run `saam call repair_client_setup`; do not restore permissions the person removed.

To uninstall later: `saam quit`, then `C:\SAAM\app\packaging\windows\uninstall.ps1 -Yes` (run as above) or `bash ~/SAAM/app/packaging/macos/uninstall.sh --yes`. Prints and settings stay.
