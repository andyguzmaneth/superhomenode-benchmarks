"use strict";

const METRICS = [
  { key: "server_answer_ms", label: "Server compute per query", unit: "ms", kind: "ms" },
  { key: "offline_hint_bytes", label: "Client hint download (one-time)", unit: "bytes", kind: "bytes" },
  { key: "query_bytes", label: "Query size ↑", unit: "bytes", kind: "bytes" },
  { key: "response_bytes", label: "Response size ↓", unit: "bytes", kind: "bytes" },
  { key: "server_throughput_mbps", label: "Server throughput", unit: "MB/s", kind: "num" },
  { key: "preprocessing_ms", label: "Setup / preprocessing", unit: "ms", kind: "ms" },
];

// Static per-scheme facts (ethproofs-style properties matrix). Keyed by record.scheme.
const SCHEME_PROPS = {
  iSimplePIR: {
    paper: ["eprint 2026/030", "https://eprint.iacr.org/2026/030"],
    assumption: "LWE",
    hint: "Yes — client downloads a hint that grows with N",
    preprocessing: "Server DB packing + per-client hint",
    impl_note: "raven crates/isimplepir",
  },
  InsPIRe: {
    paper: ["eprint 2025/1352", "https://eprint.iacr.org/2025/1352"],
    assumption: "RLWE",
    hint: "No — zero client hint",
    preprocessing: "Server-side only (silent)",
    impl_note: "inspire-rs, two-packing variant",
  },
};

const el = (id) => document.getElementById(id);
const state = { records: [], selected: new Set(), allSeries: [] };

const seriesKey = (r) => `${r.scheme} · ${r.implementation.name}`;
// Fixed slot per series (sorted order), never re-assigned when filters change.
const colorFor = (key) => `var(--series-${(state.allSeries.indexOf(key) % 5) + 1})`;

function fmtBytes(n) {
  if (n == null) return "–";
  if (n === 0) return "0";
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
    el("status").textContent = "No records yet. Produce some with scripts/bench-cell.sh, then rebuild data.";
    return;
  }
  el("status").hidden = true;
  for (const id of ["controls", "charts", "propsWrap", "tableWrap", "hostWrap"]) el(id).hidden = false;
  if (state.records.some((r) => /NOT home-staker reference/.test(r.notes || ""))) el("refWarning").hidden = false;
  renderMeta();
  initControls();
  renderProps();
  renderHosts();
  render();
}

function renderMeta() {
  const ts = state.records.map((r) => r.environment?.timestamp).filter(Boolean).sort();
  const last = ts.length ? new Date(ts[ts.length - 1]).toISOString().slice(0, 10) : "–";
  el("meta").textContent = `${state.records.length} results · last updated ${last}`;
}

function initControls() {
  const recordSizes = uniqueSorted(state.records.map((r) => r.params.record_bytes));
  el("recordBytes").innerHTML = recordSizes.map((b) => `<option value="${b}">${b} B</option>`).join("");
  // Default to 32 B (Ethereum storage-slot width, usually the best-populated axis).
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

const CW = 460, CH = 250, M = { l: 58, r: 14, t: 10, b: 30 };

function drawCharts(rows) {
  const grid = el("charts");
  grid.innerHTML = "";
  for (const metric of METRICS) {
    const card = document.createElement("div");
    card.className = "card chart-card";
    card.innerHTML = `<h3>${metric.label} <span class="unit">· ${metric.unit}</span></h3>`;
    const pts = rows
      .map((r) => ({ key: seriesKey(r), n: r.params.num_records, y: r.metrics[metric.key] }))
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
  const yMax = Math.max(...pts.map((p) => p.y)) * 1.08 || 1;
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
      s += `<circle cx="${px(p.n).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="4" fill="${color}" stroke="var(--card)" stroke-width="2"/>`;
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
    tip.innerHTML =
      `<div class="t-series"><span class="dot" style="background:${colorFor(best.p.key)}"></span>${best.p.key}</div>` +
      `<div><span class="t-dim">N = </span>2^${Math.round(Math.log2(best.p.n))}` +
      `<span class="t-dim"> · ${metric.label.toLowerCase()}: </span>${fmt(best.p.y)}</div>`;
    tip.hidden = false;
    tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = ev.clientY + 14 + "px";
  });
  svg.addEventListener("mouseleave", () => { tip.hidden = true; });
}

