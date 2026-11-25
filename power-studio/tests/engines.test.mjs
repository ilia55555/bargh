// Numerical regression tests against published benchmark results.
import assert from 'node:assert/strict';
import { loadCase } from '../src/data/cases.js';
import { runPowerFlow } from '../src/engines/powerflow.js';
import { dcOpf, lambdaDispatch } from '../src/engines/dispatch.js';
import { buildZbus, faultAt } from '../src/engines/shortcircuit.js';
import { simulateTransient, equalArea } from '../src/engines/transient.js';
import { modalAnalysis } from '../src/engines/smallsignal.js';
import { bfsLoadFlow } from '../src/engines/distribution.js';
import { simulateLFC } from '../src/engines/frequency.js';
import { copt } from '../src/engines/reliability.js';
import { tripTime } from '../src/engines/protection.js';
import { eig, qpSolve } from '../src/lib/linalg.js';
import { parseMatpower, toMatpower } from '../src/data/matpower.js';
import { phaseToSeq, polar, cabs } from '../src/lib/complex.js';

let pass = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('✔', name); } catch (e) { console.error('✘', name, '\n  ', e.message); process.exitCode = 1; } };
const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

test('IEEE 14-bus NR matches published voltages/angles', () => {
  const r = runPowerFlow(loadCase('case14'), { flat: true });
  assert.ok(r.converged);
  near(r.bus[13].Vm, 1.036, 0.001, 'V14'); near(r.bus[13].Va, -16.04, 0.03, 'θ14');
  near(r.bus[0].Pg, 232.39, 0.05, 'slack P'); near(r.lossP, 13.393, 0.01, 'losses');
});
test('NR, FDLF and GS agree on IEEE 39-bus', () => {
  const cs = loadCase('case39'), a = runPowerFlow(cs, { flat: true }), b = runPowerFlow(cs, { method: 'FDLF', flat: true }), c = runPowerFlow(cs, { method: 'GS', flat: true });
  assert.ok(a.converged && b.converged && c.converged);
  for (let i = 0; i < 39; i++) { near(b.V[i], a.V[i], 1e-6); near(c.V[i], a.V[i], 1e-6); }
  assert.ok(a.iterations <= 8, 'NR quadratic convergence');
});
test('IEEE 39-bus voltages match MATPOWER solution', () => {
  const r = runPowerFlow(loadCase('case39'), { flat: true, enforceQ: false });
  near(r.bus[0].Vm, 1.0393836, 2e-5); near(r.bus[0].Va, -13.536602, 2e-3); near(r.bus[30].Pg, 677.871, 0.05);
});
test('WSCC 9-bus slack generation 71.64 MW', () => { near(runPowerFlow(loadCase('case9')).bus[0].Pg, 71.64, 0.02); });
test('IEEE 33-bus BFS: 202.67 kW losses, Vmin 0.9131 at bus 18', () => {
  const r = bfsLoadFlow(loadCase('case33bw'));
  near(r.lossKW, 202.67, 0.1); near(r.Vmin, 0.9131, 2e-4); assert.equal(r.VminBus, 18);
  const nr = runPowerFlow(loadCase('case33bw'));
  near(nr.lossP * 1000, r.lossKW, 0.05, 'NR vs BFS');
});
test('case9 DC-OPF matches MATPOWER rundcopf (5216.03 $/h)', () => {
  const r = dcOpf(loadCase('case9'));
  near(r.totalCost, 5216.03, 0.05); near(r.Pg[0], 86.56, 0.02); near(r.Pg[1], 134.38, 0.02);
});
test('λ-iteration equals QP solution without network limits', () => {
  const cs = loadCase('case9'), e = lambdaDispatch(cs.gen, 315), o = dcOpf(cs, { useLimits: false });
  for (let i = 0; i < 3; i++) near(e.P[i], o.Pg[i], 0.01);
  near(e.lambda, o.lambda, 1e-3);
});
test('Congested case39 OPF produces LMP separation', () => {
  const r = dcOpf(loadCase('case39'), { limitScale: 0.8 });
  assert.ok(r.converged); assert.ok(Math.max(...r.lmp) - Math.min(...r.lmp) > 1);
});
test('Fault: SLG = 3V/(Z1+Z2+Z0), 3φ = V/Z1', () => {
  const cs = loadCase('case9'), Z = buildZbus(cs), k = 3;
  const f3 = faultAt(cs, Z, k, '3PH'), f1 = faultAt(cs, Z, k, 'SLG');
  near(f3.Ifault_pu, 1 / cabs(f3.Zth.Z1), 1e-9);
  const s = { re: 2 * f1.Zth.Z1.re + f1.Zth.Z0.re, im: 2 * f1.Zth.Z1.im + f1.Zth.Z0.im };
  near(f1.Ifault_pu, 3 / cabs(s), 1e-9);
});
test('WSCC 9-bus classical modes ≈ 1.38 Hz and 2.13 Hz (Anderson & Fouad)', () => {
  const cs = loadCase('case9'), m = modalAnalysis(cs, runPowerFlow(cs), { D: 0 }).modes.filter((x) => x.shape).map((x) => x.f).sort();
  near(m[0], 1.38, 0.03); near(m[1], 2.13, 0.04);
});
test('Transient: short fault stable, long fault unstable; energy preserved without fault', () => {
  const cs = loadCase('case9'), pf = runPowerFlow(cs);
  assert.ok(simulateTransient(cs, pf, { faultBus: 6, tClear: 0.15, tripBranch: 5, tEnd: 2 }).stable);
  assert.ok(!simulateTransient(cs, pf, { faultBus: 6, tClear: 0.6, tripBranch: 5, tEnd: 2 }).stable);
  const q = simulateTransient(cs, pf, { faultBus: 6, tFault: 99, tClear: 99, tEnd: 1 });
  near(q.maxSepDeg, Math.max(...q.machines.map((m) => m.delta0)) * 180 / Math.PI - Math.min(...q.machines.map((m) => m.delta0)) * 180 / Math.PI, 0.05, 'equilibrium');
});
test('Equal-area critical clearing angle and time (closed form)', () => {
  const r = equalArea({ Pm: 0.8, Pmax1: 2.0, Pmax2: 0, Pmax3: 2.0, H: 5, f: 60 });
  const d0 = Math.asin(0.4), dc = Math.acos((0.8 * (Math.PI - 2 * d0) + 2 * Math.cos(Math.PI - d0)) / 2);
  near(r.dc, dc, 1e-12); near(r.tc, Math.sqrt((4 * 5 * (dc - d0)) / (2 * Math.PI * 60 * 0.8)), 1e-12);
  near((dc * 180) / Math.PI, 89.37, 0.01);
});
test('LFC steady-state Δf = −ΔPL/(1/R + D) without AGC; zero with AGC', () => {
  const p = { areas: 1, H: [5], D: [1], R: [0.05], Tg: [0.2], Tt: [0.5], Ki: [0.3], dPL: [0.1], tEnd: 60, f0: 50 };
  near(simulateLFC({ ...p, agc: false }).metrics.steady, (-0.1 / 21) * 50, 1e-4);
  near(simulateLFC({ ...p, agc: true }).metrics.steady, 0, 2e-3);
});
test('COPT probabilities sum to one', () => { const t = copt([{ cap: 50, FOR: 0.02 }, { cap: 50, FOR: 0.02 }, { cap: 100, FOR: 0.05 }]); near(t[0].cum, 1, 1e-12); near(t.reduce((s, r) => s + r.p, 0), 1, 1e-12); });
test('IEC SI relay: M=10, TMS=1 → 2.97 s', () => near(tripTime('IEC SI', 10, 1), 2.971, 0.002));
test('Eigenvalues of companion matrix', () => { const e = eig([[0, 1, 0], [0, 0, 1], [-6, -11, -6]]).map((x) => x.re).sort((a, b) => a - b); near(e[0], -3, 1e-9); near(e[1], -2, 1e-9); near(e[2], -1, 1e-9); });
test('QP solver: simple bound-constrained problem', () => { const r = qpSolve({ H: [[2, 0], [0, 2]], c: [-2, -5], Aeq: [[1, 1]], beq: [1], G: [[-1, 0], [0, -1]], h: [0, 0] }); near(r.x[0], 0, 1e-6); near(r.x[1], 1, 1e-6); });
test('Symmetrical components of a balanced set', () => { const [z, p, n] = phaseToSeq(polar(1, 0), polar(1, -2.0944), polar(1, 2.0944)); near(cabs(p), 1, 1e-4); near(cabs(z) + cabs(n), 0, 1e-4); });
test('MATPOWER export/import round-trip', () => { const cs = loadCase('case14'), back = parseMatpower(toMatpower(cs)); assert.equal(back.bus.length, 14); near(runPowerFlow(back).lossP, runPowerFlow(cs).lossP, 1e-9); });

