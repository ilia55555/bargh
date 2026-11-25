// EMT studies view: capacitor switching, line energisation (travelling waves), fault & TRV, transformer inrush.
import { h, card, kpis, fmt, btn, paramForm, note, grid, table } from '../ui/dom.js';
import { EMT_STUDIES, runStudy } from '../engines/emt.js';
import { lineChart } from '../ui/charts.js';

const LBL = { kV: ['ولتاژ نامی', 'kV'], f: ['فرکانس', 'Hz'], Ssc: ['سطح اتصال کوتاه شبکه', 'MVA'], XR: ['X/R شبکه', ''], Qc: ['بانک خازنی ۱', 'Mvar'], tClose: ['لحظه بستن کلید', 's'], b2b: ['کلیدزنی پشت‌به‌پشت', ''], Qc2: ['بانک خازنی ۲', 'Mvar'], Lb: ['اندوکتانس میرا‌کننده', 'H'], tClose2: ['بستن بانک ۲', 's'], len: ['طول خط', 'km'], Zc: ['امپدانس موجی', 'Ω'], v: ['سرعت موج', 'km/s'], Rkm: ['مقاومت', 'Ω/km'], arrester: ['برقگیر MOV در انتهای خط', ''], Ures: ['سطح حفاظت برقگیر', 'pu'], Cs: ['ظرفیت شین', 'F'], Xkm: ['راکتانس', 'Ω/km'], tFault: ['لحظه خطا', 's'], tTrip: ['فرمان قطع', 's'], Pload: ['بار', 'MW'], Sn: ['توان ترانسفورماتور', 'MVA'], I0pct: ['جریان بی‌باری', '%'], satRatio: ['زانوی اشباع λk/λn', ''], Lair: ['اندوکتانس هسته هوایی', 'pu'], residual: ['شار پسماند فاز a', 'pu'], Rload: ['', ''] };

export default {
  id: 'emt', title: 'گذرای الکترومغناطیسی (EMT)', icon: '📈', group: 'دینامیک',
  render(el) {
    const sel = h('select', {}, Object.entries(EMT_STUDIES).map(([k, s]) => h('option', { value: k }, s.label)));
    const formBox = h('div'), out = h('div');
    let form = null;
    const mkForm = () => {
      const st = EMT_STUDIES[sel.value];
      form = paramForm(Object.entries(st.params).filter(([k]) => LBL[k]?.[0]).map(([k, v]) => ({ key: k, label: LBL[k][0], unit: LBL[k][1], value: v, type: typeof v === 'boolean' ? 'checkbox' : 'number' })));
      formBox.innerHTML = ''; formBox.append(form.el);
    };
    const run = () => {
      out.textContent = 'در حال شبیه‌سازی EMT…';
      setTimeout(() => {
        const t0 = performance.now(), r = runStudy(sel.value, form.get()), ms = performance.now() - t0;
        out.innerHTML = '';
        out.append(kpis([['زمان محاسبه', fmt(ms, 0), 'ms'], ...r.peaks.slice(0, 7).map((p) => [`پیک ${p.name}`, fmt(p.peak, 3), ''])]));
        const groups = {};
        r.probes.forEach((p) => { const k = p.name.replace(/^[A-Za-z]+[abc]?\s*/, '').trim() || p.name; (groups[k] = groups[k] || []).push(p); });
        const charts = Object.entries(groups).map(([k, ps]) => { const d = h('div'); lineChart(d, { series: ps.map((p, i) => ({ x: r.t.map((t) => t * 1000), y: p.y, name: p.name, color: ['#e35d6a', '#f2c94c', '#4f9dff', '#3ccf91'][i % 4] })), xLabel: 't [ms]', height: 280 }); return card(k, d); });
        for (let i = 0; i < charts.length; i += 2) out.append(grid(...charts.slice(i, i + 2)));
        out.append(note(EXPLAIN[sel.value]));
      }, 20);
    };
    sel.addEventListener('change', () => { mkForm(); run(); });
    el.append(card('مطالعه', h('div', { class: 'row' }, sel), formBox, btn('شبیه‌سازی', run)), out,
      note('روش Dommel: مدل‌های همراه ذوزنقه‌ای برای L و C، خط Bergeron با تاخیر موج و تضعیف بدون اعوجاج، کلید با قطع در صفر جریان، برقگیر اکسید فلزی با نیوتن-رافسون درون هر گام، اندوکتانس مغناطیس‌کنندگی اشباع‌پذیر دوشیب با شار پسماند. فازها بدون کوپلینگ متقابل مدل شده‌اند.'));
    mkForm(); run();
  },
};
const EXPLAIN = {
  capSwitch: 'بستن کلید بانک خازنی در قله ولتاژ موجب اضافه‌ولتاژ تا ≈۲ pu و جریان هجومی با فرکانس f₀ = 1/(2π√(LC)) می‌شود. در کلیدزنی پشت‌به‌پشت، اندوکتانس کم بین بانک‌ها جریان هجومی بسیار بزرگ با فرکانس چند کیلوهرتز تولید می‌کند؛ راکتور میراکننده آن را محدود می‌کند.',
  lineEnerg: 'موج ولتاژ با سرعت v در خط حرکت کرده و در انتهای باز دوبرابر بازتاب می‌شود (ضریب بازتاب +۱). برقگیر MOV اضافه‌ولتاژ را به سطح حفاظتی خود محدود می‌کند. اختلاف زمان بسته‌شدن قطب‌ها اضافه‌ولتاژ فازهای دیگر را تغییر می‌دهد.',
  faultTRV: 'خطای فاز a به زمین در انتهای خط؛ کلید پس از فرمان قطع در صفر جریان باز می‌شود و ولتاژ بازگشتی گذرا (TRV) بین کنتاکت‌ها با فرکانس طبیعی شبکه سمت منبع ظاهر می‌شود.',
  inrush: 'برق‌دار شدن ترانسفورماتور در صفر ولتاژ با شار پسماند موجب اشباع هسته و جریان هجومی نامتقارن غنی از هارمونیک دوم (چند برابر جریان نامی) می‌شود که با ثابت زمانی L/R میرا می‌شود.',
};
