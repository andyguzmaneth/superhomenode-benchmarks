# The reference machine

PIR-scheme comparisons are only meaningful on **one fixed machine**, and this
project's premise is *home-staker hardware serving private reads over Ethereum
state*. So the authoritative numbers must come from a designated home-staker-class
box — not a cloud server, and not this dev VM.

## Recommended reference spec

Normative source: **[ethereum.org/run-a-node](https://ethereum.org/en/run-a-node/)**,
staking tier — this is what makes "home staker" a defensible claim rather than an
arbitrary box:

| Component | run-a-node (staking) | Our target |
| --- | --- | --- |
| CPU | x86, cpubenchmark.net score ≥ 6667 | 8-core modern consumer x86 (Ryzen 7 / Intel i7, mini-PC / NUC class) |
| RAM | 16 GB min, 32 GB better | 32 GB |
| Storage | 2 TB SSD (write-speed bound) | NVMe SSD (≥ 2 TB for a real node; the bench itself needs far less) |
| Network | wired, high bandwidth | wired |
| OS | — | Linux |

Pin threads to **physical** cores for stable measurement (see the `taskset` note in
`raven/benches/b1-bench/README.md`). Record the exact CPU in every result — the
importer captures it automatically from `/proc/cpuinfo`.

Once you pick the machine, note its exact CPU + core count here so future runs are
comparable.

## Running the authoritative suite

On the reference machine:

```bash
git clone https://github.com/andyguzmaneth/superhomenode-benchmarks && cd superhomenode-benchmarks
scripts/setup-implementations.sh                    # clone + pin raven & inspire-rs
scripts/run-reference-suite.sh "nuc13-i7-8t"        # <- your machine label
```

`run-reference-suite.sh` runs both schemes across the grid, imports each
`BenchReport` into `results/`, and rebuilds the site bundle. Commit the new
`results/*.json` (+ `site/data/results.json`) and open a PR — those rows replace the
dev-VM placeholders as the published data.

### Grid & memory

Default grid is the PSE 3×3 (`2^20/24/28 × 8/32/256 B`). **2^28 (~268 M entries) is
memory-hungry** — iSimplePIR's packed DB and InsPIRe's setup both scale with N; 32 GB
should hold 2^24 comfortably but validate 2^28 before relying on it. Override the grid:

```bash
CELLS="20:32 22:32 24:32" scripts/run-reference-suite.sh "nuc13-i7-8t"
```

## Why the dev-VM rows are labeled, not deleted

The dev-VM data (Xeon, 4 threads) proves the pipeline and shows the *shape* of the
trade-off. It stays until real reference runs land, clearly badged so no one mistakes
it for the home-staker result.
