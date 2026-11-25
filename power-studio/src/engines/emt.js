// Electromagnetic-transient (EMT) simulator: nodal analysis with trapezoidal companion models
// (Dommel method). Elements: R, L, C, Thevenin sources, breakers (open at current zero),
// time-controlled switches/faults, Bergeron travelling-wave lines (distortionless losses),
// metal-oxide surge arresters (non-linear, piecewise-linearised per step) and saturable
// magnetising inductance (two-slope λ–i with residual flux) for transformer inrush.
import { luFactor, luSolve, zeros } from '../lib/linalg.js';

export class EMT {
  constructor(dt = 2e-6) { this.dt = dt; this.nodes = new Map([['0', -1]]); this.el = []; this.probes = []; }
  node(name) { if (!this.nodes.has(name)) this.nodes.set(name, this.nodes.size - 1); return this.nodes.get(name); }
  R(a, b, R, name) { this.el.push({ t: 'R', a: this.node(a), b: this.node(b), G: 1 / R, name }); return this; }
  L(a, b, L, name) { this.el.push({ t: 'L', a: this.node(a), b: this.node(b), L, i: 0, v: 0, name }); return this; }
  C(a, b, C, name, v0 = 0) { this.el.push({ t: 'C', a: this.node(a), b: this.node(b), C, i: 0, v: v0, name }); return this; }
  /** Sinusoidal source behind R (Norton): v(t) = Vpk sin(ωt + φ). */
  V(a, b, Vpk, f, phDeg, Rs, name) { this.el.push({ t: 'V', a: this.node(a), b: this.node(b), Vpk, w: 2 * Math.PI * f, ph: (phDeg * Math.PI) / 180, G: 1 / Rs, name }); return this; }
  /** Breaker: closes at tClose; opening command at tOpen, interrupts at the next current zero. */
  BRK(a, b, { tClose = Infinity, tOpen = Infinity, closed = false, name } = {}) { this.el.push({ t: 'S', a: this.node(a), b: this.node(b), closed, tClose, tOpen, i: 0, opening: false, name }); return this; }
  /** Lossless Bergeron line with distortionless attenuation: Zc [Ω], τ [s], total R [Ω]. */
  LINE(a, b, Zc, tau, Rtot = 0, name) { this.el.push({ t: 'T', a: this.node(a), b: this.node(b), Zc, tau, att: Math.exp(-Rtot / (2 * Zc)), name, hist: null }); return this; }
  /** MOV arrester: i = Iref (v/Vref)^α. */
  MOV(a, b, Vref, Iref = 1000, alpha = 25, name) { this.el.push({ t: 'M', a: this.node(a), b: this.node(b), Vref, Iref, alpha, G: 1e-9, i: 0, name }); return this; }
  /** Saturable inductor (λ–i two-slope) with residual flux λ0. */
  SAT(a, b, Lm, Lsat, lamK, lam0 = 0, name) { this.el.push({ t: 'X', a: this.node(a), b: this.node(b), Lm, Lsat, lamK, lam: lam0, i: 0, v: 0, name, seg: 0 }); return this; }
  probeV(name, n1, n2 = '0', scale = 1) { this.probes.push({ name, kind: 'V', a: this.node(n1), b: this.node(n2), scale, y: [] }); return this; }
  probeI(name, elName, scale = 1) { this.probes.push({ name, kind: 'I', el: elName, scale, y: [] }); return this; }

