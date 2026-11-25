// Reliability: generation adequacy (COPT, LOLE, EENS) and distribution indices.
import { h, card, kpis, fmt, btn, paramForm, note, table, grid } from '../ui/dom.js';
import { state } from '../ui/state.js';
import { adequacy, distributionIndices } from '../engines/reliability.js';
import { lineChart } from '../ui/charts.js';

export default {
  id: 'rel', title: 'قابلیت اطمینان', icon: '📊', group: 'برنامه‌ریزی',
  render(el) {
    const cs = state.cs, gens = cs.gen.filter((g) => g.status > 0);
    const Pd = cs.bus.reduce((s, b) => s + b.Pd, 0);
    const f = paramForm([{ key: 'peak', label: 'بار پیک سالانه', unit: 'MW', value: Math.round(Pd) }, { key: 'FOR', label: 'نرخ خروج اجباری (FOR) همه واحدها', value: 0.04 }]);
    const out = h('div');
    const run = () => {
      const o = f.get();
      const units = gens.map((g) => ({ cap: g.Pmax, FOR: o.FOR }));
      const r = adequacy(units, o.peak);
      out.innerHTML = '';
      out.append(kpis([['ظرفیت نصب‌شده', fmt(r.total, 0), 'MW'], ['ذخیره', fmt((100 * (r.total - o.peak)) / o.peak, 1), '%'], ['LOLE (ساعتی)', fmt(r.LOLE_h, 3), 'h/yr', r.LOLE_h > 8 ? 'bad' : 'ok'], ['LOLE (پیک روزانه)', fmt(r.LOLE_d, 4), 'day/yr', r.LOLE_d > 0.1 ? 'warn' : 'ok'], ['EENS', fmt(r.EENS, 1), 'MWh/yr'], ['LOLP در پیک', fmt(r.LOLP_peak, 6), '']]));
      const a = h('div'), b = h('div');
      out.append(grid(card('جدول احتمال خروج ظرفیت (COPT) — احتمال تجمعی', a), card('منحنی تداوم بار سالانه (LDC)', b)));
      lineChart(a, { series: [{ x: r.table.map((t) => t.out), y: r.table.map((t) => Math.max(t.cum, 1e-16)), name: 'P(خروج ≥ X)' }], logY: true, xLabel: 'ظرفیت خارج‌شده [MW]', yLabel: 'احتمال', height: 260, vlines: [{ x: r.total - o.peak, label: 'ذخیره' }] });
      const sorted = Array.from(r.load).sort((x, y) => y - x);
      lineChart(b, { series: [{ x: sorted.map((_, i) => i).filter((i) => i % 20 === 0), y: sorted.filter((_, i) => i % 20 === 0), name: 'بار', fill: true }], hlines: [{ y: r.total, label: 'ظرفیت' }], xLabel: 'ساعت', yLabel: 'MW', height: 260 });
      out.append(card('ردیف‌های نخست COPT', table([{ key: 'out', label: 'خروج MW' }, { key: 'p', label: 'احتمال دقیق', d: 8 }, { key: 'cum', label: 'تجمعی', d: 8 }], r.table.slice(0, 15))));
    };
    el.append(card('کفایت تولید (روش COPT، بار ساعتی مصنوعی ۸۷۶۰)', f.el, btn('محاسبه', run)), out);
    run();
    // distribution indices
    const pts = [{ n: 'A', lambda: 0.2, r: 4, customers: 250, loadKW: 1000 }, { n: 'B', lambda: 0.6, r: 2.5, customers: 100, loadKW: 400 }, { n: 'C', lambda: 0.3, r: 1.5, customers: 50, loadKW: 300 }, { n: 'D', lambda: 0.5, r: 3, customers: 75, loadKW: 500 }];
    const inputs = pts.map((p) => paramForm([{ key: 'lambda', label: `${p.n}: λ (f/yr)`, value: p.lambda }, { key: 'r', label: 'r (h)', value: p.r }, { key: 'customers', label: 'مشترک', value: p.customers }, { key: 'loadKW', label: 'بار kW', value: p.loadKW }]));
    const dOut = h('div');
    const runD = () => { const r = distributionIndices(inputs.map((i) => i.get())); dOut.innerHTML = ''; dOut.append(kpis([['SAIFI', fmt(r.SAIFI, 3), 'int/cust·yr'], ['SAIDI', fmt(r.SAIDI, 3), 'h/cust·yr'], ['CAIDI', fmt(r.CAIDI, 3), 'h/int'], ['ASAI', fmt(r.ASAI, 6), ''], ['ENS', fmt(r.ENS, 3), 'MWh/yr']])); };
    el.append(card('شاخص‌های قابلیت اطمینان توزیع (IEEE 1366)', ...inputs.map((i) => i.el), btn('محاسبه', runD), dOut));
    runD();
  },
};
