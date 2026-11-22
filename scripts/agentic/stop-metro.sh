#!/bin/bash
# Stop a Metro bundler instance started by start-metro.sh.
#
# Behavior:
#   Signal only verified Metro processes whose cwd is this app checkout.
#   Refuse foreign listeners and ignore stale or foreign PID-file entries.
#
# Exit 0 if Metro was stopped (or wasn't running). Exit 1 on errors.

set -euo pipefail
APP_ROOT="${APP_ROOT:-$(pwd)}"
source "$(cd "$APP_ROOT" && git rev-parse --show-toplevel)/scripts/agentic/_lib.sh"
cd "$APP_ROOT"

exec node "$MONOREPO_ROOT/scripts/agentic/lib/metro-process.mjs" stop "$APP_ROOT" "$PORT"
