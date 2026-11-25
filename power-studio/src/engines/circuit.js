// Circuit simulator for the 3D circuit builder: modified nodal analysis (DC, AC phasor),
// frequency sweep and time-domain transient (backward-Euler companion models).
// Component: {id, type:'R'|'L'|'C'|'V'|'I'|'W'|'S'|'LAMP'|'GND', a:[x,z], b:[x,z], value, ac, phase, closed}
// Units: Ω, H, F, V (rms for AC), A. Sources: a = + terminal, b = − terminal.
import { solve, csolveMat, zeros } from '../lib/linalg.js';

const key = (p) => `${p[0]},${p[1]}`;
// rating: R → W, LAMP → rated W at 230 V, C → V (electrolytic, polarised in DC), L/W/S/V/I → A
export const TYPES = {
  R: { label: 'مقاومت', unit: 'Ω', def: 100, rating: 0.5, rUnit: 'W', tau: 3, ambient: 25 },
  L: { label: 'سلف', unit: 'H', def: 0.1, rating: 5, rUnit: 'A', tau: 4 },
  C: { label: 'خازن الکترولیتی', unit: 'F', def: 100e-6, rating: 50, rUnit: 'V', tau: 1.5 },
  V: { label: 'منبع ولتاژ', unit: 'V', def: 230, rating: 63, rUnit: 'A', tau: 1 },
  I: { label: 'منبع جریان', unit: 'A', def: 1, rating: 1e3, rUnit: 'V', tau: 1 },
  W: { label: 'سیم (2.5mm²)', unit: '', def: 0, rating: 24, rUnit: 'A', tau: 6 },
  S: { label: 'کلید', unit: '', def: 0, rating: 16, rUnit: 'A', tau: 2 },
  LAMP: { label: 'لامپ رشته‌ای', unit: 'Ω', def: 529, rating: 100, rUnit: 'W', tau: 0.25 },
  GND: { label: 'زمین', unit: '', def: 0, rating: Infinity, rUnit: '', tau: 1 },
};
export const AMBIENT = 25, RATED_RISE = 100, FAIL_RISE = 260;

/**
 * Electro-thermal stress of a component (dimensionless, 1 = rated). Steady temperature rise ∝ stress.
 * Power stress for R/LAMP, I² for conductors/inductors/sources, V² (peak) for capacitors, reverse
 * polarity of electrolytic capacitors under DC → immediate overstress.
 */
export function stress(c, r, ac) {
  if (!r || c.type === 'GND') return 0;
  const rt = c.rating ?? TYPES[c.type].rating;
  switch (c.type) {
    case 'R': return Math.abs(r.P) / rt;
    case 'LAMP': return Math.abs(r.P) / rt;
    case 'C': { const vpk = r.Vm * (ac ? Math.SQRT2 : 1); if (!ac && r.V[0] < -1) return 8; if (vpk > 1.5 * rt) return 10; return (vpk / rt) ** 6; } // dielectric stress is strongly non-linear
    case 'I': return (r.Vm / rt) ** 2;
    default: return (r.Im / rt) ** 2;
  }
}
/** Advance first-order thermal model; returns true when the component fails (open circuit). */
export function thermalStep(c, s, dt) {
  const tau = TYPES[c.type].tau, Tss = AMBIENT + s * RATED_RISE;
  c.temp = (c.temp ?? AMBIENT) + ((Tss - (c.temp ?? AMBIENT)) * Math.min(1, dt / tau));
  if (!c.burnt && c.temp > AMBIENT + FAIL_RISE) { c.burnt = true; c.burnAt = Date.now(); return true; }
  return false;
}
/** Standard 4-band resistor colour code (E-series rounding to 2 significant digits). */
export function resistorBands(R) {
  const names = ['#000000', '#7b3f00', '#e00000', '#ff7a00', '#ffd400', '#00a000', '#0040ff', '#8a2be2', '#808080', '#ffffff'];
  const e = Math.floor(Math.log10(Math.max(R, 0.1))) - 1, d = Math.round(R / 10 ** e);
  const dd = d >= 100 ? 10 : d, ee = d >= 100 ? e + 1 : e;
  const mult = ee >= 0 ? names[ee] ?? '#ffffff' : ee === -1 ? '#d4af37' : '#c0c0c0';
  return [names[Math.floor(dd / 10)], names[dd % 10], mult, '#d4af37'];
}

