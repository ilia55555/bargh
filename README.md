# GridMPC Research IDE v12

Offline-first power-system research environment focused on power flow, electromechanical dynamics, MPC, EV/V2G, microgrids, validation, calibration, batch experiments and publication workflows.

## Scientific scope

Implemented modules are explicitly versioned and labeled by fidelity. The project does **not** claim EMT, vendor-certified protection studies, or any model that has not actually been implemented and validated.

Current architecture separates:

- Network & AC power flow
- Dynamic machine / controller models
- Loads, inverters and protection
- Coordinated MPC & fleet resources
- Microgrid / NSGA-II optimization
- Validation & calibration
- Experiment design, Monte Carlo and sensitivity
- Publication / reproducibility

## Run

Serve this folder with any static HTTP server, for example:

```bash
python -m http.server 8080
```

Then open http://localhost:8080.

No cloud backend is required for the numerical engines.

## Branch

Active development: `Ilia`.
