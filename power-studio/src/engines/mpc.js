// Model-predictive frequency control (condensed linear MPC solved as a dense QP each sample).
// Prediction model: aggregated system-frequency-response (SFR) model
//   2Hs·dΔω/dt = ΔPm + u − d − Ds·Δω ;  Tg·dΔPm/dt = −Rinv·Δω − ΔPm
// u = aggregated fast-resource power (BESS/EV/V2G), d = estimated disturbance (held constant).
import { qpSolve } from '../lib/linalg.js';

export function mpcStep({ dw, dPm, uPrev, d, Hs, Ds, Rinv, Tg, Ts = 0.1, N = 15, umin, umax, rampMax, q = 1e4, r = 1, s = 5, f0 = 50 }) {
  // discrete model x = [Δω, ΔPm]
  const A = [[1 - (Ts * Ds) / (2 * Hs), Ts / (2 * Hs)], [(-Ts * Rinv) / Tg, 1 - Ts / Tg]];
  const B = [Ts / (2 * Hs), 0], E = [-Ts / (2 * Hs), 0];
  // propagate: Δω_k = c_k + Σ_j G[k][j] u_j
  const c = [], G = [];
  let x = [dw, dPm];
  const Bk = []; // response of x to unit u at step j, stored as list of state vectors over time
  for (let k = 0; k < N; k++) {
    x = [A[0][0] * x[0] + A[0][1] * x[1] + E[0] * d, A[1][0] * x[0] + A[1][1] * x[1] + E[1] * d];
    c.push(x[0]);
  }
  for (let j = 0; j < N; j++) {
    let y = [B[0], B[1]]; const col = new Float64Array(N);
    for (let k = j; k < N; k++) { col[k] = y[0]; y = [A[0][0] * y[0] + A[0][1] * y[1], A[1][0] * y[0] + A[1][1] * y[1]]; }
    Bk.push(col);
  }
  for (let k = 0; k < N; k++) G.push(Float64Array.from({ length: N }, (_, j) => Bk[j][k]));
  const w2 = (f0 * f0); // cost on Δf in Hz²
  const H = Array.from({ length: N }, () => new Float64Array(N)), cv = new Float64Array(N);
  for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
    if (!G[k][i]) continue;
    cv[i] += 2 * q * w2 * c[k] * G[k][i];
    for (let j = 0; j < N; j++) H[i][j] += 2 * q * w2 * G[k][i] * G[k][j];
  }
  for (let i = 0; i < N; i++) {
    H[i][i] += 2 * r + 2 * s * (i < N - 1 ? 2 : 1);
    if (i > 0) { H[i][i - 1] -= 2 * s; H[i - 1][i] -= 2 * s; }
  }
  cv[0] -= 2 * s * uPrev;
  const Gc = [], h = [];
  for (let i = 0; i < N; i++) {
    const e = new Float64Array(N); e[i] = 1; Gc.push(e); h.push(umax);
    const e2 = new Float64Array(N); e2[i] = -1; Gc.push(e2); h.push(-umin);
    const rr = new Float64Array(N), rl = new Float64Array(N); rr[i] = 1; rl[i] = -1;
    if (i > 0) { rr[i - 1] = -1; rl[i - 1] = 1; Gc.push(rr); h.push(rampMax * Ts); Gc.push(rl); h.push(rampMax * Ts); }
    else { Gc.push(rr); h.push(uPrev + rampMax * Ts); Gc.push(rl); h.push(-uPrev + rampMax * Ts); }
  }
  const sol = qpSolve({ H, c: cv, G: Gc, h }, { maxIter: 60, tol: 1e-7 });
  const u0 = sol.converged ? sol.x[0] : Math.max(umin, Math.min(umax, uPrev));
  return { u: u0, plan: Array.from(sol.x || []), pred: c.map((v, k) => (v + G[k].reduce((a, g, j) => a + g * (sol.x?.[j] || 0), 0)) * f0) };
}
