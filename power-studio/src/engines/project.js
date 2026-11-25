// Real-project interconnection study (grid-impact assessment, as performed for TSO/DSO applications):
// steady state N-0/N-1, short-circuit level & SCR, voltage-step on project trip, hosting capacity,
// fault ride-through against a grid-code LVRT envelope (detailed dynamics, project as IBR),
// probabilistic annual energy yield (P50/P90) and project economics (LCOE, NPV, IRR, payback).
import { runPowerFlow } from './powerflow.js';
import { nMinus1 } from './contingency.js';
import { buildZbus, faultAt } from './shortcircuit.js';
import { simulateDetailed } from './dynamics.js';
import { cloneCase, indexCase } from './network.js';
import { windSeries, solarSeries } from './stochastic.js';
import { dcOpf } from './dispatch.js';

export const PROJECT_TYPES = { pv: 'نیروگاه خورشیدی', wind: 'مزرعه بادی', bess: 'ذخیره‌ساز باتری', load: 'بار صنعتی / دیتاسنتر', gas: 'نیروگاه گازی' };
export const DEFAULTS = {
  pv: { capex: 750, opex: 15, life: 25, degr: 0.005 }, wind: { capex: 1300, opex: 40, life: 25, degr: 0.002 },
  bess: { capex: 350, opex: 8, life: 15, degr: 0.02 }, gas: { capex: 900, opex: 25, life: 30, degr: 0, fuel: 35 }, load: { capex: 0, opex: 0, life: 20, degr: 0 },
};
// grid-code LVRT envelope (typical ENTSO-E RfG type D): time [s] after fault inception → min voltage [pu]
export const LVRT = [[0, 0], [0.15, 0], [0.15, 0.15], [1.5, 0.85], [10, 0.85]];
const lvrtMin = (t) => { for (let i = 1; i < LVRT.length; i++) if (t <= LVRT[i][0]) { const [t0, v0] = LVRT[i - 1], [t1, v1] = LVRT[i]; return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0); } return 0.85; };

export function withProject(cs, P, MW = P.MW) {
  const c = cloneCase(cs), b = c.bus.find((x) => x.id === P.bus);
  if (P.type === 'load') { b.Pd += MW; b.Qd += MW * Math.tan(Math.acos(P.pf || 0.95)); return c; }
  const qcap = (P.qcap ?? 0.33) * MW;
  const pre = runPowerFlow(cs, {}); const Vb = pre.converged ? pre.V[c.bus.indexOf(b)] : 1;
  c.gen.push({ bus: P.bus, Pg: P.type === 'bess' ? MW * (P.dispatch ?? 1) : MW, Qg: 0, Qmax: qcap, Qmin: -qcap, Vg: Math.min(1.05, Math.max(0.95, Vb)), mBase: MW, status: 1, Pmax: MW, Pmin: P.type === 'bess' ? -MW : 0, cost: [0, P.type === 'gas' ? DEFAULTS.gas.fuel : 0, 0], H: P.type === 'gas' ? 4 * MW / c.baseMVA : 0.1, xdp: P.type === 'gas' ? 0.25 * c.baseMVA / MW : 0.2 * c.baseMVA / MW, FOR: 0.03, project: true });
  if (b.type === 1) b.type = 2;
  return c;
}

