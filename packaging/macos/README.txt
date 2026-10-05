SAAM for macOS

Install SAAM by asking Claude or Codex to follow the install guide:
https://github.com/Struder-AI/SAAM/releases/latest/download/INSTALL.md
macOS blocks installers opened from a browser download; agent installs and
SAAM's own updates are not blocked. SAAM lives in ~/SAAM: app is replaced by
updates; Prints, extensions and state persist, and earlier folders migrate.

Start from ~/Applications/SAAM.app; its menu-bar menu offers Open Studio,
Update and Quit. Closing a Studio tab leaves SAAM running. Restart Claude or
Codex after installation to discover the saam command and skill; the agent
handles client setup and repairs. Claude Code requires 2.1.285 or later; the
alpha invite is optional.

Run bash ~/SAAM/app/packaging/macos/uninstall.sh to remove the app, shortcuts
and client setup. Your prints, extensions, settings and logs stay in ~/SAAM.
