// Economic dispatch (λ-iteration), DC-OPF with LMPs, priority-list unit commitment.
import { h, card, kpis, fmt, btn, paramForm, note, table, grid } from '../ui/dom.js';
import { state } from '../ui/state.js';
import { lambdaDispatch, dcOpf, priorityListUC } from '../engines/dispatch.js';
import { lineChart, barChart, PALETTE } from '../ui/charts.js';
import { heatCss } from '../ui/layout.js';
import { mount3D } from '../ui/three-mount.js';

export const ed = {
  id: 'ed', title: 'دیسپاچ اقتصادی و UC', icon: '💰', group: 'بهره‌برداری',
  render(el) {
    const cs = state.cs, gens = cs.gen.filter((g) => g.status > 0);
    const D0 = cs.bus.reduce((s, b) => s + b.Pd, 0);
    const f = paramForm([{ key: 'D', label: 'تقاضا', unit: 'MW', value: Math.round(D0) }, { key: 'loss', label: 'تلفات با ضرایب B (تقریبی)', type: 'checkbox', value: false }, { key: 'B', label: 'ضریب Bii یکنواخت', unit: '1/MW', value: 0.00003 }]);
    const out = h('div');
    const run = () => {
      const o = f.get(), n = gens.length;
      const B = o.loss ? Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? o.B : o.B * 0.1))) : null;
      const r = lambdaDispatch(gens, o.D, { B });
      out.innerHTML = '';
      out.append(kpis([['λ (هزینه نهایی سیستم)', fmt(r.lambda, 4), '$/MWh'], ['هزینه کل', fmt(r.totalCost, 1), '$/h'], ['تلفات', fmt(r.loss, 2), 'MW'], ['تولید کل', fmt(r.P.reduce((a, b) => a + b, 0), 1), 'MW']]));
      const c1 = h('div'), c2 = h('div');
      out.append(grid(card('توزیع تولید', c1), card('منحنی هزینه نهایی واحدها و λ', c2)));
      barChart(c1, { labels: gens.map((g) => 'G@' + g.bus), series: [{ values: r.P, name: 'P', color: '#4f9dff' }, { values: gens.map((g) => g.Pmax), name: 'Pmax', color: '#3a465e' }], height: 260, yLabel: 'MW' });
      lineChart(c2, { series: gens.map((g, i) => { const x = [], y = []; for (let p = g.Pmin; p <= g.Pmax; p += (g.Pmax - g.Pmin) / 30 || 1) { x.push(p); y.push(2 * g.cost[0] * p + g.cost[1]); } return { x, y, name: 'G@' + g.bus }; }), hlines: [{ y: r.lambda, label: 'λ' }], xLabel: 'P [MW]', yLabel: 'dC/dP [$/MWh]', height: 260 });
      out.append(card('جزئیات', table([{ fn: (_, i) => 'G@' + gens[i].bus, label: 'واحد' }, { fn: (_, i) => r.P[i], label: 'P [MW]', d: 2 }, { fn: (_, i) => r.ic[i], label: 'IC', d: 4 }, { fn: (_, i) => `${gens[i].Pmin}–${gens[i].Pmax}`, label: 'محدوده' }, { fn: (_, i) => gens[i].cost.join(' / '), label: 'a / b / c' }], gens)));
      // UC
      const prof = Array.from({ length: 24 }, (_, hh) => o.D * (0.62 + 0.3 * Math.exp(-((hh - 19) ** 2) / 12) + 0.12 * Math.exp(-((hh - 11) ** 2) / 8)));
      const uc = priorityListUC(gens, prof, 0.1);
      const c3 = h('div'), c4 = h('div');
      out.append(grid(card('تعهد واحد (فهرست اولویت، 24 ساعت)', c3), card('λ ساعتی', c4)));
      barChart(c3, { labels: prof.map((_, i) => i), series: gens.map((g, i) => ({ values: uc.schedule.map((s) => s.P[i]), name: 'G@' + g.bus, color: PALETTE[i % 12] })), height: 260, yLabel: 'MW', xLabel: 'ساعت' });
      lineChart(c4, { series: [{ x: prof.map((_, i) => i), y: uc.schedule.map((s) => s.lambda), name: 'λ' }, { x: prof.map((_, i) => i), y: prof.map((p) => p / 100), name: 'بار/100', dash: '4 3' }], height: 260, xLabel: 'ساعت' });
      out.append(note(`هزینه کل روزانه ≈ ${fmt(uc.total, 0)} $ . ترتیب اولویت بر اساس هزینه متوسط بار کامل: ${uc.order.map((i) => 'G@' + gens[i].bus).join(' ← ')}`));
    };
    el.append(card('دیسپاچ اقتصادی λ-iteration', f.el, btn('حل', run)), out);
    run();
  },
};

