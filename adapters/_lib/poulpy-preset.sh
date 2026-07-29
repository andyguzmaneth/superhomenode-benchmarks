#!/usr/bin/env bash
# Map one of our cells to a poulpy-pir DefaultPirParameters32B preset name.
#
#   poulpy_preset <collapse:interpolation|recursion-g32> <entries_log2> <record_bytes>
#
# poulpy's defaults are 32-byte payloads only, at power-of-two database sizes of
# 1/2/4/8/16/32 GiB. With 32 B records that is exactly entries_log2 25..30:
#
#   1 GiB = 2^25 entries   4 GiB = 2^27      16 GiB = 2^29
#   2 GiB = 2^26           8 GiB = 2^28      32 GiB = 2^30
#
# The `cols` per size follows the crate's own examples/README pairing, so we are
# using the layout its authors recommend rather than inventing one. Sizes above
# 8 GiB do not fit the frozen 32 GB machine and are refused here rather than
# discovered as an OOM twenty minutes in.
poulpy_preset() {
  local collapse="$1" elog2="$2" rbytes="$3"

  if [ "$rbytes" != "32" ]; then
    echo "poulpy defaults cover 32-byte payloads only (asked for ${rbytes} B)" >&2
    return 2
  fi

  local gib cols
  case "$elog2" in
    25) gib=1;  cols=32768 ;;
    26) gib=2;  cols=65536 ;;
    27) gib=4;  cols=65536 ;;
    28) gib=8;  cols=131072 ;;
    # 2^29 was previously refused here on the assumption that a 16 GiB database
    # could not fit 32 GB. The measured series says otherwise: peak RSS is
    # 1.98x the database at 2^28 and the ratio is still falling (5.90 -> 3.67 ->
    # 2.74 -> 1.98), so 16 GiB projects to ~24 GB. Assumption replaced with a
    # measurement.
    29) gib=16; cols=262144 ;;
    30)
      echo "poulpy 2^30 is a 32 GiB database — cannot fit alongside its own working set on a 32 GB machine" >&2
      return 2 ;;
    *)
      echo "no poulpy preset for entries_log2=${elog2} (defaults cover 25..30)" >&2
      return 2 ;;
  esac

  case "$collapse" in
    interpolation) echo "InsPIRe-${gib}GiB-c${cols}" ;;
    recursion-g32) echo "InsPIRe2-g32-${gib}GiB-c${cols}" ;;
    *) echo "unknown collapse: $collapse" >&2; return 2 ;;
  esac
}
