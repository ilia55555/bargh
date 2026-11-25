// Advanced optimisation: AC-OPF (sequential QP on AC finite-difference sensitivities with trust
// region; decision variables Pg and generator voltage set-points), DC-SCOPF (N-1 via LODF with
// constraint generation), unit commitment by Lagrangian relaxation (min up/down, start-up cost),
// and Monte-Carlo probabilistic power flow.
import { runPowerFlow } from './powerflow.js';
import { qpSolve } from '../lib/linalg.js';
import { ptdf, lodf } from './dcflow.js';
import { indexCase, islands, cloneCase } from './network.js';

const gcost = (g, p) => g.cost[0] * p * p + g.cost[1] * p + g.cost[2];

export function acOpf(csIn, { maxIter = 20, trustP = 80, trustV = 0.03, tol = 0.05, onIter = null } = {}) {
  const cs = cloneCase(csIn), idx = indexCase(cs), log = [];
  const on = cs.gen.map((g, k) => k).filter((k) => cs.gen[k].status > 0);
  let pf = runPowerFlow(cs, { enforceQ: false, flat: true });
  if (!pf.converged) return { converged: false, error: 'base power flow diverged' };
  const slackBus = pf.ref, slackGens = on.filter((k) => idx.get(cs.gen[k].bus) === slackBus), slack = slackGens[0];
  const pv = on.filter((k) => k !== slack);
  const metrics = (r) => ({
    S: r.branch.map((b) => b.S), V: Array.from(r.V), Q: r.gens.map((g) => g.Qg), Ps: r.gens[slack].Pg,
  });
  const totalCost = (r) => on.reduce((s, k) => s + gcost(cs.gen[k], r.gens[k].Pg), 0);
  let it = 0, TP = trustP, TV = trustV, prevCost = totalCost(pf);
  for (; it < maxIter; it++) {
    const m0 = metrics(pf), init = { V: pf.V, th: pf.th };
    const vars = [...pv.map((k) => ({ kind: 'P', k, h: 1 })), ...on.map((k) => ({ kind: 'V', k, h: 0.005 }))];
    const sens = vars.map((v) => {
      const c2 = cloneCase(cs);
      if (v.kind === 'P') c2.gen[v.k].Pg += v.h; else c2.gen.filter((g) => g.bus === cs.gen[v.k].bus).forEach((g) => { g.Vg += v.h; });
      const r = runPowerFlow(c2, { enforceQ: false, init, maxIter: 15 }); const m = metrics(r);
      return { S: m.S.map((x, i) => (x - m0.S[i]) / v.h), V: m.V.map((x, i) => (x - m0.V[i]) / v.h), Q: m.Q.map((x, i) => (x - m0.Q[i]) / v.h), Ps: (m.Ps - m0.Ps) / v.h };
    });
    const nv = vars.length, Hm = Array.from({ length: nv }, () => new Float64Array(nv)), c = new Float64Array(nv);
    const gs = cs.gen[slack], Ps0 = m0.Ps;
    vars.forEach((v, i) => {
      if (v.kind === 'P') { const g = cs.gen[v.k]; Hm[i][i] += 2 * g.cost[0]; c[i] += 2 * g.cost[0] * g.Pg + g.cost[1]; }
      c[i] += (2 * gs.cost[0] * Ps0 + gs.cost[1]) * sens[i].Ps;
      vars.forEach((_, j) => { Hm[i][j] += 2 * gs.cost[0] * sens[i].Ps * sens[j].Ps; });
      Hm[i][i] += 1e-6;
    });
    const G = [], h = [];
    const row = (coef, ub) => { G.push(Float64Array.from(coef)); h.push(ub); };
    vars.forEach((v, i) => {
      const e = new Float64Array(nv); e[i] = 1; const ne = e.map((x) => -x);
      if (v.kind === 'P') { const g = cs.gen[v.k]; row(e, Math.min(TP, g.Pmax - g.Pg)); row(ne, Math.min(TP, g.Pg - g.Pmin)); }
      else { const g = cs.gen[v.k], bi = idx.get(g.bus), b = cs.bus[bi]; row(e, Math.min(TV, (b.Vmax || 1.1) - g.Vg)); row(ne, Math.min(TV, g.Vg - (b.Vmin || 0.9))); }
    });
    row(sens.map((s) => s.Ps), gs.Pmax - Ps0); row(sens.map((s) => -s.Ps), Ps0 - gs.Pmin);
    cs.branch.forEach((br, l) => { if (br.status && br.rateA > 0) row(sens.map((s) => s.S[l]), br.rateA - m0.S[l]); });
    cs.bus.forEach((b, i) => { if (pf.type[i] !== 1) return; row(sens.map((s) => s.V[i]), (b.Vmax || 1.1) - m0.V[i]); row(sens.map((s) => -s.V[i]), m0.V[i] - (b.Vmin || 0.9)); });
    on.forEach((k) => { const g = cs.gen[k]; row(sens.map((s) => s.Q[k]), g.Qmax - m0.Q[k] + 1e-3); row(sens.map((s) => -s.Q[k]), m0.Q[k] - g.Qmin + 1e-3); });
    // relax infeasible rows (current point already violating) so the QP stays feasible but pushes back
    for (let r = 0; r < h.length; r++) if (h[r] < 0) h[r] = h[r] * 0.5;
    const sol = qpSolve({ H: Hm, c, G, h }, { maxIter: 100, tol: 1e-7 });
    if (!sol.converged) { TP /= 2; TV /= 2; if (TP < 1) break; continue; }
    const trial = cloneCase(cs);
    vars.forEach((v, i) => { if (v.kind === 'P') trial.gen[v.k].Pg += sol.x[i]; else trial.gen.filter((g) => g.bus === cs.gen[v.k].bus).forEach((g) => { g.Vg += sol.x[i]; }); });
    const r = runPowerFlow(trial, { enforceQ: false, init });
    const cost = r.converged ? totalCost(r) : Infinity;
    const step = Math.max(...sol.x.map(Math.abs));
    log.push({ it, cost: Math.min(cost, prevCost), step, TP });
    onIter?.(log[log.length - 1]);
    if (cost <= prevCost + 1e-6) { cs.gen = trial.gen; pf = r; prevCost = cost; TP = Math.min(trustP * 2, TP * 1.5); if (step < tol) break; }
    else { TP /= 2; TV /= 2; if (TP < 0.5) break; }
  }
  cs.gen[slack].Pg = pf.gens[slack].Pg;
  const viol = {
    lines: pf.branch.filter((b, l) => cs.branch[l].rateA > 0 && b.S > cs.branch[l].rateA * 1.001).length,
    volt: pf.bus.filter((b) => b.vViol).length,
    q: on.filter((k) => pf.gens[k].Qg > cs.gen[k].Qmax + 0.5 || pf.gens[k].Qg < cs.gen[k].Qmin - 0.5).length,
  };
  return { converged: true, iterations: it, cost: prevCost, pf, gens: cs.gen.map((g, k) => ({ bus: g.bus, Pg: pf.gens[k].Pg, Qg: pf.gens[k].Qg, Vg: g.Vg })), loss: pf.lossP, log, viol, case: cs };
}

