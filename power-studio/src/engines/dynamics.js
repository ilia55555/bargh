// Detailed RMS (positive-sequence) dynamic simulation:
//  • synchronous machine: 6th-order sub-transient (E'q,E'd,E''q,E''d,δ,ω, x''d = x''q interface) with
//    exponential saturation (default), or two-axis 4th-order
//  • static exciter / AVR (IEEE ST1A-type: KA/(1+sTA) with ceiling)
//  • PSS (washout + two lead–lag stages, output limit)
//  • TGOV1-type governor/turbine with droop and valve limits
//  • grid-following inverter (IBR) as controlled current source with current limit & LVRT reactive support
//  • ZIP + frequency-dependent loads (constant-P converted to Z below 0.7 pu)
//  • protection: staged UFLS, UVLS, generator under/over-frequency and pole-slip (out-of-step) tripping
//  • AGC (integral of ACE with participation factors)
//  • fast resources (BESS / EV-V2G fleets / grid-forming VSG) with power, ramp & SOC limits,
//    controlled by droop, virtual inertia (VSG) or model-predictive control (MPC)
// Network: algebraic, solved each step with a pre-factored augmented Ybus (re-factored on topology change).
import { makeYbus, indexCase } from './network.js';
import { luFactor, luSolve, zeros } from '../lib/linalg.js';
import { mpcStep } from './mpc.js';

export const DEFAULT_DYN = { xdRatio: 6, xqRatio: 5.6, xppRatio: 0.7, Tdo: 6, Tqo: 0.6, Tdopp: 0.035, Tqopp: 0.05, satA: 0.8, satB: 2.5, KA: 200, TA: 0.02, Emax: 5, Emin: -4, Kpss: 15, Tw: 10, T1: 0.15, T2: 0.05, T3: 0.15, T4: 0.05, Vsmax: 0.1, R: 0.05, Tg: 0.5, Tt: 3, D: 0 };

/** Quadratic saturation function Se(E) = B·(E−A)²/E for E > A (S1.0 ≈ 0.1, S1.2 ≈ 0.33). */
const satF = (E, P) => (E > P.satA ? (P.satB * (E - P.satA) ** 2) / E : 0);

