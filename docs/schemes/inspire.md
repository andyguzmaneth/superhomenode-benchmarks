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

### Correction (2026-07-29)

The paragraph above is **out of date on two counts**, both re-checked directly:

1. **Poulpy now has an InsPIRe implementation.** `poulpy-fhe/poulpy-pir` (created
   May 2026, actively developed) implements both InsPIRe and InsPIRe² on Poulpy,
   with AVX-512, a pluggable BLAS GEMM, and presets reconstructed from the paper's
   Table 2. It is an independent codebase, not a fork of `inspire-rs`.
2. **The upstream `igor53627/inspire-rs` has been deleted from GitHub** (404). The
   only surviving copy of that pre-fork baseline is crates.io `inspire` 0.2.0.

So there *are* multiple independent lineages, and the project is now an
**implementation** comparison — see `docs/benchmark-plan.md` for the roster.

Reproduce Raven's implementation with:

```bash
scripts/bench.sh --impl inspire-raven --cells "24:32"
```

## Shared parameter grid (starting point)

- `num_records` ∈ {2^16, 2^18, 2^20, 2^22}
- `record_bytes` ∈ {256, 1024}
- `security_bits` = 128
- `threads`: pinned per run, recorded in every row

Report per row: server throughput (MB/s), server answer (ms), query size, response
size, and (once measured) preprocessing time and peak memory.
