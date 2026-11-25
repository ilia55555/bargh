// Global application state: active case, last power-flow solution, listeners.
import { loadCase, prepareCase } from '../data/cases.js';
import { runPowerFlow } from '../engines/powerflow.js';
import { cloneCase } from '../engines/network.js';

const listeners = new Set();
export const state = { caseKey: 'case39', cs: null, pf: null, pfOpts: { method: 'NR', enforceQ: true } };

export function setCase(key, custom = null) {
  state.caseKey = key;
  state.cs = custom ? prepareCase(custom) : loadCase(key);
  state.pf = null;
  solve();
  emit();
}
export function solve(opts = {}) {
  Object.assign(state.pfOpts, opts);
  try { state.pf = runPowerFlow(state.cs, { ...state.pfOpts, flat: true }); }
  catch (e) { state.pf = { converged: false, error: e.message }; }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pf-solved'));
  return state.pf;
}
export function mutateCase(fn) { fn(state.cs); delete state.cs.layout; solve(); emit(); }
export const workingCopy = () => cloneCase(state.cs);
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = () => listeners.forEach((f) => f(state));