/** DC security-constrained OPF (preventive N-1). emergency = post-contingency rating multiplier.
 *  Post-contingency limits are soft (penalty `penalty` $/MWh on overload) so unsecurable cases are reported, not infeasible. */
export function dcScopf(cs, { emergency = 1.2, limitScale = 1, maxRounds = 12, penalty = 5000 } = {}) {
  const idx = indexCase(cs), n = cs.bus.length, on = cs.gen.map((g, k) => ({ g, k })).filter((o) => o.g.status > 0), ng = on.length;
  const { H } = ptdf(cs), L = lodf(cs, H), Pd = cs.bus.map((b) => b.Pd), D = Pd.reduce((a, b) => a + b, 0);
  const valid = cs.branch.map((br, k) => br.status && islands(cs, new Set([k])).count === 1);
  const base = []; cs.branch.forEach((br, l) => { if (br.status && br.rateA > 0) base.push({ l, k: -1, coef: H[l], rate: br.rateA * limitScale }); });
  const cuts = [], seen = new Set();
  const flows = (x) => { const inj = Pd.map((p) => -p); on.forEach((o, i) => { inj[idx.get(o.g.bus)] += x[i]; }); return H.map((hl) => hl.reduce((s, v, j) => s + v * inj[j], 0)); };
  let sol, rounds = 0, rows = [];
  for (; rounds < maxRounds; rounds++) {
    const nv = ng + cuts.length, Hq = Array.from({ length: nv }, (_, i) => { const r = new Float64Array(nv); r[i] = i < ng ? 2 * Math.max(on[i].g.cost[0], 1e-6) : 1e-6; return r; });
    const c = Float64Array.from({ length: nv }, (_, i) => (i < ng ? on[i].g.cost[1] : penalty));
    const G = [], h = []; rows = [];
    const push = (r, ub, tag) => { G.push(r); h.push(ub); rows.push(tag); };
    on.forEach((o, i) => { const r = new Float64Array(nv); r[i] = 1; push(r, o.g.Pmax, null); const r2 = new Float64Array(nv); r2[i] = -1; push(r2, -o.g.Pmin, null); });
    [...base, ...cuts].forEach((ct, q) => {
      const isCut = q >= base.length, sv = isCut ? ng + q - base.length : -1;
      const row = new Float64Array(nv); on.forEach((o, i) => { row[i] = ct.coef[idx.get(o.g.bus)]; });
      const fl = Pd.reduce((s, p, j) => s + ct.coef[j] * p, 0), neg = row.map((v) => -v);
      if (sv >= 0) { row[sv] = -1; neg[sv] = -1; }
      push(row, ct.rate + fl, { ...ct, sgn: 1 }); push(neg, ct.rate - fl, { ...ct, sgn: -1 });
    });
    for (let j = ng; j < nv; j++) { const r = new Float64Array(nv); r[j] = -1; push(r, 0, null); }
    sol = qpSolve({ H: Hq, c, Aeq: [Float64Array.from({ length: nv }, (_, i) => (i < ng ? 1 : 0))], beq: [D], G, h }, { maxIter: 200 });
    if (!sol.converged) { return { converged: false, error: 'SCOPF QP did not converge' }; }
    const f = flows(sol.x), viol = [];
    cs.branch.forEach((brk, k) => { if (!valid[k]) return; cs.branch.forEach((brl, l) => { if (l === k || !(brl.rateA > 0) || seen.has(l + ':' + k)) return; const post = f[l] + L[l][k] * f[k], lim = brl.rateA * limitScale * emergency; if (Math.abs(post) > lim + 1e-3) viol.push({ l, k, over: Math.abs(post) - lim }); }); });
    if (!viol.length) break;
    viol.sort((a, b) => b.over - a.over).slice(0, 40).forEach(({ l, k }) => { seen.add(l + ':' + k); cuts.push({ l, k, coef: H[l].map((v, j) => v + L[l][k] * H[k][j]), rate: cs.branch[l].rateA * limitScale * emergency }); });
  }
  const Pg = new Array(cs.gen.length).fill(0); on.forEach((o, i) => { Pg[o.k] = sol.x[i]; });
  const lambda = -sol.y[0], mu = new Float64Array(n);
  rows.forEach((t, q) => { if (!t) return; for (let j = 0; j < n; j++) mu[j] += t.sgn * sol.z[q] * t.coef[j]; });
  const lmp = Array.from({ length: n }, (_, j) => lambda - mu[j]);
  const cost = cs.gen.reduce((s, g, k) => s + (g.status > 0 ? gcost(g, Pg[k]) : 0), 0);
  const unsecured = cuts.map((c, q) => ({ l: c.l, k: c.k, over: sol.x[ng + q] })).filter((u) => u.over > 0.01);
  const binding = rows.filter((t, q) => t && sol.z[q] > 1e-4);
  return { converged: true, Pg, cost, lmp, rounds, cutsAdded: cuts.length, binding, unsecured, flows: flows(sol.x) };
}

