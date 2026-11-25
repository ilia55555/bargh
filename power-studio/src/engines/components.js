// Component models: transmission line (geometry → RLC, ABCD long/π/short),
// transformer tests & efficiency, induction motor, synchronous machine capability,
// harmonics/power quality, power-factor correction and per-unit conversions.
import { C, cadd, cmul, cdiv, csub, cabs, carg, csqrt, ccosh, csinh, polar, cconj, cscale } from '../lib/complex.js';

const MU0 = 4e-7 * Math.PI, EPS0 = 8.854187817e-12;

/** Conductor geometry → per-km parameters (transposed line). */
export function lineGeometry({ phases = [[-8, 20], [0, 20], [8, 20]], gmr = 0.0122, radius = 0.0159, nb = 2, spacing = 0.45, rac = 0.06, f = 50 }) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const Dab = d(phases[0], phases[1]), Dbc = d(phases[1], phases[2]), Dca = d(phases[2], phases[0]);
  const GMD = Math.cbrt(Dab * Dbc * Dca);
  // bundle equivalent GMR / radius (symmetric bundle on circle)
  const bundle = (x) => {
    if (nb <= 1) return x;
    const R = spacing / (2 * Math.sin(Math.PI / nb)); // circle radius
    return (nb * x * R ** (nb - 1)) ** (1 / nb);
  };
  const Ds = bundle(gmr), Dsc = bundle(radius);
  const L = 2e-7 * Math.log(GMD / Ds); // H/m
  const Cf = (2 * Math.PI * EPS0) / Math.log(GMD / Dsc); // F/m
  const w = 2 * Math.PI * f;
  return {
    GMD, Ds, Dsc, L_mH_km: L * 1e6, C_nF_km: Cf * 1e12, X_ohm_km: w * L * 1000, B_uS_km: w * Cf * 1e9,
    r_ohm_km: rac / nb, Zc_lossless: Math.sqrt(L / Cf), v_kms: 1 / Math.sqrt(L * Cf) / 1000,
  };
}

/** ABCD parameters for length km. model: 'long'|'pi'|'short'. z, y per km complex. */
export function abcd(z, y, len, model = 'long') {
  const Z = cscale(z, len), Y = cscale(y, len);
  if (model === 'short') return { A: C(1, 0), B: Z, Cc: C(0, 0), D: C(1, 0), Z, Y };
  if (model === 'pi') {
    const A = cadd(C(1, 0), cscale(cmul(Z, Y), 0.5));
    return { A, B: Z, Cc: cmul(Y, cadd(C(1, 0), cscale(cmul(Z, Y), 0.25))), D: A, Z, Y };
  }
  const Zc = csqrt(cdiv(z, y)), gl = cscale(csqrt(cmul(z, y)), len);
  return { A: ccosh(gl), B: cmul(Zc, csinh(gl)), Cc: cdiv(csinh(gl), Zc), D: ccosh(gl), Zc, gamma: csqrt(cmul(z, y)), Z, Y };
}

/** Sending-end quantities. VR kV (line), P MW, pf (lag +). */
export function lineOperation(par, { VR = 400, P = 500, pf = 0.95, lag = true }) {
  const VRp = C((VR * 1000) / Math.sqrt(3), 0);
  const S = P * 1e6 / pf, phi = Math.acos(pf) * (lag ? -1 : 1);
  const IR = polar(S / (Math.sqrt(3) * VR * 1000), phi);
  const VS = cadd(cmul(par.A, VRp), cmul(par.B, IR));
  const IS = cadd(cmul(par.Cc, VRp), cmul(par.D, IR));
  const SS = cscale(cmul(VS, cconj(IS)), 3), SR = cscale(cmul(VRp, cconj(IR)), 3);
  const VRnl = cabs(VS) / cabs(par.A);
  return {
    VS_kV: (cabs(VS) * Math.sqrt(3)) / 1000, dS: (carg(VS) * 180) / Math.PI, IS_A: cabs(IS), IR_A: cabs(IR),
    PS_MW: SS.re / 1e6, QS_Mvar: SS.im / 1e6, PR_MW: SR.re / 1e6, QR_Mvar: SR.im / 1e6,
    eff: (100 * SR.re) / SS.re, reg: (100 * (VRnl - cabs(VRp))) / cabs(VRp),
    loss_MW: (SS.re - SR.re) / 1e6, ferranti: (cabs(cdiv(C(1, 0), par.A)) - 1) * 100,
    SIL_MW: par.Zc ? (VR * VR) / cabs(par.Zc) : null,
  };
}
export function lineVoltageProfile(z, y, len, { VR = 400, P = 0, pf = 1, pts = 60 } = {}) {
  const Zc = csqrt(cdiv(z, y)), g = csqrt(cmul(z, y));
  const VRp = C((VR * 1000) / Math.sqrt(3), 0), IR = P ? polar((P * 1e6 / pf) / (Math.sqrt(3) * VR * 1000), -Math.acos(pf)) : C(0, 0);
  const x = [], v = [];
  for (let k = 0; k <= pts; k++) { // distance from receiving end
    const d = (len * k) / pts, gl = cscale(g, d);
    const V = cadd(cmul(ccosh(gl), VRp), cmul(cmul(Zc, csinh(gl)), IR));
    x.push(len - d); v.push((cabs(V) * Math.sqrt(3)) / 1000);
  }
  return { x: x.reverse(), v: v.reverse() };
}
/** Receiving-end power circle (max transfer etc.). */
export function powerAngle(par, VS, VR) {
  const A = cabs(par.A), a = carg(par.A), B = cabs(par.B), b = carg(par.B), pts = [];
  for (let d = 0; d <= 180; d += 2) {
    const dr = (d * Math.PI) / 180;
    const PR = (VS * VR / B) * Math.cos(b - dr) - (A * VR * VR / B) * Math.cos(b - a);
    pts.push({ d, PR });
  }
  return { pts, Pmax: (VS * VR) / B - (A * VR * VR / B) * Math.cos(b - a) };
}

