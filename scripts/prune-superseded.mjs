#!/usr/bin/env node
// Delete result files superseded by a newer measurement of the same cell.
//
//   node scripts/prune-superseded.mjs [--dry-run]
//
// A cell can be measured more than once — a harness fix, a resumed suite. The
// site already ignores the older rows; this removes the files so results/ shows
// what is actually published. Keyed the same way as site/build-data.mjs:
// (implementation, N, record size, machine), newest environment.timestamp wins.

import { readdir, readFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, "..", "results");
const dryRun = process.argv.includes("--dry-run");

async function walk(dir) {
  let out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(await walk(p));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

const machineOf = (r) => (r.notes || "").match(/(?:Measured|MODELED) on ([^.]+)\./)?.[1]?.trim() || "?";

const best = new Map();
const drop = [];
for (const f of await walk(resultsDir)) {
  const r = JSON.parse(await readFile(f, "utf8"));
  const k = `${r.implementation?.name}|${r.params?.num_records}|${r.params?.record_bytes}|${machineOf(r)}`;
  const ts = r.environment?.timestamp || "";
  const prev = best.get(k);
  if (!prev) {
    best.set(k, { f, ts });
  } else if (ts > prev.ts) {
    drop.push(prev.f);
    best.set(k, { f, ts });
  } else {
    drop.push(f);
  }
}

for (const f of drop) {
  console.log(`${dryRun ? "would remove" : "removed"} ${f.replace(join(here, ".."), ".")}`);
  if (!dryRun) await unlink(f);
}
console.log(`${best.size} current row(s), ${drop.length} superseded`);
