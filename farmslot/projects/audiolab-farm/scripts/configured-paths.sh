#!/bin/bash
# Shared read-only checks for prepare and project runtime hooks.
audiolab_missing_tool() {
  echo "missing $1 on ${FARMSLOT_MACHINE:-$(hostname)}, set $2 in this node's pool.env" >&2
  return 1
}

audiolab_require_executable() {
  local name="$1" label="$2" value="${!1:-}"
  if [[ "$value" != /* ]] || [[ ! -f "$value" || ! -x "$value" ]]; then
    audiolab_missing_tool "$label" "$name"
  fi
}

audiolab_check_paths() {
  if [[ "${AUDIOLAB_NODE_BIN:-}" != /* ]] || [[ ! -d "$AUDIOLAB_NODE_BIN" || ! -x "$AUDIOLAB_NODE_BIN/node" ]]; then
    audiolab_missing_tool Node AUDIOLAB_NODE_BIN
    return 1
  fi
  if [[ "${IOS_DEVICE_UDID:-}" =~ ^[A-Fa-f0-9-]{16,36}$ ]]; then
    audiolab_require_executable AUDIOLAB_PYTHON_BIN Python3.12 || return 1
    local version
    version="$("$AUDIOLAB_PYTHON_BIN" -c 'import sys; print("%s.%s" % sys.version_info[:2])' 2>/dev/null)" || {
      audiolab_missing_tool Python3.12 AUDIOLAB_PYTHON_BIN
      return 1
    }
    if [[ "$version" != 3.12 ]]; then
      audiolab_missing_tool Python3.12 AUDIOLAB_PYTHON_BIN
    fi
  fi
}
