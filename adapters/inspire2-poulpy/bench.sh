#!/usr/bin/env bash
# Run poulpy-pir's InsPIRe² (recursion, gamma0=32) construction at one cell.
# Identical driving to inspire-poulpy — only the collapse differs, so it
# delegates rather than duplicating the invocation.
set -euo pipefail
export POULPY_COLLAPSE="recursion-g32"
exec "$(dirname "$0")/../inspire-poulpy/bench.sh"
