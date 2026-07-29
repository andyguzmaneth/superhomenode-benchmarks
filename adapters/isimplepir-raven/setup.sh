#!/usr/bin/env bash
# Shares the raven checkout with the inspire-raven adapter (props.json
# "checkout": "raven"), so this delegates rather than cloning a second copy.
set -euo pipefail
: "${IMPL_DIR:?IMPL_DIR must be set by scripts/bench.sh}"
exec "$(dirname "$0")/../inspire-raven/setup.sh"
