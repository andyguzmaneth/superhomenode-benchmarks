#!/usr/bin/env node
// Scans ../results for benchmark records and bundles them into ./data/results.json,
// the single file the static explorer loads. Run after producing new records.
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, "..", "results");
const outDir = join(here, "data");

async function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // results/ may not exist yet
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(await walk(p));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

const files = await walk(resultsDir);
const records = [];
for (const f of files) {
  try {
    records.push(JSON.parse(await readFile(f, "utf8")));
  } catch (err) {
    console.error(`skip ${f}: ${err.message}`);
  }
}

// A cell may be measured more than once (a re-run after a harness fix, a
// resumed suite). Keep only the newest row per (implementation, N, record size,
// machine) so the explorer never plots the same point twice. The older files
// stay on disk as history; `scripts/prune-superseded.mjs` removes them.
const machineOf = (r) => (r.notes || "").match(/(?:Measured|MODELED) on ([^.]+)\./)?.[1]?.trim() || "?";
const cellKey = (r) =>
  `${r.implementation?.name}|${r.params?.num_records}|${r.params?.record_bytes}|${machineOf(r)}`;
const newest = new Map();
for (const r of records) {
  const k = cellKey(r);
  const prev = newest.get(k);
  if (!prev || (r.environment?.timestamp || "") > (prev.environment?.timestamp || "")) {
    newest.set(k, r);
  }
}
const superseded = records.length - newest.size;
records.length = 0;
records.push(...newest.values());
if (superseded > 0) console.log(`ignored ${superseded} superseded row(s)`);

// Stable sort so the bundle is diff-friendly.
records.sort((a, b) => {
  const k = (r) =>
    `${r.scheme}|${r.implementation?.name}|${String(r.params?.num_records).padStart(12, "0")}|${String(
      r.params?.record_bytes,
    ).padStart(8, "0")}`;
  return k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0;
});

const bundle = {
  generated_from: `${records.length} record(s)`,
  schemes: [...new Set(records.map((r) => r.scheme))].sort(),
  implementations: [...new Set(records.map((r) => r.implementation?.name))].sort(),
  records,
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "results.json"), JSON.stringify(bundle, null, 2) + "\n");
console.log(`wrote data/results.json (${records.length} records, ${bundle.implementations.length} implementations)`);
