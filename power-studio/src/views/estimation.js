// State estimation view.
import { h, card, kpis, fmt, btn, paramForm, note, grid, table } from '../ui/dom.js';
import { T } from '../ui/i18n.js';
import { state } from '../ui/state.js';
import { makeMeasurements, wlsEstimate } from '../engines/estimation.js';
import { lineChart, barChart } from '../ui/charts.js';

export default {
  id: 'se', title: T('State estimation', 'تخمین حالت'), icon: '🛰️', group: T('Security', 'امنیت'),
  render(el) {
    const cs = state.cs, pf = state.pf;
    const f = paramForm([
      { key: 'sigV', label: T('σ voltage', 'σ ولتاژ'), unit: 'pu', value: 0.004 }, { key: 'sigInj', label: T('σ injections', 'σ تزریق'), unit: 'pu', value: 0.01 }, { key: 'sigFlow', label: T('σ flows', 'σ عبوری'), unit: 'pu', value: 0.008 },
      { key: 'injFrac', label: T('Share of buses with injection meters', 'سهم باس‌های دارای اندازه‌گیری تزریق'), value: 0.7 }, { key: 'flowFrac', label: T('Share of branches with flow meters', 'سهم خطوط دارای اندازه‌گیری'), value: 0.6 },
      { key: 'bad', label: T('Inject a gross error', 'افزودن داده بد'), type: 'checkbox', value: true }, { key: 'badIdx', label: T('Bad measurement index', 'شماره اندازه‌گیری بد'), value: 25 }, { key: 'badSize', label: T('Gross error size', 'اندازه خطا'), unit: 'pu', value: 0.4 }, { key: 'seed', label: T('Random seed', 'بذر تصادفی'), value: 9 },
    ]);
    const out = h('div');
    const run = () => {
      const o = f.get(), M = makeMeasurements(cs, pf, { ...o, bad: o.bad ? { index: o.badIdx, size: o.badSize } : null });
      const t = performance.now(), r = wlsEstimate(cs, M), ms = performance.now() - t;
      out.innerHTML = '';
      if (!r?.ok) { out.append(note(r?.error || T('Not converged', 'همگرا نشد'), 'bad')); return; }
      const eV = r.V.map((v, i) => Math.abs(v - pf.V[i])), eA = r.th.map((a, i) => Math.abs(a - pf.bus[i].Va));
      out.append(kpis([[T('Measurements', 'اندازه‌گیری‌ها'), M.length, ''], [T('Redundancy', 'افزونگی'), fmt(r.redundancy, 2), ''], [T('Iterations', 'تکرار'), r.iterations, ''], ['J(x)', fmt(r.J, 1), ''], ['χ² (99%)', fmt(r.chi2, 1), '', r.J <= r.chi2 ? 'ok' : 'bad'], [T('Max |V| error', 'بیشینه خطای ولتاژ'), fmt(Math.max(...eV), 5), 'pu'], [T('Max angle error', 'بیشینه خطای زاویه'), fmt(Math.max(...eA), 4), '°'], [T('Bad data removed', 'داده بد حذف‌شده'), r.removed.length, '', r.removed.length ? 'warn' : 'ok'], ['ms', fmt(ms, 0), '']]));
      if (r.removed.length) out.append(card(T('Identified bad data (largest normalised residual test)', 'داده‌های بد شناسایی‌شده (آزمون بزرگ‌ترین باقیمانده نرمال)'), table([{ key: 'label', label: T('Measurement', 'اندازه‌گیری') }, { key: 'z', label: 'z', d: 4 }, { key: 'rN', label: 'rN', d: 2 }, { fn: (m) => (m.bad ? '✔ ' + T('true gross error', 'خطای واقعی') : T('false alarm', 'هشدار کاذب')), label: T('Ground truth', 'واقعیت') }], r.removed)));
      const a = h('div'), b = h('div');
      out.append(grid(card(T('Estimated vs true voltage', 'ولتاژ تخمینی و واقعی'), a), card(T('Normalised residuals (after cleaning)', 'باقیمانده‌های نرمال'), b)));
      lineChart(a, { series: [{ x: cs.bus.map((x) => x.id), y: Array.from(pf.V), name: T('true', 'واقعی') }, { x: cs.bus.map((x) => x.id), y: r.V, name: T('estimated', 'تخمینی'), points: true }], xLabel: T('bus', 'باس'), yLabel: '|V| pu', height: 240 });
      barChart(b, { labels: r.M.map((_, i) => i), values: r.rN, colors: (v) => (v > 3 ? '#e35d6a' : '#4f9dff'), hlines: [{ y: 3 }], height: 240 });
    };
    el.append(card(T('AC weighted-least-squares estimator (Gauss–Newton) with bad-data processing', 'تخمین‌گر حداقل مربعات وزن‌دار AC با پردازش داده بد'), f.el, btn(T('Estimate', 'تخمین'), run)), out,
      note(T('Measurements are synthesised from the converged power flow with Gaussian noise. Detection: J(x) > χ²(m−n, 0.99); identification: largest normalised residual rN = |r|/√Ωii > 3 with Ω = R − H G⁻¹ Hᵀ, removed iteratively.', 'اندازه‌گیری‌ها از پخش بار با نویز گوسی ساخته می‌شوند. آشکارسازی با آزمون χ² و شناسایی با بزرگ‌ترین باقیمانده نرمال‌شده.')));
    run();
  },
};