export const opf = {
  id: 'opf', title: 'OPF و قیمت گرهی (LMP)', icon: '🏷️', group: 'بهره‌برداری',
  async render(el) {
    const cs = state.cs;
    const f = paramForm([{ key: 'limits', label: 'اعمال محدودیت خطوط', type: 'checkbox', value: true }, { key: 'scale', label: 'ضریب ظرفیت خطوط', value: cs.name === 'case39' ? 0.7 : 1, step: 0.05 }]);
    const out = h('div'), v3 = h('div', { class: 'v3d-mid' });
    let net = null;
    const run = () => {
      const o = f.get();
      if (!cs.branch.some((b) => b.rateA > 0) && o.limits) out.prepend(note('این شبکه رِیت خط ندارد؛ OPF بدون قید شبکه حل می‌شود.'));
      const r = dcOpf(cs, { useLimits: o.limits, limitScale: o.scale });
      out.innerHTML = '';
      if (!r.converged) out.append(note('حل‌کننده QP همگرا نشد (احتمالاً مسئله نشدنی است؛ ضریب ظرفیت را افزایش دهید).', 'bad'));
      const lmin = Math.min(...r.lmp), lmax = Math.max(...r.lmp);
      out.append(kpis([['هزینه کل', fmt(r.totalCost, 2), '$/h'], ['λ سیستم', fmt(r.lambda, 3), '$/MWh'], ['LMP کمینه', fmt(lmin, 3), ''], ['LMP بیشینه', fmt(lmax, 3), ''], ['خطوط محدودکننده', r.flows.filter((x) => x.binding).length, '', r.flows.some((x) => x.binding) ? 'warn' : 'ok'], ['تکرار IPM', r.iterations, '']]));
      const c1 = h('div'), c2 = h('div');
      out.append(grid(card('LMP باس‌ها', c1), card('تولید بهینه', c2)));
      barChart(c1, { labels: cs.bus.map((b) => b.id), values: r.lmp, colors: (v) => heatCss((v - lmin) / (lmax - lmin || 1)), height: 250, yLabel: '$/MWh', yMin: Math.min(0, lmin) });
      barChart(c2, { labels: cs.gen.map((g) => 'G@' + g.bus), series: [{ values: r.Pg, name: 'Pg', color: '#3ccf91' }, { values: cs.gen.map((g) => g.Pmax), name: 'Pmax', color: '#3a465e' }], height: 250 });
      out.append(card('خطوط محدودکننده', table([{ fn: (x) => `${cs.branch[x.k].from}-${cs.branch[x.k].to}`, label: 'خط' }, { key: 'P', label: 'P MW', d: 1 }, { key: 'loading', label: 'بار %', d: 1 }, { key: 'mu', label: 'μ (قیمت سایه)', d: 4 }], r.flows.map((x, k) => ({ ...x, k })).filter((x) => x.binding || x.loading > 95))));
      out.append(note('DC-OPF با هزینه درجه دو، به روش نقطه درونی اولیه-دوگان حل می‌شود. LMP_i = λ − Σ_l μ_l·PTDF_l,i  (مؤلفه انرژی + ازدحام؛ تلفات در مدل DC صفر است).'));
      net?.build(cs, null, { busValues: { values: r.lmp, lo: lmin, hi: lmax }, branchValues: r.flows.map((x) => Math.min(1, x.loading / 100)) });
    };
    el.append(card('DC Optimal Power Flow', f.el, btn('حل OPF', run)), out, card('نقشه سه‌بعدی قیمت گرهی (رنگ باس = LMP، رنگ خط = بارگذاری)', v3));
    run();
    net = await mount3D(v3, '../three/network3d.js', 'Network3D', {});
    if (net) { net.opts.particles = false; net.opts.height = 'flat'; run(); }
    return () => net?.dispose();
  },
};
