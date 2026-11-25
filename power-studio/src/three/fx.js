// Visual effects: physically-motivated fire & smoke particle systems, arc flash, blackbody colour.
import * as THREE from 'three';

let _tex = null;
function softTex() {
  if (_tex) return _tex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _tex = new THREE.CanvasTexture(c); return _tex;
}

/** Approximate blackbody colour (Kelvin → THREE.Color), Tanner Helland fit. */
export function blackbody(K) {
  const t = Math.max(1000, Math.min(40000, K)) / 100;
  let r, g, b;
  r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const cl = (x) => Math.max(0, Math.min(255, x)) / 255;
  return new THREE.Color(cl(r), cl(g), cl(b));
}

/** Fire with buoyant flame particles (hot core → cooling red → dark), rising smoke and flickering light. */
export class Fire {
  constructor(parent, pos, { scale = 1, intensity = 1 } = {}) {
    this.scale = scale; this.intensity = intensity; this.group = new THREE.Group(); this.group.position.copy(pos); parent.add(this.group);
    const mk = (N, size, blending) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const mat = new THREE.PointsMaterial({ size: size * scale, map: softTex(), vertexColors: true, transparent: true, depthWrite: false, blending, sizeAttenuation: true });
      const p = new THREE.Points(geo, mat); this.group.add(p);
      return { p, N, life: new Float32Array(N).map(() => Math.random()), vel: new Float32Array(N * 3), seed: new Float32Array(N).map(() => Math.random()) };
    };
    this.flame = mk(160, 0.55, THREE.AdditiveBlending);
    this.smoke = mk(70, 1.3, THREE.NormalBlending); this.smoke.p.material.opacity = 0.55;
    this.light = new THREE.PointLight(0xff7a1a, 0, 10 * scale, 1.6); this.light.position.y = 0.6 * scale; this.group.add(this.light);
    this.t = 0;
  }
  update(dt) {
    this.t += dt; const s = this.scale, I = this.intensity;
    const upd = (sys, isSmoke) => {
      const pos = sys.p.geometry.attributes.position.array, col = sys.p.geometry.attributes.color.array;
      const rate = isSmoke ? 0.35 : 1.4 + Math.random() * 0.3;
      for (let i = 0; i < sys.N; i++) {
        sys.life[i] += dt * rate * (0.7 + sys.seed[i] * 0.6);
        if (sys.life[i] >= 1) { // respawn at base (fuel surface)
          sys.life[i] = 0; const a = Math.random() * Math.PI * 2, r = Math.random() ** 0.5 * 0.35 * s;
          pos[3 * i] = Math.cos(a) * r; pos[3 * i + 1] = isSmoke ? 0.8 * s : 0; pos[3 * i + 2] = Math.sin(a) * r;
          sys.vel[3 * i] = (Math.random() - 0.5) * 0.3 * s; sys.vel[3 * i + 1] = (isSmoke ? 0.9 : 1.6 + Math.random()) * s; sys.vel[3 * i + 2] = (Math.random() - 0.5) * 0.3 * s;
        }
        const L = sys.life[i];
        // buoyancy + turbulence; flames converge to a tip
        sys.vel[3 * i] += (Math.sin(this.t * 9 + i) * 0.6 - pos[3 * i] * (isSmoke ? 0.2 : 3)) * dt * s;
        sys.vel[3 * i + 2] += (Math.cos(this.t * 7 + i * 1.3) * 0.6 - pos[3 * i + 2] * (isSmoke ? 0.2 : 3)) * dt * s;
        sys.vel[3 * i + 1] += (isSmoke ? 0.2 : 1.2) * dt * s;
        for (let k = 0; k < 3; k++) pos[3 * i + k] += sys.vel[3 * i + k] * dt;
        let c;
        if (isSmoke) { const g = 0.18 + 0.15 * (1 - L); c = [g, g, g]; const f = Math.sin(Math.PI * L) * I; c = c.map((x) => x * f + 0.0); }
        else { const K = 1900 - 1100 * L; const bb = blackbody(K * 1.0 + 200); const f = (1 - L) ** 1.3 * I; c = [bb.r * f, bb.g * f * 0.85, bb.b * f * 0.6]; }
        col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2];
      }
      sys.p.geometry.attributes.position.needsUpdate = true; sys.p.geometry.attributes.color.needsUpdate = true;
    };
    upd(this.flame, false); upd(this.smoke, true);
    this.flame.p.visible = I > 0.02;
    this.light.intensity = I * (14 + 6 * Math.sin(this.t * 23) + 4 * Math.sin(this.t * 37)) * s;
  }
  dispose() { this.group.parent?.remove(this.group); [this.flame, this.smoke].forEach((x) => { x.p.geometry.dispose(); x.p.material.dispose(); }); }
}

/** Electric arc flash: jagged bright plasma channel + bluish-white light, re-randomised each frame. */
export class Arc {
  constructor(parent, a, b) {
    this.a = a.clone(); this.b = b.clone(); this.line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xcfe6ff })); parent.add(this.line);
    this.light = new THREE.PointLight(0x9fc8ff, 0, 14, 1.5); this.light.position.copy(a.clone().lerp(b, 0.5)); parent.add(this.light); this.parent = parent;
  }
  update() {
    const pts = []; const N = 14;
    for (let i = 0; i <= N; i++) { const p = this.a.clone().lerp(this.b, i / N); if (i && i < N) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5)); pts.push(p); }
    this.line.geometry.dispose(); this.line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.line.visible = Math.random() > 0.15; this.light.intensity = this.line.visible ? 25 + Math.random() * 20 : 3;
  }
  dispose() { this.parent.remove(this.line, this.light); this.line.geometry.dispose(); }
}
