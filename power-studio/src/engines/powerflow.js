// AC power flow: Newton–Raphson (polar), fast-decoupled (XB) and Gauss–Seidel,
// with generator reactive-limit enforcement (PV→PQ switching), branch flows and losses.
import { makeYbus, indexCase, islands } from './network.js';
import { zeros, solve, luFactor, luSolve } from '../lib/linalg.js';
import { SpMat, spSolve } from '../lib/sparse.js';

export function busTypes(cs, outGens = new Set()) {
  const n = cs.bus.length, idx = indexCase(cs);
  const type = new Int8Array(n).fill(1), Vset = new Float64Array(n).fill(1);
  const hasGen = new Array(n).fill(false);
  cs.gen.forEach((g, k) => {
    if (g.status <= 0 || outGens.has(k)) return;
    const i = idx.get(g.bus); if (!hasGen[i]) Vset[i] = g.Vg; hasGen[i] = true;
  });
  let ref = -1;
  cs.bus.forEach((b, i) => {
    if (b.type === 4) { type[i] = 4; return; }
    if (hasGen[i]) type[i] = b.type === 3 ? 3 : 2;
    if (type[i] === 3) ref = ref < 0 ? i : ref;
  });
  if (ref < 0) { // choose the largest in-service generator as reference
    let best = -1, bp = -Infinity;
    cs.gen.forEach((g, k) => { if (g.status > 0 && !outGens.has(k) && g.Pmax > bp) { bp = g.Pmax; best = idx.get(g.bus); } });
    if (best >= 0) { ref = best; type[ref] = 3; }
  }
  // demote extra refs to PV
  type.forEach((t, i) => { if (t === 3 && i !== ref) type[i] = 2; });
  return { type, Vset, ref, hasGen };
}

const ADJ = new WeakMap();
export function adjacency(G, B) {
  let a = ADJ.get(G);
  if (!a) { a = G.map((r, i) => { const l = []; for (let k = 0; k < r.length; k++) if (r[k] !== 0 || B[i][k] !== 0) l.push(k); return l; }); ADJ.set(G, a); }
  return a;
}
export function injections(G, B, V, th) {
  const n = V.length, P = new Float64Array(n), Q = new Float64Array(n), adj = adjacency(G, B);
  for (let i = 0; i < n; i++) {
    let p = 0, q = 0; const Gi = G[i], Bi = B[i];
    for (const k of adj[i]) {
      const g = Gi[k], b = Bi[k];
      const d = th[i] - th[k], c = Math.cos(d), s = Math.sin(d);
      p += V[k] * (g * c + b * s); q += V[k] * (g * s - b * c);
    }
    P[i] = V[i] * p; Q[i] = V[i] * q;
  }
  return { P, Q };
}

/** Full NR Jacobian for given angle-unknown set `ang` and magnitude-unknown set `mag`. */
export function jacobian(G, B, V, th, P, Q, ang, mag) {
  const na = ang.length, nm = mag.length, J = zeros(na + nm);
  const posA = new Map(ang.map((b, i) => [b, i])), posM = new Map(mag.map((b, i) => [b, na + i]));
  const rows = [...ang.map((b) => ['P', b]), ...mag.map((b) => ['Q', b])];
  rows.forEach(([kind, i], r) => {
    const n = V.length;
    for (let k = 0; k < n; k++) {
      const g = G[i][k], b = B[i][k];
      if (k !== i && g === 0 && b === 0) continue;
      const ca = posA.get(k), cm = posM.get(k);
      if (k === i) {
        if (kind === 'P') {
          if (ca !== undefined) J[r][ca] = -Q[i] - B[i][i] * V[i] * V[i];
          if (cm !== undefined) J[r][cm] = P[i] / V[i] + G[i][i] * V[i];
        } else {
          if (ca !== undefined) J[r][ca] = P[i] - G[i][i] * V[i] * V[i];
          if (cm !== undefined) J[r][cm] = Q[i] / V[i] - B[i][i] * V[i];
        }
      } else {
        const d = th[i] - th[k], c = Math.cos(d), s = Math.sin(d);
        if (kind === 'P') {
          if (ca !== undefined) J[r][ca] = V[i] * V[k] * (g * s - b * c);
          if (cm !== undefined) J[r][cm] = V[i] * (g * c + b * s);
        } else {
          if (ca !== undefined) J[r][ca] = -V[i] * V[k] * (g * c + b * s);
          if (cm !== undefined) J[r][cm] = V[i] * (g * s - b * c);
        }
      }
    }
  });
  return J;
}

