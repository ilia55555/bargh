// Rotor-angle stability: multi-machine transient (with 3D playback & CCT), SMIB equal-area,
// and small-signal modal analysis (with 3D mode-shape animation).
import { h, card, kpis, fmt, btn, paramForm, note, table, grid } from '../ui/dom.js';
import { state } from '../ui/state.js';
import { simulateTransient, criticalClearingTime, equalArea, smibSwing } from '../engines/transient.js';
import { simulateDetailed } from '../engines/dynamics.js';
import { modalAnalysis } from '../engines/smallsignal.js';
import { lineChart } from '../ui/charts.js';
import { mount3D } from '../ui/three-mount.js';
import { indexCase } from '../engines/network.js';
import { phasorPlot } from './faults.js';

export const transient = {
  id: 'ts', title: 'پایداری گذرا (چندماشینه)', icon: '🌀', group: 'پایداری',
  async render(el) {
    const cs = state.cs, pf = state.pf, idx = indexCase(cs);
    if (!pf?.converged) { el.append(note('ابتدا پخش بار باید همگرا شود.', 'bad')); return; }
    const defBus = cs.name === 'case39' ? 16 : cs.name === 'case9' ? 7 : cs.bus[Math.floor(cs.bus.length / 2)].id;
    const brOpts = [[-1, 'بدون قطع خط']].concat(cs.branch.map((b, k) => [k, `${b.from}-${b.to}`]));
    const defBr = cs.branch.findIndex((b) => b.from === defBus || b.to === defBus);
    const f = paramForm([
      { key: 'bus', label: 'باس خطای سه‌فاز', type: 'select', numeric: true, value: defBus, options: cs.bus.map((b) => [b.id, `باس ${b.id}`]) },
      { key: 'tFault', label: 'لحظه وقوع', unit: 's', value: 0.1 }, { key: 'tClear', label: 'لحظه رفع', unit: 's', value: 0.2 },
      { key: 'trip', label: 'خط قطع‌شده هنگام رفع خطا', type: 'select', numeric: true, value: defBr, options: brOpts },
      { key: 'tEnd', label: 'زمان شبیه‌سازی', unit: 's', value: 4 }, { key: 'D', label: 'میرایی D', unit: 'pu', value: 0 },
      { key: 'model', label: 'مدل', type: 'select', value: 'detailed', options: [['detailed', 'دقیق: دومحوره + AVR + PSS + گاورنر'], ['classical', 'کلاسیک']] },
      { key: 'avr', label: 'AVR/تحریک (ST1A)', type: 'checkbox', value: true }, { key: 'pss', label: 'پایدارساز PSS', type: 'checkbox', value: true }, { key: 'gov', label: 'گاورنر TGOV1', type: 'checkbox', value: true },
      { key: 'ibr', label: 'ژنراتورهای تبدیل به اینورتر GFL (باس‌ها با کاما)', type: 'text', value: '' },
    ]);
    const out = h('div'), v3 = h('div', { class: 'v3d-mid' }), slider = h('input', { type: 'range', min: 0, max: 100, value: 0, class: 'wide' }), tlab = h('span', { class: 'mono' }, 't = 0');
    let net = null, sim = null;
    const run = () => {
      const o = f.get(), fb = idx.get(o.bus);
      if (o.model === 'classical') sim = simulateTransient(cs, pf, { faultBus: fb, tFault: o.tFault, tClear: o.tClear, tripBranch: o.trip, tEnd: o.tEnd, dt: 0.002, dampingD: o.D });
      else {
        const ibrBuses = new Set(o.ibr.split(/[,\s]+/).map(Number).filter(Boolean));
        const ibr = new Set(cs.gen.map((g, k) => (ibrBuses.has(g.bus) ? k : -1)).filter((k) => k >= 0));
        const events = [{ t: o.tFault, type: 'fault', bus: fb }, { t: o.tClear, type: 'clear' }];
        if (o.trip >= 0) events.push({ t: o.tClear, type: 'trip', branch: o.trip });
        const d = simulateDetailed(cs, pf, { events, tEnd: o.tEnd, dt: 0.004, avr: o.avr, pss: o.pss, gov: o.gov, ibr, par: { D: o.D } });
        const mx = d.delta.length ? Math.max(...d.delta.flatMap((x) => x)) - Math.min(...d.delta.flatMap((x) => x)) : 0;
        sim = { ...d, pe: d.Pe, maxSepDeg: mx };
      }
      sim.faultWindow = [o.tFault, o.tClear];
      out.innerHTML = '';
      out.append(kpis([['وضعیت', sim.stable ? 'پایدار' : 'ناپایدار', '', sim.stable ? 'ok' : 'bad'], ['بیشینه اختلاف زاویه', fmt(sim.maxSepDeg, 1), 'deg'], ['زمان رفع', fmt(o.tClear - o.tFault, 3), 's'], ['لحظه ناپایداری', sim.unstableAt !== null ? fmt(sim.unstableAt, 3) : '—', 's']]));
      const a = h('div'), w = h('div'), p = h('div');
      out.append(card('زاویه روتور نسبت به مرکز اینرسی (COI)', a), grid(card('سرعت روتور', w), card('توان الکتریکی', p)));
      const names = sim.machines.map((m) => 'G@' + m.bus);
      lineChart(a, { series: sim.delta.map((d, i) => ({ x: sim.t, y: d, name: names[i] })), xLabel: 't [s]', yLabel: 'δ − δCOI [deg]', height: 300, vlines: [{ x: o.tFault, label: 'خطا' }, { x: o.tClear, label: 'رفع' }] });
      lineChart(w, { series: sim.omega.map((d, i) => ({ x: sim.t, y: d.map((v) => (v - 1) * (cs.freq || 60)), name: names[i] })), xLabel: 't [s]', yLabel: 'Δf [Hz]', height: 240 });
      lineChart(p, { series: sim.pe.map((d, i) => ({ x: sim.t, y: d, name: names[i] })), xLabel: 't [s]', yLabel: 'Pe [pu]', height: 240 });
      if (sim.Vt) {
        const v = h('div'), e = h('div'), bv = h('div');
        out.append(grid(card('ولتاژ ترمینال ژنراتورها', v), card('ولتاژ میدان Efd (خروجی AVR)', e)), card('ولتاژ باس خطا و باس‌های مجاور', bv));
        lineChart(v, { series: sim.Vt.map((d, i) => ({ x: sim.t, y: d, name: names[i] })), xLabel: 't [s]', yLabel: 'Vt [pu]', height: 240 });
        lineChart(e, { series: sim.Efd.map((d, i) => ({ x: sim.t, y: d, name: names[i] })), xLabel: 't [s]', yLabel: 'Efd [pu]', height: 240 });
        const fb = idx.get(o.bus), nb = [fb, ...cs.branch.filter((b) => b.from === o.bus || b.to === o.bus).map((b) => idx.get(b.from === o.bus ? b.to : b.from))].slice(0, 6);
        lineChart(bv, { series: nb.map((i) => ({ x: sim.t, y: sim.busV.map((f) => f[i]), name: `باس ${cs.bus[i].id}` })), xLabel: 't [s]', yLabel: '|V| [pu]', height: 240 });
      }
      slider.max = sim.t.length - 1;
      if (net) { net.build(cs, pf, { faultBus: fb, outages: o.trip >= 0 ? new Set([o.trip]) : new Set() }); net.setPlayback(sim); net.onFrame = (k) => { slider.value = k; tlab.textContent = `t = ${sim.t[k].toFixed(2)} s`; }; }
    };
    const cctBox = h('div');
    const cct = () => {
      const o = f.get(); cctBox.textContent = 'در حال محاسبه…';
      setTimeout(() => { const r = criticalClearingTime(cs, pf, { faultBus: idx.get(o.bus), tripBranch: o.trip, dampingD: o.D }); cctBox.innerHTML = ''; cctBox.append(kpis([['زمان بحرانی رفع خطا (CCT)', fmt(r.cct, 3), 's', 'ok']]), r.note ? note(r.note) : ''); }, 30);
    };
    slider.addEventListener('input', () => { if (net?.playback) { net.playback.playing = false; net.setFrame(+slider.value); } });
    const playBtn = btn('▶︎/⏸ پخش', () => { if (net?.playback) net.playback.playing = !net.playback.playing; }, 'ghost');
    el.append(card('سناریوی خطا (مدل دقیق RMS یا کلاسیک)', f.el, h('div', { class: 'row' }, btn('شبیه‌سازی', run), btn('محاسبه CCT (دوبخشی)', cct, 'ghost')), cctBox),
      card('پخش سه‌بعدی: محل خطا با قوس الکتریکی و آتش؛ ارتفاع/رنگ باس = ولتاژ لحظه‌ای؛ ارتفاع ژنراتور = انحراف سرعت، رنگ = زاویه روتور', v3, h('div', { class: 'row' }, playBtn, slider, tlab)), out);
    run();
    net = await mount3D(v3, '../three/network3d.js', 'Network3D', {});
    if (net) { net.opts.particles = false; run(); }
    return () => net?.dispose();
  },
};

