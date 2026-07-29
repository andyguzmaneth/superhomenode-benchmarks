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
  # `adapters/` also holds _lib/ and README.md. The trailing `|| true` matters:
  # under `set -e` the loop's exit status is that of its last iteration, so a
  # final non-adapter directory would abort the whole suite before it printed
  # anything at all.
  IMPLS="$(cd "$ROOT/adapters" && for d in */; do
    [ -f "${d}props.json" ] && echo "${d%/}"
  done || true)"
fi

if [ -z "$IMPLS" ]; then
  echo "no adapters found under $ROOT/adapters" >&2
  exit 1
fi

echo "adapters: $(echo "$IMPLS" | tr '\n' ' ')"

for impl in $IMPLS; do
  echo
  echo "######## $impl ########"
  # One implementation failing every cell must not take the suite down with it.
  "$ROOT/scripts/bench.sh" --impl "$impl" --profile "$PROFILE" \
    || echo "!! adapter $impl exited non-zero — continuing with the rest"
done

echo
echo "suite complete. review results/ and site/data/results.json, then commit."