/** Sparse Jacobian (same layout as jacobian()). */
export function jacobianSparse(G, B, V, th, P, Q, ang, mag) {
  const na = ang.length, J = new SpMat(na + mag.length), adj = adjacency(G, B);
  const posA = new Int32Array(V.length).fill(-1), posM = new Int32Array(V.length).fill(-1);
  ang.forEach((b, i) => { posA[b] = i; }); mag.forEach((b, i) => { posM[b] = na + i; });
  const fill = (r, i, isP) => {
    for (const k of adj[i]) {
      const g = G[i][k], b = B[i][k], ca = posA[k], cm = posM[k];
      if (k === i) {
        if (isP) { if (ca >= 0) J.set(r, ca, -Q[i] - b * V[i] * V[i]); if (cm >= 0) J.set(r, cm, P[i] / V[i] + g * V[i]); }
        else { if (ca >= 0) J.set(r, ca, P[i] - g * V[i] * V[i]); if (cm >= 0) J.set(r, cm, Q[i] / V[i] - b * V[i]); }
      } else {
        const d = th[i] - th[k], c = Math.cos(d), s = Math.sin(d);
        if (isP) { if (ca >= 0) J.set(r, ca, V[i] * V[k] * (g * s - b * c)); if (cm >= 0) J.set(r, cm, V[i] * (g * c + b * s)); }
        else { if (ca >= 0) J.set(r, ca, -V[i] * V[k] * (g * c + b * s)); if (cm >= 0) J.set(r, cm, V[i] * (g * s - b * c)); }
      }
    }
  };
  ang.forEach((i, r) => fill(r, i, true)); mag.forEach((i, r) => fill(na + r, i, false));
  return J;
}

function specified(cs, opts, types) {
  const n = cs.bus.length, idx = indexCase(cs), base = cs.baseMVA;
  const ls = opts.loadScale ?? 1, gs = opts.genScale ?? 1, outG = opts.outGens || new Set();
  const Psp = new Float64Array(n), Qsp = new Float64Array(n);
  cs.bus.forEach((b, i) => {
    const lsi = opts.busLoadScale?.[i] ?? ls;
    Psp[i] -= (b.Pd * lsi) / base; Qsp[i] -= (b.Qd * lsi) / base;
  });
  cs.gen.forEach((g, k) => { if (g.status > 0 && !outG.has(k)) { const i = idx.get(g.bus); Psp[i] += (g.Pg * gs) / base; } });
  if (opts.extraP) opts.extraP.forEach((v, i) => { Psp[i] += v / base; });
  if (opts.extraQ) opts.extraQ.forEach((v, i) => { Qsp[i] += v / base; });
  return { Psp, Qsp };
}

function initVoltages(cs, types, flat) {
  const n = cs.bus.length, V = new Float64Array(n), th = new Float64Array(n);
  cs.bus.forEach((b, i) => {
    V[i] = flat ? 1 : b.Vm || 1; th[i] = flat ? 0 : ((b.Va || 0) * Math.PI) / 180;
    if (types.type[i] === 2 || types.type[i] === 3) V[i] = types.Vset[i];
  });
  return { V, th };
}

function nrCore(Y, V, th, Psp, Qsp, type, opts) {
  const n = V.length, tol = opts.tol ?? 1e-8, maxIter = opts.maxIter ?? 30, log = [];
  const pvpq = [], pq = [];
  for (let i = 0; i < n; i++) { if (type[i] === 1 || type[i] === 2) pvpq.push(i); if (type[i] === 1) pq.push(i); }
  let it = 0, converged = false;
  for (; it <= maxIter; it++) {
    const { P, Q } = injections(Y.G, Y.B, V, th);
    const F = new Float64Array(pvpq.length + pq.length);
    pvpq.forEach((i, r) => { F[r] = P[i] - Psp[i]; });
    pq.forEach((i, r) => { F[pvpq.length + r] = Q[i] - Qsp[i]; });
    let nf = 0; for (const f of F) nf = Math.max(nf, Math.abs(f));
    log.push(nf);
    if (!Number.isFinite(nf) || nf > 1e6) break;
    if (nf < tol) { converged = true; break; }
    if (it === maxIter) break;
    let dx;
    try {
      dx = (opts.sparse ?? n > 60) ? spSolve(jacobianSparse(Y.G, Y.B, V, th, P, Q, pvpq, pq), F) : solve(jacobian(Y.G, Y.B, V, th, P, Q, pvpq, pq), F);
    } catch { break; }
    pvpq.forEach((i, r) => { th[i] -= dx[r]; });
    pq.forEach((i, r) => { V[i] -= dx[pvpq.length + r]; });
  }
  return { converged, iterations: it, log };
}

