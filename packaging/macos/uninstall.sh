#!/bin/bash
# Uninstalls SAAM for this macOS user: removes ~/SAAM/app and
# ~/Applications/SAAM.app and its desktop shortcut. Prints, the
# local data and connection state in ~/SAAM are kept.
# Run it from Terminal:
#
#   bash ~/SAAM/app/packaging/macos/uninstall.sh [--yes]
set -euo pipefail

fail() { printf '\n%s\n' "$1" >&2; exit 1; }

data_folder() { printf '%s' "${SAAM_DATA:-$HOME/SAAM}"; }

# Same check as install.sh: a live instance record, or node running the installation's launch.mjs.
saam_running() {
  local record pid
  record="$(data_folder)/state/instance.json"
  if [ -f "$record" ]; then
    pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$record" | head -n 1)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o comm= | grep -q node; then return 0; fi
  fi
  pgrep -f "$(data_folder)/app/packaging/launch.mjs" >/dev/null 2>&1
}

main() {
  local target answer shortcut bundle
  target="$(data_folder)/app"
  bundle="$HOME/Applications/SAAM.app"
  shortcut="$HOME/Desktop/SAAM.app"
  [ -d "$target" ] || fail "SAAM is not installed in $target."
  if saam_running; then fail 'SAAM is running. Choose Quit from the tray menu, then uninstall again.'; fi
  if [ "${1:-}" != '--yes' ]; then
    echo "This removes SAAM from $target, $bundle and its desktop shortcut."
    echo "Your prints and settings in $(data_folder) are kept."
    read -r -p 'Type y and press Return to uninstall: ' answer
    case "$answer" in [Yy]*) ;; *) echo 'Nothing was removed.'; exit 0 ;; esac
  fi
  # This script runs from the folder it removes; leave it first.
  cd "$HOME"
  if [ -L "$shortcut" ] && [ "$(readlink "$shortcut")" = "$bundle" ]; then
    rm "$shortcut" || echo "Could not remove the desktop shortcut at $shortcut."
  fi
  rm -rf "$target" "$bundle"
  echo
  echo 'SAAM is uninstalled.'
  echo "Your prints, extensions and remembered setups remain in $(data_folder)/local."
  echo 'Delete that folder yourself if you no longer want them. Installing SAAM again picks them up.'
}

# main is read in full before it runs, so removing this file mid-run is safe.
main "$@"