export function hostingCapacity(cs, P, { maxMW = 5000, tol = 2 } = {}) {
  // criteria relative to the existing grid: PQ-bus voltages within limits (or not worse than base),
  // branch loading ≤ 100 % (or not worse than an already-overloaded base)
  const b0 = runPowerFlow(cs, {});
  const ok = (mw) => {
    const r = runPowerFlow(withProject(cs, P, mw), {});
    if (!r.converged) return false;
    const vOk = r.bus.every((b, i) => b.type !== 1 || (b.Vm <= Math.max(cs.bus[i].Vmax || 1.06, b0.V[i]) + 1e-6 && b.Vm >= Math.min(cs.bus[i].Vmin || 0.94, b0.V[i]) - 1e-6));
    const lOk = r.branch.every((b, l) => !(cs.branch[l]?.rateA > 0) || b.loading <= Math.max(100, b0.branch[l].loading) + 1e-6);
    return vOk && lOk;
  };
  if (!ok(0.001)) return { MW: 0, limit: 'شبکه پایه' };
  let lo = 0, hi = maxMW; if (ok(hi)) return { MW: hi, note: 'بیش از حد جست‌وجو' };
  while (hi - lo > tol) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  // identify binding constraint
  const r = runPowerFlow(withProject(cs, P, hi), {});
  let why = 'واگرایی پخش بار (حد پایداری ولتاژ)';
  if (r.converged) {
    const lk = r.branch.map((x, l) => ({ l, v: cs.branch[l]?.rateA > 0 ? x.loading - Math.max(100, b0.branch[l].loading) : -1 })).sort((x, y) => y.v - x.v)[0];
    const vb = r.bus.map((x, i) => ({ i, hi: x.type === 1 ? x.Vm - Math.max(cs.bus[i].Vmax || 1.06, b0.V[i]) : -1, lo: x.type === 1 ? Math.min(cs.bus[i].Vmin || 0.94, b0.V[i]) - x.Vm : -1 }));
    const vh = vb.sort((x, y) => y.hi - x.hi)[0], vl = [...vb].sort((x, y) => y.lo - x.lo)[0];
    if (lk && lk.v > 0) why = `اضافه‌بار حرارتی خط ${cs.branch[lk.l].from}-${cs.branch[lk.l].to}`;
    else if (vh.hi > 0) why = `اضافه‌ولتاژ باس ${cs.bus[vh.i].id}`;
    else if (vl.lo > 0) why = `افت ولتاژ باس ${cs.bus[vl.i].id}`;
  }
  return { MW: lo, limit: why };
}

function npvIrr(cash, rate) {
  const npv = (r) => cash.reduce((s, c, t) => s + c / (1 + r) ** t, 0);
  let lo = -0.9, hi = 1, irr = null;
  if (npv(lo) * npv(hi) < 0) { for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (npv(lo) * npv(m) <= 0) hi = m; else lo = m; } irr = (lo + hi) / 2; }
  let cum = 0, pay = null; cash.forEach((c, t) => { const prev = cum; cum += c; if (pay === null && prev < 0 && cum >= 0) pay = t - 1 + -prev / c; });
  return { NPV: npv(rate), IRR: irr, payback: pay };
}

