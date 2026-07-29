#!/usr/bin/env bash
# Run every adapter over the full grid on the frozen reference machine.
#
#   scripts/run-suite.sh                     # all adapters, full grid
#   IMPLS="inspire-raven inspire-poulpy" scripts/run-suite.sh
#   PROFILE=smoke scripts/run-suite.sh       # one cell per adapter, for wiring up
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${PROFILE:-full}"

if [ -z "${IMPLS:-}" ]; then
  IMPLS="$(cd "$ROOT/adapters" && for d in */; do [ -f "${d}props.json" ] && echo "${d%/}"; done)"
fi

for impl in $IMPLS; do
  echo
  echo "######## $impl ########"
  # One implementation failing every cell must not take the suite down with it.
  "$ROOT/scripts/bench.sh" --impl "$impl" --profile "$PROFILE" \
    || echo "!! adapter $impl exited non-zero — continuing with the rest"
done

echo
echo "suite complete. review results/ and site/data/results.json, then commit."
