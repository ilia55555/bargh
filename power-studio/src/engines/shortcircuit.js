// Short-circuit analysis (IEC 60909-style simplified, Zbus method).
// Sequence networks: Z1 from Ybus + generator xd' (subtransient approx.), Z2 = Z1,
// Z0: lines 3×Z1; transformers Δ(gen side)–YNgrounded (zero-seq shunt on HV side);
// generators directly on a bus: X0 = 0.5·xd'. Assumptions are reported with results.
import { indexCase, branchAdmittance } from './network.js';
import { zeros, cinvMat } from '../lib/linalg.js';
import { C, cadd, cmul, cdiv, cabs, carg, csub, cscale, seqToPhase, polar } from '../lib/complex.js';

function seqY(cs, seq, opts) {
  const n = cs.bus.length, idx = indexCase(cs), Gr = zeros(n), Bi = zeros(n);
  const genBus = new Set(cs.gen.filter((g) => g.status > 0).map((g) => idx.get(g.bus)));
  const addShunt = (i, yr, yi) => { Gr[i][i] += yr; Bi[i][i] += yi; };
  cs.branch.forEach((br) => {
    if (!br.status) return;
    const f = idx.get(br.from), t = idx.get(br.to);
    const isXf = (br.ratio && br.ratio !== 0) || (cs.bus[f].baseKV && cs.bus[t].baseKV && cs.bus[f].baseKV !== cs.bus[t].baseKV);
    if (seq === 0) {
      if (isXf) {
        // Δ on the generator side, grounded-Y on the other side → shunt on grounded side only.
        const gf = genBus.has(f), gt = genBus.has(t);
        const z = { re: br.r, im: br.x }, y = cdiv(C(1, 0), z);
        if (gf && !gt) addShunt(t, y.re, y.im);
        else if (gt && !gf) addShunt(f, y.re, y.im);
        else { Gr[f][f] += y.re; Bi[f][f] += y.im; Gr[t][t] += y.re; Bi[t][t] += y.im; Gr[f][t] -= y.re; Bi[f][t] -= y.im; Gr[t][f] -= y.re; Bi[t][f] -= y.im; }
        return;
      }
      const z = { re: 3 * br.r, im: 3 * br.x }, y = cdiv(C(1, 0), z), bc = (0.6 * br.b) / 2;
      Gr[f][f] += y.re; Bi[f][f] += y.im + bc; Gr[t][t] += y.re; Bi[t][t] += y.im + bc;
      Gr[f][t] -= y.re; Bi[f][t] -= y.im; Gr[t][f] -= y.re; Bi[t][f] -= y.im;
      return;
    }
    const a = branchAdmittance({ ...br, angle: seq === 2 ? -(br.angle || 0) : br.angle || 0, b: opts.ignoreCharging ? 0 : br.b });
    Gr[f][f] += a.yff[0]; Bi[f][f] += a.yff[1]; Gr[t][t] += a.ytt[0]; Bi[t][t] += a.ytt[1];
    Gr[f][t] += a.yft[0]; Bi[f][t] += a.yft[1]; Gr[t][f] += a.ytf[0]; Bi[t][f] += a.ytf[1];
  });
  // generators
  cs.gen.forEach((g) => {
    if (g.status <= 0) return;
    const i = idx.get(g.bus), x = seq === 0 ? 0.5 * g.xdp : g.xdp;
    if (seq === 0) {
      // generator directly grounded only if the bus has no step-up transformer (simplification)
      const hasXf = cs.branch.some((br) => br.status && br.ratio && (idx.get(br.from) === i || idx.get(br.to) === i));
      if (hasXf) return;
    }
    addShunt(i, 0, -1 / x);
  });
  if (opts.loadsAsZ && seq !== 0) cs.bus.forEach((b, i) => { const v = 1; addShunt(i, b.Pd / cs.baseMVA / (v * v), -b.Qd / cs.baseMVA / (v * v)); });
  return { Gr, Bi };
}

