# pir-bench

Reproducible, apples-to-apples benchmarks for **PIR (Private Information Retrieval)**
schemes, presented as an interactive explorer.

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

Project #1 is a comparison of **InsPIRe** implementations
([eprint 2025/1352](https://eprint.iacr.org/2025/1352)):

| Implementation | Source | Status |
| --- | --- | --- |
| Paper reference | TBD (see `docs/schemes/inspire.md`) | not yet wired |
| Poulpy | [phantomzone-org/poulpy](https://github.com/phantomzone-org/poulpy) | not yet wired |
| Hisoka `raven` | [hisoka-io](https://github.com/hisoka-io) | not yet wired |

A `mock-inspire` adapter is included so the full pipeline (run → record → explore)
works today, before any real library is wired in.

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
