SAAM for macOS
==============

SAAM makes 3D-printed parts through conversation with your web chat
(Claude or ChatGPT). This release installs for your macOS user only and
needs no administrator password.

Install
-------
1. Double-click the downloaded ZIP, then open the extracted folder.
2. Double-click "Install SAAM.command". It adds a desktop shortcut, shows
   the installed app in Finder and opens SAAM in your browser.
3. Press Return to finish, then close the installer window.

If macOS blocks the installer, open System Settings > Privacy & Security,
click Open Anyway for Install SAAM.command, and confirm Open. This alpha
is unsigned; approve it only if you downloaded it from Struder-AI/SAAM.
The installer does not change your Mac's security settings.

Quit SAAM before installing a new version. Installing replaces the old
version and keeps your prints; older downloads install the same way.


Start and stop
--------------
Double-click SAAM on the desktop, or in Finder choose Go > Home >
Applications > SAAM. Studio opens in your browser. To stop it, close the
Studio tab or click Quit. Updates do not restore deleted shortcuts.
If SAAM does not start, double-click SAAM.command inside
~/Applications/SAAM to see its messages in Terminal.


Connect your chat (first time)
------------------------------
1. In Studio, click "Connect" at the top right.
2. Copy the connector URL and add it as a custom connector in your chat app.
3. When the chat asks for a code, click "Show code" in Studio and type the
   code into the chat's approval page. A code is valid for two minutes;
   click "New code" for another.
Studio opens this panel by itself until a chat app is set up.
The two lights on "Connect" show whether this computer is paired with the
relay and whether a chat is connected. To add another chat app later, open
the panel and click "Connect another chat app".


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
This removes SAAM and its desktop shortcut, keeping your prints in
~/Library/Application Support/SAAM.
Delete that folder yourself if you no longer want your prints.
