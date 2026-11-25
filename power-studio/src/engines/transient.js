// Multi-machine transient stability (classical model), Kron-reduced network,
// RK4 integration, fault-on / post-fault topologies and critical clearing time search.
import { makeYbus, indexCase } from './network.js';
import { cinvMat, cmatmul } from '../lib/linalg.js';

/** Internal EMFs and initial rotor angles from a converged power flow. */
export function machineInit(cs, pf) {
  const base = cs.baseMVA, idx = indexCase(cs);
  return cs.gen.map((g, k) => ({ g, k })).filter(({ g, k }) => g.status > 0 && pf.gens[k].on).map(({ g, k }) => {
    const i = idx.get(g.bus), V = pf.V[i], th = pf.th[i];
    const Vr = V * Math.cos(th), Vi = V * Math.sin(th);
    const P = pf.gens[k].Pg / base, Q = pf.gens[k].Qg / base;
    // I = conj(S / V) = (P - jQ) / conj(V)
    const d = V * V, Ir = (P * Vr + Q * Vi) / d, Ii = (P * Vi - Q * Vr) / d;
    // E = V + j xd' I
    const Er = Vr - g.xdp * Ii, Ei = Vi + g.xdp * Ir;
    return { k, bus: g.bus, busIdx: i, E: Math.hypot(Er, Ei), delta0: Math.atan2(Ei, Er), Pm: P, H: g.H, D: g.D || 0, xdp: g.xdp };
  });
}

/** Kron-reduced admittance seen from machine internal nodes. */
export function reducedY(cs, pf, machines, { outages = new Set(), faultBus = null, Zfault = 1e-5 } = {}) {
  const Y = makeYbus(cs, { outages }), n = Y.n, m = machines.length, base = cs.baseMVA;
  const Gn = Y.G.map((r) => Float64Array.from(r)), Bn = Y.B.map((r) => Float64Array.from(r));
  // constant-impedance loads
  cs.bus.forEach((b, i) => { const v2 = pf.V[i] ** 2 || 1; Gn[i][i] += pf.bus[i].Pd / base / v2; Bn[i][i] -= pf.bus[i].Qd / base / v2; });
  machines.forEach((mc) => { Bn[mc.busIdx][mc.busIdx] += -1 / mc.xdp; });
  if (faultBus !== null) Gn[faultBus][faultBus] += 1 / Zfault;
  const [Zr, Zi] = cinvMat(Gn, Bn);
  // Yred = Ygg - Ygn Ynn^-1 Yng with Ygg = diag(1/(j xd')), Ygn = -1/(j xd') at machine bus
  // => Yred_ij = y_i δij - y_i y_j Z_{bi,bj}, y = 1/(j xd') = -j/xd'
  const Gr = Array.from({ length: m }, () => new Float64Array(m)), Br = Array.from({ length: m }, () => new Float64Array(m));
  for (let a = 0; a < m; a++) for (let c = 0; c < m; c++) {
    const ya = -1 / machines[a].xdp, yc = -1 / machines[c].xdp; // imaginary parts
    // y_a * y_c = (j ya)(j yc) = -ya*yc
    const p = -ya * yc, zr = Zr[machines[a].busIdx][machines[c].busIdx], zi = Zi[machines[a].busIdx][machines[c].busIdx];
    Gr[a][c] = -(p * zr); Br[a][c] = -(p * zi);
    if (a === c) Br[a][c] += ya;
  }
  return { G: Gr, B: Br };
}

function pe(E, d, Yr) {
  const m = E.length, P = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) { const dd = d[i] - d[j]; s += E[j] * (Yr.G[i][j] * Math.cos(dd) + Yr.B[i][j] * Math.sin(dd)); }
    P[i] = E[i] * s;
  }
  return P;
}

/**
 * Simulate. event: { faultBus (index), tFault, tClear, tripBranch (index|null), tEnd, dt, Zfault }
 */
