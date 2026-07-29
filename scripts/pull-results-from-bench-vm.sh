#!/usr/bin/env bash
# Pull results/ off the bench VM into this checkout.
#
#   scripts/pull-results-from-bench-vm.sh [--dry-run]
#
# Why this is not just scp: the bench VM is reachable only through the Proxmox
# host's guest-agent channel. Tailscale SSH to the VM demands interactive browser
# authentication, and the VM has no push credentials (deliberately — no tokens on
# a benchmark box). So the archive travels base64-encoded through
# `qm guest exec`. It is ~20 KB gzipped, well inside the channel's limits.
#
# Requires ssh access to the Proxmox host as root.
set -euo pipefail

PVE_HOST="${PVE_HOST:-root@100.118.6.112}"
VMID="${VMID:-100}"
VM_REPO="${VM_REPO:-/home/andy/superhomenode-benchmarks}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "==> archiving results/ on VM $VMID"
b64="$(ssh -o BatchMode=yes "$PVE_HOST" \
  "qm guest exec $VMID --timeout 120 -- /bin/bash -c 'cd $VM_REPO && tar czf /tmp/results.tgz results && base64 -w0 /tmp/results.tgz'" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const j=JSON.parse(s);
      if (j.exitcode !== 0) { console.error("guest exec failed:", j["err-data"] || j); process.exit(1); }
      process.stdout.write((j["out-data"]||"").trim());
    })')"

[ -n "$b64" ] || { echo "empty archive — nothing pulled" >&2; exit 1; }
printf '%s' "$b64" | base64 -d > "$tmp/results.tgz"
tar xzf "$tmp/results.tgz" -C "$tmp"
count="$(find "$tmp/results" -name '*.json' | wc -l | tr -d ' ')"
echo "    $count row(s) received"

if [ "$DRY_RUN" = "1" ]; then
  echo "--dry-run: not writing into $ROOT/results"
  exit 0
fi

# The VM is the source of truth for measurements: it produced them. Replace
# rather than merge, so a row deleted there (superseded, pruned) does not linger
# here.
rm -rf "$ROOT/results"
mv "$tmp/results" "$ROOT/results"
echo "==> wrote $ROOT/results"

node "$ROOT/scripts/backfill-props.mjs"
node "$ROOT/scripts/prune-superseded.mjs"
node "$ROOT/site/build-data.mjs"
