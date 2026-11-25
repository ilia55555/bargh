// Radial distribution: backward/forward sweep load flow, DG & capacitor siting scans.
import { indexCase } from './network.js';

export function radialTree(cs) {
  const idx = indexCase(cs), n = cs.bus.length, parent = new Int32Array(n).fill(-1), pbr = new Int32Array(n).fill(-1);
  const adj = Array.from({ length: n }, () => []);
  cs.branch.forEach((br, k) => { if (!br.status) return; const f = idx.get(br.from), t = idx.get(br.to); adj[f].push([t, k]); adj[t].push([f, k]); });
  const root = cs.bus.findIndex((b) => b.type === 3), order = [root], seen = new Set([root]);
  for (let q = 0; q < order.length; q++) for (const [v, k] of adj[order[q]]) if (!seen.has(v)) { seen.add(v); parent[v] = order[q]; pbr[v] = k; order.push(v); }
  if (order.length !== n) throw new Error('Network is not connected');
  if (cs.branch.filter((b) => b.status).length !== n - 1) throw new Error('Network is meshed: BFS requires a radial feeder');
  return { root, order, parent, pbr };
}

/** Backward/forward sweep. extra: {P:{busIdx:MW}, Q:{busIdx:Mvar}} injections (DG/capacitors). */
export function bfsLoadFlow(cs, { tol = 1e-9, maxIter = 100, extra = {}, loadScale = 1 } = {}) {
  const { root, order, parent, pbr } = radialTree(cs), n = cs.bus.length, base = cs.baseMVA;
  const Vr = new Float64Array(n).fill(1), Vi = new Float64Array(n);
  const V0 = cs.gen[0]?.Vg ?? 1; Vr[root] = V0;
  const Sl = cs.bus.map((b, i) => ({ P: (b.Pd * loadScale - (extra.P?.[i] || 0)) / base, Q: (b.Qd * loadScale - (extra.Q?.[i] || 0)) / base }));
  let it = 0, err = 1;
  const Jr = new Float64Array(n), Ji = new Float64Array(n), Ibr = new Float64Array(n), Ibi = new Float64Array(n);
  while (it < maxIter && err > tol) {
    it++;
    // load currents I = conj(S/V)
    for (let i = 0; i < n; i++) { const d = Vr[i] ** 2 + Vi[i] ** 2; Jr[i] = (Sl[i].P * Vr[i] + Sl[i].Q * Vi[i]) / d; Ji[i] = (Sl[i].P * Vi[i] - Sl[i].Q * Vr[i]) / d; }
    // backward sweep: branch currents
    Ibr.fill(0); Ibi.fill(0);
    for (let q = order.length - 1; q > 0; q--) { const v = order[q]; Ibr[v] += Jr[v]; Ibi[v] += Ji[v]; const p = parent[v]; Ibr[p] += Ibr[v]; Ibi[p] += Ibi[v]; }
    // forward sweep: voltages
    err = 0;
    for (let q = 1; q < order.length; q++) {
      const v = order[q], p = parent[v], br = cs.branch[pbr[v]];
      const nr = Vr[p] - (br.r * Ibr[v] - br.x * Ibi[v]), ni = Vi[p] - (br.r * Ibi[v] + br.x * Ibr[v]);
      err = Math.max(err, Math.hypot(nr - Vr[v], ni - Vi[v])); Vr[v] = nr; Vi[v] = ni;
    }
  }
  let loss = 0, lossQ = 0;
  const branchLoss = cs.branch.map(() => 0);
  for (let q = 1; q < order.length; q++) { const v = order[q], br = cs.branch[pbr[v]], I2 = Ibr[v] ** 2 + Ibi[v] ** 2; branchLoss[pbr[v]] = br.r * I2 * base * 1000; loss += br.r * I2; lossQ += br.x * I2; }
  const V = Array.from(Vr, (x, i) => Math.hypot(x, Vi[i]));
  return { V, Va: Array.from(Vr, (x, i) => (Math.atan2(Vi[i], x) * 180) / Math.PI), iterations: it, lossKW: loss * base * 1000, lossKvar: lossQ * base * 1000, branchLoss, Vmin: Math.min(...V), VminBus: cs.bus[V.indexOf(Math.min(...V))].id, VSI: vsi(cs, V, order, parent, pbr, Sl) };
}
// Voltage stability index (Chakravorty & Das) for each receiving node.
function vsi(cs, V, order, parent, pbr) {
  const out = new Array(V.length).fill(null), n = V.length;
  // downstream load per node
  const Pdn = new Float64Array(n), Qdn = new Float64Array(n);
  cs.bus.forEach((b, i) => { Pdn[i] = b.Pd / cs.baseMVA; Qdn[i] = b.Qd / cs.baseMVA; });
  for (let q = order.length - 1; q > 0; q--) { const v = order[q], p = parent[v]; Pdn[p] += Pdn[v]; Qdn[p] += Qdn[v]; }
  for (let q = 1; q < order.length; q++) {
    const v = order[q], p = parent[v], br = cs.branch[pbr[v]], P = Pdn[v], Q = Qdn[v];
    out[v] = V[p] ** 4 - 4 * (P * br.x - Q * br.r) ** 2 - 4 * (P * br.r + Q * br.x) * V[p] ** 2;
  }
  return out;
}

/** Scan every bus for the DG size (unity pf) minimising losses. */
export function dgPlacement(cs, { sizes = null, pf = 1 } = {}) {
  const total = cs.bus.reduce((s, b) => s + b.Pd, 0);
  const S = sizes || Array.from({ length: 30 }, (_, i) => ((i + 1) / 30) * total);
  const base = bfsLoadFlow(cs).lossKW;
  const tanphi = pf >= 1 ? 0 : Math.tan(Math.acos(pf));
  const res = cs.bus.map((b, i) => {
    if (b.type === 3) return null;
    let best = { size: 0, loss: base };
    for (const s of S) { const r = bfsLoadFlow(cs, { extra: { P: { [i]: s }, Q: { [i]: s * tanphi } } }); if (r.lossKW < best.loss) best = { size: s, loss: r.lossKW, Vmin: r.Vmin }; }
    return { id: b.id, ...best, reduction: (100 * (base - best.loss)) / base };
  }).filter(Boolean).sort((a, b) => a.loss - b.loss);
  return { base, ranking: res };
}
export function capacitorPlacement(cs, { sizes = null } = {}) {
  const totalQ = cs.bus.reduce((s, b) => s + b.Qd, 0);
  const S = sizes || Array.from({ length: 24 }, (_, i) => ((i + 1) / 24) * totalQ);
  const base = bfsLoadFlow(cs).lossKW;
  return {
    base,
    ranking: cs.bus.map((b, i) => {
      if (b.type === 3) return null;
      let best = { size: 0, loss: base };
      for (const s of S) { const r = bfsLoadFlow(cs, { extra: { Q: { [i]: s } } }); if (r.lossKW < best.loss) best = { size: s, loss: r.lossKW, Vmin: r.Vmin }; }
      return { id: b.id, ...best, reduction: (100 * (base - best.loss)) / base };
    }).filter(Boolean).sort((a, b) => a.loss - b.loss),
  };
}
