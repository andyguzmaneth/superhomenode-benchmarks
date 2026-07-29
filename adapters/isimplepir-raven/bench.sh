#!/usr/bin/env bash
# Run iSimplePIR (raven's b2-isimplepir) at one cell and emit the canonical report.
set -euo pipefail

: "${IMPL_DIR:?}" "${ENTRIES_LOG2:?}" "${RECORD_BYTES:?}" "${OUT_JSON:?}" "${RAW_DIR:?}"
SEEDS="${SEEDS:-0,1,2}"
WARMUP="${WARMUP:-4}"
MEASURED="${MEASURED:-16}"

LIB="$(cd "$(dirname "$0")/../_lib" && pwd)"
mkdir -p "$RAW_DIR"

# See inspire-raven/bench.sh — prebuild keeps rustc out of the measured peak RSS.
if [ "${PREBUILD:-0}" = "1" ]; then
  exec cargo build --release --manifest-path "$IMPL_DIR/benches/b2-bench/Cargo.toml" \
    --bin b2-isimplepir
fi

cargo run --release --manifest-path "$IMPL_DIR/benches/b2-bench/Cargo.toml" \
  --bin b2-isimplepir -- \
  --entries-log2 "$ENTRIES_LOG2" --record-bytes "$RECORD_BYTES" \
  --full-bench --warmup "$WARMUP" --measured "$MEASURED" \
  --seeds "$SEEDS" --out-dir "$RAW_DIR"

CELL="cell-2e${ENTRIES_LOG2}x${RECORD_BYTES}.json"
mapfile -t REPORTS < <(
  IFS=','
  for s in $SEEDS; do
    p="$RAW_DIR/seed-$s/$CELL"
    [ -f "$p" ] && echo "$p"
  done
)
[ "${#REPORTS[@]}" -gt 0 ] || { echo "no BenchReport found for $CELL" >&2; exit 1; }

node "$LIB/raven-to-adapter.mjs" --out "$OUT_JSON" "${REPORTS[@]}"
