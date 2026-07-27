#!/usr/bin/env bash
# Run the full cross-scheme suite on the reference (home-staker) machine and
# import every result. One command; commit the resulting results/*.json.
#
#   scripts/run-reference-suite.sh <machine-label>
#   CELLS="20:32 22:32 24:32" scripts/run-reference-suite.sh <machine-label>
set -euo pipefail

MACHINE="${1:?usage: run-reference-suite.sh <machine-label>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Default: PSE 3x3 grid (entries_log2 : record_bytes). Override via $CELLS.
CELLS="${CELLS:-20:8 20:32 20:256 24:8 24:32 24:256 28:8 28:32 28:256}"
SCHEMES="${SCHEMES:-isimplepir inspire}"

if [ ! -d "$ROOT/implementations/raven" ]; then
  echo "implementations/raven missing — running setup first"
  "$ROOT/scripts/setup-implementations.sh"
fi

for cell in $CELLS; do
  elog2="${cell%%:*}"
  rbytes="${cell##*:}"
  for scheme in $SCHEMES; do
    echo "==== $scheme  2^$elog2 x ${rbytes}B  on $MACHINE ===="
    # variant arg only used by inspire; harmless for isimplepir.
    "$ROOT/scripts/bench-cell.sh" "$scheme" "$elog2" "$rbytes" two-packing "$MACHINE" \
      || echo "!! $scheme 2^$elog2 x$rbytes FAILED (likely OOM at large N) — skipping"
  done
done

echo "suite complete. review results/ and site/data/results.json, then commit + PR."