export const smib = {
  id: 'smib', title: 'معیار سطوح برابر (SMIB)', icon: '⚖️', group: 'پایداری',
  render(el) {
    const f = paramForm([
      { key: 'Pm', label: 'توان مکانیکی Pm', unit: 'pu', value: 0.9 }, { key: 'E', label: "E'", unit: 'pu', value: 1.2 }, { key: 'V', label: 'V∞', unit: 'pu', value: 1 },
      { key: 'X1', label: 'X قبل از خطا', unit: 'pu', value: 0.65 }, { key: 'X2', label: 'X حین خطا (∞ = خطای سه‌فاز ترمینال)', unit: 'pu', value: 1e9 }, { key: 'X3', label: 'X پس از رفع', unit: 'pu', value: 0.85 },
      { key: 'H', label: 'ثابت اینرسی H', unit: 's', value: 5 }, { key: 'f', label: 'فرکانس', unit: 'Hz', value: 50 }, { key: 'tc', label: 'زمان رفع خطا', unit: 's', value: 0.15 }, { key: 'D', label: 'میرایی', value: 0 },
    ]);
    const out = h('div');
    const run = () => {
      const o = f.get(), P1 = (o.E * o.V) / o.X1, P2 = (o.E * o.V) / o.X2, P3 = (o.E * o.V) / o.X3;
      const r = equalArea({ Pm: o.Pm, Pmax1: P1, Pmax2: P2, Pmax3: P3, H: o.H, f: o.f });
      out.innerHTML = '';
      if (r.stableImpossible) { out.append(note('Pm بزرگ‌تر از توان بیشینه پس از خطاست؛ سیستم پس از خطا نقطه تعادل ندارد.', 'bad')); return; }
      const sw = smibSwing({ Pm: o.Pm, Pmax1: P1, Pmax2: P2, Pmax3: P3, H: o.H, f: o.f, D: o.D, tc: o.tc, tEnd: 3 });
      const stable = Math.max(...sw.delta) < 180;
      out.append(kpis([['δ0', fmt((r.d0 * 180) / Math.PI, 2), 'deg'], ['δ بحرانی رفع', fmt((r.dc * 180) / Math.PI, 2), 'deg'], ['δmax', fmt((r.dmax * 180) / Math.PI, 2), 'deg'], ['زمان بحرانی رفع tc', r.tc ? fmt(r.tc, 4) : '—', 's'], ['نتیجه برای tc انتخابی', stable ? 'پایدار' : 'ناپایدار', '', stable ? 'ok' : 'bad']]));
      const pa = h('div'), sc = h('div');
      out.append(grid(card('منحنی P–δ و سطوح شتاب/ترمز', pa), card('منحنی نوسان (swing)', sc)));
      const ds = Array.from({ length: 181 }, (_, i) => i);
      const dcl = sw.t.findIndex((t) => t >= o.tc), dClear = dcl >= 0 ? sw.delta[dcl] : (r.dc * 180) / Math.PI;
      lineChart(pa, {
        series: [{ x: ds, y: ds.map((d) => P1 * Math.sin((d * Math.PI) / 180)), name: 'پیش از خطا' }, { x: ds, y: ds.map((d) => P2 * Math.sin((d * Math.PI) / 180)), name: 'حین خطا' }, { x: ds, y: ds.map((d) => P3 * Math.sin((d * Math.PI) / 180)), name: 'پس از خطا' }],
        hlines: [{ y: o.Pm, label: 'Pm' }], vlines: [{ x: dClear, label: 'δ رفع' }, { x: (r.dc * 180) / Math.PI, label: 'δc' }], xLabel: 'δ [deg]', yLabel: 'P [pu]', height: 300, yMin: 0,
        overlay: (g, sx, sy, s) => {
          const d0 = (r.d0 * 180) / Math.PI, dm = (r.dmax * 180) / Math.PI;
          let pA = `M${sx(d0)},${sy(o.Pm)}`; for (let d = d0; d <= dClear; d += 1) pA += `L${sx(d)},${sy(P2 * Math.sin((d * Math.PI) / 180))}`; pA += `L${sx(dClear)},${sy(o.Pm)}Z`;
          let pD = `M${sx(dClear)},${sy(o.Pm)}`; for (let d = dClear; d <= dm; d += 1) pD += `L${sx(d)},${sy(Math.max(o.Pm, P3 * Math.sin((d * Math.PI) / 180)))}`; pD += `L${sx(dm)},${sy(o.Pm)}Z`;
          g.append(s('path', { d: pA, fill: '#e35d6a', 'fill-opacity': 0.3 }), s('path', { d: pD, fill: '#3ccf91', 'fill-opacity': 0.3 }));
        },
      });
      lineChart(sc, { series: [{ x: sw.t, y: sw.delta, name: 'δ' }], xLabel: 't [s]', yLabel: 'δ [deg]', height: 300, vlines: [{ x: o.tc, label: 'رفع' }] });
      out.append(note('معیار سطوح برابر: A1 (شتاب، قرمز) = A2 (ترمز، سبز). cos δc = [Pm(δmax−δ0) + P3max cos δmax − P2max cos δ0] / (P3max − P2max). برای P2max = 0: tc = √(4H(δc−δ0)/(ωs Pm)).'));
    };
    el.append(card('سیستم تک‌ماشین–شین بی‌نهایت', f.el, btn('تحلیل', run)), out);
    run();
  },
};

