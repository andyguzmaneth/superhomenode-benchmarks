# Benchmark plan

**Goal.** Compare **different implementations of the same PIR scheme** on one
frozen home-staker machine, over a database shaped like a realistic subset of
Ethereum state. The question: *given the same protocol, how much does the
implementation actually cost you?* — with a secondary cross-scheme contrast
(silent preprocessing vs. client hint) kept for context.

This is a **performance** benchmark. Correctness and security are out of scope by
decision; see `docs/methodology.md` §6 for exactly what that does and does not
license.

## Why implementations

InsPIRe has at least four independent CPU implementations, and the upstream that
most of them forked — `igor53627/inspire-rs` — **has been deleted from GitHub**.
The surviving copy of that baseline is crates.io `inspire` 0.2.0. That makes fork
lineage part of the result: rows carry `forked_from`, and the site renders it.

| Implementation | Scheme / variant | Source | Lineage | Backend |
| --- | --- | --- | --- | --- |
| `inspire-raven` | InsPIRe, TwoPacking + InspiRING | [hisoka-io/inspire-rs](https://github.com/hisoka-io/inspire-rs) via raven `b1-inspire` | fork of deleted upstream, 6 documented patches | AVX2, rayon |
| `inspire-upstream` | InsPIRe | crates.io `inspire` 0.2.0 | **the pre-fork baseline** | AVX2 |
| `inspire-poulpy` | InsPIRe **and InsPIRe²** | [poulpy-fhe/poulpy-pir](https://github.com/poulpy-fhe/poulpy-pir) | independent, on the Poulpy FHE library | AVX-512, optional BLAS GEMM |
| `inspire-lianghuiqiang9` | InsPIRe | [lianghuiqiang9/inspire-rs](https://github.com/lianghuiqiang9/inspire-rs) | fork of the same deleted upstream, diverged before Raven's fixes | AVX2 |
| `isimplepir-raven` | iSimplePIR (eprint 2026/030) | [hisoka-io/raven](https://github.com/hisoka-io/raven) | independent | AVX2 |

Explicitly excluded: `rkdud007/inspire-rs` and `SoraSuegami/InsPIRe-GPU` (GPU — a
different machine class, out of scope), `p0mvn/ipir-sp` (a YPIR+SP hybrid, not
InsPIRe).

The most interesting single comparison available: `inspire-raven` vs.
`inspire-upstream` at the same cells isolates the cost of Raven's patches —
including replacing the upstream's under-provisioned moduli, which should show up
as a measurable slowdown bought in exchange for the security claim actually
holding.

## Database model: a subset of Ethereum state

State is modelled as flat indexed leaves (`index -> value`), the shape
`raven/examples/eth-state` uses (`ENTRY_SIZE = 32`, present-tag + big-endian
value). We sweep the PSE 3×3 grid:

| entries (log₂) | ≈ count | Ethereum-state analogue |
| --- | --- | --- |
| 2²⁰ | ~1.0 M | validator set / a single large contract's storage subset |
| 2²⁴ | ~16.7 M | order-of-magnitude slice of active accounts |
| 2²⁸ | ~268 M | full historical account set |

| record size | Ethereum-state analogue |
| --- | --- |
| 8 B | compact balance |
| 32 B | storage slot / balance word (the default) |
| 256 B | account leaf (nonce + balance + codeHash + storageRoot, padded) |

## The machine

Frozen: `ryzen9900x-8t-32g`. Full spec, run-a-node mapping, and the two
unreachable cells are in [`reference-machine.md`](reference-machine.md).

## Metrics

Per-query: `server_answer_ms`, `query_bytes`, `response_bytes`,
`client_query_gen_ms`, `client_decode_ms`.
One-time: `preprocessing_ms`, `offline_hint_bytes`,
`preprocessing_throughput_mbps`.
Resource: `peak_memory_bytes` (whole run, measured by the driver — setup peak is
what OOMs).
Derived, conditional: `server_throughput_mbps`, only where the online phase scans
the database.

## Reproducing a data point

```bash
scripts/bench.sh --impl inspire-raven --cells "24:32"
```

That single command pins the upstream commit, prebuilds it (so rustc stays out of
the peak-RSS figure), runs the cell, measures peak RSS, writes the row under
`results/inspire/`, and rebuilds `site/data/results.json`.

## Status

15 published rows on the frozen machine: `inspire-raven` (7 cells) and
`isimplepir-raven` (8 cells). Next: the `inspire-upstream` baseline, then
`inspire-poulpy`, then `inspire-lianghuiqiang9`.
