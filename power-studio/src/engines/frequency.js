// Load-frequency control: single / two-area models with governor, (reheat) turbine,
// droop, AGC (integral of ACE), tie-line, and optional BESS virtual inertia / FFR.
export function simulateLFC(p = {}) {
  const {
    areas = 2, H = [5, 5], D = [1, 1], R = [0.05, 0.05], Tg = [0.2, 0.2], Tt = [0.5, 0.5], Fhp = [0.3, 0.3], Trh = [7, 7], reheat = false,
    Ki = [0.3, 0.3], agc = true, T12 = 0.545, a12 = -1, dPL = [0.1, 0], tStep = 1, tEnd = 30, dt = 0.005, f0 = 50,
    Kvi = [0, 0], Kd = [0, 0], Tb = 0.05, Pbmax = 0.1,
  } = p;
  const B = R.map((r, i) => 1 / r + D[i]);
  // states per area: df, Pg(gov), Pt(turbine), Prh(reheat), ACEint, Pb(battery) ; plus Ptie
  const ns = 6;
  let x = new Float64Array(ns * areas + 1);
  const dfPrev = new Float64Array(areas);
  const deriv = (x, t) => {
    const dx = new Float64Array(x.length), Ptie = areas > 1 ? x[ns * areas] : 0;
    for (let i = 0; i < areas; i++) {
      const o = ns * i, df = x[o], Pg = x[o + 1], Pt = x[o + 2], Prh = x[o + 3], Ip = x[o + 4], Pb = x[o + 5];
      const load = t >= tStep ? dPL[i] : 0;
      const tie = areas > 1 ? (i === 0 ? Ptie : a12 * Ptie) : 0;
      const Pm = reheat ? Fhp[i] * Pt + Prh : Pt;
      const ddf = (Pm + Pb - load - tie - D[i] * df) / (2 * H[i]);
      dx[o] = ddf;
      const ace = B[i] * df + tie;
      const Pref = agc ? -Ki[i] * Ip : 0;
      dx[o + 1] = (Pref - df / R[i] - Pg) / Tg[i];
      dx[o + 2] = (Pg - Pt) / Tt[i];
      dx[o + 3] = reheat ? ((1 - Fhp[i]) * Pt - Prh) / Trh[i] : 0;
      dx[o + 4] = ace;
      const pbRef = Math.max(-Pbmax, Math.min(Pbmax, -Kvi[i] * ddf - Kd[i] * df));
      dx[o + 5] = (pbRef - Pb) / Tb;
    }
    if (areas > 1) dx[ns * areas] = 2 * Math.PI * T12 * (x[0] - x[ns]);
    return dx;
  };
  const out = { t: [], df: Array.from({ length: areas }, () => []), Pm: Array.from({ length: areas }, () => []), Pb: Array.from({ length: areas }, () => []), Ptie: [] };
  const steps = Math.round(tEnd / dt);
  for (let s = 0; s <= steps; s++) {
    const t = s * dt;
    if (s % 4 === 0) {
      out.t.push(t);
      for (let i = 0; i < areas; i++) { const o = ns * i; out.df[i].push(x[o] * f0); out.Pm[i].push(reheat ? Fhp[i] * x[o + 2] + x[o + 3] : x[o + 2]); out.Pb[i].push(x[o + 5]); }
      out.Ptie.push(areas > 1 ? x[ns * areas] : 0);
    }
    const k1 = deriv(x, t), k2 = deriv(x.map((v, i) => v + (dt / 2) * k1[i]), t + dt / 2), k3 = deriv(x.map((v, i) => v + (dt / 2) * k2[i]), t + dt / 2), k4 = deriv(x.map((v, i) => v + dt * k3[i]), t + dt);
    x = x.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  }
  void dfPrev;
  // metrics for area 1
  const f1 = out.df[0], nadirIdx = f1.reduce((bi, v, i) => (Math.abs(v) > Math.abs(f1[bi]) ? i : bi), 0);
  let rocof = 0; for (let i = 1; i < f1.length; i++) rocof = Math.max(rocof, Math.abs((f1[i] - f1[i - 1]) / (out.t[i] - out.t[i - 1])));
  const ss = f1[f1.length - 1];
  const band = 0.02 * Math.abs(f1[nadirIdx]) + 1e-6;
  let settle = null; for (let i = f1.length - 1; i >= 0; i--) if (Math.abs(f1[i] - ss) > band) { settle = out.t[i]; break; }
  const beta = B.reduce((a, b) => a + b, 0);
  return { ...out, metrics: { nadir: f1[nadirIdx], tNadir: out.t[nadirIdx], rocof, steady: ss, settle, ssTheory: agc ? 0 : (-dPL.reduce((a, b) => a + b, 0) / beta) * f0 } };
}
