// Protection: IDMT overcurrent coordination with TCC, distance (mho) zones, differential relay.
import { h, card, kpis, fmt, btn, paramForm, note, table, grid } from '../ui/dom.js';
import { CURVES, coordinate, tccCurve, mhoZones, inMho, differential, tripTime } from '../engines/protection.js';
import { lineChart, PALETTE } from '../ui/charts.js';

export default {
  id: 'prot', title: 'حفاظت و هماهنگی رله', icon: '🔌', group: 'حفاظت و خطا',
  render(el) {
    const curveOpts = Object.keys(CURVES);
    const relays = [
      { name: 'R4 (انتها)', Ip: 100, curve: 'IEC SI', Ifmax: 2000 }, { name: 'R3', Ip: 200, curve: 'IEC SI', Ifmax: 3500 },
      { name: 'R2', Ip: 300, curve: 'IEC SI', Ifmax: 5500 }, { name: 'R1 (پست)', Ip: 400, curve: 'IEC SI', Ifmax: 8000 },
    ];
    const forms = relays.map((r) => paramForm([{ key: 'Ip', label: `${r.name}: جریان تنظیم`, unit: 'A', value: r.Ip }, { key: 'curve', label: 'منحنی', type: 'select', value: r.curve, options: curveOpts }, { key: 'Ifmax', label: 'بیشینه جریان خطا محل', unit: 'A', value: r.Ifmax }]));
    const g = paramForm([{ key: 'CTI', label: 'فاصله زمانی هماهنگی CTI', unit: 's', value: 0.3 }, { key: 'TMSmin', label: 'کمینه TMS', value: 0.05 }]);
    const out = h('div');
    const run = () => {
      const rs = coordinate(forms.map((f, i) => ({ name: relays[i].name, ...f.get() })), g.get());
      out.innerHTML = '';
      const tcc = h('div');
      out.append(card('منحنی‌های زمان–جریان (TCC) لگاریتمی', tcc));
      const Imax = Math.max(...rs.map((r) => r.Ifmax)) * 1.3;
      lineChart(tcc, {
        series: rs.map((r) => ({ ...tccCurve(r, r.Ip * 1.05, Imax), name: `${r.name} TMS=${r.TMS.toFixed(3)}` })),
        logX: true, logY: true, xLabel: 'جریان [A]', yLabel: 'زمان عملکرد [s]', height: 360, yMin: 0.01, yMax: 100,
        vlines: rs.map((r) => ({ x: r.Ifmax, label: '' })),
      });
      out.append(table([{ key: 'name', label: 'رله' }, { key: 'curve', label: 'منحنی' }, { key: 'Ip', label: 'Is [A]', d: 0 }, { key: 'TMS', label: 'TMS', d: 4 }, { key: 'tAtOwnFault', label: 't در خطای محل [s]', d: 3 },
        { fn: (r, i) => (i ? fmt(tripTime(r.curve, rs[i - 1].Ifmax / r.Ip, r.TMS) - tripTime(rs[i - 1].curve, rs[i - 1].Ifmax / rs[i - 1].Ip, rs[i - 1].TMS), 3) : '—'), label: 'CTI واقعی [s]' }], rs));
      out.append(note('IEC 60255: t = TMS·k/((I/Is)^α − 1) ؛ IEEE C37.112: t = TD·(A/(M^p − 1) + B). هماهنگی از انتهای فیدر به سمت منبع با حفظ CTI در بیشینه جریان خطای رله پایین‌دست.'));
    };
    el.append(card('هماهنگی رله‌های اضافه‌جریان فیدر شعاعی', g.el, ...forms.map((f) => f.el), btn('هماهنگی خودکار', run)), out);
    run();
    // distance
    const d = paramForm([{ key: 'R', label: 'R خط', unit: 'Ω', value: 4 }, { key: 'X', label: 'X خط', unit: 'Ω', value: 40 }, { key: 'k', label: 'محل خطا (کسر طول)', value: 0.6 }, { key: 'Rf', label: 'مقاومت خطا (دیده‌شده)', unit: 'Ω', value: 5 }]);
    const dOut = h('div');
    const runD = () => {
      const o = d.get(), ZL = { re: o.R, im: o.X }, zones = mhoZones(ZL), Zf = { re: o.k * o.R + o.Rf, im: o.k * o.X };
      const zone = zones.find((z) => inMho(Zf, z));
      dOut.innerHTML = '';
      dOut.append(kpis([['امپدانس دیده‌شده', `${fmt(Zf.re, 2)} + j${fmt(Zf.im, 2)}`, 'Ω'], ['ناحیه عملکرد', zone ? `Zone ${zone.zone}` : 'خارج', '', zone ? 'ok' : 'warn'], ['تأخیر', zone ? fmt(zone.delay, 2) : '—', 's']]));
      const c = h('div'); dOut.append(c);
      const circ = (z) => ({ x: Array.from({ length: 91 }, (_, i) => z.center.re + z.radius * Math.cos((i * 4 * Math.PI) / 180)), y: Array.from({ length: 91 }, (_, i) => z.center.im + z.radius * Math.sin((i * 4 * Math.PI) / 180)), name: `Zone ${z.zone}` });
      const R = zones[2].reach;
      lineChart(c, { series: [...zones.map(circ), { x: [0, o.R], y: [0, o.X], name: 'خط', color: '#fff', width: 2.5 }, { x: [Zf.re], y: [Zf.im], points: true, r: 6, name: 'Zخطا', color: '#e35d6a' }], equal: true, xMin: -R * 0.6, xMax: R * 0.8, yMin: -R * 0.2, yMax: R * 1.05, xLabel: 'R [Ω]', yLabel: 'X [Ω]', height: 340 });
    };
    // differential
    const df = paramForm([{ key: 'I1', label: 'I سمت ۱', unit: 'pu', value: 1.0 }, { key: 'I2', label: 'I سمت ۲ (جهت ورود)', unit: 'pu', value: -0.9 }, { key: 'k1', label: 'شیب ۱', value: 0.25 }, { key: 'k2', label: 'شیب ۲', value: 0.6 }]);
    const dfOut = h('div');
    const runDf = () => {
      const o = df.get(), r = differential(o.I1, o.I2, { k1: o.k1, k2: o.k2 });
      dfOut.innerHTML = '';
      dfOut.append(kpis([['Id', fmt(r.Id, 3), 'pu'], ['Ir', fmt(r.Ir, 3), 'pu'], ['آستانه', fmt(r.thr, 3), 'pu'], ['تصمیم', r.trip ? 'TRIP' : 'مسدود', '', r.trip ? 'bad' : 'ok']]));
      const c = h('div'); dfOut.append(c);
      const xs = Array.from({ length: 100 }, (_, i) => i * 0.08);
      lineChart(c, { series: [{ x: xs, y: xs.map((x) => differential(x, 0, { k1: o.k1, k2: o.k2 }).thr), name: 'مشخصه', fill: true, color: '#3ccf91' }, { x: [r.Ir], y: [r.Id], points: true, r: 6, name: 'نقطه کار', color: PALETTE[3] }], xLabel: 'جریان مهاری Ir [pu]', yLabel: 'جریان تفاضلی Id [pu]', height: 260, yMin: 0 });
    };
    el.append(grid(card('رله دیستانس (مشخصه مهو، سه ناحیه)', d.el, btn('ارزیابی', runD), dOut), card('رله دیفرانسیل درصدی دوشیبه', df.el, btn('ارزیابی', runDf), dfOut)));
    runD(); runDf();
  },
};
