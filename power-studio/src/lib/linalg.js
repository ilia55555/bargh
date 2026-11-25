// Dense linear algebra: LU, inverse, complex systems (via real embedding),
// eigenvalues of real nonsymmetric matrices (balance + Hessenberg + Francis QR),
// complex inverse iteration for eigenvectors, and a dense primal-dual QP solver.

export const zeros = (n, m = n) => Array.from({ length: n }, () => new Float64Array(m));
export const eye = (n) => { const A = zeros(n); for (let i = 0; i < n; i++) A[i][i] = 1; return A; };
export const clone = (A) => A.map((r) => Float64Array.from(r));
export const transpose = (A) => { const n = A.length, m = A[0].length, T = zeros(m, n); for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j][i] = A[i][j]; return T; };
export function matmul(A, B) {
  const n = A.length, k = B.length, m = B[0].length, R = zeros(n, m);
  for (let i = 0; i < n; i++) for (let p = 0; p < k; p++) { const a = A[i][p]; if (a === 0) continue; const Bp = B[p], Ri = R[i]; for (let j = 0; j < m; j++) Ri[j] += a * Bp[j]; }
  return R;
}
export const matvec = (A, x) => A.map((r) => { let s = 0; for (let j = 0; j < x.length; j++) s += r[j] * x[j]; return s; });

export function luFactor(Ain) {
  const n = Ain.length, A = clone(Ain), piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;
  for (let k = 0; k < n; k++) {
    let p = k, mx = Math.abs(A[k][k]);
    for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i][k]); if (v > mx) { mx = v; p = i; } }
    if (mx < 1e-300) throw new Error('Singular matrix');
    if (p !== k) { [A[p], A[k]] = [A[k], A[p]]; [piv[p], piv[k]] = [piv[k], piv[p]]; }
    const Ak = A[k], akk = Ak[k];
    for (let i = k + 1; i < n; i++) {
      const Ai = A[i], f = Ai[k] / akk; if (f === 0) continue; Ai[k] = f;
      for (let j = k + 1; j < n; j++) Ai[j] -= f * Ak[j];
    }
  }
  return { LU: A, piv, n };
}
export function luSolve({ LU, piv, n }, b) {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[piv[i]]; const r = LU[i]; for (let j = 0; j < i; j++) s -= r[j] * x[j]; x[i] = s; }
  for (let i = n - 1; i >= 0; i--) { let s = x[i]; const r = LU[i]; for (let j = i + 1; j < n; j++) s -= r[j] * x[j]; x[i] = s / r[i]; }
  return x;
}
export const solve = (A, b) => luSolve(luFactor(A), b);
export function inv(A) {
  const n = A.length, f = luFactor(A), R = zeros(n), e = new Float64Array(n);
  for (let j = 0; j < n; j++) { e.fill(0); e[j] = 1; const c = luSolve(f, e); for (let i = 0; i < n; i++) R[i][j] = c[i]; }
  return R;
}

// ---------- complex dense (split re/im matrices) ----------
const embed = (Ar, Ai) => {
  const n = Ar.length, M = zeros(2 * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    M[i][j] = Ar[i][j]; M[i][j + n] = -Ai[i][j]; M[i + n][j] = Ai[i][j]; M[i + n][j + n] = Ar[i][j];
  }
  return M;
};
export function cinvMat(Ar, Ai) {
  const n = Ar.length, f = luFactor(embed(Ar, Ai)), Rr = zeros(n), Ri = zeros(n), e = new Float64Array(2 * n);
  for (let j = 0; j < n; j++) { e.fill(0); e[j] = 1; const c = luSolve(f, e); for (let i = 0; i < n; i++) { Rr[i][j] = c[i]; Ri[i][j] = c[i + n]; } }
  return [Rr, Ri];
}
export function csolveMat(Ar, Ai, br, bi) {
  const n = Ar.length, rhs = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) { rhs[i] = br[i]; rhs[i + n] = bi[i]; }
  const x = solve(embed(Ar, Ai), rhs);
  return [x.slice(0, n), x.slice(n)];
}
export function cmatmul(Ar, Ai, Br, Bi) {
  const RR = matmul(Ar, Br), II = matmul(Ai, Bi), RI = matmul(Ar, Bi), IR = matmul(Ai, Br);
  return [RR.map((r, i) => r.map((v, j) => v - II[i][j])), RI.map((r, i) => r.map((v, j) => v + IR[i][j]))];
}

