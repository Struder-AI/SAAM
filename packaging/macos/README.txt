SAAM for macOS
==============

SAAM makes 3D-printed parts through a local desktop coding agent. This
per-user alpha installer needs no administrator password.

Install
-------
1. Open the downloaded ZIP and its extracted folder.
2. Double-click "Install SAAM.command". It adds SAAM.app in your home
   Applications folder, a Desktop shortcut and the SAAM icon, then opens
   Studio. Press Return to close the installer window.

This build is unsigned. If macOS blocks it, use System Settings > Privacy &
Security > Open Anyway only for a release from Struder-AI/SAAM. The installer
does not change Mac security settings. Quit SAAM before replacing it.

Studio offers an optional alpha invite on first launch. SAAM still makes,
views and exports parts if you skip it. A valid invite enables official
updates and live diagnostics. Later use Studio's Update button.

Open SAAM from the Desktop or ~/Applications/SAAM.app. Closing the last
Studio tab or choosing Quit stops it. If startup fails, run
~/Applications/SAAM/SAAM.command to see messages in Terminal.

Prints and settings remain in ~/Library/Application Support/SAAM, separate
from the replaceable app. The desktop agent's local MCP connection uses the
bundled Node runtime; see the agent installation instructions for its paths.

To uninstall, run `bash ~/Applications/SAAM/packaging/macos/uninstall.sh`
in Terminal. Your data folder remains until you choose to remove it.
