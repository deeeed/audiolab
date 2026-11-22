#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
APP_ROOT="$(pwd)"
export APP_VARIANT="${APP_VARIANT:-development}"
export EXPO_PUBLIC_FARMSLOT_RECIPE_BRIDGE="${EXPO_PUBLIC_FARMSLOT_RECIPE_BRIDGE:-1}"

if [ "${PLATFORM:-ios}" = "android" ]; then
  bash scripts/sync-android-dev-config.sh
fi

bash "$(git rev-parse --show-toplevel)/scripts/agentic/preflight.sh" "$@"

if [ "${PLATFORM:-ios}" = "android" ]; then
  bash scripts/agentic/android-doctor.sh
fi
