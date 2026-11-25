// Application shell: case selector, navigation, routing between views.
import { h } from './ui/dom.js';
import { state, setCase, onChange } from './ui/state.js';
import { CASE_LIST } from './data/cases.js';
import home from './views/home3d.js';
import { acpf, dcpf } from './views/powerflow.js';
import { ed, opf } from './views/opf.js';
import sc from './views/faults.js';
import { transient, smib, modal } from './views/stability.js';
import vs from './views/voltage.js';
import n1 from './views/contingency.js';
import dist from './views/distribution.js';
import lfc from './views/frequency.js';
import rel from './views/reliability.js';
import prot from './views/protection.js';
import line from './views/line.js';
import mach from './views/machines.js';
import { pq, fundamentals } from './views/quality.js';
import edit from './views/editor.js';
import about from './views/about.js';
import circuit from './views/circuit.js';
import adv from './views/advopt.js';
import script from './views/script.js';
import emt from './views/emt.js';
import renew from './views/renewables.js';
import project from './views/project.js';

const VIEWS = [project, circuit, home, acpf, dcpf, ed, opf, adv, n1, sc, prot, transient, smib, modal, vs, lfc, emt, dist, rel, renew, line, mach, pq, fundamentals, edit, script, about];
let cleanup = null, current = null;

function shell() {
  const sel = h('select', { id: 'caseSel' }, CASE_LIST.map((c) => h('option', { value: c.key }, c.label)), h('option', { value: 'custom', disabled: true }, 'شبکه واردشده'));
  sel.value = state.caseKey;
  sel.addEventListener('change', () => setCase(sel.value));
  const status = h('span', { id: 'pfStatus', class: 'pill' });
  const theme = h('button', { class: 'icon-btn', title: 'تغییر تم', onclick: () => { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'light' ? 'dark' : 'light'; try { localStorage.setItem('ps-theme', r.dataset.theme); } catch { /* ignore */ } } }, '◐');
  const menuBtn = h('button', { class: 'icon-btn menu-btn', onclick: () => document.body.classList.toggle('nav-open') }, '☰');
  const groups = [...new Set(VIEWS.map((v) => v.group))];
  const nav = h('nav', { id: 'nav' }, groups.map((g) => h('div', { class: 'nav-group' }, h('div', { class: 'nav-title' }, g), VIEWS.filter((v) => v.group === g).map((v) => h('a', { href: '#' + v.id, 'data-id': v.id }, h('span', { class: 'ico' }, v.icon), v.title)))));
  const main = h('main', { id: 'main' });
  document.body.append(
    h('header', { class: 'topbar' }, menuBtn, h('div', { class: 'brand' }, h('span', { class: 'logo' }, '⚡'), h('div', {}, h('b', {}, 'برق‌نما'), h('small', {}, 'استودیوی مهندسی سیستم‌های قدرت'))), h('div', { class: 'top-right' }, h('label', { class: 'case-pick' }, 'شبکه: ', sel), status, theme)),
    h('div', { class: 'layout' }, nav, main),
  );
  onChange(() => { sel.value = state.caseKey; updateStatus(); route(true); });
}
function updateStatus() {
  const s = document.getElementById('pfStatus'), pf = state.pf;
  s.className = 'pill ' + (pf?.converged ? 'ok' : 'bad');
  s.textContent = pf?.converged ? `پخش بار ✓ ${pf.method} · ${pf.iterations} تکرار · تلفات ${pf.lossP.toFixed(2)} MW` : 'پخش بار همگرا نشد';
}
async function route(force = false) {
  const id = location.hash.slice(1) || 'circuit';
  const v = VIEWS.find((x) => x.id === id) || circuit;
  if (!force && current === v) return;
  current = v;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.id === v.id));
  document.body.classList.remove('nav-open');
  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = null;
  const main = document.getElementById('main');
  main.innerHTML = '';
  const body = h('div', { class: 'view' });
  main.append(h('div', { class: 'view-head' }, h('h1', {}, v.icon + ' ' + v.title), h('span', { class: 'muted' }, state.cs.description)), body);
  main.scrollTop = 0;
  try { const c = await v.render(body); if (current === v) cleanup = c || null; else c?.(); }
  catch (e) { console.error(e); body.append(h('div', { class: 'note bad' }, 'خطا: ' + e.message)); }
}
try { const t = localStorage.getItem('ps-theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }
shell();
setCase('case39');
window.addEventListener('hashchange', () => route());
window.addEventListener('pf-solved', updateStatus);