  run(tEnd, { record = 1 } = {}) {
    const n = this.nodes.size - 1, dt = this.dt, t = [], v = new Float64Array(n);
    const V = (k) => (k < 0 ? 0 : v[k]);
    this.el.forEach((e) => { if (e.t === 'T') { e.N = Math.max(1, Math.floor(e.tau / dt)); e.frac = e.tau / dt - e.N; e.hist = { a: new Float64Array(e.N + 2), b: new Float64Array(e.N + 2), p: 0 }; } });
    const conductance = (e) => {
      switch (e.t) {
        case 'R': case 'V': return e.G;
        case 'L': return dt / (2 * e.L);
        case 'C': return (2 * e.C) / dt;
        case 'S': return e.closed ? 1e6 : 1e-9;
        case 'M': return e.G;
        case 'X': return dt / (2 * (e.seg ? e.Lsat : e.Lm));
        default: return 0;
      }
    };
    let lu = null, dirty = true;
    const build = () => {
      const G = zeros(n);
      for (let i = 0; i < n; i++) G[i][i] = 1e-9;
      const st = (a, b, g) => { if (a >= 0) G[a][a] += g; if (b >= 0) G[b][b] += g; if (a >= 0 && b >= 0) { G[a][b] -= g; G[b][a] -= g; } };
      this.el.forEach((e) => { if (e.t === 'T') { st(e.a, -1, 1 / e.Zc); st(e.b, -1, 1 / e.Zc); } else st(e.a, e.b, (e.g = conductance(e))); });
      lu = luFactor(G); dirty = false;
    };
    const steps = Math.round(tEnd / dt);
    const findI = new Map(this.el.filter((e) => e.name).map((e) => [e.name, e]));
    for (let s = 0; s <= steps; s++) {
      const time = s * dt;
      // switching logic
      this.el.forEach((e) => {
        if (e.t !== 'S') return;
        if (!e.closed && time >= e.tClose && time < e.tOpen) { e.closed = true; dirty = true; }
        if (e.closed && time >= e.tOpen) {
          if (!e.opening) { e.opening = true; e.iPrev = e.i; }
          else if (Math.sign(e.i) !== Math.sign(e.iPrev) || Math.abs(e.i) < 1e-3) { e.closed = false; dirty = true; e.tInt = time; }
          e.iPrev = e.i;
        }
      });
      if (dirty) build();
      const rhs = new Float64Array(n);
      const inj = (a, b, I) => { if (a >= 0) rhs[a] -= I; if (b >= 0) rhs[b] += I; }; // current I flowing a→b inside element
      this.el.forEach((e) => {
        if (e.t === 'V') inj(e.a, e.b, -e.G * e.Vpk * Math.sin(e.w * time + e.ph));
        else if (e.t === 'L' || e.t === 'X') e.Ih = e.i + e.g * e.v, inj(e.a, e.b, e.Ih);
        else if (e.t === 'C') e.Ih = -(e.g * e.v + e.i), inj(e.a, e.b, e.Ih);
        else if (e.t === 'T') {
          const H = e.hist, idx = (k) => H.a[(H.p - k + H.a.length * 4) % H.a.length], idxb = (k) => H.b[(H.p - k + H.b.length * 4) % H.b.length];
          const Ia = (1 - e.frac) * idxb(e.N) + e.frac * idxb(e.N + 1), Ib = (1 - e.frac) * idx(e.N) + e.frac * idx(e.N + 1);
          e.Ia = e.att * Ia; e.Ib = e.att * Ib;
          if (e.a >= 0) rhs[e.a] -= e.Ia; if (e.b >= 0) rhs[e.b] -= e.Ib;
        }
      });
      // solve; MOV arresters by Newton–Raphson within the step: i ≈ Ieq + Gd·v (tangent linearisation)
      let vPrev = null;
      for (let iter = 0; iter < 30; iter++) {
        const r2 = Float64Array.from(rhs);
        for (let k = 0; k < n; k++) r2[k] = rhs[k];
        this.el.forEach((e) => { if (e.t === 'M' && e.Ieq) { if (e.a >= 0) r2[e.a] -= e.Ieq; if (e.b >= 0) r2[e.b] += e.Ieq; } });
        v.set(luSolve(lu, r2));
        let ch = false;
        this.el.forEach((e) => {
          if (e.t !== 'M') return;
          let vab = V(e.a) - V(e.b);
          const vlim = e.Vref * 1.6; if (Math.abs(vab) > vlim) vab = Math.sign(vab) * vlim; // step limiting
          const i0 = Math.sign(vab) * e.Iref * (Math.abs(vab) / e.Vref) ** e.alpha, gd = Math.max(1e-9, (e.alpha * Math.abs(i0)) / Math.max(Math.abs(vab), 1e-9));
          const ieq = i0 - gd * vab;
          if (Math.abs(gd - e.G) > 1e-3 * e.G + 1e-9 || Math.abs(ieq - (e.Ieq || 0)) > 1e-3 * Math.abs(ieq) + 1e-6) { e.G = gd; e.Ieq = ieq; ch = true; }
        });
        if (!ch || (vPrev && v.every((x, k) => Math.abs(x - vPrev[k]) < 1e-6 * (1 + Math.abs(x))))) break;
        vPrev = Float64Array.from(v);
        build();
      }
      // update element states
      this.el.forEach((e) => {
        const vab = V(e.a) - V(e.b);
        if (e.t === 'L' || e.t === 'C') { e.i = e.g * vab + e.Ih; e.v = vab; }
        else if (e.t === 'X') {
          e.i = e.g * vab + e.Ih; e.lam += (dt / 2) * (vab + e.v); e.v = vab;
          const seg = Math.abs(e.lam) > e.lamK ? 1 : 0; if (seg !== e.seg) { e.seg = seg; dirty = true; }
          // keep i consistent with the λ–i curve when changing segment
          if (dirty) e.i = Math.abs(e.lam) <= e.lamK ? e.lam / e.Lm : Math.sign(e.lam) * (e.lamK / e.Lm + (Math.abs(e.lam) - e.lamK) / e.Lsat);
        }
        else if (e.t === 'R' || e.t === 'S') e.i = e.g * vab;
        else if (e.t === 'V') e.i = e.g * vab - e.G * e.Vpk * Math.sin(e.w * time + e.ph);
        else if (e.t === 'M') e.i = e.G * vab + (e.Ieq || 0); else if (e.t === 'T') {
          const va = V(e.a), vb = V(e.b), ia = va / e.Zc + e.Ia, ib = vb / e.Zc + e.Ib;
          const H = e.hist; H.p = (H.p + 1) % H.a.length;
          H.a[H.p] = -(va / e.Zc + ia); H.b[H.p] = -(vb / e.Zc + ib); // history seen by the far end
          e.i = ia; e.ib = ib;
        }
      });
      if (s % record === 0) {
        t.push(time);
        this.probes.forEach((p) => p.y.push(p.kind === 'V' ? (V(p.a) - V(p.b)) * p.scale : (findI.get(p.el)?.i ?? 0) * p.scale));
      }
    }
    return { t, probes: this.probes, elements: this.el };
  }
}

