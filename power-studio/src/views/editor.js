// Network editor: edit bus / generator / branch tables, import & export MATPOWER cases.
import { h, card, btn, note, download, kpis, fmt } from '../ui/dom.js';
import { state, mutateCase, setCase } from '../ui/state.js';
import { toMatpower, parseMatpower } from '../data/matpower.js';
import { caseSummary } from '../engines/network.js';

const SPEC = {
  bus: [['id', 'باس'], ['type', 'نوع (1 PQ/2 PV/3 Ref)'], ['Pd', 'Pd MW'], ['Qd', 'Qd Mvar'], ['Gs', 'Gs'], ['Bs', 'Bs'], ['Vmax', 'Vmax'], ['Vmin', 'Vmin'], ['baseKV', 'kV']],
  gen: [['bus', 'باس'], ['Pg', 'Pg'], ['Vg', 'Vset'], ['Qmax', 'Qmax'], ['Qmin', 'Qmin'], ['Pmax', 'Pmax'], ['Pmin', 'Pmin'], ['status', 'وضعیت'], ['H', 'H s'], ['xdp', "x'd"], ['cost.0', 'c2'], ['cost.1', 'c1'], ['cost.2', 'c0']],
  branch: [['from', 'از'], ['to', 'به'], ['r', 'r'], ['x', 'x'], ['b', 'b'], ['rateA', 'rateA'], ['ratio', 'tap'], ['angle', 'shift°'], ['status', 'وضعیت']],
};
const getp = (o, k) => k.split('.').reduce((a, p) => a?.[p], o);
const setp = (o, k, v) => { const ps = k.split('.'); let a = o; ps.slice(0, -1).forEach((p) => { a = a[p]; }); a[ps[ps.length - 1]] = v; };

export default {
  id: 'edit', title: 'ویرایشگر شبکه', icon: '✏️', group: 'داده',
  render(el) {
    const cs = state.cs, s = caseSummary(cs);
    el.append(kpis([['باس', s.buses, ''], ['شاخه', s.branches, ''], ['ژنراتور', s.gens, ''], ['ظرفیت تولید', fmt(s.Pcap, 0), 'MW'], ['بار', fmt(s.Pd, 1), 'MW']]));
    const file = h('input', { type: 'file', accept: '.m,.txt', style: 'display:none' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try { const c = parseMatpower(await f.text()); setCase('custom', c); } catch (e) { alert('خطا در خواندن فایل: ' + e.message); }
    });
    el.append(card('ورود / خروج داده', h('div', { class: 'row' }, btn('بارگذاری فایل MATPOWER (.m)', () => file.click()), btn('دریافت MATPOWER', () => download(`${cs.name}.m`, toMatpower(cs)), 'ghost'), btn('دریافت JSON', () => download(`${cs.name}.json`, JSON.stringify(cs, null, 1), 'application/json'), 'ghost')), file,
      note('هر فایل case استاندارد MATPOWER (نسخه ۲) پشتیبانی می‌شود. پس از ویرایش جدول‌ها «اعمال تغییرات» را بزنید تا پخش بار دوباره حل شود و همه ماژول‌ها به‌روز شوند.')));
    for (const [key, cols] of Object.entries(SPEC)) {
      const rows = cs[key];
      const tb = h('tbody');
      rows.forEach((r, i) => tb.append(h('tr', {}, h('td', { class: 'muted' }, i + 1), cols.map(([k]) => { const inp = h('input', { class: 'cell', value: getp(r, k) ?? '', 'data-k': k, 'data-i': i }); return h('td', {}, inp); }))));
      const tbl = h('table', { class: 'data edit' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), cols.map(([, l]) => h('th', {}, l)))), tb);
      const apply = () => mutateCase((c) => {
        tbl.querySelectorAll('input.cell').forEach((inp) => { const v = parseFloat(inp.value); if (Number.isFinite(v)) setp(c[key][+inp.dataset.i], inp.dataset.k, v); });
      });
      const add = () => mutateCase((c) => {
        const last = JSON.parse(JSON.stringify(c[key][c[key].length - 1]));
        if (key === 'bus') { last.id = Math.max(...c.bus.map((b) => b.id)) + 1; last.type = 1; last.Pd = 0; last.Qd = 0; }
        c[key].push(last);
      });
      el.append(card({ bus: 'باس‌ها', gen: 'ژنراتورها', branch: 'شاخه‌ها' }[key], h('div', { class: 'row' }, btn('اعمال تغییرات', apply), btn('افزودن ردیف', add, 'ghost')), h('div', { class: 'table-wrap tall' }, tbl)));
    }
  },
};
