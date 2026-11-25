// Protection: IDMT overcurrent curves (IEC 60255 / IEEE C37.112), radial coordination,
// distance-relay mho zones, and percentage-differential characteristic.
export const CURVES = {
  'IEC SI': { k: 0.14, a: 0.02, c: 0, std: 'IEC' },
  'IEC VI': { k: 13.5, a: 1, c: 0, std: 'IEC' },
  'IEC EI': { k: 80, a: 2, c: 0, std: 'IEC' },
  'IEC LTI': { k: 120, a: 1, c: 0, std: 'IEC' },
  'IEEE MI': { k: 0.0515, a: 0.02, c: 0.114, std: 'IEEE' },
  'IEEE VI': { k: 19.61, a: 2, c: 0.491, std: 'IEEE' },
  'IEEE EI': { k: 28.2, a: 2, c: 0.1217, std: 'IEEE' },
};
export function tripTime(curve, M, TMS) {
  const c = CURVES[curve]; if (M <= 1) return Infinity;
  return TMS * (c.k / (M ** c.a - 1) + c.c);
}
/**
 * Radial coordination from the far end upstream.
 * relays: [{name, Ip (pickup A), curve, Ifmax (max fault at relay location A)}] ordered far → source.
 */
export function coordinate(relays, { CTI = 0.3, TMSmin = 0.05 } = {}) {
  const out = [];
  relays.forEach((r, i) => {
    let TMS = TMSmin;
    if (i > 0) {
      const prev = out[i - 1], If = relays[i - 1].Ifmax; // fault just after downstream relay
      const tDown = tripTime(prev.curve, If / prev.Ip, prev.TMS);
      const tReq = tDown + CTI, base = tripTime(r.curve, If / r.Ip, 1);
      TMS = Math.max(TMSmin, tReq / base);
    }
    out.push({ ...r, TMS, tAtOwnFault: tripTime(r.curve, r.Ifmax / r.Ip, TMS) });
  });
  return out;
}
export function tccCurve(r, Imin, Imax, pts = 120) {
  const x = [], y = [];
  for (let k = 0; k < pts; k++) {
    const I = Imin * (Imax / Imin) ** (k / (pts - 1)), t = tripTime(r.curve, I / r.Ip, r.TMS);
    if (Number.isFinite(t) && t < 100) { x.push(I); y.push(t); }
  }
  return { x, y };
}
/** Mho zones for a line impedance ZL (ohm, complex as {re,im}). */
export function mhoZones(ZL, reach = [0.8, 1.2, 2.0], delays = [0, 0.3, 0.8]) {
  const ang = Math.atan2(ZL.im, ZL.re), mag = Math.hypot(ZL.re, ZL.im);
  return reach.map((k, i) => {
    const Zr = k * mag;
    return { zone: i + 1, reach: Zr, delay: delays[i], center: { re: (Zr / 2) * Math.cos(ang), im: (Zr / 2) * Math.sin(ang) }, radius: Zr / 2 };
  });
}
export function inMho(z, zone) { return Math.hypot(z.re - zone.center.re, z.im - zone.center.im) <= zone.radius; }
/** Dual-slope percentage differential. */
export function differential(I1, I2, { Imin = 0.3, k1 = 0.25, k2 = 0.6, Ibp = 2 } = {}) {
  const Id = Math.abs(I1 + I2), Ir = (Math.abs(I1) + Math.abs(I2)) / 2;
  const thr = Ir <= Ibp ? Math.max(Imin, k1 * Ir) : Math.max(Imin, k1 * Ibp + k2 * (Ir - Ibp));
  return { Id, Ir, thr, trip: Id > thr };
}
