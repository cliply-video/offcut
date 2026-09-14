#!/bin/sh
# Offcut installer for macOS: curl -fsSL https://offcut.cliply.video/install.sh | sh
set -eu

REPO="cliply-video/offcut"

say() { printf '\033[36m==>\033[0m %s\n' "$1"; }
die() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "this installer is macOS-only. Other platforms: https://offcut.cliply.video/#download"

# The updater manifest has the exact asset URL (names changed across renames) and,
# unlike the GitHub API, isn't rate-limited.
manifest=$(curl -fsSL "https://github.com/$REPO/releases/latest/download/latest.json") \
  || die "could not reach GitHub Releases"
case "$(uname -m)" in
  arm64) key="darwin-aarch64" ;;
  *) key="darwin-x86_64" ;;
esac
url=$(printf '%s\n' "$manifest" | awk -v k="\"$key\"" '
  index($0, k) { found = 1 }
  found && /"url"/ { sub(/.*"url": *"/, ""); sub(/".*/, ""); print; exit }')
case "$url" in *.app.tar.gz) ;; *) url="" ;; esac
[ -n "$url" ] || url=$(printf '%s\n' "$manifest" | grep -o 'https://[^"]*\.app\.tar\.gz' | head -n 1)
[ -n "$url" ] || die "no macOS build in the latest release"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

say "Downloading ${url##*/}"
curl -fL --progress-bar "$url" -o "$tmp/app.tar.gz" || die "download failed"
tar -xzf "$tmp/app.tar.gz" -C "$tmp" || die "could not extract the archive"

app=$(find "$tmp" -maxdepth 1 -name '*.app' -type d | head -n 1)
[ -n "$app" ] || die "no .app found in the archive"
name=$(basename "$app")

dest="/Applications"
if [ ! -w "$dest" ]; then
  dest="$HOME/Applications"
  mkdir -p "$dest"
fi

if pgrep -xq "${name%.app}"; then
  say "Quitting running ${name%.app}"
  osascript -e "quit app \"${name%.app}\"" >/dev/null 2>&1 || true
  sleep 1
fi

say "Installing $name to $dest"
rm -rf "${dest:?}/$name"
mv "$app" "$dest/"
# Downloads via curl aren't quarantined; this only matters if a previous .dmg install left the flag.
xattr -dr com.apple.quarantine "$dest/$name" 2>/dev/null || true

say "Done. Opening $name"
open "$dest/$name"