export function simulateTransient(cs, pf, event = {}) {
  const { faultBus = 0, tFault = 0.1, tClear = 0.2, tripBranch = null, tEnd = 3, dt = 0.002, Zfault = 1e-5, dampingD = null, record = 2 } = event;
  const ws = 2 * Math.PI * (cs.freq || 60);
  const mc = machineInit(cs, pf), m = mc.length;
  if (dampingD !== null) mc.forEach((x) => { x.D = dampingD; });
  const Ypre = reducedY(cs, pf, mc);
  const Yf = reducedY(cs, pf, mc, { faultBus, Zfault });
  const Ypost = reducedY(cs, pf, mc, { outages: tripBranch !== null && tripBranch >= 0 ? new Set([tripBranch]) : new Set() });
  const E = mc.map((x) => x.E);
  // Pm equals prefault electrical power (equilibrium) from reduced network
  const d0 = Float64Array.from(mc, (x) => x.delta0);
  const Pm = pe(E, d0, Ypre);
  const H = mc.map((x) => x.H), D = mc.map((x) => x.D);
  let d = Float64Array.from(d0), w = new Float64Array(m).fill(1);
  const t = [], delta = mc.map(() => []), omega = mc.map(() => []), pel = mc.map(() => []);
  const f = (dd, ww, Yr) => {
    const P = pe(E, dd, Yr);
    return [Float64Array.from(ww, (x) => ws * (x - 1)), Float64Array.from(ww, (x, i) => (Pm[i] - P[i] - D[i] * (x - 1)) / (2 * H[i])), P];
  };
  const steps = Math.round(tEnd / dt);
  let unstableAt = null, maxSep = 0;
  for (let s = 0; s <= steps; s++) {
    const time = s * dt;
    const Yr = time < tFault - 1e-12 ? Ypre : time < tClear - 1e-12 ? Yf : Ypost;
    const [k1d, k1w, P] = f(d, w, Yr);
    // COI angles
    const Ht = H.reduce((a, b) => a + b, 0), coi = d.reduce((a, x, i) => a + H[i] * x, 0) / Ht;
    const sep = Math.max(...d) - Math.min(...d);
    maxSep = Math.max(maxSep, sep);
    if (unstableAt === null && Math.max(...Array.from(d, (x) => Math.abs(x - coi))) > Math.PI) unstableAt = time;
    if (s % record === 0) {
      t.push(time);
      for (let i = 0; i < m; i++) { delta[i].push(((d[i] - coi) * 180) / Math.PI); omega[i].push(w[i]); pel[i].push(P[i]); }
    }
    if (s === steps) break;
    const add = (a, b, h) => Float64Array.from(a, (x, i) => x + h * b[i]);
    const [k2d, k2w] = f(add(d, k1d, dt / 2), add(w, k1w, dt / 2), Yr);
    const [k3d, k3w] = f(add(d, k2d, dt / 2), add(w, k2w, dt / 2), Yr);
    const [k4d, k4w] = f(add(d, k3d, dt), add(w, k3w, dt), Yr);
    for (let i = 0; i < m; i++) {
      d[i] += (dt / 6) * (k1d[i] + 2 * k2d[i] + 2 * k3d[i] + k4d[i]);
      w[i] += (dt / 6) * (k1w[i] + 2 * k2w[i] + 2 * k3w[i] + k4w[i]);
    }
    if (unstableAt !== null && time > unstableAt + 0.3) break;
  }
  return { t, delta, omega, pe: pel, machines: mc, Pm, stable: unstableAt === null, unstableAt, maxSepDeg: (maxSep * 180) / Math.PI };
}

/** Critical clearing time by bisection. */
export function criticalClearingTime(cs, pf, event = {}, { lo = 0.0, hi = 1.0, tol = 0.002 } = {}) {
  const run = (tc) => simulateTransient(cs, pf, { ...event, tFault: 0, tClear: tc, tEnd: event.tEnd ?? 2.5, dt: 0.002, record: 50 }).stable;
  if (!run(lo + 1e-3)) return { cct: 0, note: 'unstable even for instantaneous clearing' };
  if (run(hi)) return { cct: hi, note: `stable for clearing ≥ ${hi}s` };
  let it = 0;
  while (hi - lo > tol && it++ < 30) { const mid = (lo + hi) / 2; if (run(mid)) lo = mid; else hi = mid; }
  return { cct: lo, note: '' };
}

/** Single machine infinite bus: equal-area criterion. Pmax1 pre, Pmax2 during, Pmax3 post fault. */
export function equalArea({ Pm, Pmax1, Pmax2, Pmax3, H, f = 50 }) {
  const d0 = Math.asin(Pm / Pmax1);
  if (Pm >= Pmax3) return { d0, stableImpossible: true };
  const dmax = Math.PI - Math.asin(Pm / Pmax3);
  const cosdc = (Pm * (dmax - d0) + Pmax3 * Math.cos(dmax) - Pmax2 * Math.cos(d0)) / (Pmax3 - Pmax2);
  const dc = Math.acos(Math.max(-1, Math.min(1, cosdc)));
  const ws = 2 * Math.PI * f;
  let tc = null;
  if (Pmax2 === 0) tc = Math.sqrt((4 * H * (dc - d0)) / (ws * Pm));
  else { // numeric integration of fault-on swing until δ = δc
    let d = d0, w = 0, t = 0; const dt = 1e-4;
    while (d < dc && t < 5) { const acc = (ws / (2 * H)) * (Pm - Pmax2 * Math.sin(d)); w += acc * dt; d += w * dt; t += dt; }
    tc = d >= dc ? t : null;
  }
  return { d0, dmax, dc, tc, stableImpossible: false };
}

export function smibSwing({ Pm, Pmax1, Pmax2, Pmax3, H, f = 50, D = 0, tc = 0.1, tEnd = 2, dt = 5e-4 }) {
  const ws = 2 * Math.PI * f; let d = Math.asin(Pm / Pmax1), w = 0;
  const T = [], Dg = [], W = [];
  for (let t = 0; t <= tEnd; t += dt) {
    const Pmax = t < tc ? Pmax2 : Pmax3;
    const acc = (ws / (2 * H)) * (Pm - Pmax * Math.sin(d) - D * w / ws);
    w += acc * dt; d += w * dt;
    if (Math.round(t / dt) % 20 === 0) { T.push(t); Dg.push((d * 180) / Math.PI); W.push(w / ws); }
    if (d > 4 * Math.PI) break;
  }
  return { t: T, delta: Dg, dw: W };
}

export { cmatmul };
