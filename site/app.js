"use strict";

const METRICS = [
  { key: "server_answer_ms", label: "Server compute per query", unit: "ms", kind: "ms" },
  { key: "peak_memory_bytes", label: "Peak memory (whole run)", unit: "bytes", kind: "bytes" },
  { key: "query_bytes", label: "Query size ↑", unit: "bytes", kind: "bytes" },
  { key: "response_bytes", label: "Response size ↓", unit: "bytes", kind: "bytes" },
  { key: "offline_hint_bytes", label: "Client hint download (one-time)", unit: "bytes", kind: "bytes" },
  { key: "preprocessing_ms", label: "Setup / preprocessing", unit: "ms", kind: "ms" },
];

// Per-scheme paper references. Everything else in the properties matrix comes
// from the records themselves, so it can never drift from the measured data.
const SCHEME_PAPERS = {
  iSimplePIR: ["eprint 2026/030", "https://eprint.iacr.org/2026/030"],
  InsPIRe: ["eprint 2025/1352", "https://eprint.iacr.org/2025/1352"],
  InsPIRe2: ["eprint 2025/1352", "https://eprint.iacr.org/2025/1352"],
};

const el = (id) => document.getElementById(id);
const state = { records: [], selected: new Set(), allSeries: [] };

// Implementation is the primary axis: this benchmark compares codebases, so a
// series is one implementation and the scheme is a property of it.
const seriesKey = (r) => r.implementation.name;
// Fixed slot per series in sorted order, never re-assigned when filters change,
// so a colour always means the same implementation.
const colorFor = (key) => `var(--series-${(state.allSeries.indexOf(key) % 6) + 1})`;

