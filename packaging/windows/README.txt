SAAM for Windows
================

SAAM makes 3D-printed parts through conversation with your web chat
(Claude or ChatGPT). This release installs for your Windows user only and
needs no administrator rights.


Install
-------
1. Extract the whole ZIP (right-click it, Extract All...).
2. In the extracted folder, double-click "Install SAAM.cmd".
   This alpha build is not signed, so Windows may show "Windows protected
   your PC" or another security warning for the download. Choose
   "More info", then "Run anyway".
3. The installer copies SAAM to %LOCALAPPDATA%\Programs\SAAM, adds a "SAAM"
   shortcut to the Start Menu and the Desktop, and starts SAAM.

Close SAAM before installing a new version: the installer refuses while
SAAM is running. Installing replaces the installed version. To go back to
an older version, install its ZIP the same way; your prints are not affected.


Start and stop
--------------
Start SAAM from its Start Menu or Desktop shortcut. A console window titled
"SAAM" opens and Studio opens in your browser. Keep the window open while
you use SAAM; closing it stops SAAM. Starting SAAM again while it runs just
shows Studio.


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
Prints, the chat pairing and logs are kept in %LOCALAPPDATA%\SAAM
(prints in %LOCALAPPDATA%\SAAM\Prints, logs in %LOCALAPPDATA%\SAAM\logs),
separate from the program. Installing, reinstalling and uninstalling never
change them.


Uninstall
---------
Start Menu > "Uninstall SAAM", or run:
  powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Programs\SAAM\packaging\windows\uninstall.ps1"
This removes the program and its shortcuts and keeps %LOCALAPPDATA%\SAAM.
Delete that folder yourself if you no longer want your prints.
