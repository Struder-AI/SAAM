#!/bin/bash
# Uninstalls SAAM for this macOS user: removes ~/Applications/SAAM and
# ~/Applications/SAAM.app. Prints, the
# chat pairing and logs in ~/Library/Application Support/SAAM are kept.
# Run it from Terminal:
#
#   bash ~/Applications/SAAM/packaging/macos/uninstall.sh [--yes]
set -euo pipefail

fail() { printf '\n%s\n' "$1" >&2; exit 1; }

data_folder() { printf '%s' "${SAAM_DATA:-$HOME/Library/Application Support/SAAM}"; }

# Same check as install.sh: a live instance record, or node running from the installation.
saam_running() {
  local record pid
  record="$(data_folder)/instance.json"
  if [ -f "$record" ]; then
    pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$record" | head -n 1)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o comm= | grep -q node; then return 0; fi
  fi
  pgrep -f "$HOME/Applications/SAAM/runtime/node" >/dev/null 2>&1
}

main() {
  local target answer
  target="$HOME/Applications/SAAM"
  [ -d "$target" ] || fail "SAAM is not installed in $target."
  if saam_running; then fail 'SAAM is running. Click Quit SAAM in Studio, then uninstall again.'; fi
  if [ "${1:-}" != '--yes' ]; then
    echo "This removes SAAM from $target and $target.app."
    echo "Your prints and settings in $(data_folder) are kept."
    read -r -p 'Type y and press Return to uninstall: ' answer
    case "$answer" in [Yy]*) ;; *) echo 'Nothing was removed.'; exit 0 ;; esac
  fi
  # This script runs from the folder it removes; leave it first.
  cd "$HOME"
  rm -rf "$target" "$target.app"
  echo
  echo 'SAAM is uninstalled.'
  echo "Your prints remain in $(data_folder)/Prints; the chat pairing and logs are in $(data_folder)."
  echo 'Delete that folder yourself if you no longer want them. Installing SAAM again picks them up.'
}

# main is read in full before it runs, so removing this file mid-run is safe.
main "$@"
