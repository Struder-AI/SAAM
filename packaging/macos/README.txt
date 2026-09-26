SAAM for macOS
==============

SAAM makes 3D-printed parts through conversation with your web chat
(Claude or ChatGPT). This release installs for your macOS user only and
needs no administrator password.

This alpha build is not signed or notarized by SAAM. It is installed from
Terminal with a script, which macOS runs without a Gatekeeper prompt. The
bundled Node.js runtime is the official build from nodejs.org, which is
notarized by the Node.js project. Your Mac's security settings are not
changed.


Install
-------
1. Double-click the download to extract it (Finder puts the folder next to
   the download).
2. Open Terminal (Applications > Utilities > Terminal).
3. Type  bash  followed by a space, drag install.sh from the extracted
   folder into the Terminal window, and press Return. The line looks like:
     bash "/Users/you/Downloads/SAAM-0.1.0-darwin-arm64/install.sh"
4. The installer copies SAAM to ~/Applications/SAAM, writes the launcher
   ~/Applications/SAAM/SAAM.command, and starts SAAM in a new Terminal
   window.

Close SAAM before installing a new version: the installer refuses while
SAAM is running. Installing replaces the installed version. To go back to
an older version, install its download the same way; your prints are not
affected.


Start and stop
--------------
Double-click SAAM.command in ~/Applications/SAAM (in Finder: Go > Home,
then Applications > SAAM), or run it from Terminal:
  ~/Applications/SAAM/SAAM.command
A Terminal window titled "SAAM" opens and Studio opens in your browser.
Keep the window open while you use SAAM; closing it stops SAAM. Starting
SAAM again while it runs just shows Studio. You can drag SAAM.command to
the Dock for quick access.


Connect your chat (first time)
------------------------------
1. In Studio, click "Connect chat" at the top right.
2. Copy the connector URL and add it as a custom connector in your chat app.
3. When the chat asks for a code, click "Show code" in Studio and type the
   code into the chat's approval page. A code is valid for two minutes;
   click "New code" for another.
The panel shows whether this computer is connected and whether a chat is.


Where your prints live
----------------------
Prints, the chat pairing and logs are kept in
~/Library/Application Support/SAAM (prints in its Prints folder, logs in
its logs folder), separate from the program. Installing, reinstalling and
uninstalling never change them.


Uninstall
---------
In Terminal, run:
  bash ~/Applications/SAAM/packaging/macos/uninstall.sh
This removes ~/Applications/SAAM and keeps ~/Library/Application Support/SAAM.
Delete that folder yourself if you no longer want your prints.
