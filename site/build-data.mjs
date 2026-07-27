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
