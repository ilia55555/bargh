// Deterministic graph layouts for one-line / 3D views (force-directed or radial tree).
import { indexCase } from '../engines/network.js';

export function layoutCase(cs) {
  if (cs.layout) return cs.layout;
  const n = cs.bus.length, idx = indexCase(cs);
  const edges = cs.branch.map((b) => [idx.get(b.from), idx.get(b.to)]);
  const radial = cs.radial || cs.branch.length === n - 1;
  let P;
  if (radial) P = treeLayout(n, edges, cs.bus.findIndex((b) => b.type === 3));
  else P = forceLayout(n, edges);
  // normalize to [-1, 1]
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const sx = (Math.max(...xs) - Math.min(...xs)) / 2 || 1, sy = (Math.max(...ys) - Math.min(...ys)) / 2 || 1;
  const sc = Math.max(sx, sy);
  // radial feeders are long and thin: stretch the short axis so laterals stay readable
  cs.layout = radial ? P.map(([x, y]) => [(x - cx) / sx, ((y - cy) / sy) * 0.6]) : P.map(([x, y]) => [(x - cx) / sc, (y - cy) / sc]);
  return cs.layout;
}

function treeLayout(n, edges, root) {
  const adj = Array.from({ length: n }, () => []);
  edges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
  const depth = new Array(n).fill(-1), order = [root]; depth[root] = 0;
  const kids = Array.from({ length: n }, () => []);
  for (let q = 0; q < order.length; q++) for (const v of adj[order[q]]) if (depth[v] < 0) { depth[v] = depth[order[q]] + 1; kids[order[q]].push(v); order.push(v); }
  // main feeder along x; laterals offset in y
  const P = new Array(n);
  let lane = 0;
  const place = (u, x, y) => {
    P[u] = [x, y];
    const [main, ...lat] = [...kids[u]].sort((a, b) => sub(b) - sub(a));
    lat.forEach((v) => { lane += 1; place(v, x + 1, lane * (lane % 2 ? 1 : -1) * 0.9); });
    if (main !== undefined) place(main, x + 1, y);
  };
  const memo = new Map();
  const sub = (u) => { if (memo.has(u)) return memo.get(u); const s = 1 + kids[u].reduce((a, v) => a + sub(v), 0); memo.set(u, s); return s; };
  place(root, 0, 0);
  return P.map((p) => p || [0, 0]);
}

function forceLayout(n, edges, iters = 600) {
  // seeded circle initialisation
  const P = Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n; return [Math.cos(a) + 0.01 * Math.sin(7 * i), Math.sin(a) + 0.01 * Math.cos(5 * i)]; });
  const k = Math.sqrt(4 / n);
  let temp = 0.2;
  for (let it = 0; it < iters; it++) {
    const D = P.map(() => [0, 0]);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], d = Math.hypot(dx, dy) || 1e-4;
      const f = (k * k) / d; dx /= d; dy /= d;
      D[i][0] += dx * f; D[i][1] += dy * f; D[j][0] -= dx * f; D[j][1] -= dy * f;
    }
    for (const [a, b] of edges) {
      let dx = P[a][0] - P[b][0], dy = P[a][1] - P[b][1], d = Math.hypot(dx, dy) || 1e-4;
      const f = (d * d) / k; dx /= d; dy /= d;
      D[a][0] -= dx * f; D[a][1] -= dy * f; D[b][0] += dx * f; D[b][1] += dy * f;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(D[i][0], D[i][1]) || 1e-9, s = Math.min(d, temp) / d;
      P[i][0] += D[i][0] * s; P[i][1] += D[i][1] * s;
      // weak gravity
      P[i][0] *= 0.999; P[i][1] *= 0.999;
    }
    temp = Math.max(0.002, temp * 0.993);
  }
  return P;
}

/** Diverging colour map: value in [0,1] → css colour (blue → green → yellow → red). */
export function heat(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [[0, [59, 130, 246]], [0.35, [34, 197, 94]], [0.65, [234, 179, 8]], [1, [239, 68, 68]]];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], u = (t - t0) / (t1 - t0);
    return c0.map((c, k) => Math.round(c + (c1[k] - c) * u));
  }
  return stops[stops.length - 1][1];
}
export const heatCss = (t) => `rgb(${heat(t).join(',')})`;
export const vColor = (v, lo = 0.94, hi = 1.06) => heat((v - lo) / (hi - lo));
