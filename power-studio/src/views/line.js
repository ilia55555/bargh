// Transmission line: geometry → parameters, long/π/short ABCD, operating point,
// voltage profile (Ferranti), power-angle, and a 3D tower/corridor model.
import { h, card, kpis, fmt, btn, paramForm, note, table, grid } from '../ui/dom.js';
import { lineGeometry, abcd, lineOperation, lineVoltageProfile, powerAngle } from '../engines/components.js';
import { lineChart } from '../ui/charts.js';
import { mount3D } from '../ui/three-mount.js';
import { cabs, carg, deg } from '../lib/complex.js';

export default {
  id: 'line', title: 'خط انتقال + برج سه‌بعدی', icon: '🗼', group: 'تجهیزات',
  async render(el) {
    const f = paramForm([
      { key: 'kV', label: 'ولتاژ نامی', unit: 'kV', value: 400 }, { key: 'f', label: 'فرکانس', unit: 'Hz', value: 50 }, { key: 'len', label: 'طول خط', unit: 'km', value: 300 },
      { key: 'cfg', label: 'آرایش فازها', type: 'select', value: 'flat', options: [['flat', 'افقی'], ['tri', 'مثلثی'], ['vert', 'عمودی']] },
      { key: 'D', label: 'فاصله فازها', unit: 'm', value: 11 }, { key: 'Hh', label: 'ارتفاع هادی', unit: 'm', value: 22 },
      { key: 'nb', label: 'تعداد هادی باندل', type: 'select', numeric: true, value: 2, options: [1, 2, 3, 4].map((x) => [x, x]) }, { key: 'sp', label: 'فاصله باندل', unit: 'm', value: 0.45 },
      { key: 'gmr', label: 'GMR هادی', unit: 'm', value: 0.0122 }, { key: 'rad', label: 'شعاع هادی', unit: 'm', value: 0.0159 }, { key: 'rac', label: 'مقاومت AC هر هادی', unit: 'Ω/km', value: 0.06 },
      { key: 'P', label: 'توان انتقالی', unit: 'MW', value: 600 }, { key: 'pf', label: 'ضریب توان بار (پس‌فاز)', value: 0.95 },
      { key: 'span', label: 'طول اسپن', unit: 'm', value: 350 }, { key: 'sag', label: 'شکم (Sag)', unit: 'm', value: 9 },
    ]);
    const out = h('div'), v3 = h('div', { class: 'v3d-mid' });
    let tower = null;
    const phases = (o) => o.cfg === 'flat' ? [[-o.D, o.Hh], [0, o.Hh], [o.D, o.Hh]] : o.cfg === 'tri' ? [[-o.D / 2, o.Hh], [o.D / 2, o.Hh], [0, o.Hh + o.D * 0.87]] : [[-4, o.Hh], [-4, o.Hh + o.D * 0.7], [-4, o.Hh + o.D * 1.4]];
    const run = () => {
      const o = f.get(), ph = phases(o);
      const g = lineGeometry({ phases: ph, gmr: o.gmr, radius: o.rad, nb: o.nb, spacing: o.sp, rac: o.rac, f: o.f });
      const z = { re: g.r_ohm_km, im: g.X_ohm_km }, y = { re: 0, im: g.B_uS_km * 1e-6 };
      const models = ['long', 'pi', 'short'].map((m) => ({ m, p: abcd(z, y, o.len, m) }));
      const ops = models.map(({ m, p }) => ({ m, ...lineOperation(p, { VR: o.kV, P: o.P, pf: o.pf }) }));
      const L = models[0].p;
      out.innerHTML = '';
      out.append(kpis([['L', fmt(g.L_mH_km, 4), 'mH/km'], ['C', fmt(g.C_nF_km, 3), 'nF/km'], ['X', fmt(g.X_ohm_km, 4), 'Ω/km'], ['امپدانس مشخصه |Zc|', fmt(cabs(L.Zc), 1), 'Ω'], ['SIL', fmt(ops[0].SIL_MW, 0), 'MW'], ['GMD', fmt(g.GMD, 3), 'm'], ['اثر فرانتی (بی‌باری)', fmt(ops[0].ferranti, 2), '%'], ['طول موج نسبی βl', fmt(deg(L.gamma.im * o.len), 2), 'deg']]));
      out.append(card('پارامترهای ABCD (مدل‌های مختلف)', table([{ key: 'm', label: 'مدل' }, { fn: (r) => `${fmt(cabs(r.p.A), 5)}∠${fmt(deg(carg(r.p.A)), 3)}°`, label: 'A = D' }, { fn: (r) => `${fmt(cabs(r.p.B), 3)}∠${fmt(deg(carg(r.p.B)), 2)}° Ω`, label: 'B' }, { fn: (r) => `${(cabs(r.p.Cc) * 1e3).toExponential(3)}∠${fmt(deg(carg(r.p.Cc)), 2)}° mS`, label: 'C' }], models.map((x) => ({ ...x, m: { long: 'خط بلند (توزیع‌شده)', pi: 'π اسمی', short: 'کوتاه' }[x.m] })))));
      out.append(card(`نقطه کار: ${o.P} MW در ${o.kV} kV`, table([{ key: 'm', label: 'مدل' }, { key: 'VS_kV', label: 'VS kV', d: 2 }, { key: 'dS', label: 'δ°', d: 2 }, { key: 'IS_A', label: 'IS A', d: 1 }, { key: 'PS_MW', label: 'PS MW', d: 2 }, { key: 'QS_Mvar', label: 'QS Mvar', d: 2 }, { key: 'loss_MW', label: 'تلفات MW', d: 3 }, { key: 'eff', label: 'راندمان %', d: 2 }, { key: 'reg', label: 'تنظیم ولتاژ %', d: 2 }], ops)));
      const vp = h('div'), pa = h('div');
      out.append(grid(card('پروفایل ولتاژ در طول خط (VR ثابت)', vp), card('منحنی توان–زاویه (VS = VR = نامی)', pa)));
      const nl = lineVoltageProfile(z, y, o.len, { VR: o.kV, P: 0 }), sil = lineVoltageProfile(z, y, o.len, { VR: o.kV, P: ops[0].SIL_MW, pf: 1 }), fl = lineVoltageProfile(z, y, o.len, { VR: o.kV, P: o.P, pf: o.pf });
      lineChart(vp, { series: [{ ...nl, name: 'بی‌باری (فرانتی)' }, { ...sil, name: 'بار طبیعی SIL' }, { ...fl, name: `${o.P} MW` }].map((s) => ({ x: s.x, y: s.v, name: s.name })), xLabel: 'فاصله از ابتدای خط [km]', yLabel: 'V [kV]', height: 260 });
      const pw = powerAngle(L, o.kV, o.kV);
      lineChart(pa, { series: [{ x: pw.pts.map((p) => p.d), y: pw.pts.map((p) => p.PR), name: 'PR' }], hlines: [{ y: o.P, label: 'P' }], xLabel: 'δ [deg]', yLabel: 'P [MW]', height: 260 });
      out.append(note(`L = 2×10⁻⁷ ln(GMD/GMR_eq)  ،  C = 2πε₀ / ln(GMD/r_eq)  ،  A = cosh γl ، B = Zc sinh γl ، C = sinh γl / Zc. بیشینه توان قابل انتقال ≈ ${fmt(pw.Pmax, 0)} MW.`));
      tower?.build({ phases: ph, nb: o.nb, spacing: o.sp, span: o.span, sag: o.sag, towers: 4 });
    };
    el.append(card('مشخصات هندسی و الکتریکی خط', f.el, btn('محاسبه', run)), card('مدل سه‌بعدی کریدور خط (رنگ/روشنایی هادی‌ها = جریان لحظه‌ای فازها)', v3), out);
    run();
    tower = await mount3D(v3, '../three/tower3d.js', 'Tower3D', {});
    if (tower) run();
    return () => tower?.dispose();
  },
};
