#!/bin/bash
# SessionStart hook for AI Replay Studio.
# On every session start: install deps, scan & update local session data,
# then bring up the web app so the page is ready to open.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# 1) Dependencies (idempotent; container cache keeps this fast on later runs).
#    Non-fatal: if the environment's network policy blocks the npm registry,
#    we still want scan & update (Node built-ins only) to run and the session
#    to start cleanly.
if [ ! -x node_modules/.bin/vite ]; then
  npm install || echo "deps: npm install failed (network policy blocking the registry?) — continuing"
fi

# 2) Scan & update — rebuild src/data/claudeSessions.local.json from local
#    Claude Code / Codex transcripts. Uses only Node built-ins, so it works
#    even when dependencies could not be installed.
npm run sync || echo "sync: skipped/failed (no local transcripts?) — continuing"

# 3) Open the web app. The dev server is long-running, so start it detached and
#    leave it serving on http://127.0.0.1:5180/ for the session.
if [ ! -x node_modules/.bin/vite ]; then
  echo "web: dev server not started — vite is not installed (install deps first)"
elif curl -sf -o /dev/null http://127.0.0.1:5180/ 2>/dev/null; then
  echo "web: dev server already serving http://127.0.0.1:5180/"
else
  nohup npm run dev -- --host 127.0.0.1 > /tmp/ai-replay-studio-dev.log 2>&1 &
  echo "web: dev server starting on http://127.0.0.1:5180/ (logs: /tmp/ai-replay-studio-dev.log)"
fi
