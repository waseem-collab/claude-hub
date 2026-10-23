#!/usr/bin/env bash
# Install (or update) the Claude Hub desktop app on this system, then open it.
#   ./run.sh            install/update the app if needed and open it
#   ./run.sh --browser  old behaviour: run the server and open it in a browser window
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "--browser" ]; then
  PORT="${PORT:-4777}"
  URL="http://localhost:$PORT"
  if ! curl -s -o /dev/null "$URL"; then
    nohup node server.js > /tmp/claude-hub.log 2>&1 &
    for _ in $(seq 1 30); do curl -s -o /dev/null "$URL" && break; sleep 0.2; done
  fi
  for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser; do
    if command -v "$b" >/dev/null; then exec "$b" --app="$URL" >/dev/null 2>&1; fi
  done
  exec xdg-open "$URL"
fi

# Use Node 18+ for building: an old system node (e.g. /usr/bin/node 12) breaks electron-builder.
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]; }
if ! node_ok && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1 && nvm use --silent default >/dev/null 2>&1 || true
fi
if ! node_ok; then
  for d in "$HOME"/.nvm/versions/node/*/bin; do
    [ -x "$d/node" ] && [ "$("$d/node" -p 'process.versions.node.split(".")[0]')" -ge 18 ] && PATH="$d:$PATH"
  done
fi

APP_DIR="$HOME/.local/opt/claude-hub"
APP="$APP_DIR/claude-hub"
STAMP="$APP_DIR/.source-hash"

# Fingerprint of everything that goes into the app; rebuild only when it changes.
HASH=$(cat package.json server.js install-desktop.sh $(find public electron -type f | sort) | sha256sum | cut -d' ' -f1)

if [ ! -x "$APP" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$HASH" ]; then
  command -v npm >/dev/null || { echo "npm not found: install Node.js 18+ first."; exit 1; }
  if [ ! -d node_modules/electron ]; then
    echo "Installing dependencies (first time only)…"
    npm install --no-audit --no-fund
  fi
  echo "Building Claude Hub…"
  npm run --silent build > /tmp/claude-hub-build.log 2>&1 || { echo "Build failed, see /tmp/claude-hub-build.log"; exit 1; }
  ./install-desktop.sh
  echo "$HASH" > "$STAMP"
else
  echo "Claude Hub is installed and up to date."
fi

# If the app is already open, this just brings its window to the front.
nohup "$APP" > /dev/null 2>&1 &
disown
echo "Opened Claude Hub. Next time you can start it from your app launcher."
