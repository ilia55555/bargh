// N-1 security assessment (AC) and DC/LODF screening.
import { h, card, kpis, fmt, btn, note, table, grid } from '../ui/dom.js';
import { state } from '../ui/state.js';
import { nMinus1, dcScreening } from '../engines/contingency.js';
import { barChart } from '../ui/charts.js';
import { heatCss } from '../ui/layout.js';
import { mount3D } from '../ui/three-mount.js';
import { runPowerFlow } from '../engines/powerflow.js';

export default {
  id: 'n1', title: 'تحلیل پیشامد N-1', icon: '🛡️', group: 'امنیت',
  async render(el) {
    const cs = state.cs, pf = state.pf;
    if (!pf?.converged) { el.append(note('ابتدا پخش بار باید همگرا شود.', 'bad')); return; }
    const t0 = performance.now(), res = nMinus1(cs, pf), ms = performance.now() - t0;
    const insecure = res.filter((r) => r.diverged || (r.overloads?.length || r.vViol?.length));
    el.append(kpis([['تعداد پیشامد', res.length, ''], ['ناامن', insecure.length, '', insecure.length ? 'bad' : 'ok'], ['جزیره‌ساز', res.filter((r) => r.islanding).length, ''], ['واگرا', res.filter((r) => r.diverged).length, ''], ['زمان', fmt(ms, 0), 'ms']]));
    const v3 = h('div', { class: 'v3d-mid' });
    const ch = h('div');
    const valid = res.filter((r) => r.converged);
    el.append(card('شاخص عملکرد (PI) پیشامدها', ch));
    barChart(ch, { labels: valid.map((r) => r.label.replace('خط ', '').replace('ژنراتور باس ', 'G')), values: valid.map((r) => r.PI), colors: (v) => heatCss(Math.min(1, v / (valid[0]?.PI || 1))), rotate: true, height: 260 });
    let net = null;
    const show = (r) => {
      if (!net || !r.converged) return;
      const opts = r.kind === 'branch' ? { outages: new Set([r.idx]) } : { outGens: new Set([r.idx]) };
      const p = runPowerFlow(cs, { ...opts, init: { V: pf.V, th: pf.th } });
      net.build(cs, p, { outages: opts.outages || new Set() });
    };
    el.append(card('نمایش سه‌بعدی پیشامد انتخاب‌شده (روی ردیف جدول کلیک کنید)', v3));
    el.append(card('رتبه‌بندی پیشامدها', table([
      { key: 'label', label: 'پیشامد' },
      { fn: (r) => (r.islanding ? 'جزیره‌سازی' : r.diverged ? 'واگرایی' : r.overloads.length || r.vViol.length ? 'ناامن' : 'امن'), label: 'وضعیت', cls: (r) => (r.islanding || r.diverged || r.overloads?.length || r.vViol?.length ? 'bad' : 'ok') },
      { key: 'maxLoading', label: 'بیشینه بار %', d: 1 }, { key: 'Vmin', label: 'Vmin', d: 4 }, { key: 'Vmax', label: 'Vmax', d: 4 },
      { fn: (r) => (r.overloads?.length ? r.overloads.map((o) => `${cs.branch[o.k].from}-${cs.branch[o.k].to} (${o.loading.toFixed(0)}٪)`).join('، ') : '—'), label: 'اضافه‌بار' },
      { fn: (r) => (r.vViol?.length ? r.vViol.join('، ') : '—'), label: 'نقض ولتاژ' }, { key: 'PI', label: 'PI', d: 3 },
    ], res, { onRow: show })));
    const dc = dcScreening(cs);
    const d1 = h('div');
    el.append(card('غربالگری سریع DC با LODF (بدترین بارگذاری پس از خروج)', d1, note('f_l,post = f_l + LODF_l,k · f_k — محاسبه هزاران پیشامد بدون حل پخش بار.')));
    barChart(d1, { labels: dc.map((d) => d.label), values: dc.map((d) => d.worst), colors: (v) => heatCss(v / 100), hlines: [{ y: 100 }], rotate: true, height: 240 });
    net = await mount3D(v3, '../three/network3d.js', 'Network3D', {});
    if (net) { const first = res.find((r) => r.converged); if (first) show(first); else net.build(cs, pf); }
    return () => net?.dispose();
  },
};