// ---------- eigenvalues (real nonsymmetric) ----------
function balance(a) {
  const n = a.length, RADIX = 2, sqrdx = RADIX * RADIX; let done = false;
  while (!done) {
    done = true;
    for (let i = 0; i < n; i++) {
      let r = 0, c = 0;
      for (let j = 0; j < n; j++) if (j !== i) { c += Math.abs(a[j][i]); r += Math.abs(a[i][j]); }
      if (c !== 0 && r !== 0) {
        let g = r / RADIX, f = 1; const s = c + r;
        while (c < g) { f *= RADIX; c *= sqrdx; }
        g = r * RADIX;
        while (c > g) { f /= RADIX; c /= sqrdx; }
        if ((c + r) / f < 0.95 * s) {
          done = false; g = 1 / f;
          for (let j = 0; j < n; j++) a[i][j] *= g;
          for (let j = 0; j < n; j++) a[j][i] *= f;
        }
      }
    }
  }
}
function elmhes(a) {
  const n = a.length;
  for (let m = 1; m < n - 1; m++) {
    let x = 0, i = m;
    for (let j = m; j < n; j++) if (Math.abs(a[j][m - 1]) > Math.abs(x)) { x = a[j][m - 1]; i = j; }
    if (i !== m) {
      for (let j = m - 1; j < n; j++) { const t = a[i][j]; a[i][j] = a[m][j]; a[m][j] = t; }
      for (let j = 0; j < n; j++) { const t = a[j][i]; a[j][i] = a[j][m]; a[j][m] = t; }
    }
    if (x !== 0) {
      for (i = m + 1; i < n; i++) {
        let y = a[i][m - 1];
        if (y !== 0) {
          y /= x; a[i][m - 1] = y;
          for (let j = m; j < n; j++) a[i][j] -= y * a[m][j];
          for (let j = 0; j < n; j++) a[j][m] += y * a[j][i];
        }
      }
    }
  }
  for (let i = 2; i < n; i++) for (let j = 0; j < i - 1; j++) a[i][j] = 0;
}
function hqr(a) {
  const n = a.length, wr = new Float64Array(n), wi = new Float64Array(n);
  let nn, m, l, k, j, its, i, mmin, z = 0, y, x, w, v, u, t, s, r = 0, q = 0, p = 0, anorm = 0;
  const EPS = 2.220446049250313e-16;
  for (i = 0; i < n; i++) for (j = Math.max(i - 1, 0); j < n; j++) anorm += Math.abs(a[i][j]);
  nn = n - 1; t = 0;
  while (nn >= 0) {
    its = 0;
    do {
      for (l = nn; l > 0; l--) {
        s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (s === 0) s = anorm;
        if (Math.abs(a[l][l - 1]) <= EPS * s) { a[l][l - 1] = 0; break; }
      }
      x = a[nn][nn];
      if (l === nn) { wr[nn] = x + t; wi[nn--] = 0; }
      else {
        y = a[nn - 1][nn - 1]; w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          p = 0.5 * (y - x); q = p * p + w; z = Math.sqrt(Math.abs(q)); x += t;
          if (q >= 0) {
            z = p + (p >= 0 ? Math.abs(z) : -Math.abs(z));
            wr[nn - 1] = wr[nn] = x + z;
            if (z) wr[nn] = x - w / z;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = x + p;
            wi[nn - 1] = -(wi[nn] = z);
          }
          nn -= 2;
        } else {
          if (its === 60) throw new Error('Too many iterations in hqr');
          if (its === 10 || its === 20) {
            t += x;
            for (i = 0; i <= nn; i++) a[i][i] -= x;
            s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            y = x = 0.75 * s; w = -0.4375 * s * s;
          }
          ++its;
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m]; r = x - z; s = y - z;
            p = (r * s - w) / a[m + 1][m] + a[m][m + 1]; q = a[m + 1][m + 1] - z - r - s; r = a[m + 2][m + 1];
            s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s; q /= s; r /= s;
            if (m === l) break;
            u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u <= EPS * v) break;
          }
          for (i = m; i < nn - 1; i++) { a[i + 2][i] = 0; if (i !== m) a[i + 2][i - 1] = 0; }
          for (k = m; k < nn; k++) {
            if (k !== m) {
              p = a[k][k - 1]; q = a[k + 1][k - 1]; r = 0;
              if (k + 1 !== nn) r = a[k + 2][k - 1];
              if ((x = Math.abs(p) + Math.abs(q) + Math.abs(r)) !== 0) { p /= x; q /= x; r /= x; }
            }
            const sq = Math.sqrt(p * p + q * q + r * r);
            if ((s = p >= 0 ? sq : -sq) !== 0) {
              if (k === m) { if (l !== m) a[k][k - 1] = -a[k][k - 1]; }
              else a[k][k - 1] = -s * x;
              p += s; x = p / s; y = q / s; z = r / s; q /= p; r /= p;
              for (j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j];
                if (k + 1 !== nn) { p += r * a[k + 2][j]; a[k + 2][j] -= p * z; }
                a[k + 1][j] -= p * y; a[k][j] -= p * x;
              }
              mmin = nn < k + 3 ? nn : k + 3;
              for (i = l; i <= mmin; i++) {
                p = x * a[i][k] + y * a[i][k + 1];
                if (k + 1 !== nn) { p += z * a[i][k + 2]; a[i][k + 2] -= p * r; }
                a[i][k + 1] -= p * q; a[i][k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  return { wr, wi };
}
export function eig(A) {
  const n = A.length;
  if (n === 1) return [{ re: A[0][0], im: 0 }];
  const a = clone(A);
  balance(a); elmhes(a);
  const { wr, wi } = hqr(a);
  return Array.from(wr, (re, i) => ({ re, im: wi[i] })).sort((p, q) => q.re - p.re || q.im - p.im);
}
// Right eigenvector of real A for complex eigenvalue lam via inverse iteration.
export function eigvec(A, lam, iters = 4) {
  const n = A.length, sh = { re: lam.re + 1e-7 * (1 + Math.abs(lam.re)), im: lam.im + 1e-7 };
  const Mr = clone(A), Mi = zeros(n);
  for (let i = 0; i < n; i++) { Mr[i][i] -= sh.re; Mi[i][i] = -sh.im; }
  const f = luFactor(embed(Mr, Mi));
  let x = new Float64Array(2 * n); for (let i = 0; i < n; i++) x[i] = 1 / Math.sqrt(n) + 0.01 * i;
  for (let k = 0; k < iters; k++) {
    x = luSolve(f, x);
    let nrm = 0; for (let i = 0; i < 2 * n; i++) nrm += x[i] * x[i]; nrm = Math.sqrt(nrm);
    for (let i = 0; i < 2 * n; i++) x[i] /= nrm;
  }
  return Array.from({ length: n }, (_, i) => ({ re: x[i], im: x[i + n] }));
}

// ---------- dense convex QP (primal-dual interior point) ----------
// min ½xᵀHx + cᵀx  s.t.  Aeq x = beq,  G x <= h
export function qpSolve({ H, c, Aeq = [], beq = [], G = [], h = [] }, { tol = 1e-9, maxIter = 80 } = {}) {
  const n = c.length, me = Aeq.length, mi = G.length;
  let x = new Float64Array(n), y = new Float64Array(me), s = new Float64Array(mi), z = new Float64Array(mi);
  for (let i = 0; i < mi; i++) { let gx = 0; for (let j = 0; j < n; j++) gx += G[i][j] * x[j]; s[i] = Math.max(1, h[i] - gx); z[i] = 1; }
  let it = 0;
  for (; it < maxIter; it++) {
    const rd = new Float64Array(n), rp = new Float64Array(me), ri = new Float64Array(mi);
    for (let j = 0; j < n; j++) { let v = c[j]; for (let k = 0; k < n; k++) v += H[j][k] * x[k]; rd[j] = v; }
    for (let i = 0; i < me; i++) { let v = -beq[i]; for (let j = 0; j < n; j++) { v += Aeq[i][j] * x[j]; rd[j] += Aeq[i][j] * y[i]; } rp[i] = v; }
    for (let i = 0; i < mi; i++) { let v = s[i] - h[i]; for (let j = 0; j < n; j++) { v += G[i][j] * x[j]; rd[j] += G[i][j] * z[i]; } ri[i] = v; }
    let mu = 0; for (let i = 0; i < mi; i++) mu += s[i] * z[i]; mu = mi ? mu / mi : 0;
    const nrm = (v) => v.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
    if (nrm(rd) < tol && nrm(rp) < tol && nrm(ri) < tol && mu < tol) break;
    const sigma = 0.1, N = n + me, K = zeros(N), rhs = new Float64Array(N);
    for (let j = 0; j < n; j++) { for (let k = 0; k < n; k++) K[j][k] = H[j][k]; K[j][j] += 1e-10; }
    for (let i = 0; i < mi; i++) {
      const d = z[i] / s[i], Gi = G[i];
      // rhs from: Gᵀ(Z/S)(ri) ... with complementarity target sigma*mu
      const t = (z[i] * ri[i] - (s[i] * z[i] - sigma * mu)) / s[i];
      for (let j = 0; j < n; j++) {
        if (Gi[j] === 0) continue;
        rhs[j] -= Gi[j] * t;
        for (let k = 0; k < n; k++) K[j][k] += Gi[j] * d * Gi[k];
      }
    }
    for (let j = 0; j < n; j++) rhs[j] -= rd[j];
    for (let i = 0; i < me; i++) { for (let j = 0; j < n; j++) { K[n + i][j] = Aeq[i][j]; K[j][n + i] = Aeq[i][j]; } K[n + i][n + i] = -1e-9; rhs[n + i] = -rp[i]; }
    let sol; try { sol = solve(K, rhs); } catch { it = maxIter; break; }
    const dx = sol.slice(0, n), dy = sol.slice(n);
    const ds = new Float64Array(mi), dz = new Float64Array(mi);
    for (let i = 0; i < mi; i++) {
      let gdx = 0; for (let j = 0; j < n; j++) gdx += G[i][j] * dx[j];
      ds[i] = -ri[i] - gdx;
      dz[i] = (sigma * mu - s[i] * z[i] - z[i] * ds[i]) / s[i];
    }
    let alpha = 1;
    for (let i = 0; i < mi; i++) { if (ds[i] < 0) alpha = Math.min(alpha, -0.99 * s[i] / ds[i]); if (dz[i] < 0) alpha = Math.min(alpha, -0.99 * z[i] / dz[i]); }
    for (let j = 0; j < n; j++) x[j] += alpha * dx[j];
    for (let i = 0; i < me; i++) y[i] += alpha * dy[i];
    for (let i = 0; i < mi; i++) { s[i] += alpha * ds[i]; z[i] += alpha * dz[i]; }
  }
  let obj = 0; for (let j = 0; j < n; j++) { obj += c[j] * x[j]; for (let k = 0; k < n; k++) obj += 0.5 * x[j] * H[j][k] * x[k]; }
  return { x, y, z, s, obj, iterations: it, converged: it < maxIter };
}
