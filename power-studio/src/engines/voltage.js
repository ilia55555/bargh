// Voltage stability: PV curves (load-scaling continuation with step halving),
// QV curves, L-index and reduced-Jacobian Q–V modal sensitivities.
import { runPowerFlow, jacobian, injections } from './powerflow.js';
import { indexCase } from './network.js';
import { cinvMat, zeros, inv, eig, matmul } from '../lib/linalg.js';

export function pvCurve(cs, { monitor = [], step = 0.1, minStep = 0.002, maxLambda = 10, scaleGen = true, enforceQ = true } = {}) {
  let lam = 1, h = step, last = runPowerFlow(cs, { loadScale: lam, genScale: scaleGen ? lam : 1, enforceQ });
  if (!last.converged) return { points: [], lambdaMax: null };
  const idx = indexCase(cs), mon = monitor.map((id) => idx.get(id));
  const points = [{ lam, Pd: last.totalPd, V: mon.map((i) => last.V[i]), Vmin: last.Vmin }];
  while (h >= minStep && lam < maxLambda) {
    const r = runPowerFlow(cs, { loadScale: lam + h, genScale: scaleGen ? lam + h : 1, enforceQ, init: { V: last.V, th: last.th }, maxIter: 25 });
    if (r.converged && r.Vmin > 0.3) {
      lam += h; last = r;
      points.push({ lam, Pd: r.totalPd, V: mon.map((i) => r.V[i]), Vmin: r.Vmin });
    } else h /= 2;
  }
  return { points, lambdaMax: lam, PdMax: last.totalPd, critical: last };
}

export function qvCurve(cs, busId, { Vfrom = 1.15, Vto = 0.6, steps = 40 } = {}) {
  const idx = indexCase(cs), i = idx.get(busId);
  const pts = [];
  let init = null;
  for (let s = 0; s <= steps; s++) {
    const Vt = Vfrom + ((Vto - Vfrom) * s) / steps;
    // add a fictitious synchronous condenser at the bus (PV, unlimited Q)
    const c2 = JSON.parse(JSON.stringify(cs));
    c2.gen.push({ bus: busId, Pg: 0, Qg: 0, Qmax: 1e5, Qmin: -1e5, Vg: Vt, status: 1, Pmax: 0, Pmin: 0, cost: [0, 0, 0], H: 1, xdp: 1 });
    if (c2.bus[i].type === 1) c2.bus[i].type = 2;
    const r = runPowerFlow(c2, { enforceQ: false, init, maxIter: 30 });
    if (!r.converged) { pts.push({ V: Vt, Q: null }); continue; }
    init = { V: r.V, th: r.th };
    pts.push({ V: Vt, Q: r.gens[r.gens.length - 1].Qg });
  }
  const ok = pts.filter((p) => p.Q !== null);
  const qmin = ok.reduce((a, p) => (p.Q < a.Q ? p : a), ok[0] || { Q: null, V: null });
  return { points: pts, Qmargin: qmin ? -qmin.Q : null, Vcrit: qmin?.V ?? null };
}

/** Kessel–Glavitsch L-index for load buses. */
export function lIndex(cs, pf) {
  const n = cs.bus.length, gen = [], load = [];
  for (let i = 0; i < n; i++) (pf.type[i] === 2 || pf.type[i] === 3 ? gen : pf.type[i] === 1 ? load : []).push(i);
  const G = pf.Y.G, B = pf.Y.B;
  const YLLr = load.map((i) => Float64Array.from(load.map((k) => G[i][k]))), YLLi = load.map((i) => Float64Array.from(load.map((k) => B[i][k])));
  const [Zr, Zi] = cinvMat(YLLr, YLLi);
  const Vr = Array.from(pf.V, (v, i) => v * Math.cos(pf.th[i])), Vi = Array.from(pf.V, (v, i) => v * Math.sin(pf.th[i]));
  return load.map((j, a) => {
    // F = -Z_LL Y_LG ;  sum_i F_ji V_i
    let sr = 0, si = 0;
    gen.forEach((g) => {
      let fr = 0, fi = 0;
      load.forEach((k, b) => { const yr = G[k][g], yi = B[k][g]; fr -= Zr[a][b] * yr - Zi[a][b] * yi; fi -= Zr[a][b] * yi + Zi[a][b] * yr; });
      sr += fr * Vr[g] - fi * Vi[g]; si += fr * Vi[g] + fi * Vr[g];
    });
    const vj2 = Vr[j] ** 2 + Vi[j] ** 2;
    // 1 - S/Vj  with S/Vj = S conj(Vj)/|Vj|^2
    const qr = (sr * Vr[j] + si * Vi[j]) / vj2, qi = (si * Vr[j] - sr * Vi[j]) / vj2;
    return { id: cs.bus[j].id, L: Math.hypot(1 - qr, -qi) };
  }).sort((a, b) => b.L - a.L);
}

/** Reduced Jacobian J_R = J_QV − J_Qθ J_Pθ⁻¹ J_PV; returns min eigenvalue and dV/dQ per PQ bus. */
export function qvModal(cs, pf) {
  const n = pf.V.length, pvpq = [], pq = [];
  for (let i = 0; i < n; i++) { if (pf.type[i] === 1 || pf.type[i] === 2) pvpq.push(i); if (pf.type[i] === 1) pq.push(i); }
  const { P, Q } = injections(pf.Y.G, pf.Y.B, pf.V, pf.th);
  const J = jacobian(pf.Y.G, pf.Y.B, pf.V, pf.th, P, Q, pvpq, pq);
  const a = pvpq.length, b = pq.length;
  const sub = (r0, r1, c0, c1) => Array.from({ length: r1 - r0 }, (_, r) => Float64Array.from({ length: c1 - c0 }, (_, c) => J[r0 + r][c0 + c]));
  const JPt = sub(0, a, 0, a), JPV = sub(0, a, a, a + b), JQt = sub(a, a + b, 0, a), JQV = sub(a, a + b, a, a + b);
  const T = matmul(JQt, matmul(inv(JPt), JPV));
  const JR = JQV.map((r, i) => r.map((v, j) => v - T[i][j]));
  const ev = eig(JR).map((e) => e.re).sort((x, y) => x - y);
  const S = inv(JR);
  return { minEig: ev[0], eigs: ev, sens: pq.map((i, r) => ({ id: cs.bus[i].id, dVdQ: S[r][r] })).sort((x, y) => y.dVdQ - x.dVdQ) };
}
export { zeros };
