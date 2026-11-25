// Stochastic resources & probabilistic reliability:
//  • wind: Weibull speeds with AR(1) temporal correlation + diurnal shape, IEC-like power curve
//  • solar PV: sun position, Haurwitz clear-sky GHI, Markov cloud index, cell temperature, inverter clipping
//  • sequential Monte-Carlo generation adequacy (two-state Markov units, MTTF/MTTR, renewables, storage)
//  • non-sequential Monte-Carlo composite (generation + transmission) reliability with DC-OPF load shedding
import { ptdf } from './dcflow.js';
import { islands, indexCase, cloneCase } from './network.js';
import { qpSolve } from '../lib/linalg.js';
import { syntheticLoad } from './reliability.js';

export function rng(seed = 12345) {
  let s = seed >>> 0 || 1;
  const u = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return (s + 0.5) / 4294967296; };
  const n = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  return { u, n, exp: (m) => -m * Math.log(u()) };
}
const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }

export function windPowerCurve(v, { vin = 3, vr = 12, vout = 25 } = {}) { if (v < vin || v >= vout) return 0; if (v >= vr) return 1; return (v ** 3 - vin ** 3) / (vr ** 3 - vin ** 3); }

/** Hourly wind speed & per-unit power. */
export function windSeries(hours, { k = 2.0, c = 8.5, rho = 0.9, diurnal = 0.12, hubScale = 1, seed = 7, curve = {} } = {}) {
  const r = rng(seed), v = new Float64Array(hours), p = new Float64Array(hours); let z = r.n();
  for (let h = 0; h < hours; h++) {
    z = rho * z + Math.sqrt(1 - rho * rho) * r.n();
    const U = Math.min(1 - 1e-12, Math.max(1e-12, Phi(z)));
    const w = c * (-Math.log(1 - U)) ** (1 / k) * hubScale * (1 + diurnal * Math.cos((2 * Math.PI * ((h % 24) - 15)) / 24));
    v[h] = w; p[h] = windPowerCurve(w, curve);
  }
  return { v, p, cf: p.reduce((a, b) => a + b, 0) / hours };
}

/** Hourly PV per-unit AC output for a site. */
export function solarSeries(hours, { lat = 32, tilt = 0, NOCT = 45, gamma = -0.004, dcac = 1.25, Tamb = 22, Tswing = 9, clear = 0.75, seed = 11, startDay = 0 } = {}) {
  const r = rng(seed), out = new Float64Array(hours), ghi = new Float64Array(hours), phi = (lat * Math.PI) / 180;
  let cloudy = false, kc = 1;
  for (let h = 0; h < hours; h++) {
    const day = startDay + Math.floor(h / 24), hr = (h % 24) + 0.5;
    const dec = ((23.45 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + day)) / 365), H = ((hr - 12) * 15 * Math.PI) / 180;
    const cz = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
    if (h % 3 === 0) { if (r.u() < (cloudy ? 0.3 : 0.08 * (1.2 - clear))) cloudy = !cloudy; kc = cloudy ? 0.2 + 0.5 * r.u() : 0.85 + 0.15 * r.u(); }
    const G = cz > 0 ? 1098 * cz * Math.exp(-0.057 / cz) * kc : 0; ghi[h] = G;
    const Ta = Tamb + Tswing * Math.sin((2 * Math.PI * (hr - 9)) / 24) + 6 * Math.sin((2 * Math.PI * (day - 110)) / 365);
    const Tc = Ta + ((NOCT - 20) / 800) * G;
    const pdc = (G / 1000) * (1 + gamma * (Tc - 25)) * dcac * 0.97;
    out[h] = Math.min(1, pdc * 0.98);
  }
  return { p: out, ghi, cf: out.reduce((a, b) => a + b, 0) / hours };
}

/**
 * Sequential MC adequacy. units: [{cap, MTTF, MTTR}] (hours); renew: [{cap, p: Float64Array}]; storage {E, P, eta}.
 */
