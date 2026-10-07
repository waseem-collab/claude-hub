#!/usr/bin/env bash
# Start Claude Hub and open it in an app-style browser window.
cd "$(dirname "$0")"
PORT="${PORT:-4777}"
URL="http://localhost:$PORT"
if ! curl -s -o /dev/null "$URL"; then
  nohup node server.js > /tmp/claude-hub.log 2>&1 &
  for _ in $(seq 1 30); do curl -s -o /dev/null "$URL" && break; sleep 0.2; done
fi
for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser; do
  if command -v "$b" >/dev/null; then exec "$b" --app="$URL" >/dev/null 2>&1; fi
done
xdg-open "$URL"
