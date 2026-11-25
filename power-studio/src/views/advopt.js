// AC-OPF, DC-SCOPF, Lagrangian-relaxation UC and probabilistic power flow.
import { h, card, kpis, fmt, btn, paramForm, note, table, grid, download, toCSV } from '../ui/dom.js';
import { state } from '../ui/state.js';
import { acOpf, dcScopf, lagrangianUC, probabilisticPF } from '../engines/advopt.js';
import { dcOpf } from '../engines/dispatch.js';
import { lineChart, barChart, PALETTE } from '../ui/charts.js';
import { heatCss } from '../ui/layout.js';

const hist = (a, bins = 25) => { const lo = Math.min(...a), hi = Math.max(...a), w = (hi - lo) / bins || 1, c = new Array(bins).fill(0); a.forEach((x) => { c[Math.min(bins - 1, Math.floor((x - lo) / w))]++; }); return { labels: c.map((_, i) => (lo + (i + 0.5) * w).toFixed(3)), c }; };

export default {
  id: 'adv', title: 'AC-OPF، SCOPF، UC و احتمالاتی', icon: '🧮', group: 'بهره‌برداری',
  render(el) {
    const cs = state.cs;
    // AC-OPF
    const o1 = h('div');
    const runAC = () => {
      o1.textContent = 'در حال حل AC-OPF…';
      setTimeout(() => {
        const t = performance.now(), r = acOpf(cs), ms = performance.now() - t, d = dcOpf(cs, { useLimits: true });
        o1.innerHTML = '';
        if (!r.converged) { o1.append(note(r.error, 'bad')); return; }
        o1.append(kpis([['هزینه AC-OPF', fmt(r.cost, 2), '$/h'], ['هزینه DC-OPF', fmt(d.totalCost, 2), '$/h'], ['تلفات', fmt(r.loss, 2), 'MW'], ['تکرار SQP', r.iterations, ''], ['زمان', fmt(ms, 0), 'ms'], ['نقض خط/ولتاژ/Q', `${r.viol.lines}/${r.viol.volt}/${r.viol.q}`, '', r.viol.lines + r.viol.volt + r.viol.q ? 'warn' : 'ok']]));
        const c1 = h('div'), c2 = h('div');
        o1.append(grid(card('همگرایی هزینه', c1), card('پروفایل ولتاژ بهینه', c2)));
        lineChart(c1, { series: [{ x: r.log.map((l) => l.it), y: r.log.map((l) => l.cost), name: 'هزینه' }], xLabel: 'تکرار', yLabel: '$/h', height: 220 });
        barChart(c2, { labels: cs.bus.map((b) => b.id), values: Array.from(r.pf.V), yMin: 0.9, yMax: 1.1, colors: (v) => heatCss((v - 0.94) / 0.12), hlines: [{ y: 0.94 }, { y: 1.06 }], height: 220 });
        const cols = [{ key: 'bus', label: 'باس' }, { key: 'Pg', label: 'Pg MW', d: 2 }, { key: 'Qg', label: 'Qg Mvar', d: 2 }, { key: 'Vg', label: 'Vset pu', d: 4 }];
        o1.append(table(cols, r.gens), btn('CSV', () => download('acopf.csv', toCSV(cols, r.gens)), 'ghost small'));
      }, 20);
    };
    el.append(card('AC Optimal Power Flow (SQP با حساسیت‌های کامل AC، ناحیه اطمینان؛ متغیرها: Pg و ولتاژ ژنراتورها؛ قیود: خطوط، ولتاژ، Q)', btn('حل AC-OPF', runAC), o1, note('اعتبارسنجی: case9 → 5297 (MATPOWER 5296.69)، case39 → 41864 (MATPOWER 41864.18) $/h.')));
    // SCOPF
    const f2 = paramForm([{ key: 'em', label: 'ضریب رِیت اضطراری پس از پیشامد', value: 1.2 }, { key: 'ls', label: 'ضریب رِیت پایه', value: 1 }]);
    const o2 = h('div');
    const runSC = () => {
      const o = f2.get(), t = performance.now(), r = dcScopf(cs, { emergency: o.em, limitScale: o.ls }), d = dcOpf(cs, { limitScale: o.ls });
      o2.innerHTML = '';
      if (!r.converged) { o2.append(note(r.error, 'bad')); return; }
      o2.append(kpis([['هزینه SCOPF', fmt(r.cost, 2), '$/h'], ['هزینه OPF', fmt(d.totalCost, 2), '$/h'], ['هزینه امنیت', fmt(r.cost - d.totalCost, 2), '$/h'], ['دور تولید قید', r.rounds, ''], ['قیود پیشامد افزوده', r.cutsAdded, ''], ['پیشامدهای غیرقابل‌امن‌سازی', r.unsecured.length, '', r.unsecured.length ? 'warn' : 'ok'], ['زمان', fmt(performance.now() - t, 0), 'ms']]));
      const c = h('div'); o2.append(grid(card('LMP با قیود امنیت', c), card('پیشامدهای بحرانی', table([{ fn: (u) => `${cs.branch[u.l].from}-${cs.branch[u.l].to}`, label: 'خط پایش' }, { fn: (u) => (u.k < 0 ? 'پایه' : `${cs.branch[u.k].from}-${cs.branch[u.k].to}`), label: 'پیشامد' }, { fn: (u) => u.over ?? 0, label: 'اضافه‌بار غیرقابل رفع MW', d: 2 }], [...r.unsecured, ...r.binding.filter((b) => b.k >= 0).slice(0, 20)]))));
      const lo = Math.min(...r.lmp), hi = Math.max(...r.lmp);
      barChart(c, { labels: cs.bus.map((b) => b.id), values: r.lmp, colors: (v) => heatCss((v - lo) / (hi - lo || 1)), height: 230 });
    };
    el.append(card('DC Security-Constrained OPF (N-1 پیشگیرانه با LODF و تولید تدریجی قیود)', f2.el, btn('حل SCOPF', runSC), o2));
    // LR-UC
    const f3 = paramForm([{ key: 'peak', label: 'پیک بار', unit: 'MW', value: Math.round(cs.bus.reduce((s, b) => s + b.Pd, 0)) }, { key: 'pmin', label: 'Pmin/Pmax', value: 0.3 }, { key: 'su', label: 'هزینه راه‌اندازی', unit: '$', value: 2500 }, { key: 'mu', label: 'حداقل زمان روشن', unit: 'h', value: 4 }, { key: 'md', label: 'حداقل زمان خاموش', unit: 'h', value: 3 }]);
    const o3 = h('div');
    const runUC = () => {
      const o = f3.get(), gens = cs.gen.filter((g) => g.status > 0);
      const units = gens.map((g, i) => ({ ...g, Pmin: g.Pmax * o.pmin, SU: o.su * (1 + i * 0.1), MU: o.mu, MD: o.md, init: i < gens.length / 2 ? o.mu : -o.md }));
      const dem = Array.from({ length: 24 }, (_, hh) => o.peak * (0.6 + 0.3 * Math.exp(-((hh - 19) ** 2) / 12) + 0.12 * Math.exp(-((hh - 11) ** 2) / 8)) / 1.02);
      const r = lagrangianUC(units, dem);
      o3.innerHTML = '';
      o3.append(kpis([['هزینه کل روزانه', fmt(r.total, 0), '$'], ['کران پایین دوگان', fmt(r.dual, 0), '$'], ['شکاف دوگانی', fmt(r.gap, 3), '%', r.gap < 1 ? 'ok' : 'warn']]));
      const a = h('div'), b = h('div');
      o3.append(grid(card('برنامه تولید', a), card('وضعیت واحدها (روشن = رنگی)', b)));
      barChart(a, { labels: dem.map((_, i) => i), series: units.map((u, i) => ({ values: r.P.map((p) => p[i]), name: 'G@' + u.bus, color: PALETTE[i % 12] })), height: 260 });
      b.append(h('div', { class: 'uc-grid' }, units.map((u, i) => h('div', { class: 'uc-row' }, h('span', {}, 'G@' + u.bus), ...r.schedule[i].map((on) => h('i', { style: { background: on ? PALETTE[i % 12] : 'transparent' } }))))));
    };
    el.append(card('تعهد واحد با آزادسازی لاگرانژ (DP واحدها با حداقل زمان روشن/خاموش و هزینه راه‌اندازی، گرادیان-زیر Polyak)', f3.el, btn('حل UC', runUC), o3));
    // PPF
    const f4 = paramForm([{ key: 'N', label: 'تعداد نمونه', value: 300 }, { key: 'sigma', label: 'انحراف معیار بار', value: 0.08 }, { key: 'rho', label: 'همبستگی بارها', value: 0.5 }]);
    const o4 = h('div');
    const runPP = () => {
      o4.textContent = 'در حال نمونه‌برداری…';
      setTimeout(() => {
        const o = f4.get(), r = probabilisticPF(cs, o), st = r.stats;
        o4.innerHTML = '';
        o4.append(kpis([['Vmin میانگین', fmt(st.Vmin.mean, 4), 'pu'], ['Vmin صدک ۵', fmt(st.Vmin.p05, 4), 'pu'], ['P(Vmin<0.95)', fmt(r.pVviol * 100, 2), '%'], ['P(اضافه‌بار)', fmt(r.pOver * 100, 2), '%'], ['تلفات μ±σ', `${fmt(st.loss.mean, 1)}±${fmt(st.loss.std, 1)}`, 'MW'], ['واگرا', r.diverged, '']]));
        const a = h('div'), b = h('div'); o4.append(grid(card('توزیع کمینه ولتاژ', a), card('توزیع بیشینه بارگذاری خط', b)));
        const h1 = hist(r.Vmin), h2 = hist(r.maxLoad);
        barChart(a, { labels: h1.labels, values: h1.c, height: 220, colors: () => '#4f9dff' }); barChart(b, { labels: h2.labels, values: h2.c, height: 220, colors: () => '#ff8a3d' });
      }, 20);
    };
    el.append(card('پخش بار احتمالاتی مونت‌کارلو (بار با توزیع نرمال همبسته)', f4.el, btn('اجرا', runPP), o4));
  },
};
