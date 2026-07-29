# Adapters — the contract

One directory per **implementation**. An adapter's whole job is to build one
upstream codebase and translate its output into a canonical report. It never
measures wall-clock RSS, never decides the machine label, never writes into
`results/` — the root driver (`scripts/bench.sh`) owns all of that, so every
implementation is measured the same way.

This split is the reason numbers from four different codebases are comparable at
all: the only thing that varies per implementation is *what gets run*, not *how
it gets timed*.

```
adapters/<impl-id>/
  props.json     # who this implementation is (committed metadata)
  setup.sh       # clone at a pinned commit and build
  bench.sh       # run one cell, write one canonical report
```

`<impl-id>` is the row label on the site. Use `<scheme>-<origin>`, e.g.
`inspire-raven`, `inspire-poulpy`, `isimplepir-raven`.

## `props.json`

Descriptive only — nothing here is measured or verified, it exists so a reader
can tell why two rows differ.

```json
{
  "scheme": "InsPIRe",
  "implementation": "inspire-raven",
  "repo": "https://github.com/hisoka-io/inspire-rs",
  "commit": "3be3cc7d56db9535ab93101864c5468c654dbddf",
  "forked_from": "https://github.com/igor53627/inspire-rs",
  "language": "rust",
  "backend": ["avx2", "rayon"],
  "variant": "TwoPacking + InspiRING",
  "security_bits_claimed": 128,
  "notes": "Raven's fork. UPSTREAM.md documents 6 local patches."
}
```

`security_bits_claimed` is exactly that — **claimed by the implementation**. We
publish it as a label and do not check it.

`forked_from` drives the lineage column on the site. Omit for independent
implementations.

## `setup.sh`

Env in: `IMPL_DIR` (where to put the checkout). Idempotent — safe to re-run.
Must pin an exact commit; a floating branch makes the row unreproducible.

## `bench.sh`

Env in:

| Var | Meaning |
| --- | --- |
| `IMPL_DIR` | the checkout `setup.sh` produced |
| `ENTRIES_LOG2` | database size as log₂(N) |
| `RECORD_BYTES` | bytes per record |
| `SEEDS` | comma-separated seeds, e.g. `0,1,2` |
| `WARMUP` / `MEASURED` | iterations per seed |
| `OUT_JSON` | path to write the canonical report |
| `RAW_DIR` | scratch dir for the impl's own artifacts (kept for audit) |
| `PREBUILD` | when `1`, compile only and exit — do not run |

`PREBUILD=1` is called once by the driver before any measured cell, so that
rustc's own memory never shows up in the benchmark's peak RSS.

Exit non-zero if the cell could not run (out of memory, unsupported shape). The
driver records the failure and moves on — a cell an implementation *cannot* do
at this machine's spec is a real result, not an error to hide.

## The canonical report

`bench.sh` writes exactly this to `$OUT_JSON`. Omit what the implementation does
not report — never substitute `0` for "not measured".

```json
{
  "cell":          { "entries_log2": 24, "record_bytes": 32 },
  "variant":       "inspire-default-q-twopacking-inspiring",
  "scheme_params": { "ring_dim": 2048, "log_q": 60, "plaintext_modulus": 65537 },
  "timings_ms": {
    "server_answer":    { "median": 6.619, "min": 6.41, "max": 6.83, "n": 3 },
    "client_query_gen": { "median": 2.31 },
    "client_decode":    { "median": 0.4 },
    "preprocessing":    { "median": 4907.5 }
  },
  "sizes_bytes":       { "query": 98840, "response": 32879, "offline_hint": 0 },
  "seeds":             [0, 1, 2],
  "measured_per_seed": 16
}
```

Every timing is an object so a distribution can be reported where the
implementation exposes one. `median` is required; `min`/`max`/`p95`/`n` are
optional. Where an implementation only prints a single number, report it as
`median` with no spread — the site renders that as a point, not a range.

`scheme_params` is free-form and **not** normalized across implementations. Two
implementations of the same scheme routinely pick different ring dimensions and
moduli; recording what each actually ran is how a reader knows whether a gap is
engineering or parameterization.

## What the driver adds

`scripts/bench.sh` wraps the adapter and contributes, identically for all of
them: peak RSS of the whole run (`/usr/bin/time`), the machine label, CPU model,
core/thread count, CPU feature flags, OS, timestamp, and the `props.json`
provenance block. Then `harness/import-adapter-report.mjs` writes the row under
`results/<scheme>/`.
