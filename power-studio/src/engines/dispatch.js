// Economic dispatch (λ-iteration, quadratic costs, limits, optional B-loss penalty factors)
// and DC optimal power flow with line limits & LMPs (dense QP interior point).
import { ptdf } from './dcflow.js';
import { qpSolve } from '../lib/linalg.js';
import { indexCase } from './network.js';

const cost = (g, p) => g.cost[0] * p * p + g.cost[1] * p + g.cost[2];
const icost = (g, p) => 2 * g.cost[0] * p + g.cost[1];

/** λ-iteration ED. gens: [{cost:[a,b,c], Pmin, Pmax}], demand MW. Optional B (MW^-1) loss matrix. */
export function lambdaDispatch(gens, demand, { B = null, B0 = null, B00 = 0, tol = 1e-6, maxIter = 200 } = {}) {
  const n = gens.length, log = [];
  let P = gens.map((g) => Math.min(g.Pmax, Math.max(g.Pmin, demand / n)));
  let lambda = 0, loss = 0, it = 0;
  for (let outer = 0; outer < (B ? 50 : 1); outer++) {
    // penalty factors from current P
    const pf = gens.map((_, i) => {
      if (!B) return 1;
      let dl = 2 * B[i].reduce((s, b, j) => s + b * P[j], 0) + (B0 ? B0[i] : 0);
      return 1 / (1 - dl);
    });
    loss = B ? P.reduce((s, pi, i) => s + pi * B[i].reduce((ss, b, j) => ss + b * P[j], 0), 0) + (B0 ? P.reduce((s, p, i) => s + B0[i] * p, 0) : 0) + B00 : 0;
    const target = demand + loss;
    let lo = Math.min(...gens.map((g) => icost(g, g.Pmin))) / Math.max(...pf) - 100;
    let hi = Math.max(...gens.map((g) => icost(g, g.Pmax))) * Math.max(...pf) + 100;
    const dispatchAt = (lam) => gens.map((g, i) => {
      const a = g.cost[0], b = g.cost[1];
      let p = a > 1e-12 ? (lam / pf[i] - b) / (2 * a) : (lam / pf[i] >= b ? g.Pmax : g.Pmin);
      return Math.min(g.Pmax, Math.max(g.Pmin, p));
    });
    for (it = 0; it < maxIter; it++) {
      lambda = (lo + hi) / 2;
      const Pn = dispatchAt(lambda), tot = Pn.reduce((a, b) => a + b, 0);
      if (outer === 0 || it % 10 === 0) log.push({ lambda, total: tot });
      if (Math.abs(tot - target) < tol) { P = Pn; break; }
      if (tot > target) hi = lambda; else lo = lambda;
      P = Pn;
    }
    if (!B) break;
    const newLoss = P.reduce((s, pi, i) => s + pi * B[i].reduce((ss, b, j) => ss + b * P[j], 0), 0) + (B0 ? P.reduce((s, p, i) => s + B0[i] * p, 0) : 0) + B00;
    if (Math.abs(newLoss - loss) < 1e-4) { loss = newLoss; break; }
  }
  const total = P.reduce((s, p, i) => s + cost(gens[i], p), 0);
  return { P, lambda, loss, totalCost: total, log, ic: P.map((p, i) => icost(gens[i], p)) };
}

