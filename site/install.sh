#!/bin/sh
# Offcut installer for macOS: curl -fsSL https://offcut.cliply.video/install.sh | sh
set -eu

REPO="cliply-video/offcut"

say() { printf '\033[36m==>\033[0m %s\n' "$1"; }
die() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "this installer is macOS-only. Other platforms: https://offcut.cliply.video/#download"

# Asset prefix changed across renames (Cliply.Exporter_ → Offcut_), so match the suffix.
url=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
  | grep -o '"browser_download_url": *"[^"]*_universal\.app\.tar\.gz"' \
  | head -n 1 | sed 's/.*"\(https:[^"]*\)"/\1/' || true)
[ -n "$url" ] || url="https://github.com/$REPO/releases/latest/download/Offcut_universal.app.tar.gz"

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