const CIR = await import('../src/engines/circuit.js');
test('Circuit: DC voltage divider', () => { const p = CIR.preset('divider'), r = CIR.solveCircuit(p); near(r.byId.get(p[2].id).Vm, 8, 1e-6); });
test('Circuit: RLC series at resonance draws V/R', () => { const p = CIR.preset('rlc'), r = CIR.solveCircuit(p, { f: 1 / (2 * Math.PI * Math.sqrt(0.1 * 101.3e-6)) }); near(r.byId.get(p[0].id).Im, 1, 1e-6); });
test('Circuit: PF capacitor reduces source current', () => {
  const p = CIR.preset('pf'), with_ = CIR.solveCircuit(p).byId.get(p[0].id).Im;
  const nocap = CIR.solveCircuit(p.filter((c) => c.type !== 'C')).byId.get(p[0].id).Im; assert.ok(with_ < nocap);
});
test('Circuit: RC transient reaches 63.2% at τ', () => {
  const p = CIR.preset('rc'), tr = CIR.transient(p, { tEnd: 0.01, dt: 1e-6 }), k = tr.t.findIndex((t) => t >= 0.01 - 1e-9);
  near(tr.v.get(p[3].id)[tr.t.length - 1], 5 * (1 - Math.exp(-1)), 0.01); void k;
});

