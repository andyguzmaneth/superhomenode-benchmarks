#!/usr/bin/env bash
# Run the lianghuiqiang9 fork at one cell via the shared inspire driver.
set -euo pipefail

: "${IMPL_DIR:?}" "${ENTRIES_LOG2:?}" "${RECORD_BYTES:?}" "${OUT_JSON:?}" "${RAW_DIR:?}"
SEEDS="${SEEDS:-0,1,2}"
WARMUP="${WARMUP:-4}"
MEASURED="${MEASURED:-16}"
VARIANT="${INSPIRE_VARIANT:-two-packing}"
LABEL="inspire-lianghuiqiang9"

DRIVER="$(cd "$(dirname "$0")/driver" && pwd)"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$IMPL_DIR/../.driver-target-lianghuiqiang9}"
mkdir -p "$RAW_DIR"

if [ "${PREBUILD:-0}" = "1" ]; then
  exec cargo build --release --manifest-path "$DRIVER/Cargo.toml" \
    --bin inspire-lianghuiqiang9-bench
fi

cargo run --release --manifest-path "$DRIVER/Cargo.toml" \
  --bin inspire-lianghuiqiang9-bench -- \
  --entries-log2 "$ENTRIES_LOG2" --record-bytes "$RECORD_BYTES" \
  --seeds "$SEEDS" --warmup "$WARMUP" --measured "$MEASURED" \
  --variant "$VARIANT" --label "$LABEL" --out "$OUT_JSON"

[ -f "$OUT_JSON" ] || { echo "driver produced no report" >&2; exit 1; }
cp "$OUT_JSON" "$RAW_DIR/driver-report.json"
