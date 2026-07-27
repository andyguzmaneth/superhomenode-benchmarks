# Benchmark plan

**Goal.** Compare PIR *schemes* against each other on **one fixed machine at
home-staker specs**, over a database shaped like a **realistic subset of Ethereum
state**. The question we're answering: *which PIR scheme is actually usable by a
home staker serving private reads over Ethereum state?*

## Database model: a subset of Ethereum state

We model state as flat indexed leaves (`index -> value`), the same shape Hisoka's
`raven/examples/eth-state` uses (`ENTRY_SIZE = 32`, present-tag + big-endian value).
We sweep the **PSE 3×3 grid** (Privacy & Scaling Explorations / EF), which Hisoka's
harness already targets:

| entries (log₂) | ≈ count | Ethereum-state analogue |
| --- | --- | --- |
| 2²⁰ | ~1.0 M | validator set / a single large contract's storage subset |
| 2²⁴ | ~16.7 M | order-of-magnitude slice of active accounts |
| 2²⁸ | ~268 M | full historical account set |

| record size | Ethereum-state analogue |
| --- | --- |
| 8 B | compact balance |
| 32 B | storage slot / balance word (the default, matches `eth-state`) |
| 256 B | account leaf (nonce + balance + codeHash + storageRoot, padded) |

## Schemes

| Scheme | Family | Source | Status |
| --- | --- | --- | --- |
| **iSimplePIR** | client-preprocessing / hint (eprint 2026/030) | `hisoka-io/raven` `crates/isimplepir` | ✅ real numbers flowing |
| **InsPIRe** | silent preprocessing (eprint 2025/1352) | `hisoka-io/inspire-rs` (raven vendors a fork) | ⏭ next: run `b1-inspire`, import |
| Spiral / Respire / YPIR | FHE-composition / high-rate | TBD | later |

The interesting axis for home stakers: **hint-based schemes (iSimplePIR) push a large
one-time download onto the client** (22 MB hint at 2²⁰×32 B) but keep server compute
tiny; **silent-preprocessing schemes (InsPIRe) carry no hint** but do more per-query
server work. The explorer is built to make that trade-off visible.

## ⚠️ The gating decision: the reference machine

Comparisons are only meaningful on **one pinned machine**, and the premise is
*home-staker hardware* — so a cloud server is the wrong place to publish from. Every
result record already carries the exact CPU/cores/threads it ran on; we just need to
fix which machine is authoritative.

Recommended home-staker reference spec (aligned with typical EthStaker / EF guidance):
- **CPU:** 8-core modern consumer x86 (e.g. Ryzen 7 / Intel i7, mini-PC / NUC class)
- **RAM:** 32 GB
- **Storage:** NVMe SSD
- **Threads:** pinned to physical cores, recorded per run

Until that machine is designated, numbers produced here are labeled
`dev-vm-… (NOT home-staker reference)` and are **not publishable** — only smoke/dev.

## Reproducing a data point

```bash
# 1. get the crypto (kept out of this repo; see implementations/)
git clone https://github.com/hisoka-io/raven
git clone https://github.com/hisoka-io/inspire-rs raven/crates/inspire   # for InsPIRe

# 2. run a scheme's bench on the reference machine (example: iSimplePIR, 2^20 x 32B)
cd raven
taskset -c 0-7 cargo run --release \
  --manifest-path benches/b2-bench/Cargo.toml --bin b2-isimplepir -- \
  --entries-log2 20 --record-bytes 32 --full-bench --warmup 4 --measured 16 \
  --seeds 0,1,2 --out-dir ./bench-out

# 3. import the BenchReport into this repo's schema
node harness/import-bench-report.mjs --file <path>/cell-2e20x32.json \
  --scheme iSimplePIR --impl raven-isimplepir \
  --repo https://github.com/hisoka-io/raven --commit <sha> \
  --machine "<reference-machine-label>" --cpu "<cpu>" --cores 8 --threads 8 \
  --features avx2 --security-bits 128

# 4. refresh the site
node site/build-data.mjs
```

## Current status

One **real** iSimplePIR point (2²⁰ × 32 B) is imported, measured on the dev VM
(Xeon, 4 threads) — a placeholder until the reference machine is chosen. The InsPIRe
`mock-*` rows remain as clearly-badged placeholders until `b1-inspire` is wired.
