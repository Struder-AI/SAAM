#!/bin/sh
# Invoke with sh saam.sh; executable bits need not survive source ZIP extraction.
set -eu
saam_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$saam_root"
action=${1:-setup}
if [ "$#" -gt 0 ]; then shift; fi
case "$action" in setup|studio|node|npm) ;; *) echo 'Usage: sh saam.sh setup [--force] | studio [print-directory] | node <script> [args] | npm <args>' >&2; exit 1;; esac
if [ "$action" = studio ]; then
    [ "$#" -le 1 ] || { echo 'Studio accepts only one print directory.' >&2; exit 1; }
    case "${1:-}" in -*) echo 'Studio accepts only a print directory.' >&2; exit 1;; esac
fi
case "$(uname -s)" in Darwin) saam_platform=darwin;; Linux) saam_platform=linux;; *) echo 'Use saam.ps1 on Windows.' >&2; exit 1;; esac
case "$(uname -m)" in x86_64|amd64) saam_arch=x64;; arm64|aarch64) saam_arch=arm64;; *) echo 'Unsupported CPU architecture.' >&2; exit 1;; esac
version= archive= sha256=
while read -r v platform arch file checksum; do
    if [ "$platform" = "$saam_platform" ] && [ "$arch" = "$saam_arch" ]; then version=$v; archive=$file; sha256=$checksum; break; fi
done < scripts/runtime.tsv
[ -n "$version" ] || { echo 'No pinned Node runtime for this platform.' >&2; exit 1; }
saam_runtime="$saam_root/runtime/node-v$version-$saam_platform-$saam_arch"
saam_node="$saam_runtime/bin/node"
if [ ! -x "$saam_node" ]; then
    [ "$action" = setup ] || { echo 'Run sh saam.sh setup once before using SAAM.' >&2; exit 1; }
    mkdir -p "$saam_root/runtime"
    download_dir=$(mktemp -d "$saam_root/runtime/.download-XXXXXXXX")
    trap 'rm -rf -- "$download_dir"' EXIT
    echo "Preparing SAAM: downloading Node $version for $saam_platform $saam_arch..."
    curl --fail --location --retry 2 --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v$version/$archive" -o "$download_dir/$archive"
    if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$download_dir/$archive"); else actual=$(shasum -a 256 "$download_dir/$archive"); fi
    actual=${actual%% *}
    [ "$actual" = "$sha256" ] || { echo 'Node archive checksum mismatch. Run setup again to retry.' >&2; exit 1; }
    echo 'Preparing SAAM: extracting the verified runtime...'
    tar -xzf "$download_dir/$archive" -C "$download_dir"
    mv "$download_dir/node-v$version-$saam_platform-$saam_arch" "$saam_runtime"
    rm -rf -- "$download_dir"
    trap - EXIT
fi
PATH="$saam_runtime/bin:$PATH"; export PATH
case "$action" in
    setup) exec "$saam_node" scripts/setup.mjs "$@";;
    studio) exec "$saam_node" studio/server.mjs "$@";;
    node) exec "$saam_node" "$@";;
    npm) exec "$saam_node" "$saam_runtime/lib/node_modules/npm/bin/npm-cli.js" "$@";;
esac
