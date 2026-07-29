#!/usr/bin/env bash
# Run poulpy-pir's InsPIRe (interpolation) construction at one cell.
set -euo pipefail

: "${IMPL_DIR:?}" "${ENTRIES_LOG2:?}" "${RECORD_BYTES:?}" "${OUT_JSON:?}" "${RAW_DIR:?}"

LIB="$(cd "$(dirname "$0")/../_lib" && pwd)"
# shellcheck source=../_lib/poulpy-preset.sh
. "$LIB/poulpy-preset.sh"

COLLAPSE="${POULPY_COLLAPSE:-interpolation}"
FEATURES="${POULPY_FEATURES:-avx512-fhe,numa-db-interleave}"
export RUSTFLAGS="${RUSTFLAGS:--C target-feature=+avx512f,+avx512dq}"
mkdir -p "$RAW_DIR"

if [ "${PREBUILD:-0}" = "1" ]; then
  # Build the example once. The crate pins poulpy by git rev, so this also
  # fetches and compiles the FHE backend — slow the first time, cached after.
  exec cargo build --release --manifest-path "$IMPL_DIR/Cargo.toml" \
    --features "$FEATURES" --example pir
fi

PRESET="$(poulpy_preset "$COLLAPSE" "$ENTRIES_LOG2" "$RECORD_BYTES")" || exit $?
LOG="$RAW_DIR/pir-stdout.txt"

# batch=1: single-query latency, which is what the rest of the grid measures.
# The example averages the online phase over its own REPEATS=10.
cargo run --release --manifest-path "$IMPL_DIR/Cargo.toml" \
  --features "$FEATURES" --example pir -- "$PRESET" 1 2>&1 | tee "$LOG"

node "$LIB/poulpy-to-adapter.mjs" --out "$OUT_JSON" --log "$LOG" \
  --entries-log2 "$ENTRIES_LOG2" --record-bytes "$RECORD_BYTES" --preset "$PRESET"
