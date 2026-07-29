#!/usr/bin/env bash
# Check out raven (+ its vendored inspire-rs) at the pinned commits.
# Shared with the isimplepir-raven adapter via props.json "checkout": "raven",
# so cargo's target dir and the heavy dependency build are reused.
set -euo pipefail

: "${IMPL_DIR:?IMPL_DIR must be set by scripts/bench.sh}"

RAVEN_REPO="https://github.com/hisoka-io/raven"
RAVEN_COMMIT="5a899b5dc60c079af5d3914d67c93b9b72859ec9"
# raven vendors inspire-rs as the crates/inspire submodule over SSH; populate it
# from the HTTPS mirror at the pin recorded in props.json so b1-inspire builds.
INSPIRE_REPO="https://github.com/hisoka-io/inspire-rs"
INSPIRE_COMMIT="3be3cc7d56db9535ab93101864c5468c654dbddf"

clone_pinned() {
  local repo="$1" commit="$2" dest="$3"
  if [ -d "$dest/.git" ]; then
    git -C "$dest" fetch --quiet origin "$commit" || git -C "$dest" fetch --quiet origin
  else
    git clone --quiet "$repo" "$dest"
  fi
  git -C "$dest" checkout --quiet "$commit"
  echo "   $(basename "$dest") @ $(git -C "$dest" rev-parse --short HEAD)"
}

clone_pinned "$RAVEN_REPO" "$RAVEN_COMMIT" "$IMPL_DIR"
clone_pinned "$INSPIRE_REPO" "$INSPIRE_COMMIT" "$IMPL_DIR/crates/inspire"
