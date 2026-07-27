#!/usr/bin/env node
// Map a Hisoka raven `BenchReport` JSON into a pir-bench result record.
//
// We don't reimplement the crypto: raven's b1/b2 bench binaries produce a
// BenchReport per (scheme, cell); this importer normalizes one into our schema
// (schema/result.schema.json) and writes it under results/. Provenance
// (implementation repo/commit, machine, security level) is supplied by flags so
// every imported row is self-describing and honest about where it came from.
//
// Usage:
//   node harness/import-bench-report.mjs \
//     --file <benchreport.json> --scheme iSimplePIR --impl raven-isimplepir \
//     --repo https://github.com/hisoka-io/raven --commit <sha> \
//     --machine "dev-vm" --cpu "..." --cores 4 --features avx2 \
//     --threads 4 --security-bits 128 [--modeled] [--out ../results]

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k.startsWith("--")) throw new Error(`expected flag, got ${k}`);
    if (k === "--modeled") {
      a.modeled = true;
      i -= 1; // no value consumed
      continue;
    }
    a[k.slice(2)] = argv[i + 1];
  }
  return a;
}

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
for (const req of ["file", "scheme", "impl", "security-bits"]) {
  if (!args[req]) {
    console.error(`missing required --${req}`);
    process.exit(2);
  }
}

const report = JSON.parse(await readFile(args.file, "utf8"));
const numRecords = 2 ** report.cell.entries_log2;
const recordBytes = report.cell.record_bytes;
const threads = Number(args.threads || args.cores || 1);
const dbBytes = numRecords * recordBytes;

// server_throughput = database bytes scanned / server compute time.
const serverThroughputMbps =
  report.server_ms_median && report.server_ms_median > 0
    ? dbBytes / 1e6 / (report.server_ms_median / 1000)
    : undefined;

const record = {
  scheme: args.scheme,
  implementation: {
    name: args.impl,
    ...(args.repo ? { repo: args.repo } : {}),
    ...(args.commit ? { commit: args.commit } : {}),
    language: "rust",
  },
  params: {
    num_records: numRecords,
    record_bytes: recordBytes,
    security_bits: Number(args["security-bits"]),
    threads,
    scheme_params: {
      variant: report.scheme, // raven's internal scheme/variant tag
      ...(report.throughput_qps_per_core != null
        ? { throughput_qps_per_core: report.throughput_qps_per_core }
        : {}),
      ...(report.measured_queries != null ? { measured_queries: report.measured_queries } : {}),
    },
  },
  environment: {
    cpu_model: args.cpu || "unknown",
    ...(args.features ? { cpu_features: args.features.split(",").filter(Boolean) } : {}),
    ...(args.cores ? { logical_cores: Number(args.cores) } : {}),
    os: "linux",
    timestamp: new Date().toISOString(),
    runner_version: `raven-bench@${(args.commit || "unknown").slice(0, 12)}`,
  },
  metrics: {
    ...(report.query_bytes != null ? { query_bytes: report.query_bytes } : {}),
    ...(report.response_bytes != null ? { response_bytes: report.response_bytes } : {}),
    ...(report.hint_bytes != null ? { offline_hint_bytes: report.hint_bytes } : {}),
    ...(report.setup_ms != null ? { preprocessing_ms: report.setup_ms } : {}),
    ...(report.server_ms_median != null ? { server_answer_ms: report.server_ms_median } : {}),
    ...(serverThroughputMbps != null ? { server_throughput_mbps: serverThroughputMbps } : {}),
    // raven reports client (query-gen + extract) combined; extract is ~microseconds.
    ...(report.client_ms_median != null ? { client_query_gen_ms: report.client_ms_median } : {}),
  },
  notes:
    `${args.modeled ? "MODELED" : "Measured"} on ${args.machine || "unspecified machine"}. ` +
    `Variant "${report.scheme}"; client_query_gen_ms includes decode. ` +
    `security_bits=${args["security-bits"]} is nominal — confirm against scheme params.`,
};

const outRoot = args.out ? args.out : join(here, "..", "results");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const dir = join(outRoot, slug(args.scheme));
await mkdir(dir, { recursive: true });
const stamp = record.environment.timestamp.replace(/[:.]/g, "").replace(/-/g, "");
const fname = `${slug(args.impl)}_${numRecords}x${recordBytes}_${slug(args.machine || "machine")}_${stamp}.json`;
const path = join(dir, fname);
await writeFile(path, JSON.stringify(record, null, 2) + "\n");
console.log(`wrote ${path}`);
console.log(
  `  ${args.scheme}/${args.impl}  N=${numRecords} x ${recordBytes}B  ` +
    `server ${report.server_ms_median}ms  hint ${(report.hint_bytes / 1e6).toFixed(1)}MB  ` +
    `throughput ${serverThroughputMbps?.toFixed(0)} MB/s`,
);
