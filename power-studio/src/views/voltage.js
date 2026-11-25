// Voltage stability: PV (nose) curves, QV curves, L-index and Q–V modal sensitivities.
import { h, card, kpis, fmt, btn, paramForm, note, table, grid } from '../ui/dom.js';
import { state } from '../ui/state.js';
import { pvCurve, qvCurve, lIndex, qvModal } from '../engines/voltage.js';
import { lineChart, barChart } from '../ui/charts.js';
import { heatCss } from '../ui/layout.js';

export default {
  id: 'vs', title: 'پایداری ولتاژ', icon: '📉', group: 'پایداری',
  render(el) {
    const cs = state.cs, pf = state.pf;
    if (!pf?.converged) { el.append(note('ابتدا پخش بار باید همگرا شود.', 'bad')); return; }
    const L = lIndex(cs, pf), qm = qvModal(cs, pf);
    const weak = L.slice(0, 4).map((x) => x.id);
    el.append(kpis([['بیشترین L-index', fmt(L[0].L, 4), `باس ${L[0].id}`, L[0].L > 0.5 ? 'warn' : 'ok'], ['کمترین مقدار ویژه J_R', fmt(qm.minEig, 4), '', qm.minEig < 1 ? 'warn' : 'ok'], ['حساس‌ترین باس dV/dQ', fmt(qm.sens[0].dVdQ, 5), `باس ${qm.sens[0].id}`]]));
    const l1 = h('div'), l2 = h('div');
    el.append(grid(card('شاخص L (Kessel–Glavitsch)', l1), card('حساسیت V–Q (قطر J_R⁻¹)', l2)));
    barChart(l1, { labels: L.map((x) => x.id), values: L.map((x) => x.L), colors: (v) => heatCss(v / Math.max(L[0].L, 0.01)), height: 240, xLabel: 'باس (مرتب شده)' });
    barChart(l2, { labels: qm.sens.map((x) => x.id), values: qm.sens.map((x) => x.dVdQ), colors: () => '#b18cff', height: 240, xLabel: 'باس' });
    const f = paramForm([
      { key: 'mon', label: 'باس‌های پایش (با کاما)', type: 'text', value: weak.join(',') },
      { key: 'gen', label: 'افزایش تولید متناسب با بار', type: 'checkbox', value: true },
      { key: 'q', label: 'اعمال حد Q ژنراتورها', type: 'checkbox', value: true },
      { key: 'qbus', label: 'باس منحنی QV', type: 'select', numeric: true, value: weak[0], options: cs.bus.map((b) => [b.id, `باس ${b.id}`]) },
    ]);
    const out = h('div');
    const run = () => {
      const o = f.get(), mon = o.mon.split(/[,\s]+/).map(Number).filter((x) => cs.bus.some((b) => b.id === x));
      const pv = pvCurve(cs, { monitor: mon, scaleGen: o.gen, enforceQ: o.q });
      const qv = qvCurve(cs, o.qbus, { Vfrom: 1.15, Vto: 0.4, steps: 50 });
      out.innerHTML = '';
      out.append(kpis([['λ بیشینه (حد بارپذیری)', fmt(pv.lambdaMax, 4), ''], ['بار بیشینه', fmt(pv.PdMax, 1), 'MW'], ['حاشیه بارپذیری', fmt((pv.lambdaMax - 1) * 100, 1), '%'], ['حاشیه توان راکتیو (QV)', qv.Qmargin !== null ? fmt(qv.Qmargin, 1) : '—', 'Mvar', qv.Qmargin < 0 ? 'bad' : 'ok'], ['ولتاژ بحرانی QV', fmt(qv.Vcrit, 3), 'pu']]));
      const p1 = h('div'), p2 = h('div');
      out.append(grid(card('منحنی PV (دماغه)', p1), card(`منحنی QV باس ${o.qbus}`, p2)));
      lineChart(p1, { series: mon.map((id, j) => ({ x: pv.points.map((p) => p.Pd), y: pv.points.map((p) => p.V[j]), name: `باس ${id}` })), xLabel: 'بار کل [MW]', yLabel: 'V [pu]', height: 300 });
      const ok = qv.points.filter((p) => p.Q !== null);
      lineChart(p2, { series: [{ x: ok.map((p) => p.V), y: ok.map((p) => p.Q), name: 'Q جبران‌ساز' }], hlines: [{ y: 0, color: '#888' }], xLabel: 'V [pu]', yLabel: 'Q [Mvar]', height: 300 });
      out.append(note('PV: بار همه باس‌ها با ضریب λ (و تولید ژنراتورها) افزایش می‌یابد؛ گام با نیمه‌کردن تا واگرایی NR کوچک می‌شود (شاخه بالای منحنی). QV: یک کندانسور سنکرون فرضی با Q نامحدود در باس قرار داده و V کاهش داده می‌شود؛ کمینه منحنی حاشیه Q است.'));
    };
    el.append(card('تحلیل منحنی‌ها', f.el, btn('اجرا', run)), out);
    run();
  },
};
