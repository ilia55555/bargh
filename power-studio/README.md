# برق‌نما — Power-System Engineering Studio (three.js 3D)

A self-contained, browser-only power-system engineering studio with a Persian (RTL) UI and interactive **three.js** 3D views. No build step and no backend. All numerical engines are plain ES modules that also run in Node for testing.

## Run

```bash
cd power-studio
python3 -m http.server 8090
```

Then open `http://localhost:8090`. three.js r160 loads from the jsDelivr CDN via an import map. If the CDN can't be reached, only the 3D panels are disabled.

## Built-in networks
- WSCC 3-machine 9-bus (Anderson & Fouad)
- IEEE 14-bus
- **IEEE 39-bus New England** (MATPOWER data, Pai classical dynamic data)
- IEEE 33-bus radial distribution (Baran & Wu)
- Any MATPOWER v2 `.m` case, loaded through the network editor (MATPOWER/JSON export is also supported)

## Engines (`src/engines`)
| Area | Implemented |
|---|---|
| AC power flow | Newton–Raphson (polar, full Jacobian), fast-decoupled XB, accelerated Gauss–Seidel; π-model, off-nominal taps, phase shifters, Q-limit PV→PQ switching, losses, loading |
| DC methods | DC power flow, PTDF, LODF, LODF-based contingency screening |
| Dispatch / market | λ-iteration ED (optional B-loss penalty factors), 24 h priority-list UC, DC-OPF solved with a primal-dual interior-point QP, LMPs with congestion component |
| Short circuit | Zbus method with positive/negative/zero-sequence networks; 3φ, SLG, LL, DLG faults with fault impedance; bus-voltage sag; fault-level scan; X/R ratio and IEC 60909 κ factor |
| Transient stability | Multi-machine classical model, Kron reduction, RK4 integration, fault followed by line trip, CCT by bisection; SMIB equal-area criterion and swing curve |
| Small-signal | State matrix, eigenvalues (balance + Hessenberg + Francis QR), eigenvectors by inverse iteration, mode shapes, participation factors, mode classification |
| Voltage stability | PV (nose) curves, QV curves, L-index, reduced-Jacobian Q–V modal sensitivities |
| Security | Full AC N-1 (branches and generators), performance index, islanding detection |
| Distribution | Backward/forward sweep, VSI, exhaustive search for optimal DG and capacitor placement |
| Frequency | One- and two-area LFC: governor, (reheat) turbine, AGC/ACE, tie line, BESS virtual inertia / fast frequency response |
| Reliability | COPT, LOLP, LOLE (hourly and daily peak), EENS; SAIFI, SAIDI, CAIDI, ASAI, ENS |
| Protection | IEC 60255 / IEEE C37.112 IDMT curves, automatic radial coordination, TCC plots, mho distance zones, dual-slope differential relay |
| Components | Line parameters from geometry (GMD/GMR, bundles), long-line, nominal-π and short-line ABCD models, SIL, Ferranti effect, power-angle curve; transformer OC/SC tests, efficiency and regulation; induction motor torque-speed curve; synchronous machine capability chart; harmonics (THD, K-factor); PF correction with resonance check; per-unit conversion; symmetrical components |

## Research-grade additions
- **Sparse solver** (Markowitz-pivoted sparse LU) for the NR Jacobian: a 975-bus test case solves in about 0.13 s.
- **Detailed RMS dynamics** (`engines/dynamics.js`):
  - two-axis synchronous machine
  - ST1A-type AVR with ceiling limits
  - PSS (washout + two lead-lag stages)
  - TGOV1-type governor with droop and valve limits
  - grid-following IBR (current limit, LVRT reactive priority)
  - event list: fault, clear, line trip, generator trip
- **AC-OPF** (SQP on exact AC finite-difference sensitivities with a trust region; Pg and voltage set-points as variables; line/V/Q limits). Matches MATPOWER `runopf`: case9 5297 vs 5296.69 $/h, case39 41864 vs 41864.18 $/h.
- **DC-SCOPF** (preventive N-1 via LODF, constraint generation, soft post-contingency limits, LMPs).
- **Unit commitment by Lagrangian relaxation** (per-unit DP with min up/down and start-up cost, Polyak subgradient). Duality gap < 1 %.
- **Monte-Carlo probabilistic power flow** with correlated loads.
- **IEC 60909**: voltage factor c, generator KG and transformer KT corrections, ip, Ib, Ith (Tk = 1 s) and DC component.
- **PSS/E RAW** import/export (bus, load, fixed shunt, generator, branch, two-winding transformer).
- **Script console**: JavaScript access to every engine, with log/plot/CSV helpers for batch studies.

## 3D (`src/three`)
- **Realistic physics in the circuit builder**: every part has a rating (W, V or A). Temperature follows a first-order thermal model; parts that exceed their failure temperature burn open, with fire, smoke and an arc flash, and the circuit is solved again so the effects cascade. Electrolytic capacitors fail on reverse DC voltage or over-voltage. Resistor bands use the standard colour code, and lamp light follows the tungsten blackbody colour temperature.
- **Network faults** are drawn as a plasma arc to ground plus fire at the fault bus, which smoulders after clearing. Lines loaded above 150 % catch fire (tree contact).
- **Circuit3D: 3D circuit builder** (the default page). Place resistors, capacitors, inductors, DC/AC voltage sources, current sources, lamps, switches, wires and ground on a breadboard grid by clicking two points. Each component's value can be set with SI prefixes or a continuous slider, and switches can be opened and closed. The circuit is solved with modified nodal analysis (DC or AC phasor). Node colours show voltage, animated particles show current, and lamps glow with their power. The page also shows a frequency response and the switch-on transient (backward Euler), and includes ready-made circuits: RLC resonance, PF correction with a capacitor, a voltage divider, RC charging and parallel lamps. Circuits are saved and loaded as JSON.
- **Network3D**: the solved grid shown in 3D, with voltage height and colour, line loading, power-flow particles, fault, transient playback, mode shapes and an LMP heat map.

## Tests
```bash
npm test
```
The tests check against published references: IEEE-14 and IEEE-39 MATPOWER solutions, the WSCC-9 slack output and DC-OPF cost (5216.03 $/h), the Baran-Wu 33-bus losses (202.67 kW, Vmin 0.9131), the WSCC-9 electromechanical modes (≈1.38 Hz and 2.13 Hz), the equal-area closed form, the circuit-solver checks (voltage divider, RLC resonance, PF correction, RC time constant), the LFC steady-state error, COPT normalisation and the IEC relay curve.

## Modelling notes
- Dynamics use the classical model with constant-impedance loads (an RMS positive-sequence model, not EMT).
- Short-circuit assumptions: Z2 = Z1; generators are modelled with x′d; line Z0 = 3·Z1; generator step-up transformers are Δ on the generator side and grounded Y on the network side.
- DC-OPF is lossless, and LMPs are split into energy and congestion components.
