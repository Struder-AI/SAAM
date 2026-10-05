#!/bin/bash
# Installs SAAM for this macOS user into ~/SAAM/app, replacing an
# earlier installation, writes ~/Applications/SAAM.app and starts SAAM.
# Install SAAM.command runs this script inside the release's app folder;
# app.tar sits next to app/. A running SAAM updating itself uses the same path:
#   bash .../install.sh --wait-pid <pid> --workspace <dir> --workspace-token <token>
# from a home tmp workspace: it claims the workspace, waits for that SAAM to
# exit and starts the new SAAM. Either way it reports fixed diagnostic stages.
# Only a home permission failure requests native authorization; the rest runs
# as the original user.
#
# Nothing here is signed. The bundled Node.js is the official notarized build;
# SAAM's own files are scripts it runs. SAAM.app and the troubleshooting
# launcher ~/SAAM/app/SAAM.command are written by this script rather
# than copied from the download, so they carry no download quarantine.
# Quarantine attributes and Gatekeeper settings are left alone.
# Local data and state persist in ~/SAAM; legacy sources are preserved.
set -Eeuo pipefail

# main reports fixed stages (never paths, names or error text) through the
# first of these SAAM programs that has packaging/installer-report.mjs;
# installation stages are first-run evidence until SAAM starts and owns it.
diagnostic_program=''
first_run='--first-run'
report() {
  local program
  [ -n "$diagnostic_program" ] || return 0
  for program in "$diagnostic_program" "$target"; do
    [ -f "$program/packaging/installer-report.mjs" ] || continue
    "$program/runtime/node" "$program/packaging/installer-report.mjs" "$home" stage "$1" $first_run >/dev/null 2>&1 || true
    return 0
  done
}
fail() { report failed; printf '\n%s\n' "$1" >&2; exit 1; }
# The installer, not its launcher, owns an update's workspace while it reads it.
workspace_owner() {
  [ -z "$workspace" ] || "$target/runtime/node" "$target/packaging/installer-report.mjs" "$home" "$1" "$workspace" "$workspace_token" "$$" >/dev/null 2>&1 || true
}

