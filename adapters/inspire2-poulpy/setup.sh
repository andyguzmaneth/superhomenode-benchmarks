#!/usr/bin/env bash
# Shares the poulpy-pir checkout with the inspire-poulpy adapter
# (props.json "checkout": "poulpy-pir") — same crate, two constructions.
set -euo pipefail
: "${IMPL_DIR:?IMPL_DIR must be set by scripts/bench.sh}"
exec "$(dirname "$0")/../inspire-poulpy/setup.sh"
