// MATPOWER case-file parser and converter to the internal case model.
function parseMatrix(text, name) {
  const re = new RegExp(`mpc\\.${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`);
  const m = text.match(re);
  if (!m) return null;
  return m[1]
    .split(/[;\n]/)
    .map((l) => l.replace(/%.*$/, '').trim())
    .filter(Boolean)
    .map((l) => l.split(/[\s,]+/).filter(Boolean).map(Number))
    .filter((r) => r.length && r.every((v) => Number.isFinite(v)));
}
export function parseMatpower(text) {
  const base = text.match(/mpc\.baseMVA\s*=\s*([\d.eE+-]+)/);
  const nameM = text.match(/function\s+mpc\s*=\s*(\w+)/);
  const mpc = {
    name: nameM ? nameM[1] : 'imported',
    baseMVA: base ? +base[1] : 100,
    bus: parseMatrix(text, 'bus'),
    gen: parseMatrix(text, 'gen'),
    branch: parseMatrix(text, 'branch'),
    gencost: parseMatrix(text, 'gencost') || [],
  };
  if (!mpc.bus || !mpc.gen || !mpc.branch) throw new Error('Invalid MATPOWER file: bus/gen/branch missing');
  return fromMatpower(mpc);
}
export function fromMatpower(mpc, extra = {}) {
  const bus = mpc.bus.map((b) => ({
    id: b[0], type: b[1], Pd: b[2], Qd: b[3], Gs: b[4], Bs: b[5], area: b[6],
    Vm: b[7] || 1, Va: b[8] || 0, baseKV: b[9] || 0, zone: b[10], Vmax: b[11] ?? 1.1, Vmin: b[12] ?? 0.9,
  }));
  const gen = mpc.gen.map((g, i) => {
    const gc = mpc.gencost?.[i];
    let cost = [0, 0, 0];
    if (gc && gc[0] === 2) {
      const nc = gc[3], co = gc.slice(4, 4 + nc);
      while (co.length < 3) co.unshift(0);
      cost = co.slice(-3); // [c2, c1, c0]
    }
    return {
      bus: g[0], Pg: g[1], Qg: g[2], Qmax: g[3], Qmin: g[4], Vg: g[5] || 1, mBase: g[6] || mpc.baseMVA,
      status: g[7] ?? 1, Pmax: g[8], Pmin: g[9] ?? 0, cost,
    };
  });
  const branch = mpc.branch.map((br) => ({
    from: br[0], to: br[1], r: br[2], x: br[3], b: br[4], rateA: br[5] || 0,
    ratio: br[8] || 0, angle: br[9] || 0, status: br[10] ?? 1,
  }));
  return { name: mpc.name, baseMVA: mpc.baseMVA, freq: extra.freq || 60, bus, gen, branch, ...extra };
}
export function toMatpower(cs) {
  const L = [];
  L.push(`function mpc = ${cs.name.replace(/\W/g, '_')}`, `mpc.version = '2';`, `mpc.baseMVA = ${cs.baseMVA};`, 'mpc.bus = [');
  cs.bus.forEach((b) => L.push(`\t${[b.id, b.type, b.Pd, b.Qd, b.Gs, b.Bs, b.area ?? 1, b.Vm, b.Va, b.baseKV, b.zone ?? 1, b.Vmax, b.Vmin].join('\t')};`));
  L.push('];', 'mpc.gen = [');
  cs.gen.forEach((g) => L.push(`\t${[g.bus, g.Pg, g.Qg, g.Qmax, g.Qmin, g.Vg, g.mBase, g.status, g.Pmax, g.Pmin].join('\t')};`));
  L.push('];', 'mpc.branch = [');
  cs.branch.forEach((r) => L.push(`\t${[r.from, r.to, r.r, r.x, r.b, r.rateA, r.rateA, r.rateA, r.ratio, r.angle, r.status, -360, 360].join('\t')};`));
  L.push('];', 'mpc.gencost = [');
  cs.gen.forEach((g) => L.push(`\t2\t0\t0\t3\t${g.cost.join('\t')};`));
  L.push('];');
  return L.join('\n');
}
