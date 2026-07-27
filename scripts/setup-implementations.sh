#!/usr/bin/env bash
# Clone the PIR implementations at pinned commits into implementations/.
# These are NOT committed to this repo (see .gitignore); this script makes a
# reproducible checkout on whatever machine will run the benchmarks.
set -euo pipefail

# Pinned commits — bump deliberately, record in docs/benchmark-plan.md.
RAVEN_REPO="https://github.com/hisoka-io/raven"
RAVEN_COMMIT="5a899b5dc60c079af5d3914d67c93b9b72859ec9"
INSPIRE_REPO="https://github.com/hisoka-io/inspire-rs"
INSPIRE_COMMIT="3be3cc7d56db9535ab93101864c5468c654dbddf"  # == raven's crates/inspire pin

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMPL="$ROOT/implementations"
mkdir -p "$IMPL"

clone_pinned() {
  local repo="$1" commit="$2" dest="$3"
  if [ -d "$dest/.git" ]; then
    echo "== $dest exists; fetching =="
    git -C "$dest" fetch --quiet origin "$commit" || git -C "$dest" fetch --quiet origin
  else
    echo "== cloning $repo -> $dest =="
    git clone --quiet "$repo" "$dest"
  fi
  git -C "$dest" checkout --quiet "$commit"
  echo "   $dest @ $(git -C "$dest" rev-parse --short HEAD)"
}

clone_pinned "$RAVEN_REPO" "$RAVEN_COMMIT" "$IMPL/raven"

# raven vendors inspire-rs as the crates/inspire submodule (SSH url upstream).
# Populate it from the HTTPS mirror at the pinned commit so b1-inspire builds.
clone_pinned "$INSPIRE_REPO" "$INSPIRE_COMMIT" "$IMPL/raven/crates/inspire"

echo "done. next: scripts/bench-cell.sh <scheme> <entries_log2> <record_bytes> [variant]"
