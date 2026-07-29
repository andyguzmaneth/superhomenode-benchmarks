#!/usr/bin/env node
// Normalize one canonical adapter report (adapters/README.md) into a result
// record under results/. All provenance comes from the adapter's props.json and
// from flags the driver measured — the adapter itself supplies only numbers, so
// every implementation is described the same way.
//
// Usage:
//   node harness/import-adapter-report.mjs \
//     --report <canonical.json> --props adapters/<id>/props.json \
//     --machine ryzen9900x-8t-32g --cpu "..." --cores 8 --threads 8 \
//     --features avx2,avx512f [--ram-bytes N] [--peak-memory-bytes N] [--out results]

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) throw new Error(`expected flag, got ${k}`);
    a[k.slice(2)] = argv[++i];
  }
  return a;
}

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
for (const req of ["report", "props", "machine"]) {
  if (!args[req]) {
    console.error(`missing required --${req}`);
    process.exit(2);
  }
}

const report = JSON.parse(await readFile(args.report, "utf8"));
const props = JSON.parse(await readFile(args.props, "utf8"));

const numRecords = 2 ** report.cell.entries_log2;
const recordBytes = report.cell.record_bytes;
const dbBytes = numRecords * recordBytes;
const threads = Number(args.threads || args.cores || 1);

const t = report.timings_ms || {};
const sizes = report.sizes_bytes || {};
const answerMs = t.server_answer?.median;

// Throughput is derived, not measured: database bytes per second of server
// compute. Only meaningful for the phase that actually touches the whole DB.
//
// For silent-preprocessing schemes (InsPIRe) the online answer does NOT scan the
// database — the DB-sized work happens once, offline. Dividing DB bytes by the
// answer time there yields a figure above DRAM bandwidth (81 GB/s at 2^24x32B),
// which is why `online_scans_full_db` gates it: an implementation that does not
// scan online gets no online-throughput number at all, rather than a fake one.
const scansOnline = props.online_scans_full_db === true;
const throughputMbps =
  scansOnline && answerMs && answerMs > 0 ? dbBytes / 1e6 / (answerMs / 1000) : undefined;

// Preprocessing throughput is well-defined for every implementation here: the
// offline phase has to touch the whole database exactly once.
const preprocessMs = t.preprocessing?.median;
const preprocessThroughputMbps =
  preprocessMs && preprocessMs > 0 ? dbBytes / 1e6 / (preprocessMs / 1000) : undefined;

const num = (v) => (v == null ? undefined : Number(v));
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const metrics = defined({
  query_bytes: num(sizes.query),
  response_bytes: num(sizes.response),
  offline_hint_bytes: num(sizes.offline_hint),
  preprocessing_ms: preprocessMs,
  server_answer_ms: answerMs,
  server_throughput_mbps: throughputMbps,
  preprocessing_throughput_mbps: preprocessThroughputMbps,
  client_query_gen_ms: t.client_query_gen?.median,
  client_decode_ms: t.client_decode?.median,
  peak_memory_bytes: num(args["peak-memory-bytes"]),
});

// Observed spread, where the adapter reported one. Kept out of `metrics` so the
// headline numbers stay scalar and every existing record remains valid.
const spread = {};
for (const [name, key] of [
  ["server_answer", "server_answer_ms"],
  ["client_query_gen", "client_query_gen_ms"],
  ["client_decode", "client_decode_ms"],
  ["preprocessing", "preprocessing_ms"],
]) {
  const s = t[name];
  if (s && (s.min != null || s.max != null || s.p95 != null)) {
    spread[key] = defined({ min: s.min, max: s.max, p95: s.p95, n: s.n });
  }
}

const record = {
  scheme: props.scheme,
  implementation: defined({
    name: props.implementation,
    repo: props.repo,
    commit: props.commit,
    forked_from: props.forked_from,
    language: props.language,
    backend: props.backend,
    // What the online answer actually covers. Without this, a flat latency
    // curve reads as "scales perfectly" when it may simply mean the online
    // phase never touched more than one fixed-size shard.
    online_work_scope: props.online_work_scope,
  }),
  params: {
    num_records: numRecords,
    record_bytes: recordBytes,
    security_bits: Number(props.security_bits_claimed ?? 0),
    threads,
    scheme_params: defined({
      variant: report.variant ?? props.variant,
      ...(report.scheme_params || {}),
      seeds: report.seeds,
      measured_per_seed: report.measured_per_seed,
    }),
  },
  environment: defined({
    cpu_model: args.cpu || "unknown",
    cpu_features: args.features ? args.features.split(",").filter(Boolean) : undefined,
    logical_cores: num(args.cores),
    ram_bytes: num(args["ram-bytes"]),
    os: args.os || "linux",
    timestamp: new Date().toISOString(),
    runner_version: `${props.implementation}@${(props.commit || "unknown").slice(0, 12)}`,
  }),
  metrics,
  ...(Object.keys(spread).length ? { metrics_spread: spread } : {}),
  notes:
    `Measured on ${args.machine}. security_bits=${props.security_bits_claimed} is claimed by the ` +
    `implementation and is published as a label only — it is not verified here. ` +
    `Scheme params are whatever this implementation chose; compare across implementations with that in mind.` +
    (props.per_query_caveat ? ` CAVEAT: ${props.per_query_caveat}` : "") +
    (props.measurement_caveat ? ` CAVEAT: ${props.measurement_caveat}` : "") +
    (props.notes ? ` ${props.notes}` : ""),
};

const outRoot = args.out ? args.out : join(here, "..", "results");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");
const dir = join(outRoot, slug(props.scheme));
await mkdir(dir, { recursive: true });
const stamp = record.environment.timestamp.replace(/[:.]/g, "").replace(/-/g, "");
const fname = `${slug(props.implementation)}_${numRecords}x${recordBytes}_${slug(args.machine)}_${stamp}.json`;
const path = join(dir, fname);
await writeFile(path, JSON.stringify(record, null, 2) + "\n");

console.log(`wrote ${path}`);
console.log(
  `  ${props.scheme}/${props.implementation}  N=2^${report.cell.entries_log2} x ${recordBytes}B  ` +
    `server ${answerMs ?? "?"}ms  hint ${((sizes.offline_hint ?? 0) / 1e6).toFixed(1)}MB  ` +
    `throughput ${throughputMbps?.toFixed(0) ?? "?"} MB/s` +
    (metrics.peak_memory_bytes
      ? `  peakRSS ${(metrics.peak_memory_bytes / 1e9).toFixed(2)}GB`
      : ""),
);
