#!/bin/bash
# Uninstalls SAAM for this macOS user: removes ~/SAAM/app,
# ~/Applications/SAAM.app, its desktop shortcut, its PATH entry and its
# Claude Code and Codex registrations. Prints, the local data and
# connection state in ~/SAAM are kept.
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

# install.sh appended a blank line, this marker and one PATH export to each
# profile, creating any that was absent; a profile left empty is removed.
remove_profile_path() {
  local profile updated
  for profile in "$HOME/.zprofile" "$HOME/.bash_profile"; do
    grep -Fqx '# SAAM application PATH' "$profile" 2>/dev/null || continue
    updated="$(mktemp)"
    if awk '
      blank && $0 == "# SAAM application PATH" { blank = 0 }
      blank { print ""; blank = 0 }
      skip { skip = 0; if (index($0, "export PATH=") == 1) next }
      $0 == "# SAAM application PATH" { skip = 1; next }
      $0 == "" { blank = 1; next }
      { print }
      END { if (blank) print "" }' "$profile" >"$updated"; then
      if [ -s "$updated" ]; then cat "$updated" >"$profile"; else rm "$profile"; fi
    else echo "Remove the SAAM application PATH lines from $profile yourself."; fi
    rm -f "$updated"
  done
}

main() {
  local target answer shortcut bundle
  target="$(data_folder)/app"
  bundle="$HOME/Applications/SAAM.app"
  shortcut="$HOME/Desktop/SAAM.app"
  [ -d "$target" ] || fail "SAAM is not installed in $target."
  if saam_running; then fail 'SAAM is running. Choose Quit in Studio or the SAAM menu, then uninstall again.'; fi
  if [ "${1:-}" != '--yes' ]; then
    echo "This removes SAAM from $target and $bundle, with its desktop shortcut, PATH entry and Claude Code and Codex registrations."
    echo "Your prints and settings in $(data_folder) are kept."
    read -r -p 'Type y and press Return to uninstall: ' answer
    case "$answer" in [Yy]*) ;; *) echo 'Nothing was removed.'; exit 0 ;; esac
  fi
  # This script runs from the folder it removes; leave it first.
  cd "$HOME"
  "$target/runtime/node" "$target/packaging/client-setup.mjs" "$(data_folder)" --unregister \
    || echo 'Remove the registrations named above from Claude Code and Codex yourself.'
  remove_profile_path
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
