#!/bin/bash
# Query the running app state via CDP bridge.
#
# Usage:
#   app-state.sh route                    # Current route path
#   app-state.sh state                    # App state
#   app-state.sh eval "1+1"               # Arbitrary JS
#   app-state.sh eval-async "Promise.resolve(1+1)"
#   app-state.sh can-go-back              # Can navigate back?
#   app-state.sh go-back                  # Navigate back
#   app-state.sh --device "Pixel 6a" state  # Target specific device

set -euo pipefail
APP_ROOT="${APP_ROOT:-$(pwd)}"
source "$(cd "$APP_ROOT" && git rev-parse --show-toplevel)/scripts/agentic/_lib.sh"
cd "$APP_ROOT"

# -- Parse --device flag ---------------------------------------------------
# Array, not a string: a device name containing spaces ("Pixel 6a") word-split
# and its tail was parsed as the command ("Unknown command: 6a").
DEVICE_ARGS=()
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device)
      DEVICE_ARGS=(--device "$2")
      shift 2
      ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

COMMAND="${POSITIONAL[0]:-route}"
# Remaining positional args after the command
EXTRA_ARGS=("${POSITIONAL[@]:1}")

# All platforms go through cdp-bridge.mjs (unified entry point)
BRIDGE_CMD=(node "${APP_ROOT}/scripts/agentic/cdp-bridge.mjs")
[[ ${#DEVICE_ARGS[@]} -gt 0 ]] && BRIDGE_CMD+=("${DEVICE_ARGS[@]}")
export WATCHER_PORT="$PORT"

case "$COMMAND" in
  route)
    "${BRIDGE_CMD[@]}" get-route
    ;;
  state)
    "${BRIDGE_CMD[@]}" get-state
    ;;
  eval)
    "${BRIDGE_CMD[@]}" eval "${EXTRA_ARGS[@]}"
    ;;
  eval-async)
    "${BRIDGE_CMD[@]}" eval-async "${EXTRA_ARGS[@]}"
    ;;
  can-go-back)
    "${BRIDGE_CMD[@]}" can-go-back
    ;;
  go-back)
    "${BRIDGE_CMD[@]}" go-back
    ;;
  press)
    "${BRIDGE_CMD[@]}" press-test-id "${EXTRA_ARGS[@]}"
    ;;
  set-input)
    "${BRIDGE_CMD[@]}" set-input "${EXTRA_ARGS[@]}"
    ;;
  scroll)
    "${BRIDGE_CMD[@]}" scroll-view "${EXTRA_ARGS[@]}"
    ;;
  *)
    echo "Usage: app-state.sh [--device <name>] <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  route                          Current route path"
    echo "  state                          App state"
    echo "  eval <expression>              Evaluate arbitrary JS in app context"
    echo "  eval-async <expression>        Evaluate a Promise-returning expression"
    echo "  can-go-back                    Check if navigation can go back"
    echo "  go-back                        Navigate back"
    echo "  press <testId>                 Press a component by testID"
    echo "  set-input <testId> <value>     Set a text input by testID"
    echo "  scroll [--test-id <id>] [--offset <n>] [--no-animated]"
    echo "                                 Scroll a ScrollView/FlatList by testID or globally"
    echo ""
    echo "Options:"
    echo "  --device <name>        Target a specific device (substring match)"
    exit 1
    ;;
esac
