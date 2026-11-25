// Bilingual UI (English default, Persian optional).
// New code uses T('English', 'فارسی'); legacy Persian literals are translated at render time
// through a dictionary (exact strings, template patterns and longest-phrase substitution).
let DICT = null, PATTERNS = [], PHRASES = [];
export let LANG = (() => { try { return localStorage.getItem('ps-lang') || 'en'; } catch { return 'en'; } })();
export const T = (en, fa) => (LANG === 'fa' ? fa ?? en : en);
export function setLang(l) { LANG = l; try { localStorage.setItem('ps-lang', l); } catch { /* ignore */ } applyDir(); }
export function applyDir() { document.documentElement.lang = LANG; document.documentElement.dir = LANG === 'fa' ? 'rtl' : 'ltr'; }

export async function loadDict() {
  if (DICT) return;
  const { FA_EN } = await import('../data/i18n.js');
  DICT = new Map();
  for (const [fa, en] of Object.entries(FA_EN)) {
    if (fa.includes('${')) {
      const parts = fa.split(/\$\{[^}]*\}/), n = parts.length - 1;
      const re = new RegExp('^' + parts.map((p) => p.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')).join('(.+?)') + '$', 's');
      let k = 0; PATTERNS.push([re, en.replace(/\$\{[^}]*\}/g, () => `$${++k}`), n]);
    } else { DICT.set(fa.trim(), en); if (fa.trim().length >= 3) PHRASES.push([new RegExp('(?<![\\u0600-\\u06FF\\u200C])' + fa.trim().replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '(?![\\u0600-\\u06FF\\u200C])', 'g'), en, fa.trim()]); }
  }
  PHRASES.sort((a, b) => b[2].length - a[2].length);
}
const FA_RE = /[؀-ۿ]/;
export function tr(s) {
  if (!s || !FA_RE.test(s) || !DICT) return s;
  const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim();
  if (DICT.has(core)) return lead + DICT.get(core) + trail;
  for (const [re, rep] of PATTERNS) { const m = core.match(re); if (m) return lead + rep.replace(/\$(\d)/g, (_, i) => tr(m[+i])) + trail; }
  let out = core;
  for (const [re, en, fa] of PHRASES) if (out.includes(fa)) out = out.replace(re, en);
  out = out.replace(/٪/g, '%').replace(/،/g, ',').replace(/؛/g, ';').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  return lead + out + trail;
}
export function translateDOM(root) {
  if (LANG !== 'en' || !DICT) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = root;
  while (n) {
    if (n.nodeType === 3) { if (FA_RE.test(n.nodeValue) && n.parentElement?.tagName !== 'NOSCRIPT') n.nodeValue = tr(n.nodeValue); }
    else if (n.nodeType === 1) {
      for (const a of ['title', 'placeholder', 'aria-label']) { const v = n.getAttribute?.(a); if (v && FA_RE.test(v)) n.setAttribute(a, tr(v)); }
      if (n.tagName === 'OPTION' && FA_RE.test(n.textContent)) n.textContent = tr(n.textContent);
    }
    n = w.nextNode();
  }
}
let obs = null;
export function watch(root) {
  obs?.disconnect();
  if (LANG !== 'en') return;
  translateDOM(root);
  obs = new MutationObserver((ms) => { obs.disconnect(); ms.forEach((m) => { if (m.type === 'characterData') translateDOM(m.target.parentNode || m.target); m.addedNodes.forEach((x) => (x.nodeType === 1 || x.nodeType === 3) && translateDOM(x.nodeType === 3 ? x.parentNode : x)); }); obs.observe(root, { childList: true, subtree: true, characterData: true }); });
  obs.observe(root, { childList: true, subtree: true, characterData: true });
}
