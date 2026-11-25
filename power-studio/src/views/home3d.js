// 3D network dashboard: solved case in 3D, KPIs, inspector for clicked elements, scenario controls.
import { h, card, kpis, fmt, btn, paramForm, note, table } from '../ui/dom.js';
import { state, solve } from '../ui/state.js';
import { mount3D } from '../ui/three-mount.js';
import { caseSummary } from '../engines/network.js';
import { runPowerFlow } from '../engines/powerflow.js';
import { barChart } from '../ui/charts.js';
import { heatCss } from '../ui/layout.js';

export default {
  id: 'home', title: 'شبکه سه‌بعدی', icon: '🌐', group: 'نمای کلی',
  async render(el) {
    const cs = state.cs; let pf = state.pf;
    const sum = caseSummary(cs);
    const view = h('div', { class: 'v3d-big' });
    const info = h('div', { class: 'inspector' }, h('div', { class: 'muted' }, 'روی یک باس، خط یا ژنراتور کلیک کنید.'));
    const kp = h('div');
    const outages = new Set();
    const ctrl = paramForm([
      { key: 'height', label: 'ارتفاع باس‌ها', type: 'select', value: 'voltage', options: [['voltage', 'دامنه ولتاژ'], ['angle', 'زاویه ولتاژ'], ['flat', 'مسطح']] },
      { key: 'colorBy', label: 'رنگ خطوط', type: 'select', value: 'loading', options: [['loading', 'درصد بارگذاری'], ['none', 'ساده']] },
      { key: 'loadScale', label: 'ضریب بار سیستم', value: 1, step: 0.05 },
      { key: 'particles', label: 'ذرات جریان توان', type: 'checkbox', value: true },
      { key: 'surface', label: 'سطح ولتاژ (Landscape)', type: 'checkbox', value: false },
      { key: 'labels', label: 'برچسب‌ها', type: 'checkbox', value: true },
      { key: 'rotate', label: 'چرخش خودکار', type: 'checkbox', value: false },
    ], () => update());
    const legend = h('div', { class: 'legend3d' }, h('span', {}, 'کم'), h('i', { class: 'grad' }), h('span', {}, 'زیاد'), h('small', { class: 'muted' }, ' ولتاژ باس (بازه خودکار، حداقل 0.94–1.06 pu) · خطوط: بارگذاری 0→100٪'));
    const chartEl = h('div');
    el.append(
      h('div', { class: 'hero' }, h('div', {}, h('h2', {}, cs.description), h('p', { class: 'muted' }, `${sum.buses} باس · ${sum.branches} شاخه (${sum.transformers} ترانسفورماتور) · ${sum.gens} ژنراتور · بار ${fmt(sum.Pd, 1)} MW / ${fmt(sum.Qd, 1)} Mvar`)), kp),
      h('div', { class: 'split3d' }, h('div', { class: 'v3d-col' }, view, legend), h('div', { class: 'side-col' }, card('کنترل صحنه', ctrl.el, h('div', { class: 'row' }, btn('بازنشانی قطعی‌ها', () => { outages.clear(); update(); }, 'ghost'))), card('بازرس', info))),
      card('پروفایل ولتاژ باس‌ها', chartEl),
      note('سه‌بعدی: ارتفاع هر باس متناسب با ولتاژ (یا زاویه) است، ضخامت خط با توان اکتیو و رنگ با درصد بارگذاری. کره‌های زرد جهت و شدت جریان توان را نشان می‌دهند. حلقه‌های بنفش ترانسفورماتورند و مخروط‌های نارنجی بار. با کلیک روی یک خط می‌توانید آن را قطع/وصل کنید.'),
    );
    const net = await mount3D(view, '../three/network3d.js', 'Network3D', { onSelect: (u) => inspect(u) });
    const showKpi = () => {
      kp.innerHTML = '';
      if (!pf?.converged) { kp.append(note('پخش بار همگرا نشد' + (pf?.error ? ': ' + pf.error : ''), 'bad')); return; }
      kp.append(kpis([
        ['تلفات اکتیو', fmt(pf.lossP, 2), 'MW'], ['تلفات راکتیو', fmt(pf.lossQ, 1), 'Mvar'],
        ['کمینه ولتاژ', fmt(pf.Vmin, 4), 'pu', pf.Vmin < 0.95 ? 'warn' : 'ok'], ['بیشینه ولتاژ', fmt(pf.Vmax, 4), 'pu', pf.Vmax > 1.06 ? 'warn' : 'ok'],
        ['بیشترین بارگذاری خط', fmt(pf.maxLoading, 1), '%', pf.maxLoading > 100 ? 'bad' : pf.maxLoading > 80 ? 'warn' : 'ok'], ['تکرار ' + pf.method, pf.iterations, ''],
      ]));
    };
    const update = () => {
      const o = ctrl.get();
      pf = (o.loadScale === 1 && !outages.size) ? (state.pf || solve()) : runPowerFlow(cs, { ...state.pfOpts, loadScale: o.loadScale, genScale: o.loadScale, outages, flat: true });
      showKpi();
      if (net) { net.opts = { ...net.opts, ...o }; net.build(cs, pf?.converged ? pf : null, { outages }); }
      if (pf?.converged) barChart(chartEl, { labels: cs.bus.map((b) => b.id), values: Array.from(pf.V), yMin: Math.min(0.9, pf.Vmin - 0.01), yMax: Math.max(1.1, pf.Vmax + 0.01), colors: (v) => heatCss((v - 0.94) / 0.12), hlines: [{ y: 0.95 }, { y: 1.05 }], yLabel: 'V [pu]', xLabel: 'باس' });
    };
    const inspect = (u) => {
      info.innerHTML = '';
      if (!u) { info.append(h('div', { class: 'muted' }, 'چیزی انتخاب نشده.')); return; }
      if (u.kind === 'bus' && pf?.converged) {
        const b = pf.bus[u.i], d = cs.bus[u.i];
        info.append(h('h4', {}, `باس ${b.id}`), table([{ key: 'k', label: 'کمیت' }, { key: 'v', label: 'مقدار' }], [
          { k: 'نوع', v: ['', 'PQ', 'PV', 'Slack', 'ایزوله'][b.type] }, { k: '|V| [pu]', v: fmt(b.Vm, 4) }, { k: 'θ [deg]', v: fmt(b.Va, 3) },
          { k: 'Pd / Qd', v: `${fmt(b.Pd, 1)} / ${fmt(b.Qd, 1)}` }, { k: 'Pg / Qg', v: `${fmt(b.Pg, 1)} / ${fmt(b.Qg, 1)}` },
          { k: 'baseKV', v: d.baseKV || '—' }, { k: 'محدوده', v: `${d.Vmin} – ${d.Vmax}` },
        ]));
      } else if (u.kind === 'branch') {
        const br = cs.branch[u.k], r = pf?.branch[u.k];
        info.append(h('h4', {}, `شاخه ${br.from} → ${br.to}` + (br.ratio ? ' (ترانسفورماتور)' : '')), table([{ key: 'k', label: 'کمیت' }, { key: 'v', label: 'مقدار' }], [
          { k: 'r, x, b [pu]', v: `${br.r}, ${br.x}, ${br.b}` }, { k: 'tap / shift', v: `${br.ratio || 1} / ${br.angle || 0}°` },
          { k: 'Pf + jQf', v: r ? `${fmt(r.Pf, 1)} + j${fmt(r.Qf, 1)}` : '—' }, { k: 'تلفات', v: r ? `${fmt(r.lossP, 2)} MW` : '—' },
          { k: 'بارگذاری', v: r && br.rateA ? `${fmt(r.loading, 1)}٪ از ${br.rateA} MVA` : '—' },
        ]), btn(outages.has(u.k) ? 'وصل مجدد خط' : 'قطع این خط (سناریو)', () => { outages.has(u.k) ? outages.delete(u.k) : outages.add(u.k); update(); inspect(u); }, 'warn'));
      } else if (u.kind === 'gen') {
        const g = cs.gen[u.k], r = pf?.gens[u.k];
        info.append(h('h4', {}, `ژنراتور ${u.k + 1} (باس ${g.bus})`), table([{ key: 'k', label: 'کمیت' }, { key: 'v', label: 'مقدار' }], [
          { k: 'Pg [MW]', v: r ? fmt(r.Pg, 1) : g.Pg }, { k: 'Qg [Mvar]', v: r ? fmt(r.Qg, 1) : g.Qg }, { k: 'Pmax', v: g.Pmax }, { k: 'Qmin…Qmax', v: `${g.Qmin} … ${g.Qmax}` },
          { k: 'Vset', v: g.Vg }, { k: "H [s] / x'd [pu]", v: `${g.H} / ${g.xdp}` }, { k: 'هزینه', v: `${g.cost[0]}P² + ${g.cost[1]}P + ${g.cost[2]}` },
        ]));
      }
    };
    update();
    return () => net?.dispose();
  },
};
