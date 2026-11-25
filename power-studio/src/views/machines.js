// Transformers, induction motors and synchronous generators.
import { h, card, kpis, fmt, btn, paramForm, note, grid } from '../ui/dom.js';
import { transformerTests, inductionMotor, capability, powerAngleCurve } from '../engines/components.js';
import { lineChart } from '../ui/charts.js';

export default {
  id: 'mach', title: 'ترانسفورماتور و ماشین‌ها', icon: '⚙️', group: 'تجهیزات',
  render(el) {
    // Transformer
    const t = paramForm([
      { key: 'S', label: 'توان نامی', unit: 'kVA', value: 100 }, { key: 'V1', label: 'ولتاژ اولیه', unit: 'V', value: 11000 }, { key: 'V2', label: 'ولتاژ ثانویه', unit: 'V', value: 400 },
      { key: 'Voc', label: 'آزمون بی‌باری V (سمت LV)', unit: 'V', value: 400 }, { key: 'Ioc', label: 'I بی‌باری', unit: 'A', value: 5 }, { key: 'Poc', label: 'P بی‌باری', unit: 'W', value: 800 },
      { key: 'Vsc', label: 'آزمون اتصال کوتاه V (سمت HV)', unit: 'V', value: 550 }, { key: 'Isc', label: 'I اتصال کوتاه', unit: 'A', value: 9.09 }, { key: 'Psc', label: 'P اتصال کوتاه', unit: 'W', value: 1200 },
    ]);
    const tOut = h('div');
    const runT = () => {
      const o = t.get(), r = transformerTests({ ...o, S: o.S * 1000 });
      tOut.innerHTML = '';
      tOut.append(kpis([['Rc (LV)', fmt(r.Rc, 1), 'Ω'], ['Xm (LV)', fmt(r.Xm, 1), 'Ω'], ['Req (HV)', fmt(r.Req, 3), 'Ω'], ['Xeq (HV)', fmt(r.Xeq, 3), 'Ω'], ['Z%', fmt(r.Zpu * 100, 2), '%'], ['X/R', fmt(r.Xeq / r.Req, 2), ''], ['بار راندمان بیشینه', fmt(r.xMaxEff * 100, 1), '%'], ['تلفات مسی بار کامل', fmt(r.PcuFL, 0), 'W']]));
      const a = h('div'), b = h('div');
      tOut.append(grid(card('راندمان بر حسب بار', a), card('تنظیم ولتاژ بر حسب ضریب توان', b)));
      const xs = Array.from({ length: 60 }, (_, i) => 0.02 + i * 0.02);
      lineChart(a, { series: [1, 0.8, 0.6].map((pf) => ({ x: xs.map((x) => x * 100), y: xs.map((x) => r.eff(x, pf)), name: `pf=${pf}` })), xLabel: 'بار [%]', yLabel: 'η [%]', height: 240, vlines: [{ x: r.xMaxEff * 100, label: 'ηmax' }] });
      const pfs = Array.from({ length: 41 }, (_, i) => 0.2 + i * 0.02);
      lineChart(b, { series: [{ x: pfs, y: pfs.map((p) => r.reg(p, true)), name: 'پس‌فاز' }, { x: pfs, y: pfs.map((p) => r.reg(p, false)), name: 'پیش‌فاز' }], xLabel: 'ضریب توان', yLabel: 'تنظیم ولتاژ [%]', height: 240, hlines: [{ y: 0, color: '#888' }] });
    };
    el.append(card('ترانسفورماتور: مدار معادل از آزمون‌های بی‌باری و اتصال کوتاه', t.el, btn('محاسبه', runT), tOut));
    runT();
    // Induction motor
    const m = paramForm([{ key: 'V', label: 'ولتاژ خط', unit: 'V', value: 400 }, { key: 'f', label: 'فرکانس', unit: 'Hz', value: 50 }, { key: 'poles', label: 'تعداد قطب', value: 4 }, { key: 'R1', label: 'R1', unit: 'Ω', value: 0.3 }, { key: 'X1', label: 'X1', unit: 'Ω', value: 0.8 }, { key: 'R2', label: "R2'", unit: 'Ω', value: 0.25 }, { key: 'X2', label: "X2'", unit: 'Ω', value: 0.8 }, { key: 'Xm', label: 'Xm', unit: 'Ω', value: 30 }, { key: 's', label: 'لغزش کار', value: 0.03 }]);
    const mOut = h('div');
    const runM = () => {
      const o = m.get(), r = inductionMotor(o), op = r.op(o.s);
      mOut.innerHTML = '';
      mOut.append(kpis([['سرعت سنکرون', fmt(r.ns, 0), 'rpm'], ['گشتاور بیشینه', fmt(r.Tmax, 1), 'N·m'], ['لغزش گشتاور بیشینه', fmt(r.smax, 4), ''], ['گشتاور راه‌اندازی', fmt(r.Tstart, 1), 'N·m'], ['گشتاور کار', fmt(op.T, 1), 'N·m'], ['جریان', fmt(op.I1, 1), 'A'], ['ضریب توان', fmt(op.pf, 3), ''], ['راندمان', fmt(op.eff, 2), '%'], ['توان خروجی', fmt(op.Pout / 1000, 2), 'kW']]));
      const a = h('div'); mOut.append(a);
      lineChart(a, { series: [{ x: r.curve.map((c) => c.n), y: r.curve.map((c) => c.T), name: 'T(n)' }], vlines: [{ x: op.n, label: 'نقطه کار' }], xLabel: 'سرعت [rpm]', yLabel: 'گشتاور [N·m]', height: 260 });
    };
    // Synchronous capability
    const s = paramForm([{ key: 'Xs', label: 'راکتانس سنکرون Xs', unit: 'pu', value: 1.8 }, { key: 'Efmax', label: 'Ef بیشینه', unit: 'pu', value: 2.6 }, { key: 'Pmax', label: 'حد توربین', unit: 'pu', value: 0.95 }, { key: 'E', label: 'Ef کار', unit: 'pu', value: 1.8 }, { key: 'Pm', label: 'Pm', unit: 'pu', value: 0.8 }]);
    const sOut = h('div');
    const runS = () => {
      const o = s.get(), c = capability({ Xs: o.Xs, Efmax: o.Efmax, Pmax: o.Pmax }), pa = powerAngleCurve(o.E, 1, o.Xs, o.Pm);
      sOut.innerHTML = '';
      sOut.append(kpis([['زاویه بار δ', fmt(pa.d0, 2), 'deg'], ['Pmax = EV/Xs', fmt(pa.Pmax, 3), 'pu'], ['ضریب سنکرون‌کننده', fmt(pa.Pmax * Math.cos((pa.d0 * Math.PI) / 180), 3), 'pu/rad']]));
      const a = h('div'), b = h('div'); sOut.append(grid(card('نمودار توانایی P–Q', a), card('منحنی P–δ', b)));
      lineChart(a, { series: [{ x: c.arm.map((p) => p.Q), y: c.arm.map((p) => p.P), name: 'حد جریان آرمیچر' }, { x: c.field.map((p) => p.Q), y: c.field.map((p) => p.P), name: 'حد جریان میدان' }, { x: c.stab.map((p) => p.Q), y: c.stab.map((p) => p.P), name: 'حد پایداری عملی' }], hlines: [{ y: o.Pmax, label: 'حد توربین' }], xLabel: 'Q [pu] (−: زیرتحریک)', yLabel: 'P [pu]', height: 300, yMin: 0, yMax: 1.2, xMin: -1.2, xMax: 1.2 });
      lineChart(b, { series: [{ x: pa.pts.map((p) => p.d), y: pa.pts.map((p) => p.P), name: 'Pe(δ)' }], hlines: [{ y: o.Pm, label: 'Pm' }], vlines: [{ x: pa.d0, label: 'δ0' }], xLabel: 'δ [deg]', yLabel: 'P [pu]', height: 300 });
    };
    el.append(grid(card('موتور القایی (مدار معادل IEEE)', m.el, btn('محاسبه', runM), mOut), card('ژنراتور سنکرون (روتور استوانه‌ای)', s.el, btn('محاسبه', runS), sOut)));
    runM(); runS();
    el.append(note('مدار معادل تونن موتور القایی: T = 3Vth²(R2/s) / [ωs((Rth + R2/s)² + (Xth + X2)²)]. نمودار توانایی: دایره آرمیچر |S| = 1، دایره میدان به مرکز −V²/Xs و شعاع V·Efmax/Xs.'));
  },
};
