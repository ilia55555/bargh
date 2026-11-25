// 3D circuit builder view: palette, placement, property editor, DC/AC/transient analysis.
import { h, card, kpis, fmt, btn, note, table, grid, download } from '../ui/dom.js';
import { mount3D } from '../ui/three-mount.js';
import { solveCircuit, sweep, transient, preset, PRESETS, TYPES, stress, thermalStep, AMBIENT } from '../engines/circuit.js';
import { lineChart } from '../ui/charts.js';

const UNIT = { R: 'Ω', LAMP: 'Ω', L: 'H', C: 'F', V: 'V', I: 'A' };
const si = (v, u) => { if (Math.abs(v) < 1e-9) return `0 ${u}`; const a = Math.abs(v); for (const [m, s] of [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']]) if (a >= m * 0.999) return `${+(v / m).toPrecision(4)} ${s}${u}`; return `${+v.toPrecision(3)} ${u}`; };
const parseSI = (s) => { const m = String(s).trim().replace('u', 'µ').match(/^([-+]?[\d.eE+-]+)\s*([pnµmkM]?)/); if (!m) return NaN; return +m[1] * ({ p: 1e-12, n: 1e-9, 'µ': 1e-6, m: 1e-3, k: 1e3, M: 1e6 }[m[2]] || 1); };

export default {
  id: 'circuit', title: 'مدارساز سه‌بعدی', icon: '🧩', group: 'نمای کلی',
  async render(el) {
    let comps; try { comps = JSON.parse(localStorage.getItem('ps-circuit')) || preset('pf'); } catch { comps = preset('pf'); }
    let sel = null, sol = null, nextId = comps.length + 100, f = 50, showLabels = true;
    const view = h('div', { class: 'v3d-big' }), props = h('div'), res = h('div'), charts = h('div');
    const tools = [['select', '🖱️ انتخاب'], ['W', '〰 سیم'], ['R', '▭ مقاومت'], ['C', '⊣⊢ خازن'], ['L', '➰ سلف'], ['V', '⎓ منبع DC'], ['VAC', '∿ منبع AC'], ['I', '⇢ منبع جریان'], ['LAMP', '💡 لامپ'], ['S', '⏻ کلید'], ['GND', '⏚ زمین'], ['delete', '🗑 حذف']];
    let tool = 'R';
    const palette = h('div', { class: 'palette' }, tools.map(([t, l]) => h('button', { class: 'tool' + (t === tool ? ' on' : ''), 'data-t': t, onclick: (e) => { tool = t; palette.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); c3?.setTool(t === 'VAC' ? 'V' : t); hint.textContent = HINT(t); } }, l)));
    const HINT = (t) => (t === 'select' ? 'روی قطعه کلیک کنید تا مقادیرش را تنظیم کنید.' : t === 'delete' ? 'روی قطعه کلیک کنید تا حذف شود.' : t === 'GND' ? 'روی یک نقطه برد کلیک کنید.' : 'روی دو نقطه از برد کلیک کنید تا قطعه بین آن‌ها قرار گیرد.');
    const hint = h('div', { class: 'muted small' }, HINT(tool));
    const presetSel = h('select', {}, h('option', { value: '' }, 'مدار آماده…'), PRESETS.map(([k, l]) => h('option', { value: k }, l)));
    presetSel.addEventListener('change', () => { if (presetSel.value) { comps = preset(presetSel.value); sel = null; update(); } });
    const fIn = h('input', { type: 'number', value: f, step: 'any' }); fIn.addEventListener('change', () => { f = +fIn.value || 50; update(); });
    const lblChk = h('input', { type: 'checkbox' }); lblChk.checked = true; lblChk.addEventListener('change', () => { showLabels = lblChk.checked; update(); });
    const file = h('input', { type: 'file', accept: '.json', style: 'display:none' });
    file.addEventListener('change', async () => { try { comps = JSON.parse(await file.files[0].text()); sel = null; update(); } catch (e) { alert(e.message); } });

    el.append(
      h('div', { class: 'split3d' },
        h('div', { class: 'v3d-col' }, palette, view, hint),
        h('div', { class: 'side-col' },
          card('مدار', h('div', { class: 'row' }, presetSel), h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'فرکانس منابع AC [Hz]'), fIn), h('label', { class: 'field check' }, h('span', { class: 'lbl' }, 'برچسب ولتاژ/جریان'), lblChk),
            h('div', { class: 'row' }, btn('تعمیر همه قطعات', () => { comps.forEach((c) => { c.burnt = false; c.temp = AMBIENT; }); update(); }, 'warn'), btn('پاک کردن', () => { comps = []; sel = null; update(); }, 'ghost'), btn('ذخیره JSON', () => download('circuit.json', JSON.stringify(comps, null, 1), 'application/json'), 'ghost'), btn('بارگذاری', () => file.click(), 'ghost')), file),
          card('ویژگی‌های قطعه', props))),
      res, charts,
      note('فیزیک واقعی: هر قطعه مقدار نامی دارد (توان مقاومت و لامپ، ولتاژ خازن الکترولیتی، جریان سیم/سلف/کلید/منبع). دما با مدل حرارتی مرتبه اول (T = Tamb + تنش×ΔTنامی با ثابت زمانی) بالا می‌رود؛ با عبور از حد تخریب، قطعه می‌سوزد، آتش و دود می‌گیرد و مدار باز می‌شود و مدار دوباره حل می‌شود. خازن الکترولیتی با ولتاژ معکوس DC منفجر می‌شود. رنگ نوارهای مقاومت با کد رنگ استاندارد از مقدار واقعی ساخته می‌شود و رنگ نور لامپ از دمای رنگ رشته تنگستن. نکات: پایانه + منابع، نقطه اول کلیک است. اگر قطعه زمین نگذارید، پایانه منفی اولین منبع مرجع ولتاژ است. اگر منبع AC وجود داشته باشد تحلیل فازوری در فرکانس داده‌شده انجام می‌شود (مقادیر RMS)؛ در غیر این صورت DC (خازن باز، سلف اتصال کوتاه). ذرات آبی جریان را نشان می‌دهند و رنگ گره‌ها ولتاژ را. مقادیر را با پیشوند وارد کنید: 100µ، 4.7k، 10m.'),
    );

    const c3 = await mount3D(view, '../three/circuit3d.js', 'Circuit3D', {
      onPlace: (a, b) => {
        const t = tool === 'VAC' ? 'V' : tool;
        if (!TYPES[t]) return;
        const c = { id: 'c' + nextId++, type: t, a, b, value: TYPES[t].def, rating: TYPES[t].rating };
        if (tool === 'VAC') { c.ac = true; c.value = 230; }
        if (t === 'V' && tool === 'V') c.value = 12;
        if (t === 'S') c.closed = true;
        comps.push(c); sel = c.id; update();
      },
      onSelect: (id, mode) => { if (mode === 'delete' && id) { comps = comps.filter((c) => c.id !== id); sel = null; } else sel = id; update(); },
    });
    c3?.setTool(tool);

    function editor() {
      props.innerHTML = '';
      const c = comps.find((x) => x.id === sel);
      if (!c) { props.append(h('div', { class: 'muted' }, 'قطعه‌ای انتخاب نشده. ابزار «انتخاب» را بزنید و روی قطعه کلیک کنید.')); return; }
      const r = sol?.ok ? sol.byId.get(c.id) : null;
      props.append(h('h4', {}, `${TYPES[c.type].label} (${c.id})`));
      if (UNIT[c.type]) {
        const inp = h('input', { value: si(c.value, '').trim() });
        inp.addEventListener('change', () => { const v = parseSI(inp.value); if (Number.isFinite(v) && (v > 0 || c.type === 'V' || c.type === 'I')) { c.value = v; update(); } else inp.value = si(c.value, '').trim(); });
        props.append(h('label', { class: 'field' }, h('span', { class: 'lbl' }, `مقدار [${UNIT[c.type]}]` + (c.type === 'V' && c.ac ? ' (RMS)' : '')), inp));
        const slider = h('input', { type: 'range', min: -2, max: 2, step: 0.01, value: 0, class: 'wide' });
        const base = c.value; slider.addEventListener('input', () => { c.value = base * 10 ** +slider.value; inp.value = si(c.value, '').trim(); update(true); });
        props.append(h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'تنظیم پیوسته (×0.01 … ×100)'), slider));
      }
      if (c.type === 'V' || c.type === 'I') {
        const acChk = h('input', { type: 'checkbox' }); acChk.checked = !!c.ac; acChk.addEventListener('change', () => { c.ac = acChk.checked; update(); });
        const ph = h('input', { type: 'number', value: c.phase || 0 }); ph.addEventListener('change', () => { c.phase = +ph.value; update(); });
        props.append(h('label', { class: 'field check' }, h('span', { class: 'lbl' }, 'متناوب (AC)'), acChk), h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'فاز [deg]'), ph));
      }
      if (Number.isFinite(TYPES[c.type].rating)) {
        const ri = h('input', { value: si(c.rating ?? TYPES[c.type].rating, '').trim() });
        ri.addEventListener('change', () => { const v = parseSI(ri.value); if (v > 0) { c.rating = v; update(); } });
        props.append(h('label', { class: 'field' }, h('span', { class: 'lbl' }, `مقدار نامی [${TYPES[c.type].rUnit}]` + (c.type === 'C' ? ' (ولتاژ کار، قطبی در DC)' : '')), ri));
        const T = c.temp ?? AMBIENT, s0 = sol?.ok ? stress(c, sol.byId.get(c.id), sol.ac) : 0;
        props.append(kpis([['دما', fmt(T, 0), '°C', c.burnt ? 'bad' : T > 120 ? 'warn' : 'ok'], ['تنش (نسبت به نامی)', fmt(s0, 2), '×', s0 > 1 ? 'bad' : 'ok'], ['وضعیت', c.burnt ? 'سوخته' : 'سالم', '', c.burnt ? 'bad' : 'ok']]));
        if (c.burnt) props.append(btn('تعویض قطعه (تعمیر)', () => { c.burnt = false; c.temp = AMBIENT; update(); }, 'warn'));
      }
      if (c.type === 'S') props.append(btn(c.closed ? 'باز کردن کلید' : 'بستن کلید', () => { c.closed = !c.closed; update(); }, 'warn'));
      if (r && c.type !== 'GND' && c.type !== 'W') props.append(table([{ key: 'k', label: 'کمیت' }, { key: 'v', label: 'مقدار' }], [
        { k: 'ولتاژ دو سر', v: si(r.Vm, 'V') + (sol.ac ? ` ∠${fmt((Math.atan2(r.V[1], r.V[0]) * 180) / Math.PI, 1)}°` : '') },
        { k: 'جریان', v: si(r.Im, 'A') + (sol.ac ? ` ∠${fmt((Math.atan2(r.I[1], r.I[0]) * 180) / Math.PI, 1)}°` : '') },
        { k: 'P', v: si(Math.abs(r.P), 'W') }, ...(sol.ac ? [{ k: 'Q', v: si(r.Q, 'var') }] : []),
        ...(c.type === 'C' && sol.ac ? [{ k: 'Xc = 1/ωC', v: si(1 / (sol.w * c.value), 'Ω') }] : []), ...(c.type === 'L' && sol.ac ? [{ k: 'XL = ωL', v: si(sol.w * c.value, 'Ω') }] : []),
      ]));
      props.append(h('div', { class: 'row' }, btn('حذف قطعه', () => { comps = comps.filter((x) => x.id !== c.id); sel = null; update(); }, 'ghost')));
    }

    function results() {
      res.innerHTML = ''; charts.innerHTML = '';
      if (!comps.length) { res.append(note('برد خالی است: یک مدار آماده انتخاب کنید یا قطعه بگذارید.')); return; }
      if (!sol.ok) { res.append(note(sol.error, 'bad')); return; }
      const srcs = comps.filter((c) => c.type === 'V');
      const s = srcs[0] ? sol.byId.get(srcs[0].id) : null;
      if (s) {
        const P = -s.P, Q = -s.Q, S = Math.hypot(P, Q);
        res.append(kpis([['نوع تحلیل', sol.ac ? `AC ${f} Hz` : 'DC', ''], ['جریان منبع', si(s.Im, 'A'), ''], ['توان اکتیو تحویلی', si(P, 'W'), ''], ...(sol.ac ? [['توان راکتیو', si(Q, 'var'), ''], ['ضریب توان', fmt(S ? Math.abs(P) / S : 1, 4), Q >= 0 ? 'پس‌فاز' : 'پیش‌فاز', S && Math.abs(P) / S < 0.9 ? 'warn' : 'ok'], ['امپدانس دیده‌شده', si(srcs[0].value / Math.max(s.Im, 1e-15), 'Ω'), '']] : [])]));
      }
      res.append(card('نتایج قطعات', table([
        { key: 'id', label: 'شناسه' }, { fn: (r) => TYPES[comps.find((c) => c.id === r.id).type].label, label: 'نوع' }, { fn: (r) => si(r.Vm, 'V'), label: '|V|' }, { fn: (r) => si(r.Im, 'A'), label: '|I|' }, { fn: (r) => si(r.P, 'W'), label: 'P' }, ...(sol.ac ? [{ fn: (r) => si(r.Q, 'var'), label: 'Q' }] : []),
      ], sol.comps.filter((r) => !['W', 'GND'].includes(comps.find((c) => c.id === r.id).type)), { onRow: (r) => { sel = r.id; update(); } })));
      const a = h('div'), b = h('div');
      charts.append(grid(card('پاسخ فرکانسی (جریان منبع AC)', a), card('پاسخ گذرا (روشن‌شدن مدار در t = 0)', b)));
      const sw = sweep(comps, { f1: 1, f2: 1e5 });
      if (sw) lineChart(a, { series: [{ x: sw.f, y: sw.I, name: '|I| [A]' }], logX: true, logY: true, xLabel: 'f [Hz]', yLabel: '|I| [A]', height: 240, vlines: [{ x: f, label: `${f} Hz` }] });
      else a.append(note('برای پاسخ فرکانسی یک منبع AC قرار دهید.'));
      const tau = Math.max(...comps.map((c) => (c.type === 'C' ? 1000 * c.value : c.type === 'L' ? c.value / 10 : 0)), 0);
      const tEnd = Math.min(1, Math.max(sol.ac ? 5 / f : 0.01, 6 * tau));
      const tr = transient(comps, { f, tEnd, dt: tEnd / 4000 });
      const pick = comps.find((c) => c.id === sel && c.type !== 'W' && c.type !== 'GND') || comps.find((c) => c.type === 'C') || comps.find((c) => c.type === 'R' || c.type === 'LAMP' || c.type === 'L');
      if (tr && pick) lineChart(b, { series: [{ x: tr.t.map((t) => t * 1000), y: tr.v.get(pick.id), name: `v ${pick.id} [V]` }, { x: tr.t.map((t) => t * 1000), y: tr.i.get(pick.id).map((x) => x * Math.max(1, Math.max(...tr.v.get(pick.id).map(Math.abs)) / Math.max(1e-12, ...tr.i.get(pick.id).map(Math.abs)) / 2)), name: `i ${pick.id} (مقیاس‌شده)`, dash: '5 4' }], xLabel: 't [ms]', height: 240 });
    }

    function update(light = false) {
      sol = comps.length ? solveCircuit(comps, { f }) : { ok: true, comps: [], byId: new Map(), nodeV: new Map() };
      try { localStorage.setItem('ps-circuit', JSON.stringify(comps)); } catch { /* ignore */ }
      c3?.build(comps, sol, sel, showLabels);
      if (!light) { editor(); results(); } else { results(); }
    }
    update();
    // real-time electro-thermal loop (10 Hz): heating, failure → open circuit → re-solve (cascading effects)
    let lastEd = 0;
    const timer = setInterval(() => {
      if (!sol?.ok || !comps.length) return;
      let failed = false;
      comps.forEach((c) => { const r = sol.byId.get(c.id); if (thermalStep(c, c.burnt ? 0 : stress(c, r, sol.ac), 0.1)) failed = true; });
      if (failed) { update(); return; }
      c3?.setThermal(comps);
      if (sel && Date.now() - lastEd > 500) { lastEd = Date.now(); const c = comps.find((x) => x.id === sel); if (c && document.activeElement?.tagName !== 'INPUT') editor(); }
    }, 100);
    return () => { clearInterval(timer); c3?.dispose(); };
  },
};
