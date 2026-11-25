// N-1 contingency analysis (full AC) with performance indices, and fast DC screening via LODF.
import { runPowerFlow } from './powerflow.js';
import { islands } from './network.js';
import { ptdf, lodf, dcPowerFlow } from './dcflow.js';

export function nMinus1(cs, base, { includeGens = true, piExp = 2 } = {}) {
  const res = [];
  const evalCase = (label, kind, idx, opts) => {
    if (kind === 'branch' && islands(cs, opts.outages).count > 1) { res.push({ label, kind, idx, islanding: true, severity: Infinity }); return; }
    const r = runPowerFlow(cs, { ...opts, init: { V: base.V, th: base.th }, maxIter: 25 });
    if (!r.converged) { res.push({ label, kind, idx, diverged: true, severity: Infinity }); return; }
    const over = r.branch.map((b, k) => ({ k, loading: b.loading })).filter((x) => x.loading > 100);
    const vv = r.bus.filter((b) => b.vViol);
    let PI = 0;
    r.branch.forEach((b) => { if (b.on && b.loading > 0) PI += (b.loading / 100) ** (2 * piExp); });
    r.bus.forEach((b, i) => { if (b.type === 4) return; const lim = 0.05; PI += ((b.Vm - 1) / lim) ** (2 * piExp) / 10; void i; });
    res.push({ label, kind, idx, converged: true, maxLoading: r.maxLoading, Vmin: r.Vmin, Vmax: r.Vmax, overloads: over, vViol: vv.map((b) => b.id), PI, severity: PI, loss: r.lossP });
  };
  cs.branch.forEach((br, k) => { if (br.status) evalCase(`خط ${br.from}–${br.to}`, 'branch', k, { outages: new Set([k]) }); });
  if (includeGens) cs.gen.forEach((g, k) => { if (g.status > 0 && k !== -1) evalCase(`ژنراتور باس ${g.bus}`, 'gen', k, { outGens: new Set([k]) }); });
  return res.sort((a, b) => b.severity - a.severity);
}

export function dcScreening(cs) {
  const base = dcPowerFlow(cs), { H } = ptdf(cs), L = lodf(cs, H);
  const out = [];
  cs.branch.forEach((brk, k) => {
    if (!brk.status) return;
    let worst = 0, worstL = -1;
    cs.branch.forEach((brl, l) => {
      if (l === k || !brl.rateA || !Number.isFinite(L[l][k])) return;
      const post = base.flows[l].P + L[l][k] * base.flows[k].P, ld = (100 * Math.abs(post)) / brl.rateA;
      if (ld > worst) { worst = ld; worstL = l; }
    });
    out.push({ k, label: `${brk.from}–${brk.to}`, worst, worstL, radial: cs.branch.some((_, l) => !Number.isFinite(L[l][k])) });
  });
  return out.sort((a, b) => b.worst - a.worst);
}