/** Full study. P: {type, bus, MW, pf, qcap, lat, windC, windK, capex($/kW), opex($/kW·yr), life, rate, price ($/MWh or 'lmp'), co2 (t/MWh)} */
export function interconnectionStudy(cs, P, { dynamics = true, onStep = null } = {}) {
  const step = (s) => onStep?.(s);
  const R = { P, steps: [] }, idx = indexCase(cs), bi = idx.get(P.bus);
  step('پخش بار پایه و با پروژه');
  const base = runPowerFlow(cs, {}), cP = withProject(cs, P), post = runPowerFlow(cP, {});
  R.pf = {
    base: { V: base.V[bi], loss: base.lossP, maxL: base.maxLoading, Vmin: base.Vmin, Vmax: base.Vmax },
    post: { V: post.V?.[bi], loss: post.lossP, maxL: post.maxLoading, Vmin: post.Vmin, Vmax: post.Vmax, converged: post.converged },
    // only new or aggravated violations are attributed to the project
    violations: post.converged ? [
      ...post.bus.filter((b, i) => b.vViol && b.type === 1 && !base.bus[i].vViol).map((b) => `ولتاژ باس ${b.id} (${b.Vm.toFixed(3)} pu)`),
      ...post.branch.filter((b, l) => cs.branch[l]?.rateA > 0 && b.loading > 100 && b.loading > base.branch[l].loading + 0.5).map((b) => `خط ${b.from}-${b.to} (${b.loading.toFixed(0)}٪)`),
    ] : ['واگرایی پخش بار'],
  };
  step('تحلیل N-1');
  const n1b = base.converged ? nMinus1(cs, base, { includeGens: false }) : [], n1p = post.converged ? nMinus1(cP, post, { includeGens: false }) : [];
  const bad = (l) => l.filter((r) => r.diverged || r.overloads?.length || r.vViol?.length).length;
  R.n1 = { base: bad(n1b), post: bad(n1p), worst: n1p.filter((r) => r.converged).slice(0, 5).map((r) => ({ label: r.label, maxLoading: r.maxLoading, Vmin: r.Vmin })) };
  step('اتصال کوتاه و SCR');
  const Zb = buildZbus(cs, { iec: { cmax: 1.1 } }), sc0 = faultAt(cs, Zb, bi, '3PH', { c: 1.1 });
  const Sk = cabsS(sc0) * cs.baseMVA; // MVA
  const ibrContribution = P.type === 'load' ? 0 : P.type === 'gas' ? (P.MW / 0.85) / 0.2 : 1.2 * P.MW; // MVA
  R.sc = { SkBase: Sk, SkPost: Sk + ibrContribution, SCR: P.type === 'load' ? null : Sk / P.MW, kA: sc0.Ifault_kA, ip: sc0.ip_kA, weak: P.type !== 'load' && P.type !== 'gas' && Sk / P.MW < 3 };
  step('تغییر پله‌ای ولتاژ با خروج پروژه');
  R.vstep = post.converged && base.converged ? (100 * Math.abs(post.V[bi] - base.V[bi])) / base.V[bi] : null;
  const trip = runPowerFlow(cP, { outGens: new Set([cP.gen.length - 1]), init: post.converged ? { V: post.V, th: post.th } : undefined });
  if (P.type !== 'load' && trip.converged && post.converged) R.vstep = (100 * Math.max(...Array.from(trip.V, (v, i) => Math.abs(v - post.V[i])))) / 1;
  step('ظرفیت میزبانی');
  R.hosting = hostingCapacity(cs, { ...P, type: P.type === 'load' ? 'load' : P.type });
  if (dynamics && P.type !== 'load' && post.converged) {
    step('شبیه‌سازی دینامیکی عبور از خطا (LVRT)');
    const nb = cP.branch.map((b, k) => ({ b, k })).filter(({ b }) => b.from === P.bus || b.to === P.bus);
    const faultBusId = nb.length ? (nb[0].b.from === P.bus ? nb[0].b.to : nb[0].b.from) : P.bus;
    const ib = cP.gen.length - 1;
    const sim = simulateDetailed(cP, post, { tEnd: 3, dt: 0.004, ibr: P.type === 'gas' ? new Set() : new Set([ib]), events: [{ t: 0.1, type: 'fault', bus: idx.get(faultBusId), Zf: { re: 0, im: 0.02 } }, { t: 0.25, type: 'clear' }] });
    const vpoi = sim.busV.map((v) => v[bi]);
    const viol = sim.t.map((t, i) => (t >= 0.1 ? vpoi[i] < lvrtMin(t - 0.1) - 1e-3 : false)).some(Boolean);
    R.lvrt = { t: sim.t, v: vpoi, compliant: !viol, stable: sim.stable, faultBus: faultBusId, Vmin: Math.min(...vpoi), envelope: sim.t.map((t) => (t >= 0.1 ? lvrtMin(t - 0.1) : null)) };
  }
  if (P.type !== 'load') {
    step('انرژی سالانه احتمالاتی (P50/P90)');
    const years = [];
    for (let y = 0; y < 30; y++) {
      const prof = P.type === 'pv' ? solarSeries(8760, { lat: P.lat ?? 32, seed: 100 + y, clear: P.clear ?? 0.75 }).p
        : P.type === 'wind' ? windSeries(8760, { c: P.windC ?? 8.5, k: P.windK ?? 2, seed: 200 + y }).p
        : P.type === 'gas' ? new Float64Array(8760).fill(P.cfGas ?? 0.6) : new Float64Array(8760).map((_, h) => ((h % 24) >= 17 && (h % 24) < 21 ? 1 : 0));
      years.push(prof.reduce((a, b) => a + b, 0) * Math.min(P.MW, R.hosting.MW || P.MW) * (P.type === 'bess' ? 0.88 : 1));
    }
    years.sort((a, b) => b - a);
    const E50 = years[Math.floor(years.length * 0.5)], E90 = years[Math.floor(years.length * 0.9)];
    const curtail = P.MW > (R.hosting.MW || P.MW) ? 100 * (1 - (R.hosting.MW || P.MW) / P.MW) : 0;
    step('اقتصاد پروژه');
    const d = DEFAULTS[P.type], capex = (P.capex ?? d.capex) * P.MW * 1e3, opex = (P.opex ?? d.opex) * P.MW * 1e3, life = P.life ?? d.life, rate = P.rate ?? 0.08;
    let price = P.price ?? 60;
    if (P.price === 'lmp') { const o = dcOpf(cs); price = o.lmp[bi]; }
    const fuel = P.type === 'gas' ? (d.fuel) : 0, spread = P.type === 'bess' ? 0.5 : 1;
    const cash = [-capex];
    for (let t = 1; t <= life; t++) { const E = E50 * (1 - (d.degr) * t); cash.push(E * (price * spread - fuel) - opex); }
    const crf = (rate * (1 + rate) ** life) / ((1 + rate) ** life - 1);
    const LCOE = (capex * crf + opex) / E50 + fuel;
    R.energy = { E50, E90, CF: E50 / (8760 * P.MW), curtail, co2: P.type === 'gas' ? -E50 * 0.4 : E50 * (P.co2 ?? 0.55) };
    R.econ = { capex, LCOE, price, ...npvIrr(cash, rate), cash };
  }
  step('پایان');
  R.verdict = verdict(R);
  return R;
}
const cabsS = (r) => Math.hypot(r.I1.re, r.I1.im) * 1.1; // S''k = c·Ik'' (pu, Vf = c)

