#!/bin/bash
set -euo pipefail
SUPPORT_SCRIPT_PATH="${1:?support script required}"
shift
# Farmslot supplies home-relative support paths; quoted arguments keep ~ literal.
case "$SUPPORT_SCRIPT_PATH" in
  '~/'*) SUPPORT_SCRIPT_PATH="$HOME/${SUPPORT_SCRIPT_PATH:2}" ;;
esac
exec bash "$SUPPORT_SCRIPT_PATH" "$@"
