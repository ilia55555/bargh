// Minimal complex arithmetic on {re, im} objects.
export const C = (re = 0, im = 0) => ({ re, im });
export const cadd = (a, b) => C(a.re + b.re, a.im + b.im);
export const csub = (a, b) => C(a.re - b.re, a.im - b.im);
export const cmul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const cdiv = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
export const cconj = (a) => C(a.re, -a.im);
export const cabs = (a) => Math.hypot(a.re, a.im);
export const carg = (a) => Math.atan2(a.im, a.re);
export const cscale = (a, s) => C(a.re * s, a.im * s);
export const cneg = (a) => C(-a.re, -a.im);
export const polar = (m, th) => C(m * Math.cos(th), m * Math.sin(th));
export const cinvs = (a) => cdiv(C(1, 0), a);
export const csqrt = (a) => {
  const m = Math.sqrt(cabs(a)), th = carg(a) / 2;
  return polar(m, th);
};
export const cexp = (a) => polar(Math.exp(a.re), a.im);
export const ccosh = (a) => C(Math.cosh(a.re) * Math.cos(a.im), Math.sinh(a.re) * Math.sin(a.im));
export const csinh = (a) => C(Math.sinh(a.re) * Math.cos(a.im), Math.cosh(a.re) * Math.sin(a.im));
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;
export const fmtC = (a, d = 4) => `${cabs(a).toFixed(d)}∠${deg(carg(a)).toFixed(2)}°`;
// Symmetrical components operator a = 1∠120°
export const A_OP = polar(1, (2 * Math.PI) / 3);
export function seqToPhase(z0, z1, z2) {
  const a = A_OP, a2 = cmul(a, a);
  return [
    cadd(cadd(z0, z1), z2),
    cadd(cadd(z0, cmul(a2, z1)), cmul(a, z2)),
    cadd(cadd(z0, cmul(a, z1)), cmul(a2, z2)),
  ];
}
export function phaseToSeq(va, vb, vc) {
  const a = A_OP, a2 = cmul(a, a), t = 1 / 3;
  return [
    cscale(cadd(cadd(va, vb), vc), t),
    cscale(cadd(cadd(va, cmul(a, vb)), cmul(a2, vc)), t),
    cscale(cadd(cadd(va, cmul(a2, vb)), cmul(a, vc)), t),
  ];
}
