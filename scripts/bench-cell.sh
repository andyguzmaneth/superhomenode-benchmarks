#!/usr/bin/env bash
# Run one scheme at one Ethereum-state cell and import the result.
#
#   scripts/bench-cell.sh <scheme> <entries_log2> <record_bytes> [variant] [machine-label]
#
# scheme: isimplepir | inspire
# Example: scripts/bench-cell.sh inspire 20 32 two-packing "nuc13-i7-8t"
set -euo pipefail

SCHEME="${1:?scheme: isimplepir|inspire}"
ELOG2="${2:?entries_log2}"
RBYTES="${3:?record_bytes}"
VARIANT="${4:-two-packing}"
MACHINE="${5:-$(hostname)}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAVEN="$ROOT/implementations/raven"
OUT="$ROOT/.bench-out/$SCHEME"
mkdir -p "$OUT"

CPU="$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | sed 's/^ //' || echo unknown)"
CORES="$(nproc)"
COMMIT="$(git -C "$RAVEN" rev-parse HEAD)"

# Warmup/measured/seeds: publishable discipline. Lower for quick dev runs.
COMMON="--entries-log2 $ELOG2 --record-bytes $RBYTES --full-bench --warmup 4 --measured 16 --seeds 0,1,2 --out-dir $OUT"

case "$SCHEME" in
  isimplepir)
    cargo run --release --manifest-path "$RAVEN/benches/b2-bench/Cargo.toml" --bin b2-isimplepir -- $COMMON
    IMPL="raven-isimplepir"; NICE="iSimplePIR" ;;
  inspire)
    cargo run --release --manifest-path "$RAVEN/benches/b1-bench/Cargo.toml" --features inspire --bin b1-inspire -- \
      $COMMON --variant "$VARIANT"
    IMPL="raven-inspire"; NICE="InsPIRe" ;;
  *) echo "unknown scheme: $SCHEME" >&2; exit 2 ;;
esac

# Import seed 0's report for THIS cell (all seeds share the same sizes; medians
# are stable). Never glob the accumulating out-dir — an earlier cell's report
# would win the sort and get re-imported under this cell's label.
REPORT="$OUT/seed-0/cell-2e${ELOG2}x${RBYTES}.json"
[ -f "$REPORT" ] || { echo "expected BenchReport missing: $REPORT" >&2; exit 1; }

node "$ROOT/harness/import-bench-report.mjs" \
  --file "$REPORT" --scheme "$NICE" --impl "$IMPL" \
  --repo https://github.com/hisoka-io/raven --commit "$COMMIT" \
  --machine "$MACHINE" --cpu "$CPU" --cores "$CORES" --threads "$CORES" \
  --features avx2 --security-bits 128

node "$ROOT/site/build-data.mjs"
echo "imported $NICE @ 2^$ELOG2 x ${RBYTES}B on $MACHINE"
