// Generation adequacy: capacity outage probability table (COPT), LOLP/LOLE/EENS,
// and distribution reliability indices (SAIFI, SAIDI, CAIDI, ASAI, ENS).
export function copt(units, step = 1) {
  // units: [{cap MW, FOR}]  → table of P(outage = X)
  let table = new Map([[0, 1]]);
  for (const u of units) {
    const cap = Math.round(u.cap / step) * step, nt = new Map();
    for (const [x, p] of table) {
      nt.set(x, (nt.get(x) || 0) + p * (1 - u.FOR));
      nt.set(x + cap, (nt.get(x + cap) || 0) + p * u.FOR);
    }
    table = nt;
  }
  const rows = [...table.entries()].sort((a, b) => a[0] - b[0]);
  // cumulative P(outage >= X)
  let cum = 0; const out = new Array(rows.length);
  for (let i = rows.length - 1; i >= 0; i--) { cum += rows[i][1]; out[i] = { out: rows[i][0], p: rows[i][1], cum }; }
  return out;
}

/** Synthetic hourly load profile (fraction of annual peak): seasonal × weekly × daily shapes. */
export function syntheticLoad(hours = 8760, peak = 1) {
  const L = new Float64Array(hours);
  for (let h = 0; h < hours; h++) {
    const day = Math.floor(h / 24), hr = h % 24, wd = day % 7;
    const season = 0.82 + 0.18 * Math.cos((2 * Math.PI * (day - 200)) / 365) ** 2;
    const week = wd >= 5 ? 0.86 : 1;
    const daily = 0.68 + 0.32 * Math.exp(-((hr - 19) ** 2) / 18) + 0.12 * Math.exp(-((hr - 11) ** 2) / 10);
    L[h] = season * week * daily;
  }
  const mx = Math.max(...L); for (let h = 0; h < hours; h++) L[h] = (L[h] / mx) * peak;
  return L;
}

export function adequacy(units, peak, { hours = 8760 } = {}) {
  const total = units.reduce((s, u) => s + u.cap, 0), table = copt(units);
  const load = syntheticLoad(hours, peak);
  let lole = 0, eens = 0;
  for (const L of load) {
    const reserve = total - L; // loss of load if outage > reserve
    for (const r of table) {
      if (r.out > reserve) { lole += r.p; eens += r.p * (r.out - reserve); }
    }
  }
  const lolpPeak = table.find((r) => r.out > total - peak)?.cum ?? 0;
  // daily peaks LOLE (days/yr)
  let loleD = 0;
  for (let d = 0; d < hours / 24; d++) {
    let pk = 0; for (let h = 0; h < 24; h++) pk = Math.max(pk, load[d * 24 + h]);
    loleD += table.find((r) => r.out > total - pk)?.cum ?? 0;
  }
  return { total, table, LOLE_h: lole, LOLE_d: loleD, EENS: eens, LOLP_peak: lolpPeak, load };
}

/** Distribution indices. sections: [{lambda (f/yr), r (h), customers, loadKW}] each fault affects listed customers */
export function distributionIndices(points) {
  const Nt = points.reduce((s, p) => s + p.customers, 0);
  let ci = 0, cmi = 0, ens = 0;
  for (const p of points) { ci += p.lambda * p.customers; cmi += p.lambda * p.r * p.customers; ens += p.lambda * p.r * p.loadKW; }
  const SAIFI = ci / Nt, SAIDI = cmi / Nt;
  return { SAIFI, SAIDI, CAIDI: SAIDI / SAIFI, ASAI: 1 - SAIDI / 8760, ENS: ens / 1000 };
}