export function buildZbus(cs, opts = {}) {
  const z = {};
  for (const s of [0, 1, 2]) {
    const { Gr, Bi } = seqY(cs, s, opts);
    // tiny ground leakage keeps floating zero-sequence nodes regular
    for (let i = 0; i < Gr.length; i++) { Gr[i][i] += 1e-6; }
    const [Zr, Zi] = cinvMat(Gr, Bi);
    z[s] = { Zr, Zi };
  }
  return z;
}

const zget = (Z, i, j) => C(Z.Zr[i][j], Z.Zi[i][j]);

/**
 * Fault at bus index k. type: '3PH' | 'SLG' | 'LL' | 'DLG'. Zf complex (pu). prefault: array of complex voltages.
 */
export function faultAt(cs, Z, k, type = '3PH', { Zf = C(0, 0), prefault = null } = {}) {
  const n = cs.bus.length, Vf = prefault ? prefault[k] : C(1, 0);
  const Z1 = zget(Z[1], k, k), Z2 = zget(Z[2], k, k), Z0 = zget(Z[0], k, k), Zf3 = cscale(Zf, 3);
  let I0 = C(), I1 = C(), I2 = C();
  if (type === '3PH') I1 = cdiv(Vf, cadd(Z1, Zf));
  else if (type === 'SLG') { I1 = cdiv(Vf, cadd(cadd(Z1, Z2), cadd(Z0, Zf3))); I2 = I1; I0 = I1; }
  else if (type === 'LL') { I1 = cdiv(Vf, cadd(cadd(Z1, Z2), Zf)); I2 = cscale(I1, -1); }
  else if (type === 'DLG') {
    const Z0f = cadd(Z0, Zf3), par = cdiv(cmul(Z2, Z0f), cadd(Z2, Z0f));
    I1 = cdiv(Vf, cadd(Z1, par));
    I2 = cscale(cdiv(cmul(I1, Z0f), cadd(Z2, Z0f)), -1);
    I0 = cscale(cdiv(cmul(I1, Z2), cadd(Z2, Z0f)), -1);
  }
  const Iabc = seqToPhase(I0, I1, I2);
  const base = cs.baseMVA, kV = cs.bus[k].baseKV || 0;
  const Ibase = kV ? (base * 1000) / (Math.sqrt(3) * kV) : 0; // A
  // bus voltages during fault (sequence superposition)
  const busV = Array.from({ length: n }, (_, i) => {
    const pre = prefault ? prefault[i] : C(1, 0);
    const V1 = csub(pre, cmul(zget(Z[1], i, k), I1));
    const V2 = cscale(cmul(zget(Z[2], i, k), I2), -1);
    const V0 = cscale(cmul(zget(Z[0], i, k), I0), -1);
    const abc = seqToPhase(V0, V1, V2);
    return { id: cs.bus[i].id, V1: cabs(V1), Va: cabs(abc[0]), Vb: cabs(abc[1]), Vc: cabs(abc[2]) };
  });
  const If = Math.max(...Iabc.map(cabs));
  return {
    bus: cs.bus[k].id, type, I0, I1, I2, Iabc, Ifault_pu: If, Ifault_kA: Ibase ? (If * Ibase) / 1000 : null,
    Sfault_MVA: type === '3PH' ? cabs(I1) * cabs(Vf) * base : null,
    Zth: { Z1, Z2, Z0 }, XR: Math.abs(Z1.im / (Z1.re || 1e-9)), busV,
    // asymmetrical peak factor (IEC 60909 κ = 1.02 + 0.98 e^{-3R/X})
    kappa: 1.02 + 0.98 * Math.exp(-3 / Math.max(Math.abs(Z1.im / (Z1.re || 1e-9)), 0.1)),
  };
}

/** Three-phase fault level scan at every bus. */
export function faultScan(cs, Z, prefault) {
  return cs.bus.map((b, k) => {
    const r3 = faultAt(cs, Z, k, '3PH', { prefault }), r1 = faultAt(cs, Z, k, 'SLG', { prefault });
    return { id: b.id, I3: r3.Ifault_pu, S3: r3.Sfault_MVA, I1: r1.Ifault_pu, kA3: r3.Ifault_kA, XR: r3.XR };
  });
}
export const prefaultFromPF = (pf) => Array.from(pf.V, (v, i) => polar(v, pf.th[i]));
export { carg };
