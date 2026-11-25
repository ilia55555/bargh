// Tiny DOM helpers: element builder, forms, tables, cards and formatting.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const fmt = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v) ? '—' : !Number.isFinite(v) ? '∞' : Math.abs(v) >= 1e5 ? v.toExponential(2) : (+v).toFixed(d));

/**
 * Parameter form. fields: [{key, label, value, type:'number'|'select'|'checkbox'|'text', options, step, unit, hint}]
 * Returns {el, get()}.
 */
export function paramForm(fields, onChange) {
  const inputs = {};
  const el = h('div', { class: 'form-grid' }, fields.map((f) => {
    let inp;
    if (f.type === 'select') {
      inp = h('select', {}, (f.options || []).map((o) => {
        const [val, lab] = Array.isArray(o) ? o : [o, o];
        return h('option', { value: val, selected: String(val) === String(f.value) ? true : null }, lab);
      }));
    } else if (f.type === 'checkbox') {
      inp = h('input', { type: 'checkbox' }); inp.checked = !!f.value;
    } else {
      inp = h('input', { type: f.type || 'number', value: f.value, step: f.step || 'any' });
    }
    if (onChange) inp.addEventListener('change', onChange);
    inputs[f.key] = { inp, f };
    return h('label', { class: 'field' + (f.type === 'checkbox' ? ' check' : ''), title: f.hint || '' },
      h('span', { class: 'lbl' }, f.label, f.unit ? h('em', {}, ` [${f.unit}]`) : null), inp);
  }));
  const get = () => {
    const o = {};
    for (const [k, { inp, f }] of Object.entries(inputs)) {
      if (f.type === 'checkbox') o[k] = inp.checked;
      else if (f.type === 'select') o[k] = f.numeric ? +inp.value : inp.value;
      else if (f.type === 'text') o[k] = inp.value;
      else o[k] = parseFloat(inp.value);
    }
    return o;
  };
  return { el, get, inputs };
}

/** Data table. cols: [{key|fn, label, d (decimals), cls(row)=>class}] */
export function table(cols, rows, { max = 400, onRow = null, highlight = null } = {}) {
  const thead = h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c.label))));
  const tb = h('tbody');
  rows.slice(0, max).forEach((r, i) => {
    const tr = h('tr', { class: (highlight && highlight(r, i)) || '' }, cols.map((c) => {
      const v = c.fn ? c.fn(r, i) : r[c.key];
      const cls = c.cls ? c.cls(r, v) : '';
      return h('td', { class: cls }, typeof v === 'number' ? fmt(v, c.d ?? 3) : v instanceof Node ? v : v ?? '—');
    }));
    if (onRow) { tr.style.cursor = 'pointer'; tr.addEventListener('click', () => onRow(r, i)); }
    tb.append(tr);
  });
  const t = h('table', { class: 'data' }, thead, tb);
  return h('div', { class: 'table-wrap' }, t, rows.length > max ? h('div', { class: 'muted small' }, `… ${rows.length - max} ردیف دیگر`) : null);
}
export const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h3', {}, title) : null, ...kids);
export const kpis = (items) => h('div', { class: 'kpis' }, items.map(([label, value, unit, tone]) => h('div', { class: 'kpi ' + (tone || '') }, h('div', { class: 'kpi-l' }, label), h('div', { class: 'kpi-v' }, value, unit ? h('small', {}, ' ' + unit) : null))));
export const btn = (label, onclick, cls = '') => h('button', { class: 'btn ' + cls, onclick }, label);
export const note = (txt, cls = '') => h('div', { class: 'note ' + cls }, txt);
export const grid = (...kids) => h('div', { class: 'grid2' }, ...kids);
export const row = (...kids) => h('div', { class: 'row' }, ...kids);
export function busy(el, fn) {
  el.classList.add('busy');
  return new Promise((res) => setTimeout(() => { try { res(fn()); } finally { el.classList.remove('busy'); } }, 20));
}
export function download(name, text, type = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}
export function toCSV(cols, rows) {
  return [cols.map((c) => c.label).join(','), ...rows.map((r, i) => cols.map((c) => { const v = c.fn ? c.fn(r, i) : r[c.key]; return typeof v === 'number' ? v : `"${String(v ?? '').replace(/"/g, '""')}"`; }).join(','))].join('\n');
}