const phases = [0, -120, 120];
const srcRL = (kVll, MVAsc, XR, f) => { const Z = (kVll * 1e3) ** 2 / (MVAsc * 1e6), X = Z / Math.sqrt(1 + 1 / XR ** 2), R = X / XR; return { R, L: X / (2 * Math.PI * f) }; };

/** Built-in EMT studies (three-phase, phases modelled independently = no mutual coupling). */
export const EMT_STUDIES = {
  capSwitch: {
    label: 'کلیدزنی بانک خازنی (Back-to-Back اختیاری)',
    params: { kV: 20, f: 50, Ssc: 250, XR: 10, Qc: 5, tClose: 0.0125, b2b: false, Qc2: 5, Lb: 50e-6, tClose2: 0.0453 },
    build(p) {
      const s = new EMT(2e-6), { R, L } = srcRL(p.kV, p.Ssc, p.XR, p.f), Vpk = (p.kV * 1e3 * Math.SQRT2) / Math.sqrt(3), C = (p.Qc * 1e6) / (2 * Math.PI * p.f * (p.kV * 1e3) ** 2);
      ['a', 'b', 'c'].forEach((ph, k) => {
        s.V(`s${ph}`, '0', Vpk, p.f, phases[k] + 90, 1e-3).R(`s${ph}`, `r${ph}`, R).L(`r${ph}`, `bus${ph}`, L).R(`bus${ph}`, '0', 1e5);
        s.BRK(`bus${ph}`, `c${ph}`, { tClose: p.tClose, name: `cb1${ph}` }).C(`c${ph}`, '0', C).R(`c${ph}`, '0', 1e6);
        s.probeV(`V${ph} [pu]`, `bus${ph}`, '0', 1 / Vpk).probeI(`I${ph} بانک ۱ [kA]`, `cb1${ph}`, 1e-3);
        if (p.b2b) { const C2 = (p.Qc2 * 1e6) / (2 * Math.PI * p.f * (p.kV * 1e3) ** 2); s.BRK(`bus${ph}`, `d${ph}`, { tClose: p.tClose2, name: `cb2${ph}` }).L(`d${ph}`, `e${ph}`, p.Lb).C(`e${ph}`, '0', C2).probeI(`I${ph} بانک ۲ [kA]`, `cb2${ph}`, 1e-3); }
      });
      return { sim: s, tEnd: 0.08, base: Vpk };
    },
  },
  lineEnerg: {
    label: 'برق‌دار کردن خط انتقال بی‌بار (امواج سیار)',
    params: { kV: 400, f: 50, Ssc: 10000, XR: 15, len: 200, Zc: 300, v: 295000, Rkm: 0.03, tClose: 0.004, arrester: true, Ures: 1.8 },
    build(p) {
      const s = new EMT(5e-6), { R, L } = srcRL(p.kV, p.Ssc, p.XR, p.f), Vpk = (p.kV * 1e3 * Math.SQRT2) / Math.sqrt(3), tau = p.len / p.v; // v in km/s
      ['a', 'b', 'c'].forEach((ph, k) => {
        s.V(`s${ph}`, '0', Vpk, p.f, phases[k], 1e-3).R(`s${ph}`, `r${ph}`, R).L(`r${ph}`, `bus${ph}`, L).R(`bus${ph}`, '0', 1e6);
        s.BRK(`bus${ph}`, `ls${ph}`, { tClose: p.tClose + k * 0.0015, name: `cb${ph}` }).LINE(`ls${ph}`, `le${ph}`, p.Zc, tau, p.Rkm * p.len).R(`le${ph}`, '0', 1e7);
        if (p.arrester) s.MOV(`le${ph}`, '0', p.Ures * Vpk * 0.9, 1000, 25, `mov${ph}`);
        s.probeV(`V${ph} انتهای خط [pu]`, `le${ph}`, '0', 1 / Vpk);
      });
      s.probeV('Va ابتدای خط [pu]', 'lsa', '0', 1 / Vpk);
      return { sim: s, tEnd: 0.06, base: Vpk };
    },
  },
  faultTRV: {
    label: 'خطای تک‌فاز و قطع کلید در صفر جریان (TRV)',
    params: { kV: 132, f: 50, Ssc: 5000, XR: 14, Cs: 20e-9, len: 20, Rkm: 0.06, Xkm: 0.4, tFault: 0.02, tTrip: 0.07, Pload: 60 },
    build(p) {
      const s = new EMT(1e-6), { R, L } = srcRL(p.kV, p.Ssc, p.XR, p.f), Vpk = (p.kV * 1e3 * Math.SQRT2) / Math.sqrt(3);
      const Rl = p.Rkm * p.len, Ll = (p.Xkm * p.len) / (2 * Math.PI * p.f), Rload = (p.kV * 1e3) ** 2 / (p.Pload * 1e6);
      ['a', 'b', 'c'].forEach((ph, k) => {
        s.V(`s${ph}`, '0', Vpk, p.f, phases[k], 1e-3).R(`s${ph}`, `r${ph}`, R).L(`r${ph}`, `bus${ph}`, L).C(`bus${ph}`, '0', p.Cs);
        s.BRK(`bus${ph}`, `l${ph}`, { closed: true, tOpen: p.tTrip, name: `cb${ph}` }).C(`l${ph}`, '0', p.Cs / 4).R(`l${ph}`, `m${ph}`, Rl).L(`m${ph}`, `f${ph}`, Ll, `line${ph}`).R(`f${ph}`, '0', Rload);
        s.probeI(`I${ph} کلید [kA]`, `cb${ph}`, 1e-3).probeV(`TRV${ph} [pu]`, `bus${ph}`, `l${ph}`, 1 / Vpk);
      });
      // single-line-to-ground fault on phase a at the line end (node fa) through 0.5 Ω
      s.BRK('fa', 'flt', { tClose: p.tFault }).R('flt', '0', 0.5);
      return { sim: s, tEnd: 0.12, base: Vpk };
    },
  },
  inrush: {
    label: 'جریان هجومی برق‌دار کردن ترانسفورماتور',
    params: { kV: 20, f: 50, Ssc: 300, XR: 10, Sn: 10, I0pct: 0.5, satRatio: 1.15, Lair: 0.25, residual: 0.6, tClose: 0.0, Rload: 0 },
    build(p) {
      const s = new EMT(5e-6), { R, L } = srcRL(p.kV, p.Ssc, p.XR, p.f), Vpk = (p.kV * 1e3 * Math.SQRT2) / Math.sqrt(3);
      const Ir = (p.Sn * 1e6) / (Math.sqrt(3) * p.kV * 1e3), w = 2 * Math.PI * p.f, Lm = Vpk / w / (Ir * Math.SQRT2 * p.I0pct / 100), lamN = Vpk / w;
      const Zb = (p.kV * 1e3) ** 2 / (p.Sn * 1e6), Lsat = (p.Lair * Zb) / w;
      ['a', 'b', 'c'].forEach((ph, k) => {
        s.V(`s${ph}`, '0', Vpk, p.f, phases[k], 1e-3).R(`s${ph}`, `r${ph}`, R).L(`r${ph}`, `bus${ph}`, L).R(`bus${ph}`, '0', 1e6);
        s.BRK(`bus${ph}`, `t${ph}`, { tClose: p.tClose, name: `cb${ph}` }).R(`t${ph}`, `u${ph}`, 0.005 * Zb).SAT(`u${ph}`, '0', Lm, Lsat, p.satRatio * lamN, [p.residual, -p.residual / 2, -p.residual / 2][k] * lamN);
        s.probeI(`I${ph} هجومی [pu]`, `cb${ph}`, 1 / (Ir * Math.SQRT2));
      });
      s.probeV('Va شین [pu]', 'busa', '0', 1 / Vpk);
      return { sim: s, tEnd: 0.2, base: Vpk, Ir };
    },
  },
};

export function runStudy(key, params) {
  const st = EMT_STUDIES[key], p = { ...st.params, ...params };
  const { sim, tEnd } = st.build(p);
  const rec = Math.max(1, Math.round(tEnd / sim.dt / 3000));
  const out = sim.run(tEnd, { record: rec });
  const peaks = out.probes.map((pr) => ({ name: pr.name, peak: Math.max(...pr.y.map(Math.abs)) }));
  return { t: out.t, probes: out.probes, peaks, p };
}
