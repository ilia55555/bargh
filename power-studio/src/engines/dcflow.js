// DC power flow, PTDF / LODF sensitivity factors.
import { indexCase } from './network.js';
import { zeros, inv, matvec } from '../lib/linalg.js';
import { busTypes } from './powerflow.js';

function bmat(cs, outages = new Set()) {
  const n = cs.bus.length, idx = indexCase(cs), Bbus = zeros(n), Pshift = new Float64Array(n);
  const lines = [];
  cs.branch.forEach((br, k) => {
    if (!br.status || outages.has(k)) { lines.push(null); return; }
    const f = idx.get(br.from), t = idx.get(br.to), b = 1 / (br.x * (br.ratio || 1)), sh = ((br.angle || 0) * Math.PI) / 180;
    Bbus[f][f] += b; Bbus[t][t] += b; Bbus[f][t] -= b; Bbus[t][f] -= b;
    Pshift[f] -= b * sh; Pshift[t] += b * sh;
    lines.push({ f, t, b, sh });
  });
  return { Bbus, Pshift, lines, idx };
}

export function dcPowerFlow(cs, opts = {}) {
  const n = cs.bus.length, base = cs.baseMVA, { Bbus, Pshift, lines, idx } = bmat(cs, opts.outages);
  const { ref } = busTypes(cs);
  const P = new Float64Array(n);
  cs.bus.forEach((b, i) => { P[i] -= (b.Pd + (b.Gs || 0)) / base; });
  const pg = opts.Pg || cs.gen.map((g) => (g.status > 0 ? g.Pg : 0));
  cs.gen.forEach((g, k) => { P[idx.get(g.bus)] += pg[k] / base; });
  const nr = [...Array(n).keys()].filter((i) => i !== ref);
  const Br = nr.map((i) => Float64Array.from(nr.map((k) => Bbus[i][k])));
  const Xr = inv(Br);
  const th = new Float64Array(n);
  const rhs = nr.map((i) => P[i] - Pshift[i]);
  const thr = matvec(Xr, rhs); nr.forEach((i, r) => { th[i] = thr[r]; });
  const flows = lines.map((l, k) => (l ? { k, P: (l.b * (th[l.f] - th[l.t] - l.sh)) * base, loading: cs.branch[k].rateA ? (100 * Math.abs(l.b * (th[l.f] - th[l.t] - l.sh)) * base) / cs.branch[k].rateA : 0 } : { k, P: 0, loading: 0, off: true }));
  const slackP = (P[ref] + (Bbus[ref].reduce((s, b, j) => s + b * th[j], 0) - P[ref])) * base + cs.bus[ref].Pd;
  return { th: Array.from(th, (v) => (v * 180) / Math.PI), flows, ref, slackPg: slackP };
}

/** PTDF (nl × n): change in branch flow per unit injection at bus (withdrawn at ref). */
export function ptdf(cs, opts = {}) {
  const n = cs.bus.length, { Bbus, lines } = bmat(cs, opts.outages);
  const ref = opts.ref ?? busTypes(cs).ref;
  const nr = [...Array(n).keys()].filter((i) => i !== ref);
  const Xr = inv(nr.map((i) => Float64Array.from(nr.map((k) => Bbus[i][k]))));
  const X = zeros(n); nr.forEach((i, r) => nr.forEach((k, c) => { X[i][k] = Xr[r][c]; }));
  const H = lines.map((l) => (l ? Float64Array.from({ length: n }, (_, j) => l.b * (X[l.f][j] - X[l.t][j])) : new Float64Array(n)));
  return { H, ref, X };
}

/** LODF (nl × nl): LODF[l][k] = Δflow on l per pre-outage flow on k when k trips. */
export function lodf(cs, H) {
  const idx = indexCase(cs), nl = cs.branch.length;
  const ends = cs.branch.map((br) => [idx.get(br.from), idx.get(br.to)]);
  const L = zeros(nl);
  for (let k = 0; k < nl; k++) {
    const [fk, tk] = ends[k], den = 1 - (H[k][fk] - H[k][tk]);
    for (let l = 0; l < nl; l++) {
      if (l === k) { L[l][k] = -1; continue; }
      L[l][k] = Math.abs(den) < 1e-9 ? NaN : (H[l][fk] - H[l][tk]) / den;
    }
  }
  return L;
}