function fdlfCore(cs, Y, V, th, Psp, Qsp, type, opts, outages) {
  const n = V.length, tol = opts.tol ?? 1e-8, maxIter = opts.maxIter ?? 100, log = [];
  const idx = indexCase(cs);
  const pvpq = [], pq = [];
  for (let i = 0; i < n; i++) { if (type[i] === 1 || type[i] === 2) pvpq.push(i); if (type[i] === 1) pq.push(i); }
  const Bp = zeros(n);
  cs.branch.forEach((br, k) => {
    if (!br.status || outages.has(k)) return;
    const f = idx.get(br.from), t = idx.get(br.to), b = 1 / br.x;
    Bp[f][f] += b; Bp[t][t] += b; Bp[f][t] -= b; Bp[t][f] -= b;
  });
  const B1 = pvpq.map((i) => Float64Array.from(pvpq.map((k) => Bp[i][k])));
  const B2 = pq.map((i) => Float64Array.from(pq.map((k) => -Y.B[i][k])));
  const f1 = luFactor(B1), f2 = pq.length ? luFactor(B2) : null;
  let it = 0, converged = false;
  for (; it < maxIter; it++) {
    let { P, Q } = injections(Y.G, Y.B, V, th);
    const dP = Float64Array.from(pvpq, (i) => (Psp[i] - P[i]) / V[i]);
    const dQm = pq.map((i) => Math.abs(Qsp[i] - Q[i]));
    const nf = Math.max(...dP.map((v, r) => Math.abs(v * V[pvpq[r]])), ...dQm, 0);
    log.push(nf);
    if (nf < tol) { converged = true; break; }
    if (!Number.isFinite(nf) || nf > 1e6) break;
    const dth = luSolve(f1, dP); pvpq.forEach((i, r) => { th[i] += dth[r]; });
    if (f2) {
      ({ P, Q } = injections(Y.G, Y.B, V, th));
      const dQ = Float64Array.from(pq, (i) => (Qsp[i] - Q[i]) / V[i]);
      const dV = luSolve(f2, dQ); pq.forEach((i, r) => { V[i] += dV[r]; });
    }
  }
  return { converged, iterations: it, log };
}

function gsCore(Y, V, th, Psp, Qsp, type, opts) {
  const n = V.length, tol = opts.tol ?? 1e-8, maxIter = opts.maxIter ?? 3000, acc = opts.accel ?? 1.6, log = [];
  const Vr = Float64Array.from(V, (v, i) => v * Math.cos(th[i])), Vi = Float64Array.from(V, (v, i) => v * Math.sin(th[i]));
  const Vmag = Float64Array.from(V);
  let it = 0, converged = false;
  for (; it < maxIter; it++) {
    let dmax = 0;
    for (let i = 0; i < n; i++) {
      if (type[i] === 3 || type[i] === 4) continue;
      let sr = 0, si = 0;
      for (let k = 0; k < n; k++) { if (k === i) continue; const g = Y.G[i][k], b = Y.B[i][k]; if (g === 0 && b === 0) continue; sr += g * Vr[k] - b * Vi[k]; si += g * Vi[k] + b * Vr[k]; }
      let Qi = Qsp[i];
      if (type[i] === 2) { // Q_i = -Im(conj(V_i) * I_i)
        const ir = sr + Y.G[i][i] * Vr[i] - Y.B[i][i] * Vi[i], ii = si + Y.G[i][i] * Vi[i] + Y.B[i][i] * Vr[i];
        Qi = Vi[i] * ir - Vr[i] * ii;
      }
      // (P - jQ)/conj(V)
      const d = Vr[i] * Vr[i] + Vi[i] * Vi[i];
      // (P - jQ)/conj(V) = (P - jQ)(Vr + jVi)/|V|^2
      const nr = (Psp[i] * Vr[i] + Qi * Vi[i]) / d - sr, ni = (Psp[i] * Vi[i] - Qi * Vr[i]) / d - si;
      const gd = Y.G[i][i], bd = Y.B[i][i], dd = gd * gd + bd * bd;
      let xr = (nr * gd + ni * bd) / dd, xi = (ni * gd - nr * bd) / dd;
      if (type[i] === 2) { const m = Math.hypot(xr, xi); xr *= Vmag[i] / m; xi *= Vmag[i] / m; }
      else { xr = Vr[i] + acc * (xr - Vr[i]); xi = Vi[i] + acc * (xi - Vi[i]); }
      dmax = Math.max(dmax, Math.hypot(xr - Vr[i], xi - Vi[i]));
      Vr[i] = xr; Vi[i] = xi;
    }
    log.push(dmax);
    if (dmax < tol) { converged = true; break; }
    if (!Number.isFinite(dmax)) break;
  }
  for (let i = 0; i < n; i++) { V[i] = Math.hypot(Vr[i], Vi[i]); th[i] = Math.atan2(Vi[i], Vr[i]); }
  return { converged, iterations: it, log };
}

