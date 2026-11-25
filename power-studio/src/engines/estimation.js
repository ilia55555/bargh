// AC state estimation: weighted least squares (Gauss–Newton), χ² bad-data detection,
// largest-normalised-residual identification & elimination, measurement redundancy.
import { makeYbus, indexCase } from './network.js';
import { injections } from './powerflow.js';
import { solve, inv, zeros } from '../lib/linalg.js';
import { rng } from './stochastic.js';

/** Build a measurement set from a "true" power-flow solution. */
export function makeMeasurements(cs, pf, { sigV = 0.004, sigInj = 0.01, sigFlow = 0.008, injFrac = 1, flowFrac = 1, seed = 9, bad = null } = {}) {
  const r = rng(seed), base = cs.baseMVA, M = [];
  pf.bus.forEach((b, i) => { M.push({ kind: 'V', i, z: pf.V[i] + sigV * r.n(), sig: sigV, label: `|V| ${b.id}` }); });
  pf.bus.forEach((b, i) => { if (r.u() <= injFrac) { M.push({ kind: 'P', i, z: b.P / base + sigInj * r.n(), sig: sigInj, label: `P_inj ${b.id}` }, { kind: 'Q', i, z: b.Q / base + sigInj * r.n(), sig: sigInj, label: `Q_inj ${b.id}` }); } });
  pf.branch.forEach((b, k) => { if (b.on && r.u() <= flowFrac) M.push({ kind: 'Pf', k, z: b.Pf / base + sigFlow * r.n(), sig: sigFlow, label: `P ${b.from}→${b.to}` }, { kind: 'Qf', k, z: b.Qf / base + sigFlow * r.n(), sig: sigFlow, label: `Q ${b.from}→${b.to}` }); });
  if (bad) { const m = M[bad.index % M.length]; m.z += bad.size; m.bad = true; }
  return M;
}

function hfun(cs, Y, V, th, M) {
  const { P, Q } = injections(Y.G, Y.B, V, th);
  return M.map((m) => {
    if (m.kind === 'V') return V[m.i];
    if (m.kind === 'P') return P[m.i];
    if (m.kind === 'Q') return Q[m.i];
    const a = Y.adm[m.k], Vr = (i) => V[i] * Math.cos(th[i]), Vi = (i) => V[i] * Math.sin(th[i]);
    const ir = a.yff[0] * Vr(a.f) - a.yff[1] * Vi(a.f) + a.yft[0] * Vr(a.t) - a.yft[1] * Vi(a.t);
    const ii = a.yff[0] * Vi(a.f) + a.yff[1] * Vr(a.f) + a.yft[0] * Vi(a.t) + a.yft[1] * Vr(a.t);
    return m.kind === 'Pf' ? Vr(a.f) * ir + Vi(a.f) * ii : Vi(a.f) * ir - Vr(a.f) * ii;
  });
}

export function wlsEstimate(cs, Min, { maxIter = 20, tol = 1e-6, detect = true, maxRemove = 5 } = {}) {
  const Y = makeYbus(cs), n = cs.bus.length, ref = cs.bus.findIndex((b) => b.type === 3);
  let M = Min.slice(); const removed = []; let result;
  for (let pass = 0; pass <= maxRemove; pass++) {
    const V = new Float64Array(n).fill(1), th = new Float64Array(n);
    const sts = [...Array(n).keys()].filter((i) => i !== ref);
    const nx = sts.length + n, m = M.length, W = M.map((x) => 1 / x.sig ** 2);
    let it = 0, H, r, conv = false;
    for (; it < maxIter; it++) {
      const h0 = hfun(cs, Y, V, th, M); r = M.map((x, k) => x.z - h0[k]);
      H = zeros(m, nx); const eps = 1e-6;
      sts.forEach((i, c) => { th[i] += eps; const h1 = hfun(cs, Y, V, th, M); th[i] -= eps; for (let k = 0; k < m; k++) H[k][c] = (h1[k] - h0[k]) / eps; });
      for (let i = 0; i < n; i++) { V[i] += eps; const h1 = hfun(cs, Y, V, th, M); V[i] -= eps; for (let k = 0; k < m; k++) H[k][sts.length + i] = (h1[k] - h0[k]) / eps; }
      const G = zeros(nx), g = new Float64Array(nx);
      for (let k = 0; k < m; k++) { const Hk = H[k], w = W[k]; for (let a = 0; a < nx; a++) { if (!Hk[a]) continue; g[a] += Hk[a] * w * r[k]; for (let b = 0; b < nx; b++) G[a][b] += Hk[a] * w * Hk[b]; } }
      let dx; try { dx = solve(G, g); } catch { return { ok: false, error: 'Unobservable network (gain matrix singular)' }; }
      sts.forEach((i, c) => { th[i] += dx[c]; }); for (let i = 0; i < n; i++) V[i] += dx[sts.length + i];
      if (Math.max(...dx.map(Math.abs)) < tol) { conv = true; it++; break; }
    }
    const h0 = hfun(cs, Y, V, th, M); r = M.map((x, k) => x.z - h0[k]);
    const J = r.reduce((s, x, k) => s + W[k] * x * x, 0), dof = m - nx, chi2 = dof + 2.326 * Math.sqrt(2 * dof);
    // normalised residuals: Ω = R − H G⁻¹ Hᵀ
    const G = zeros(nx); for (let k = 0; k < m; k++) for (let a = 0; a < nx; a++) { if (!H[k][a]) continue; for (let b = 0; b < nx; b++) G[a][b] += H[k][a] * W[k] * H[k][b]; }
    const Gi = inv(G);
    const rN = M.map((x, k) => { let s = 0; for (let a = 0; a < nx; a++) { if (!H[k][a]) continue; let t = 0; for (let b = 0; b < nx; b++) t += Gi[a][b] * H[k][b]; s += H[k][a] * t; } const om = Math.max(x.sig ** 2 - s, 1e-14); return Math.abs(r[k]) / Math.sqrt(om); });
    result = { ok: conv, iterations: it, V: Array.from(V), th: Array.from(th, (x) => (x * 180) / Math.PI), J, chi2, dof, rN, M, removed: removed.slice(), redundancy: m / nx };
    const kmax = rN.reduce((bi, v, k) => (v > rN[bi] ? k : bi), 0);
    if (!detect || J <= chi2 || rN[kmax] < 3) break;
    removed.push({ ...M[kmax], rN: rN[kmax] }); M = M.filter((_, k) => k !== kmax);
  }
  return result;
}
