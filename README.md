# superhomenode-benchmarks

Reproducible, apples-to-apples benchmarks for **PIR (Private Information Retrieval)**
schemes on **home-staker hardware**, over databases shaped like Ethereum state —
presented as an interactive explorer.

Presentation model: [ethproofs.org/csp-benchmarks](https://ethproofs.org/csp-benchmarks)
(per-metric comparison charts, a scheme-properties matrix, an all-results table, and
an explicit host-machine block). Reference hardware follows the staking tier of
[ethereum.org/run-a-node](https://ethereum.org/en/run-a-node/).

The project is **data-first**: every benchmark run emits one standardized JSON
record. The harness produces those records; the site only ever *reads* them. This
keeps the presentation reproducible and means the website never depends on being
able to build every cryptographic library.

## Layout

```
schema/            JSON Schema for a benchmark result record (the contract)
harness/           Rust workspace that runs implementations and emits records
  pir-bench-core/    result types + the `PirImplementation` trait
  pir-bench-runner/  CLI that drives an adapter and writes results/
implementations/   external PIR implementations, pinned as git submodules
results/           committed result records — the single source of truth
site/              static interactive explorer, built from results/
docs/              methodology + per-scheme notes
```

## Status

Project #1: compare PIR **schemes** on one home-staker-class machine over a database
shaped like a subset of Ethereum state (full plan + the reference-machine decision in
[`docs/benchmark-plan.md`](docs/benchmark-plan.md)).

| Scheme | Source | Status |
| --- | --- | --- |
| **iSimplePIR** (eprint 2026/030) | [hisoka-io/raven](https://github.com/hisoka-io) `crates/isimplepir` | ✅ real numbers (dev VM, 5 cells) |
| **InsPIRe** (eprint 2025/1352) | [hisoka-io/inspire-rs](https://github.com/hisoka-io) (raven vendors a fork) | ✅ real numbers (dev VM, 5 cells) |
| Spiral / Respire / YPIR | TBD | later |

All current rows are labeled **dev VM (NOT reference)** — authoritative numbers come
from the reference machine (see [`docs/reference-machine.md`](docs/reference-machine.md)).

We don't reimplement the crypto: Hisoka's `raven` bench binaries emit a `BenchReport`
JSON per (scheme, cell); [`harness/import-bench-report.mjs`](harness/import-bench-report.mjs)
normalizes those into our schema. `harness/`'s `mock-*` adapters remain so the pipeline
runs with zero external code, and produce clearly-badged placeholder rows for InsPIRe
until it's wired.

> **Note:** Poulpy has **no** InsPIRe implementation — it's the FHE backend library
> only. See `docs/schemes/inspire.md`.

## Quick start

```bash
# 1. run the mock adapter to produce a result record
cd harness
cargo run -p pir-bench-runner -- --adapter mock-inspire --records 1048576 --record-bytes 256

# 2. regenerate the site's data bundle from results/
node ../site/build-data.mjs

# 3. serve the explorer
cd ../site && python3 -m http.server 8080   # open http://localhost:8080
```

## Fairness rules (see `docs/methodology.md`)

Numbers are only comparable when the row records **how** they were produced. Every
record therefore carries the database shape (`N`, record size), security level,
thread count, and the exact CPU / features it ran on. One-time **preprocessing** is
always reported separately from **per-query** cost.