/** Transformer from open-circuit and short-circuit test (single-phase equivalent, LV/HV side as given). */
export function transformerTests({ S = 100e3, V1 = 11000, V2 = 400, Voc = 400, Ioc = 5, Poc = 800, Vsc = 550, Isc = 9.09, Psc = 1200 }) {
  const Ycore = Ioc / Voc, Gc = Poc / Voc ** 2, Bm = Math.sqrt(Math.max(Ycore ** 2 - Gc ** 2, 0));
  const Zeq = Vsc / Isc, Req = Psc / Isc ** 2, Xeq = Math.sqrt(Math.max(Zeq ** 2 - Req ** 2, 0));
  const Ir = S / V1, Zb = V1 * V1 / S;
  const PcuFL = Req * Ir ** 2; // full-load copper loss (SC test referred to V1 side)
  const xEff = Math.sqrt(Poc / PcuFL);
  const eff = (x, pf) => (100 * x * S * pf) / (x * S * pf + Poc + x * x * PcuFL);
  const reg = (pf, lag = true) => { const s = Math.sqrt(1 - pf * pf) * (lag ? 1 : -1); return 100 * ((Req * Ir * pf + Xeq * Ir * s) / V1 + ((Xeq * Ir * pf - Req * Ir * s) / V1) ** 2 / 2); };
  return { Rc: 1 / Gc, Xm: Bm > 0 ? 1 / Bm : Infinity, Req, Xeq, Zpu: Zeq / Zb, Rpu: Req / Zb, Xpu: Xeq / Zb, PcuFL, xMaxEff: xEff, eff, reg, ratio: V1 / V2 };
}

/** Induction motor (per-phase equivalent, IEEE recommended). */
export function inductionMotor({ V = 400, f = 50, poles = 4, R1 = 0.3, X1 = 0.8, R2 = 0.25, X2 = 0.8, Xm = 30, Pfw = 500 }) {
  const Vph = V / Math.sqrt(3), ns = (120 * f) / poles, ws = (2 * Math.PI * ns) / 60;
  // Thevenin
  const Z1 = C(R1, X1), Zm = C(0, Xm), Vth = cabs(cmul(C(Vph, 0), cdiv(Zm, cadd(Z1, Zm)))), Zth = cdiv(cmul(Z1, Zm), cadd(Z1, Zm));
  const torque = (s) => (3 * Vth * Vth * R2 / s) / (ws * ((Zth.re + R2 / s) ** 2 + (Zth.im + X2) ** 2));
  const smax = R2 / Math.hypot(Zth.re, Zth.im + X2);
  const Tmax = (3 * Vth * Vth) / (2 * ws * (Zth.re + Math.hypot(Zth.re, Zth.im + X2)));
  const curve = []; for (let k = 1; k <= 200; k++) { const s = k / 200; curve.push({ s, n: ns * (1 - s), T: torque(s) }); }
  const op = (s) => {
    const Z2 = C(R2 / s, X2), Zin = cadd(Z1, cdiv(cmul(Zm, Z2), cadd(Zm, Z2))), I1 = cdiv(C(Vph, 0), Zin);
    const Pin = 3 * Vph * cabs(I1) * Math.cos(carg(Zin)), I2 = cabs(cmul(I1, cdiv(Zm, cadd(Zm, Z2))));
    const Pag = 3 * I2 * I2 * R2 / s, Pconv = (1 - s) * Pag, Pout = Pconv - Pfw;
    return { I1: cabs(I1), pf: Math.cos(carg(Zin)), Pin, Pag, Pout, eff: (100 * Pout) / Pin, T: Pag / ws, n: ns * (1 - s) };
  };
  return { ns, smax, Tmax, Tstart: torque(1), curve, op };
}

