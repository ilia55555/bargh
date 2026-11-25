// Network model: indexing, admittance matrix (MATPOWER π-model with off-nominal taps
// and phase shifters), connectivity checks.
import { zeros } from '../lib/linalg.js';

export function indexCase(cs) {
  const idx = new Map();
  cs.bus.forEach((b, i) => idx.set(b.id, i));
  return idx;
}

export function branchAdmittance(br) {
  const zr = br.r, zx = br.x, d = zr * zr + zx * zx;
  const ysr = zr / d, ysi = -zx / d; // Ys = 1/(r+jx)
  const t = br.ratio || 1, sh = ((br.angle || 0) * Math.PI) / 180;
  const tr = t * Math.cos(sh), ti = t * Math.sin(sh); // tap = t∠shift
  const bc = br.b / 2;
  // Ytt = Ys + j bc ; Yff = Ytt / t^2 ; Yft = -Ys / conj(tap) ; Ytf = -Ys / tap
  const ytt = [ysr, ysi + bc];
  const yff = [ytt[0] / (t * t), ytt[1] / (t * t)];
  const dd = tr * tr + ti * ti;
  // -Ys / conj(tap) = -Ys * tap / |tap|^2
  const yft = [-(ysr * tr - ysi * ti) / dd, -(ysr * ti + ysi * tr) / dd];
  // -Ys / tap = -Ys * conj(tap) / |tap|^2
  const ytf = [-(ysr * tr + ysi * ti) / dd, -(ysi * tr - ysr * ti) / dd];
  return { yff, yft, ytf, ytt };
}

/** Build dense Ybus = G + jB. opts.outages: Set of branch indices removed. */
export function makeYbus(cs, opts = {}) {
  const n = cs.bus.length, idx = indexCase(cs), G = zeros(n), B = zeros(n);
  const out = opts.outages || new Set();
  const adm = [];
  cs.branch.forEach((br, k) => {
    if (!br.status || out.has(k)) { adm.push(null); return; }
    const f = idx.get(br.from), t = idx.get(br.to), a = branchAdmittance(br);
    adm.push({ f, t, ...a });
    G[f][f] += a.yff[0]; B[f][f] += a.yff[1];
    G[t][t] += a.ytt[0]; B[t][t] += a.ytt[1];
    G[f][t] += a.yft[0]; B[f][t] += a.yft[1];
    G[t][f] += a.ytf[0]; B[t][f] += a.ytf[1];
  });
  cs.bus.forEach((b, i) => { G[i][i] += (b.Gs || 0) / cs.baseMVA; B[i][i] += (b.Bs || 0) / cs.baseMVA; });
  return { G, B, n, idx, adm };
}

/** Connected components (by bus index) given branch outage set. */
export function islands(cs, outages = new Set()) {
  const n = cs.bus.length, idx = indexCase(cs), adj = Array.from({ length: n }, () => []);
  cs.branch.forEach((br, k) => {
    if (!br.status || outages.has(k)) return;
    const f = idx.get(br.from), t = idx.get(br.to); adj[f].push(t); adj[t].push(f);
  });
  const comp = new Int32Array(n).fill(-1); let c = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    const st = [s]; comp[s] = c;
    while (st.length) { const u = st.pop(); for (const v of adj[u]) if (comp[v] < 0) { comp[v] = c; st.push(v); } }
    c++;
  }
  return { comp, count: c };
}

export function cloneCase(cs) { return JSON.parse(JSON.stringify(cs)); }

export function caseSummary(cs) {
  const Pd = cs.bus.reduce((s, b) => s + b.Pd, 0), Qd = cs.bus.reduce((s, b) => s + b.Qd, 0);
  const on = cs.gen.filter((g) => g.status > 0);
  return {
    buses: cs.bus.length, branches: cs.branch.length, gens: on.length,
    transformers: cs.branch.filter((b) => b.ratio && b.ratio !== 0).length,
    Pd, Qd, Pcap: on.reduce((s, g) => s + g.Pmax, 0),
  };
}
