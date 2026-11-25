// Load-frequency control: one/two-area, governor/turbine, AGC, tie-line, BESS virtual inertia.
import { h, card, kpis, fmt, btn, paramForm, note, grid } from '../ui/dom.js';
import { simulateLFC } from '../engines/frequency.js';
import { lineChart } from '../ui/charts.js';

export default {
  id: 'lfc', title: 'کنترل فرکانس (LFC/AGC)', icon: '🎛️', group: 'دینامیک',
  render(el) {
    const f = paramForm([
      { key: 'areas', label: 'تعداد ناحیه', type: 'select', numeric: true, value: 2, options: [[1, 'یک ناحیه'], [2, 'دو ناحیه']] },
      { key: 'dPL', label: 'پله بار در ناحیه ۱', unit: 'pu', value: 0.1 }, { key: 'H', label: 'اینرسی H', unit: 's', value: 5 }, { key: 'D', label: 'میرایی بار D', unit: 'pu/pu', value: 1 },
      { key: 'R', label: 'دروپ R', unit: 'pu', value: 0.05 }, { key: 'Tg', label: 'گاورنر Tg', unit: 's', value: 0.2 }, { key: 'Tt', label: 'توربین Tt', unit: 's', value: 0.5 },
      { key: 'reheat', label: 'توربین بازگرمایش', type: 'checkbox', value: false }, { key: 'agc', label: 'AGC (انتگرال ACE)', type: 'checkbox', value: true }, { key: 'Ki', label: 'بهره AGC Ki', value: 0.3 },
      { key: 'T12', label: 'ضریب سنکرون‌کننده T12', unit: 'pu', value: 0.545 }, { key: 'Kvi', label: 'اینرسی مجازی BESS Kvi', value: 0 }, { key: 'Kd', label: 'دروپ سریع BESS Kd', value: 0 },
      { key: 'f0', label: 'فرکانس نامی', unit: 'Hz', value: 50 }, { key: 'tEnd', label: 'مدت', unit: 's', value: 40 },
    ]);
    const out = h('div');
    const run = () => {
      const o = f.get(), two = (v) => [v, v];
      const p = { areas: o.areas, H: two(o.H), D: two(o.D), R: two(o.R), Tg: two(o.Tg), Tt: two(o.Tt), reheat: o.reheat, agc: o.agc, Ki: two(o.Ki), T12: o.T12, dPL: [o.dPL, 0], f0: o.f0, tEnd: o.tEnd, Kvi: two(o.Kvi), Kd: two(o.Kd) };
      const r = simulateLFC(p), base = simulateLFC({ ...p, Kvi: [0, 0], Kd: [0, 0] });
      out.innerHTML = '';
      const m = r.metrics;
      out.append(kpis([['کف فرکانس (nadir)', fmt(m.nadir, 4), 'Hz', Math.abs(m.nadir) > 0.5 ? 'bad' : 'ok'], ['زمان nadir', fmt(m.tNadir, 2), 's'], ['RoCoF بیشینه', fmt(m.rocof, 4), 'Hz/s'], ['انحراف ماندگار', fmt(m.steady, 5), 'Hz'], ['نظری بدون AGC', fmt(m.ssTheory, 5), 'Hz'], ['زمان نشست (2٪)', m.settle !== null ? fmt(m.settle, 2) : '—', 's']]));
      const a = h('div'), b = h('div'), c = h('div');
      out.append(card('انحراف فرکانس', a), grid(card('توان مکانیکی/باتری', b), card('توان تبادلی خط ارتباطی', c)));
      const sr = r.df.map((d, i) => ({ x: r.t, y: d, name: `Δf${i + 1}` }));
      if (o.Kvi || o.Kd) sr.push({ x: base.t, y: base.df[0], name: 'Δf1 بدون BESS', dash: '5 4', color: '#888' });
      lineChart(a, { series: sr, xLabel: 't [s]', yLabel: 'Δf [Hz]', height: 280 });
      lineChart(b, { series: [...r.Pm.map((d, i) => ({ x: r.t, y: d, name: `ΔPm${i + 1}` })), ...(o.Kvi || o.Kd ? r.Pb.map((d, i) => ({ x: r.t, y: d, name: `PBESS${i + 1}`, dash: '3 3' })) : [])], xLabel: 't [s]', yLabel: 'pu', height: 240 });
      lineChart(c, { series: [{ x: r.t, y: r.Ptie, name: 'ΔPtie' }], xLabel: 't [s]', yLabel: 'pu', height: 240 });
      out.append(note('2H dΔf/dt = ΔPm + ΔPBESS − ΔPL − ΔPtie − DΔf ؛ گاورنر: ΔPg = (ΔPref − Δf/R)/(1+sTg) ؛ ACE = BΔf + ΔPtie با B = 1/R + D ؛ ΔṖtie = 2πT12(Δf1 − Δf2). اینرسی مجازی: PBESS = −Kvi·dΔf/dt − Kd·Δf (محدود).'));
    };
    el.append(card('پارامترهای مدل', f.el, btn('شبیه‌سازی', run)), out);
    run();
  },
};
