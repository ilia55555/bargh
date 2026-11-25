// Small-signal (modal) analysis of the classical multimachine model:
// state matrix, eigenvalues, damping ratios, mode shapes and participation factors.
import { machineInit, reducedY } from './transient.js';
import { zeros, eig, eigvec, transpose } from '../lib/linalg.js';

export function stateMatrix(cs, pf, { D = null } = {}) {
  const ws = 2 * Math.PI * (cs.freq || 60);
  const mc = machineInit(cs, pf), m = mc.length;
  if (D !== null) mc.forEach((x) => { x.D = D; });
  const Y = reducedY(cs, pf, mc);
  const E = mc.map((x) => x.E), d = mc.map((x) => x.delta0);
  const K = zeros(m); // synchronizing coefficients ∂Pe_i/∂δ_j
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let j = 0; j < m; j++) {
      if (i === j) continue;
      const dij = d[i] - d[j];
      const v = E[i] * E[j] * (Y.G[i][j] * Math.sin(dij) - Y.B[i][j] * Math.cos(dij));
      K[i][j] = v; sum += v;
    }
    K[i][i] = -sum;
  }
  const A = zeros(2 * m);
  for (let i = 0; i < m; i++) {
    A[i][m + i] = ws;
    for (let j = 0; j < m; j++) A[m + i][j] = -K[i][j] / (2 * mc[i].H);
    A[m + i][m + i] = -mc[i].D / (2 * mc[i].H);
  }
  return { A, machines: mc, K, ws };
}

export function modalAnalysis(cs, pf, opts = {}) {
  const { A, machines } = stateMatrix(cs, pf, opts), m = machines.length;
  const lams = eig(A);
  const AT = transpose(A);
  const modes = lams.filter((l) => l.im >= -1e-9).map((l) => {
    const f = Math.abs(l.im) / (2 * Math.PI), wn = Math.hypot(l.re, l.im);
    const zeta = wn > 1e-9 ? -l.re / wn : 1;
    let shape = null, pfac = null;
    if (Math.abs(l.im) > 1e-3) {
      const v = eigvec(A, l), w = eigvec(AT, { re: l.re, im: -l.im });
      // normalise speed components of the right eigenvector
      const sp = v.slice(m);
      const mx = sp.reduce((a, c) => Math.max(a, Math.hypot(c.re, c.im)), 0) || 1;
      const ref = sp.reduce((best, c) => (Math.hypot(c.re, c.im) > Math.hypot(best.re, best.im) ? c : best), sp[0]);
      const ra = Math.atan2(ref.im, ref.re);
      shape = sp.map((c) => ({ mag: Math.hypot(c.re, c.im) / mx, ang: Math.atan2(c.im, c.re) - ra }));
      // participation p_k = |v_k w_k| (normalised)
      const p = v.map((vk, k) => Math.hypot(vk.re * w[k].re - vk.im * w[k].im, vk.re * w[k].im + vk.im * w[k].re));
      const pm = Array.from({ length: m }, (_, i) => p[i] + p[m + i]);
      const s = pm.reduce((a, b) => a + b, 0) || 1;
      pfac = pm.map((x) => x / s);
    }
    const type = Math.abs(l.im) < 1e-3 ? 'real' : f < 0.1 ? 'very-low' : f < 0.8 ? 'inter-area' : f < 2.5 ? 'local' : 'intra-plant';
    return { re: l.re, im: l.im, f, zeta, shape, pfac, type };
  });
  return { eigen: lams, modes, machines, A };
}