function network(cs, pf, gens, outages, faultBus, Zf, zl) {
  const Y = makeYbus(cs, { outages }), n = Y.n, base = cs.baseMVA, M = zeros(2 * n);
  const Gr = Y.G.map((r) => Float64Array.from(r)), Bi = Y.B.map((r) => Float64Array.from(r));
  for (let i = 0; i < n; i++) { Gr[i][i] += zl[i][0]; Bi[i][i] += zl[i][1]; }
  void base;
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
export function simulateDetailed(cs, pf, { events = [], tEnd = 5, dt = 0.004, avr = true, pss = true, gov = true, ibr = new Set(), par = {}, model = 'sub', sat = true,
  loads = null, ufls = null, uvls = null, genProt = null, agc = null, resources = [], mpc = null } = {}) {
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
  const f0 = cs.freq || 60;
  // ---- loads (ZIP + frequency dependence) ----
  const LM = { zP: 1, iP: 0, pP: 0, zQ: 1, iQ: 0, pQ: 0, Kpf: 0, Kqf: 0, ...(loads || {}) };
  const V0 = Float64Array.from(pf.V), Pd0 = cs.bus.map((b, i) => pf.bus[i].Pd / base), Qd0 = cs.bus.map((b, i) => pf.bus[i].Qd / base);
  const ls = new Float64Array(n).fill(1), dPl = new Float64Array(n); // load scale (shedding) and step changes (pu)
  const zl = () => cs.bus.map((b, i) => { const v2 = V0[i] ** 2 || 1; return [(LM.zP * Pd0[i] * ls[i]) / v2, (-LM.zQ * Qd0[i] * ls[i]) / v2]; });
  const nonZ = LM.zP < 1 || LM.zQ < 1 || LM.Kpf || LM.Kqf;
  let dfpu = 0; // COI frequency deviation (pu) used by frequency-dependent loads
  // ---- fast resources ----
  const res = resources.map((r) => ({ ...r, bi: idx.get(r.bus), P: 0, soc: r.soc0 ?? 0.6, Pref: 0, Pmx: r.Pmax / base, E: (r.E || 1e9) / base, ramp: (r.ramp ?? r.Pmax * 5) / base, Tp: r.Tp ?? (r.kind === 'EV' ? 0.3 : 0.05), socMin: r.socMin ?? 0.1, socMax: r.socMax ?? 0.95 }));
  const log = [];
  let outages = new Set(), faultBus = null, Zf = { re: 0, im: 1e-5 };
  let lu = network(cs, pf, gens, outages, faultBus, Zf, zl());
  const refactor = () => { lu = network(cs, pf, gens, outages, faultBus, Zf, zl()); };
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
    const hasExtra = gens.some((g) => g.ibr && g.on) || nonZ || res.length || dPl.some((x) => x);
    if (hasExtra) for (let it = 0; it < 4; it++) {
      const r2 = Float64Array.from(rhs);
      gens.forEach((g) => { if (g.ibr && g.on) { const I = ibrCurrent(g, v[g.bi], v[g.bi + n]); r2[g.bi] += I[0]; r2[g.bi + n] += I[1]; } });
      for (let i = 0; i < n; i++) {
        const vr = v[i], vi = v[i + n], V = Math.max(Math.hypot(vr, vi), 1e-3), v2 = V * V;
        let P = Pd0[i] * ls[i] * ((1 - LM.zP) * 0 + LM.iP * (V / V0[i]) + LM.pP) * (1 + LM.Kpf * dfpu) + dPl[i];
        let Q = Qd0[i] * ls[i] * (LM.iQ * (V / V0[i]) + LM.pQ) * (1 + LM.Kqf * dfpu);
        if (LM.zP < 1 || LM.Kpf) P += Pd0[i] * ls[i] * LM.zP * (V / V0[i]) ** 2 * LM.Kpf * dfpu; // frequency part of Z load
        if (V < 0.7) { const k = (V / 0.7) ** 2; P *= k; Q *= k; } // constant-power → constant-Z at low voltage
        res.forEach((r) => { if (r.bi === i) P -= r.P; });
        if (!P && !Q) continue;
        // injection = −conj(S/V)
        r2[i] -= (P * vr + Q * vi) / v2; r2[i + n] -= (P * vi - Q * vr) / v2;
      }
      v = luSolve(lu, r2);
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
  const out = { t: [], delta: syn.map(() => []), omega: syn.map(() => []), Vt: syn.map(() => []), Efd: syn.map(() => []), Pe: syn.map(() => []), Pm: syn.map(() => []), busV: [], ibrP: [], machines: syn.map((g) => ({ k: g.k, bus: g.bus, busIdx: g.bi })), ibr: gens.filter((g) => g.ibr).map((g) => ({ k: g.k, bus: g.bus })), events: evs, f: [], rocof: [], shed: [], agc: [], resP: [], resSOC: [], Pmtot: [], genOn: [], resources: res.map((r) => ({ bus: r.bus, kind: r.kind, mode: r.mode, Pmax: r.Pmax })), log };
  const ctl = { rocof: 0, shed: 0, uagc: 0, umpc: 0, nextMpc: 0, uvT: {}, uvDone: {}, dEst: 0 };
  syn.forEach((g) => { g.Pm00 = g.Pm0; });
  if (ufls) ufls = ufls.map((x) => ({ ...x }));
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
      else if (e.type === 'genTrip') { const g = gens.find((x) => x.k === e.gen); if (g) { g.on = false; log.push({ t, kind: 'trip', text: `Generator @ bus ${g.bus} tripped (${(g.Pm0 * base).toFixed(0)} MW lost)`, bus: g.bus, k: g.k }); } }
      else if (e.type === 'load') { const MW = e.dP / base; if (e.bus === undefined || e.bus < 0) { const tot = Pd0.reduce((a, b) => a + b, 0); for (let i = 0; i < n; i++) dPl[i] += (MW * Pd0[i]) / tot; } else dPl[e.bus] += MW; log.push({ t, kind: 'load', text: `Load step ${e.dP > 0 ? '+' : ''}${e.dP} MW` }); }
      if (e.type === 'trip') log.push({ t, kind: 'line', text: `Branch ${cs.branch[e.branch].from}-${cs.branch[e.branch].to} opened` });
    }
    if (changed) refactor();
    const k1 = deriv(X);
    // ---------- system frequency, protection & controls (sampled each step) ----------
    const onIdx = syn.map((g, j) => j).filter((j) => syn[j].on);
    if (!onIdx.length) { log.push({ t, kind: 'blackout', text: 'BLACKOUT — all synchronous generation lost' }); out.blackout = t; unstableAt = unstableAt ?? t; break; }
    const Hon = onIdx.reduce((a, j) => a + syn[j].H, 0) || 1;
    const wcoi = onIdx.reduce((a, j) => a + syn[j].H * X[j].w, 0) / Hon;
    const prevDf = dfpu; dfpu = wcoi - 1;
    const fHz = f0 * wcoi, rocofRaw = (f0 * (dfpu - prevDf)) / dt;
    ctl.rocof = s ? ctl.rocof + (rocofRaw - ctl.rocof) * Math.min(1, dt / 0.1) : 0; // 100 ms filter
    if (ufls) ufls.forEach((st, q) => {
      if (st.done) return;
      if (fHz < st.f) { st.timer = (st.timer || 0) + dt; if (st.timer >= st.delay) { st.done = true; let shed = 0; for (let i = 0; i < n; i++) { const d = Math.min(ls[i], st.frac); ls[i] -= d; shed += d * Pd0[i]; } ctl.shed += shed * base; refactor(); log.push({ t, kind: 'ufls', text: `UFLS stage ${q + 1} @ ${st.f.toFixed(2)} Hz: ${(shed * base).toFixed(0)} MW shed` }); } }
      else st.timer = 0;
    });
    if (uvls) for (let i = 0; i < n; i++) {
      const V = Math.hypot(Vbus.r[i], Vbus.i[i]);
      if (V < uvls.v && ls[i] > 0 && Pd0[i] > 0 && faultBus === null) { ctl.uvT[i] = (ctl.uvT[i] || 0) + dt; if (ctl.uvT[i] >= uvls.delay && !ctl.uvDone[i]) { ctl.uvDone[i] = true; const d = Math.min(ls[i], uvls.frac); ls[i] -= d; ctl.shed += d * Pd0[i] * base; refactor(); log.push({ t, kind: 'uvls', text: `UVLS at bus ${cs.bus[i].id}: ${(d * Pd0[i] * base).toFixed(0)} MW shed` }); } }
      else ctl.uvT[i] = 0;
    }
    if (genProt) {
      const coiAng = onIdx.reduce((a, j) => a + syn[j].H * X[j].d, 0) / Hon;
      onIdx.forEach((j) => {
        const g = syn[j], fg = f0 * X[j].w;
        const uf = fg < genProt.fmin, of = fg > genProt.fmax, slip = Math.abs(X[j].d - coiAng) > Math.PI;
        if (uf || of) g.protT = (g.protT || 0) + dt; else g.protT = 0;
        if (slip || g.protT >= genProt.delay) { g.on = false; refactor(); log.push({ t, kind: 'trip', bus: g.bus, k: g.k, text: `Generator @ bus ${g.bus} tripped by ${slip ? 'pole-slip (out-of-step)' : uf ? 'under-frequency' : 'over-frequency'} protection` }); }
      });
    }
    if (agc && gov) {
      const Rinv = syn.reduce((a, g) => a + (g.on ? g.Pmax / P.R : 0), 0), beta = Rinv + (LM.Kpf || 1) * Pd0.reduce((a, b) => a + b, 0);
      ctl.uagc += -dt * agc.Ki * beta * dfpu;
      const ptot = syn.reduce((a, g) => a + (g.on ? g.Pmax : 0), 0);
      syn.forEach((g) => { if (g.on) g.Pm0 = Math.max(0, Math.min(g.Pmax, g.Pm00 + (ctl.uagc * g.Pmax) / ptot)); });
    }
    if (res.length) {
      // MPC (aggregated) every Ts
      if (mpc && t >= ctl.nextMpc - 1e-9) {
        ctl.nextMpc = t + (mpc.Ts ?? 0.1);
        const Hs = Hon, Ds = (LM.Kpf || 1) * Pd0.reduce((a, b) => a + b, 0) * Math.max(...ls);
        const Rinv = syn.reduce((a, g) => a + (g.on && gov ? g.Pmax / P.R : 0), 0) || 1e-6;
        const dPm = onIdx.reduce((a, j) => a + (X[j].pm - syn[j].Pm00), 0);
        const Pres = res.reduce((a, r) => a + r.P, 0);
        const d = dPm + Pres - Ds * dfpu - (2 * Hs * ctl.rocof) / f0; // disturbance estimate from measured RoCoF
        const avail = res.map((r) => ({ up: r.soc > r.socMin ? r.Pmx : 0, dn: r.soc < r.socMax ? r.Pmx : 0 }));
        const umax = avail.reduce((a, x) => a + x.up, 0), umin = -avail.reduce((a, x) => a + x.dn, 0), rampMax = res.reduce((a, r) => a + r.ramp, 0);
        const m = mpcStep({ dw: dfpu, dPm, uPrev: ctl.umpc, d, Hs, Ds, Rinv, Tg: P.Tt + P.Tg, Ts: mpc.Ts ?? 0.1, N: mpc.N ?? 15, umin, umax, rampMax, q: mpc.q ?? 1e4, r: mpc.r ?? 1, s: mpc.s ?? 5, f0 });
        ctl.umpc = m.u; ctl.dEst = d;
        res.forEach((r, i) => { r.Pref = m.u >= 0 ? (umax ? (m.u * avail[i].up) / umax : 0) : (umin ? (m.u * avail[i].dn) / -umin : 0); });
      }
      res.forEach((r) => {
        if (r.mode === 'droop' || r.mode === 'vsg') {
          const df = fHz - f0, db = r.dead ?? 0.02, ex = Math.abs(df) > db ? df - Math.sign(df) * db : 0;
          r.Pref = -r.Pmx * (ex / (r.fFull ?? 0.5));
          if (r.mode === 'vsg') r.Pref += (-2 * (r.H ?? 5) * r.Pmx * ctl.rocof) / f0;
        }
        if (r.mode === 'off') r.Pref = 0;
        r.Pref = Math.max(-r.Pmx, Math.min(r.Pmx, r.Pref));
        if (r.soc <= r.socMin) r.Pref = Math.min(r.Pref, 0); if (r.soc >= r.socMax) r.Pref = Math.max(r.Pref, 0);
        const dP = Math.max(-r.ramp * dt, Math.min(r.ramp * dt, ((r.Pref - r.P) * dt) / r.Tp));
        r.P += dP; r.soc -= (r.P * dt) / 3600 / r.E;
      });
    }
    if (s % rec === 0) {
      out.t.push(t);
      const Ht = syn.reduce((a, g, j) => a + (g.on ? g.H : 0), 0), coi = syn.reduce((a, g, j) => a + (g.on ? g.H * X[j].d : 0), 0) / Ht;
      syn.forEach((g, j) => { out.delta[j].push(((X[j].d - coi) * 180) / Math.PI); out.omega[j].push(X[j].w); out.Vt[j].push(k1[j]._.Vt ?? 0); out.Efd[j].push(X[j].Efd); out.Pe[j].push(k1[j]._.Pe ?? 0); out.Pm[j].push(X[j].pm); });
      out.busV.push(Float32Array.from({ length: n }, (_, i) => Math.hypot(Vbus.r[i], Vbus.i[i])));
      out.f.push(fHz); out.rocof.push(ctl.rocof); out.shed.push(ctl.shed); out.agc.push(ctl.uagc * base);
      out.resP.push(res.map((r) => r.P * base)); out.resSOC.push(res.map((r) => r.soc));
      out.Pmtot.push(onIdx.reduce((a, j) => a + X[j].pm, 0) * base); out.genOn.push(syn.map((g) => g.on));
      if (unstableAt === null && !genProt && syn.some((g, j) => g.on && Math.abs(X[j].d - coi) > Math.PI)) unstableAt = t;
      if (unstableAt === null && (fHz < f0 * 0.9 || fHz > f0 * 1.1)) unstableAt = t; // frequency collapse
    }
    if (s === steps || (unstableAt !== null && t > unstableAt + 0.5)) break;
    const X1 = X.map((x, j) => Object.fromEntries(keys.map((kk) => [kk, x[kk] + dt * k1[j][kk]])));
    const k2 = deriv(X1);
    X = X.map((x, j) => Object.fromEntries(keys.map((kk) => [kk, x[kk] + (dt / 2) * (k1[j][kk] + k2[j][kk])])));
  }
  // frequency metrics
  const f = out.f, i0 = Math.max(0, out.t.findIndex((t) => t >= (evs[0]?.t ?? 0)));
  let nadir = f0, tn = 0; for (let i = i0; i < f.length; i++) if (Math.abs(f[i] - f0) > Math.abs(nadir - f0)) { nadir = f[i]; tn = out.t[i]; }
  const rocofMax = Math.max(0, ...out.rocof.slice(i0).map(Math.abs));
  const fss = f[f.length - 1];
  return { ...out, stable: unstableAt === null, unstableAt, faults: faultActive, metrics: { nadir, tNadir: tn, rocofMax, fss, shedMW: ctl.shed, f0 } };
}