/** Build node numbering (wires and closed switches merge nodes). */
export function topology(comps) {
  const parent = new Map(), find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
  comps.forEach((c) => { add(key(c.a)); if (c.type !== 'GND') add(key(c.b)); });
  comps.forEach((c) => { if (c.type === 'W' || (c.type === 'S' && c.closed)) { const ra = find(key(c.a)), rb = find(key(c.b)); if (ra !== rb) parent.set(ra, rb); } });
  let gnd = null;
  const g = comps.find((c) => c.type === 'GND'); if (g) gnd = find(key(g.a));
  if (!gnd) { const s = comps.find((c) => c.type === 'V' || c.type === 'I'); if (s) gnd = find(key(s.b)); }
  const roots = [...new Set([...parent.keys()].map(find))].filter((r) => r !== gnd);
  const idx = new Map(roots.map((r, i) => [r, i]));
  const node = (p) => { const r = find(key(p)); return r === gnd ? -1 : idx.get(r); };
  return { node, n: roots.length, points: [...parent.keys()], find, gnd };
}

const active = (c) => !['W', 'S', 'GND'].includes(c.type);

/** Phasor/DC solution. If any AC source exists → AC at f (DC sources zeroed), else DC. */
export function solveCircuit(allComps, { f = 50, mode = null } = {}) {
  const comps = allComps.filter((c) => !c.burnt && !(c.type === 'S' && !c.closed && false));
  const T = topology(comps), n = T.n;
  const ac = mode ? mode === 'ac' : comps.some((c) => (c.type === 'V' || c.type === 'I') && c.ac);
  const w = ac ? 2 * Math.PI * f : 0;
  const vs = comps.filter((c) => c.type === 'V');
  const N = n + vs.length, Gr = zeros(N), Gi = zeros(N), br = new Float64Array(N), bi = new Float64Array(N);
  const stamp = (p, q, yr, yi) => {
    if (p >= 0) { Gr[p][p] += yr; Gi[p][p] += yi; } if (q >= 0) { Gr[q][q] += yr; Gi[q][q] += yi; }
    if (p >= 0 && q >= 0) { Gr[p][q] -= yr; Gi[p][q] -= yi; Gr[q][p] -= yr; Gi[q][p] -= yi; }
  };
  const adm = (c) => {
    if (c.type === 'R' || c.type === 'LAMP') return [1 / Math.max(c.value, 1e-9), 0];
    if (c.type === 'C') return w ? [0, w * c.value] : [1e-12, 0];
    if (c.type === 'L') return w ? [0, -1 / (w * c.value)] : [1e6, 0];
    return [0, 0];
  };
  for (let i = 0; i < n; i++) Gr[i][i] += 1e-12; // keep floating nodes regular
  comps.forEach((c) => {
    const p = T.node(c.a), q = c.type === 'GND' ? -1 : T.node(c.b);
    if (['R', 'LAMP', 'C', 'L'].includes(c.type)) { const [yr, yi] = adm(c); stamp(p, q, yr, yi); }
    if (c.type === 'I' && !!c.ac === ac) { // current flows a→b through the source, i.e. injected into a
      const ph = ((c.phase || 0) * Math.PI) / 180, J = c.value;
      if (p >= 0) { br[p] += J * Math.cos(ph); bi[p] += J * Math.sin(ph); }
      if (q >= 0) { br[q] -= J * Math.cos(ph); bi[q] -= J * Math.sin(ph); }
    }
  });
  vs.forEach((c, k) => {
    const p = T.node(c.a), q = T.node(c.b), r = n + k;
    if (p >= 0) { Gr[p][r] += 1; Gr[r][p] += 1; } if (q >= 0) { Gr[q][r] -= 1; Gr[r][q] -= 1; }
    const E = !!c.ac === ac ? c.value : 0, ph = ((c.phase || 0) * Math.PI) / 180;
    br[r] = E * Math.cos(ph); bi[r] = E * Math.sin(ph);
  });
  let xr, xi;
  try { [xr, xi] = csolveMat(Gr, Gi, br, bi); } catch { return { ok: false, error: 'مدار تکین است (حلقه منبع ولتاژ یا اتصال کوتاه منبع)' }; }
  const V = (p) => (p < 0 ? [0, 0] : [xr[p], xi[p]]);
  const res = comps.map((c) => {
    if (c.type === 'GND') return { id: c.id, V: [0, 0], I: [0, 0] };
    const va = V(T.node(c.a)), vb = V(T.node(c.b)), v = [va[0] - vb[0], va[1] - vb[1]];
    let I = [0, 0];
    if (['R', 'LAMP', 'C', 'L'].includes(c.type)) { const [yr, yi] = adm(c); I = [yr * v[0] - yi * v[1], yr * v[1] + yi * v[0]]; }
    else if (c.type === 'V') { const k = vs.indexOf(c); I = [xr[n + k], xi[n + k]]; } // a→b through source
    else if (c.type === 'I') { const ph = ((c.phase || 0) * Math.PI) / 180; I = !!c.ac === ac ? [-c.value * Math.cos(ph), -c.value * Math.sin(ph)] : [0, 0]; }
    // S = V·conj(I) absorbed (a→b convention)
    const P = v[0] * I[0] + v[1] * I[1], Q = v[1] * I[0] - v[0] * I[1];
    return { id: c.id, V: v, I, Vm: Math.hypot(...v), Im: Math.hypot(...I), P, Q };
  });
  const nodeV = new Map(T.points.map((k) => { const p = k.split(',').map(Number), x = V(T.node(p)); return [k, x]; }));
  allComps.forEach((c) => { if (c.burnt) { const va = nodeV.get(key(c.a)) || [0, 0], vb = nodeV.get(key(c.b)) || [0, 0]; const v = [va[0] - vb[0], va[1] - vb[1]]; res.push({ id: c.id, V: v, I: [0, 0], Vm: Math.hypot(...v), Im: 0, P: 0, Q: 0, burnt: true }); } });
  return { ok: true, ac, f, w, comps: res, nodeV, byId: new Map(res.map((r) => [r.id, r])) };
}

