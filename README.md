# superhomenode-benchmarks

Reproducible, apples-to-apples **performance** benchmarks for PIR (Private
Information Retrieval) — comparing **different implementations of the same
scheme** against each other, on **one frozen home-staker-class machine**, over
databases shaped like Ethereum state. Presented as an interactive explorer.

Presentation model: [ethproofs.org/csp-benchmarks](https://ethproofs.org/csp-benchmarks).
Reference hardware follows the staking tier of
[ethereum.org/run-a-node](https://ethereum.org/en/run-a-node/).

The project is **data-first**: every benchmark run emits one standardized JSON
record. The harness produces those records; the site only ever *reads* them. The
website therefore never depends on being able to build every cryptographic
library.

## Scope

This is a **performance** benchmark, and deliberately nothing else:

- **In scope:** per-query server latency, preprocessing time, upload/download
  sizes, offline hint size, peak memory, throughput where it is well-defined.
- **Out of scope:** correctness and security verification. `security_bits` is
  published as a **claim made by the implementation**, never as a checked fact.
  Where two implementations of one scheme chose different parameters, we record
  what each actually ran and leave the interpretation to the reader.
- **One machine, frozen.** See [`machines/reference.json`](machines/reference.json).
  A row that cannot be produced on that machine is not published — including
  cells an implementation cannot fit in 32 GB, which is itself a result.

## Layout

```
machines/reference.json  the frozen host; the driver refuses to mislabel any other
adapters/                one directory per implementation (the contract: adapters/README.md)
  _lib/                    shared translators
  inspire-raven/           props.json + setup.sh + bench.sh
  isimplepir-raven/
schema/                  JSON Schema for a result record (the contract)
harness/                 import-adapter-report.mjs — canonical report -> results/
implementations/         upstream checkouts, pinned by each adapter (not committed)
results/                 committed result records — the single source of truth
site/                    static explorer, built from results/
docs/                    methodology + per-scheme notes
```

## Implementations

| Implementation | Scheme | Source | Lineage | Status |
| --- | --- | --- | --- | --- |
| `inspire-raven` | InsPIRe | [hisoka-io/inspire-rs](https://github.com/hisoka-io/inspire-rs) via raven's `b1-inspire` | fork of the (now deleted) `igor53627/inspire-rs` | ✅ 7 cells |
| `isimplepir-raven` | iSimplePIR | [hisoka-io/raven](https://github.com/hisoka-io/raven) `crates/isimplepir` | independent | ✅ 8 cells |
| `inspire-upstream` | InsPIRe | crates.io `inspire` 0.2.0 — the only surviving copy of the deleted upstream | the pre-fork baseline | ✅ wired |
| `inspire-poulpy` | InsPIRe (interpolation) | [poulpy-fhe/poulpy-pir](https://github.com/poulpy-fhe/poulpy-pir) | independent | ✅ wired |
| `inspire2-poulpy` | InsPIRe² (recursion, γ₀=32) | [poulpy-fhe/poulpy-pir](https://github.com/poulpy-fhe/poulpy-pir) | independent | ✅ wired |
| `inspire-lianghuiqiang9` | InsPIRe | [lianghuiqiang9/inspire-rs](https://github.com/lianghuiqiang9/inspire-rs) | fork of the same deleted upstream | ✅ wired |

We don't reimplement the crypto. Each adapter builds its upstream at a pinned
commit and translates that project's own output into one canonical report; the
driver adds machine identity and peak RSS so all implementations are measured
identically.

## Read the scope column before the latency charts

`server_answer_ms` is only comparable between implementations whose online phase
covers the same thing. The `inspire-rs` lineage fixes its shard at
`ring_dim × record_bytes` = **2048 records regardless of N** and sends
`shard_id` in cleartext, so its online answer touches one 64 KB shard however
large the database is — which is why its per-query time is flat across N, and
why its anonymity set is 2048 records rather than N. `inspire-poulpy`,
`inspire2-poulpy` and `isimplepir-raven` answer over the whole database. Every
row carries `implementation.online_work_scope`; see `docs/methodology.md` §6.

## Sizing a real deployment

[`docs/sizing-a-deployment.md`](docs/sizing-a-deployment.md) turns the grid into
a configuration: which construction to pick at which scale (it inverts — memory
binds at 4 GiB, bandwidth at 240 MiB), the `rows`/`cols` design rule, and a
worked single-contract config that co-exists with an execution and consensus
client. It is also explicit about the three costs none of these numbers include:
keyword lookup, integrity proofs, and freshness.

## Quick start

```bash
# wire up / smoke-test one adapter (one cell, not published)
scripts/bench.sh --impl inspire-raven --profile smoke

# the published grid for one implementation
scripts/bench.sh --impl inspire-raven

# every adapter, full grid
scripts/run-suite.sh

# serve the explorer
cd site && python3 -m http.server 8080   # http://localhost:8080
```

`scripts/bench.sh` refuses to write rows unless it is running on the frozen
reference machine. Use `--allow-machine-mismatch` for throwaway runs; those rows
are labelled `…-UNVERIFIED`.

## Fairness rules (see `docs/methodology.md`)

Numbers are only comparable when the row records **how** they were produced.
Every record carries the database shape (`N`, record size), the claimed security
level, thread count, the exact CPU/features, the implementation's commit, and
its lineage. One-time **preprocessing** is always reported separately from
**per-query** cost. Online throughput is reported only for implementations whose
online phase actually scans the database — for silent-preprocessing schemes that
ratio is meaningless and is omitted rather than faked.
