// Power quality & fundamentals: harmonics, PF correction, symmetrical components, per-unit.
import { h, card, kpis, fmt, btn, paramForm, note, grid } from '../ui/dom.js';
import { harmonics, pfCorrection, perUnit, changeBase } from '../engines/components.js';
import { phaseToSeq, polar, cabs, carg, deg } from '../lib/complex.js';
import { lineChart, barChart } from '../ui/charts.js';
import { phasorPlot } from './faults.js';

export const pq = {
  id: 'pq', title: 'کیفیت توان و هارمونیک', icon: '🎵', group: 'تجهیزات',
  render(el) {
    const presets = { '6-pulse': [[1, 100], [5, 20], [7, 14.3], [11, 9.1], [13, 7.7], [17, 5.9], [19, 5.3]], 'SMPS': [[1, 100], [3, 81], [5, 61], [7, 42], [9, 26], [11, 13]], 'VFD-12p': [[1, 100], [11, 9], [13, 7.7], [23, 4.3], [25, 4]] };
    const f = paramForm([{ key: 'preset', label: 'طیف نمونه', type: 'select', value: '6-pulse', options: [['6-pulse', 'یکسوساز ۶ پالس'], ['SMPS', 'منبع تغذیه سوئیچینگ'], ['VFD-12p', 'درایو ۱۲ پالس']] }, { key: 'f', label: 'فرکانس', unit: 'Hz', value: 50 }]);
    const out = h('div');
    const run = () => {
      const o = f.get(), spec = presets[o.preset].map(([hh, m]) => ({ h: hh, mag: m, ang: 0 }));
      const r = harmonics(spec, { f: o.f });
      out.innerHTML = '';
      out.append(kpis([['THD', fmt(r.THD, 2), '%', r.THD > 8 ? 'bad' : r.THD > 5 ? 'warn' : 'ok'], ['ضریب K', fmt(r.Kfactor, 2), ''], ['ضریب قله', fmt(r.crest, 3), ''], ['PF اعوجاج', fmt(r.distortionPF, 4), ''], ['RMS/RMS₁', fmt(r.rmsRatio, 4), '']]));
      const a = h('div'), b = h('div');
      out.append(grid(card('شکل موج (دو سیکل)', a), card('طیف هارمونیکی', b)));
      lineChart(a, { series: [{ x: r.t, y: r.y, name: 'موج اعوجاج‌یافته' }, { x: r.t, y: r.y1, name: 'مؤلفه اصلی', dash: '5 4' }], xLabel: 't [ms]', yLabel: 'pu', height: 250 });
      barChart(b, { labels: spec.map((s) => s.h), values: spec.map((s) => s.mag), height: 250, xLabel: 'مرتبه هارمونیک', yLabel: '% اصلی' });
    };
    el.append(card('تحلیل هارمونیکی (IEEE 519)', f.el, btn('تحلیل', run)), out); run();
    const c = paramForm([{ key: 'P', label: 'توان بار', unit: 'kW', value: 500 }, { key: 'pf1', label: 'ضریب توان فعلی', value: 0.75 }, { key: 'pf2', label: 'ضریب توان هدف', value: 0.95 }, { key: 'V', label: 'ولتاژ خط', unit: 'V', value: 400 }, { key: 'f', label: 'فرکانس', unit: 'Hz', value: 50 }, { key: 'Ssc', label: 'سطح اتصال کوتاه شین', unit: 'kVA', value: 20000 }]);
    const cOut = h('div');
    const runC = () => { const r = pfCorrection(c.get()); cOut.innerHTML = ''; cOut.append(kpis([['Qc لازم', fmt(r.Qc, 1), 'kvar'], ['C هر فاز (Δ)', fmt(r.Cdelta, 1), 'µF'], ['C هر فاز (Y)', fmt(r.Cstar, 1), 'µF'], ['S پیش/پس', `${fmt(r.S1, 0)} / ${fmt(r.S2, 0)}`, 'kVA'], ['کاهش جریان', fmt(r.Ired, 1), '%'], ['هارمونیک تشدید', fmt(r.hres, 2), '', Math.abs(r.hres - Math.round(r.hres)) < 0.3 && [5, 7, 11, 13].includes(Math.round(r.hres)) ? 'bad' : 'ok']])); };
    el.append(card('اصلاح ضریب توان با خازن', c.el, btn('محاسبه', runC), cOut, note('Qc = P(tan φ1 − tan φ2) ؛ تشدید موازی h_r = √(Ssc/Qc) — اگر نزدیک هارمونیک‌های غالب (۵، ۷، ۱۱، ۱۳) باشد، از فیلتر دتیون استفاده کنید.'))); runC();
  },
};

