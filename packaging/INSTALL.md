# Install SAAM

This guide owns release installation, client setup and verification on Windows x64 and macOS (Apple Silicon or Intel). SAAM uses the person's Codex or Claude account and tokens; it requires no separate AI API key.

SAAM turns the person's fabrication intent into geometry and machine-independent Paath, supports their review in Studio, and translates their captured path and settings into a downloadable machine program when they choose Export. The person chooses Export; an agent does not approve a print or operate hardware.

## Establish access to the person's computer

SAAM runs on the person's computer. A terminal in a hosted sandbox is not that computer; installing there does not give the person SAAM.

| Work | Needs |
| --- | --- |
| Make or edit a part | Installed SAAM and desktop Codex or Claude Code with command access to that computer. Activation is optional. |
| Contribute an extension | The same, authoring in the home's `local/extensions`. No source checkout. |
| Change core, Studio or a shared interface | An explicitly requested source checkout; see [Core development](#core-development). |
| Make a part from web chat | Not yet available; see [Web chat](#web-chat-not-yet-available). |

Without desktop Codex or Claude Code command access, tell the person: "Operating SAAM requires desktop Codex or Claude Code with command access to your computer. Ask it to install SAAM from https://github.com/Struder-AI/SAAM." Stop before downloading or installing. If it is unclear which computer will run SAAM, ask.

## Install or reuse

1. **Reuse an existing installation.** If `saam status` runs, or `C:\SAAM\app` or `~/SAAM/app` exists, skip to [Client setup](#client-setup). For an install or update request, explain that **Update** in Studio or the tray menu is the supported update route. Reinstall only if the person still asks; run `saam quit` first, because the installer refuses while SAAM runs.
2. **Choose the release.** Use the requested version, otherwise the `tag_name` of https://api.github.com/repos/Struder-AI/SAAM/releases/latest. Follow that release's `INSTALL.md` and pin its tag for every download.
3. **Choose the package.** `<platform>` is `win-x64` on Windows. On macOS (13.5 or later) it is `darwin-arm64` when `sysctl -n hw.optional.arm64` prints `1` (Apple Silicon, even in a Rosetta shell where `uname -m` says `x86_64`), otherwise `darwin-x64` (Intel).
4. **Download and verify.** Into a new temporary folder, download `https://github.com/Struder-AI/SAAM/releases/download/v<version>/SAAM-<version>-<platform>.zip` and the same URL with `.zip.sha256`. Stop on a mismatch:
   - Windows: `(Get-FileHash -Algorithm SHA256 SAAM-<version>-win-x64.zip).Hash.ToLower()` equals the first word of the `.zip.sha256` file.
   - macOS: download with `curl -fLO URL` for each file, then `shasum -a 256 -c SAAM-<version>-<platform>.zip.sha256` reports `OK`.
5. **Extract and install.** Extract the whole ZIP; it holds one folder, `SAAM-<version>-<platform>`. Run its installer as the normal user, not as administrator or with sudo:

   ```powershell
   Expand-Archive -LiteralPath SAAM-<version>-win-x64.zip -DestinationPath .
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\SAAM-<version>-win-x64\app\packaging\windows\install.ps1"
   ```

   ```sh
   unzip -q SAAM-<version>-<platform>.zip
   bash "SAAM-<version>-<platform>/app/packaging/macos/install.sh"
   ```

   The installer supplies the application, its Node runtime and shortcuts under `C:\SAAM` or `~/SAAM`, adds it to PATH (on macOS through `~/.zprofile` and `~/.bash_profile`), registers both clients' discovery and permissions, then starts SAAM and opens Studio in the default browser. Do not install Node, clone SAAM or run source setup. If a local sandbox blocks the installer, request approval for this command; if that is unavailable, give the person the exact command. On Windows it requests UAC only if creating `C:\SAAM` needs it.

   macOS packages are unsigned alpha builds; the bundled Node is the official notarized build. Leave Gatekeeper on. `curl` adds no quarantine, and a browser-downloaded ZIP still installs because `bash` runs the installer and it writes `~/Applications/SAAM.app` itself. If macOS still blocks a step, remove quarantine from the downloaded ZIP only, `xattr -d com.apple.quarantine SAAM-<version>-<platform>.zip`, then extract again.

   The installer's messages appear only in its terminal; keep them. If SAAM does not start, run `~/SAAM/app/SAAM.command` on macOS, or the **SAAM (with console)** Start Menu shortcut on Windows, to see its messages.

The home is `C:\SAAM` or `~/SAAM`: replaceable `app/`, the person's `local/` (prints, extensions, remembered machine setups) and persistent `state/`. Updates and reinstalls keep `local/` and `state/`.

## Client setup

1. **Resolve installer results.** After its migration report, the installer prints a JSON line of client results; read its `errors` and each client's `registration` (`error`, `restartRequired`, `trustRequired`, `tellPerson`). Command exit alone does not establish readiness. An error for a client the person does not use, such as `spawn claude.exe ENOENT` when Claude Code is not installed, can wait until that client is installed. Repair the client being used with `saam call repair_client_setup` and inspect its `errors` too. Until this shell picks up PATH, invoke `C:\SAAM\app\saam.cmd` or `~/SAAM/app/saam`.
2. **Permissions.** Initial grants are Codex's `~/.codex/rules/saam.rules` and Claude Code's `Bash(saam *)` / `PowerShell(saam *)`. Use the stable `saam` prefix. Preserve unrelated settings and user-edited or removed grants; repair does not restore removed grants. Use the client's permission flow for access still needed; Claude Code users manage permissions through `/permissions`. Claude Code requires 2.1.285 or newer; if setup reports unsupported plugin commands, or Codex lacks the hook trust controls below, update that client and run repair.
3. **Restart and trust.** Restart open clients and start a new chat that mentions SAAM. In Codex, the person trusts **SAAM Studio event context** through the **yellow fishhook below the composer → Allow selected**, or **Settings → Hooks → Trust**. Claude Code uses its native plugin. If restarting interrupts this chat, give a continuation prompt carrying the original request and the remaining setup steps. Report restart or trust still required as pending setup.

## Verify the session

From the new desktop chat, confirm SAAM's skill is discovered, then run:

```powershell
saam status
saam call maker_onboarding
saam open
```

Retain a returned `chatId` and follow any returned `nextCommand`. When the client supplies no session identity, pass `--chat-id ID` on every later command in this chat, or each command can become a different chat. Request IDs and Studio selection identities are separate; keep them too.

Check that `status` reports the installed `version` (`running: false` means SAAM is not running; `open` starts it) and that `open` shows Studio. A blank Studio cannot send a part-specific request: open an existing print, or continue the person's part task or `saam start-tour`. Once a print is selected, have the person send a Studio request, verify that it reaches this chat through native client context, and hand it back using its returned request identity. Follow onboarding's monitoring guidance. Do not create a hidden test print.

Claim a usable session only after these checks succeed. On a fresh installation, report command access and Studio opening separately from request delivery, which stays pending until a print is selected; keep restart, trust and delivery failures visible. Then resume the original request or offer `saam start-tour`. If the person provided an invite code, encourage activation under **Connect** for updates and diagnostics; making, viewing and exporting work without it.

## Contribute an extension

Installed SAAM plus desktop chat is the contributor workflow. Read the installed authoring guidance and source through published operations:

```powershell
saam call builder_onboarding
saam call read_guidance --guidance-id BUILDERS.md
saam call read_guidance --guidance-id skills/AUTHORING.md
saam call read_guidance --guidance-id ARCHITECTURE.md
saam call list_skills
saam help apply_extension
saam call read_guidance --guidance-id skills/bridge-supports/examples/removable.json
saam call read_contract_source --file core/geom/operations.mjs
```

`saam help OPERATION` gives the installed version's exact schemas. Onboarding returns the publication version, local extension folder, selected extensions and curated `sourceFiles`. An example is recipe input to inspect and adapt, not a script. `read_contract_source` returns complete published source; private provider code, local files and runtime data are excluded, and reading source does not authorize core edits.

To adapt a bundled extension, make its editable local copy and use the returned `directory`:

```powershell
saam call extension_library --action checkout --extension-id text
```

New extensions live in `<SAAM home>/local/extensions/ID/` with `extension.json`, `SKILL.md`, named entries and any assets or examples the authoring manual requires. Desktop chat edits those files directly, never `app/`. Inspect the selected copy and digest with `list_skills`; invoke it with `saam call apply_extension --input REQUEST.json`, built against `saam help apply_extension`, preserving Bundle and Studio revision guards.

A local extension with the **same ID overrides the bundled copy**, survives updates and is not updated when a new bundled default ships. Tell the person when authoring changes a selected extension they share. Record its origin, digest, version compatibility, provenance and licenses. For explicit sharing, `extension_library` exports to a new absolute package path and imports a selected package; read its schema first.

## Core development

Only when the person requests core, Studio or shared-interface development: use a full checkout with the repository's `SETUP.md`, its local notes and developer onboarding, and select that code on **each** development command:

```powershell
node scripts/agent-toolkit.mjs developer-onboarding
saam --code-root C:\path\to\checkout help
saam --code-root C:\path\to\checkout open
```

`help` starts nothing; `open` starts that checkout's runtime under the installed orchestrator, which must speak the checkout's runtime contract (a mismatch names the side to update). Retain the returned runtime ID. `saam status` is global: find the runtime in its list. Ordinary `saam` keeps selecting installed code, and every runtime shares the installed home, so identify real bundles and extensions before editing them. Reload code with `reload-runtime`; active work returns a cancellation confirmation, which needs the person's authorization. Stop finished development runtimes with `stop-runtime`.

## Web chat (not yet available)

Web access through the private provider's connector is not available in this release; do not invent a pairing command or install SAAM in a hosted sandbox. Give a web-chat person the desktop route above. When the connector is delivered, it will use the same local installation, version, library and local extensions; a relay invite will be required for web access but stays optional for desktop use, and fabrication will still run on the person's computer.

## Uninstall

Run `saam quit`, then, as above, `powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\SAAM\app\packaging\windows\uninstall.ps1 -Yes` or `bash ~/SAAM/app/packaging/macos/uninstall.sh --yes`. It removes `app/`, shortcuts, the PATH entry and both clients' registrations; prints, extensions and settings stay.
