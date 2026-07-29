#!/usr/bin/env bash
# Check out poulpy-pir at the pinned commit. Shared with the inspire2-poulpy
# adapter via props.json "checkout": "poulpy-pir" — same crate, two constructions.
set -euo pipefail

: "${IMPL_DIR:?IMPL_DIR must be set by scripts/bench.sh}"

REPO="https://github.com/poulpy-fhe/poulpy-pir"
COMMIT="625ac4094b2a99b23bc57e44e080dbc2dd526768"

if [ -d "$IMPL_DIR/.git" ]; then
  git -C "$IMPL_DIR" fetch --quiet origin "$COMMIT" || git -C "$IMPL_DIR" fetch --quiet origin
else
  git clone --quiet "$REPO" "$IMPL_DIR"
fi
git -C "$IMPL_DIR" checkout --quiet "$COMMIT"
echo "   poulpy-pir @ $(git -C "$IMPL_DIR" rev-parse --short HEAD)"

# The crate pins poulpy itself by git rev, so the first build fetches those too.
# It also has a compile-time guard: the avx512-fhe feature only builds on a host
# with AVX-512F, which the frozen reference machine has (cpu: host on Zen 5).
if ! grep -qm1 avx512f /proc/cpuinfo 2>/dev/null; then
  echo "!! this host has no AVX-512F — poulpy-pir's example cannot be built here" >&2
  exit 1
fi
