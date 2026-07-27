# InsPIRe

**InsPIRe: Communication-Efficient PIR with Server-side Preprocessing** —
[eprint 2025/1352](https://eprint.iacr.org/2025/1352).

Single-server PIR that reaches high throughput *and* low query communication with
**silent preprocessing** (no offline download), via a ring-packing algorithm
(`InspiRING`) that turns LWE ciphertexts into RLWE ciphertexts using only two
key-switching matrices instead of a logarithmic number.

This is project #1: benchmark the different **implementations** of InsPIRe against
each other on an apples-to-apples basis.

## Implementations to compare

| Adapter (planned) | Source | Notes |
| --- | --- | --- |
| paper reference | link TBD (see below) | authors' artifact |
| poulpy | [phantomzone-org/poulpy](https://github.com/phantomzone-org/poulpy) | Rust FHE library backend |
| hisoka-raven | [hisoka-io](https://github.com/hisoka-io) (`raven`) | PIR-for-Ethereum framework |

Until these are wired in, three synthetic profiles (`mock-paper`, `mock-poulpy`,
`mock-hisoka`) stand in so the pipeline and site are exercised. Their numbers are
**not** representative.

## RESOLVED: Poulpy is not an InsPIRe implementation

Investigated (2026-07): **Poulpy contains no InsPIRe / PIR code** — it is the FHE
backend library only (`grep -ri inspir` over the tree is clean). So the original
"paper code vs. Poulpy" comparison does not exist today; it would only become real if
someone builds InsPIRe *on* Poulpy.

The actual InsPIRe implementation is **`github.com/hisoka-io/inspire-rs`** (reachable
over HTTPS; `respond()`/`extract()`, variants `no-packing` / `two-packing` /
`inspiring`). Hisoka's `raven` **vendors a fork of `inspire-rs`** as the
`crates/inspire` submodule and drives it via `benches/b1-bench` (`b1-inspire`), which
emits the same `BenchReport` JSON as the iSimplePIR bench.

Consequence: "paper reference" and "Hisoka's InsPIRe" are the **same lineage**, not
two independent codebases. The project was therefore reframed (see
`docs/benchmark-plan.md`) to a **cross-scheme** comparison on Ethereum-shaped data.

**Next step:** run `b1-inspire` on the reference machine and import via
`harness/import-bench-report.mjs --scheme InsPIRe --impl raven-inspire`.

## Shared parameter grid (starting point)

- `num_records` ∈ {2^16, 2^18, 2^20, 2^22}
- `record_bytes` ∈ {256, 1024}
- `security_bits` = 128
- `threads`: pinned per run, recorded in every row

Report per row: server throughput (MB/s), server answer (ms), query size, response
size, and (once measured) preprocessing time and peak memory.
