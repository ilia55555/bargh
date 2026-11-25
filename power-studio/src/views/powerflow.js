// AC power flow (NR / FDLF / GS) and DC power flow with PTDF/LODF.
import { h, card, kpis, fmt, btn, paramForm, note, table, grid, download, toCSV } from '../ui/dom.js';
import { state, solve } from '../ui/state.js';
import { runPowerFlow } from '../engines/powerflow.js';
import { dcPowerFlow, ptdf, lodf } from '../engines/dcflow.js';
import { lineChart, barChart } from '../ui/charts.js';
import { heatCss } from '../ui/layout.js';

export const acpf = {
  id: 'pf', title: 'پخش بار AC', icon: '⚡', group: 'حالت ماندگار',
  render(el) {
    const cs = state.cs;
    const f = paramForm([
      { key: 'method', label: 'روش', type: 'select', value: state.pfOpts.method, options: [['NR', 'نیوتن-رافسون (قطبی)'], ['FDLF', 'سریع دکوپله (XB)'], ['GS', 'گوس-سایدل (شتاب 1.6)']] },
      { key: 'tol', label: 'تلورانس', value: 1e-8 },
      { key: 'enforceQ', label: 'اعمال محدودیت Q ژنراتورها', type: 'checkbox', value: state.pfOpts.enforceQ },
      { key: 'loadScale', label: 'ضریب بار', value: 1, step: 0.05 },
    ]);
    const out = h('div');
    const run = () => {
      const o = f.get();
      const t0 = performance.now();
      const pf = o.loadScale === 1 ? solve({ method: o.method, enforceQ: o.enforceQ, tol: o.tol }) : runPowerFlow(cs, { method: o.method, enforceQ: o.enforceQ, tol: o.tol, loadScale: o.loadScale, genScale: o.loadScale, flat: true });
      const ms = performance.now() - t0;
      out.innerHTML = '';
      if (!pf.converged) { out.append(note(`همگرا نشد (${pf.iterations ?? 0} تکرار). روش دیگری را امتحان کنید یا ضریب بار را کاهش دهید.`, 'bad')); }
      out.append(kpis([
        ['وضعیت', pf.converged ? 'همگرا' : 'واگرا', '', pf.converged ? 'ok' : 'bad'], ['تکرار', pf.iterations, ''], ['زمان', fmt(ms, 1), 'ms'],
        ['تولید کل', fmt(pf.totalPg, 1), 'MW'], ['بار کل', fmt(pf.totalPd, 1), 'MW'], ['تلفات', fmt(pf.lossP, 3), 'MW'],
        ['باس‌های محدودشده Q', pf.qLimited?.length ? pf.qLimited.join('، ') : '—', ''],
      ]));
      const conv = h('div'), vp = h('div'), ang = h('div'), ld = h('div');
      out.append(grid(card('همگرایی (بیشینه عدم تطابق)', conv), card('پروفایل ولتاژ', vp)), grid(card('زاویه ولتاژ باس‌ها', ang), card('بارگذاری شاخه‌ها', ld)));
      lineChart(conv, { series: [{ x: pf.log.map((_, i) => i), y: pf.log.map((v) => Math.max(v, 1e-16)), name: pf.method, points: false }], logY: true, xLabel: 'تکرار', yLabel: '‖ΔF‖∞ [pu]', height: 240 });
      barChart(vp, { labels: cs.bus.map((b) => b.id), values: Array.from(pf.V), yMin: 0.9, yMax: 1.1, colors: (v) => heatCss((v - 0.94) / 0.12), hlines: [{ y: 0.95 }, { y: 1.05 }], height: 240, yLabel: 'V [pu]' });
      barChart(ang, { labels: cs.bus.map((b) => b.id), values: pf.bus.map((b) => b.Va), height: 240, yLabel: 'θ [deg]' });
      barChart(ld, { labels: cs.branch.map((b) => `${b.from}-${b.to}`), values: pf.branch.map((b) => b.loading), colors: (v) => heatCss(v / 100), hlines: [{ y: 100 }], height: 240, yLabel: '% rateA', rotate: true });
      const busCols = [{ key: 'id', label: 'باس' }, { fn: (r) => ['', 'PQ', 'PV', 'Slack', 'ایزوله'][r.type], label: 'نوع' }, { key: 'Vm', label: '|V| pu', d: 4, cls: (r) => (r.vViol ? 'bad' : '') }, { key: 'Va', label: 'θ°', d: 3 }, { key: 'Pg', label: 'Pg MW', d: 2 }, { key: 'Qg', label: 'Qg Mvar', d: 2 }, { key: 'Pd', label: 'Pd', d: 2 }, { key: 'Qd', label: 'Qd', d: 2 }];
      const brCols = [{ fn: (r, i) => i + 1, label: '#' }, { key: 'from', label: 'از' }, { key: 'to', label: 'به' }, { key: 'Pf', label: 'Pf MW', d: 2 }, { key: 'Qf', label: 'Qf Mvar', d: 2 }, { key: 'Pt', label: 'Pt MW', d: 2 }, { key: 'Qt', label: 'Qt', d: 2 }, { key: 'lossP', label: 'تلفات MW', d: 3 }, { key: 'loading', label: 'بار %', d: 1, cls: (r) => (r.loading > 100 ? 'bad' : r.loading > 80 ? 'warn' : '') }];
      out.append(grid(
        card('نتایج باس‌ها', btn('CSV', () => download(`${cs.name}_bus.csv`, toCSV(busCols, pf.bus)), 'ghost small'), table(busCols, pf.bus)),
        card('نتایج شاخه‌ها', btn('CSV', () => download(`${cs.name}_branch.csv`, toCSV(brCols, pf.branch)), 'ghost small'), table(brCols, pf.branch)),
      ));
      out.append(card('مقایسه سه روش', compare(cs)));
    };
    el.append(card('تنظیمات پخش بار', f.el, btn('اجرا', run)), out);
    run();
  },
};