test('Sparse NR equals dense NR (IEEE 39)', () => {
  const cs = loadCase('case39'), a = runPowerFlow(cs, { sparse: true, flat: true }), b = runPowerFlow(cs, { sparse: false, flat: true });
  for (let i = 0; i < 39; i++) near(a.V[i], b.V[i], 1e-10);
});

const DYN = await import('../src/engines/dynamics.js');
test('Detailed dynamics: flat start equilibrium & fault response', () => {
  const cs = loadCase('case39'), pf = runPowerFlow(cs);
  const q = DYN.simulateDetailed(cs, pf, { tEnd: 1 });
  q.omega.forEach((w) => near(Math.max(...w.map((x) => Math.abs(x - 1))), 0, 1e-5));
  const f = DYN.simulateDetailed(cs, pf, { tEnd: 5, events: [{ t: 0.1, type: 'fault', bus: 15 }, { t: 0.2, type: 'clear' }, { t: 0.2, type: 'trip', branch: 27 }] });
  assert.ok(f.stable); assert.ok(Math.min(...f.busV.map((v) => v[15])) < 0.05);
});

const RAW = await import('../src/data/psse.js');
test('PSS/E RAW export/import round-trip (IEEE 39)', () => { const cs = loadCase('case39'), back = RAW.parseRaw(RAW.toRaw(cs)); assert.equal(back.bus.length, 39); assert.equal(back.branch.length, 46); near(runPowerFlow(back).lossP, runPowerFlow(cs).lossP, 1e-6); });
test('IEC 60909: c=1.1 raises fault current vs flat 1.0', () => { const cs = loadCase('case39'), Z = buildZbus(cs, { iec: { cmax: 1.1 } }), r = faultAt(cs, Z, 15, '3PH', { c: 1.1 }); assert.ok(r.ip_kA > r.Ifault_kA * Math.SQRT2); assert.ok(r.Ith_kA >= r.Ifault_kA); });
const ADV = await import('../src/engines/advopt.js');
test('AC-OPF case9 ≈ MATPOWER runopf 5296.69 $/h', () => near(ADV.acOpf(loadCase('case9')).cost, 5296.69, 3));
test('AC-OPF case39 ≈ MATPOWER runopf 41864.18 $/h', () => near(ADV.acOpf(loadCase('case39')).cost, 41864.18, 15));
test('DC-SCOPF cost ≥ DC-OPF cost', () => { const cs = loadCase('case39'); assert.ok(ADV.dcScopf(cs).cost >= dcOpf(cs).totalCost - 1e-6); });
test('Lagrangian UC duality gap < 1%', () => { const cs = loadCase('case39'), u = cs.gen.map((g, i) => ({ ...g, Pmin: g.Pmax * 0.3, SU: 2000, MU: 4, MD: 3, init: i < 6 ? 5 : -5 })); const d = Array.from({ length: 24 }, (_, h) => 6254 * (0.6 + 0.3 * Math.exp(-((h - 19) ** 2) / 12))); assert.ok(ADV.lagrangianUC(u, d).gap < 1); });

