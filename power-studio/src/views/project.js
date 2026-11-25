// Project studio: full grid-connection assessment of a real project + downloadable report.
import { h, card, kpis, fmt, btn, paramForm, note, grid, table, download } from '../ui/dom.js';
import { state } from '../ui/state.js';
import { interconnectionStudy, reportHTML, PROJECT_TYPES, DEFAULTS, withProject } from '../engines/project.js';
import { runPowerFlow } from '../engines/powerflow.js';
import { lineChart, barChart } from '../ui/charts.js';
import { mount3D } from '../ui/three-mount.js';

export default {
  id: 'project', title: 'استودیوی پروژه واقعی', icon: '🏗️', group: 'نمای کلی',
  async render(el) {
    const cs = state.cs, loadBuses = cs.bus.filter((b) => b.type === 1).map((b) => b.id);
    const f = paramForm([
      { key: 'type', label: 'نوع پروژه', type: 'select', value: 'pv', options: Object.entries(PROJECT_TYPES) },
      { key: 'bus', label: 'نقطه اتصال (POI)', type: 'select', numeric: true, value: loadBuses.includes(16) ? 16 : loadBuses[0], options: cs.bus.map((b) => [b.id, `باس ${b.id}${b.baseKV ? ` (${b.baseKV} kV)` : ''}`]) },
      { key: 'MW', label: 'ظرفیت', unit: 'MW', value: 300 }, { key: 'pf', label: 'ضریب توان (بار)', value: 0.95 }, { key: 'qcap', label: 'توان راکتیو اینورتر (Q/P)', value: 0.33 },
      { key: 'lat', label: 'عرض جغرافیایی سایت', unit: '°', value: 32 }, { key: 'clear', label: 'شاخص آسمان صاف', value: 0.75 }, { key: 'windC', label: 'وایبول c سایت', unit: 'm/s', value: 8.5 },
      { key: 'capex', label: 'CAPEX', unit: '$/kW', value: DEFAULTS.pv.capex }, { key: 'opex', label: 'OPEX', unit: '$/kW·yr', value: DEFAULTS.pv.opex }, { key: 'life', label: 'عمر', unit: 'yr', value: 25 },
      { key: 'rate', label: 'نرخ تنزیل', value: 0.08 }, { key: 'price', label: 'قیمت فروش (0 = LMP)', unit: '$/MWh', value: 60 }, { key: 'co2', label: 'ضریب انتشار جایگزین', unit: 't/MWh', value: 0.55 },
      { key: 'dyn', label: 'شبیه‌سازی دینامیکی LVRT', type: 'checkbox', value: true },
    ]);
    f.inputs.type.inp.addEventListener('change', () => { const d = DEFAULTS[f.inputs.type.inp.value]; f.inputs.capex.inp.value = d.capex; f.inputs.opex.inp.value = d.opex; f.inputs.life.inp.value = d.life; });
    const out = h('div'), prog = h('div', { class: 'muted' }), v3 = h('div', { class: 'v3d-mid' });
    let net = null, last = null;
    const run = () => {
      const o = f.get(), P = { ...o, price: o.price || 'lmp' };
      prog.textContent = 'در حال انجام مطالعات…'; out.innerHTML = '';
      setTimeout(() => {
        const t = performance.now(), R = interconnectionStudy(cs, P, { dynamics: o.dyn, onStep: (s) => { prog.textContent = s; } });
        last = R; prog.textContent = `مطالعات کامل شد (${fmt((performance.now() - t) / 1000, 1)} s)`;
        out.append(card('نتیجه‌گیری', h('div', { class: 'note ' + (R.verdict.ok ? '' : 'bad') }, R.verdict.ok ? '✔ اتصال بدون نیاز به تقویت شبکه قابل تأیید است.' : '✘ اتصال مشروط به رفع موارد زیر است:', R.verdict.issues.length ? h('ul', {}, R.verdict.issues.map((i) => h('li', {}, i))) : ''),
          btn('دریافت گزارش کامل (HTML)', () => download(`interconnection_${o.type}_${o.MW}MW_bus${o.bus}.html`, reportHTML(cs, R), 'text/html'))));
        out.append(kpis([
          ['ولتاژ POI قبل/بعد', `${fmt(R.pf.base.V, 4)} / ${fmt(R.pf.post.V, 4)}`, 'pu'], ['تلفات قبل/بعد', `${fmt(R.pf.base.loss, 1)} / ${fmt(R.pf.post.loss, 1)}`, 'MW'],
          ['N-1 ناامن قبل/بعد', `${R.n1.base} / ${R.n1.post}`, '', R.n1.post > R.n1.base ? 'bad' : 'ok'], ['S″k در POI', fmt(R.sc.SkBase, 0), 'MVA'], ['SCR', R.sc.SCR ? fmt(R.sc.SCR, 2) : '—', '', R.sc.weak ? 'bad' : 'ok'],
          ['تغییر پله‌ای ولتاژ', fmt(R.vstep, 2), '%', R.vstep > 3 ? 'bad' : 'ok'], ['ظرفیت میزبانی', fmt(R.hosting.MW, 0), 'MW', R.hosting.MW < o.MW ? 'warn' : 'ok'], ['عامل محدودکننده', R.hosting.limit || '—', ''],
        ]));
        if (R.lvrt) {
          const a = h('div'); out.append(card(`عبور از خطا: خطای سه‌فاز ۱۵۰ms در باس ${R.lvrt.faultBus} — ${R.lvrt.compliant ? 'منطبق با LVRT' : 'نامنطبق'}`, a));
          lineChart(a, { series: [{ x: R.lvrt.t, y: R.lvrt.v, name: 'ولتاژ POI' }, { x: R.lvrt.t, y: R.lvrt.envelope, name: 'منحنی LVRT کد شبکه', color: '#e35d6a', dash: '6 4' }], xLabel: 't [s]', yLabel: 'V [pu]', height: 260, yMin: 0 });
        }
        if (R.energy) {
          out.append(kpis([['انرژی P50', fmt(R.energy.E50 / 1000, 1), 'GWh/yr'], ['انرژی P90', fmt(R.energy.E90 / 1000, 1), 'GWh/yr'], ['ضریب ظرفیت', fmt(R.energy.CF * 100, 1), '%'], ['LCOE', fmt(R.econ.LCOE, 1), '$/MWh'], ['قیمت فروش', fmt(R.econ.price, 1), '$/MWh'], ['NPV', fmt(R.econ.NPV / 1e6, 1), 'M$', R.econ.NPV > 0 ? 'ok' : 'bad'], ['IRR', R.econ.IRR !== null ? fmt(R.econ.IRR * 100, 1) : '—', '%'], ['بازگشت سرمایه', fmt(R.econ.payback, 1), 'سال'], ['CO₂ اجتناب‌شده', fmt(R.energy.co2 / 1000, 1), 'kt/yr']]));
          const c = h('div'); out.append(card('جریان نقدی تجمعی', c));
          let s = 0; const cum = R.econ.cash.map((x) => (s += x) / 1e6);
          barChart(c, { labels: cum.map((_, i) => i), values: cum, colors: (v) => (v < 0 ? '#e35d6a' : '#3ccf91'), height: 220, xLabel: 'سال', yLabel: 'M$' });
        }
        if (R.n1.worst.length) out.append(card('بدترین پیشامدها با پروژه', table([{ key: 'label', label: 'پیشامد' }, { key: 'maxLoading', label: 'بیشینه بار %', d: 1 }, { key: 'Vmin', label: 'Vmin', d: 4 }], R.n1.worst)));
        if (net) { const c2 = withProject(cs, P), p2 = runPowerFlow(c2, {}); net.build(c2, p2.converged ? p2 : null, {}); }
      }, 30);
    };
    el.append(card('مشخصات پروژه', f.el, h('div', { class: 'row' }, btn('اجرای مطالعات اتصال', run), prog)), out, card('شبکه با پروژه (سه‌بعدی)', v3),
      note('مطالعات طبق روال اپراتورهای شبکه: پخش بار N-0/N-1 (فقط نقض‌های جدید یا تشدیدشده)، IEC 60909 و نسبت اتصال کوتاه SCR، تغییر پله‌ای ولتاژ، ظرفیت میزبانی با جست‌وجوی دوبخشی، شبیه‌سازی RMS دقیق با مدل اینورتر و مقایسه با منحنی LVRT (ENTSO-E RfG نوع D)، انرژی احتمالاتی ۳۰ سناریوی آب‌وهوایی (P50/P90)، LCOE/NPV/IRR.'));
    net = await mount3D(v3, '../three/network3d.js', 'Network3D', {});
    net?.build(cs, state.pf, {});
    return () => net?.dispose();
  },
};
