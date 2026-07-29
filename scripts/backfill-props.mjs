#!/usr/bin/env node
// Re-apply the implementation-level fields from adapters/*/props.json onto
// already-committed rows in results/.
//
//   node scripts/backfill-props.mjs [--dry-run]
//
// Rows are written at import time, so a row produced before props.json gained a
// field will not carry it. Only descriptive metadata is touched — never a
// measured value — so this can be re-run safely.
//
// Fields it propagates: repo, commit, forked_from, language, backend, framework,
// online_work_scope. The (repo, commit) pair always comes from props.json so the
// two always describe the same codebase — an early importer paired the crypto's
// repo with the bench framework's commit, which is not reproducible.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
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

// Index every adapter's props by the implementation id it publishes under.
const propsById = new Map();
for (const d of await readdir(join(root, "adapters"), { withFileTypes: true })) {
  if (!d.isDirectory() || d.name.startsWith("_")) continue;
  const f = join(root, "adapters", d.name, "props.json");
  try {
    const p = JSON.parse(await readFile(f, "utf8"));
    propsById.set(p.implementation, p);
  } catch {
    /* not an adapter */
  }
}

const files = await walk(join(root, "results"));
let changed = 0;
const missing = new Set();

for (const f of files) {
  const r = JSON.parse(await readFile(f, "utf8"));
  const p = propsById.get(r.implementation?.name);
  if (!p) {
    missing.add(r.implementation?.name);
    continue;
  }

  const before = JSON.stringify(r.implementation);
  r.implementation = {
    name: p.implementation,
    repo: p.repo,
    commit: p.commit,
    ...(p.framework ? { framework: p.framework } : {}),
    ...(p.forked_from ? { forked_from: p.forked_from } : {}),
    ...(p.language ? { language: p.language } : {}),
    ...(p.backend ? { backend: p.backend } : {}),
    ...(p.online_work_scope ? { online_work_scope: p.online_work_scope } : {}),
  };

  if (JSON.stringify(r.implementation) !== before) {
    changed++;
    if (!dryRun) await writeFile(f, JSON.stringify(r, null, 2) + "\n");
  }
}

if (missing.size) {
  console.error(`no adapter found for: ${[...missing].join(", ")} — left untouched`);
}
console.log(
  `${dryRun ? "would update" : "updated"} ${changed}/${files.length} row(s) from ${propsById.size} adapter(s)`,
);