export function sequentialMC(units, peak, { years = 50, renew = [], storage = null, seed = 3, hours = 8760, tol = 0.05 } = {}) {
  const r = rng(seed), load = syntheticLoad(hours, peak);
  const lole = [], eens = [], lolf = [];
  for (let y = 0; y < years; y++) {
    const up = units.map(() => true), next = units.map((u) => r.exp(u.MTTF));
    let soc = storage ? storage.E * 0.5 : 0, LOLE = 0, EENS = 0, events = 0, inDef = false;
    for (let h = 0; h < hours; h++) {
      let cap = 0;
      units.forEach((u, i) => { while (next[i] <= h) { up[i] = !up[i]; next[i] += r.exp(up[i] ? u.MTTF : u.MTTR); } if (up[i]) cap += u.cap; });
      renew.forEach((rn) => { cap += rn.cap * rn.p[h % rn.p.length]; });
      let margin = cap - load[h];
      if (storage) {
        if (margin > 0) { const ch = Math.min(margin, storage.P, (storage.E - soc) / storage.eta); soc += ch * storage.eta; }
        else { const dis = Math.min(-margin, storage.P, soc); soc -= dis; margin += dis; }
      }
      if (margin < -1e-9) { LOLE++; EENS -= margin; if (!inDef) events++; inDef = true; } else inDef = false;
    }
    lole.push(LOLE); eens.push(EENS); lolf.push(events);
    if (y >= 20) { const m = mean(eens), sd = std(eens); if (m > 0 && sd / Math.sqrt(eens.length) / m < tol) break; }
  }
  const N = lole.length, m = mean(eens);
  return { years: N, LOLE: mean(lole), EENS: m, LOLF: mean(lolf), cov: m ? std(eens) / Math.sqrt(N) / m : 0, ci95: [m - 1.96 * std(eens) / Math.sqrt(N), m + 1.96 * std(eens) / Math.sqrt(N)], perYear: { lole, eens } };
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };

