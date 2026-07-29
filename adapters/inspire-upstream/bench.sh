#!/usr/bin/env bash
# Run the crates.io inspire 0.2.0 baseline at one cell via the local driver crate.
set -euo pipefail

: "${IMPL_DIR:?}" "${ENTRIES_LOG2:?}" "${RECORD_BYTES:?}" "${OUT_JSON:?}" "${RAW_DIR:?}"
SEEDS="${SEEDS:-0,1,2}"
WARMUP="${WARMUP:-4}"
MEASURED="${MEASURED:-16}"
VARIANT="${INSPIRE_VARIANT:-two-packing}"

DRIVER="$(cd "$(dirname "$0")/driver" && pwd)"
# Keep build artifacts with the checkout rather than in the repo tree.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$IMPL_DIR/target}"
mkdir -p "$RAW_DIR"

if [ "${PREBUILD:-0}" = "1" ]; then
  exec cargo build --release --manifest-path "$DRIVER/Cargo.toml" --bin inspire-upstream-bench
fi

# The driver writes the canonical report directly — no translation step needed.
cargo run --release --manifest-path "$DRIVER/Cargo.toml" --bin inspire-upstream-bench -- \
  --entries-log2 "$ENTRIES_LOG2" --record-bytes "$RECORD_BYTES" \
  --seeds "$SEEDS" --warmup "$WARMUP" --measured "$MEASURED" \
  --variant "$VARIANT" --out "$OUT_JSON"

[ -f "$OUT_JSON" ] || { echo "driver produced no report" >&2; exit 1; }
cp "$OUT_JSON" "$RAW_DIR/driver-report.json"
