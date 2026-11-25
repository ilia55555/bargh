// Microgrid day-ahead scheduling (PV, wind, BESS, diesel, grid exchange) — single-objective QP and
// multi-objective (cost vs CO₂) Pareto front with NSGA-II.
import { qpSolve } from '../lib/linalg.js';
import { solarSeries, windSeries, rng } from './stochastic.js';

export function defaultMicrogrid(seed = 1) {
  const pv = solarSeries(24, { startDay: 172, seed }).p, wd = windSeries(24, { seed: seed + 3, c: 7 }).p;
  const load = Array.from({ length: 24 }, (_, h) => 1.2 + 0.5 * Math.exp(-((h - 19) ** 2) / 8) + 0.3 * Math.exp(-((h - 12) ** 2) / 10));
  const price = Array.from({ length: 24 }, (_, h) => (h >= 17 && h < 22 ? 0.22 : h >= 7 && h < 17 ? 0.14 : 0.08) * 1000); // $/MWh
  return { T: 24, load, pv: pv.map((x) => 1.5 * x), wind: wd.map((x) => 0.8 * x), price, grid: { max: 1.5, co2: 0.6, sellRatio: 0.7 }, diesel: { max: 1.0, a: 30, b: 180, co2: 0.8 }, bess: { P: 0.8, E: 3, eta: 0.94, soc0: 0.5, deg: 15 } };
}

/** Evaluate a schedule: x = [Pb(24), Pd(24)] (battery discharge +, diesel). Grid balances. */
export function evaluate(mg, x) {
  const T = mg.T, Pb = x.slice(0, T), Pd = x.slice(T, 2 * T);
  let soc = mg.bess.soc0 * mg.bess.E, cost = 0, co2 = 0, viol = 0; const grid = [], socA = [];
  for (let t = 0; t < T; t++) {
    const b = Pb[t];
    soc -= b > 0 ? b / mg.bess.eta : b * mg.bess.eta;
    if (soc < 0.1 * mg.bess.E) viol += 0.1 * mg.bess.E - soc; if (soc > mg.bess.E) viol += soc - mg.bess.E;
    const g = mg.load[t] - mg.pv[t] - mg.wind[t] - b - Pd[t];
    if (Math.abs(g) > mg.grid.max) viol += Math.abs(g) - mg.grid.max;
    cost += (g >= 0 ? g * mg.price[t] : g * mg.price[t] * mg.grid.sellRatio) + (Pd[t] > 0 ? mg.diesel.a * Pd[t] ** 2 + mg.diesel.b * Pd[t] : 0) + mg.bess.deg * Math.abs(b);
    co2 += Math.max(g, 0) * mg.grid.co2 + Pd[t] * mg.diesel.co2;
    grid.push(g); socA.push(soc / mg.bess.E);
  }
  cost += 250 * Math.abs(soc - mg.bess.soc0 * mg.bess.E); // end-of-day SOC restoration (value of stored energy)
  return { cost, co2, viol, grid, soc: socA, Pb, Pd };
}

/** NSGA-II (Deb 2002) with SBX crossover & polynomial mutation, constraint-domination. */
export function nsga2(f, lo, hi, { pop = 80, gens = 150, seed = 4, pc = 0.9, etaC = 15, etaM = 20, init = [] } = {}) {
  const r = rng(seed), n = lo.length, pm = 1 / n;
  const rand = () => lo.map((l, i) => l + r.u() * (hi[i] - l));
  let P = Array.from({ length: pop }, (_, i) => { const x = init[i] ? init[i].slice() : rand(); return { x, ...f(x) }; });
  const dom = (a, b) => (a.viol !== b.viol ? a.viol < b.viol : a.o.every((v, i) => v <= b.o[i]) && a.o.some((v, i) => v < b.o[i]));
  const sort = (Q) => {
    const S = Q.map(() => []), nD = Q.map(() => 0), F = [[]];
    Q.forEach((p, i) => { Q.forEach((q, j) => { if (dom(p, q)) S[i].push(j); else if (dom(q, p)) nD[i]++; }); if (!nD[i]) { p.rank = 0; F[0].push(i); } });
    for (let k = 0; F[k].length; k++) { const nx = []; F[k].forEach((i) => S[i].forEach((j) => { if (--nD[j] === 0) { Q[j].rank = k + 1; nx.push(j); } })); F.push(nx); }
    F.forEach((fr) => { fr.forEach((i) => { Q[i].cd = 0; }); for (let m = 0; m < Q[0].o.length; m++) { const s = [...fr].sort((a, b) => Q[a].o[m] - Q[b].o[m]); if (!s.length) continue; Q[s[0]].cd = Q[s[s.length - 1]].cd = Infinity; const rg = Q[s[s.length - 1]].o[m] - Q[s[0]].o[m] || 1; for (let k = 1; k < s.length - 1; k++) Q[s[k]].cd += (Q[s[k + 1]].o[m] - Q[s[k - 1]].o[m]) / rg; } });
    return F.filter((x) => x.length);
  };
  const tour = () => { const a = P[Math.floor(r.u() * P.length)], b = P[Math.floor(r.u() * P.length)]; return a.rank < b.rank || (a.rank === b.rank && a.cd > b.cd) ? a : b; };
  sort(P);
  const hist = [];
  for (let g = 0; g < gens; g++) {
    const kids = [];
    while (kids.length < pop) {
      const p1 = tour().x, p2 = tour().x, c1 = p1.slice(), c2 = p2.slice();
      if (r.u() < pc) for (let i = 0; i < n; i++) { if (r.u() > 0.5) continue; const u = r.u(), beta = u <= 0.5 ? (2 * u) ** (1 / (etaC + 1)) : (1 / (2 * (1 - u))) ** (1 / (etaC + 1)); c1[i] = 0.5 * ((1 + beta) * p1[i] + (1 - beta) * p2[i]); c2[i] = 0.5 * ((1 - beta) * p1[i] + (1 + beta) * p2[i]); }
      for (const c of [c1, c2]) { for (let i = 0; i < n; i++) { if (r.u() < pm) { const u = r.u(), d = u < 0.5 ? (2 * u) ** (1 / (etaM + 1)) - 1 : 1 - (2 * (1 - u)) ** (1 / (etaM + 1)); c[i] += d * (hi[i] - lo[i]); } c[i] = Math.min(hi[i], Math.max(lo[i], c[i])); } kids.push({ x: c, ...f(c) }); }
    }
    const R = [...P, ...kids], F = sort(R), next = [];
    for (const fr of F) { if (next.length + fr.length <= pop) fr.forEach((i) => next.push(R[i])); else { fr.map((i) => R[i]).sort((a, b) => b.cd - a.cd).slice(0, pop - next.length).forEach((x) => next.push(x)); break; } }
    P = next; sort(P);
    if (g % 10 === 0) hist.push(P.filter((p) => p.rank === 0 && p.viol < 1e-3).length);
  }
  return { front: P.filter((p) => p.rank === 0 && p.viol < 1e-3).sort((a, b) => a.o[0] - b.o[0]), pop: P, hist };
}

