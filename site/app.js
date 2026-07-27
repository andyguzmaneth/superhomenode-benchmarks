"use strict";

const METRICS = [
  { key: "server_throughput_mbps", label: "Server throughput (MB/s)" },
  { key: "server_answer_ms", label: "Server answer (ms)" },
  { key: "response_bytes", label: "Response size (bytes)" },
  { key: "query_bytes", label: "Query size (bytes)" },
  { key: "preprocessing_ms", label: "Preprocessing (ms)" },
];

const PALETTE = ["#4f46e5", "#059669", "#dc2626", "#d97706", "#0891b2", "#7c3aed", "#db2777"];

const el = (id) => document.getElementById(id);
const state = { records: [], selectedImpls: new Set() };

function colorFor(impl, impls) {
  return PALETTE[impls.indexOf(impl) % PALETTE.length];
}

function fmt(n) {
  if (n == null) return "–";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function uniqueSorted(vals) {
  return [...new Set(vals)].sort((a, b) => a - b);
}

async function load() {
  let bundle;
  try {
    const res = await fetch("data/results.json", { cache: "no-store" });
    bundle = await res.json();
  } catch (e) {
    el("status").textContent =
      "Could not load data/results.json — run `node site/build-data.mjs` first.";
    return;
  }
  state.records = bundle.records || [];
  if (state.records.length === 0) {
    el("status").textContent = "No records yet. Produce some with the harness, then rebuild data.";
    return;
  }
  el("status").hidden = true;
  el("controls").hidden = false;
  el("chartWrap").hidden = false;
  el("tableWrap").hidden = false;
  initControls();
  render();
}

function initControls() {
  const schemes = [...new Set(state.records.map((r) => r.scheme))].sort();
  const schemeSel = el("scheme");
  schemeSel.innerHTML = schemes.map((s) => `<option>${s}</option>`).join("");

  const metricSel = el("metric");
  metricSel.innerHTML = METRICS.map((m) => `<option value="${m.key}">${m.label}</option>`).join("");

  schemeSel.onchange = () => {
    refreshRecordSizes();
    refreshImpls();
    render();
  };
  metricSel.onchange = render;
  el("recordBytes").onchange = render;

  refreshRecordSizes();
  refreshImpls();
}

function currentScheme() {
  return el("scheme").value;
}

function refreshRecordSizes() {
  const sizes = uniqueSorted(
    state.records.filter((r) => r.scheme === currentScheme()).map((r) => r.params.record_bytes),
  );
  el("recordBytes").innerHTML = sizes.map((b) => `<option value="${b}">${b} B</option>`).join("");
}

function refreshImpls() {
  const impls = [
    ...new Set(state.records.filter((r) => r.scheme === currentScheme()).map((r) => r.implementation.name)),
  ].sort();
  state.selectedImpls = new Set(impls);
  const box = el("impls");
  box.innerHTML = "";
  for (const name of impls) {
    const chip = document.createElement("span");
    chip.className = "chip on";
    chip.textContent = name;
    chip.onclick = () => {
      if (state.selectedImpls.has(name)) {
        state.selectedImpls.delete(name);
        chip.classList.remove("on");
      } else {
        state.selectedImpls.add(name);
        chip.classList.add("on");
      }
      render();
    };
    box.appendChild(chip);
  }
}

function filtered() {
  const scheme = currentScheme();
  const rb = Number(el("recordBytes").value);
  return state.records.filter(
    (r) => r.scheme === scheme && r.params.record_bytes === rb && state.selectedImpls.has(r.implementation.name),
  );
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
  const impls = [...state.selectedImpls].sort();

  const pts = rows
    .map((r) => ({ impl: r.implementation.name, n: r.params.num_records, y: r.metrics[metricKey] }))
    .filter((p) => p.y != null && p.n > 0);

  const m = { l: 64, r: 16, t: 16, b: 44 };
  if (pts.length === 0) {
    ctx.fillStyle = muted;
    ctx.font = "14px system-ui";
    ctx.fillText("No data for this selection.", m.l, H / 2);
    return;
  }

  const xs = uniqueSorted(pts.map((p) => p.n)).map(Math.log10);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMax = Math.max(...pts.map((p) => p.y));
  const yMin = 0;
  const px = (lx) => m.l + ((lx - xMin) / (xMax - xMin || 1)) * (W - m.l - m.r);
  const py = (y) => H - m.b - ((y - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);

  // grid + y ticks
  ctx.strokeStyle = line;
  ctx.fillStyle = muted;
  ctx.font = "12px system-ui";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = yMin + ((yMax - yMin) * i) / 4;
    const yy = py(y);
    ctx.beginPath();
    ctx.moveTo(m.l, yy);
    ctx.lineTo(W - m.r, yy);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(fmt(y), m.l - 8, yy + 4);
  }
  // x ticks at actual N values
  ctx.textAlign = "center";
  for (const lx of uniqueSorted(pts.map((p) => p.n)).map(Math.log10)) {
    ctx.fillText(fmt(Math.round(10 ** lx)), px(lx), H - m.b + 18);
  }

  // series
  for (const impl of impls) {
    const series = pts.filter((p) => p.impl === impl).sort((a, b) => a.n - b.n);
    if (!series.length) continue;
    const color = colorFor(impl, impls);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((p, i) => {
      const X = px(Math.log10(p.n));
      const Y = py(p.y);
      i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
    });
    ctx.stroke();
    series.forEach((p) => {
      ctx.beginPath();
      ctx.arc(px(Math.log10(p.n)), py(p.y), 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // legend
  let ly = m.t + 4;
  ctx.textAlign = "left";
  for (const impl of impls) {
    ctx.fillStyle = colorFor(impl, impls);
    ctx.fillRect(W - m.r - 150, ly - 8, 10, 10);
    ctx.fillStyle = fg;
    ctx.fillText(impl, W - m.r - 134, ly + 1);
    ly += 18;
  }
}

function drawTable(rows) {
  const cols = [
    ["implementation", (r) => r.implementation.name],
    ["N", (r) => fmt(r.params.num_records)],
    ["rec B", (r) => r.params.record_bytes],
    ["thr", (r) => r.params.threads],
    ["throughput MB/s", (r) => fmt(r.metrics.server_throughput_mbps)],
    ["answer ms", (r) => fmt(r.metrics.server_answer_ms)],
    ["query B", (r) => fmt(r.metrics.query_bytes)],
    ["resp B", (r) => fmt(r.metrics.response_bytes)],
    ["", (r) => (r.notes ? '<span class="badge">modeled</span>' : "")],
  ];
  const sorted = [...rows].sort(
    (a, b) => a.params.num_records - b.params.num_records || a.implementation.name.localeCompare(b.implementation.name),
  );
  const head = `<thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join("")}</tr></thead>`;
  const body = sorted
    .map((r) => `<tr>${cols.map((c) => `<td>${c[1](r)}</td>`).join("")}</tr>`)
    .join("");
  el("table").innerHTML = head + `<tbody>${body}</tbody>`;
}

load();
