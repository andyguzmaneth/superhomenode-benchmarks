#!/usr/bin/env bash
# Check out the lianghuiqiang9 fork at its pinned commit. The driver crate in
# this directory depends on it by relative path, so the checkout location is
# part of the contract: implementations/inspire-lianghuiqiang9.
set -euo pipefail

: "${IMPL_DIR:?IMPL_DIR must be set by scripts/bench.sh}"

REPO="https://github.com/lianghuiqiang9/inspire-rs"
COMMIT="a76dfdc90dc291eb2dd6343c5f87f3a963f20ba9"

if [ -d "$IMPL_DIR/.git" ]; then
  git -C "$IMPL_DIR" fetch --quiet origin "$COMMIT" || git -C "$IMPL_DIR" fetch --quiet origin
else
  git clone --quiet "$REPO" "$IMPL_DIR"
fi
git -C "$IMPL_DIR" checkout --quiet "$COMMIT"
echo "   inspire-lianghuiqiang9 @ $(git -C "$IMPL_DIR" rev-parse --short HEAD)"
