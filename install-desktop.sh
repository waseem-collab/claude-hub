#!/usr/bin/env bash
# Install the built Claude Hub app for this user (no sudo): app files, launcher entry, icon.
set -euo pipefail
cd "$(dirname "$0")"
SRC=dist/linux-unpacked
[ -x "$SRC/claude-hub" ] || { echo "Build first: npm run build"; exit 1; }

DEST="$HOME/.local/opt/claude-hub"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor"

mkdir -p "$DEST" "$APPS"
rsync -a --delete "$SRC/" "$DEST/"
for s in 32 48 64 128 256 512; do
  mkdir -p "$ICONS/${s}x${s}/apps"
  cp "electron/icons/$s.png" "$ICONS/${s}x${s}/apps/claude-hub.png"
done

cat > "$APPS/claude-hub.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Claude Hub
GenericName=Claude Code sessions
Comment=All your Claude Code sessions in one window
Exec="$DEST/claude-hub" %U
Icon=claude-hub
Terminal=false
Categories=Development;
StartupWMClass=claude-hub
StartupNotify=true
DESKTOP

# keep an existing "open at login" entry pointing at the installed copy
AUTO="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/claude-hub.desktop"
[ -f "$AUTO" ] && sed -i "s#^Exec=.*#Exec=\"$DEST/claude-hub\"#; s#^Icon=.*#Icon=claude-hub#" "$AUTO"

update-desktop-database "$APPS" >/dev/null 2>&1 || true
gtk-update-icon-cache -q "$ICONS" >/dev/null 2>&1 || true
echo "Installed. Open \"Claude Hub\" from your app launcher."