function compare(cs) {
  const rows = ['NR', 'FDLF', 'GS'].map((m) => { const t = performance.now(); const r = runPowerFlow(cs, { method: m, flat: true }); return { m, it: r.iterations, ms: performance.now() - t, ok: r.converged ? '✔' : '✘', loss: r.lossP, vmin: r.Vmin }; });
  return h('div', {}, table([{ key: 'm', label: 'روش' }, { key: 'ok', label: 'همگرایی' }, { key: 'it', label: 'تکرار' }, { key: 'ms', label: 'زمان ms', d: 1 }, { key: 'loss', label: 'تلفات MW', d: 4 }, { key: 'vmin', label: 'Vmin', d: 5 }], rows),
    note('NR همگرایی درجه دو دارد؛ FDLF با ماتریس‌های ثابت B′ و B″ تکرار بیشتر اما هزینه کمتر در هر تکرار؛ GS ساده ولی کند.'));
}

export const dcpf = {
  id: 'dcpf', title: 'پخش بار DC و PTDF', icon: '📐', group: 'حالت ماندگار',
  render(el) {
    const cs = state.cs, ac = state.pf;
    const dc = dcPowerFlow(cs), { H } = ptdf(cs), L = lodf(cs, H);
    const cmp = h('div');
    el.append(card('مقایسه پخش بار DC با AC (توان اکتیو شاخه‌ها)', cmp));
    lineChart(cmp, {
      series: [
        { x: ac.branch.map((b) => b.Pf), y: dc.flows.map((f) => f.P), points: true, name: 'شاخه‌ها' },
        { x: [-1e4, 1e4], y: [-1e4, 1e4], color: '#888', dash: '4 4', name: 'y = x' },
      ],
      xMin: Math.min(...ac.branch.map((b) => b.Pf)) * 1.1, xMax: Math.max(...ac.branch.map((b) => b.Pf)) * 1.1,
      yMin: Math.min(...dc.flows.map((b) => b.P)) * 1.1, yMax: Math.max(...dc.flows.map((b) => b.P)) * 1.1,
      xLabel: 'P (AC) [MW]', yLabel: 'P (DC) [MW]', height: 300,
    });
    const err = dc.flows.map((f, k) => Math.abs(f.P - ac.branch[k].Pf));
    el.append(kpis([['بیشینه خطای DC', fmt(Math.max(...err), 2), 'MW'], ['میانگین خطا', fmt(err.reduce((a, b) => a + b, 0) / err.length, 2), 'MW'], ['باس مرجع', cs.bus[dc.ref].id, '']]));
    const busSel = paramForm([{ key: 'bus', label: 'باس تزریق برای PTDF', type: 'select', value: cs.bus[0].id, numeric: true, options: cs.bus.map((b) => [b.id, `باس ${b.id}`]) }, { key: 'out', label: 'خروج شاخه برای LODF', type: 'select', numeric: true, value: 0, options: cs.branch.map((b, k) => [k, `${b.from}-${b.to}`]) }], () => draw());
    const p1 = h('div'), p2 = h('div');
    el.append(card('ضرایب حساسیت', busSel.el, grid(h('div', {}, h('h4', {}, 'PTDF (تزریق در باس انتخابی، برداشت از مرجع)'), p1), h('div', {}, h('h4', {}, 'LODF (اثر خروج شاخه انتخابی)'), p2))));
    const draw = () => {
      const o = busSel.get(), j = cs.bus.findIndex((b) => b.id === o.bus);
      barChart(p1, { labels: cs.branch.map((b) => `${b.from}-${b.to}`), values: H.map((r) => r[j]), rotate: true, height: 240, colors: (v) => (v >= 0 ? '#4f9dff' : '#e35d6a') });
      barChart(p2, { labels: cs.branch.map((b) => `${b.from}-${b.to}`), values: L.map((r) => (Number.isFinite(r[o.out]) ? r[o.out] : 0)), rotate: true, height: 240, colors: (v) => (v >= 0 ? '#3ccf91' : '#ff8a3d') });
    };
    draw();
    el.append(note('PTDF_l,i = b_l (X_f,i − X_t,i)؛  LODF_l,k = (PTDF_l,f_k − PTDF_l,t_k) / (1 − PTDF_k,f_k + PTDF_k,t_k). برای شاخه‌های شعاعی (جزیره‌ساز) LODF تعریف نمی‌شود.'));
  },
};
