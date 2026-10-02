#!/bin/bash
# Installs SAAM for this macOS user into ~/SAAM/app, replacing an
# earlier installation, writes ~/Applications/SAAM.app and starts SAAM.
# Install SAAM.command runs this script inside the release's app folder;
# app.tar sits next to app/. A running SAAM updating itself uses the same path:
#   bash <package>/app/packaging/macos/install.sh --wait-pid <pid>
# It waits for that SAAM to exit, installs without prompts, logs to
# ~/SAAM/state/logs/update.log and starts the new SAAM.
#
# Nothing here is signed. The bundled Node.js is the official notarized build;
# SAAM's own files are scripts it runs. SAAM.app and the troubleshooting
# launcher ~/SAAM/app/SAAM.command are written by this script rather
# than copied from the download, so they carry no download quarantine.
# Quarantine attributes and Gatekeeper settings are left alone.
# Prints, extensions and state persist in ~/SAAM; legacy sources are preserved.
set -Eeuo pipefail

# Set in update mode: no one watches that process, so progress and failures
# also go to the update log.
update_log=''
log() { [ -z "$update_log" ] || printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$update_log"; }
say() { echo "$*"; log "$*"; }
fail() { log "$1"; printf '\n%s\n' "$1" >&2; exit 1; }

data_folder() {
  if [ "${SAAM_DATA:-}" = "$HOME/Library/Application Support/SAAM" ]; then printf '%s' "${SAAM_INSTALL_TEST_ROOT:-$HOME/SAAM}"
  else printf '%s' "${SAAM_INSTALL_TEST_ROOT:-${SAAM_DATA:-$HOME/SAAM}}"; fi
}

# True while SAAM runs: the data folder's instance record names a live node
# process, or a node process runs from the installation folder.
saam_running() {
  local record pid
  for record in "$(data_folder)/state/instance.json" "$HOME/Library/Application Support/SAAM/instance.json"; do
  if [ -f "$record" ]; then
    pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$record" | head -n 1)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o comm= | grep -q node; then return 0; fi
  fi
  done
  pgrep -f "$(data_folder)/app/runtime/node|$HOME/Applications/SAAM/runtime/node" >/dev/null 2>&1
}

# ~/Applications/SAAM.app: starts SAAM in the background without a window and
# exits. Written here, on this Mac, so it carries no download quarantine.
write_app() {
  local target="$1" version="$2" bundle="$3" source="$4"
  mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
  cp "$source/packaging/macos/SAAM.icns" "$bundle/Contents/Resources/SAAM.icns"
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
  <key>CFBundleIconFile</key><string>SAAM</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
</dict>
</plist>
PLIST
  cat > "$bundle/Contents/MacOS/SAAM" <<LAUNCHER
#!/bin/bash
# Starts SAAM $version in the background and exits; stop SAAM with Quit in SAAM
# tray menu. Written by install.sh; prints stay in ~/SAAM/Prints.
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

# A Finder shortcut to the installed app, without controlling Finder or Dock.
# Existing desktop items belong to the person, including broken links.
write_desktop_shortcut() {
  local bundle="$1" shortcut="$2"
  if [ -L "$shortcut" ] && [ "$(readlink "$shortcut")" = "$bundle" ]; then return; fi
  if [ -e "$shortcut" ] || [ -L "$shortcut" ]; then
    say "Kept the existing desktop item at $shortcut. SAAM is in your home Applications folder."
  elif ln -s "$bundle" "$shortcut"; then
    say 'Created the SAAM desktop shortcut.'
  else
    say 'Could not create the desktop shortcut. Open SAAM from your home Applications folder.'
  fi
}

main() {
  local here source archive version target staging launcher wait_pid='' waited applications bundle staged_bundle backup backup_bundle home legacy_data legacy_app transaction
  case "${1:-}" in
    --wait-pid) wait_pid="${2:-}"; [[ "$wait_pid" =~ ^[0-9]+$ ]] || fail 'Give --wait-pid a process id.' ;;
    '') ;;
    *) fail "Unknown option $1. Run: bash install.sh [--wait-pid <pid>]" ;;
  esac
  if [ -n "$wait_pid" ]; then
    mkdir -p "$(data_folder)/state/logs"
    update_log="$(data_folder)/state/logs/update.log"
    trap 'log "Update failed at install.sh line $LINENO."' ERR
  fi
  here="$(cd "$(dirname "$0")" && pwd)"
  home="$(data_folder)"
  target="$home/app"
  legacy_data="$HOME/Library/Application Support/SAAM"
  legacy_app="$HOME/Applications/SAAM"
  if [ -n "${SAAM_INSTALL_TEST_ROOT:-}" ]; then
    case "$home" in /tmp/*|"${TMPDIR:-/tmp/}"*) ;; *) fail 'SAAM_INSTALL_TEST_ROOT must be under the temporary folder.' ;; esac
    legacy_data="$home/legacy-data"; legacy_app="$home/legacy-app"
  fi
  applications="$HOME/Applications"
  if [ -n "${SAAM_INSTALL_TEST_ROOT:-}" ]; then applications="$home"; fi
  bundle="$applications/SAAM.app"
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
  [[ "$version" =~ ^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$ ]] || fail 'The release has no valid version. Nothing was changed.'

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
  if saam_running; then fail 'SAAM is running. Choose Quit from the tray menu, then run install.sh again.'; fi

  # Unpack into a staging folder next to the installation first, so a failed
  # unpack leaves any installed SAAM as it was.
  mkdir -p "$applications" "$home/state"
  staging="$(mktemp -d "$home/app.installing.XXXXXX")"
  transaction="${staging##*.}"
  staged_bundle="$staging/SAAM.app"
  backup="$staging.previous"
  backup_bundle="$staging.previous.app"
  echo 'Unpacking SAAM...'
  tar -xf "$archive" -C "$staging" \
    || { rm -rf "$staging"; fail 'Unpacking SAAM failed. Nothing was changed.'; }
  for required in runtime/node release.json packaging/launch.mjs scripts/saam.mjs packaging/migrate-home.mjs packaging/client-setup.mjs packaging/macos/SAAM.icns packaging/macos/install.sh; do
    [ -f "$staging/$required" ] || { rm -rf "$staging"; fail "The candidate has no $required. Nothing was changed."; }
  done
  # A release built on Windows carries no executable bits.
  chmod +x "$staging/runtime/node" "$staging"/packaging/macos/*.sh
  "$staging/runtime/node" -e 'const fs=require("fs");if(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version!==process.argv[2])process.exit(1)' "$staging/release.json" "$version" \
    || { rm -rf "$staging"; fail 'Candidate runtime or release verification failed. Nothing was changed.'; }
  "$staging/runtime/node" "$staging/packaging/migrate-home.mjs" "$home" "$legacy_data" "$legacy_app" \
    || { rm -rf "$staging"; fail 'Migration failed; the earlier installation and legacy source data are preserved.'; }
  cat > "$staging/saam" <<COMMAND
#!/bin/bash
exec "$target/runtime/node" "$target/scripts/saam.mjs" "\$@"
COMMAND
  chmod +x "$staging/saam"

  # For troubleshooting: starts SAAM in a Terminal window that shows its messages.
  launcher="$staging/SAAM.command"
  cat > "$launcher" <<LAUNCHER
#!/bin/bash
# Starts SAAM $version in a Terminal window, for troubleshooting: SAAM.app starts
# it without one. Quit in SAAM Studio or close this window to stop SAAM.
# Written by install.sh; prints stay in ~/SAAM/Prints.
printf '\\033]0;SAAM - close this window to stop SAAM\\007'
"$target/runtime/node" "$target/packaging/launch.mjs"
status=\$?
if [ "\$status" -ne 0 ]; then
  echo
  echo 'SAAM stopped with an error. Its log is in ~/SAAM/state/logs.'
  read -r -p 'Press Return to close this window. ' _
fi
exit "\$status"
LAUNCHER
  chmod +x "$launcher"
  write_app "$target" "$version" "$staged_bundle" "$staging"
  # Both program files and Finder launcher are prepared before moving either
  # installed path. Preserve each predecessor until both replacements succeed.
  local moved_target=0 moved_bundle=0 installed_target=0 installed_bundle=0
  rollback() {
    local status=${1:-$?}
    trap - ERR HUP INT TERM
    if [ "$status" -ne 0 ]; then
      [ "$installed_bundle" -eq 0 ] || rm -rf "$bundle" || say "Could not remove candidate launcher at $bundle."
      [ "$installed_target" -eq 0 ] || rm -rf "$target" || say "Could not remove candidate SAAM at $target."
      if [ "$moved_target" -eq 1 ]; then { [ ! -e "$target" ] && mv "$backup" "$target"; } || say "Earlier SAAM remains recoverable at $backup."; fi
      if [ "$moved_bundle" -eq 1 ]; then { [ ! -e "$bundle" ] && mv "$backup_bundle" "$bundle"; } || say "Earlier launcher remains recoverable at $backup_bundle."; fi
      say 'SAAM replacement failed; the earlier installation was restored or its recovery path is shown above.'
    fi
    exit "$status"
  }
  trap rollback ERR
  trap 'rollback 1' HUP INT TERM
  if [ -e "$target" ]; then mv "$target" "$backup"; moved_target=1; fi
  if [ -e "$bundle" ]; then mv "$bundle" "$backup_bundle"; moved_bundle=1; fi
  # Move the prepared app bundle out before activating the program folder.
  mv "$staged_bundle" "$bundle"; installed_bundle=1
  mv "$staging" "$target"; installed_target=1
  trap - ERR HUP INT TERM
  if [ -n "$update_log" ]; then trap 'log "Update failed at install.sh line $LINENO."' ERR; fi
  rm -rf "$backup" "$backup_bundle" || say "SAAM is installed; an earlier copy remains at $backup or $backup_bundle."
  # Preserve the complete old program too: unknown user additions remain
  # recoverable, including any files not recognized by the migration boundary.
  mkdir -p "$home/state/migration"
  for earlier in "$legacy_data" "$legacy_app"; do
    if [ -e "$earlier" ] && [ "$earlier" != "$home" ] && [ "$earlier" != "$target" ]; then
      mv "$earlier" "$home/state/migration/$(basename "$(dirname "$earlier")")-$(basename "$earlier")-$transaction" \
        || say "Earlier files remain recoverable at $earlier."
    fi
  done
  if [ -z "${SAAM_INSTALL_TEST_ROOT:-}" ]; then
    # Keep one PATH addition in the user's standard macOS login and interactive
    # shells. SAAM's executable lives inside app, so no extra bin folder exists.
    for profile in "$HOME/.zprofile" "$HOME/.bash_profile"; do
      if ! grep -Fq '# SAAM application PATH' "$profile" 2>/dev/null; then
        printf '\n# SAAM application PATH\nexport PATH="%s/app:$PATH"\n' "$home" >> "$profile" \
          || say "Add $home/app to PATH, then ask the agent to repair client setup."
      fi
    done
    export PATH="$target:$PATH"
    "$target/runtime/node" "$target/packaging/client-setup.mjs" "$home" || say 'SAAM is installed; ask the agent to repair client setup.'
  else
    "$target/runtime/node" "$target/packaging/client-setup.mjs" "$home" --no-register || say 'Client guidance setup failed.'
  fi
  # Updates keep the shortcut if present, without recreating one the person removed.
  if [ -z "$wait_pid" ] && [ -z "${SAAM_INSTALL_TEST_ROOT:-}" ]; then write_desktop_shortcut "$bundle" "$HOME/Desktop/SAAM.app"; fi

  echo
  say "SAAM ${version} is installed."
  echo 'Start it from the SAAM desktop shortcut or ~/Applications/SAAM.app,'
  echo 'and stop it with Quit in its tray menu. Restart clients to discover saam.'
  echo "Your prints and settings stay in $(data_folder)."
  echo 'Starting SAAM now. Studio opens in your browser; an alpha invite is optional.'
  if [ -z "${SAAM_INSTALL_TEST_ROOT:-}" ]; then
    if [ -z "$wait_pid" ]; then open -R "$bundle" || say "SAAM is installed at $bundle."; fi
    open "$bundle"
  fi
  log 'Started SAAM.'
}

main "$@"
