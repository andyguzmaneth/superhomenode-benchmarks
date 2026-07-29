#!/usr/bin/env bash
# Run one implementation over a set of cells on the frozen reference machine.
#
#   scripts/bench.sh --impl inspire-raven [--cells "24:32 28:32"] [--profile smoke|full]
#
# The driver owns everything that must be identical across implementations:
# machine identity, peak-RSS measurement, and the import into results/. The
# adapter only builds its upstream and reports numbers.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMPL_ID=""
CELLS=""
PROFILE="${PROFILE:-full}"
ALLOW_MISMATCH="${ALLOW_MISMATCH:-0}"

while [ $# -gt 0 ]; do
  case "$1" in
    --impl)    IMPL_ID="$2"; shift 2 ;;
    --cells)   CELLS="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --allow-machine-mismatch) ALLOW_MISMATCH=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$IMPL_ID" ] || { echo "--impl is required (see adapters/)" >&2; exit 2; }
ADAPTER="$ROOT/adapters/$IMPL_ID"
[ -f "$ADAPTER/props.json" ] || { echo "no adapter at $ADAPTER" >&2; exit 1; }

# --- cells ------------------------------------------------------------------
# The published grid. `smoke` exists so a new adapter can be wired up in
# minutes instead of hours; it is never published.
# The PSE 3x3 grid, plus a 32-byte sweep at 2^25..2^27. Those three exist so the
# poulpy implementations can meet the others: their default parameterizations are
# 32-byte payloads at power-of-two GiB database sizes, which land exactly on
# entries_log2 25..30. Without them poulpy would only ever share one cell (2^28)
# with the rest of the grid.
FULL_CELLS="20:8 20:32 20:256 24:8 24:32 24:256 25:32 26:32 27:32 28:8 28:32 28:256"
SMOKE_CELLS="20:32"
if [ -z "$CELLS" ]; then
  case "$PROFILE" in
    smoke) CELLS="$SMOKE_CELLS" ;;
    full)  CELLS="$FULL_CELLS" ;;
    *) echo "unknown profile: $PROFILE (smoke|full)" >&2; exit 2 ;;
  esac
fi

jsonval() { node -e 'const j=require(process.argv[1]);const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],j);process.stdout.write(v==null?"":Array.isArray(v)?v.join(","):String(v))' "$1" "$2"; }

REF="$ROOT/machines/reference.json"
MACHINE="$(jsonval "$REF" label)"
CHECKOUT="$(jsonval "$ADAPTER/props.json" checkout)"
[ -n "$CHECKOUT" ] || CHECKOUT="$IMPL_ID"
IMPL_DIR="$ROOT/implementations/$CHECKOUT"

# --- machine identity -------------------------------------------------------
# Consistency is the whole premise: implementations are only comparable because
# the host never changes. Detect what we are actually on and refuse to label a
# different box as the reference.
DET_CPU="$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ *//' || echo unknown)"
DET_CORES="$(nproc 2>/dev/null || echo 0)"
DET_RAM="$(awk '/MemTotal/ {print $2 * 1024; exit}' /proc/meminfo 2>/dev/null || echo 0)"
DET_FLAGS="$(grep -m1 '^flags' /proc/cpuinfo 2>/dev/null | cut -d: -f2 || echo '')"

EXP_CPU="$(jsonval "$REF" cpu_model)"
EXP_CORES="$(jsonval "$REF" logical_cores)"
EXP_RAM="$(jsonval "$REF" ram_bytes)"
EXP_FEATURES="$(jsonval "$REF" cpu_features)"
RAM_TOL="$(jsonval "$REF" tolerance.ram_bytes_pct)"

mismatch=""
[ "$DET_CPU" = "$EXP_CPU" ] || mismatch="$mismatch\n  cpu:   expected '$EXP_CPU', got '$DET_CPU'"
[ "$DET_CORES" = "$EXP_CORES" ] || mismatch="$mismatch\n  cores: expected $EXP_CORES, got $DET_CORES"
if [ "$DET_RAM" -gt 0 ] && [ "$EXP_RAM" -gt 0 ]; then
  lo=$(( EXP_RAM - EXP_RAM * RAM_TOL / 100 ))
  hi=$(( EXP_RAM + EXP_RAM * RAM_TOL / 100 ))
  if [ "$DET_RAM" -lt "$lo" ] || [ "$DET_RAM" -gt "$hi" ]; then
    mismatch="$mismatch\n  ram:   expected ~$EXP_RAM (±${RAM_TOL}%), got $DET_RAM"
  fi
