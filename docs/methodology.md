# Methodology

The plumbing is easy; **fair comparison is the hard part.** These rules exist so
that two rows in the explorer are only ever plotted together when they are
genuinely comparable.

## 1. A row records how it was produced

Every result carries the full context needed to judge it (`schema/result.schema.json`):
database shape (`num_records`, `record_bytes`), `security_bits`, `threads`, and the
exact `environment` (CPU model, features, cores, OS). Two rows from different CPUs
or thread counts are **not** directly comparable — the site groups by scheme and
record size and labels the rest.

## 2. Preprocessing is separated from per-query cost

`preprocessing_ms` and `offline_hint_bytes` are one-time server/offline costs.
`server_answer_ms`, `query_bytes`, and `response_bytes` are per-query. Never fold
one into the other. Silent-preprocessing schemes (like InsPIRe) report
`offline_hint_bytes: 0`.

## 3. Same parameter point, same security

To compare implementations of one scheme, fix `num_records`, `record_bytes`,
`security_bits`, and `threads`, then vary one axis at a time. Mismatched security
levels are the most common way PIR benchmarks mislead.

## 4. Measured vs. modeled

Real adapters are timed on a monotonic clock (median over `--reps`, after one warmup).
An adapter may instead return `modeled_metrics` — estimates, or numbers lifted from a
paper — in which case the record is flagged `modeled` in `notes` and badged in the UI.
Modeled and measured rows are never silently mixed.

## 5. Correctness before performance

The runner asks each adapter for `expected_record(index)` and asserts the decoded
response matches before any number is trusted. An implementation that doesn't
return the right record isn't benchmarked — it's a bug report.

## Adding an implementation

1. Add the upstream code as a submodule under `implementations/`, pinned to a commit.
2. Implement `PirImplementation` (see `harness/pir-bench-core/src/lib.rs`) in a new
   adapter — either linking the crate directly, or shelling out to its binary and
   parsing output.
3. Register it in `build_adapter` in `harness/pir-bench-runner/src/main.rs`.
4. Run it across the shared parameter grid; commit the resulting `results/*.json`.
5. `node site/build-data.mjs` to refresh the explorer.
