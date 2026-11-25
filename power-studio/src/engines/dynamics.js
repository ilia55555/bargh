// Detailed RMS (positive-sequence) dynamic simulation:
//  • synchronous machine: 6th-order sub-transient (E'q,E'd,E''q,E''d,δ,ω, x''d = x''q interface) with
//    exponential saturation (default), or two-axis 4th-order
//  • static exciter / AVR (IEEE ST1A-type: KA/(1+sTA) with ceiling)
//  • PSS (washout + two lead–lag stages, output limit)
//  • TGOV1-type governor/turbine with droop and valve limits
//  • grid-following inverter (IBR) as controlled current source with current limit & LVRT reactive support
// Network: algebraic, constant-impedance loads, solved each step with a pre-factored augmented Ybus.
import { makeYbus, indexCase } from './network.js';
import { luFactor, luSolve, zeros } from '../lib/linalg.js';

export const DEFAULT_DYN = { xdRatio: 6, xqRatio: 5.6, xppRatio: 0.7, Tdo: 6, Tqo: 0.6, Tdopp: 0.035, Tqopp: 0.05, satA: 0.8, satB: 2.5, KA: 200, TA: 0.02, Emax: 5, Emin: -4, Kpss: 15, Tw: 10, T1: 0.15, T2: 0.05, T3: 0.15, T4: 0.05, Vsmax: 0.1, R: 0.05, Tg: 0.5, Tt: 3, D: 0 };

/** Quadratic saturation function Se(E) = B·(E−A)²/E for E > A (S1.0 ≈ 0.1, S1.2 ≈ 0.33). */
const satF = (E, P) => (E > P.satA ? (P.satB * (E - P.satA) ** 2) / E : 0);

function network(cs, pf, gens, outages, faultBus, Zf) {
  const Y = makeYbus(cs, { outages }), n = Y.n, base = cs.baseMVA, M = zeros(2 * n);
  const Gr = Y.G.map((r) => Float64Array.from(r)), Bi = Y.B.map((r) => Float64Array.from(r));
  cs.bus.forEach((b, i) => { const v2 = pf.V[i] ** 2 || 1; Gr[i][i] += pf.bus[i].Pd / base / v2; Bi[i][i] -= pf.bus[i].Qd / base / v2; });
  gens.forEach((g) => { if (!g.ibr && g.on) Bi[g.bi][g.bi] -= 1 / g.xp; });
  if (faultBus !== null && faultBus >= 0) { const d = Zf.re ** 2 + Zf.im ** 2; Gr[faultBus][faultBus] += Zf.re / d; Bi[faultBus][faultBus] -= Zf.im / d; }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { M[i][j] = Gr[i][j]; M[i][j + n] = -Bi[i][j]; M[i + n][j] = Bi[i][j]; M[i + n][j + n] = Gr[i][j]; }
  for (let i = 0; i < n; i++) if (Gr[i][i] === 0 && Bi[i][i] === 0) { M[i][i] = 1; M[i + n][i + n] = 1; }
  return luFactor(M);
}

/**
 * events: [{t, type:'fault', bus(index), Zf:{re,im}} | {t,type:'clear'} | {t,type:'trip', branch} | {t,type:'genTrip', gen} | {t,type:'load', bus, scale}]
 * opts: {tEnd, dt, avr, pss, gov, ibr:Set(gen idx), par}
 */
