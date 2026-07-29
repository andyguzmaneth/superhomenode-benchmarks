#!/usr/bin/env bash
# Run InsPIRe (raven's b1-inspire) at one cell and emit the canonical report.
set -euo pipefail

: "${IMPL_DIR:?}" "${ENTRIES_LOG2:?}" "${RECORD_BYTES:?}" "${OUT_JSON:?}" "${RAW_DIR:?}"
SEEDS="${SEEDS:-0,1,2}"
WARMUP="${WARMUP:-4}"
MEASURED="${MEASURED:-16}"
VARIANT="${INSPIRE_VARIANT:-two-packing}"

LIB="$(cd "$(dirname "$0")/../_lib" && pwd)"
mkdir -p "$RAW_DIR"

# The driver calls us once with PREBUILD=1 so that rustc's memory never lands in
# the measured run's peak RSS.
if [ "${PREBUILD:-0}" = "1" ]; then
  exec cargo build --release --manifest-path "$IMPL_DIR/benches/b1-bench/Cargo.toml" \
    --features inspire --bin b1-inspire
fi

cargo run --release --manifest-path "$IMPL_DIR/benches/b1-bench/Cargo.toml" \
  --features inspire --bin b1-inspire -- \
  --entries-log2 "$ENTRIES_LOG2" --record-bytes "$RECORD_BYTES" \
  --full-bench --warmup "$WARMUP" --measured "$MEASURED" \
  --seeds "$SEEDS" --out-dir "$RAW_DIR" --variant "$VARIANT"

# raven writes one report per seed at a deterministic path. Collect every seed
# that landed — never glob the whole out-dir, an earlier cell's report would be
# picked up under this cell's label (the bug fixed in 92e51f0).
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
