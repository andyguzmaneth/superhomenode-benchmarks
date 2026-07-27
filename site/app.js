"use strict";

const METRICS = [
  { key: "server_answer_ms", label: "Server compute per query (ms)" },
  { key: "offline_hint_bytes", label: "Client hint download (bytes)" },
  { key: "query_bytes", label: "Query size ↑ (bytes)" },
  { key: "response_bytes", label: "Response size ↓ (bytes)" },
  { key: "server_throughput_mbps", label: "Server throughput (MB/s)" },
  { key: "preprocessing_ms", label: "Setup / preprocessing (ms)" },
];

const PALETTE = ["#4f46e5", "#059669", "#dc2626", "#d97706", "#0891b2", "#7c3aed", "#db2777"];

const el = (id) => document.getElementById(id);
const state = { records: [], selected: new Set(), allSeries: [] };

const seriesKey = (r) => `${r.scheme} · ${r.implementation.name}`;
const colorFor = (key) => PALETTE[state.allSeries.indexOf(key) % PALETTE.length];

function fmt(n) {
  if (n == null) return "–";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
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
  for (const id of ["controls", "chartWrap", "tableWrap"]) el(id).hidden = false;
  initControls();
  render();
}

function initControls() {
  el("recordBytes").innerHTML = uniqueSorted(state.records.map((r) => r.params.record_bytes))
    .map((b) => `<option value="${b}">${b} B</option>`)
    .join("");
  el("metric").innerHTML = METRICS.map((m) => `<option value="${m.key}">${m.label}</option>`).join("");
  el("recordBytes").onchange = render;
  el("metric").onchange = render;

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
  drawChart(rows);
  drawTable(rows);
}

function drawChart(rows) {
  const canvas = el("chart");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.body);
  const fg = css.color;
  const muted = css.getPropertyValue("--muted") || "#888";
  const line = css.getPropertyValue("--line") || "#ccc";
  const metricKey = el("metric").value;

  const pts = rows
    .map((r) => ({ key: seriesKey(r), n: r.params.num_records, y: r.metrics[metricKey] }))
    .filter((p) => p.y != null && p.n > 0);

  const m = { l: 72, r: 16, t: 16, b: 44 };
  if (!pts.length) {
    ctx.fillStyle = muted;
    ctx.font = "14px system-ui";
    ctx.fillText("No data for this metric / selection.", m.l, H / 2);
    return;
  }

  const nsLog = uniqueSorted(pts.map((p) => p.n)).map(Math.log10);
  const xMin = Math.min(...nsLog);
  const xMax = Math.max(...nsLog);
  const yMax = Math.max(...pts.map((p) => p.y)) * 1.1 || 1;
  const px = (lx) => m.l + (xMax === xMin ? 0.5 : (lx - xMin) / (xMax - xMin)) * (W - m.l - m.r);
  const py = (y) => H - m.b - (y / yMax) * (H - m.t - m.b);

  ctx.strokeStyle = line;
  ctx.fillStyle = muted;
  ctx.font = "12px system-ui";
  for (let i = 0; i <= 4; i++) {
    const y = (yMax * i) / 4;
    const yy = py(y);
    ctx.beginPath();
    ctx.moveTo(m.l, yy);
    ctx.lineTo(W - m.r, yy);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(fmt(y), m.l - 8, yy + 4);
  }
  ctx.textAlign = "center";
  for (const lx of nsLog) ctx.fillText("2^" + Math.round(lx * Math.log2(10)), px(lx), H - m.b + 18);

  for (const key of state.allSeries) {
    const s = pts.filter((p) => p.key === key).sort((a, b) => a.n - b.n);
    if (!s.length) continue;
    ctx.strokeStyle = ctx.fillStyle = colorFor(key);
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.forEach((p, i) => (i ? ctx.lineTo(px(Math.log10(p.n)), py(p.y)) : ctx.moveTo(px(Math.log10(p.n)), py(p.y))));
    ctx.stroke();
    s.forEach((p) => {
      ctx.beginPath();
      ctx.arc(px(Math.log10(p.n)), py(p.y), 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  let ly = m.t + 6;
  ctx.textAlign = "left";
  for (const key of state.allSeries) {
    if (!pts.some((p) => p.key === key)) continue;
    ctx.fillStyle = colorFor(key);
    ctx.fillRect(m.l + 8, ly - 8, 10, 10);
    ctx.fillStyle = fg;
    ctx.fillText(key, m.l + 24, ly + 1);
    ly += 18;
  }
}

function drawTable(rows) {
  const cols = [
    ["scheme", (r) => r.scheme],
    ["impl", (r) => r.implementation.name],
    ["N", (r) => "2^" + Math.round(Math.log2(r.params.num_records))],
    ["rec B", (r) => r.params.record_bytes],
    ["thr", (r) => r.params.threads],
    ["hint", (r) => (r.metrics.offline_hint_bytes != null ? fmt(r.metrics.offline_hint_bytes) + "B" : "–")],
    ["server ms", (r) => fmt(r.metrics.server_answer_ms)],
    ["query B", (r) => fmt(r.metrics.query_bytes)],
    ["resp B", (r) => fmt(r.metrics.response_bytes)],
    ["setup ms", (r) => fmt(r.metrics.preprocessing_ms)],
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
