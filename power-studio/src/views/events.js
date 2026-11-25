// Sudden-event studies: generator loss, load step, line trip, faults — system frequency response,
// governor/AGC, UFLS/UVLS, generator protection cascade, BESS/EV/VSG fast response and MPC,
// grid-code compliance, 3D playback with fire at tripped units, validation against reference data.
import { h, card, kpis, fmt, btn, paramForm, note, grid, table, download } from '../ui/dom.js';
import { T } from '../ui/i18n.js';
import { state } from '../ui/state.js';
import { simulateDetailed } from '../engines/dynamics.js';
import { lineChart } from '../ui/charts.js';
import { mount3D } from '../ui/three-mount.js';
import { indexCase } from '../engines/network.js';
import { parseCSV, compare, autoShift } from '../engines/validation.js';

const ufls50 = [[49.0, 0.1], [48.8, 0.1], [48.6, 0.1], [48.4, 0.1], [48.2, 0.1]], ufls60 = [[59.3, 0.1], [59.0, 0.1], [58.7, 0.1], [58.4, 0.1], [58.1, 0.1]];

export default {
  id: 'events', title: T('Sudden events & frequency', 'رویدادهای ناگهانی و فرکانس'), icon: '🚨', group: T('Dynamics', 'دینامیک'),
  async render(el) {
    const cs = state.cs, pf = state.pf, idx = indexCase(cs), f0 = cs.freq || 60;
    if (!pf?.converged) { el.append(note(T('Power flow must converge first.', 'ابتدا پخش بار باید همگرا شود.'), 'bad')); return; }
    const gens = cs.gen.map((g, k) => ({ g, k })).filter(({ g }) => g.status > 0);
    const big = gens.reduce((a, b) => (b.g.Pg > a.g.Pg && b.g.bus !== 39 ? b : a), gens[0]);
    const lb = cs.bus.filter((b) => b.Pd > 0).sort((a, b) => b.Pd - a.Pd)[0];
    const f = paramForm([
      { key: 'ev', label: T('Event', 'رویداد'), type: 'select', value: 'gen', options: [['gen', T('Generator / power-plant trip', 'قطع نیروگاه')], ['gen2', T('Two generators trip (N-2)', 'قطع دو نیروگاه (N-2)')], ['load', T('Sudden load increase', 'افزایش ناگهانی بار')], ['line', T('Line trip', 'قطع خط')], ['fault', T('3-phase fault + line trip', 'خطای سه‌فاز + قطع خط')]] },
      { key: 'gen', label: T('Generator', 'ژنراتور'), type: 'select', numeric: true, value: big.k, options: gens.map(({ g, k }) => [k, `G@${g.bus} (${g.Pg.toFixed(0)} MW)`]) },
      { key: 'gen2', label: T('Second generator', 'ژنراتور دوم'), type: 'select', numeric: true, value: gens[(gens.indexOf(big) + 1) % gens.length].k, options: gens.map(({ g, k }) => [k, `G@${g.bus}`]) },
      { key: 'dP', label: T('Load step', 'پله بار'), unit: 'MW', value: Math.round(big.g.Pg) },
      { key: 'line', label: T('Line / fault branch', 'خط / شاخه خطا'), type: 'select', numeric: true, value: 0, options: cs.branch.map((b, k) => [k, `${b.from}-${b.to}`]) },
      { key: 'tEnd', label: T('Duration', 'مدت'), unit: 's', value: 20 },
      { key: 'load', label: T('Load model', 'مدل بار'), type: 'select', value: 'zip', options: [['zip', T('ZIP 20/30/50 + Kpf=1.5', 'ZIP + وابستگی فرکانسی')], ['z', T('Constant impedance', 'امپدانس ثابت')], ['motor', T('Motor-heavy (P const, Kpf=2)', 'بار موتوری')]] },
      { key: 'gov', label: T('Governors (primary control)', 'گاورنر (کنترل اولیه)'), type: 'checkbox', value: true },
      { key: 'agc', label: T('AGC (secondary control)', 'AGC (کنترل ثانویه)'), type: 'checkbox', value: true },
      { key: 'ufls', label: T('UFLS (under-frequency load shedding)', 'حذف بار فرکانسی UFLS'), type: 'checkbox', value: true },
      { key: 'uvls', label: T('UVLS (under-voltage load shedding)', 'حذف بار ولتاژی UVLS'), type: 'checkbox', value: true },
      { key: 'prot', label: T('Generator protection (UF/OF, pole slip)', 'حفاظت ژنراتور'), type: 'checkbox', value: true },
      { key: 'res', label: T('Fast resources', 'منابع سریع'), type: 'select', value: 'mpc', options: [['none', T('None', 'هیچ')], ['droop', T('BESS droop (FFR)', 'باتری دروپ')], ['vsg', T('Grid-forming VSG (virtual inertia)', 'اینورتر شبکه‌ساز VSG')], ['mpc', T('MPC: BESS + EV/V2G fleet', 'MPC: باتری + خودروی برقی')]] },
      { key: 'bessMW', label: T('BESS power', 'توان باتری'), unit: 'MW', value: 300 }, { key: 'bessMWh', label: T('BESS energy', 'انرژی باتری'), unit: 'MWh', value: 200 },
      { key: 'evN', label: T('EVs connected (V2G 7 kW)', 'تعداد خودرو متصل'), value: 20000 }, { key: 'evSoc', label: T('EV fleet SOC', 'SOC ناوگان'), value: 0.6 },
    ]);
    const out = h('div'), v3 = h('div', { class: 'v3d-mid' }), slider = h('input', { type: 'range', min: 0, max: 100, value: 0, class: 'wide' }), tlab = h('span', { class: 'mono' }, 't = 0');
    let net = null, sim = null;
    const refBox = h('div');
    const run = () => {
      const o = f.get();
      out.textContent = T('Simulating…', 'در حال شبیه‌سازی…');
      setTimeout(() => {
        const ev = [];
        const tEv = 1;
        if (o.ev === 'gen') ev.push({ t: tEv, type: 'genTrip', gen: o.gen });
        if (o.ev === 'gen2') ev.push({ t: tEv, type: 'genTrip', gen: o.gen }, { t: tEv, type: 'genTrip', gen: o.gen2 });
        if (o.ev === 'load') ev.push({ t: tEv, type: 'load', bus: -1, dP: o.dP });
        if (o.ev === 'line') ev.push({ t: tEv, type: 'trip', branch: o.line });
        if (o.ev === 'fault') { const br = cs.branch[o.line]; ev.push({ t: tEv, type: 'fault', bus: idx.get(br.from) }, { t: tEv + 0.1, type: 'clear' }, { t: tEv + 0.1, type: 'trip', branch: o.line }); }
        const loads = o.load === 'zip' ? { zP: 0.2, iP: 0.3, pP: 0.5, zQ: 0.2, iQ: 0.3, pQ: 0.5, Kpf: 1.5 } : o.load === 'motor' ? { zP: 0.1, iP: 0.1, pP: 0.8, zQ: 0.3, iQ: 0.2, pQ: 0.5, Kpf: 2 } : null;
        const stages = (f0 === 50 ? ufls50 : ufls60).map(([fz, frac]) => ({ f: fz, frac, delay: 0.15 }));
        const resources = [];
        if (o.res !== 'none') {
          resources.push({ bus: lb.id, kind: 'BESS', Pmax: o.bessMW, E: o.bessMWh, mode: o.res === 'mpc' ? 'mpc' : o.res, H: 6 });
          if (o.res === 'mpc' && o.evN > 0) { const Pev = (o.evN * 7) / 1000; const evBuses = cs.bus.filter((b) => b.Pd > 100).slice(0, 5); evBuses.forEach((b) => resources.push({ bus: b.id, kind: 'EV', Pmax: Pev / evBuses.length, E: (Pev / evBuses.length) * 6, soc0: o.evSoc, socMin: 0.3, mode: 'mpc', Tp: 0.3 })); }
        }
        const t0 = performance.now();
        sim = simulateDetailed(cs, pf, { tEnd: o.tEnd, dt: 0.005, events: ev, loads, gov: o.gov, agc: o.agc ? { Ki: 0.05 } : null, ufls: o.ufls ? stages : null, uvls: o.uvls ? { v: 0.85, delay: 1.5, frac: 0.15 } : null, genProt: o.prot ? { fmin: f0 * 0.95, fmax: f0 * 1.03, delay: 0.5 } : null, resources, mpc: o.res === 'mpc' ? { Ts: 0.1, N: 15 } : null });
        const ms = performance.now() - t0, m = sim.metrics;
        out.innerHTML = '';
        const dfAllowed = f0 === 50 ? 0.8 : 1.0;
        const ok = { nadir: f0 - m.nadir <= dfAllowed, rocof: m.rocofMax <= 1.0, ss: Math.abs(sim.f[sim.f.length - 1] - f0) <= 0.2 };
        out.append(kpis([
          [T('Outcome', 'نتیجه'), sim.blackout !== undefined ? T('BLACKOUT', 'خاموشی سراسری') : sim.stable ? T('Survived', 'پایدار ماند') : T('Unstable', 'ناپایدار'), '', sim.blackout !== undefined || !sim.stable ? 'bad' : 'ok'],
          [T('Frequency nadir', 'کف فرکانس'), fmt(m.nadir, 3), 'Hz', ok.nadir ? 'ok' : 'bad'], [T('Time of nadir', 'زمان کف'), fmt(m.tNadir, 2), 's'],
          [T('Max RoCoF', 'بیشینه RoCoF'), fmt(m.rocofMax, 3), 'Hz/s', ok.rocof ? 'ok' : 'bad'], [T('Final frequency', 'فرکانس نهایی'), fmt(sim.f[sim.f.length - 1], 3), 'Hz', ok.ss ? 'ok' : 'warn'],
          [T('Load shed', 'بار حذف‌شده'), fmt(m.shedMW, 0), 'MW', m.shedMW > 0 ? 'warn' : 'ok'], [T('Generators tripped', 'ژنراتورهای قطع‌شده'), sim.log.filter((l) => l.kind === 'trip').length, ''], [T('CPU time', 'زمان محاسبه'), fmt(ms, 0), 'ms'],
        ]));
        out.append(note(T(`Grid-code check (typical ENTSO-E/NERC): nadir deviation ≤ ${dfAllowed} Hz ${ok.nadir ? '✔' : '✘'} · RoCoF ≤ 1 Hz/s ${ok.rocof ? '✔' : '✘'} · quasi-steady deviation ≤ 0.2 Hz ${ok.ss ? '✔' : '✘'}`, `بررسی کد شبکه: انحراف کف ≤ ${dfAllowed} هرتز ${ok.nadir ? '✔' : '✘'} · RoCoF ≤ ۱ هرتز بر ثانیه ${ok.rocof ? '✔' : '✘'} · انحراف ماندگار ≤ ۰٫۲ هرتز ${ok.ss ? '✔' : '✘'}`), ok.nadir && ok.rocof ? '' : 'bad'));
        out.append(card(T('Event timeline (what the grid did)', 'خط زمانی رویدادها (واکنش شبکه)'), table([{ fn: (l) => fmt(l.t, 3) + ' s', label: T('Time', 'زمان') }, { key: 'text', label: T('Action', 'اقدام') }], sim.log)));
        const a = h('div'), b = h('div'), c = h('div'), d = h('div');
        out.append(card(T('System (COI) frequency', 'فرکانس سیستم (مرکز اینرسی)'), a), grid(card(T('Mechanical power & load shedding', 'توان مکانیکی و حذف بار'), b), card(T('Fast resources power', 'توان منابع سریع'), c)), card(T('Machine speeds & bus voltages', 'سرعت ماشین‌ها و ولتاژ باس‌ها'), d));
        lineChart(a, { series: [{ x: sim.t, y: sim.f, name: 'f [Hz]', width: 2.4 }], hlines: [{ y: f0 - dfAllowed, label: T('nadir limit', 'حد کف'), color: '#e35d6a' }, ...(o.ufls ? stages.map((s) => ({ y: s.f, color: '#f2c94c' })) : [])], xLabel: 't [s]', yLabel: 'Hz', height: 300 });
        lineChart(b, { series: [{ x: sim.t, y: sim.Pmtot, name: T('ΣPm generators [MW]', 'مجموع توان مکانیکی') }, { x: sim.t, y: sim.shed, name: T('Load shed [MW]', 'بار حذف‌شده'), dash: '5 4' }, { x: sim.t, y: sim.agc, name: 'AGC [MW]', dash: '2 3' }], xLabel: 't [s]', height: 240 });
        if (resources.length) lineChart(c, { series: [...resources.map((r, i) => ({ x: sim.t, y: sim.resP.map((p) => p[i]), name: `${r.kind}@${r.bus} [MW]` })), ...resources.map((r, i) => ({ x: sim.t, y: sim.resSOC.map((p) => p[i] * 100), name: `SOC ${r.kind}@${r.bus} [%]`, dash: '4 3' }))], xLabel: 't [s]', height: 240 });
        else c.append(note(T('No fast resources selected.', 'منبع سریعی انتخاب نشده.')));
        const vmin = sim.busV.map((v) => Math.min(...v));
        lineChart(d, { series: [...sim.omega.map((w, i) => ({ x: sim.t, y: w.map((x) => x * f0), name: 'G@' + sim.machines[i].bus, width: 1.2 })), { x: sim.t, y: vmin.map((v) => f0 * (0.9 + v * 0.1)), name: T('min bus V (scaled)', 'کمینه ولتاژ (مقیاس‌شده)'), dash: '5 4', color: '#fff' }], xLabel: 't [s]', yLabel: 'Hz', height: 260 });
        out.append(btn(T('Export frequency CSV', 'خروجی CSV فرکانس'), () => download('frequency.csv', 't,f,rocof,shed\n' + sim.t.map((t, i) => `${t},${sim.f[i]},${sim.rocof[i]},${sim.shed[i]}`).join('\n')), 'ghost'));
        slider.max = sim.t.length - 1;
        if (net) {
          net.build(cs, pf, { outages: new Set(ev.filter((e) => e.type === 'trip').map((e) => e.branch)), faultBus: o.ev === 'fault' ? idx.get(cs.branch[o.line].from) : null });
          sim.faultWindow = o.ev === 'fault' ? [tEv, tEv + 0.1] : [-1, -1];
          net.setPlayback(sim);
          const trips = sim.log.filter((l) => l.kind === 'trip');
          net.onFrame = (k) => { slider.value = k; const t = sim.t[k]; tlab.textContent = `t = ${t.toFixed(2)} s · f = ${sim.f[k].toFixed(3)} Hz`; trips.forEach((l) => net.setGenFire(l.k, t >= l.t)); };
        }
        compareRef();
      }, 30);
    };
    // validation against a reference trace
    let ref = null;
    const fileIn = h('input', { type: 'file', accept: '.csv,.txt', style: 'display:none' });
    fileIn.addEventListener('change', async () => { ref = parseCSV(await fileIn.files[0].text()); compareRef(); });
    function compareRef() {
      refBox.innerHTML = '';
      if (!ref || !sim) return;
      const col = ref.head[1], sh = autoShift(sim.t, sim.f, ref.t, ref.cols[col]), r = compare(sim.t, sim.f, ref.t, ref.cols[col], { shift: sh });
      refBox.append(kpis([['RMSE', fmt(r.RMSE, 4), 'Hz'], ['MAE', fmt(r.MAE, 4), 'Hz'], [T('Max error', 'بیشینه خطا'), fmt(r.MaxErr, 4), 'Hz'], ['NRMSE', fmt(r.NRMSE * 100, 2), '%'], [T('Correlation R', 'همبستگی'), fmt(r.R, 4), ''], [T('Nadir error', 'خطای کف'), fmt(r.nadirErr, 4), 'Hz'], [T('Time shift', 'جابجایی زمانی'), fmt(sh, 3), 's']]));
      const d = h('div'); refBox.append(d);
      lineChart(d, { series: [{ x: r.t, y: r.sim, name: T('Simulation', 'شبیه‌سازی') }, { x: r.t, y: r.ref, name: T('Reference', 'مرجع'), dash: '5 4' }], xLabel: 't [s]', yLabel: 'Hz', height: 240 });
    }
    slider.addEventListener('input', () => { if (net?.playback) { net.playback.playing = false; net.setFrame(+slider.value); } });
    el.append(card(T('Scenario & protection / control settings', 'سناریو و تنظیمات حفاظت/کنترل'), f.el, btn(T('Run event', 'اجرای رویداد'), run)), out,
      card(T('3D playback — tripped units burn, bus colours show voltage, generator height shows speed deviation', 'پخش سه‌بعدی — واحدهای قطع‌شده آتش می‌گیرند، رنگ باس = ولتاژ'), v3, h('div', { class: 'row' }, btn('▶︎/⏸', () => { if (net?.playback) net.playback.playing = !net.playback.playing; }, 'ghost'), slider, tlab)),
      card(T('Validate against measured / reference data (PMU, PSS/E, PowerFactory, Simulink)', 'اعتبارسنجی با داده مرجع / اندازه‌گیری'), h('div', { class: 'row' }, btn(T('Upload CSV (t, f)', 'بارگذاری CSV'), () => fileIn.click(), 'ghost'), btn(T('Use simulation copy with noise (demo)', 'نمونه آزمایشی'), () => { ref = { head: ['t', 'f'], t: sim.t.map((x) => x + 0.05), cols: { f: sim.f.map((x, i) => x + 0.004 * Math.sin(i / 7)) } }; compareRef(); }, 'ghost')), fileIn, refBox),
      note(T('Models: 6th-order machines with AVR/PSS/TGOV1, ZIP & frequency-dependent loads, staged UFLS, UVLS, generator UF/OF & pole-slip protection (cascades are simulated), AGC on ACE, BESS/EV fleets with SOC/ramp limits under droop, VSG or MPC (aggregated SFR prediction model, QP each 100 ms).', 'مدل‌ها: ماشین مرتبه ۶ با AVR/PSS/گاورنر، بار ZIP و وابسته به فرکانس، UFLS پله‌ای، UVLS، حفاظت فرکانسی و لغزش قطب ژنراتورها (آبشاری)، AGC، ناوگان باتری و خودرو با محدودیت SOC و نرخ، کنترل دروپ، VSG یا MPC.')));
    run();
    net = await mount3D(v3, '../three/network3d.js', 'Network3D', {});
    if (net) { net.opts.particles = false; run(); }
    return () => net?.dispose();
  },
};
