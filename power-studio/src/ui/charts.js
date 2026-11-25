// Dependency-free SVG charts: line/scatter (linear or log axes), bars, with hover readout.
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; return e; };
export const PALETTE = ['#4f9dff', '#ff8a3d', '#3ccf91', '#e35d6a', '#b18cff', '#f2c94c', '#2ec5d3', '#ff6fb5', '#9bbf3b', '#c08457', '#7c8cff', '#5ad1a4'];

function niceTicks(lo, hi, n = 6) {
  if (!(hi > lo)) { hi = lo + 1; lo -= 1; }
  const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), r = step0 / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const t = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) t.push(+v.toFixed(12));
  return t;
}
function logTicks(lo, hi) { const t = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) t.push(10 ** e); return t; }
const fmtTick = (v) => { const a = Math.abs(v); return a === 0 ? '0' : a >= 1e4 || a < 1e-3 ? v.toExponential(0) : +v.toPrecision(4) + ''; };

/**
 * lineChart(el, {series:[{x,y,name,color,dash,width,points,fill}], xLabel, yLabel, logX, logY, height, xMin,xMax,yMin,yMax, hlines:[{y,label,color}], vlines, overlay(g, sx, sy), equal})
 */
export function lineChart(el, o) {
  el.innerHTML = '';
  const W = Math.max(el.clientWidth || 600, 280), H = o.height || 300, m = { l: 58, r: 14, t: 14, b: 42 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const all = o.series.filter((sr) => sr.x?.length);
  const xs = all.flatMap((sr) => sr.x).filter((v) => Number.isFinite(v) && (!o.logX || v > 0));
  const ys = all.flatMap((sr) => sr.y).filter((v) => Number.isFinite(v) && (!o.logY || v > 0));
  let xMin = o.xMin ?? Math.min(...xs), xMax = o.xMax ?? Math.max(...xs), yMin = o.yMin ?? Math.min(...ys), yMax = o.yMax ?? Math.max(...ys);
  (o.hlines || []).forEach((l) => { if (o.yMin === undefined) yMin = Math.min(yMin, l.y); if (o.yMax === undefined) yMax = Math.max(yMax, l.y); });
  if (!o.logY && o.yMin === undefined && o.yMax === undefined) { const pad = (yMax - yMin) * 0.06 || Math.abs(yMax) * 0.05 || 1; yMin -= pad; yMax += pad; }
  if (!Number.isFinite(xMin)) { xMin = 0; xMax = 1; } if (!Number.isFinite(yMin)) { yMin = 0; yMax = 1; }
  if (xMax === xMin) { xMax += 1; xMin -= 1; }
  if (o.equal) { const cx = (xMin + xMax) / 2, cy = (yMin + yMax) / 2, k = Math.max((xMax - xMin) / pw, (yMax - yMin) / ph); xMin = cx - (k * pw) / 2; xMax = cx + (k * pw) / 2; yMin = cy - (k * ph) / 2; yMax = cy + (k * ph) / 2; }
  const tx = (v) => (o.logX ? Math.log10(v) : v), ty = (v) => (o.logY ? Math.log10(v) : v);
  const sx = (v) => m.l + ((tx(v) - tx(xMin)) / (tx(xMax) - tx(xMin))) * pw;
  const sy = (v) => m.t + ph - ((ty(v) - ty(yMin)) / (ty(yMax) - ty(yMin))) * ph;
  const svg = s('svg', { width: W, height: H, class: 'chart', viewBox: `0 0 ${W} ${H}` });
  const g = s('g');
  const xt = o.logX ? logTicks(xMin, xMax) : niceTicks(xMin, xMax, Math.max(3, Math.floor(pw / 80)));
  const yt = o.logY ? logTicks(yMin, yMax) : niceTicks(yMin, yMax, Math.max(3, Math.floor(ph / 45)));
  xt.filter((v) => v >= xMin - 1e-12 && v <= xMax + 1e-12).forEach((v) => { const x = sx(v); g.append(s('line', { x1: x, x2: x, y1: m.t, y2: m.t + ph, class: 'grid' }), s('text', { x, y: m.t + ph + 16, class: 'tick', 'text-anchor': 'middle' }, fmtTick(v))); });
  yt.filter((v) => v >= yMin - 1e-12 && v <= yMax + 1e-12).forEach((v) => { const y = sy(v); g.append(s('line', { x1: m.l, x2: m.l + pw, y1: y, y2: y, class: 'grid' }), s('text', { x: m.l - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' }, fmtTick(v))); });
  g.append(s('rect', { x: m.l, y: m.t, width: pw, height: ph, class: 'frame' }));
  if (o.xLabel) g.append(s('text', { x: m.l + pw / 2, y: H - 6, class: 'axlabel', 'text-anchor': 'middle' }, o.xLabel));
  if (o.yLabel) g.append(s('text', { x: 14, y: m.t + ph / 2, class: 'axlabel', 'text-anchor': 'middle', transform: `rotate(-90 14 ${m.t + ph / 2})` }, o.yLabel));
  const clipId = 'c' + Math.random().toString(36).slice(2);
  const defs = s('defs'); const cp = s('clipPath', { id: clipId }); cp.append(s('rect', { x: m.l, y: m.t, width: pw, height: ph })); defs.append(cp); svg.append(defs);
  const plot = s('g', { 'clip-path': `url(#${clipId})` });
  (o.hlines || []).forEach((l) => { const y = sy(l.y); plot.append(s('line', { x1: m.l, x2: m.l + pw, y1: y, y2: y, stroke: l.color || 'var(--warn)', 'stroke-dasharray': '5 4', 'stroke-width': 1.2 })); if (l.label) plot.append(s('text', { x: m.l + 4, y: y - 4, class: 'tick', fill: l.color || 'var(--warn)' }, l.label)); });
  (o.vlines || []).forEach((l) => { const x = sx(l.x); plot.append(s('line', { y1: m.t, y2: m.t + ph, x1: x, x2: x, stroke: l.color || 'var(--muted)', 'stroke-dasharray': '4 4' })); if (l.label) plot.append(s('text', { x: x + 4, y: m.t + 12, class: 'tick' }, l.label)); });
  all.forEach((sr, k) => {
    const col = sr.color || PALETTE[k % PALETTE.length];
    const pts = sr.x.map((x, i) => [x, sr.y[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!o.logX || x > 0) && (!o.logY || y > 0));
    if (sr.points) pts.forEach(([x, y]) => plot.append(s('circle', { cx: sx(x), cy: sy(y), r: sr.r || 3.5, fill: col, 'fill-opacity': 0.85 })));
    else if (pts.length) {
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('');
      if (sr.fill) plot.append(s('path', { d: d + `L${sx(pts[pts.length - 1][0])},${sy(Math.max(yMin, 0))}L${sx(pts[0][0])},${sy(Math.max(yMin, 0))}Z`, fill: col, 'fill-opacity': 0.12 }));
      plot.append(s('path', { d, fill: 'none', stroke: col, 'stroke-width': sr.width || 1.8, 'stroke-dasharray': sr.dash || '' }));
    }
  });
  if (o.overlay) o.overlay(plot, sx, sy, s);
  svg.append(g, plot);
  // legend
  const named = all.filter((sr) => sr.name);
  if (named.length) {
    const lg = h2('div', 'legend');
    named.forEach((sr) => { const k = all.indexOf(sr); const it = h2('span', 'lg-item'); const sw = h2('i', ''); sw.style.background = sr.color || PALETTE[k % PALETTE.length]; it.append(sw, document.createTextNode(sr.name)); lg.append(it); });
    el.append(lg);
  }
  // hover readout
  const cross = s('line', { y1: m.t, y2: m.t + ph, class: 'cross', visibility: 'hidden' });
  const tip = h2('div', 'chart-tip'); tip.style.display = 'none';
  svg.append(cross);
  svg.addEventListener('mousemove', (ev) => {
    const r = svg.getBoundingClientRect(), px = ev.clientX - r.left;
    if (px < m.l || px > m.l + pw) { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; return; }
    const xv = o.logX ? 10 ** (tx(xMin) + ((px - m.l) / pw) * (tx(xMax) - tx(xMin))) : xMin + ((px - m.l) / pw) * (xMax - xMin);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    const lines = [`x = ${fmtTick(xv)}`];
    all.slice(0, 12).forEach((sr, k) => {
      if (!sr.x.length) return; let bi = 0, bd = Infinity;
      for (let i = 0; i < sr.x.length; i++) { const d = Math.abs(sr.x[i] - xv); if (d < bd) { bd = d; bi = i; } }
      lines.push(`<span style="color:${sr.color || PALETTE[k % PALETTE.length]}">●</span> ${sr.name || ''} ${fmtTick(sr.y[bi])}`);
    });
    tip.innerHTML = lines.join('<br>'); tip.style.display = 'block';
    tip.style.left = Math.min(px + 12, W - 170) + 'px'; tip.style.top = ev.clientY - r.top + 8 + 'px';
  });
  svg.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
  const wrap = h2('div', 'chart-wrap'); wrap.append(svg, tip); el.append(wrap);
  return { sx, sy, svg };
}
function h2(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

/** barChart(el, {labels, values (or series [{values,name,color}]), yLabel, colors(fn), hlines, height}) */
export function barChart(el, o) {
  el.innerHTML = '';
  const series = o.series || [{ values: o.values, name: o.name }];
  const W = Math.max(el.clientWidth || 600, 280), H = o.height || 260, m = { l: 54, r: 10, t: 12, b: o.rotate ? 54 : 36 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b, n = o.labels.length;
  const vals = series.flatMap((sr) => sr.values).filter(Number.isFinite);
  let yMin = o.yMin ?? Math.min(0, ...vals), yMax = o.yMax ?? Math.max(...vals, ...(o.hlines || []).map((l) => l.y));
  if (o.yMin === undefined && yMin < 0) yMin *= 1.08; if (o.yMax === undefined) yMax = yMax + (yMax - yMin) * 0.06;
  const sy = (v) => m.t + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;
  const svg = s('svg', { width: W, height: H, class: 'chart' });
  niceTicks(yMin, yMax, 5).forEach((v) => { if (v < yMin || v > yMax) return; const y = sy(v); svg.append(s('line', { x1: m.l, x2: m.l + pw, y1: y, y2: y, class: 'grid' }), s('text', { x: m.l - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' }, fmtTick(v))); });
  const bw = pw / n, inner = (bw * 0.78) / series.length;
  series.forEach((sr, k) => sr.values.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const x = m.l + i * bw + bw * 0.11 + k * inner, y0 = sy(Math.max(0, yMin)), y1 = sy(v);
    const col = o.colors ? o.colors(v, i) : sr.color || PALETTE[k % PALETTE.length];
    const r = s('rect', { x, y: Math.min(y0, y1), width: Math.max(inner - 1, 1), height: Math.abs(y1 - y0), fill: col, rx: 2 });
    r.append(s('title', {}, `${o.labels[i]}: ${fmtTick(v)}`)); svg.append(r);
  }));
  const every = Math.ceil(n / (pw / 26));
  o.labels.forEach((l, i) => { if (i % every) return; const x = m.l + i * bw + bw / 2; svg.append(s('text', { x, y: H - m.b + 14, class: 'tick', 'text-anchor': o.rotate ? 'end' : 'middle', transform: o.rotate ? `rotate(-45 ${x} ${H - m.b + 14})` : '' }, l)); });
  (o.hlines || []).forEach((l) => { const y = sy(l.y); svg.append(s('line', { x1: m.l, x2: m.l + pw, y1: y, y2: y, stroke: l.color || 'var(--warn)', 'stroke-dasharray': '5 4' })); });
  svg.append(s('rect', { x: m.l, y: m.t, width: pw, height: ph, class: 'frame' }));
  if (o.yLabel) svg.append(s('text', { x: 14, y: m.t + ph / 2, class: 'axlabel', 'text-anchor': 'middle', transform: `rotate(-90 14 ${m.t + ph / 2})` }, o.yLabel));
  if (o.xLabel) svg.append(s('text', { x: m.l + pw / 2, y: H - 4, class: 'axlabel', 'text-anchor': 'middle' }, o.xLabel));
  el.append(svg);
}
export const svgEl = s;