export function simulateDetailed(cs, pf, { events = [], tEnd = 5, dt = 0.004, avr = true, pss = true, gov = true, ibr = new Set(), par = {}, model = 'sub', sat = true } = {}) {
  const SUB = model === 'sub';
  const P = { ...DEFAULT_DYN, ...par }, base = cs.baseMVA, idx = indexCase(cs), ws = 2 * Math.PI * (cs.freq || 60), n = cs.bus.length;
  const gens = cs.gen.map((g, k) => ({ g, k })).filter(({ g, k }) => g.status > 0 && pf.gens[k].on).map(({ g, k }) => {
    const bi = idx.get(g.bus), xtr = g.xdp, xd = g.xd ?? xtr * P.xdRatio, xq = g.xq ?? xtr * P.xqRatio, xpp = g.xdpp ?? xtr * P.xppRatio, xp = SUB ? xpp : xtr;
    const V = pf.V[bi], th = pf.th[bi], Vr = V * Math.cos(th), Vi = V * Math.sin(th);
    const Pg = pf.gens[k].Pg / base, Qg = pf.gens[k].Qg / base, d2 = V * V;
    const Ir = (Pg * Vr + Qg * Vi) / d2, Ii = (Pg * Vi - Qg * Vr) / d2;
    const o = { k, bus: g.bus, bi, xp, xtr, xd, xq, H: g.H, D: g.D ?? P.D, on: true, ibr: ibr.has(k), Pref: Pg, Qref: Qg, Imax: 1.1 * Math.max(g.Pmax, Math.hypot(Pg, Qg) * base) / base, Pmax: (g.Pmax || 1e3) / base };
    if (o.ibr) return o;
    const EQr = Vr - xq * Ii, EQi = Vi + xq * Ir, delta = Math.atan2(EQi, EQr);
    const rot = (ar, ai) => { const c = Math.cos(delta - Math.PI / 2), s = Math.sin(delta - Math.PI / 2); return [ar * c + ai * s, -ar * s + ai * c]; };
    const [Id, Iq] = rot(Ir, Ii), [Vd, Vq] = rot(Vr, Vi);
    // SUB: (Eqp,Edp) are the sub-transient E''; (Etq,Etd) the transient E'
    const Eqp = Vq + xp * Id, Edp = Vd - xp * Iq;
    const Etq = SUB ? Eqp + (xtr - xpp) * Id : Eqp, Etd = SUB ? (xq - xtr) * Iq : Edp;
    const Se = sat ? satF(Etq, P) : 0; // open-circuit saturation
    const Efd = Etq * (1 + Se) + (xd - xtr) * Id;
    Object.assign(o, { x: { d: delta, w: 1, Eqp, Edp, Etq, Etd, Efd, xw: 0, z1: 0, z2: 0, gv: Pg, pm: Pg }, Vref: V + Efd / P.KA, Pm0: Pg, Pe: Pg });
    return o;
  });
  const syn = gens.filter((g) => !g.ibr);
  let outages = new Set(), faultBus = null, Zf = { re: 0, im: 1e-5 };
  let lu = network(cs, pf, gens, outages, faultBus, Zf);
  const evs = [...events].sort((a, b) => a.t - b.t); let ev = 0;
  const Vbus = { r: new Float64Array(n), i: new Float64Array(n) };
  const solveNet = (xs) => {
    const rhs = new Float64Array(2 * n);
    syn.forEach((g, j) => {
      if (!g.on) return; const x = xs[j], a = x.d - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
      const Er = x.Edp * c - x.Eqp * s, Ei = x.Edp * s + x.Eqp * c;   // E = (E'd + jE'q) e^{j(δ-π/2)}
      rhs[g.bi] += Ei / g.xp; rhs[g.bi + n] += -Er / g.xp;           // E / (j x')
    });
    let v = luSolve(lu, rhs);
    gens.forEach((g) => { if (g.ibr && g.on) g.Iinj = ibrCurrent(g, v[g.bi], v[g.bi + n]); });
    if (gens.some((g) => g.ibr && g.on)) for (let it = 0; it < 3; it++) {
      const r2 = Float64Array.from(rhs); gens.forEach((g) => { if (g.ibr && g.on) { r2[g.bi] += g.Iinj[0]; r2[g.bi + n] += g.Iinj[1]; } });
      v = luSolve(lu, r2); gens.forEach((g) => { if (g.ibr && g.on) g.Iinj = ibrCurrent(g, v[g.bi], v[g.bi + n]); });
    }
    for (let i = 0; i < n; i++) { Vbus.r[i] = v[i]; Vbus.i[i] = v[i + n]; }
    return v;
  };
  function ibrCurrent(g, vr, vi) {
    const V = Math.max(Math.hypot(vr, vi), 1e-3);
    let ip = g.Pref / V, iq = -g.Qref / V; // in voltage frame (iq>0 inductive absorbs)
    if (V < 0.9) { iq = -Math.min(g.Imax, 2 * (1 - V) * g.Imax); ip = Math.min(ip, Math.sqrt(Math.max(g.Imax ** 2 - iq ** 2, 0))); } // LVRT: reactive priority
    const m = Math.hypot(ip, iq); if (m > g.Imax) { ip *= g.Imax / m; iq *= g.Imax / m; }
    const c = vr / V, s = vi / V; // I = (ip + j iq)·e^{jθ}
    return [ip * c - iq * s, ip * s + iq * c];
  }
  const deriv = (xs) => {
    solveNet(xs);
    return syn.map((g, j) => {
      const x = xs[j]; if (!g.on) return { d: 0, w: 0, Eqp: 0, Edp: 0, Etq: 0, Etd: 0, Efd: 0, xw: 0, z1: 0, z2: 0, gv: 0, pm: 0, _: {} };
      const vr = Vbus.r[g.bi], vi = Vbus.i[g.bi], a = x.d - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
      const Er = x.Edp * c - x.Eqp * s, Ei = x.Edp * s + x.Eqp * c;
      const Igr = (Ei - vi) / g.xp, Igi = -(Er - vr) / g.xp; // (E - V)/(j x')
      const Id = Igr * c + Igi * s, Iq = -Igr * s + Igi * c;
      const Pe = x.Edp * Id + x.Eqp * Iq, Vt = Math.hypot(vr, vi), dw = x.w - 1;
      // PSS
      const u = pss ? P.Kpss * dw : 0, yw = u - x.xw, y1 = x.z1 + (P.T1 / P.T2) * (yw - x.z1), y2 = x.z2 + (P.T3 / P.T4) * (y1 - x.z2);
      const vs = Math.max(-P.Vsmax, Math.min(P.Vsmax, y2));
      const efdT = avr ? P.KA * (g.Vref - Vt + vs) : g.Vref * P.KA - g.Vref; // AVR off → constant Efd
      let dEfd = avr ? (efdT - x.Efd) / P.TA : 0;
      if ((x.Efd >= P.Emax && dEfd > 0) || (x.Efd <= P.Emin && dEfd < 0)) dEfd = 0;
      // governor (droop on machine rating)
      let dgv = gov ? ((g.Pm0 - (dw / P.R) * g.Pmax) - x.gv) / P.Tg : 0;
      if ((x.gv >= g.Pmax && dgv > 0) || (x.gv <= 0 && dgv < 0)) dgv = 0;
      const dpm = gov ? (x.gv - x.pm) / P.Tt : 0;
      return {
        d: ws * dw, w: (x.pm - Pe - g.D * dw) / (2 * g.H),
        ...(SUB ? {
          Etq: (x.Efd - x.Etq * (1 + (sat ? satF(x.Etq, P) : 0)) - (g.xd - g.xtr) * Id) / P.Tdo,
          Etd: (-x.Etd + (g.xq - g.xtr) * Iq) / P.Tqo,
          Eqp: (x.Etq - x.Eqp - (g.xtr - g.xp) * Id) / P.Tdopp,
          Edp: (x.Etd - x.Edp + (g.xtr - g.xp) * Iq) / P.Tqopp,
        } : {
          Etq: 0, Etd: 0,
          Eqp: (x.Efd - x.Eqp * (1 + (sat ? satF(x.Eqp, P) : 0)) - (g.xd - g.xp) * Id) / P.Tdo, Edp: (-x.Edp + (g.xq - g.xp) * Iq) / P.Tqo,
        }),
        Efd: dEfd, xw: (u - x.xw) / P.Tw, z1: (yw - x.z1) / P.T2, z2: (y1 - x.z2) / P.T4, gv: dgv, pm: dpm,
        _: { Pe, Vt, Id, Iq },
      };
    });
  };
  const keys = ['d', 'w', 'Eqp', 'Edp', 'Etq', 'Etd', 'Efd', 'xw', 'z1', 'z2', 'gv', 'pm'];
  let X = syn.map((g) => ({ ...g.x }));
  const out = { t: [], delta: syn.map(() => []), omega: syn.map(() => []), Vt: syn.map(() => []), Efd: syn.map(() => []), Pe: syn.map(() => []), Pm: syn.map(() => []), busV: [], ibrP: [], machines: syn.map((g) => ({ k: g.k, bus: g.bus, busIdx: g.bi })), ibr: gens.filter((g) => g.ibr).map((g) => ({ k: g.k, bus: g.bus })), events: evs };
  const steps = Math.round(tEnd / dt), rec = Math.max(1, Math.round(0.01 / dt));
  let unstableAt = null, faultActive = [];
  for (let s = 0; s <= steps; s++) {
    const t = s * dt;
    let changed = false;
    while (ev < evs.length && evs[ev].t <= t + 1e-9) {
      const e = evs[ev++]; changed = true;
      if (e.type === 'fault') { faultBus = e.bus; Zf = e.Zf || { re: 0, im: 1e-5 }; faultActive.push([e.bus, t]); }
      else if (e.type === 'clear') faultBus = null;
      else if (e.type === 'trip') outages = new Set([...outages, e.branch]);
      else if (e.type === 'genTrip') { const g = gens.find((x) => x.k === e.gen); if (g) g.on = false; }
    }
    if (changed) lu = network(cs, pf, gens.map((g) => g), outages, faultBus, Zf);
    const k1 = deriv(X);
    if (s % rec === 0) {
      out.t.push(t);
      const Ht = syn.reduce((a, g, j) => a + (g.on ? g.H : 0), 0), coi = syn.reduce((a, g, j) => a + (g.on ? g.H * X[j].d : 0), 0) / Ht;
      syn.forEach((g, j) => { out.delta[j].push(((X[j].d - coi) * 180) / Math.PI); out.omega[j].push(X[j].w); out.Vt[j].push(k1[j]._.Vt ?? 0); out.Efd[j].push(X[j].Efd); out.Pe[j].push(k1[j]._.Pe ?? 0); out.Pm[j].push(X[j].pm); });
      out.busV.push(Float32Array.from({ length: n }, (_, i) => Math.hypot(Vbus.r[i], Vbus.i[i])));
      if (unstableAt === null && syn.some((g, j) => g.on && Math.abs(X[j].d - coi) > Math.PI)) unstableAt = t;
    }
    if (s === steps || (unstableAt !== null && t > unstableAt + 0.5)) break;
    const X1 = X.map((x, j) => Object.fromEntries(keys.map((kk) => [kk, x[kk] + dt * k1[j][kk]])));
    const k2 = deriv(X1);
    X = X.map((x, j) => Object.fromEntries(keys.map((kk) => [kk, x[kk] + (dt / 2) * (k1[j][kk] + k2[j][kk])])));
  }
  return { ...out, stable: unstableAt === null, unstableAt, faults: faultActive };
}