test('Circuit: overloaded resistor heats and burns open; colour code', () => {
  const p = CIR.preset('divider'); p[1].rating = 0.002; let burnt = false;
  for (let t = 0; t < 40 && !burnt; t++) { const r = CIR.solveCircuit(p); burnt = CIR.thermalStep(p[1], CIR.stress(p[1], r.byId.get(p[1].id), r.ac), 0.25); }
  assert.ok(burnt); near(CIR.solveCircuit(p).byId.get(p[0].id).Im, 0, 1e-9);
  assert.deepEqual(CIR.resistorBands(4700).slice(0, 3), ['#ffd400', '#8a2be2', '#e00000']);
});

test('Sub-transient 6th-order model with saturation: equilibrium & stable fault', () => {
  const cs = loadCase('case39'), pf = runPowerFlow(cs);
  const q = DYN.simulateDetailed(cs, pf, { tEnd: 1, model: 'sub' }); q.omega.forEach((w) => near(Math.max(...w.map((x) => Math.abs(x - 1))), 0, 1e-5));
  const two = DYN.simulateDetailed(cs, pf, { tEnd: 1, model: 'two', sat: false }); two.omega.forEach((w) => near(Math.max(...w.map((x) => Math.abs(x - 1))), 0, 1e-5));
  const f = DYN.simulateDetailed(cs, pf, { tEnd: 4, model: 'sub', dt: 0.002, events: [{ t: 0.1, type: 'fault', bus: 15 }, { t: 0.2, type: 'clear' }, { t: 0.2, type: 'trip', branch: 27 }] });
  assert.ok(f.stable);
});

const EMT = await import('../src/engines/emt.js');
test('EMT: Bergeron line open-end voltage doubling at t = τ', () => {
  const s = new EMT.EMT(1e-6); s.V('s', '0', 1, 1e-9, 90, 1e-3).BRK('s', 'a', { tClose: 0 }).LINE('a', 'b', 300, 1e-4, 0).R('b', '0', 1e9).probeV('vb', 'b');
  const r = s.run(5e-4), y = r.probes[0].y; near(Math.max(...y), 2, 0.01); near(r.t[y.findIndex((x) => x > 0.5)], 1e-4, 3e-6);
});
test('EMT: RL circuit DC offset decays with τ = L/R; MOV clamps', () => {
  const s = new EMT.EMT(1e-5); s.V('s', '0', 2, 50, 0, 1e-3).R('s', 'a', 10).MOV('a', '0', 1, 1, 25).probeV('va', 'a');
  const v = Math.max(...s.run(0.02).probes[0].y); assert.ok(v < 1.0 && v > 0.85);
  const c = EMT.runStudy('capSwitch', {}); assert.ok(Math.max(...c.peaks.filter((p) => p.name.startsWith('V')).map((p) => p.peak)) < 2.1);
});
const STO = await import('../src/engines/stochastic.js');
const REL = await import('../src/engines/reliability.js');
test('Wind Weibull capacity factor and solar CF are physical', () => {
  const w = STO.windSeries(8760, { k: 2, c: 8.5 }), s = STO.solarSeries(8760, { lat: 32 });
  assert.ok(w.cf > 0.2 && w.cf < 0.5); assert.ok(s.cf > 0.14 && s.cf < 0.3);
});
test('Sequential MC LOLE close to analytical COPT for same units', () => {
  const units = Array.from({ length: 10 }, () => ({ cap: 100, MTTF: 960, MTTR: 40 })); // FOR = 0.04
  const r = STO.sequentialMC(units, 800, { years: 400, tol: 0.06 });
  const an = REL.adequacy(units.map((u) => ({ cap: u.cap, FOR: u.MTTR / (u.MTTF + u.MTTR) })), 800);
  near(r.LOLE / an.LOLE_h, 1, 0.3);
});
test('Composite MC with DC-OPF load shedding (IEEE 14)', () => { const r = STO.compositeMC(loadCase('case14'), { samples: 500 }); assert.ok(r.LOLP >= 0 && r.LOLP < 0.5); });

const PRJ = await import('../src/engines/project.js');
test('Project study: 300 MW PV at IEEE-39 bus 16 produces full assessment', () => {
  const R = PRJ.interconnectionStudy(loadCase('case39'), { type: 'pv', bus: 16, MW: 300, lat: 32 });
  assert.ok(R.pf.post.converged); assert.ok(R.sc.SCR > 3); assert.ok(R.energy.CF > 0.14 && R.energy.CF < 0.3); assert.ok(R.hosting.MW > 0); assert.ok(R.lvrt.t.length > 10);
  assert.ok(R.econ.LCOE > 20 && R.econ.LCOE < 120);
});

console.log(`\n${pass} tests passed`);
