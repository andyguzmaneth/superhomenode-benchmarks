#!/usr/bin/env node
// Translate raven's per-seed `BenchReport` JSONs into one canonical adapter
// report (see adapters/README.md).
//
//   node raven-to-adapter.mjs --out <report.json> <seed-0.json> [<seed-1.json> ...]
//
// raven emits one report per seed, each already a median over `measured_queries`
// iterations. We take the median across seeds as the headline and keep min/max
// as the observed spread — with 3 seeds that spread is thin, but it is real
// measured variation and PIR at these sizes is memory-bandwidth-bound enough
// that hiding it would be dishonest.

import { readFile, writeFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
if (outIdx === -1 || !argv[outIdx + 1]) {
  console.error("usage: raven-to-adapter.mjs --out <report.json> <benchreport.json>...");
  process.exit(2);
}
const outPath = argv[outIdx + 1];
const files = argv.filter((_, i) => i !== outIdx && i !== outIdx + 1);
if (files.length === 0) {
  console.error("no BenchReport files given");
  process.exit(2);
}

const reports = [];
for (const f of files) reports.push(JSON.parse(await readFile(f, "utf8")));

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Collapse one numeric field across seeds into a canonical timing object.
function spread(key) {
  const xs = reports.map((r) => r[key]).filter((v) => typeof v === "number");
  if (xs.length === 0) return undefined;
  const t = { median: median(xs) };
  if (xs.length > 1) {
    t.min = Math.min(...xs);
    t.max = Math.max(...xs);
    t.n = xs.length;
  }
  return t;
}

// Sizes are deterministic given the cell, so seed 0 is authoritative; assert the
// others agree rather than silently averaging over a real disagreement.
const head = reports[0];
for (const r of reports.slice(1)) {
  for (const k of ["query_bytes", "response_bytes", "hint_bytes"]) {
    if (r[k] !== head[k]) {
      console.error(`seed disagreement on ${k}: ${head[k]} vs ${r[k]} — refusing to average`);
      process.exit(1);
    }
  }
}

const timings = {};
for (const [name, key] of [
  ["server_answer", "server_ms_median"],
  ["client_query_gen", "client_ms_median"],
  ["preprocessing", "setup_ms"],
  ["end_to_end_query", "query_ms_median"],
]) {
  const t = spread(key);
  if (t) timings[name] = t;
}

const report = {
  cell: head.cell,
  variant: head.scheme,
  scheme_params: {
    ...(head.throughput_qps_per_core != null
      ? { throughput_qps_per_core: head.throughput_qps_per_core }
      : {}),
  },
  timings_ms: timings,
  sizes_bytes: {
    ...(head.query_bytes != null ? { query: head.query_bytes } : {}),
    ...(head.response_bytes != null ? { response: head.response_bytes } : {}),
    ...(head.hint_bytes != null ? { offline_hint: head.hint_bytes } : {}),
  },
  seeds: reports.map((_, i) => i),
  ...(head.measured_queries != null ? { measured_per_seed: head.measured_queries } : {}),
};

await writeFile(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(`wrote ${outPath} (${reports.length} seed report(s))`);
