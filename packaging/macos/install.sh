#!/bin/bash
# Installs SAAM for this macOS user into ~/Applications/SAAM, replacing an
# earlier installation, writes ~/Applications/SAAM.app and starts SAAM. Run it
# from Terminal:
#
#   bash "<drag install.sh from the extracted release folder here>"
#
# The release folder holds install.sh, the application as app.tar and an app
# folder with only release.json and this script. A running SAAM updating itself
# runs that copy inside the new package instead:
#   bash <package>/app/packaging/macos/install.sh --wait-pid <pid>
# It waits for that SAAM to exit, installs without prompts, logs to
# ~/Library/Application Support/SAAM/logs/update.log and starts the new SAAM.
#
# Nothing here is signed. The bundled Node.js is the official notarized build;
# SAAM's own files are scripts it runs. SAAM.app and the troubleshooting
# launcher ~/Applications/SAAM/SAAM.command are written by this script rather
# than copied from the download, so they carry no download quarantine.
# Quarantine attributes and Gatekeeper settings are left alone.
# Prints, the chat pairing and logs live in ~/Library/Application Support/SAAM
# and are never touched: to go back to an older version, install its release.
set -Eeuo pipefail

# Set in update mode: no one watches that process, so progress and failures
# also go to the update log.
update_log=''
log() { [ -z "$update_log" ] || printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$update_log"; }
say() { echo "$*"; log "$*"; }
fail() { log "$1"; printf '\n%s\n' "$1" >&2; exit 1; }

data_folder() { printf '%s' "${SAAM_DATA:-$HOME/Library/Application Support/SAAM}"; }

# True while SAAM runs: the data folder's instance record names a live node
# process, or a node process runs from the installation folder.
saam_running() {
  local record pid
  record="$(data_folder)/instance.json"
  if [ -f "$record" ]; then
    pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$record" | head -n 1)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o comm= | grep -q node; then return 0; fi
  fi
  pgrep -f "$HOME/Applications/SAAM/runtime/node" >/dev/null 2>&1
}

# ~/Applications/SAAM.app: starts SAAM in the background without a window and
# exits. Written here, on this Mac, so it carries no download quarantine.
write_app() {
  local target="$1" version="$2" bundle="$HOME/Applications/SAAM.app"
  rm -rf "$bundle"
  mkdir -p "$bundle/Contents/MacOS"
  cat > "$bundle/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>SAAM</string>
  <key>CFBundleIdentifier</key><string>local.saam.launcher</string>
  <key>CFBundleName</key><string>SAAM</string>
  <key>CFBundleDisplayName</key><string>SAAM</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
</dict>
</plist>
PLIST
  cat > "$bundle/Contents/MacOS/SAAM" <<LAUNCHER
#!/bin/bash
# Starts SAAM $version in the background and exits; stop SAAM with Quit SAAM in
# Studio. Written by install.sh; prints stay in ~/Library/Application Support/SAAM.
# Run from the home folder, so SAAM never holds the program folder open.
cd "\$HOME"
# Job control puts SAAM in its own process group, so it outlives this script.
set -m
nohup "$target/runtime/node" "$target/packaging/launch.mjs" >/dev/null 2>&1 &
exit 0
LAUNCHER
  chmod +x "$bundle/Contents/MacOS/SAAM"
  # Tell Finder and Launch Services the bundle changed.
  touch "$bundle"
}

main() {
  local here source archive version target staging launcher wait_pid='' waited
  case "${1:-}" in
    --wait-pid) wait_pid="${2:-}"; [[ "$wait_pid" =~ ^[0-9]+$ ]] || fail 'Give --wait-pid a process id.' ;;
    '') ;;
    *) fail "Unknown option $1. Run: bash install.sh [--wait-pid <pid>]" ;;
  esac
  if [ -n "$wait_pid" ]; then
    mkdir -p "$(data_folder)/logs"
    update_log="$(data_folder)/logs/update.log"
    trap 'log "Update failed at install.sh line $LINENO."' ERR
  fi
  here="$(cd "$(dirname "$0")" && pwd)"
  target="$HOME/Applications/SAAM"
  staging="$HOME/Applications/.SAAM-installing"
  [ "$here" != "$target/packaging/macos" ] || fail 'Run install.sh from the extracted release folder, not from the installed SAAM.'
  # The release folder's install.sh sits next to app/; the copy inside the
  # package's app folder sits in app/packaging/macos.
  if [ -f "$here/app/release.json" ]; then source="$here/app"
  elif [ -f "$here/../../release.json" ]; then source="$(cd "$here/../.." && pwd)"
  else fail 'This is not a complete SAAM release folder. Extract the whole download, then run install.sh from it.'
  fi
  archive="$(cd "$source/.." && pwd)/app.tar"
  [ -f "$archive" ] || fail 'The release folder has no app.tar. Extract the whole download again.'
  version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$source/release.json" | head -n 1)"

  # Work from outside the folder being replaced (SAAM may have started us from there).
  cd "$HOME"
  if [ -n "$wait_pid" ]; then
    say "Updating to SAAM ${version:-(unknown version)} from $archive; waiting for SAAM (process $wait_pid) to exit."
    waited=0
    while kill -0 "$wait_pid" 2>/dev/null; do
      [ "$waited" -lt 60 ] || fail "SAAM (process $wait_pid) did not exit within 60 seconds; the update to $version was not installed."
      sleep 1; waited=$((waited + 1))
    done
  fi
  say "Installing SAAM ${version:-(unknown version)} for $(id -un) into $target."
  # The SAAM being updated has exited, so this refuses only another running SAAM.
  if saam_running; then fail 'SAAM is running. Click Quit SAAM in Studio, then run install.sh again.'; fi

  # Unpack into a staging folder next to the installation first, so a failed
  # unpack leaves any installed SAAM as it was.
  mkdir -p "$HOME/Applications"
  rm -rf "$staging"
  mkdir "$staging"
  echo 'Unpacking SAAM...'
  tar -xf "$archive" -C "$staging" && [ -f "$staging/runtime/node" ] \
    || { rm -rf "$staging"; fail 'Unpacking SAAM failed. Nothing was changed.'; }
  # A release built on Windows carries no executable bits.
  chmod +x "$staging/runtime/node" "$staging"/packaging/macos/*.sh
  rm -rf "$target"
  mv "$staging" "$target"

  # For troubleshooting: starts SAAM in a Terminal window that shows its messages.
  launcher="$target/SAAM.command"
  cat > "$launcher" <<LAUNCHER
#!/bin/bash
# Starts SAAM $version in a Terminal window, for troubleshooting: SAAM.app starts
# it without one. Quit SAAM in Studio or close this window to stop SAAM.
# Written by install.sh; prints stay in ~/Library/Application Support/SAAM.
printf '\\033]0;SAAM - close this window to stop SAAM\\007'
"$target/runtime/node" "$target/packaging/launch.mjs"
status=\$?
if [ "\$status" -ne 0 ]; then
  echo
  echo 'SAAM stopped with an error. Its log is in ~/Library/Application Support/SAAM/logs.'
  read -r -p 'Press Return to close this window. ' _
fi
exit "\$status"
LAUNCHER
  chmod +x "$launcher"
  write_app "$target" "$version"

  echo
  say "SAAM ${version} is installed."
  echo 'Start it any time from SAAM in your Applications folder (~/Applications/SAAM.app),'
  echo 'and stop it with Quit SAAM in Studio.'
  echo "Your prints and settings stay in $(data_folder)."
  echo 'Starting SAAM now. Studio opens in your browser; use its Connect chat panel'
  echo 'to link your chat.'
  open "$HOME/Applications/SAAM.app"
  log 'Started SAAM.'
}

main "$@"
