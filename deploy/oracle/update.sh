#!/usr/bin/env bash
# Brings the site on the Oracle server up to date with GitHub's main (deploy/oracle). Run as root: every 10 minutes
# by mwuk-update.timer, or by hand:
#
#   sudo bash /srv/mwuk/app/deploy/oracle/update.sh [--force]
#
# Nothing new on GitHub: it stops at once. Otherwise:
#   1. it moves the code to the new commit; the database, uploads and .env are git-ignored and stay as they are;
#   2. it lays /srv/mwuk/local over it: the files the PC's builds always took from its own copy, not from git;
#   3. it installs packages, if their lists changed;
#   4. it builds the page beside the live one and swaps it in (the old build's files stay a fortnight, for tabs
#      still open on it);
#   5. it restarts the site, if the server's code, its Python or these settings changed.
# --force: all of it, whatever changed.
set -euo pipefail
# runs from a copy: the update replaces this very file
if [ "${MWUK_UPDATE_COPY:-}" != 1 ]; then cp "$0" /tmp/mwuk-update.sh; MWUK_UPDATE_COPY=1 exec bash /tmp/mwuk-update.sh "$@"; fi

ROOT=/srv/mwuk
APP=$ROOT/app
UV=$ROOT/.local/bin/uv
FORCE=0; [ "${1:-}" = --force ] && FORCE=1
as() { runuser -u mwuk -- "$@"; }

exec 9>/run/mwuk-update.lock
flock -n 9 || { echo "an update is already running"; exit 0; }
cd "$APP"

as git fetch --quiet origin main
OLD=$(as git rev-parse HEAD)
NEW=$(as git rev-parse origin/main)
if [ "$OLD" = "$NEW" ] && [ "$FORCE" = 0 ] && [ -d dist ]; then exit 0; fi
CHANGED=$(as git diff --name-only "$OLD" "$NEW" || true)
has() { [ "$FORCE" = 1 ] || grep -qE "$1" <<<"$CHANGED"; }
echo "updating ${OLD:0:7} -> ${NEW:0:7}"

as git reset --quiet --hard "$NEW"
if [ -d "$ROOT/local" ]; then as cp -a "$ROOT/local/." "$APP/"; fi

if has '^package(-lock)?\.json$' || [ ! -d node_modules ]; then
  as npm ci --no-audit --no-fund --loglevel=error
fi
if has '^deploy/oracle/requirements\.txt$'; then
  as "$UV" pip install --quiet --python "$ROOT/venv/bin/python" -r deploy/oracle/requirements.txt
fi
if has '^deploy/oracle/'; then
  install -m 644 deploy/oracle/mwuk.env "$ROOT/mwuk.env"
  install -m 644 deploy/oracle/mwuk.service deploy/oracle/mwuk-update.service deploy/oracle/mwuk-update.timer /etc/systemd/system/
  sed "s/__IP__/$(cat "$ROOT/ip")/" deploy/oracle/Caddyfile > /etc/caddy/Caddyfile
  systemctl daemon-reload
  systemctl reload caddy || true
fi

# the page, if anything it is built from changed
if has '^(src/|public/|index\.html$|vite\.config|tailwind\.config|postcss\.config|jsconfig|components\.json$|package(-lock)?\.json$)' || [ ! -d dist ]; then
  as rm -rf dist-next
  as env NODE_OPTIONS=--max-old-space-size=3072 npx vite build --outDir dist-next --emptyOutDir --logLevel warn
  if [ -d dist/assets ]; then as cp -an dist/assets/. dist-next/assets/ 2>/dev/null || true; fi
  find dist-next/assets -type f -mtime +14 -delete 2>/dev/null || true
  rm -rf dist-old
  if [ -d dist ]; then mv dist dist-old; fi
  mv dist-next dist
  rm -rf dist-old
fi

# the server, if its code, its Python or these settings changed (or it is not running)
if has '^(server/|tools/|package(-lock)?\.json$|deploy/oracle/)' || ! systemctl is-active --quiet mwuk; then
  systemctl restart mwuk
fi
echo "updated to ${NEW:0:7}"