/** Lagrangian-relaxation UC. units: {cost:[a,b,c], Pmin, Pmax, SU, MU, MD, init (hrs on>0 / off<0)} */
export function lagrangianUC(units, demand, { iters = 120, reserve = 0.05 } = {}) {
  const T = demand.length, N = units.length;
  let lam = demand.map(() => Math.max(...units.map((u) => 2 * u.cost[0] * u.Pmin + u.cost[1])));
  const dispatchCost = (u, l) => { const p = Math.min(u.Pmax, Math.max(u.Pmin, u.cost[0] > 0 ? (l - u.cost[1]) / (2 * u.cost[0]) : l > u.cost[1] ? u.Pmax : u.Pmin)); return { p, c: gcost(u, p) - l * p }; };
  const unitDP = (u, lamT) => {
    // states: +k on for k hours (1..MU, MU means ≥MU), -k off for k hours (1..MD)
    const MU = Math.max(1, u.MU || 1), MD = Math.max(1, u.MD || 1), S = [];
    for (let k = 1; k <= MU; k++) S.push(k); for (let k = 1; k <= MD; k++) S.push(-k);
    const init = u.init ?? -MD, i0 = init > 0 ? Math.min(init, MU) : -Math.min(-init, MD);
    let cost = new Map(S.map((s) => [s, s === i0 ? 0 : Infinity])), back = [];
    for (let t = 0; t < T; t++) {
      const nc = new Map(S.map((s) => [s, Infinity])), bp = new Map(), dc = dispatchCost(u, lamT[t]);
      for (const [s, cv] of cost) {
        if (!Number.isFinite(cv)) continue;
        const go = (ns, add) => { const v = cv + add; if (v < nc.get(ns)) { nc.set(ns, v); bp.set(ns, s); } };
        if (s > 0) { go(Math.min(s + 1, MU), dc.c); if (s >= MU) go(-1, 0); }
        else { go(Math.max(s - 1, -MD), 0); if (-s >= MD) go(1, dc.c + (u.SU || 0)); }
      }
      cost = nc; back.push(bp);
    }
    let s = [...cost.entries()].reduce((a, b) => (b[1] < a[1] ? b : a))[0], best = cost.get(s);
    const on = new Array(T);
    for (let t = T - 1; t >= 0; t--) { on[t] = s > 0; s = back[t].get(s); }
    return { on, val: best };
  };
  let bestDual = -Infinity, sched = null, log = [];
  for (let it = 0; it < iters; it++) {
    const res = units.map((u) => unitDP(u, lam));
    const P = demand.map((_, t) => units.reduce((s, u, i) => s + (res[i].on[t] ? dispatchCost(u, lam[t]).p : 0), 0));
    const dual = res.reduce((s, r) => s + r.val, 0) + lam.reduce((s, l, t) => s + l * demand[t], 0);
    if (dual > bestDual) { bestDual = dual; sched = res.map((r) => r.on.slice()); }
    const g = demand.map((d, t) => d - P[t]), gn = Math.hypot(...g) || 1;
    const target = bestDual + Math.max(1, 0.03 * Math.abs(bestDual)) / Math.sqrt(it + 1); // Polyak step toward an estimated optimum
    const step = Math.max(0, target - dual) / (gn * gn);
    lam = lam.map((l, t) => Math.max(0, l + step * g[t]));
    log.push({ it, dual });
  }
  // primal repair: ensure capacity ≥ demand·(1+reserve) honouring cheapest average cost
  const order = units.map((u, i) => ({ i, a: gcost(u, u.Pmax) / u.Pmax })).sort((a, b) => a.a - b.a).map((o) => o.i);
  for (let t = 0; t < T; t++) {
    let cap = units.reduce((s, u, i) => s + (sched[i][t] ? u.Pmax : 0), 0);
    for (const i of order) { if (cap >= demand[t] * (1 + reserve)) break; if (!sched[i][t]) { sched[i][t] = true; cap += units[i].Pmax; } }
  }
  // economic dispatch per hour & total cost
  let total = 0; const P = [], lambdaH = [];
  for (let t = 0; t < T; t++) {
    const onU = units.map((u, i) => i).filter((i) => sched[i][t]);
    let lo = 0, hi = 1e4, l = 0, p = [];
    for (let k = 0; k < 100; k++) { l = (lo + hi) / 2; p = onU.map((i) => dispatchCost(units[i], l).p); const s = p.reduce((a, b) => a + b, 0); if (s > demand[t]) hi = l; else lo = l; }
    const row = new Array(N).fill(0); onU.forEach((i, r) => { row[i] = p[r]; total += gcost(units[i], p[r]); }); P.push(row); lambdaH.push(l);
    onU.forEach((i) => { if (t === 0 ? (units[i].init ?? -1) < 0 : !sched[i][t - 1]) total += units[i].SU || 0; });
  }
  return { schedule: sched, P, lambda: lambdaH, total, dual: bestDual, gap: (100 * (total - bestDual)) / total, log };
}

