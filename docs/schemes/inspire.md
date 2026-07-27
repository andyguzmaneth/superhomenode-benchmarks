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

## ⚠️ Open question: is "paper code" distinct from "poulpy"?

InsPIRe comes out of the same Phantom Zone / Bossuat orbit as Poulpy. The reference
implementation may *be* the Poulpy one (or a fork of it) rather than an independent
codebase. Before presenting "paper vs. Poulpy" as two columns, confirm the exact
repos and commits. If they collapse into one, the honest comparison is
**Poulpy vs. Hisoka `raven`** (with Respire added later as a *different* scheme).

**TODO:** find the paper's artifact link (the eprint PDF's References/Availability
section, or the CCS/USENIX artifact appendix) and record repo + commit here.

## Shared parameter grid (starting point)

- `num_records` ∈ {2^16, 2^18, 2^20, 2^22}
- `record_bytes` ∈ {256, 1024}
- `security_bits` = 128
- `threads`: pinned per run, recorded in every row

Report per row: server throughput (MB/s), server answer (ms), query size, response
size, and (once measured) preprocessing time and peak memory.