# Resolve the exact home before authorization; never grant access to a system
# directory or follow a home symlink. Only this directory's ownership is changed.
preparation_home() {
  local requested="$1" ancestor suffix='' canonical
  case "$requested" in /*) ;; *) fail 'The SAAM home must be an absolute path.' ;; esac
  requested="${requested%/}"
  [ -n "$requested" ] || requested='/'
  case "/$requested/" in */../*|*/./*) fail 'The SAAM home cannot contain relative path components.' ;; esac
  [ ! -L "$requested" ] || fail 'The SAAM home cannot be a symbolic link.'
  ancestor="${requested%/}"
  [ -n "$ancestor" ] || ancestor='/'
  while [ ! -e "$ancestor" ]; do
    suffix="/$(basename "$ancestor")$suffix"
    ancestor="$(dirname "$ancestor")"
  done
  [ -d "$ancestor" ] || fail 'The SAAM home must be a directory.'
  canonical="$(cd "$ancestor" && pwd -P)"
  canonical="${canonical%/}$suffix"
  [ -n "$canonical" ] || canonical='/'
  case "$canonical" in /|/System|/System/*|/Library|/Library/*|/Applications|/Applications/*|/usr|/usr/*|/bin|/bin/*|/sbin|/sbin/*|/dev|/dev/*|/etc|/etc/*|/private|/private/etc|/private/etc/*|/private/var|/Users) fail 'The SAAM home cannot be a system directory.' ;; esac
  [ "$(dirname "$canonical")" != '/Users' ] || fail 'Use a SAAM directory inside the user home, not the entire user home.'
  [ "$canonical" != "$HOME" ] || fail 'Use a SAAM directory inside your home, not your entire home folder.'
  printf '%s' "$canonical"
}

prepare_home_helper() {
  local home="$1" owner="$2" group="$3" receipt="$4"
  [ "$(id -u)" -eq 0 ] || fail 'Home preparation requires native administrator authorization.'
  [[ "$owner" =~ ^[0-9]+$ && "$owner" -ne 0 && "$group" =~ ^[0-9]+$ ]] || fail 'Invalid original-user identity.'
  home="$(preparation_home "$home")"
  # The parent creates this original-user receipt before requesting authorization.
  [ -f "$receipt" ] && [ ! -L "$receipt" ] && [ ! -s "$receipt" ] || fail 'Invalid home preparation receipt.'
  case "$(basename "$receipt")" in saam-home.*) ;; *) fail 'Invalid home preparation receipt name.' ;; esac
  printf 'helper-started\n' > "$receipt"
  mkdir -p "$home"
  chown "$owner:$group" "$home"
  chmod u+rwx "$home"
  printf 'complete\n' >> "$receipt"
}

probe_home() {
  local home="$1" probe
  mkdir -p "$home" || return
  probe="$(mktemp -d "$home/.saam-write.XXXXXX")" || return
  rmdir "$probe"
}

ensure_home() {
  local home="$1" script="$2" error_file receipt outcome status owner group
  error_file="$(mktemp "${TMPDIR:-/tmp/}saam-access.XXXXXX")"
  if LC_ALL=C probe_home "$home" 2> "$error_file"; then rm -f "$error_file"; return; fi
  # Only permission failures can benefit from authorization. Disk, path and
  # read-only filesystem failures must not produce an administrator prompt.
  if ! grep -Eq 'Permission denied|Operation not permitted' "$error_file"; then
    outcome="$(cat "$error_file")"; rm -f "$error_file"; fail "Cannot prepare the SAAM home: $outcome"
  fi
  rm -f "$error_file"
  [ -z "${SAAM_INSTALL_TEST_ROOT:-}" ] || fail 'The isolated home is not writable; native authorization is disabled for temporary trials.'
  owner="$(id -u)"; group="$(id -g)"
  receipt="$(mktemp "${TMPDIR:-/tmp/}saam-home.XXXXXX")"
  echo 'Home authorization: requested macOS authorization for home preparation only. This does not confirm that a prompt appeared.'
  # AppleScript receives argv, and quotes every shell argument itself. Even
  # alternate administrator credentials cannot change the original-user UID.
  if outcome="$(/usr/bin/osascript - "$script" '--prepare-home' "$home" "$owner" "$group" "$receipt" <<'AUTHORIZATION'
on run argv
  set commandText to "/bin/bash"
  repeat with argument in argv
    set commandText to commandText & " " & quoted form of (contents of argument)
  end repeat
  try
    do shell script commandText with administrator privileges
    return "complete"
  on error errorMessage number errorNumber
    return "error " & errorNumber & ": " & errorMessage
  end try
end run
AUTHORIZATION
)"; then status=0; else status=$?; fi
  if grep -q '^helper-started$' "$receipt"; then echo 'Home authorization: helper started.'; fi
  if [ "$status" -eq 0 ] && [ "$outcome" = 'complete' ] && grep -q '^complete$' "$receipt"; then
    rm -f "$receipt"
    probe_home "$home" || fail 'Home authorization: failed; original-user access is still unavailable.'
    echo 'Home authorization: complete; original-user access verified.'
    return
  fi
  rm -f "$receipt"
  case "$outcome" in
    'error -128:'*|'error -60006:'*) fail 'Home authorization: cancelled; installation stopped before replacement.' ;;
    'error -60005:'*|'error -60007:'*) fail 'Home authorization: denied; installation stopped before replacement.' ;;
    *) fail "Home authorization: failed ($outcome; osascript exit $status). Installation stopped before replacement." ;;
  esac
}

data_folder() {
  if [ "${SAAM_DATA:-}" = "$HOME/Library/Application Support/SAAM" ]; then printf '%s' "${SAAM_INSTALL_TEST_ROOT:-$HOME/SAAM}"
  else printf '%s' "${SAAM_INSTALL_TEST_ROOT:-${SAAM_DATA:-$HOME/SAAM}}"; fi
}

# True while SAAM runs: an instance record names a live node process, or node
# runs an installation's launch.mjs. Other node processes from the installation
# (saam commands, runtime hosts, 0.3.0 client servers) do not hold it open.
saam_running() {
  local record pid
  for record in "$(data_folder)/state/instance.json" "$HOME/Library/Application Support/SAAM/instance.json"; do
  if [ -f "$record" ]; then
    pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$record" | head -n 1)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o comm= | grep -q node; then return 0; fi
  fi
  done
  pgrep -f "$(data_folder)/app/packaging/launch.mjs|$HOME/Applications/SAAM/packaging/launch.mjs" >/dev/null 2>&1
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
# tray menu. Written by install.sh; prints stay in ~/SAAM/local/Prints.
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
    echo "Kept the existing desktop item at $shortcut. SAAM is in your home Applications folder."
  elif ln -s "$bundle" "$shortcut"; then
    echo 'Created the SAAM desktop shortcut.'
  else
    echo 'Could not create the desktop shortcut. Open SAAM from your home Applications folder.'
  fi
}

main() {
  local here source archive version target staging launcher wait_pid='' workspace='' workspace_token='' waited applications bundle staged_bundle backup backup_bundle home legacy_data legacy_app transaction
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --wait-pid) wait_pid="${2:-}"; [[ "$wait_pid" =~ ^[0-9]+$ ]] || fail 'Give --wait-pid a process id.' ;;
      --workspace) workspace="${2:-}" ;;
      --workspace-token) workspace_token="${2:-}" ;;
      *) fail "Unknown option $1. Run: bash install.sh [--wait-pid <pid>]" ;;
    esac
    shift 2 || fail "Give $1 a value."
  done
  [ "$(id -u)" -ne 0 ] || fail 'Launch the installer normally, without sudo. It requests native authorization itself only if home preparation needs it; client registration must use your normal account.'
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
  workspace_owner claim
  diagnostic_program="$target"
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
  # Validate the payload before requesting native home authorization.
  local entries entry normalized manifest_entry='' archive_version required_files
  required_files='runtime/node release.json packaging/launch.mjs scripts/saam.mjs packaging/migrate-home.mjs packaging/client-setup.mjs packaging/installer-report.mjs packaging/macos/SAAM.icns packaging/macos/install.sh'
  entries="$(tar -tf "$archive")" || fail 'The release archive cannot be read. Nothing was changed.'
  while IFS= read -r entry; do
    normalized="${entry#./}"
    [ -n "$normalized" ] && [ "$normalized" != '.' ] || continue
    case "/$normalized/" in *'/../'*|//*|*:*|*\\*) fail 'The release archive contains an unsafe path. Nothing was changed.' ;; esac
    [ "$normalized" != 'release.json' ] || manifest_entry="$entry"
  done <<< "$entries"
  for required in $required_files; do
    printf '%s\n' "$entries" | sed 's,^\./,,' | grep -Fx "$required" >/dev/null || fail "The release archive has no $required. Nothing was changed."
  done
  archive_version="$(tar -xOf "$archive" "$manifest_entry" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)" || fail 'The archived release metadata cannot be read. Nothing was changed.'
  [ "$archive_version" = "$version" ] || fail 'The release versions disagree. Nothing was changed.'
  home="$(preparation_home "$home")"
  target="$home/app"

  # Work from outside the folder being replaced (SAAM may have started us from there).
  cd "$HOME"
  if [ -n "$wait_pid" ]; then
    echo "Updating to SAAM ${version:-(unknown version)} from $archive; waiting for SAAM (process $wait_pid) to exit."
    waited=0
    while kill -0 "$wait_pid" 2>/dev/null; do
      [ "$waited" -lt 60 ] || fail "SAAM (process $wait_pid) did not exit within 60 seconds; the update to $version was not installed."
      sleep 1; waited=$((waited + 1))
    done
  fi
  echo "Installing SAAM ${version:-(unknown version)} for $(id -un) into $target."
  # The SAAM being updated has exited, so this refuses only another running SAAM.
  if saam_running; then fail 'SAAM is running. Choose Quit in Studio or the SAAM menu, then run install.sh again.'; fi
  ensure_home "$home" "$here/install.sh"
  trap 'report failed' ERR

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
  for required in $required_files; do
    [ -f "$staging/$required" ] || { rm -rf "$staging"; fail "The candidate has no $required. Nothing was changed."; }
  done
  # A release built on Windows carries no executable bits.
  chmod +x "$staging/runtime/node" "$staging"/packaging/macos/*.sh
  "$staging/runtime/node" -e 'const fs=require("fs");if(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version!==process.argv[2])process.exit(1)' "$staging/release.json" "$version" \
    || { rm -rf "$staging"; fail 'Candidate runtime or release verification failed. Nothing was changed.'; }
  diagnostic_program="$staging"; report candidate-verified
  "$staging/runtime/node" "$staging/packaging/migrate-home.mjs" "$home" "$legacy_data" "$legacy_app" \
    || { report failed; diagnostic_program=''; rm -rf "$staging"; fail 'Migration failed; the earlier installation and legacy source data are preserved.'; }
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
# Written by install.sh; prints stay in ~/SAAM/local/Prints.
printf '\\033]0;SAAM - close this window to stop SAAM\\007'
"$target/runtime/node" "$target/packaging/launch.mjs"
status=\$?
if [ "\$status" -ne 0 ]; then
  echo
  echo 'SAAM stopped with the error shown above.'
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
      report failed
      [ "$installed_bundle" -eq 0 ] || rm -rf "$bundle" || echo "Could not remove candidate launcher at $bundle."
      [ "$installed_target" -eq 0 ] || rm -rf "$target" || echo "Could not remove candidate SAAM at $target."
      if [ "$moved_target" -eq 1 ]; then { [ ! -e "$target" ] && mv "$backup" "$target"; } || echo "Earlier SAAM remains recoverable at $backup."; fi
      if [ "$moved_bundle" -eq 1 ]; then { [ ! -e "$bundle" ] && mv "$backup_bundle" "$bundle"; } || echo "Earlier launcher remains recoverable at $backup_bundle."; fi
      echo 'SAAM replacement failed; the earlier installation was restored or its recovery path is shown above.'
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
  trap 'report failed' ERR
  rm -rf "$backup" "$backup_bundle" || echo "SAAM is installed; an earlier copy remains at $backup or $backup_bundle."
  # Versions before 0.3.3 extracted updates and wrote logs here.
  rm -rf "$home/state/updates" "$home/state/logs" || true
  # Preserve the complete old program too: unknown user additions remain
  # recoverable, including any files not recognized by the migration boundary.
  mkdir -p "$home/state/migration"
  for earlier in "$legacy_data" "$legacy_app"; do
    if [ -e "$earlier" ] && [ "$earlier" != "$home" ] && [ "$earlier" != "$target" ]; then
      mv "$earlier" "$home/state/migration/$(basename "$(dirname "$earlier")")-$(basename "$earlier")-$transaction" \
        || echo "Earlier files remain recoverable at $earlier."
    fi
  done
  if [ -z "${SAAM_INSTALL_TEST_ROOT:-}" ]; then
    # Keep one PATH addition in the user's standard macOS login and interactive
    # shells. SAAM's executable lives inside app, so no extra bin folder exists.
    for profile in "$HOME/.zprofile" "$HOME/.bash_profile"; do
      if ! grep -Fq '# SAAM application PATH' "$profile" 2>/dev/null; then
        printf '\n# SAAM application PATH\nexport PATH="%s/app:$PATH"\n' "$home" >> "$profile" \
          || echo "Add $home/app to PATH, then ask the agent to repair client setup."
      fi
    done
    export PATH="$target:$PATH"
    "$target/runtime/node" "$target/packaging/client-setup.mjs" "$home" || echo 'SAAM is installed; ask the agent to repair client setup.'
  else
    "$target/runtime/node" "$target/packaging/client-setup.mjs" "$home" --no-register || echo 'Client guidance setup failed.'
  fi
  # Updates keep the shortcut if present, without recreating one the person removed.
  if [ -z "$wait_pid" ] && [ -z "${SAAM_INSTALL_TEST_ROOT:-}" ]; then write_desktop_shortcut "$bundle" "$HOME/Desktop/SAAM.app"; fi

  echo
  echo "SAAM ${version} is installed."
  echo 'Start it from the SAAM desktop shortcut or ~/Applications/SAAM.app,'
  echo 'and stop it with Quit in its tray menu. Restart clients to discover saam.'
  echo "Your prints and settings stay in $(data_folder)."
  # Startup removes the completed workspace; SAAM owns first-run evidence from here.
  workspace_owner complete
  report starting; first_run=''
  echo 'Starting SAAM now. Studio opens in your browser; an alpha invite is optional.'
  if [ -z "${SAAM_INSTALL_TEST_ROOT:-}" ]; then
    if [ -z "$wait_pid" ]; then open -R "$bundle" || echo "SAAM is installed at $bundle."; fi
    open "$bundle"
  fi
}

if [ "${1:-}" = '--prepare-home' ]; then
  [ "$#" -eq 5 ] || fail 'Invalid home preparation arguments.'
  prepare_home_helper "$2" "$3" "$4" "$5"
else
  main "$@"
fi