/**
 * Solve AC power flow.
 * opts: method ('NR'|'FDLF'|'GS'), tol, maxIter, enforceQ, flat, outages (Set of branch idx),
 *       outGens (Set of gen idx), loadScale, genScale, busLoadScale[], extraP[], extraQ[] (MW/Mvar), init {V,th}
 */
export function runPowerFlow(cs, opts = {}) {
  const method = opts.method || 'NR', outages = opts.outages || new Set(), outGens = opts.outGens || new Set();
  const Y = makeYbus(cs, { outages });
  const types = busTypes(cs, outGens);
  const type = Int8Array.from(types.type);
  if (types.ref < 0) return { converged: false, error: 'No reference bus / generator' };
  const isl = islands(cs, outages);
  if (isl.count > 1) {
    const refC = isl.comp[types.ref];
    for (let i = 0; i < type.length; i++) if (isl.comp[i] !== refC) type[i] = 4; // de-energized
  }
  const { Psp, Qsp } = specified(cs, opts, types);
  let { V, th } = opts.init ? { V: Float64Array.from(opts.init.V), th: Float64Array.from(opts.init.th) } : initVoltages(cs, types, opts.flat);
  for (let i = 0; i < type.length; i++) if (type[i] === 2 || type[i] === 3) V[i] = types.Vset[i];
  for (let i = 0; i < type.length; i++) if (type[i] === 4) { V[i] = 0; th[i] = 0; }
  // isolated buses: zero their Y rows to keep matrices regular
  if (isl.count > 1) for (let i = 0; i < type.length; i++) if (type[i] === 4) { Y.G[i].fill(0); Y.B[i].fill(0); for (let k = 0; k < type.length; k++) { Y.G[k][i] = 0; Y.B[k][i] = 0; } }

  const idx = indexCase(cs), base = cs.baseMVA;
  const qLimited = new Set();
  let res, totalIt = 0; const fullLog = [];
  for (let pass = 0; pass < 10; pass++) {
    if (method === 'FDLF') res = fdlfCore(cs, Y, V, th, Psp, Qsp, type, opts, outages);
    else if (method === 'GS') res = gsCore(Y, V, th, Psp, Qsp, type, opts);
    else res = nrCore(Y, V, th, Psp, Qsp, type, opts);
    totalIt += res.iterations; fullLog.push(...res.log);
    if (!res.converged || opts.enforceQ === false) break;
    // reactive limits per bus
    const { Q } = injections(Y.G, Y.B, V, th);
    let changed = false;
    for (let i = 0; i < type.length; i++) {
      if (type[i] !== 2) continue;
      let qmax = 0, qmin = 0;
      cs.gen.forEach((g, k) => { if (g.status > 0 && !outGens.has(k) && idx.get(g.bus) === i) { qmax += g.Qmax; qmin += g.Qmin; } });
      const qg = Q[i] * base + cs.bus[i].Qd * (opts.busLoadScale?.[i] ?? opts.loadScale ?? 1) - (opts.extraQ?.[i] || 0);
      if (qg > qmax + 1e-6 || qg < qmin - 1e-6) {
        const lim = qg > qmax ? qmax : qmin;
        type[i] = 1; Qsp[i] = (lim - cs.bus[i].Qd * (opts.busLoadScale?.[i] ?? opts.loadScale ?? 1) + (opts.extraQ?.[i] || 0)) / base;
        qLimited.add(i); changed = true;
      }
    }
    if (!changed) break;
  }
  return assemble(cs, Y, V, th, type, types, res.converged, totalIt, fullLog, { method, qLimited, outages, outGens, opts });
}