export function paretoMicrogrid(mg, opts = {}) {
  const T = mg.T, lo = [...Array(T).fill(-mg.bess.P), ...Array(T).fill(0)], hi = [...Array(T).fill(mg.bess.P), ...Array(T).fill(mg.diesel.max)];
  const f = (x) => { const e = evaluate(mg, x); return { o: [e.cost, e.co2], viol: e.viol }; };
  // seed with the least-cost QP schedule and diesel-scaled variants (greener → more diesel off / battery shifting)
  const q = costOptimal(mg).x, init = [];
  for (let k = 0; k < 12; k++) init.push(q.map((v, i) => (i < T ? v * (1 - k / 24) : v * (1 - k / 11))));
  init.push(new Array(2 * T).fill(0));
  const res = nsga2(f, lo, hi, { init, ...opts });
  return { ...res, front: res.front.map((p) => ({ ...p, detail: evaluate(mg, p.x) })) };
}

/** Least-cost schedule (QP, lossless battery approximation) as reference point. */
export function costOptimal(mg) {
  const T = mg.T, nv = 3 * T; // Pb, Pd, g
  const H = Array.from({ length: nv }, (_, i) => { const r = new Float64Array(nv); r[i] = i >= T && i < 2 * T ? 2 * mg.diesel.a : 1e-6; return r; });
  const c = Float64Array.from({ length: nv }, (_, i) => (i < T ? 0 : i < 2 * T ? mg.diesel.b : mg.price[i - 2 * T]));
  const Aeq = [], beq = [], G = [], h = [];
  for (let t = 0; t < T; t++) { const a = new Float64Array(nv); a[t] = 1; a[T + t] = 1; a[2 * T + t] = 1; Aeq.push(a); beq.push(mg.load[t] - mg.pv[t] - mg.wind[t]); }
  const se = new Float64Array(nv); for (let t = 0; t < T; t++) se[t] = 1; Aeq.push(se); beq.push(0);
  const box = (i, lo, hi) => { const a = new Float64Array(nv); a[i] = 1; G.push(a); h.push(hi); const b = new Float64Array(nv); b[i] = -1; G.push(b); h.push(-lo); };
  for (let t = 0; t < T; t++) { box(t, -mg.bess.P, mg.bess.P); box(T + t, 0, mg.diesel.max); box(2 * T + t, 0, mg.grid.max); }
  for (let t = 0; t < T; t++) { const a = new Float64Array(nv), b = new Float64Array(nv); for (let k = 0; k <= t; k++) { a[k] = 1; b[k] = -1; } G.push(a); h.push(mg.bess.soc0 * mg.bess.E - 0.1 * mg.bess.E); G.push(b); h.push(mg.bess.E * (1 - mg.bess.soc0)); }
  const sol = qpSolve({ H, c, Aeq, beq, G, h }, { maxIter: 150 });
  const x = [...sol.x.slice(0, T), ...sol.x.slice(T, 2 * T)];
  return { x, ...evaluate(mg, x), converged: sol.converged };
}
