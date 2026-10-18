#!/usr/bin/env bash
# Run the three trade demo businesses side by side, for local testing only.
#
#   npm run demo:businesses              seed any that are missing, then start all three
#   npm run demo:businesses -- reseed    wipe and reseed all three (dates move to "now"), then start
#   npm run demo:businesses -- stop      stop all three
#   npm run demo:businesses -- status    show what is running
#
# Each business has its own database and uploads under .data/demo/<trade>/ and its own
# address. Separate host names give separate sign-in cookies, so all three can stay signed
# in at once in one browser:
#   http://handyman.localhost:3101   Brightside Handyman Co.    admin@brightside.test
#   http://locksmith.localhost:3102  Ironclad Lock & Key        admin@ironclad.test
#   http://chimney.localhost:3103    Ember & Flue Chimney Co.   admin@emberflue.test
# Every account (admin@, office@, tech1@ … tech3@) uses the password TestDrive2026!
#
# The servers run the production build (`next start`); run `npm run build` after code
# changes. Demo data is laid out around the time it is seeded, so reseed during the day
# for a realistic Today screen.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=".data/demo"
TRADES=(handyman locksmith chimney)

port_for() {
  case "$1" in
    handyman) echo 3101 ;;
    locksmith) echo 3102 ;;
    chimney) echo 3103 ;;
  esac
}

secret() {
  mkdir -p "$ROOT"
  if [ ! -s "$ROOT/.session-secret" ]; then
    node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))' >"$ROOT/.session-secret"
  fi
  cat "$ROOT/.session-secret"
}

is_running() {
  local pidfile="$ROOT/$1/server.pid"
  [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

stop_one() {
  local t=$1 pidfile="$ROOT/$1/server.pid"
  if is_running "$t"; then
    kill -TERM "$(cat "$pidfile")"
    for _ in $(seq 1 20); do is_running "$t" || break; sleep 0.5; done
    echo "stopped $t"
  fi
  rm -f "$pidfile"
}

seed_one() {
  local t=$1 reset=${2:-}
  local dir="$ROOT/$t"
  mkdir -p "$dir"
  if [ -z "$reset" ] && [ -d "$dir/db" ]; then
    echo "$t: already seeded (use 'reseed' to start over)"
    return
  fi
  echo "seeding ${t}..."
  PGLITE_DIR="$dir/db" UPLOADS_DIR="$dir/uploads" SESSION_SECRET="$(secret)" \
    npm run --silent seed:demo -- --profile="$t" ${reset:+--reset} >"$dir/seed.log" 2>&1 ||
    { echo "seeding $t failed, see $dir/seed.log"; tail -5 "$dir/seed.log"; exit 1; }
  tail -1 "$dir/seed.log"
}

start_one() {
  local t=$1 port
  port=$(port_for "$t")
  local dir="$ROOT/$t" url="http://$t.localhost:$port"
  if is_running "$t"; then
    echo "$t already running at $url"
    return
  fi
  PGLITE_DIR="$dir/db" UPLOADS_DIR="$dir/uploads" SESSION_SECRET="$(secret)" \
    APP_URL="$url" COOKIE_INSECURE=1 DEMO_PROFILE="$t" \
    nohup npx next start -p "$port" >>"$dir/server.log" 2>&1 &
  echo $! >"$dir/server.pid"
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null "http://localhost:$port/api/health"; then
      echo "$t running at $url"
      return
    fi
    sleep 1
  done
  echo "$t did not start, see $dir/server.log"
  tail -5 "$dir/server.log"
}

ensure_build() {
  if [ ! -f .next/BUILD_ID ]; then
    echo "no production build yet, running npm run build…"
    npm run build
  fi
}

case "${1:-start}" in
  start)
    ensure_build
    for t in "${TRADES[@]}"; do seed_one "$t"; done
    for t in "${TRADES[@]}"; do start_one "$t"; done
    ;;
  reseed)
    for t in "${TRADES[@]}"; do stop_one "$t"; done
    for t in "${TRADES[@]}"; do seed_one "$t" reset; done
    ensure_build
    for t in "${TRADES[@]}"; do start_one "$t"; done
    ;;
  stop)
    for t in "${TRADES[@]}"; do stop_one "$t"; done
    ;;
  status)
    for t in "${TRADES[@]}"; do
      if is_running "$t"; then echo "$t: running at http://$t.localhost:$(port_for "$t")"
      else echo "$t: stopped"; fi
    done
    ;;
  *)
    echo "usage: npm run demo:businesses [-- start|reseed|stop|status]"
    exit 2
    ;;
esac