function fmtBytes(n) {
  if (n == null) return "–";
  if (n === 0) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + " KB";
  return n + " B";
}
function fmtMs(n) {
  if (n == null) return "–";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + " s";
  return n >= 100 ? n.toFixed(0) + " ms" : n.toFixed(n >= 10 ? 1 : 2) + " ms";
}
function fmtNum(n) {
  if (n == null) return "–";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
const FMT = { bytes: fmtBytes, ms: fmtMs, num: fmtNum };
const uniqueSorted = (vals) => [...new Set(vals)].sort((a, b) => a - b);
const shortRepo = (url) => (url || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\.git$/, "");

async function load() {
  let bundle;
  try {
    bundle = await (await fetch("data/results.json", { cache: "no-store" })).json();
  } catch {
    el("status").textContent = "Could not load data/results.json — run `node site/build-data.mjs` first.";
    return;
  }
  state.records = bundle.records || [];
  if (!state.records.length) {
    el("status").textContent = "No records yet. Produce some with scripts/bench.sh --impl <id>, then rebuild data.";
    return;
  }
  el("status").hidden = true;
  for (const id of ["controls", "charts", "propsWrap", "tableWrap", "hostWrap"]) el(id).hidden = false;
  // The driver labels any row not produced on the frozen machine.
  if (state.records.some((r) => /UNVERIFIED/.test(r.notes || ""))) el("refWarning").hidden = false;
  renderMeta();
  initControls();
  renderProps();
  renderHosts();
  render();
}

function renderMeta() {
  const ts = state.records.map((r) => r.environment?.timestamp).filter(Boolean).sort();
  const last = ts.length ? new Date(ts[ts.length - 1]).toISOString().slice(0, 10) : "–";
  const impls = new Set(state.records.map(seriesKey)).size;
  el("meta").textContent =
    `${state.records.length} results · ${impls} implementations · last updated ${last}`;
}

function initControls() {
  const recordSizes = uniqueSorted(state.records.map((r) => r.params.record_bytes));
  el("recordBytes").innerHTML = recordSizes.map((b) => `<option value="${b}">${b} B</option>`).join("");
  // 32 B is the Ethereum storage-slot width and the only size every
  // implementation covers, so it is the default view.
  if (recordSizes.includes(32)) el("recordBytes").value = "32";
  el("recordBytes").onchange = render;

  state.allSeries = [...new Set(state.records.map(seriesKey))].sort();
  state.selected = new Set(state.allSeries);
  const box = el("impls");
  box.innerHTML = "";
  for (const key of state.allSeries) {
    const chip = document.createElement("span");
    chip.className = "chip on";
    chip.style.setProperty("--dot", colorFor(key));
    chip.textContent = key;
    chip.onclick = () => {
      chip.classList.toggle("on", !state.selected.has(key));
      state.selected.has(key) ? state.selected.delete(key) : state.selected.add(key);
      render();
    };
    box.appendChild(chip);
  }
}

function filtered() {
  const rb = Number(el("recordBytes").value);
  return state.records.filter((r) => r.params.record_bytes === rb && state.selected.has(seriesKey(r)));
}

function render() {
  const rows = filtered();
  drawCharts(rows);
  drawTable(rows);
}

// ---- chart grid (one SVG small-multiple per metric) ----

const CW = 460, CH = 250, M = { l: 62, r: 14, t: 10, b: 30 };

function drawCharts(rows) {
  const grid = el("charts");
  grid.innerHTML = "";
  for (const metric of METRICS) {
    const card = document.createElement("div");
    card.className = "card chart-card";
    card.innerHTML = `<h3>${metric.label} <span class="unit">· ${metric.unit}</span></h3>`;
    const pts = rows
      .map((r) => ({
        key: seriesKey(r),
        n: r.params.num_records,
        y: r.metrics[metric.key],
        spread: r.metrics_spread?.[metric.key],
      }))
      .filter((p) => p.y != null && p.n > 0);
    if (!pts.length) {
      card.insertAdjacentHTML("beforeend", `<div class="empty">No data for this selection.</div>`);
    } else {
      card.appendChild(chartSvg(pts, metric));
    }
    grid.appendChild(card);
  }
}

function chartSvg(pts, metric) {
  const ns = uniqueSorted(pts.map((p) => p.n));
  const xs = ns.map(Math.log2);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  // Include the top of any error bar so whiskers are never clipped.
  const yMax = Math.max(...pts.map((p) => p.spread?.max ?? p.y)) * 1.08 || 1;
  const px = (n) => M.l + (xMax === xMin ? 0.5 : (Math.log2(n) - xMin) / (xMax - xMin)) * (CW - M.l - M.r);
  const py = (y) => CH - M.b - (y / yMax) * (CH - M.t - M.b);
  const fmt = FMT[metric.kind];

  let s = "";
  for (let i = 0; i <= 4; i++) {
    const y = (yMax * i) / 4, yy = py(y);
    s += `<line x1="${M.l}" y1="${yy}" x2="${CW - M.r}" y2="${yy}" stroke="var(--line)" stroke-width="1"/>`;
    s += `<text x="${M.l - 7}" y="${yy + 4}" text-anchor="end">${fmt(y)}</text>`;
  }
  s += `<line x1="${M.l}" y1="${CH - M.b}" x2="${CW - M.r}" y2="${CH - M.b}" stroke="var(--axis)" stroke-width="1"/>`;
  for (const n of ns) s += `<text x="${px(n)}" y="${CH - M.b + 17}" text-anchor="middle">2^${Math.round(Math.log2(n))}</text>`;

  const hover = [];
  for (const key of state.allSeries) {
    const line = pts.filter((p) => p.key === key).sort((a, b) => a.n - b.n);
    if (!line.length) continue;
    const color = colorFor(key);
    const d = line.map((p, i) => `${i ? "L" : "M"}${px(p.n).toFixed(1)},${py(p.y).toFixed(1)}`).join("");
    s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`;
    for (const p of line) {
      const x = px(p.n).toFixed(1);
      // Observed spread across seeds, where the implementation reported one.
      if (p.spread && p.spread.min != null && p.spread.max != null) {
        const hi = py(p.spread.max).toFixed(1), lo = py(p.spread.min).toFixed(1);
        s += `<line x1="${x}" y1="${hi}" x2="${x}" y2="${lo}" stroke="${color}" stroke-width="1.5" opacity="0.7"/>`;
        for (const cap of [hi, lo]) {
          s += `<line x1="${+x - 3}" y1="${cap}" x2="${+x + 3}" y2="${cap}" stroke="${color}" stroke-width="1.5" opacity="0.7"/>`;
        }
      }
      s += `<circle cx="${x}" cy="${py(p.y).toFixed(1)}" r="4" fill="${color}" stroke="var(--card)" stroke-width="2"/>`;
      hover.push({ x: px(p.n), y: py(p.y), p });
    }
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${CW} ${CH}`);
  svg.innerHTML = s;
  attachHover(svg, hover, metric);
  return svg;
}

function attachHover(svg, hover, metric) {
  const tip = el("tooltip");
  const fmt = FMT[metric.kind];
  svg.addEventListener("mousemove", (ev) => {
    const box = svg.getBoundingClientRect();
    const sx = ((ev.clientX - box.left) / box.width) * CW;
    const sy = ((ev.clientY - box.top) / box.height) * CH;
    let best = null, bestD = 25 * 25; // 25px hit radius in viewBox units
    for (const h of hover) {
      const d = (h.x - sx) ** 2 + (h.y - sy) ** 2;
      if (d < bestD) { bestD = d; best = h; }
    }
    if (!best) { tip.hidden = true; return; }
    const sp = best.p.spread;
    tip.innerHTML =
      `<div class="t-series"><span class="dot" style="background:${colorFor(best.p.key)}"></span>${best.p.key}</div>` +
      `<div><span class="t-dim">N = </span>2^${Math.round(Math.log2(best.p.n))}` +
      `<span class="t-dim"> · ${metric.label.toLowerCase()}: </span>${fmt(best.p.y)}</div>` +
      (sp && sp.min != null
        ? `<div class="t-dim">spread ${fmt(sp.min)} – ${fmt(sp.max)}${sp.n ? ` over ${sp.n} seeds` : ""}</div>`
        : "");
    tip.hidden = false;
    tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = ev.clientY + 14 + "px";
  });
  svg.addEventListener("mouseleave", () => { tip.hidden = true; });
}

// ---- implementation properties matrix ----

function renderProps() {
  const bySeries = new Map();
  for (const r of state.records) if (!bySeries.has(seriesKey(r))) bySeries.set(seriesKey(r), r);
  const rows = [...bySeries.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const head = [
    "implementation", "scheme", "paper", "variant", "lineage", "backend", "source", "commit", "claims",
  ];
  el("props").innerHTML =
    `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>` +
    rows
      .map(([key, r]) => {
        const impl = r.implementation;
        const paperRef = SCHEME_PAPERS[r.scheme];
        const paper = paperRef ? `<a href="${paperRef[1]}">${paperRef[0]}</a>` : "–";
        // Lineage is the story here: four of these descend from one repo that
        // no longer exists.
        const lineage = impl.forked_from
          ? `fork of <a href="${impl.forked_from}">${shortRepo(impl.forked_from).replace("github.com/", "")}</a>`
          : `<span class="t-dim">independent</span>`;
        const backend = (impl.backend || []).join(" + ") || "–";
        // Implementations tag their variant verbosely (raven's runs to ~60
        // chars); truncate so the matrix stays readable, full string on hover.
        const rawVariant = r.params?.scheme_params?.variant || "–";
        const variant =
          rawVariant.length > 28
            ? `<span title="${rawVariant}">${rawVariant.slice(0, 27)}…</span>`
            : rawVariant;
        return (
          `<tr><td class="l"><span class="dot" style="background:${colorFor(key)}"></span>${impl.name}</td>` +
          `<td class="l">${r.scheme}</td><td class="l">${paper}</td>` +
          `<td class="l">${variant}</td><td class="l">${lineage}</td><td class="l">${backend}</td>` +
          `<td class="l"><a href="${impl.repo}">${shortRepo(impl.repo)}</a></td>` +
          `<td class="l"><code>${String(impl.commit || "").slice(0, 10)}</code></td>` +
          `<td>${r.params.security_bits} bit</td></tr>`
        );
      })
      .join("") +
    `</tbody>`;
}

// ---- host machine ----

function renderHosts() {
  const seen = new Map();
  for (const r of state.records) {
    const e = r.environment || {};
    const k = `${e.cpu_model}|${e.logical_cores}|${e.ram_bytes}|${e.os}`;
    if (!seen.has(k)) seen.set(k, { e, count: 0, verified: !/UNVERIFIED/.test(r.notes || "") });
    seen.get(k).count++;
  }
  el("hosts").innerHTML = [...seen.values()]
    .map(
      ({ e, count, verified }) =>
        `<div class="host"><span><b>${e.cpu_model || "unknown CPU"}</b></span>` +
        `<span>${e.logical_cores ?? "?"} threads</span>` +
        `<span>${e.ram_bytes ? (e.ram_bytes / 1024 ** 3).toFixed(0) + " GiB" : "?"}</span>` +
        `<span>${(e.cpu_features || []).join(", ") || "?"}</span>` +
        `<span>${e.os || "?"}</span><span>${count} result(s)</span>` +
        (verified ? "" : `<span class="badge">not the reference machine</span>`) +
        `</div>`,
    )
    .join("");
}

// ---- all-results table ----

function drawTable(rows) {
  const cols = [
    ["impl", (r) => `<span class="dot" style="background:${colorFor(seriesKey(r))}"></span>${r.implementation.name}`],
    ["scheme", (r) => r.scheme],
    ["N", (r) => "2^" + Math.round(Math.log2(r.params.num_records))],
    ["rec", (r) => r.params.record_bytes + " B"],
    ["thr", (r) => r.params.threads],
    ["server", (r) => fmtMs(r.metrics.server_answer_ms)],
    ["query", (r) => fmtBytes(r.metrics.query_bytes)],
    ["resp", (r) => fmtBytes(r.metrics.response_bytes)],
    ["hint", (r) => fmtBytes(r.metrics.offline_hint_bytes)],
    ["setup", (r) => fmtMs(r.metrics.preprocessing_ms)],
    ["peak RSS", (r) => fmtBytes(r.metrics.peak_memory_bytes)],
    // Online throughput exists only where the online phase scans the whole DB;
    // for silent-preprocessing implementations the ratio is meaningless.
    ["online MB/s", (r) => fmtNum(r.metrics.server_throughput_mbps)],
    ["prep MB/s", (r) => fmtNum(r.metrics.preprocessing_throughput_mbps)],
  ];
  const sorted = [...rows].sort(
    (a, b) => a.params.num_records - b.params.num_records || seriesKey(a).localeCompare(seriesKey(b)),
  );
  el("table").innerHTML =
    `<thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join("")}</tr></thead>` +
    `<tbody>${sorted.map((r) => `<tr>${cols.map((c) => `<td>${c[1](r)}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

load();
