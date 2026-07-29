# Methodology

The plumbing is easy; **fair comparison is the hard part.** These rules exist so
that two rows in the explorer are only ever plotted together when they are
genuinely comparable.

The comparison this project makes is **between implementations**, usually of the
*same* scheme. That is a harder setting than comparing different schemes: when
two codebases implement one protocol, any gap between them is engineering, or
parameter choice, or a shortcut. This benchmark measures the gap and records
enough context to tell those apart — it does not adjudicate between them.

## 1. A row records how it was produced

Every result carries the full context needed to judge it
(`schema/result.schema.json`): database shape (`num_records`, `record_bytes`),
claimed `security_bits`, `threads`, the exact `environment` (CPU model, features,
cores, RAM, OS), and the implementation's `repo` + `commit` + `forked_from` +
`backend`.

## 2. One machine, frozen

All published rows come from the single configuration in
`machines/reference.json`. `scripts/bench.sh` detects the host it is running on
and **refuses to write reference-labelled rows anywhere else** — CPU model, core
count, RAM (within tolerance) and required CPU features must all match. This is
not a nicety: implementations are the axis under comparison, so the machine has
to be a constant.

Rows produced with `--allow-machine-mismatch` are labelled `…-UNVERIFIED` and are
not publishable.

## 3. Preprocessing is separated from per-query cost

`preprocessing_ms` and `offline_hint_bytes` are one-time offline costs.
`server_answer_ms`, `query_bytes`, and `response_bytes` are per-query. Never fold
one into the other. Silent-preprocessing implementations report
`offline_hint_bytes: 0`.

## 4. Throughput is only reported where it means something

`server_throughput_mbps` = database bytes ÷ `server_answer_ms`. That ratio is
only a real throughput when the online phase actually scans the database, so it
is gated on the adapter's `online_scans_full_db`. For silent-preprocessing
schemes the online answer touches preprocessed state instead, and the ratio comes
out above DRAM bandwidth (81 GB/s at 2²⁴×32 B) — so it is **omitted**, not
published.

`preprocessing_throughput_mbps` = database bytes ÷ `preprocessing_ms` is
well-defined for every implementation here, because the offline phase has to
touch the whole database once.

## 5. Spread is published where it exists

Each cell is run over multiple seeds. Where an implementation exposes more than
one measurement, `metrics_spread` carries min/max/n alongside the median. PIR at
these sizes is memory-bandwidth-bound, so variance is signal, not noise to be
averaged away.

## 6. Latency is only comparable at equal scope

`server_answer_ms` answers "how long did the online phase take", not "how long
does a private read cost" — those differ when the online phase does not cover
the whole database. Every row therefore carries
`implementation.online_work_scope`.

The `inspire-rs` lineage (`inspire-raven`, `inspire-upstream`,
`inspire-lianghuiqiang9`) fixes `shard_size_bytes = ring_dim × record_bytes` in
`setup()` — **2048 records, independent of N** — and sends `ClientQuery.shard_id`
in cleartext. So its online answer touches one 64 KB shard however large the
database is, and the server learns which shard the index falls in: the anonymity
set is 2048 records, not N. That is the whole explanation for its per-query time
being flat from 2²⁰ to 2²⁸. It is not evidence of good scaling.

`inspire-poulpy`, `inspire2-poulpy` and `isimplepir-raven` answer over the whole
database, and their latency grows with N accordingly.

Plotting the two kinds on one axis without that distinction visible would be the
most misleading thing this site could do, so the scope is a column in the
implementations matrix and a banner whenever both kinds are present.

## 7. What this benchmark does NOT do

- **It does not verify correctness.** No round-trip check gates a number. An
  implementation that returns the wrong record would still be timed.
- **It does not verify security.** `security_bits` is copied from the
  implementation's own claim. It is a label on the row, nothing more. Note that
  claims here have been wrong in the wild: Raven's fork of inspire-rs documents
  replacing upstream's under-provisioned 2-CRT moduli in `secure_128_d{2048,4096}`,
  i.e. the upstream's own 128-bit claim did not hold.
- **It does not normalize parameters across implementations.** Two
  implementations of one scheme routinely pick different ring dimensions and
  moduli. `params.scheme_params` records what each actually ran; a reader
  comparing two rows should check it.

## Adding an implementation

See [`adapters/README.md`](../adapters/README.md) for the contract. In short:

1. `adapters/<impl-id>/props.json` — who the implementation is (metadata only).
2. `adapters/<impl-id>/setup.sh` — clone at a pinned commit and build.
3. `adapters/<impl-id>/bench.sh` — run one cell, emit the canonical report.
4. `scripts/bench.sh --impl <impl-id> --profile smoke` to wire it up, then the
   full grid.
5. Commit the resulting `results/*.json` and `site/data/results.json`.