/** Frequency sweep: impedance seen by the first AC voltage source and its current. */
export function sweep(comps, { f1 = 1, f2 = 1e5, pts = 120 } = {}) {
  const src = comps.find((c) => c.type === 'V' && c.ac);
  if (!src) return null;
  const F = [], Im = [], Z = [], ph = [];
  for (let k = 0; k < pts; k++) {
    const f = f1 * (f2 / f1) ** (k / (pts - 1)), r = solveCircuit(comps, { f, mode: 'ac' });
    if (!r.ok) continue;
    const i = r.byId.get(src.id).I, im = Math.hypot(...i);
    F.push(f); Im.push(im); Z.push(src.value / Math.max(im, 1e-15)); ph.push((Math.atan2(-i[1], -i[0]) * 180) / Math.PI);
  }
  return { f: F, I: Im, Z, phase: ph };
}

/** Transient (backward Euler). AC sources: v = √2·Vrms·sin(ωt+φ). Initial state: de-energised. */
export function transient(allComps, { f = 50, tEnd = 0.1, dt = 1e-4 } = {}) {
  const comps = allComps.filter((c) => !c.burnt);
  const T = topology(comps), n = T.n, vs = comps.filter((c) => c.type === 'V'), N = n + vs.length, w = 2 * Math.PI * f;
  allComps.filter((c) => c.burnt).forEach((c) => comps.push({ ...c, type: 'GND', a: c.a, b: c.a }));
  const st = new Map(comps.map((c) => [c.id, { v: 0, i: 0 }]));
  const out = { t: [], v: new Map(comps.map((c) => [c.id, []])), i: new Map(comps.map((c) => [c.id, []])) };
  const src = (c, t) => (c.ac ? Math.SQRT2 * c.value * Math.sin(w * t + ((c.phase || 0) * Math.PI) / 180) : c.value);
  const steps = Math.round(tEnd / dt), every = Math.max(1, Math.floor(steps / 800));
  for (let s = 1; s <= steps; s++) {
    const t = s * dt, G = zeros(N), b = new Float64Array(N);
    for (let i = 0; i < n; i++) G[i][i] += 1e-12;
    const stamp = (p, q, g) => { if (p >= 0) G[p][p] += g; if (q >= 0) G[q][q] += g; if (p >= 0 && q >= 0) { G[p][q] -= g; G[q][p] -= g; } };
    const inj = (p, q, J) => { if (p >= 0) b[p] -= J; if (q >= 0) b[q] += J; }; // current J flowing a→b inside element
    comps.forEach((c) => {
      const p = T.node(c.a), q = c.type === 'GND' ? -1 : T.node(c.b), x = st.get(c.id);
      if (c.type === 'R' || c.type === 'LAMP') stamp(p, q, 1 / c.value);
      else if (c.type === 'C') { const g = c.value / dt; stamp(p, q, g); inj(p, q, -g * x.v); }
      else if (c.type === 'L') { stamp(p, q, dt / c.value); inj(p, q, x.i); }
      else if (c.type === 'I') { inj(p, q, -src(c, t)); }
    });
    vs.forEach((c, k) => { const p = T.node(c.a), q = T.node(c.b), r = n + k; if (p >= 0) { G[p][r] += 1; G[r][p] += 1; } if (q >= 0) { G[q][r] -= 1; G[r][q] -= 1; } b[r] = src(c, t); });
    let x; try { x = solve(G, b); } catch { return null; }
    const V = (p) => (p < 0 ? 0 : x[p]);
    comps.forEach((c) => {
      if (c.type === 'GND') return;
      const v = V(T.node(c.a)) - V(T.node(c.b)), y = st.get(c.id);
      let i = 0;
      if (c.type === 'R' || c.type === 'LAMP') i = v / c.value;
      else if (c.type === 'C') i = (c.value / dt) * (v - y.v);
      else if (c.type === 'L') i = y.i + (dt / c.value) * v;
      else if (c.type === 'V') i = x[n + vs.indexOf(c)];
      else if (c.type === 'I') i = -src(c, t);
      y.v = v; y.i = i;
    });
    if (s % every === 0) { out.t.push(t); comps.forEach((c) => { const y = st.get(c.id); out.v.get(c.id).push(y.v); out.i.get(c.id).push(y.i); }); }
  }
  return out;
}

