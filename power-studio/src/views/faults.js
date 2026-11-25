// Short-circuit studies: symmetrical & unsymmetrical faults, sequence impedances, fault-level scan.
import { h, card, kpis, fmt, btn, paramForm, note, table, grid } from '../ui/dom.js';
import { state } from '../ui/state.js';
import { buildZbus, faultAt, faultScan, prefaultFromPF } from '../engines/shortcircuit.js';
import { barChart, lineChart } from '../ui/charts.js';
import { cabs, carg, deg, C } from '../lib/complex.js';
import { heatCss } from '../ui/layout.js';
import { mount3D } from '../ui/three-mount.js';

export default {
  id: 'sc', title: 'اتصال کوتاه', icon: '💥', group: 'حفاظت و خطا',
  async render(el) {
    const cs = state.cs, pf = state.pf;
    const Z = buildZbus(cs), pre = pf?.converged ? prefaultFromPF(pf) : null;
    const f = paramForm([
      { key: 'bus', label: 'باس خطا', type: 'select', numeric: true, value: cs.bus[Math.min(3, cs.bus.length - 1)].id, options: cs.bus.map((b) => [b.id, `باس ${b.id}`]) },
      { key: 'type', label: 'نوع خطا', type: 'select', value: '3PH', options: [['3PH', 'سه‌فاز متقارن'], ['SLG', 'تک‌فاز به زمین'], ['LL', 'دوفاز'], ['DLG', 'دوفاز به زمین']] },
      { key: 'Rf', label: 'مقاومت خطا Rf', unit: 'pu', value: 0 }, { key: 'Xf', label: 'راکتانس خطا Xf', unit: 'pu', value: 0 },
      { key: 'pre', label: 'ولتاژ پیش از خطا از پخش بار', type: 'checkbox', value: true },
    ]);
    const out = h('div'), v3 = h('div', { class: 'v3d-mid' });
    let net = null;
    const run = () => {
      const o = f.get(), k = cs.bus.findIndex((b) => b.id === o.bus);
      const r = faultAt(cs, Z, k, o.type, { Zf: C(o.Rf, o.Xf), prefault: o.pre ? pre : null });
      out.innerHTML = '';
      out.append(kpis([
        ['جریان خطا', fmt(r.Ifault_pu, 3), 'pu'], ['جریان خطا', r.Ifault_kA ? fmt(r.Ifault_kA, 2) : '—', 'kA'], ['سطح اتصال کوتاه', r.Sfault_MVA ? fmt(r.Sfault_MVA, 0) : '—', 'MVA'],
        ['X/R', fmt(r.XR, 2), ''], ['κ (IEC 60909)', fmt(r.kappa, 3), ''], ['ip/√2·I', r.Ifault_kA ? fmt(r.kappa * Math.SQRT2 * r.Ifault_kA, 2) : '—', 'kA پیک'],
      ]));
      const seq = [['Z1 (مثبت)', r.Zth.Z1], ['Z2 (منفی)', r.Zth.Z2], ['Z0 (صفر)', r.Zth.Z0]].map(([n, z]) => ({ n, re: z.re, im: z.im }));
      const cur = [['I0', r.I0], ['I1', r.I1], ['I2', r.I2], ['Ia', r.Iabc[0]], ['Ib', r.Iabc[1]], ['Ic', r.Iabc[2]]].map(([n, c]) => ({ n, m: cabs(c), a: deg(carg(c)) }));
      const ph = h('div'), vd = h('div');
      out.append(grid(card('امپدانس‌های تونن و جریان‌ها', table([{ key: 'n', label: 'دنباله' }, { key: 're', label: 'R pu', d: 5 }, { key: 'im', label: 'X pu', d: 5 }], seq), table([{ key: 'n', label: 'جریان' }, { key: 'm', label: '|I| pu', d: 4 }, { key: 'a', label: '∠ deg', d: 2 }], cur)), card('فازورهای جریان خطا', ph)));
      phasorPlot(ph, cur.slice(3).map((c, i) => ({ m: c.m, a: c.a, name: c.n, color: ['#e35d6a', '#f2c94c', '#4f9dff'][i] })));
      out.append(card('افت ولتاژ باس‌ها حین خطا (فاز a/b/c)', vd));
      barChart(vd, { labels: r.busV.map((b) => b.id), series: [{ values: r.busV.map((b) => b.Va), name: 'Va', color: '#e35d6a' }, { values: r.busV.map((b) => b.Vb), name: 'Vb', color: '#f2c94c' }, { values: r.busV.map((b) => b.Vc), name: 'Vc', color: '#4f9dff' }], yLabel: 'pu', height: 240 });
      net?.build(cs, null, { faultBus: k, busValues: { values: r.busV.map((b) => b.V1), lo: 0, hi: 1.05 } });
    };
    const scan = h('div');
    el.append(card('مطالعه خطا (روش Zbus)', f.el, btn('محاسبه', run)), out, card('نمای سه‌بعدی: رنگ باس = ولتاژ دنباله مثبت حین خطا', v3), card('سطح اتصال کوتاه همه باس‌ها', scan));
    const sc = faultScan(cs, Z, pre);
    const sEl = h('div'); scan.append(sEl, table([{ key: 'id', label: 'باس' }, { key: 'I3', label: 'I3φ pu', d: 3 }, { key: 'kA3', label: 'I3φ kA', d: 2 }, { key: 'S3', label: 'S3φ MVA', d: 0 }, { key: 'I1', label: 'ISLG pu', d: 3 }, { key: 'XR', label: 'X/R', d: 2 }], sc));
    const mx = Math.max(...sc.map((s) => s.I3));
    barChart(sEl, { labels: sc.map((s) => s.id), series: [{ values: sc.map((s) => s.I3), name: '3φ', color: '#e35d6a' }, { values: sc.map((s) => s.I1), name: 'SLG', color: '#4f9dff' }], yLabel: 'pu', height: 240, colors: undefined });
    void mx; void heatCss;
    el.append(note('فرضیات: Z2 = Z1؛ ژنراتورها با x′d؛ خطوط Z0 = 3·Z1؛ ترانسفورماتورهای واحد Δ (سمت ژنراتور) / Y زمین‌شده؛ بارها در مدل لحاظ نشده‌اند (مگر ولتاژ پیش از خطا). مطابق روش Zbus کلاسیک (Grainger & Stevenson).'));
    run();
    net = await mount3D(v3, '../three/network3d.js', 'Network3D', {});
    if (net) { net.opts.particles = false; net.opts.height = 'flat'; run(); }
    return () => net?.dispose();
  },
};

export function phasorPlot(el, ph, { height = 260 } = {}) {
  const R = Math.max(...ph.map((p) => p.m), 1e-9) * 1.15;
  lineChart(el, {
    series: [...ph.map((p) => ({ x: [0, p.m * Math.cos((p.a * Math.PI) / 180)], y: [0, p.m * Math.sin((p.a * Math.PI) / 180)], name: `${p.name} ${fmt(p.m, 3)}∠${fmt(p.a, 1)}°`, color: p.color, width: 3 })),
      { x: Array.from({ length: 73 }, (_, i) => R * Math.cos((i * 5 * Math.PI) / 180)), y: Array.from({ length: 73 }, (_, i) => R * Math.sin((i * 5 * Math.PI) / 180)), color: '#2a3550', dash: '3 3' }],
    xMin: -R, xMax: R, yMin: -R, yMax: R, equal: true, height,
    overlay: (g, sx, sy, s) => ph.forEach((p) => { const x = p.m * Math.cos((p.a * Math.PI) / 180), y = p.m * Math.sin((p.a * Math.PI) / 180); g.append(s('circle', { cx: sx(x), cy: sy(y), r: 4, fill: p.color })); }),
  });
}
