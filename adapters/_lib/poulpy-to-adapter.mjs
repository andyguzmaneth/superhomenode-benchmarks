#!/usr/bin/env node
// Translate the stdout of poulpy-pir's `examples/pir.rs` into a canonical
// adapter report (see adapters/README.md).
//
//   node poulpy-to-adapter.mjs --out <report.json> --log <stdout.txt> \
//     --entries-log2 25 --record-bytes 32 --preset InsPIRe-1GiB-c32768
//
// We drive poulpy's own example rather than linking its library: the crate is
// edition-2024, generic over the FHE backend, and pins poulpy by git rev, so a
// bespoke driver would couple this repo to an API that moves. The example
// already reports every phase we publish.

import { readFile, writeFile } from "node:fs/promises";

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) throw new Error(`expected flag, got ${k}`);
    a[k.slice(2)] = argv[++i];
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
for (const req of ["out", "log", "entries-log2", "record-bytes", "preset"]) {
  if (!args[req]) {
    console.error(`missing required --${req}`);
    process.exit(2);
  }
}

const log = await readFile(args.log, "utf8");

// Rust's Duration Debug format: "1.234567s", "12.3ms", "456.7µs", "90ns", "1m2s".
function durationToMs(s) {
  const t = s.trim();
  const m = t.match(/^(?:(\d+)m)?([\d.]+)(s|ms|µs|us|ns)$/);
  if (!m) return undefined;
  const [, mins, num, unit] = m;
  const v = parseFloat(num);
  const base = { s: 1e3, ms: 1, "µs": 1e-3, us: 1e-3, ns: 1e-6 }[unit];
  return (mins ? parseInt(mins, 10) * 60_000 : 0) + v * base;
}

// The example pads labels with spaces before ':', and some labels embed the
// batch/repeat counts — so match on a prefix rather than an exact label.
function field(prefix) {
  const line = log
    .split("\n")
    .find((l) => l.trimStart().startsWith(prefix));
  if (!line) return undefined;
  return line.slice(line.indexOf(":") + 1).trim();
}

const durMs = (prefix) => {
  const v = field(prefix);
  return v == null ? undefined : durationToMs(v);
};

// "12345 B (12.056 KiB)" -> 12345
const bytes = (prefix) => {
  const v = field(prefix);
  if (v == null) return undefined;
  const m = v.match(/^(\d+)\s*B/);
  return m ? Number(m[1]) : undefined;
};

const result = field("RESULT");
if (!result || !/^(\d+)\/\1 decoded OK/.test(result)) {
  // Not a correctness gate — this benchmark does not verify correctness. But the
  // example asserts its own decode, so a run that did not reach a clean RESULT
  // line did not complete, and its timings are partial.
  console.error(`poulpy run did not complete (RESULT: ${result ?? "absent"})`);
  process.exit(1);
}

const setupMs = durMs("SETUP  ") ?? durMs("SETUP ");
const fillMs = durMs("database fill");
const maskMs = durMs("SETUP (query mask)");
const offlineMs = durMs("OFFLINE total");

// Our `preprocessing` is all one-time, query-independent server work over the
// database — the analogue of raven's setup_ms. poulpy splits it four ways; we
// sum for the headline and keep the breakdown in scheme_params.
const preprocessingMs = [setupMs, fillMs, maskMs, offlineMs]
  .filter((v) => v != null)
  .reduce((a, b) => a + b, 0);

const onlineMs = durMs("ONLINE avg wall");
const queryBuildMs = durMs("QUERY (build");
// Label carries the batch size: "ONLINE avg wall (1 q × 10)".
const batch = Number(log.match(/ONLINE avg wall \((\d+) q/)?.[1] ?? 1);

const peakLine = field("PEAK MEMORY (VmHWM)");
function iecToBytes(s) {
  const m = s?.match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB)$/);
  if (!m) return undefined;
  const mult = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 }[m[2]];
  return Math.round(parseFloat(m[1]) * mult);
}

const timings = {};
if (onlineMs != null) timings.server_answer = { median: onlineMs };
if (queryBuildMs != null) timings.client_query_gen = { median: queryBuildMs / batch };
if (preprocessingMs > 0) timings.preprocessing = { median: preprocessingMs };
// client_decode is not reported separately by the example — omitted rather than
// invented. See adapters/README.md: never substitute 0 for "not measured".

const report = {
  cell: {
    entries_log2: Number(args["entries-log2"]),
    record_bytes: Number(args["record-bytes"]),
  },
  variant: args.preset,
  scheme_params: {
    preset: args.preset,
    collapse: field("collapse"),
    ring_degree_n: field("ring degree n") ? Number(field("ring degree n")) : undefined,
    packing_widths: field("packing γ0 / γ1 / γ2"),
    interpolation_degree_t: field("interpolation degree (t)"),
    online_repeats: 10, // REPEATS in examples/pir.rs
    batch,
    phase_breakdown_ms: {
      setup: setupMs,
      database_fill: fillMs,
      query_mask: maskMs,
      offline: offlineMs,
    },
    noise_log2_max: field("NOISE log2(max)"),
    poulpy_reported_peak_rss_bytes: iecToBytes(peakLine),
  },
  timings_ms: timings,
  sizes_bytes: {
    ...(bytes("QUERY size") != null ? { query: bytes("QUERY size") } : {}),
    ...(bytes("RESPONSE size") != null ? { response: bytes("RESPONSE size") } : {}),
    // CRS model, silent preprocessing: the client downloads no hint.
    offline_hint: 0,
  },
  // The example has no seed parameter; it averages the online phase over its own
  // REPEATS=10 internally. One run, so no cross-seed spread is reported.
  seeds: [0],
  measured_per_seed: 10,
};

// Drop undefined leaves so the report stays honest about what was measured.
const prune = (o) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, v && typeof v === "object" && !Array.isArray(v) ? prune(v) : v]),
  );

await writeFile(args.out, JSON.stringify(prune(report), null, 2) + "\n");
console.log(`wrote ${args.out} (preset ${args.preset})`);