// ---- scheme properties matrix ----

function renderProps() {
  const bySeries = new Map();
  for (const r of state.records) if (!bySeries.has(seriesKey(r))) bySeries.set(seriesKey(r), r);
  const rows = [...bySeries.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const head = ["scheme", "paper", "assumption", "client hint", "preprocessing", "implementation", "commit"];
  el("props").innerHTML =
    `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>` +
    rows
      .map(([key, r]) => {
        const p = SCHEME_PROPS[r.scheme] || {};
        const paper = p.paper ? `<a href="${p.paper[1]}">${p.paper[0]}</a>` : "–";
        const impl = `<a href="${r.implementation.repo}">${r.implementation.name}</a>${p.impl_note ? ` <span class="t-dim">(${p.impl_note})</span>` : ""}`;
        return `<tr><td><span class="dot" style="background:${colorFor(key)}"></span>${r.scheme}</td>` +
          `<td class="l">${paper}</td><td class="l">${p.assumption || "–"}</td><td class="l">${p.hint || "–"}</td>` +
          `<td class="l">${p.preprocessing || "–"}</td><td class="l">${impl}</td>` +
          `<td class="l"><code>${r.implementation.commit.slice(0, 10)}</code></td></tr>`;
      })
      .join("") +
    `</tbody>`;
}

// ---- host machines ----

function renderHosts() {
  const seen = new Map();
  for (const r of state.records) {
    const e = r.environment || {};
    const k = `${e.cpu_model}|${e.logical_cores}|${e.os}`;
    if (!seen.has(k)) seen.set(k, { e, count: 0, ref: !/NOT home-staker reference/.test(r.notes || "") });
    seen.get(k).count++;
  }
  el("hosts").innerHTML = [...seen.values()]
    .map(
      ({ e, count, ref }) =>
        `<div class="host"><span><b>${e.cpu_model || "unknown CPU"}</b></span>` +
        `<span>${e.logical_cores ?? "?"} threads</span><span>${e.os || "?"}</span>` +
        `<span>${count} result(s)</span>` +
        (ref ? "" : `<span class="badge">dev VM — not reference</span>`) +
        `</div>`,
    )
    .join("");
}

// ---- all-results table ----

function drawTable(rows) {
  const cols = [
    ["scheme", (r) => `<span class="dot" style="background:${colorFor(seriesKey(r))}"></span>${r.scheme}`],
    ["impl", (r) => r.implementation.name],
    ["N", (r) => "2^" + Math.round(Math.log2(r.params.num_records))],
    ["rec", (r) => r.params.record_bytes + " B"],
    ["thr", (r) => r.params.threads],
    ["hint", (r) => fmtBytes(r.metrics.offline_hint_bytes)],
    ["server", (r) => fmtMs(r.metrics.server_answer_ms)],
    ["query", (r) => fmtBytes(r.metrics.query_bytes)],
    ["resp", (r) => fmtBytes(r.metrics.response_bytes)],
    ["setup", (r) => fmtMs(r.metrics.preprocessing_ms)],
    ["", (r) => (r.notes && /^MODELED/.test(r.notes) ? '<span class="badge">modeled</span>' : "")],
  ];
  const sorted = [...rows].sort(
    (a, b) => a.params.num_records - b.params.num_records || seriesKey(a).localeCompare(seriesKey(b)),
  );
  el("table").innerHTML =
    `<thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join("")}</tr></thead>` +
    `<tbody>${sorted.map((r) => `<tr>${cols.map((c) => `<td>${c[1](r)}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

load();
