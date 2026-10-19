# Install SAAM

This guide owns release installation and client setup on Windows x64 and macOS (Apple Silicon or Intel). SAAM uses the user's Codex or Claude account and tokens; it requires no separate AI API key. Source development uses the repository's SETUP.md.

## Before installing

1. **Desktop agents with local command access.** If you are not desktop Codex or Claude Code, or cannot run commands on the user's computer, tell them: “Operating SAAM requires desktop Codex or Claude Code with command access to your computer. Ask it to install SAAM from https://github.com/Struder-AI/SAAM.” Stop before downloading or installing; a hosted sandbox is not the user's computer.
2. **Use an existing installation.** If `saam` runs, or `C:\SAAM\app` or `~/SAAM/app` exists, skip installation and verify the existing client setup below. For an install/update request, explain that **Update** in Studio or the tray menu is the supported update route. Reinstall only if the user still asks after that.
3. Use the user's configured desktop client. Claude Code requires 2.1.285 or newer. If client setup reports unsupported plugin commands or Codex lacks the hook trust controls below, update that client before retrying setup.

## Install

1. Read the [latest release](https://api.github.com/repos/Struder-AI/SAAM/releases/latest), or `https://api.github.com/repos/Struder-AI/SAAM/releases/tags/v<version>` for a requested version. Follow that release's `INSTALL.md`; pin its tag for every download.
2. Download `SAAM-<version>-win-x64.zip`, `-darwin-arm64.zip` or `-darwin-x64.zip` for this computer and its `.zip.sha256` to a temporary folder. Verify SHA-256 before extracting; stop on a mismatch.
3. Extract the whole ZIP and run its installer as the normal user, not as administrator or with sudo:
   - Windows: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<extracted>\app\packaging\windows\install.ps1"`
   - macOS: `bash "<extracted>/app/packaging/macos/install.sh"`

   The installer supplies Node, the application and shortcuts under `C:\SAAM` or `~/SAAM`, and configures PATH and both clients' discovery/permissions, including absent clients. If local sandbox permissions block it, request approval for this command; if unavailable, give the user the exact command to run. The installer requests system authorization when needed.

## Complete client setup

1. Resolve installer errors, including PATH setup. Read client results, including `errors`, `restartRequired` and `trustRequired`. Repair errors for the client being used with `saam call repair_client_setup` and inspect its returned `errors` too; a successful command alone does not establish readiness. An absent client's native adapter can wait until that client is installed, then run repair. If this shell has not picked up PATH yet, invoke `C:\SAAM\app\saam.cmd` or `~/SAAM/app/saam` until restart.
2. Initial command grants are Codex's `~/.codex/rules/saam.rules` and Claude's `Bash(saam *)` / `PowerShell(saam *)` allowances. Use the stable `saam` prefix. Preserve unrelated settings and user-edited or removed grants; use the client's permission flow for access still needed. Repair does not restore removed grants. Claude users manage permissions through `/permissions`.
3. Restart open clients, start a new chat and mention SAAM. In Codex, the user trusts **SAAM Studio event context** through the **yellow fishhook below the composer → Allow selected**, or **Settings → Hooks → Trust**. Claude uses its native plugin. If restarting interrupts this chat, give a continuation prompt carrying the original request and remaining setup steps. Report restart or trust still required as pending setup.
4. From that desktop chat, confirm SAAM's skill is discovered, run `saam call maker_onboarding` and `saam status`, and use `saam open` to show Studio in the default browser. Verify the installed runtime and that a Studio request reaches this chat through native client context, then hand it back using its returned request identity. Follow the returned client monitoring guidance. Claim a usable session after these checks succeed; otherwise name the failing step or pending user action. Then resume the original request or offer `saam start-tour`.

Activation is optional. If the user provided an invite code, encourage activation under **Connect** for updates and diagnostics. Making, viewing and exporting work without activation.

To uninstall later: `saam quit`, then `C:\SAAM\app\packaging\windows\uninstall.ps1 -Yes` (run as above) or `bash ~/SAAM/app/packaging/macos/uninstall.sh --yes`. Prints and settings stay.
