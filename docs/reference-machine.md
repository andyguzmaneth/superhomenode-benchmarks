# The reference machine

Implementation comparisons are only meaningful on **one fixed machine**, and this
project's premise is *home-staker hardware serving private reads over Ethereum
state*. The machine is therefore frozen, and the driver enforces it rather than
trusting a label typed on the command line.

The machine of record is [`machines/reference.json`](../machines/reference.json).

| | |
| --- | --- |
| Label | `ryzen9900x-8t-32g` |
| CPU | AMD Ryzen 9 9900X, **8 cores pinned** (`qm set 100 --affinity 0-7`), `--cpu host` |
| RAM | 32 GB (`--memory 32768`) |
| Features | AVX2 + AVX-512F (Zen 5 exposes AVX-512 through `cpu: host`) |
| Host | Proxmox VM 100 on a Ryzen 9 9900X / 64 GB DDR5-6000 homelab |
| Frozen | 2026-07-29 |

## How this maps to the run-a-node spec

Normative source: **[ethereum.org/run-a-node](https://ethereum.org/en/run-a-node/)**,
staking tier — this is what makes "home staker" a defensible claim rather than an
arbitrary box.

| Component | run-a-node (staking) | This machine |
| --- | --- | --- |
| CPU | x86, cpubenchmark.net score ≥ 6667 | Ryzen 9 9900X ≈ 66 k, capped to 8 pinned cores |
| RAM | 16 GB min, 32 GB better | 32 GB |
| Storage | 2 TB SSD | NVMe (the benchmark itself needs far less) |
| Network | wired | wired |

It clears the spec comfortably — which is the honest caveat to state plainly:
**this is the top of the home-staker range, not the floor.** PIR is
memory-bandwidth-bound, so numbers here overstate what a NUC-class box would do.
Since implementations are what's being compared, and they all run on the same
host, that bias is constant across every row and does not distort the comparison
between them. It does mean the absolute latencies are a best case.

## Running the suite

```bash
git clone https://github.com/andyguzmaneth/superhomenode-benchmarks
cd superhomenode-benchmarks

scripts/bench.sh --impl inspire-raven --profile smoke   # wire-up check, 1 cell
scripts/bench.sh --impl inspire-raven                   # published grid
scripts/run-suite.sh                                    # every adapter
```

`scripts/bench.sh` compares the live host against `machines/reference.json` and
aborts if CPU model, core count, RAM (±5 %) or the required CPU features differ.
Pass `--allow-machine-mismatch` for a throwaway run; those rows get an
`…-UNVERIFIED` machine label so they can never be mistaken for published data.

Commit the new `results/*.json` and `site/data/results.json`.

## Grid & memory

Default grid is the PSE 3×3 (`2^20/24/28 × 8/32/256 B`). At 32 GB, two cells are
not reachable and that absence is a published finding, not a gap:

| Cell | Raw DB | Status at 32 GB |
| --- | --- | --- |
| 2²⁸ × 32 B | 8.6 GB | **iSimplePIR fits** (4,892 ms answer). **InsPIRe (inspire-rs lineage) OOMs** — setup peaks near 40 GB (`dmesg`: total-vm ≈ 40 GB, anon-rss 31.9 GB) |
| 2²⁸ × 256 B | ≈ 68 GB | Out of reach for both, by a wide margin |

A cell an implementation cannot fit on home-staker hardware is a real result. The
driver records the failure, skips the row, and continues.

Override the grid for a targeted run:

```bash
scripts/bench.sh --impl inspire-raven --cells "20:32 24:32"
```
