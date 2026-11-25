// Radial distribution analysis: backward/forward sweep, VSI, DG and capacitor siting.
import { h, card, kpis, fmt, btn, paramForm, note, table, grid } from '../ui/dom.js';
import { state } from '../ui/state.js';
import { bfsLoadFlow, dgPlacement, capacitorPlacement, radialTree } from '../engines/distribution.js';
import { loadCase } from '../data/cases.js';
import { lineChart, barChart } from '../ui/charts.js';
import { heatCss } from '../ui/layout.js';

export default {
  id: 'dist', title: 'شبکه توزیع شعاعی', icon: '🏘️', group: 'توزیع',
  render(el) {
    let cs = state.cs;
    try { radialTree(cs); } catch { cs = loadCase('case33bw'); el.append(note('شبکه فعال شعاعی نیست؛ این بخش روی شبکه ۳۳ باس IEEE (Baran & Wu) اجرا می‌شود.')); }
    const base = bfsLoadFlow(cs);
    const f = paramForm([
      { key: 'ls', label: 'ضریب بار', value: 1, step: 0.1 },
      { key: 'dgBus', label: 'باس DG', type: 'select', numeric: true, value: cs.bus[Math.min(5, cs.bus.length - 1)].id, options: cs.bus.map((b) => [b.id, `باس ${b.id}`]) },
      { key: 'dgP', label: 'توان DG', unit: 'MW', value: 0 }, { key: 'capBus', label: 'باس خازن', type: 'select', numeric: true, value: cs.bus[Math.min(29, cs.bus.length - 1)].id, options: cs.bus.map((b) => [b.id, `باس ${b.id}`]) },
      { key: 'capQ', label: 'خازن', unit: 'Mvar', value: 0 },
    ]);
    const out = h('div');
    const run = () => {
      const o = f.get(), idx = (id) => cs.bus.findIndex((b) => b.id === id);
      const r = bfsLoadFlow(cs, { loadScale: o.ls, extra: { P: { [idx(o.dgBus)]: o.dgP }, Q: { [idx(o.capBus)]: o.capQ } } });
      const b0 = bfsLoadFlow(cs, { loadScale: o.ls });
      out.innerHTML = '';
      out.append(kpis([['تلفات اکتیو', fmt(r.lossKW, 2), 'kW'], ['تلفات راکتیو', fmt(r.lossKvar, 2), 'kvar'], ['کاهش تلفات', fmt((100 * (b0.lossKW - r.lossKW)) / b0.lossKW, 1), '%'], ['کمینه ولتاژ', fmt(r.Vmin, 4), `باس ${r.VminBus}`, r.Vmin < 0.95 ? 'warn' : 'ok'], ['تکرار BFS', r.iterations, '']]));
      const v = h('div'), l = h('div');
      out.append(grid(card('پروفایل ولتاژ', v), card('تلفات شاخه‌ها [kW]', l)));
      lineChart(v, { series: [{ x: cs.bus.map((b) => b.id), y: b0.V, name: 'پایه', dash: '5 4' }, { x: cs.bus.map((b) => b.id), y: r.V, name: 'با DG/خازن' }], hlines: [{ y: 0.95, label: '0.95' }], xLabel: 'باس', yLabel: 'V [pu]', height: 260 });
      barChart(l, { labels: cs.branch.map((b) => `${b.from}-${b.to}`), values: r.branchLoss, colors: (x) => heatCss(x / Math.max(...r.branchLoss)), rotate: true, height: 260 });
      const vs = h('div');
      out.append(card('شاخص پایداری ولتاژ VSI (Chakravorty–Das)', vs));
      barChart(vs, { labels: cs.bus.map((b) => b.id), values: r.VSI.map((x) => x ?? NaN), colors: (x) => heatCss(1 - x), height: 200 });
    };
    const site = h('div');
    const siting = () => {
      site.textContent = 'در حال جست‌وجو…';
      setTimeout(() => {
        const dg = dgPlacement(cs), cp = capacitorPlacement(cs);
        site.innerHTML = '';
        const cols = [{ key: 'id', label: 'باس' }, { key: 'size', label: 'اندازه بهینه', d: 3 }, { key: 'loss', label: 'تلفات kW', d: 2 }, { key: 'reduction', label: 'کاهش %', d: 1 }, { key: 'Vmin', label: 'Vmin', d: 4 }];
        site.append(grid(card('بهترین محل DG (ضریب توان واحد)', table(cols, dg.ranking.slice(0, 8))), card('بهترین محل خازن', table(cols, cp.ranking.slice(0, 8)))));
        site.append(note(`جست‌وجوی جامع: برای هر باس، اندازه‌های مختلف با BFS ارزیابی و کمینه تلفات انتخاب می‌شود. تلفات پایه ${fmt(dg.base, 2)} kW.`));
      }, 20);
    };
    el.append(kpis([['تلفات پایه', fmt(base.lossKW, 2), 'kW'], ['کمینه ولتاژ پایه', fmt(base.Vmin, 4), `باس ${base.VminBus}`], ['مرجع (Baran & Wu)', '202.67 kW', '']]),
      card('پخش بار پسرو–پیشرو (Backward/Forward Sweep)', f.el, h('div', { class: 'row' }, btn('اجرا', run), btn('جانمایی بهینه DG و خازن', siting, 'ghost'))), out, site);
    run();
  },
};