fi
IFS=',' read -r -a want_flags <<< "$EXP_FEATURES"
for f in "${want_flags[@]}"; do
  case " $DET_FLAGS " in
    *" $f "*) ;;
    *) mismatch="$mismatch\n  cpu feature '$f' not present" ;;
  esac
done

if [ -n "$mismatch" ]; then
  echo "!! this host is not the frozen reference machine ($MACHINE):" >&2
  printf "%b\n" "$mismatch" >&2
  if [ "$ALLOW_MISMATCH" != "1" ]; then
    echo "   refusing to produce rows labelled '$MACHINE'." >&2
    echo "   fix the host, or pass --allow-machine-mismatch for a throwaway run." >&2
    exit 1
  fi
  echo "   --allow-machine-mismatch set: continuing, rows will be labelled '$MACHINE-UNVERIFIED'." >&2
  MACHINE="$MACHINE-UNVERIFIED"
fi

# --- checkout ---------------------------------------------------------------
if [ ! -d "$IMPL_DIR/.git" ]; then
  echo "==> setup $IMPL_ID -> implementations/$CHECKOUT"
  mkdir -p "$(dirname "$IMPL_DIR")"
  IMPL_DIR="$IMPL_DIR" bash "$ADAPTER/setup.sh"
fi

# Compile before measuring, so peak RSS reflects the benchmark and not rustc.
echo "==> prebuild $IMPL_ID"
PREBUILD=1 IMPL_DIR="$IMPL_DIR" ENTRIES_LOG2=20 RECORD_BYTES=32 \
  OUT_JSON=/dev/null RAW_DIR="$ROOT/.bench-out/$IMPL_ID/_prebuild" \
  bash "$ADAPTER/bench.sh"

# --- run --------------------------------------------------------------------
# GNU time reports MaxRSS in kbytes; absent (or BSD time), we simply omit the
# metric rather than reporting a wrong one.
TIME_BIN=""
if /usr/bin/time -v true >/dev/null 2>&1; then TIME_BIN="/usr/bin/time -v"; fi

ok=0; failed=0
for cell in $CELLS; do
  elog2="${cell%%:*}"; rbytes="${cell##*:}"
  echo "==== $IMPL_ID  2^$elog2 x ${rbytes}B  on $MACHINE ===="

  RAW_DIR="$ROOT/.bench-out/$IMPL_ID/2e${elog2}x${rbytes}"
  REPORT="$RAW_DIR/adapter-report.json"
  TIMELOG="$RAW_DIR/time.txt"
  mkdir -p "$RAW_DIR"

  set +e
  if [ -n "$TIME_BIN" ]; then
    env IMPL_DIR="$IMPL_DIR" ENTRIES_LOG2="$elog2" RECORD_BYTES="$rbytes" \
        OUT_JSON="$REPORT" RAW_DIR="$RAW_DIR" \
      $TIME_BIN -o "$TIMELOG" bash "$ADAPTER/bench.sh"
  else
    env IMPL_DIR="$IMPL_DIR" ENTRIES_LOG2="$elog2" RECORD_BYTES="$rbytes" \
        OUT_JSON="$REPORT" RAW_DIR="$RAW_DIR" \
      bash "$ADAPTER/bench.sh"
  fi
  rc=$?
  set -e

  if [ $rc -ne 0 ] || [ ! -f "$REPORT" ]; then
    echo "!! $IMPL_ID 2^$elog2 x${rbytes} FAILED (rc=$rc) — recording nothing, continuing"
    failed=$((failed + 1))
    continue
  fi

  PEAK_ARG=()
  if [ -f "$TIMELOG" ]; then
    kb="$(awk -F': ' '/Maximum resident set size/ {print $2}' "$TIMELOG" | tr -d ' ')"
    [ -n "${kb:-}" ] && PEAK_ARG=(--peak-memory-bytes "$((kb * 1024))")
  fi

  node "$ROOT/harness/import-adapter-report.mjs" \
    --report "$REPORT" --props "$ADAPTER/props.json" \
    --machine "$MACHINE" --cpu "$DET_CPU" --cores "$DET_CORES" \
    --threads "$DET_CORES" --ram-bytes "$DET_RAM" \
    --features "$EXP_FEATURES" "${PEAK_ARG[@]+"${PEAK_ARG[@]}"}"
  ok=$((ok + 1))
done

node "$ROOT/site/build-data.mjs"
echo "== $IMPL_ID: $ok cell(s) imported, $failed failed =="