/** Minimum load shedding by DC-OPF for a given outage state (generators off, branches out). */
export function minLoadShed(cs, { genOut = new Set(), brOut = new Set(), loadScale = 1 } = {}) {
  const c2 = cloneCase(cs);
  c2.gen.forEach((g, k) => { if (genOut.has(k)) g.status = 0; });
  c2.branch.forEach((b, k) => { if (brOut.has(k)) b.status = 0; });
  const isl = islands(c2), idx = indexCase(c2), n = c2.bus.length;
  let shedTotal = 0; const shedBus = new Float64Array(n);
  for (let ci = 0; ci < isl.count; ci++) {
    const buses = [...Array(n).keys()].filter((i) => isl.comp[i] === ci), set = new Set(buses);
    const gens = c2.gen.map((g, k) => ({ g, k })).filter(({ g }) => g.status > 0 && set.has(idx.get(g.bus)));
    const loads = buses.filter((i) => c2.bus[i].Pd > 0);
    const D = loads.reduce((s, i) => s + c2.bus[i].Pd * loadScale, 0);
    if (!gens.length) { loads.forEach((i) => { shedBus[i] += c2.bus[i].Pd * loadScale; }); shedTotal += D; continue; }
    const cap = gens.reduce((s, o) => s + o.g.Pmax, 0);
    const lines = c2.branch.map((b, l) => ({ b, l })).filter(({ b }) => b.status && b.rateA > 0 && set.has(idx.get(b.from)));
    if (!lines.length || buses.length < 2) { const sh = Math.max(0, D - cap); shedTotal += sh; loads.forEach((i) => { shedBus[i] += (sh * c2.bus[i].Pd * loadScale) / (D || 1); }); continue; }
    // island sub-case for PTDF
    const sub = { ...c2, bus: buses.map((i) => ({ ...c2.bus[i], type: 1 })), gen: gens.map((o) => o.g), branch: c2.branch.filter((b) => b.status && set.has(idx.get(b.from))) };
    sub.bus[buses.indexOf(idx.get(gens[0].g.bus))].type = 3;
    const H = ptdf(sub).H, sidx = indexCase(sub);
    const ng = gens.length, nd = loads.length, nv = ng + nd;
    const Hq = Array.from({ length: nv }, (_, i) => { const r = new Float64Array(nv); r[i] = 1e-6; return r; });
    const c = Float64Array.from({ length: nv }, (_, i) => (i < ng ? 1 : 1000));
    const G = [], h = [];
    const push = (r, u) => { G.push(r); h.push(u); };
    for (let i = 0; i < nv; i++) { const r = new Float64Array(nv); r[i] = 1; push(r, i < ng ? gens[i].g.Pmax : c2.bus[loads[i - ng]].Pd * loadScale); const r2 = new Float64Array(nv); r2[i] = -1; push(r2, 0); }
    const PdSub = sub.bus.map((b) => b.Pd * loadScale);
    sub.branch.forEach((b, l) => {
      if (!(b.rateA > 0)) return; const hl = H[l];
      const row = new Float64Array(nv);
      gens.forEach((o, i) => { row[i] = hl[sidx.get(o.g.bus)]; });
      loads.forEach((bi, j) => { row[ng + j] = hl[sidx.get(c2.bus[bi].id)]; }); // shedding = reduction of withdrawal
      const f0 = -PdSub.reduce((s, p, j) => s + hl[j] * p, 0);
      push(row, b.rateA - f0); push(row.map((v) => -v), b.rateA + f0);
    });
    const sol = qpSolve({ H: Hq, c, Aeq: [Float64Array.from({ length: nv }, () => 1)], beq: [D], G, h }, { maxIter: 120 });
    if (!sol.converged) { const sh = Math.max(0, D - cap); shedTotal += sh; continue; }
    for (let j = 0; j < nd; j++) { const sh = Math.max(0, sol.x[ng + j]); shedBus[loads[j]] += sh; shedTotal += sh; }
  }
  return { shed: shedTotal, shedBus };
}

/** Non-sequential MC composite reliability (state sampling). Line unavailability U from λ, r. */
export function compositeMC(cs, { samples = 3000, genFOR = 0.04, lineU = 0.002, seed = 5, loadLevels = [1, 0.85, 0.7], levelProb = [0.15, 0.5, 0.35] } = {}) {
  const r = rng(seed), n = cs.bus.length, cache = new Map();
  let lolp = 0, eens = 0; const busE = new Float64Array(n); let evaluated = 0;
  for (let s = 0; s < samples; s++) {
    const genOut = new Set(), brOut = new Set();
    cs.gen.forEach((g, k) => { if (g.status > 0 && r.u() < (g.FOR ?? genFOR)) genOut.add(k); });
    cs.branch.forEach((b, k) => { if (b.status && r.u() < lineU) brOut.add(k); });
    const u = r.u(); let li = 0, acc = levelProb[0]; while (u > acc && li < levelProb.length - 1) acc += levelProb[++li];
    const key = [...genOut].join(',') + '|' + [...brOut].join(',') + '|' + li;
    let res = cache.get(key);
    if (!res) { res = (genOut.size || brOut.size || li === 0) ? minLoadShed(cs, { genOut, brOut, loadScale: loadLevels[li] }) : { shed: 0, shedBus: new Float64Array(n) }; cache.set(key, res); evaluated++; }
    if (res.shed > 1e-3) { lolp++; eens += res.shed; res.shedBus.forEach((v, i) => { busE[i] += v; }); }
  }
  return { LOLP: lolp / samples, EENS_MWh: (eens / samples) * 8760, LOLE_h: (lolp / samples) * 8760, busEENS: Array.from(busE, (v) => (v / samples) * 8760), states: evaluated, samples };
}