/** Monte-Carlo probabilistic power flow: loads ~ N(1, σ) (correlation ρ with a common factor). */
export function probabilisticPF(cs, { N = 300, sigma = 0.08, rho = 0.5, seed = 1 } = {}) {
  let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const out = { Vmin: [], loss: [], maxLoad: [], diverged: 0, busV: cs.bus.map(() => []) };
  const base = runPowerFlow(cs, {});
  for (let k = 0; k < N; k++) {
    const z = gauss(), sc = cs.bus.map(() => Math.max(0, 1 + sigma * (Math.sqrt(rho) * z + Math.sqrt(1 - rho) * gauss())));
    const r = runPowerFlow(cs, { busLoadScale: sc, init: { V: base.V, th: base.th }, maxIter: 20 });
    if (!r.converged) { out.diverged++; continue; }
    out.Vmin.push(r.Vmin); out.loss.push(r.lossP); out.maxLoad.push(r.maxLoading); r.V.forEach((v, i) => out.busV[i].push(v));
  }
  const st = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return { mean: m, std: Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length), p05: [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.05)], p95: [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] }; };
  return { ...out, stats: { Vmin: st(out.Vmin), loss: st(out.loss), maxLoad: st(out.maxLoad) }, pVviol: out.Vmin.filter((v) => v < 0.95).length / Math.max(out.Vmin.length, 1), pOver: out.maxLoad.filter((v) => v > 100).length / Math.max(out.maxLoad.length, 1) };
}