export function assemble(cs, Y, V, th, type, types, converged, iterations, log, meta) {
  const n = V.length, base = cs.baseMVA, idx = indexCase(cs);
  const { P, Q } = injections(Y.G, Y.B, V, th);
  const ls = meta.opts.loadScale ?? 1;
  const bus = cs.bus.map((b, i) => {
    const s = meta.opts.busLoadScale?.[i] ?? ls;
    return {
      id: b.id, type: type[i], Vm: V[i], Va: (th[i] * 180) / Math.PI,
      P: P[i] * base, Q: Q[i] * base, Pd: b.Pd * s, Qd: b.Qd * s,
      Pg: P[i] * base + b.Pd * s - (meta.opts.extraP?.[i] || 0), Qg: Q[i] * base + b.Qd * s - (meta.opts.extraQ?.[i] || 0),
      vViol: type[i] !== 4 && (V[i] > (b.Vmax || 1.1) + 1e-6 || V[i] < (b.Vmin || 0.9) - 1e-6),
    };
  });
  // allocate bus generation to individual generators
  const gens = cs.gen.map((g, k) => ({ bus: g.bus, on: g.status > 0 && !meta.outGens.has(k), Pg: 0, Qg: 0, Qmax: g.Qmax, Qmin: g.Qmin, Pmax: g.Pmax, Pmin: g.Pmin }));
  const byBus = new Map();
  gens.forEach((g, k) => { if (!g.on) return; const i = idx.get(g.bus); if (!byBus.has(i)) byBus.set(i, []); byBus.get(i).push(k); });
  const gs = meta.opts.genScale ?? 1;
  for (const [i, ks] of byBus) {
    const pTot = bus[i].Pg, qTot = bus[i].Qg;
    if (type[i] === 3) { const sumPmax = ks.reduce((s, k) => s + Math.max(gens[k].Pmax, 1e-6), 0); ks.forEach((k) => { gens[k].Pg = (pTot * Math.max(gens[k].Pmax, 1e-6)) / sumPmax; }); }
    else ks.forEach((k) => { gens[k].Pg = cs.gen[k].Pg * gs; });
    const rng = ks.reduce((s, k) => s + Math.max(gens[k].Qmax - gens[k].Qmin, 1e-6), 0);
    ks.forEach((k) => { gens[k].Qg = (qTot * Math.max(gens[k].Qmax - gens[k].Qmin, 1e-6)) / rng; });
  }
  const Vr = Float64Array.from(V, (v, i) => v * Math.cos(th[i])), Vi = Float64Array.from(V, (v, i) => v * Math.sin(th[i]));
  let lossP = 0, lossQ = 0;
  const branch = cs.branch.map((br, k) => {
    const a = Y.adm[k];
    if (!a) return { from: br.from, to: br.to, on: false, Pf: 0, Qf: 0, Pt: 0, Qt: 0, loading: 0, lossP: 0, lossQ: 0, If: 0 };
    const { f, t } = a;
    const If_r = a.yff[0] * Vr[f] - a.yff[1] * Vi[f] + a.yft[0] * Vr[t] - a.yft[1] * Vi[t];
    const If_i = a.yff[0] * Vi[f] + a.yff[1] * Vr[f] + a.yft[0] * Vi[t] + a.yft[1] * Vr[t];
    const It_r = a.ytf[0] * Vr[f] - a.ytf[1] * Vi[f] + a.ytt[0] * Vr[t] - a.ytt[1] * Vi[t];
    const It_i = a.ytf[0] * Vi[f] + a.ytf[1] * Vr[f] + a.ytt[0] * Vi[t] + a.ytt[1] * Vr[t];
    const Pf = (Vr[f] * If_r + Vi[f] * If_i) * base, Qf = (Vi[f] * If_r - Vr[f] * If_i) * base;
    const Pt = (Vr[t] * It_r + Vi[t] * It_i) * base, Qt = (Vi[t] * It_r - Vr[t] * It_i) * base;
    const Smax = Math.max(Math.hypot(Pf, Qf), Math.hypot(Pt, Qt));
    lossP += Pf + Pt; lossQ += Qf + Qt;
    return {
      from: br.from, to: br.to, on: true, Pf, Qf, Pt, Qt, lossP: Pf + Pt, lossQ: Qf + Qt,
      S: Smax, loading: br.rateA > 0 ? (100 * Smax) / br.rateA : 0, If: Math.hypot(If_r, If_i), rate: br.rateA,
    };
  });
  const Vvals = bus.filter((b) => b.type !== 4).map((b) => b.Vm);
  return {
    converged, iterations, log, method: meta.method, V: Float64Array.from(V), th: Float64Array.from(th), type: Int8Array.from(type),
    ref: types.ref, bus, gens, branch, qLimited: [...meta.qLimited].map((i) => cs.bus[i].id),
    lossP, lossQ, totalPg: bus.reduce((s, b) => s + (b.type === 4 ? 0 : b.Pg), 0) - 0,
    totalPd: bus.reduce((s, b) => s + (b.type === 4 ? 0 : b.Pd), 0),
    Vmin: Math.min(...Vvals), Vmax: Math.max(...Vvals),
    maxLoading: Math.max(0, ...branch.map((b) => b.loading)),
    Y,
  };
}