export const fundamentals = {
  id: 'fund', title: 'مؤلفه‌های متقارن و پریونیت', icon: '🧲', group: 'مبانی',
  render(el) {
    const f = paramForm([
      { key: 'Va', label: '|Va|', value: 1 }, { key: 'aa', label: '∠Va°', value: 0 }, { key: 'Vb', label: '|Vb|', value: 0.8 }, { key: 'ab', label: '∠Vb°', value: -125 },
      { key: 'Vc', label: '|Vc|', value: 1.05 }, { key: 'ac', label: '∠Vc°', value: 118 },
    ]);
    const out = h('div');
    const run = () => {
      const o = f.get(), va = polar(o.Va, (o.aa * Math.PI) / 180), vb = polar(o.Vb, (o.ab * Math.PI) / 180), vc = polar(o.Vc, (o.ac * Math.PI) / 180);
      const [v0, v1, v2] = phaseToSeq(va, vb, vc);
      out.innerHTML = '';
      out.append(kpis([['V0', `${fmt(cabs(v0), 4)}∠${fmt(deg(carg(v0)), 1)}°`, ''], ['V1', `${fmt(cabs(v1), 4)}∠${fmt(deg(carg(v1)), 1)}°`, ''], ['V2', `${fmt(cabs(v2), 4)}∠${fmt(deg(carg(v2)), 1)}°`, ''], ['ضریب نامتعادلی VUF = |V2|/|V1|', fmt((100 * cabs(v2)) / cabs(v1), 2), '%', cabs(v2) / cabs(v1) > 0.02 ? 'warn' : 'ok']]));
      const a = h('div'), b = h('div');
      out.append(grid(card('فازورهای فاز', a), card('مؤلفه‌های متقارن', b)));
      phasorPlot(a, [{ m: o.Va, a: o.aa, name: 'Va', color: '#e35d6a' }, { m: o.Vb, a: o.ab, name: 'Vb', color: '#f2c94c' }, { m: o.Vc, a: o.ac, name: 'Vc', color: '#4f9dff' }]);
      phasorPlot(b, [{ m: cabs(v0), a: deg(carg(v0)), name: 'V0', color: '#9bbf3b' }, { m: cabs(v1), a: deg(carg(v1)), name: 'V1', color: '#3ccf91' }, { m: cabs(v2), a: deg(carg(v2)), name: 'V2', color: '#ff6fb5' }]);
    };
    el.append(card('ورودی ولتاژهای سه‌فاز', f.el, btn('محاسبه', run)), out);
    run();
    // per unit
    const p = paramForm([{ key: 'Sb', label: 'S پایه', unit: 'MVA', value: 100 }, { key: 'Vb', label: 'V پایه', unit: 'kV', value: 230 }, { key: 'z', label: 'Z پریونیت قدیم', value: 0.1 }, { key: 'Sold', label: 'S قدیم', unit: 'MVA', value: 50 }, { key: 'Vold', label: 'V قدیم', unit: 'kV', value: 220 }]);
    const pOut = h('div');
    const runP = () => { const o = p.get(), r = perUnit(o); pOut.innerHTML = ''; pOut.append(kpis([['I پایه', fmt(r.Ib, 2), 'A'], ['Z پایه', fmt(r.Zb, 3), 'Ω'], ['Y پایه', fmt(r.Yb * 1e3, 4), 'mS'], ['Z در پایه جدید', fmt(changeBase(o.z, { Vold: o.Vold, Sold: o.Sold, Vnew: o.Vb, Snew: o.Sb }), 5), 'pu']])); };
    el.append(card('سیستم پریونیت و تغییر پایه', p.el, btn('محاسبه', runP), pOut, note('Z_pu,new = Z_pu,old (V_old/V_new)² (S_new/S_old)'))); runP();
  },
};
