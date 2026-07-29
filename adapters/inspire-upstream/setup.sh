#!/usr/bin/env bash
# The upstream this baseline comes from (github.com/igor53627/inspire-rs) no
# longer exists, so there is nothing to clone. What survives is crates.io
# `inspire` 0.2.0, which the driver crate in this directory depends on at an
# exact `=0.2.0` pin. Setup therefore just materializes a build dir and lets
# cargo fetch the published crate.
set -euo pipefail

: "${IMPL_DIR:?IMPL_DIR must be set by scripts/bench.sh}"
DRIVER="$(cd "$(dirname "$0")/driver" && pwd)"

mkdir -p "$IMPL_DIR"
# `git init` so the driver's expectation of a checkout dir holds and bench.sh's
# existence check does not re-run setup on every invocation.
[ -d "$IMPL_DIR/.git" ] || git -C "$IMPL_DIR" init --quiet

cargo fetch --manifest-path "$DRIVER/Cargo.toml"
echo "   inspire-upstream: crates.io inspire =0.2.0 fetched (driver at adapters/inspire-upstream/driver)"
