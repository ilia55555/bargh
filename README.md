# GridMPC Research IDE v12

GridMPC is an offline-first, browser-based electrical-engineering research environment. The primary research path is power systems, frequency control, MPC, EV/V2G, BESS and microgrids; a compact Advanced toolbox adds general numerical electrical-engineering calculations without cluttering the main workflow.

## Main research workflow

Project → Model → Controls → Experiments → Validation → Publication

A single Project is the source of truth for the network, dynamic models, controllers, experiments, references, runs and reproducibility metadata.

## Implemented numerical engines

### Power systems
- Nonlinear AC Newton–Raphson power flow
- MATPOWER case import and IEEE/New England 39-bus benchmark
- RMS / positive-sequence electromechanical DAE simulation
- Classical synchronous-machine model
- Experimental full-order GENROU and GENSAL state models with editable parameters
- TGOV1 governor/turbine, EXST1 exciter and PSS1A-style stabilizer
- AGC and coordinated augmented-output MPC for frequency/RoCoF
- Flexible EV/V2G/BESS fleet with power, ramp, connection and energy constraints
- Network-security projection for MPC commands
- ZIP, frequency-dependent and aggregate motor-load models
- GFL, droop-GFM, VSG and battery-inverter RMS models
- UFLS/UVLS, over-voltage, generator-trip and breaker protection logic
- N-1 branch/generator contingency screening
- DC and nonlinear AC weighted-least-squares state estimation
- Economic dispatch and DC power-flow utilities
- Fixed generator-trip, fault, load-step, low-inertia and 20-resource regression benchmarks

### Optimization and experiments
- Publication-audited projected QP MPC solver
- Warm start, adaptive iterations, residual and projected-KKT diagnostics
- NSGA-II multiobjective optimization
- Microgrid cost/emissions scheduling
- Monte Carlo with Web Workers
- Parameter sweeps, sensitivity ranking and experiment cloning
- Differential-Evolution model calibration against external references

### Validation and publication
- MATLAB/Simulink, PowerFactory, PSS/E and published CSV/JSON numeric-reference workflow
- Time alignment and interpolation
- RMSE, MAE, maximum error, correlation, nadir, RoCoF and settling-time errors
- Regression hashes and run history
- Reproducibility records with model/solver/controller settings
- SVG/PNG figures, IEEE-style tables and standalone HTML reports

### General electrical-engineering toolbox
- Adaptive/numerical calculus, root finding and RK45 ODE integration
- Linear AC circuit solution with Modified Nodal Analysis
- FFT/DFT, convolution, RMS and THD
- Symmetrical components and 3PH/SLG/LL/DLG fault calculations
- State-space/control utilities, Bode evaluation, PID and discrete LQR
- Transformer, induction-machine and synchronous power-angle calculations
- Buck/boost/inverter and switching-loss calculations
- Transmission-line, skin-depth, capacitance/inductance and Poynting calculations
- Measurement uncertainty, weighted mean and linear regression

## Scientific scope

GridMPC labels model fidelity explicitly. It does **not** claim capabilities that are not implemented.

- AC PF: full nonlinear balanced positive-sequence formulation.
- Dynamics: RMS / positive-sequence electromechanical simulation, not EMT.
- GENROU/GENSAL: implemented as research models, but case-specific publication claims require external cross-tool validation with matching parameters.
- Protection: research logic models, not vendor-certified relay studies.
- MPC: reduced-order augmented-output predictor with full-network security checks, not full nonlinear NMPC.
- WebGPU: not used for the core DAE/MPC path until that path has independent numerical validation.
- Microgrid 2022 workflow: method-aligned with Torkan et al.; not an exact paper reproduction without the authors' complete input dataset.

## Sources and validation

The repository bundles MATPOWER `case39.m` with attribution and uses published model semantics/parameter structures from established power-system model libraries where available. Published/reference data and research defaults are kept distinct in the model metadata.

## Run locally

No build step or cloud backend is required.

```bash
python -m http.server 8080
```

Open:

```
http://localhost:8080
```

## Numerical CI

```bash
npm run check
npm test
```

GitHub Actions runs syntax and numerical regression tests on every push to branch `Ilia`.

## Active branch

`Ilia`
