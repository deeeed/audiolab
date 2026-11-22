#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/env.sh"
cd "${1:?repo path required}"
export YARN_CACHE_FOLDER="$PWD/.agent/cache/yarn"
mkdir -p "$YARN_CACHE_FOLDER"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 yarn install --immutable # NOSONAR: locked bootstrap requires workspace prepare, native prebuilts and patch-package lifecycle hooks.
(cd apps/playground && yarn build:deps)
bash "$SCRIPT_DIR/prepare-web.sh" "$PWD"

if [[ "${IOS_DEVICE_UDID:-}" =~ ^[A-Fa-f0-9-]{16,36}$ ]]; then
  if [[ ! -x "$PWD/.agent/tools/ios/bin/python" ]]; then
    "$AUDIOLAB_PYTHON_BIN" -m venv "$PWD/.agent/tools/ios"
  fi
  # A cancelled pip install can leave a working Python without capture tools.
  if ! "$PWD/.agent/tools/ios/bin/python" -c 'import importlib.metadata; import pymobiledevice3.services.dvt.instruments.screenshot; assert importlib.metadata.version("pymobiledevice3") == "11.26.0"' >/dev/null 2>&1; then
    PIP_CACHE_DIR="$PWD/.agent/cache/pip" "$PWD/.agent/tools/ios/bin/pip" --isolated install \
      --index-url https://pypi.org/simple pymobiledevice3==11.26.0
  fi
fi