function verdict(R) {
  const issues = [];
  if (R.pf.violations.length) issues.push(`نقض حالت ماندگار: ${R.pf.violations.slice(0, 4).join('، ')}`);
  if (R.n1.post > R.n1.base) issues.push(`${R.n1.post - R.n1.base} پیشامد N-1 جدید ناامن`);
  if (R.sc.weak) issues.push(`شبکه ضعیف (SCR = ${R.sc.SCR.toFixed(2)} < 3) — نیاز به اینورتر شبکه‌ساز / STATCOM`);
  if (R.vstep !== null && R.vstep > 3) issues.push(`تغییر پله‌ای ولتاژ ${R.vstep.toFixed(2)}٪ > ۳٪`);
  if (R.lvrt && !R.lvrt.compliant) issues.push('عدم انطباق با منحنی LVRT');
  if (R.hosting.MW < R.P.MW) issues.push(`ظرفیت درخواستی بیش از ظرفیت میزبانی (${R.hosting.MW.toFixed(0)} MW، محدودیت: ${R.hosting.limit})`);
  return { ok: !issues.length, issues };
}

export function reportHTML(cs, R) {
  const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (+x).toFixed(d));
  const P = R.P;
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>گزارش مطالعه اتصال</title>
<style>body{font-family:Vazirmatn,Tahoma,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#172036}h1{font-size:22px}h2{font-size:16px;border-bottom:2px solid #2563eb;padding-bottom:4px;margin-top:28px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #dde3ef;padding:5px 8px;text-align:right}th{background:#f4f6fb}.ok{color:#0f9d68}.bad{color:#c53040}</style></head><body>
<h1>گزارش مطالعه اتصال به شبکه — ${PROJECT_TYPES[P.type]} ${P.MW} MW در باس ${P.bus}</h1>
<p>شبکه: ${cs.description} · تاریخ: ${new Date().toLocaleDateString('fa-IR')}</p>
<h2>نتیجه‌گیری</h2><p class="${R.verdict.ok ? 'ok' : 'bad'}"><b>${R.verdict.ok ? 'اتصال بدون نیاز به تقویت شبکه قابل تأیید است.' : 'اتصال مشروط به رفع موارد زیر است:'}</b></p><ul>${R.verdict.issues.map((i) => `<li>${i}</li>`).join('')}</ul>
<h2>حالت ماندگار</h2><table><tr><th></th><th>بدون پروژه</th><th>با پروژه</th></tr>
<tr><td>ولتاژ نقطه اتصال [pu]</td><td>${f(R.pf.base.V, 4)}</td><td>${f(R.pf.post.V, 4)}</td></tr><tr><td>تلفات [MW]</td><td>${f(R.pf.base.loss)}</td><td>${f(R.pf.post.loss)}</td></tr>
<tr><td>بیشترین بارگذاری خط [%]</td><td>${f(R.pf.base.maxL, 1)}</td><td>${f(R.pf.post.maxL, 1)}</td></tr><tr><td>پیشامدهای N-1 ناامن</td><td>${R.n1.base}</td><td>${R.n1.post}</td></tr></table>
<h2>اتصال کوتاه</h2><table><tr><td>سطح اتصال کوتاه پایه S″k</td><td>${f(R.sc.SkBase, 0)} MVA</td></tr><tr><td>پس از پروژه</td><td>${f(R.sc.SkPost, 0)} MVA</td></tr><tr><td>SCR</td><td>${f(R.sc.SCR)}</td></tr><tr><td>Ik″ / ip</td><td>${f(R.sc.kA)} / ${f(R.sc.ip)} kA</td></tr></table>
<h2>کیفیت ولتاژ و ظرفیت میزبانی</h2><table><tr><td>تغییر پله‌ای ولتاژ با خروج پروژه</td><td>${f(R.vstep)} %</td></tr><tr><td>ظرفیت میزبانی (N-0)</td><td>${f(R.hosting.MW, 0)} MW — ${R.hosting.limit || ''}</td></tr></table>
${R.lvrt ? `<h2>عبور از خطا (LVRT)</h2><p>خطای سه‌فاز ۱۵۰ میلی‌ثانیه در باس ${R.lvrt.faultBus}: کمینه ولتاژ نقطه اتصال ${f(R.lvrt.Vmin, 3)} pu — ${R.lvrt.compliant ? '<span class="ok">منطبق با منحنی LVRT</span>' : '<span class="bad">نامنطبق</span>'} — پایداری سیستم: ${R.lvrt.stable ? 'پایدار' : 'ناپایدار'}</p>` : ''}
${R.energy ? `<h2>انرژی و اقتصاد</h2><table><tr><td>انرژی P50 / P90</td><td>${f(R.energy.E50 / 1000, 1)} / ${f(R.energy.E90 / 1000, 1)} GWh/yr</td></tr><tr><td>ضریب ظرفیت</td><td>${f(R.energy.CF * 100, 1)} %</td></tr>
<tr><td>CAPEX</td><td>${f(R.econ.capex / 1e6, 1)} M$</td></tr><tr><td>LCOE</td><td>${f(R.econ.LCOE)} $/MWh</td></tr><tr><td>قیمت فروش</td><td>${f(R.econ.price)} $/MWh</td></tr>
<tr><td>NPV</td><td>${f(R.econ.NPV / 1e6, 1)} M$</td></tr><tr><td>IRR</td><td>${R.econ.IRR !== null ? f(R.econ.IRR * 100, 1) + ' %' : '—'}</td></tr><tr><td>بازگشت سرمایه</td><td>${f(R.econ.payback, 1)} سال</td></tr><tr><td>CO₂ اجتناب‌شده</td><td>${f(R.energy.co2 / 1000, 1)} kt/yr</td></tr></table>` : ''}
<p style="color:#5d6a87;font-size:12px">روش‌ها: پخش بار نیوتن-رافسون، N-1 کامل AC، IEC 60909 (c = 1.1)، دینامیک RMS دقیق با مدل اینورتر GFL و LVRT، تولید احتمالاتی ۳۰ ساله، اقتصاد با نرخ تنزیل ${((P.rate ?? 0.08) * 100).toFixed(1)}٪. — تولید شده با برق‌نما</p></body></html>`;
}