/** Ready-made circuits. */
export function preset(name) {
  let id = 0; const C = (type, a, b, value, extra = {}) => ({ id: 'c' + ++id, type, a, b, value: value ?? TYPES[type].def, ...extra });
  const P = {
    divider: [C('V', [0, 2], [0, 0], 12), C('R', [0, 2], [3, 2], 1000), C('R', [3, 2], [3, 0], 2000), C('W', [3, 0], [0, 0]), C('GND', [0, 0], [0, 0])],
    rlc: [C('V', [0, 2], [0, 0], 10, { ac: true }), C('R', [0, 2], [2, 2], 10), C('L', [2, 2], [4, 2], 0.1), C('C', [4, 2], [4, 0], 101.3e-6), C('W', [4, 0], [0, 0]), C('GND', [0, 0], [0, 0])],
    pf: [C('V', [0, 2], [0, 0], 230, { ac: true }), C('W', [0, 2], [2, 2]), C('R', [2, 2], [4, 2], 8), C('L', [4, 2], [4, 0], 0.025), C('W', [4, 0], [0, 0]), C('C', [2, 2], [2, 0], 180e-6), C('W', [2, 0], [0, 0]), C('GND', [0, 0], [0, 0])],
    rc: [C('V', [0, 2], [0, 0], 5), C('S', [0, 2], [2, 2], 0, { closed: true }), C('R', [2, 2], [4, 2], 1000), C('C', [4, 2], [4, 0], 10e-6), C('W', [4, 0], [0, 0]), C('GND', [0, 0], [0, 0])],
    lamps: [C('V', [0, 2], [0, 0], 230, { ac: true }), C('W', [0, 2], [2, 2]), C('LAMP', [2, 2], [2, 0], 529), C('W', [2, 2], [4, 2]), C('S', [4, 2], [4, 1], 0, { closed: true }), C('LAMP', [4, 1], [4, 0], 1058), C('W', [4, 0], [2, 0]), C('W', [2, 0], [0, 0]), C('GND', [0, 0], [0, 0])],
  };
  const sh = (q) => [q[0] + 3, q[1] + 4];
  const RT = { divider: { R: 0.25 }, rlc: { R: 25, L: 2, C: 63 }, pf: { R: 5000, L: 30, C: 450 }, rc: { R: 0.25, C: 16 }, lamps: { LAMP: 100 } };
  return (P[name] || P.rlc).map((c) => ({ ...c, a: sh(c.a), b: sh(c.b), rating: c.type === 'LAMP' ? 230 ** 2 / c.value : RT[name]?.[c.type] ?? TYPES[c.type].rating }));
}
export const PRESETS = [['rlc', 'RLC سری (تشدید)'], ['pf', 'اصلاح ضریب توان با خازن'], ['divider', 'تقسیم ولتاژ DC'], ['rc', 'شارژ خازن RC'], ['lamps', 'لامپ‌های موازی با کلید']];