/** Synchronous generator P–Q capability chart (round rotor). */
export function capability({ S = 1, Xs = 1.8, V = 1, Efmax = 2.6, Pmax = 0.95, Pmin = 0.1, margin = 0.1 }) {
  const arm = [], field = [], stab = [];
  for (let a = -90; a <= 90; a += 2) { const r = (a * Math.PI) / 180; arm.push({ P: S * Math.cos(r), Q: S * Math.sin(r) }); }
  const c = -(V * V) / Xs, R = (V * Efmax) / Xs;
  for (let a = -90; a <= 90; a += 2) { const r = (a * Math.PI) / 180; field.push({ P: R * Math.cos(r), Q: c + R * Math.sin(r) }); }
  // practical stability limit: δ = 90° line shifted by margin of P
  for (let E = 0.5; E <= Efmax; E += 0.05) { const Pm = (V * E) / Xs * (1 - margin); const d = Math.asin(Math.min(1, Pm / ((V * E) / Xs))); stab.push({ P: Pm, Q: c + ((V * E) / Xs) * Math.cos(d) }); }
  return { arm, field, stab, center: c, R, Pmax, Pmin };
}
export function powerAngleCurve(E, V, X, Pm) {
  const pts = []; for (let d = 0; d <= 180; d += 2) pts.push({ d, P: ((E * V) / X) * Math.sin((d * Math.PI) / 180) });
  return { pts, d0: Pm ? (Math.asin(Math.min(1, (Pm * X) / (E * V))) * 180) / Math.PI : null, Pmax: (E * V) / X };
}

/** Harmonics: spectrum [{h, mag(% of fund), ang(deg)}]. */
export function harmonics(spec, { f = 50, pts = 400 } = {}) {
  const fund = spec.find((s) => s.h === 1)?.mag || 100;
  const hs = spec.filter((s) => s.h > 1);
  const THD = Math.sqrt(hs.reduce((a, s) => a + (s.mag / fund) ** 2, 0)) * 100;
  const rms = Math.sqrt(spec.reduce((a, s) => a + (s.mag / fund) ** 2, 0));
  const K = spec.reduce((a, s) => a + ((s.mag / fund) ** 2) * s.h * s.h, 0) / rms ** 2;
  const crest = (() => { let mx = 0; for (let k = 0; k < pts; k++) { const t = k / pts / f; let v = 0; for (const s of spec) v += (s.mag / fund) * Math.SQRT2 * Math.sin(2 * Math.PI * s.h * f * t + (s.ang || 0) * Math.PI / 180); mx = Math.max(mx, Math.abs(v)); } return mx / rms; })();
  const t = [], y = [], y1 = [];
  for (let k = 0; k < pts; k++) {
    const tt = (2 * k) / pts / f; t.push(tt * 1000);
    let v = 0; for (const s of spec) v += (s.mag / fund) * Math.SQRT2 * Math.sin(2 * Math.PI * s.h * f * tt + (s.ang || 0) * Math.PI / 180);
    y.push(v); y1.push(Math.SQRT2 * Math.sin(2 * Math.PI * f * tt));
  }
  return { THD, rmsRatio: rms, Kfactor: K, crest, distortionPF: 1 / Math.sqrt(1 + (THD / 100) ** 2), t, y, y1 };
}
export function pfCorrection({ P = 500, pf1 = 0.75, pf2 = 0.95, V = 400, f = 50, Ssc = 20000 }) {
  const Qc = P * (Math.tan(Math.acos(pf1)) - Math.tan(Math.acos(pf2))); // kvar
  const Cdelta = (Qc * 1000) / (3 * 2 * Math.PI * f * V * V) * 1e6; // µF per phase (Δ)
  const Cstar = (Qc * 1000) / (2 * Math.PI * f * V * V) * 1e6; // µF per phase (Y)
  const S1 = P / pf1, S2 = P / pf2;
  return { Qc, Cdelta, Cstar, S1, S2, Ired: (100 * (S1 - S2)) / S1, hres: Math.sqrt(Ssc / Math.max(Qc, 1e-9)) };
}
export function perUnit({ Sb = 100, Vb = 230 }) {
  const Ib = (Sb * 1e6) / (Math.sqrt(3) * Vb * 1e3), Zb = (Vb * Vb) / Sb;
  return { Ib, Zb, Yb: 1 / Zb };
}
export const changeBase = (zpu, { Vold, Sold, Vnew, Snew }) => zpu * (Vold / Vnew) ** 2 * (Snew / Sold);
export { csub };
