#!/bin/bash
set -euo pipefail
PLATFORM="${1:?platform required}"
SLOT_ID="${2:?slot id required}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
POOL_DIR="${SCRIPT_DIR}/../../../pool"
source "${SCRIPT_DIR}/../../../scripts/lib/slot-common.sh"
load_slot_vars "$SLOT_ID"
command -v node >/dev/null
command -v yarn >/dev/null
case "$PLATFORM" in
  ios) xcrun simctl list devices available >/dev/null ;;
  android) command -v adb >/dev/null ;;
esac
# Core onboarding leaves proof resources off. Dependencies belong to prepare.
mkdir -p "${REPO}/apps/playground/.agent"
node --check "${REPO}/scripts/agentic/recipe/run.mjs"