/** DC-OPF with line limits; returns dispatch, flows, LMP per bus, congestion duals. */
export function dcOpf(cs, { useLimits = true, limitScale = 1 } = {}) {
  const base = cs.baseMVA, idx = indexCase(cs), n = cs.bus.length;
  const on = cs.gen.map((g, k) => ({ g, k })).filter((o) => o.g.status > 0);
  const ng = on.length;
  const { H, ref } = ptdf(cs);
  const Pd = cs.bus.map((b) => b.Pd);
  const D = Pd.reduce((a, b) => a + b, 0);
  // variables Pg in MW
  const Hq = on.map((o, i) => Float64Array.from({ length: ng }, (_, j) => (i === j ? 2 * Math.max(o.g.cost[0], 1e-6) : 0)));
  const c = on.map((o) => o.g.cost[1]);
  const Aeq = [Float64Array.from({ length: ng }, () => 1)], beq = [D];
  const G = [], h = [], rows = [];
  on.forEach((o, i) => {
    const r1 = new Float64Array(ng); r1[i] = 1; G.push(r1); h.push(o.g.Pmax); rows.push({ kind: 'pmax', i });
    const r2 = new Float64Array(ng); r2[i] = -1; G.push(r2); h.push(-o.g.Pmin); rows.push({ kind: 'pmin', i });
  });
  const lineRows = [];
  if (useLimits) cs.branch.forEach((br, l) => {
    if (!br.status || !(br.rateA > 0)) return;
    const Fmax = br.rateA * limitScale;
    const hl = H[l], flowLoad = Pd.reduce((s, p, j) => s + hl[j] * p, 0);
    const row = Float64Array.from(on, (o) => hl[idx.get(o.g.bus)]);
    G.push(row); h.push(Fmax + flowLoad); rows.push({ kind: 'f+', l }); lineRows.push(G.length - 1);
    G.push(row.map((v) => -v)); h.push(Fmax - flowLoad); rows.push({ kind: 'f-', l }); lineRows.push(G.length - 1);
  });
  const sol = qpSolve({ H: Hq, c, Aeq, beq, G, h }, { tol: 1e-8, maxIter: 120 });
  const Pg = new Array(cs.gen.length).fill(0); on.forEach((o, i) => { Pg[o.k] = sol.x[i]; });
  const lambda = -sol.y[0];
  const mu = new Float64Array(cs.branch.length);
  rows.forEach((r, q) => { if (r.kind === 'f+') mu[r.l] += sol.z[q]; if (r.kind === 'f-') mu[r.l] -= sol.z[q]; });
  const lmp = Array.from({ length: n }, (_, j) => lambda - cs.branch.reduce((s, _, l) => s + mu[l] * H[l][j], 0));
  const inj = new Float64Array(n); cs.gen.forEach((g, k) => { inj[idx.get(g.bus)] += Pg[k]; }); Pd.forEach((p, j) => { inj[j] -= p; });
  const flows = cs.branch.map((br, l) => {
    const P = H[l].reduce((s, v, j) => s + v * inj[j], 0);
    return { P, loading: br.rateA ? (100 * Math.abs(P)) / (br.rateA * limitScale) : 0, mu: mu[l], binding: Math.abs(mu[l]) > 1e-4 };
  });
  const totalCost = cs.gen.reduce((s, g, k) => s + (g.status > 0 ? cost(g, Pg[k]) : 0), 0);
  return { converged: sol.converged, iterations: sol.iterations, Pg, lmp, lambda, flows, totalCost, ref, base };
}

/** Priority-list unit commitment over a 24h profile (no min up/down, includes start costs). */
export function priorityListUC(gens, profile, reserve = 0.1) {
  const order = gens.map((g, i) => ({ i, fl: (g.cost[0] * g.Pmax * g.Pmax + g.cost[1] * g.Pmax + g.cost[2]) / Math.max(g.Pmax, 1e-6) }))
    .sort((a, b) => a.fl - b.fl).map((o) => o.i);
  const schedule = profile.map((D) => {
    const on = []; let cap = 0;
    for (const i of order) { if (cap >= D * (1 + reserve)) break; on.push(i); cap += gens[i].Pmax; }
    const sub = on.map((i) => gens[i]);
    const ed = lambdaDispatch(sub.map((g) => ({ ...g, Pmin: g.Pmin })), Math.max(D, sub.reduce((s, g) => s + g.Pmin, 0)));
    const P = new Array(gens.length).fill(0); on.forEach((i, r) => { P[i] = ed.P[r]; });
    return { D, on: new Set(on), P, cost: ed.totalCost, lambda: ed.lambda };
  });
  return { order, schedule, total: schedule.reduce((s, h) => s + h.cost, 0) };
}
