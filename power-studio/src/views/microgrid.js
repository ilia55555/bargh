// Microgrid scheduling: least-cost QP and NSGA-II cost–emission Pareto front.
import { h, card, kpis, fmt, btn, paramForm, note, grid } from '../ui/dom.js';
import { T } from '../ui/i18n.js';
import { defaultMicrogrid, paretoMicrogrid, costOptimal } from '../engines/microgrid.js';
import { lineChart, barChart } from '../ui/charts.js';

export default {
  id: 'mg', title: T('Microgrid & NSGA-II', 'ریزشبکه و NSGA-II'), icon: '🏝️', group: T('Operation', 'بهره‌برداری'),
  render(el) {
    const f = paramForm([{ key: 'pop', label: T('Population', 'جمعیت'), value: 80 }, { key: 'gens', label: T('Generations', 'نسل‌ها'), value: 150 }, { key: 'E', label: T('Battery energy', 'انرژی باتری'), unit: 'MWh', value: 3 }, { key: 'P', label: T('Battery power', 'توان باتری'), unit: 'MW', value: 0.8 }, { key: 'seed', label: T('Weather seed', 'بذر آب‌وهوا'), value: 1 }]);
    const out = h('div');
    const run = () => {
      out.textContent = T('Optimising…', 'در حال بهینه‌سازی…');
      setTimeout(() => {
        const o = f.get(), mg = defaultMicrogrid(o.seed); mg.bess.E = o.E; mg.bess.P = o.P;
        const q = costOptimal(mg), p = paretoMicrogrid(mg, { pop: o.pop, gens: o.gens });
        out.innerHTML = '';
        out.append(kpis([[T('Least cost (QP)', 'کمترین هزینه'), fmt(q.cost, 0), '$/day'], [T('CO₂ at least cost', 'CO₂ در کمترین هزینه'), fmt(q.co2, 2), 't'], [T('Pareto points', 'نقاط پارتو'), p.front.length, ''], [T('Min CO₂ on front', 'کمترین CO₂'), fmt(p.front[p.front.length - 1]?.o[1], 2), 't'], [T('Its cost', 'هزینه آن'), fmt(p.front[p.front.length - 1]?.o[0], 0), '$']]));
        const a = h('div'), b = h('div'), c = h('div');
        out.append(grid(card(T('Pareto front: cost vs emissions', 'جبهه پارتو: هزینه و آلایندگی'), a), card(T('Inputs (24 h)', 'ورودی‌ها'), b)), card(T('Least-cost dispatch', 'برنامه کمترین هزینه'), c));
        lineChart(a, { series: [{ x: p.front.map((x) => x.o[0]), y: p.front.map((x) => x.o[1]), points: true, name: 'NSGA-II' }, { x: [q.cost], y: [q.co2], points: true, r: 6, name: 'QP', color: '#e35d6a' }], xLabel: '$/day', yLabel: 't CO₂', height: 260 });
        const hrs = mg.load.map((_, i) => i);
        lineChart(b, { series: [{ x: hrs, y: mg.load, name: T('load', 'بار') }, { x: hrs, y: mg.pv, name: 'PV' }, { x: hrs, y: mg.wind, name: T('wind', 'باد') }, { x: hrs, y: mg.price.map((x) => x / 1000), name: T('price $/kWh', 'قیمت'), dash: '4 3' }], xLabel: 'h', height: 260 });
        barChart(c, { labels: hrs, series: [{ values: q.Pb, name: 'BESS', color: '#b18cff' }, { values: q.Pd, name: 'Diesel', color: '#ff8a3d' }, { values: q.grid, name: 'Grid', color: '#4f9dff' }], height: 260, yLabel: 'MW' });
      }, 20);
    };
    el.append(card(T('24 h microgrid with PV, wind, BESS, diesel and grid exchange', 'ریزشبکه ۲۴ ساعته با خورشیدی، باد، باتری، دیزل و شبکه'), f.el, btn(T('Optimise', 'بهینه‌سازی'), run)), out,
      note(T('NSGA-II (non-dominated sorting, crowding distance, SBX crossover, polynomial mutation, constraint domination) seeded with the QP least-cost solution.', 'NSGA-II با مرتب‌سازی نامغلوب، فاصله ازدحام، تقاطع SBX و جهش چندجمله‌ای.')));
    run();
  },
};
