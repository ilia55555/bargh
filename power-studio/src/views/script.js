// Scripting console: run JavaScript against the engine API for batch studies.
import { h, card, btn, note, download } from '../ui/dom.js';
import { state } from '../ui/state.js';
import { lineChart } from '../ui/charts.js';
import * as PF from '../engines/powerflow.js';
import * as DC from '../engines/dcflow.js';
import * as DSP from '../engines/dispatch.js';
import * as ADV from '../engines/advopt.js';
import * as SC from '../engines/shortcircuit.js';
import * as TS from '../engines/transient.js';
import * as DYN from '../engines/dynamics.js';
import * as SS from '../engines/smallsignal.js';
import * as VS from '../engines/voltage.js';
import * as CT from '../engines/contingency.js';
import * as DI from '../engines/distribution.js';
import * as CIR from '../engines/circuit.js';
import { loadCase } from '../data/cases.js';
import { cloneCase } from '../engines/network.js';

const SAMPLE = `// مثال: مطالعه دسته‌ای — حساسیت تلفات و Vmin به ضریب بار
const cs = api.case();               // شبکه فعال (کپی)
const rows = [];
for (let k = 0.8; k <= 1.3; k += 0.05) {
  const r = api.PF.runPowerFlow(cs, { loadScale: k, genScale: k });
  rows.push({ k: +k.toFixed(2), loss: r.lossP, vmin: r.Vmin, ok: r.converged });
}
log(rows);
plot(rows.map(r => r.k), [{ y: rows.map(r => r.loss), name: 'تلفات MW' }], 'ضریب بار');
csv('sweep.csv', rows);`;

export default {
  id: 'script', title: 'کنسول اسکریپت', icon: '⌨️', group: 'داده',
  render(el) {
    let saved; try { saved = localStorage.getItem('ps-script'); } catch { /* ignore */ }
    const ta = h('textarea', { class: 'code', spellcheck: 'false' }); ta.value = saved || SAMPLE;
    const out = h('pre', { class: 'console' }), plots = h('div');
    const run = () => {
      out.textContent = ''; plots.innerHTML = '';
      try { localStorage.setItem('ps-script', ta.value); } catch { /* ignore */ }
      const log = (...a) => { out.textContent += a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, (k, v) => (typeof v === 'number' ? +v.toPrecision(6) : v instanceof Float64Array ? Array.from(v) : v), 1))).join(' ') + '\n'; };
      const plot = (x, series, xLabel = '') => { const d = h('div'); plots.append(card('', d)); lineChart(d, { series: series.map((s) => ({ x, ...s })), xLabel, height: 260 }); };
      const csv = (name, rows) => download(name, [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).join(','))].join('\n'));
      const api = { case: () => cloneCase(state.cs), pf: () => state.pf, loadCase, PF, DC, DSP, ADV, SC, TS, DYN, SS, VS, CT, DI, CIR };
      const t = performance.now();
      try { new Function('api', 'log', 'plot', 'csv', ta.value)(api, log, plot, csv); log(`— پایان (${(performance.now() - t).toFixed(0)} ms)`); }
      catch (e) { log('خطا: ' + e.message); }
    };
    el.append(card('اسکریپت (JavaScript)', ta, h('div', { class: 'row' }, btn('اجرا (Ctrl+Enter)', run), btn('نمونه', () => { ta.value = SAMPLE; }, 'ghost'))), card('خروجی', out), plots,
      note('دسترسی: api.case()، api.pf()، api.loadCase(name) و ماژول‌های PF، DC، DSP، ADV، SC، TS، DYN، SS، VS، CT، DI، CIR — توابع log، plot(x, series, xLabel) و csv(name, rows).'));
    ta.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'Enter') run(); });
  },
};
