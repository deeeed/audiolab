#!/bin/bash
set -euo pipefail
exec bash "$(dirname "$0")/common.sh" web "$@"
