#!/bin/bash
# Import the same managed credentials as the existing Audiolab project.
# Keep values off stdout and never load credential files.
source "$(dirname "${BASH_SOURCE[0]}")/configured-paths.sh"
audiolab_check_paths || return 1
export PATH="$AUDIOLAB_NODE_BIN:$PATH"
for key in AUDIOLAB_NPM_TOKEN EAS_PROJECT_ID APPLE_TEAM_ID; do
  if [ -z "${!key:-}" ]; then
    value="$(launchctl getenv "$key" 2>/dev/null || true)"
    if [ -z "$value" ]; then
      value="$(tmux show-environment -g "$key" 2>/dev/null | sed "s/^$key=//" || true)"
    fi
    if [ -n "$value" ]; then export "$key=$value"; fi
  fi
done
# Public npm installs use the same empty-token default as CI.
export AUDIOLAB_NPM_TOKEN="${AUDIOLAB_NPM_TOKEN-}"
unset value key

audiolab_app_root() {
  node "$1/scripts/agentic/lib/runtime-config.cjs" app-root "$1"
}
