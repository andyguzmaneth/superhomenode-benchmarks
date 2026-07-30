# Sizing a deployment

How to choose a configuration for a real home-node deployment, derived from the
published grid plus targeted sweeps with
[`adapters/inspire-poulpy/small-driver`](../adapters/inspire-poulpy/small-driver).

> **Status of the numbers here.** Sizes (query, response, capacity) are exact —
> they are deterministic functions of the parameters and layout, identical on any
> host. Memory figures come from real runs. **Latencies in this document are not
> reference numbers** where they came from the small-driver sweeps (AVX2, 16 GB);
> only rows in `results/` are reference-machine measurements. Anything published
> as a latency claim needs a re-run on the frozen machine.

## The design rule

Three quantities decouple cleanly. Measured across two constructions and a 17×
range of database sizes:

```
capacity  = rows × cols / 16          (recursion, P65536, EXPONENT 16)
          = (rows / 2048) × cols × 120 (interpolation, P65535, EXPONENT 17)

memory   ≈ f(rows)      → choose for your co-residency budget
query    ≈ f(cols)      → choose for your bandwidth budget
response  = constant     → 32 KB interpolation · 197 KB recursion
```

`query ≈ f(cols)` is not an approximation: `c16384` produces **329,281 bytes**
at a 240 MiB database and at a 4 GiB one. Changing the database size alone does
not change the query at all.

The interpolation capacity formula explains an oddity in the crate's own preset
names: `2048 / 17 = 120.47` truncates to 120, so `InsPIRe-4GiB-c8192` reports a
capacity of 3.750 GiB rather than 4.000.

## Choosing a construction — it inverts with scale

| Scale | Binding constraint | Winner | Why |
| --- | --- | --- | --- |
| ~4 GiB | memory | **InsPIRe²** (recursion) | ~2× lighter; interpolation needs 20–28 GiB |
| ~240 MiB | bandwidth | **InsPIRe** (interpolation) | 32 KB response vs 197 KB outweighs its larger query |

At 240 MiB, total bandwidth by width (query + response):

| cols | Interpolation | Recursion |
| --- | --- | --- |
| 2048 | **241 KB** | 378 KB |
| 4096 | **257 KB** | 390 KB |
| 8192 | **289 KB** | 428 KB |
| 16384 | **354 KB** | 510 KB |

Recursion has the smaller *query* at every width; interpolation still wins on
the total because its response is 6× smaller. Optimising the query alone picks
the wrong construction.

## A worked configuration: one token contract, co-resident with a node

Target: a single ERC-20's balance mapping (~8M holders × 32 B ≈ 240 MiB), served
from a 32 GB machine that is also running an execution and a consensus client
(typically 8–16 GiB).

**Recommended: interpolation, `rows = 16384`, `cols = 8192`.**

| | |
| --- | --- |
| Capacity | 7,864,320 payloads (240 MiB) |
| Query ↑ | 263 KB |
| Response ↓ | 32 KB |
| **Total per lookup** | **289 KB** |
| Peak memory | 6.50 GiB |
| Headroom on 32 GB | ~10 GiB after EL+CL |
| ~600 lookups/month | ~173 MB |
| Upload on 4G (~8 Mbps) | ~0.3 s |

Trade from there: `cols = 16384` frees memory (4.23 GiB) at 354 KB;
`cols = 4096` cuts bandwidth (257 KB) at 7.81 GiB.

## Larger deployments

At 4 GiB, use recursion. `InsPIRe2-g32-4GiB-c32768` gives 13.36 GiB peak and
625 KB per lookup — the default preset pairing (`c65536`) costs 264 KB more
bandwidth for 2.4 GiB of memory you can usually spare.

16 GiB of private state is reachable (382 ms, 27.88 GB peak) but **only on a
dedicated machine** — it leaves ~3 GiB, which will not co-exist with a node.

## What these numbers do not include

Three real costs sit outside every figure above:

1. **Keyword lookup.** PIR retrieves by position. Going from an address to an
   index needs `keccak256(abi.encode(addr, slot))` and then a minimal perfect
   hash over the key set (poulpy has a `keyword` module; raven has
   `binary-fuse-filter`). The MPHF parameters are a client download, and an MPHF
   is not incrementally updatable — adding one key can re-shuffle every position,
   so clients re-download at index-rebuild cadence. **This may exceed the
   per-query cost entirely and is not measured yet.**
2. **Integrity.** PIR gives privacy, not authenticity — a server can return
   garbage. The fix is a Merkle proof against a state root the client already
   trusts from its consensus client (not a ZKP, which would be far more
   expensive for the same assurance). But proofs inflate record width, and width
   is where these schemes get expensive.
3. **Freshness.** A server may return a valid but stale record. The root must be
   pinned to a recent block the client knows independently.

## Preprocessing is not a constraint

Rebuild cost is a ~1.5% duty cycle even at 16 GiB (52.9 s, hourly). A
delta-index sidecar refreshed frequently alongside a base index rebuilt hourly
is comfortably affordable. One requirement: **the client must query both indexes
on every lookup** — querying the delta only for recently-changed records would
leak that the record was recently modified.

## Caveat on the small-driver shapes

`small-driver` supplies its own `DatabaseLayout` rather than resolving a preset,
so it reaches shapes poulpy's authors never enumerated in `cols_window` / `ALL`
(which cover 1–32 GiB only). The crate's own shape assertions all pass and every
run decoded correctly, but that is evidence the parameters are sound at these
sizes, not proof. Treat sub-1 GiB configurations as unvalidated by upstream.
