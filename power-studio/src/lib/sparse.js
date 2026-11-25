// Sparse linear algebra: row-map sparse matrices, LU with Markowitz pivoting
// (minimum fill-in heuristic) for large power-system Jacobians.
export class SpMat {
  constructor(n) { this.n = n; this.rows = Array.from({ length: n }, () => new Map()); }
  add(i, j, v) { if (v === 0) return; const r = this.rows[i]; r.set(j, (r.get(j) || 0) + v); }
  set(i, j, v) { this.rows[i].set(j, v); }
  get(i, j) { return this.rows[i].get(j) || 0; }
  nnz() { return this.rows.reduce((s, r) => s + r.size, 0); }
  static fromDense(A) { const M = new SpMat(A.length); A.forEach((r, i) => r.forEach((v, j) => { if (v !== 0) M.set(i, j, v); })); return M; }
}

/** Solve A x = b (A destroyed copy). Markowitz pivot selection with threshold partial pivoting. */
export function spSolve(Ain, b) {
  const n = Ain.n, rows = Ain.rows.map((r) => new Map(r)), rhs = Float64Array.from(b);
  const cols = Array.from({ length: n }, () => new Set());
  rows.forEach((r, i) => r.forEach((_, j) => cols[j].add(i)));
  const rowDone = new Uint8Array(n), colDone = new Uint8Array(n), order = [];
  for (let step = 0; step < n; step++) {
    // pick column with fewest active entries, then best row in it (threshold 0.1)
    let bc = -1, bcnt = Infinity;
    for (let j = 0; j < n; j++) if (!colDone[j] && cols[j].size < bcnt) { bcnt = cols[j].size; bc = j; if (bcnt <= 1) break; }
    if (bc < 0 || bcnt === 0) throw new Error('Singular matrix');
    let mx = 0; cols[bc].forEach((i) => { mx = Math.max(mx, Math.abs(rows[i].get(bc))); });
    if (mx < 1e-300) throw new Error('Singular matrix');
    let br = -1, bsz = Infinity;
    cols[bc].forEach((i) => { const v = Math.abs(rows[i].get(bc)); if (v >= 0.1 * mx && rows[i].size < bsz) { bsz = rows[i].size; br = i; } });
    const prow = rows[br], piv = prow.get(bc);
    rowDone[br] = 1; colDone[bc] = 1; order.push([br, bc]);
    prow.forEach((_, j) => cols[j].delete(br));
    for (const i of [...cols[bc]]) {
      const ri = rows[i], f = ri.get(bc) / piv;
      prow.forEach((v, j) => {
        if (j === bc) return;
        const nv = (ri.get(j) || 0) - f * v;
        if (!ri.has(j)) cols[j].add(i);
        ri.set(j, nv);
      });
      ri.delete(bc); cols[bc].delete(i);
      rhs[i] -= f * rhs[br];
    }
    // keep pivot row (eliminated) for back substitution
  }
  const x = new Float64Array(n);
  for (let k = n - 1; k >= 0; k--) {
    const [r, c] = order[k], row = rows[r]; let s = rhs[r];
    row.forEach((v, j) => { if (j !== c) s -= v * x[j]; });
    x[c] = s / row.get(c);
  }
  return x;
}
