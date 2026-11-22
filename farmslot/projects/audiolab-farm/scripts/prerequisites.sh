#!/bin/bash
set -euo pipefail
export IOS_DEVICE_UDID="${1:-${IOS_DEVICE_UDID:-}}"
source "$(dirname "$0")/configured-paths.sh"
audiolab_check_paths
