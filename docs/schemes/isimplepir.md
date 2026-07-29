# iSimplePIR

**iSimplePIR (Entry-level)** — eprint 2026/030, Construction 1. Raven's pure-Rust
implementation (`hisoka-io/raven` `crates/isimplepir`), ported from the `simplepir`
Go reference. Single-server, **client-preprocessing** PIR with incremental updates
that preserve the `H = D · A` hint invariant.

## Family & trade-off

Hint-based (SimplePIR lineage): the client downloads a one-time **hint** derived from
the database, after which per-query work is cheap. The cost is that hint:

- At 2²⁰ × 32 B (measured, dev VM): **hint ≈ 22 MB**, server compute **≈ 3.9 ms/query**,
  query/response **≈ 21.9 KB each**, setup **≈ 10 s**.

For a home staker serving many light clients over Ethereum state, the hint is the
crux: every client must download (and refresh, as state changes) tens of MB before
its first private read. Contrast with InsPIRe (silent preprocessing, `hint = 0`, but
heavier per-query server work). The explorer's "Client hint download" vs "Server
compute per query" metrics show exactly this tension.

## API (as driven by the harness)

`params::for_cell(entries, entry_bytes)` → `setup` / `query` / `respond` / `extract`,
plus `encode_database`, `squish_db` + `respond_packed` (compressed server DB), and
`db_update_insert` for incremental updates. The `--use-squish` bench flag exercises
the packed server path (requires `p ≤ 1024`).

## Reproduce

```bash
scripts/bench.sh --impl isimplepir-raven --cells "20:32"   # 2^20 entries x 32 B
```

The adapter emits raven `BenchReport`s per seed, `adapters/_lib/raven-to-adapter.mjs`
collapses them into the canonical report, and `harness/import-adapter-report.mjs`
writes the row into `results/isimplepir/`.
