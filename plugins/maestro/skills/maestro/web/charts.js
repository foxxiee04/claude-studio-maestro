/* dash-web charts - small dependency-free SVG charts.
   Every function takes (el, data, opts), is responsive via ResizeObserver and
   shares one tooltip element. Colors come from CSS variables so both themes work. */
(() => {
  "use strict";

  const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
  const STATUS = {
    done: "var(--c-done)",
    failed: "var(--c-failed)",
    running: "var(--c-running)",
    other: "var(--c-other)",
  };
  const reducedPref = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  // Entry animations only on a chart's first draw: the dashboard re-draws every few seconds and replaying the
  // grow/sweep animation each time made the charts flicker (and screenshots caught bars half-grown).
  let reduced = reducedPref;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
  const pad = (n) => String(n).padStart(2, "0");

  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "").replace(".", ",") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "").replace(".", ",") + "k";
    return String(Math.round(n));
  }
  function fmtTime(t) {
    const d = new Date(Number(t) || 0);
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fmtDay(t) {
    const d = new Date(Number(t) || 0);
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1);
  }
  function fmtDur(sec) {
    sec = Math.max(0, Number(sec) || 0);
    if (sec >= 3600) return (sec / 3600).toFixed(1).replace(".", ",") + "h";
    if (sec >= 60) return Math.round(sec / 60) + "m";
    return Math.round(sec) + "s";
  }
  let seq = 0;
  const uid = (p) => p + "-" + (++seq);

  // ---------- tooltip ----------
  let tipEl = null;
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "chart-tip";
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function showTip(html, x, y) {
    const t = tip();
    t.innerHTML = html;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = x + 14;
    let top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    t.style.left = Math.max(8, left) + "px";
    t.style.top = Math.max(8, top) + "px";
  }
  function hideTip() {
    if (tipEl) tipEl.hidden = true;
  }
  function attachTip(svg) {
    svg.addEventListener("mousemove", (e) => {
      const node = e.target.closest("[data-tip]");
      if (!node) { hideTip(); return; }
      showTip(node.dataset.tip || "", e.clientX, e.clientY);
    });
    svg.addEventListener("mouseleave", hideTip);
  }

  // ---------- mount / resize ----------
  function drawNow(el, force) {
    const c = el._chart;
    if (!c) return;
    const w = Math.round(el.clientWidth);
    if (w < 50) return;
    if (!force && el._drawnW === w && el._drawnH === c.height) return;
    el._drawnW = w;
    el._drawnH = c.height;
    reduced = reducedPref || !!el._everDrawn;
    el._everDrawn = true;
    try { c.draw(el, c.data, w, c.height); } catch (err) {
      el.innerHTML = '<div class="chart-empty">Không vẽ được biểu đồ</div>';
      if (window.console) console.error(err);
    }
  }
  function mount(el, data, opts, draw) {
    if (!el) return;
    const height = Math.max(40, Number(opts && opts.height) || 200);
    el.style.height = height + "px";
    el._chart = { data, height, draw };
    el.style.overflow = "hidden";
    if (!el._ro) {
      el._ro = new ResizeObserver(() => {
        if (el._raf) return;
        el._raf = requestAnimationFrame(() => {
          el._raf = null;
          const w = Math.round(el.clientWidth);
          if (w === el._drawnW) return;
          drawNow(el, true);
        });
      });
      el._ro.observe(el);
    }
    drawNow(el, true);
  }
  function empty(el, height) {
    el.innerHTML = '<div class="chart-empty">Chưa có dữ liệu</div>';
  }
  function svgOf(el, w, h, inner, label) {
    el.innerHTML = '<svg class="chart-svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
      '" role="img" aria-label="' + esc(label || "biểu đồ") + '">' + inner + "</svg>";
    return el.firstElementChild;
  }

  function niceScale(max, count) {
    count = count || 4;
    if (!(max > 0)) return { top: 1, ticks: [0, 1] };
    const rough = max / count;
    const p = Math.pow(10, Math.floor(Math.log10(rough)));
    const n = rough / p;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
    const top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
    return { top, ticks };
  }

  function grid(svg, m, w, h, scale) {
    const plotW = w - m.l - m.r;
    const plotH = h - m.t - m.b;
    let out = "";
    for (const v of scale.ticks) {
      const y = m.t + plotH - (v / scale.top) * plotH;
      out += '<line class="c-grid" x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (m.l + plotW) + '" y2="' + y.toFixed(1) + '"/>';
      out += '<text class="c-axis" x="' + (m.l - 7) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + fmtNum(v) + "</text>";
    }
    svg.insertAdjacentHTML("beforeend", out);
  }

  // ---------- stacked bars ----------
  function stackedBarChart(el, data, opts) {
    opts = opts || {};
    mount(el, data, opts, (host, d, w, h) => {
      const buckets = (d && d.buckets) || [];
      if (!buckets.length) return empty(host, h);
      const m = { l: 42, r: 10, t: 10, b: 26 };
      const plotW = Math.max(10, w - m.l - m.r);
      const plotH = Math.max(10, h - m.t - m.b);
      const series = d.series || [
        { key: "done", label: "hoàn tất", color: STATUS.done },
        { key: "failed", label: "lỗi", color: STATUS.failed },
        { key: "other", label: "khác", color: STATUS.other },
      ];
      const totals = buckets.map((b) => series.reduce((s, x) => s + (Number(b[x.key]) || 0), 0));
      const scale = niceScale(Math.max(1, ...totals), 4);
      const step = plotW / buckets.length;
      const bw = Math.max(3, Math.min(46, step * 0.62));
      const labelEvery = Math.max(1, Math.ceil(buckets.length / 7));
      let inner = "";
      buckets.forEach((b, i) => {
        const x = m.l + i * step + (step - bw) / 2;
        let acc = 0;
        const total = totals[i];
        for (const s of series) {
          const v = Number(b[s.key]) || 0;
          if (!v) continue;
          const segH = (v / scale.top) * plotH;
          const y = m.t + plotH - (acc / scale.top) * plotH - segH;
          const shown = d.mode === "day" ? fmtDay(b.t) : fmtTime(b.t);
          inner += '<rect class="c-bar' + (reduced ? "" : " c-grow-y") + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
            '" width="' + bw.toFixed(1) + '" height="' + Math.max(0.6, segH).toFixed(1) + '" rx="3" style="fill:' + s.color + '"' +
            ' data-tip="' + esc("<b>" + shown + "</b><span>" + s.label + ": " + fmtNum(v) + " job</span><span>Tổng: " + fmtNum(total) + " · " + fmtNum(b.tokens) + " token</span>") + '"></rect>';
          acc += v;
        }
        if (i % labelEvery === 0) {
          inner += '<text class="c-axis" x="' + (x + bw / 2).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle">' +
            (d.mode === "day" ? fmtDay(b.t) : fmtTime(b.t)) + "</text>";
        }
      });
      const svg = svgOf(host, w, h, inner, "Job theo giờ");
      grid(svg, m, w, h, scale);
      if (!reduced) {
        requestAnimationFrame(() => {
          svg.querySelectorAll(".c-grow-y").forEach((n) => n.classList.add("grow-in"));
        });
      }
      attachTip(svg);
    });
  }

  // ---------- vertical bars ----------
  function barChart(el, data, opts) {
    opts = opts || {};
    mount(el, data, opts, (host, d, w, h) => {
      const items = ((d && d.items) || []).filter((i) => i && Number(i.value) >= 0);
      if (!items.length) return empty(host, h);
      const m = { l: 42, r: 10, t: 10, b: 44 };
      const plotW = Math.max(10, w - m.l - m.r);
      const plotH = Math.max(10, h - m.t - m.b);
      const scale = niceScale(Math.max(1, ...items.map((i) => Number(i.value) || 0)), 4);
      const step = plotW / items.length;
      const bw = Math.max(3, Math.min(50, step * 0.6));
      let inner = "";
      items.forEach((it, i) => {
        const v = Number(it.value) || 0;
        const bh = (v / scale.top) * plotH;
        const x = m.l + i * step + (step - bw) / 2;
        const y = m.t + plotH - bh;
        const color = it.color || opts.color || PALETTE[i % PALETTE.length];
        const label = String(it.label == null ? "" : it.label);
        inner += '<rect class="c-bar' + (reduced ? "" : " c-grow-y") + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
          '" width="' + bw.toFixed(1) + '" height="' + Math.max(0.6, bh).toFixed(1) + '" rx="3" style="fill:' + color + '"' +
          ' data-tip="' + esc(it.tip || ("<b>" + label + "</b><span>" + fmtNum(v) + "</span>")) + '"></rect>';
        const tx = x + bw / 2;
        const short = label.length > 16 ? label.slice(0, 15) + "…" : label;
        inner += '<text class="c-axis c-rot" x="' + tx.toFixed(1) + '" y="' + (h - 30) + '" text-anchor="end" transform="rotate(-32 ' +
          tx.toFixed(1) + " " + (h - 30) + ')">' + esc(short) + "</text>";
      });
      const svg = svgOf(host, w, h, inner, opts.label || "biểu đồ cột");
      grid(svg, m, w, h, scale);
      if (!reduced) requestAnimationFrame(() => svg.querySelectorAll(".c-grow-y").forEach((n) => n.classList.add("grow-in")));
      attachTip(svg);
    });
  }

  // ---------- horizontal bars ----------
  function hBarChart(el, data, opts) {
    opts = opts || {};
    mount(el, data, opts, (host, d, w, h) => {
      const all = ((d && d.items) || []).filter((i) => i && Number(i.value) > 0);
      const items = all.slice(0, opts.limit || 9);
      if (!items.length) return empty(host, h);
      const labelW = Math.min(150, Math.max(70, Math.round(w * 0.32)));
      const valueW = 58;
      const m = { l: 6, r: valueW, t: 6, b: 6 };
      const plotW = Math.max(20, w - labelW - valueW - 12);
      const rowH = Math.min(34, Math.max(18, (h - m.t - m.b) / items.length));
      const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
      let inner = "";
      items.forEach((it, i) => {
        const v = Number(it.value) || 0;
        const y = m.t + i * rowH + rowH / 2;
        const bw = (v / max) * plotW;
        const color = it.color || PALETTE[i % PALETTE.length];
        const label = String(it.label == null ? "" : it.label);
        const short = label.length > 22 ? label.slice(0, 21) + "…" : label;
        inner += '<text class="c-axis c-name" x="0" y="' + (y + 3.5).toFixed(1) + '">' + esc(short) + "</text>";
        inner += '<rect class="c-track" x="' + labelW + '" y="' + (y - rowH * 0.24).toFixed(1) + '" width="' + plotW +
          '" height="' + Math.max(6, rowH * 0.48).toFixed(1) + '" rx="6"/>';
        inner += '<rect class="c-bar c-grow-x' + (reduced ? "" : "") + '" x="' + labelW + '" y="' + (y - rowH * 0.24).toFixed(1) +
          '" width="' + Math.max(1, bw).toFixed(1) + '" height="' + Math.max(6, rowH * 0.48).toFixed(1) + '" rx="6" style="fill:' +
          color + '" data-tip="' + esc(it.tip || ("<b>" + label + "</b><span>" + fmtNum(v) + "</span>")) + '"></rect>';
        inner += '<text class="c-axis c-val" x="' + (w - 2) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + fmtNum(v) + "</text>";
      });
      const svg = svgOf(host, w, h, inner, opts.label || "biểu đồ thanh");
      if (!reduced) requestAnimationFrame(() => svg.querySelectorAll(".c-grow-x").forEach((n) => n.classList.add("grow-in")));
      attachTip(svg);
    });
  }

  // ---------- donut ----------
  function donutChart(el, data, opts) {
    opts = opts || {};
    mount(el, data, opts, (host, d, w, h) => {
      const items = ((d && d.items) || []).filter((i) => i && Number(i.value) > 0);
      const total = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
      if (!items.length || !total) {
        host.innerHTML = '<div class="chart-empty">Chưa có dữ liệu</div>';
        return;
      }
      const legendH = Math.min(items.length, 6) * 19;
      const radius = Math.max(24, Math.min(w * 0.27, (h - legendH - 16) * 0.42));
      const cx = w / 2;
      const cy = 10 + radius;
      const sw = Math.max(12, radius * 0.36);
      const r = radius - sw / 2;
      const circ = 2 * Math.PI * r;
      const gap = 1.6;
      let out = "";
      let acc = 0;
      items.forEach((it, i) => {
        const v = Number(it.value) || 0;
        const frac = v / total;
        const color = it.color || PALETTE[i % PALETTE.length];
        const len = Math.max(0.4, frac * circ);
        const dash = Math.max(0, len - (items.length > 1 ? gap : 0));
        const offset = -acc;
        out += '<circle class="c-donut' + (reduced ? "" : " c-sweep") + '" cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(1) +
          '" fill="none" style="stroke:' + color + '" stroke-width="' + sw.toFixed(1) + '"' +
          ' stroke-dasharray="' + dash.toFixed(2) + " " + (circ - dash).toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) +
          '" data-sweep="' + offset.toFixed(2) + '" transform="rotate(-90 ' + cx + " " + cy + ')"' +
          ' data-tip="' + esc("<b>" + (it.label || "") + "</b><span>" + fmtNum(v) + " · " + Math.round(frac * 100) + "%</span>") + '"/>';
        acc += len;
      });
      const centerVal = opts.centerValue != null ? opts.centerValue : fmtNum(total);
      out += '<text class="c-center-v" x="' + cx + '" y="' + (cy + 2) + '" text-anchor="middle">' + esc(centerVal) + "</text>";
      out += '<text class="c-center-l" x="' + cx + '" y="' + (cy + 18) + '" text-anchor="middle">' + esc(opts.centerLabel || "tổng") + "</text>";
      const startY = cy + radius + 12;
      items.slice(0, 6).forEach((it, i) => {
        const y = startY + i * 19;
        if (y > h - 6) return;
        const color = it.color || PALETTE[i % PALETTE.length];
        const v = Number(it.value) || 0;
        out += '<circle cx="7" cy="' + (y - 3.5) + '" r="4" style="fill:' + color + '"/>';
        out += '<text class="c-legend" x="17" y="' + y + '">' + esc(it.label || "") + "</text>";
        out += '<text class="c-legend c-legend-v" x="' + (w - 2) + '" y="' + y + '" text-anchor="end">' + fmtNum(v) +
          " · " + Math.round((v / total) * 100) + "%</text>";
      });
      const svg = svgOf(host, w, h, out, opts.label || "biểu đồ tròn");
      if (!reduced) {
        const arcs = Array.from(svg.querySelectorAll(".c-sweep"));
        arcs.forEach((n) => { n.style.strokeDashoffset = String(circ); });
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            arcs.forEach((n) => { n.style.strokeDashoffset = n.dataset.sweep; });
          });
        });
      }
      attachTip(svg);
    });
  }

  // ---------- area ----------
  function areaChart(el, data, opts) {
    opts = opts || {};
    mount(el, data, opts, (host, d, w, h) => {
      const points = ((d && d.points) || []).filter((p) => p && Number.isFinite(Number(p.t)));
      if (points.length < 2) return empty(host, h);
      const m = { l: 38, r: 10, t: 10, b: 26 };
      const plotW = Math.max(10, w - m.l - m.r);
      const plotH = Math.max(10, h - m.t - m.b);
      const t0 = Number(points[0].t);
      const t1 = Number(points[points.length - 1].t);
      const span = Math.max(1, t1 - t0);
      const maxV = Math.max(1, ...points.map((p) => Number(p.v) || 0));
      const scale = niceScale(maxV, 4);
      const xOf = (t) => m.l + ((Number(t) - t0) / span) * plotW;
      const yOf = (v) => m.t + plotH - (Number(v) / scale.top) * plotH;
      const line = points.map((p, i) => (i ? "L" : "M") + xOf(p.t).toFixed(1) + " " + yOf(p.v).toFixed(1)).join(" ");
      const area = line + " L" + (m.l + plotW) + " " + (m.t + plotH) + " L" + m.l + " " + (m.t + plotH) + " Z";
      const color = opts.color || "var(--chart-2)";
      const gid = uid("cgrad");
      let inner = '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity=".34"/>' +
        '<stop offset="100%" stop-color="' + color + '" stop-opacity=".02"/></linearGradient></defs>';
      inner += '<path class="c-area' + (reduced ? "" : " c-fade") + '" d="' + area + '" fill="url(#' + gid + ')"/>';
      inner += '<path class="c-line' + (reduced ? "" : " c-fade") + '" d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      const ticks = 4;
      for (let i = 0; i <= ticks; i++) {
        const t = t0 + (span * i) / ticks;
        inner += '<text class="c-axis" x="' + xOf(t).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="' +
          (i === 0 ? "start" : i === ticks ? "end" : "middle") + '">' +
          (opts.dayMode ? fmtDay(t) : fmtTime(t)) + "</text>";
      }
      inner += '<line class="c-guide" x1="0" y1="' + m.t + '" x2="0" y2="' + (m.t + plotH) + '" style="display:none"/>';
      inner += '<circle class="c-hoverdot" r="4" cx="-20" cy="-20" style="fill:' + color + ';stroke:var(--card);stroke-width:2;display:none"/>';
      inner += '<rect class="c-hit" x="' + m.l + '" y="' + m.t + '" width="' + plotW + '" height="' + plotH + '" fill="transparent"/>';
      const svg = svgOf(host, w, h, inner, opts.label || "biểu đồ vùng");
      grid(svg, m, w, h, scale);
      const guide = svg.querySelector(".c-guide");
      const dot = svg.querySelector(".c-hoverdot");
      const hit = svg.querySelector(".c-hit");
      hit.addEventListener("mousemove", (e) => {
        const box = svg.getBoundingClientRect();
        const x = e.clientX - box.left;
        const ratio = Math.max(0, Math.min(1, (x - m.l) / plotW));
        const idx = Math.round(ratio * (points.length - 1));
        const p = points[idx];
        const px = xOf(p.t);
        const py = yOf(p.v);
        guide.setAttribute("x1", px.toFixed(1));
        guide.setAttribute("x2", px.toFixed(1));
        guide.style.display = "";
        dot.setAttribute("cx", px.toFixed(1));
        dot.setAttribute("cy", py.toFixed(1));
        dot.style.display = "";
        const label = opts.dayMode ? fmtDay(p.t) : fmtTime(p.t);
        showTip("<b>" + esc(label) + "</b><span>" + esc(opts.valueLabel || "đang chạy") + ": " + fmtNum(p.v) + "</span>", e.clientX, e.clientY);
      });
      hit.addEventListener("mouseleave", () => {
        guide.style.display = "none";
        dot.style.display = "none";
        hideTip();
      });
    });
  }

  // ---------- sparkline ----------
  function sparkline(el, values, opts) {
    opts = opts || {};
    mount(el, values, opts, (host, vals, w, h) => {
      const list = (vals || []).map((v) => Number(v) || 0);
      if (list.length < 2) {
        host.innerHTML = '<div class="chart-empty small">—</div>';
        return;
      }
      const padY = 3;
      const max = Math.max(1, ...list);
      const min = Math.min(...list);
      const span = Math.max(1, max - min);
      const step = (w - 2) / (list.length - 1);
      const yOf = (v) => padY + (1 - (v - min) / span) * (h - padY * 2);
      const line = list.map((v, i) => (i ? "L" : "M") + (i * step + 1).toFixed(1) + " " + yOf(v).toFixed(1)).join(" ");
      const area = line + " L" + (w - 1) + " " + h + " L1 " + h + " Z";
      const color = opts.color || "var(--chart-2)";
      const gid = uid("sgrad");
      const last = list[list.length - 1];
      const inner = '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity=".3"/>' +
        '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
        '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
        '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<circle cx="' + (w - 1) + '" cy="' + yOf(last).toFixed(1) + '" r="2.4" style="fill:' + color + '"/>';
      svgOf(host, w, h, inner, opts.label || "sparkline");
    });
  }

  // ---------- scatter ----------
  function scatterChart(el, data, opts) {
    opts = opts || {};
    mount(el, data, opts, (host, d, w, h) => {
      const points = ((d && d.points) || []).filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
      if (!points.length) return empty(host, h);
      const m = { l: 44, r: 16, t: 14, b: 34 };
      const plotW = Math.max(10, w - m.l - m.r);
      const plotH = Math.max(10, h - m.t - m.b);
      const maxY = Math.max(1, ...points.map((p) => Number(p.y)));
      const scale = niceScale(maxY, 4);
      const xOf = (v) => m.l + (Math.max(0, Math.min(100, Number(v))) / 100) * plotW;
      const yOf = (v) => m.t + plotH - (Number(v) / scale.top) * plotH;
      const maxJobs = Math.max(1, ...points.map((p) => Number(p.jobs) || 1));
      let inner = "";
      for (const t of [0, 25, 50, 75, 100]) {
        inner += '<text class="c-axis" x="' + xOf(t).toFixed(1) + '" y="' + (h - 10) + '" text-anchor="' +
          (t === 0 ? "start" : t === 100 ? "end" : "middle") + '">' + t + "%</text>";
      }
      points.forEach((p, i) => {
        const r = 4 + Math.sqrt((Number(p.jobs) || 1) / maxJobs) * 6;
        const color = p.color || PALETTE[i % PALETTE.length];
        const cx = xOf(p.x);
        const cy = yOf(p.y);
        inner += '<circle class="c-dot' + (reduced ? "" : " c-pop") + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) +
          '" r="' + r.toFixed(1) + '" style="fill:' + color + '" data-tip="' +
          esc("<b>" + (p.label || "") + "</b><span>" + (p.sub || "") + "</span>") + '"/>';
      });
      inner += '<text class="c-axis c-axis-l" x="' + (m.l + plotW / 2) + '" y="' + (h - 1) + '" text-anchor="middle">' +
        esc(opts.xLabel || "tỉ lệ thành công (%)") + "</text>";
      const svg = svgOf(host, w, h, inner, opts.label || "biểu đồ phân tán");
      grid(svg, m, w, h, scale);
      attachTip(svg);
    });
  }

  window.Charts = {
    barChart, stackedBarChart, hBarChart, donutChart, areaChart, sparkline, scatterChart,
    fmtNum, fmtTime, fmtDay, fmtDur,
    statusColor: (s) => STATUS[s] || STATUS.other,
    palette: PALETTE,
    redraw(el) { if (el) drawNow(el, true); },
    hideTip,
  };
})();
