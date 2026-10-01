SAAM for Windows
================

SAAM makes 3D-printed parts through a local desktop coding agent. This
per-user alpha installer needs no administrator rights.

Install
-------
1. Extract the entire ZIP, then run "Install SAAM.cmd" in that folder.
2. This build is unsigned. If Windows shows a protection warning, choose
   More info > Run anyway only for a release you obtained from Struder-AI/SAAM.
3. The installer creates SAAM icons on the Start Menu and Desktop, then
   opens Studio. Quit a running SAAM before installing another version.

Studio offers an optional alpha invite on first launch. SAAM still makes,
views and exports parts if you skip it. A valid invite enables official
updates and live diagnostics. Later use Studio's Update button.

Start SAAM from its icon. Closing the last Studio tab or choosing Quit stops
it; starting again while it runs shows Studio. The Start Menu's "SAAM (with
console)" shortcut shows startup errors.

Your prints and settings remain in %LOCALAPPDATA%\SAAM, separate from
%LOCALAPPDATA%\Programs\SAAM. Installing, updating and uninstalling keep
that data. The desktop agent's local MCP connection uses the bundled Node
runtime; see the agent installation instructions for its paths.

To uninstall, use Start Menu > Uninstall SAAM. The data folder stays until
you choose to remove it yourself.
