// PSS/E RAW (v32–v35 core sections) import & export: buses, loads, fixed shunts, generators,
// non-transformer branches and two-winding transformers.
import { prepareCase } from './cases.js';

const splitCSV = (line) => {
  const out = []; let cur = '', q = false;
  for (const ch of line.replace(/\/.*$/, (m) => (line.indexOf("'") >= 0 && line.lastIndexOf("'") > line.indexOf(m[0]) ? m : ''))) {
    if (ch === "'" || ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim()); return out;
};
const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };

export function parseRaw(text) {
  const lines = text.split(/\r?\n/);
  const head = splitCSV(lines[0]), sbase = num(head[1], 100), freq = num(head[5], 60) || 60;
  let i = 3; const sections = [];
  let cur = [];
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^0\s*(\/|$)/.test(l) || /^Q\b/.test(l)) { sections.push(cur); cur = []; if (/^Q/.test(l)) break; continue; }
    if (l) cur.push(l);
  }
  if (cur.length) sections.push(cur);
  const [busS = [], loadS = [], shuntS = [], genS = [], brS = [], xfS = []] = sections;
  const bus = busS.map((l) => { const c = splitCSV(l); return { id: num(c[0]), type: num(c[3], 1), Pd: 0, Qd: 0, Gs: 0, Bs: 0, area: num(c[4], 1), Vm: num(c[7], 1), Va: num(c[8], 0), baseKV: num(c[2]), zone: num(c[5], 1), Vmax: num(c[9], 1.1), Vmin: num(c[10], 0.9), name: c[1] }; });
  const byId = new Map(bus.map((b) => [b.id, b]));
  loadS.forEach((l) => { const c = splitCSV(l), b = byId.get(num(c[0])); if (b && num(c[2], 1)) { b.Pd += num(c[5]) + num(c[7]) + num(c[9]); b.Qd += num(c[6]) + num(c[8]) - num(c[10]); } });
  shuntS.forEach((l) => { const c = splitCSV(l), b = byId.get(num(c[0])); if (b && num(c[2], 1)) { b.Gs += num(c[3]); b.Bs += num(c[4]); } });
  const gen = genS.map((l) => { const c = splitCSV(l); return { bus: num(c[0]), Pg: num(c[2]), Qg: num(c[3]), Qmax: num(c[4], 9999), Qmin: num(c[5], -9999), Vg: num(c[6], 1), mBase: num(c[8], sbase), status: num(c[14], 1), Pmax: num(c[16], 9999), Pmin: num(c[17], 0), cost: [0.01, 20, 0], xsource: num(c[10], 0) }; });
  const branch = brS.map((l) => { const c = splitCSV(l); return { from: Math.abs(num(c[0])), to: Math.abs(num(c[1])), r: num(c[3]), x: num(c[4]), b: num(c[5]), rateA: num(c[6]), ratio: 0, angle: 0, status: num(c[13], 1) }; });
  for (let k = 0; k + 3 < xfS.length; ) {
    const a = splitCSV(xfS[k]), b2 = splitCSV(xfS[k + 1]), c3 = splitCSV(xfS[k + 2]), d4 = splitCSV(xfS[k + 3]);
    if (num(a[2]) !== 0) { k += 5; continue; } // three-winding: skip (not supported)
    const cz = num(a[5], 1), cw = num(a[4], 1), sb12 = num(b2[2], sbase);
    let r = num(b2[0]), x = num(b2[1]);
    if (cz === 2) { r *= sbase / sb12; x *= sbase / sb12; } else if (cz === 3) { const zpu = r / 1e6 / (sb12 / sbase); x = Math.sqrt(Math.max(x * x - zpu * zpu, 0)) * sbase / sb12; r = (r / 1e6) * sbase / sb12; }
    let t1 = num(c3[0], 1), t2 = num(d4[0], 1);
    if (cw === 2) { const f = byId.get(num(a[0])), t = byId.get(num(a[1])); t1 /= f?.baseKV || 1; t2 /= t?.baseKV || 1; }
    branch.push({ from: num(a[0]), to: num(a[1]), r, x, b: num(a[8], 0), rateA: num(c3[3]), ratio: t1 / t2, angle: num(c3[2]), status: num(a[11], 1) });
    k += 4;
  }
  gen.forEach((g) => { const b = byId.get(g.bus); if (b && b.type === 1) b.type = 2; });
  return prepareCase({ name: 'psse_' + (lines[1] || 'case').trim().slice(0, 20).replace(/\W+/g, '_'), baseMVA: sbase, freq, bus, gen, branch });
}

export function toRaw(cs) {
  const L = [`0, ${cs.baseMVA}, 33, 0, 1, ${cs.freq || 60}  / PSS/E RAW exported by Barghnama`, cs.name, ''];
  cs.bus.forEach((b) => L.push(`${b.id},'B${b.id}',${b.baseKV || 1},${b.type},${b.area ?? 1},${b.zone ?? 1},1,${b.Vm},${b.Va},${b.Vmax},${b.Vmin},${b.Vmax},${b.Vmin}`));
  L.push('0 / END OF BUS DATA, BEGIN LOAD DATA');
  cs.bus.forEach((b) => { if (b.Pd || b.Qd) L.push(`${b.id},'1',1,1,1,${b.Pd},${b.Qd},0,0,0,0,1,1`); });
  L.push('0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA');
  cs.bus.forEach((b) => { if (b.Gs || b.Bs) L.push(`${b.id},'1',1,${b.Gs},${b.Bs}`); });
  L.push('0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA');
  cs.gen.forEach((g) => L.push(`${g.bus},'1',${g.Pg},${g.Qg},${g.Qmax},${g.Qmin},${g.Vg},0,${g.mBase || cs.baseMVA},0,${g.xdp ?? 1},0,0,1,${g.status},100,${g.Pmax},${g.Pmin}`));
  L.push('0 / END OF GENERATOR DATA, BEGIN BRANCH DATA');
  cs.branch.forEach((r) => { if (!r.ratio) L.push(`${r.from},${r.to},'1',${r.r},${r.x},${r.b},${r.rateA},${r.rateA},${r.rateA},0,0,0,0,${r.status}`); });
  L.push('0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA');
  cs.branch.forEach((r) => { if (r.ratio) L.push(`${r.from},${r.to},0,'1',1,1,1,0,${r.b},2,'T',${r.status}`, `${r.r},${r.x},${cs.baseMVA}`, `${r.ratio},0,${r.angle},${r.rateA},${r.rateA},${r.rateA}`, '1,0'); });
  L.push('0 / END OF TRANSFORMER DATA', 'Q');
  return L.join('\n');
}