export const modal = {
  id: 'ss', title: 'پایداری سیگنال کوچک', icon: '〰️', group: 'پایداری',
  async render(el) {
    const cs = state.cs, pf = state.pf;
    if (!pf?.converged) { el.append(note('ابتدا پخش بار باید همگرا شود.', 'bad')); return; }
    const f = paramForm([{ key: 'D', label: 'ضریب میرایی D همه ماشین‌ها', unit: 'pu', value: 2 }]);
    const out = h('div'), v3 = h('div', { class: 'v3d-mid' });
    let net = null, res = null;
    const showMode = (m) => { if (net && m.shape) { net.build(cs, pf, {}); net.setMode(m, res.machines); } };
    const run = () => {
      const o = f.get(); res = modalAnalysis(cs, pf, { D: o.D });
      out.innerHTML = '';
      const osc = res.modes.filter((m) => m.shape);
      const minZ = osc.reduce((a, m) => Math.min(a, m.zeta), 1);
      out.append(kpis([['تعداد مدهای نوسانی', osc.length, ''], ['کمترین میرایی', fmt(minZ * 100, 2), '%', minZ < 0.05 ? 'warn' : 'ok'], ['پایداری', res.eigen.every((e) => e.re < 1e-6) ? 'پایدار' : 'ناپایدار', '', res.eigen.every((e) => e.re < 1e-6) ? 'ok' : 'bad']]));
      const ev = h('div'), shapeEl = h('div');
      out.append(grid(card('مقادیر ویژه در صفحه s (خطوط ۵٪ و ۱۰٪ میرایی)', ev), card('شکل مد (مؤلفه‌های سرعت)', shapeEl)));
      const xs = res.eigen.map((e) => e.re), ys = res.eigen.map((e) => e.im), ymax = Math.max(...ys.map(Math.abs), 1) * 1.1, xmin = Math.min(...xs, -0.5) * 1.2;
      const zl = (z) => { const k = Math.tan(Math.acos(z)); return [{ x: [0, -ymax / k], y: [0, ymax] }, { x: [0, -ymax / k], y: [0, -ymax] }]; };
      lineChart(ev, { series: [{ x: xs, y: ys, points: true, name: 'λ', color: '#ff8a3d' }, ...zl(0.05).map((s) => ({ ...s, color: '#e35d6a', dash: '4 4' })), ...zl(0.1).map((s) => ({ ...s, color: '#f2c94c', dash: '4 4' }))], xMin: xmin, xMax: Math.max(0.5, ...xs) + 0.2, yMin: -ymax, yMax: ymax, xLabel: 'σ [1/s]', yLabel: 'jω [rad/s]', height: 300 });
      const names = res.machines.map((m) => 'G@' + m.bus);
      const pick = (m) => {
        shapeEl.innerHTML = '';
        phasorPlot(shapeEl, m.shape.map((s, i) => ({ m: s.mag, a: (s.ang * 180) / Math.PI, name: names[i], color: `hsl(${(i * 360) / m.shape.length},70%,60%)` })), { height: 300 });
        showMode(m);
      };
      out.append(card('جدول مدها (برای نمایش شکل مد و انیمیشن سه‌بعدی روی ردیف کلیک کنید)', table([
        { fn: (m) => `${fmt(m.re, 4)} ± j${fmt(m.im, 4)}`, label: 'λ' }, { key: 'f', label: 'f [Hz]', d: 3 }, { fn: (m) => m.zeta * 100, label: 'ζ [%]', d: 2, cls: (m) => (m.zeta < 0.05 ? 'warn' : '') },
        { fn: (m) => ({ 'inter-area': 'بین‌ناحیه‌ای', local: 'محلی', 'intra-plant': 'درون‌نیروگاهی', 'very-low': 'خیلی کم', real: 'حقیقی' })[m.type], label: 'نوع' },
        { fn: (m) => (m.pfac ? m.pfac.map((p, i) => [p, names[i]]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([p, n]) => `${n} (${(p * 100).toFixed(0)}٪)`).join('، ') : '—'), label: 'بیشترین مشارکت' },
      ], osc, { onRow: (m) => pick(m) })));
      out.append(note('مدل کلاسیک: Δδ̇ = ωs Δω ،  2H Δω̇ = −K Δδ − D Δω. K = ∂Pe/∂δ از شبکه کاهش‌یافته. مقادیر ویژه با الگوریتم QR (Hessenberg + Francis) و بردارهای ویژه با تکرار معکوس محاسبه می‌شوند.'));
      if (osc.length) pick(osc[osc.length - 1]);
    };
    el.append(card('تحلیل مدال', f.el, btn('محاسبه', run)), card('انیمیشن سه‌بعدی شکل مد (ارتفاع و رنگ ژنراتور = دامنه و فاز نوسان)', v3), out);
    run();
    net = await mount3D(v3, '../three/network3d.js', 'Network3D', {});
    if (net) { net.opts.particles = false; net.opts.height = 'flat'; const osc = res.modes.filter((m) => m.shape); if (osc.length) showMode(osc[osc.length - 1]); }
    return () => net?.dispose();
  },
};
