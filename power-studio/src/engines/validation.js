// Validation against reference results (MATLAB/Simulink, PowerFactory, PSS/E, PSCAD, field PMU data):
// CSV parsing, time alignment & interpolation, error metrics and frequency-event KPIs.
export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  let head = lines[0].split(sep).map((s) => s.trim().replace(/^"|"$/g, ''));
  const numeric = head.every((h) => Number.isFinite(+h));
  if (numeric) head = head.map((_, i) => (i ? `y${i}` : 't'));
  const rows = (numeric ? lines : lines.slice(1)).map((l) => l.split(sep).map(Number)).filter((r) => r.every(Number.isFinite));
  const cols = {}; head.forEach((h, i) => { cols[h] = rows.map((r) => r[i]); });
  return { head, cols, t: cols[head[0]] };
}
export function interp(tx, ty, t) {
  const out = new Float64Array(t.length); let j = 0;
  for (let i = 0; i < t.length; i++) {
    while (j < tx.length - 2 && tx[j + 1] < t[i]) j++;
    const a = tx[j], b = tx[j + 1] ?? a, u = b > a ? Math.min(1, Math.max(0, (t[i] - a) / (b - a))) : 0;
    out[i] = ty[j] + u * ((ty[j + 1] ?? ty[j]) - ty[j]);
  }
  return out;
}
export function compare(simT, simY, refT, refY, { shift = 0 } = {}) {
  const t0 = Math.max(simT[0], refT[0] + shift), t1 = Math.min(simT[simT.length - 1], refT[refT.length - 1] + shift);
  const N = 500, t = Array.from({ length: N }, (_, i) => t0 + ((t1 - t0) * i) / (N - 1));
  const a = interp(simT, simY, t), b = interp(refT.map((x) => x + shift), refY, t);
  let se = 0, ae = 0, mx = 0, ma = 0, mb = 0;
  for (let i = 0; i < N; i++) { const e = a[i] - b[i]; se += e * e; ae += Math.abs(e); mx = Math.max(mx, Math.abs(e)); ma += a[i]; mb += b[i]; }
  ma /= N; mb /= N; let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < N; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  const ext = (y) => { let k = 0; for (let i = 1; i < y.length; i++) if (Math.abs(y[i] - y[0]) > Math.abs(y[k] - y[0])) k = i; return { v: y[k], t: t[k] }; };
  const na = ext(a), nb = ext(b), range = Math.max(...b) - Math.min(...b) || 1;
  return { t, sim: a, ref: b, RMSE: Math.sqrt(se / N), MAE: ae / N, MaxErr: mx, NRMSE: Math.sqrt(se / N) / range, R: sab / Math.sqrt(saa * sbb || 1), nadirErr: na.v - nb.v, tNadirErr: na.t - nb.t };
}
/** Best time shift (cross-correlation search) to align reference with simulation. */
export function autoShift(simT, simY, refT, refY, range = 0.5) {
  let best = 0, be = Infinity;
  for (let s = -range; s <= range; s += range / 50) { const c = compare(simT, simY, refT, refY, { shift: s }); if (c.RMSE < be) { be = c.RMSE; best = s; } }
  return best;
}
