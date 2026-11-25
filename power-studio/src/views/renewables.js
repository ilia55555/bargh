// Stochastic renewables & Monte-Carlo reliability (sequential adequacy and composite).
import { h, card, kpis, fmt, btn, paramForm, note, grid, table } from '../ui/dom.js';
import { state } from '../ui/state.js';
import { windSeries, solarSeries, sequentialMC, compositeMC } from '../engines/stochastic.js';
import { lineChart, barChart } from '../ui/charts.js';
import { heatCss } from '../ui/layout.js';
import { mount3D } from '../ui/three-mount.js';

export default {
  id: 'renew', title: 'تجدیدپذیر و مونت‌کارلو', icon: '🌬️', group: 'برنامه‌ریزی',
  async render(el) {
    const cs = state.cs;
    const f1 = paramForm([{ key: 'k', label: 'وایبول k', value: 2 }, { key: 'c', label: 'وایبول c', unit: 'm/s', value: 8.5 }, { key: 'rho', label: 'خودهمبستگی ساعتی', value: 0.9 }, { key: 'lat', label: 'عرض جغرافیایی PV', unit: '°', value: 32 }, { key: 'clear', label: 'شاخص آسمان صاف', value: 0.75 }, { key: 'day', label: 'روز نمایش (از ۰)', value: 172 }]);
    const o1 = h('div');
    const run1 = () => {
      const o = f1.get(), w = windSeries(8760, { k: o.k, c: o.c, rho: o.rho }), s = solarSeries(8760, { lat: o.lat, clear: o.clear });
      o1.innerHTML = '';
      o1.append(kpis([['ضریب ظرفیت بادی', fmt(w.cf * 100, 1), '%'], ['ضریب ظرفیت خورشیدی', fmt(s.cf * 100, 1), '%'], ['میانگین سرعت باد', fmt(w.v.reduce((a, b) => a + b, 0) / 8760, 2), 'm/s'], ['تابش سالانه', fmt(s.ghi.reduce((a, b) => a + b, 0) / 1000, 0), 'kWh/m²']]));
      const a = h('div'), b = h('div'), c = h('div');
      o1.append(grid(card('یک هفته تولید', a), card('توزیع سرعت باد (هیستوگرام)', b)), card('منحنی توان توربین', c));
      const d0 = o.day * 24, hrs = Array.from({ length: 168 }, (_, i) => i);
      lineChart(a, { series: [{ x: hrs, y: hrs.map((i) => w.p[d0 + i]), name: 'باد pu' }, { x: hrs, y: hrs.map((i) => s.p[d0 + i]), name: 'خورشیدی pu' }], xLabel: 'ساعت', height: 240 });
      const bins = new Array(30).fill(0); w.v.forEach((v) => { bins[Math.min(29, Math.floor(v))]++; });
      barChart(b, { labels: bins.map((_, i) => i), values: bins, height: 240, colors: () => '#4f9dff', xLabel: 'm/s' });
      const vs = Array.from({ length: 300 }, (_, i) => i / 10);
      import('../engines/stochastic.js').then((S) => lineChart(c, { series: [{ x: vs, y: vs.map((v) => S.windPowerCurve(v)), name: 'P/Pr' }], xLabel: 'v [m/s]', height: 200 }));
    };
    el.append(card('مدل‌سازی تصادفی باد (وایبول + AR(1)) و خورشید (موقعیت خورشید، آسمان صاف Haurwitz، ابر مارکوف، دمای سلول)', f1.el, btn('تولید سری زمانی', run1), o1));
    run1();
    // sequential MC
    const f2 = paramForm([{ key: 'peak', label: 'پیک بار', unit: 'MW', value: Math.round(cs.bus.reduce((s, b) => s + b.Pd, 0) * 0.95) }, { key: 'MTTF', label: 'MTTF واحدها', unit: 'h', value: 1460 }, { key: 'MTTR', label: 'MTTR', unit: 'h', value: 60 }, { key: 'wind', label: 'ظرفیت بادی', unit: 'MW', value: 0 }, { key: 'pv', label: 'ظرفیت خورشیدی', unit: 'MW', value: 0 }, { key: 'bE', label: 'ذخیره‌ساز انرژی', unit: 'MWh', value: 0 }, { key: 'bP', label: 'توان ذخیره‌ساز', unit: 'MW', value: 0 }, { key: 'years', label: 'حداکثر سال شبیه‌سازی', value: 200 }]);
    const o2 = h('div');
    const run2 = () => {
      o2.textContent = 'در حال شبیه‌سازی…';
      setTimeout(() => {
        const o = f2.get(), units = cs.gen.filter((g) => g.status > 0).map((g) => ({ cap: g.Pmax, MTTF: o.MTTF, MTTR: o.MTTR }));
        const renew = []; if (o.wind) renew.push({ cap: o.wind, p: windSeries(8760).p }); if (o.pv) renew.push({ cap: o.pv, p: solarSeries(8760).p });
        const r = sequentialMC(units, o.peak, { years: o.years, renew, storage: o.bE ? { E: o.bE, P: o.bP, eta: 0.9 } : null });
        o2.innerHTML = '';
        o2.append(kpis([['LOLE', fmt(r.LOLE, 2), 'h/yr', r.LOLE > 3 ? 'warn' : 'ok'], ['EENS', fmt(r.EENS, 0), 'MWh/yr'], ['LOLF', fmt(r.LOLF, 2), 'occ/yr'], ['بازه اطمینان ۹۵٪ EENS', `${fmt(r.ci95[0], 0)}–${fmt(r.ci95[1], 0)}`, ''], ['ضریب تغییرات', fmt(r.cov * 100, 1), '%'], ['سال‌های شبیه‌سازی', r.years, '']]));
        const a = h('div'), cum = []; let s = 0; r.perYear.eens.forEach((x, i) => { s += x; cum.push(s / (i + 1)); });
        o2.append(card('همگرایی EENS', a));
        lineChart(a, { series: [{ x: cum.map((_, i) => i + 1), y: cum, name: 'میانگین تجمعی' }, { x: r.perYear.eens.map((_, i) => i + 1), y: r.perYear.eens, points: true, r: 2, name: 'هر سال' }], xLabel: 'سال', yLabel: 'MWh', height: 240 });
      }, 20);
    };
    el.append(card('کفایت تولید با مونت‌کارلو ترتیبی (مدل مارکوف دوحالته واحدها، تجدیدپذیر و ذخیره‌ساز)', f2.el, btn('شبیه‌سازی', run2), o2));
    // composite
    const f3 = paramForm([{ key: 'samples', label: 'تعداد نمونه', value: 2000 }, { key: 'FOR', label: 'FOR ژنراتورها', value: 0.04 }, { key: 'U', label: 'عدم دسترسی خطوط', value: 0.002 }]);
    const o3 = h('div'), v3 = h('div', { class: 'v3d-mid' });
    let net = null;
    const run3 = () => {
      o3.textContent = 'در حال نمونه‌برداری و حل OPF کاهش بار…';
      setTimeout(() => {
        const o = f3.get(), t = performance.now(), r = compositeMC(cs, { samples: o.samples, genFOR: o.FOR, lineU: o.U });
        o3.innerHTML = '';
        o3.append(kpis([['LOLP', fmt(r.LOLP, 4), ''], ['LOLE', fmt(r.LOLE_h, 1), 'h/yr'], ['EENS', fmt(r.EENS_MWh, 0), 'MWh/yr'], ['حالت‌های یکتای حل‌شده', r.states, ''], ['زمان', fmt(performance.now() - t, 0), 'ms']]));
        const a = h('div'); o3.append(card('EENS هر باس', a));
        const mx = Math.max(...r.busEENS, 1e-9);
        barChart(a, { labels: cs.bus.map((b) => b.id), values: r.busEENS, colors: (v) => heatCss(v / mx), height: 220 });
        net?.build(cs, null, { busValues: { values: r.busEENS, lo: 0, hi: mx } });
      }, 20);
    };
    el.append(card('قابلیت اطمینان ترکیبی تولید و انتقال (نمونه‌برداری حالت + DC-OPF کمینه‌سازی کاهش بار)', f3.el, btn('اجرا', run3), o3, v3));
    net = await mount3D(v3, '../three/network3d.js', 'Network3D', {});
    if (net) { net.opts.particles = false; net.opts.height = 'flat'; net.build(cs, null, {}); }
    return () => net?.dispose();
  },
};
