// 3D transmission corridor: lattice towers, bundled phase conductors with catenary sag,
// shield wires and an animated electric-field / current-phase colouring.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Tower3D {
  constructor(container) {
    this.container = container;
    const w = container.clientWidth || 700, h = container.clientHeight || 420;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.setSize(w, h);
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x9cc3e6);
    this.scene.fog = new THREE.Fog(0x9cc3e6, 150, 600);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.5, 2000); this.camera.position.set(-55, 30, 70);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.target.set(0, 18, 0); this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556b2f, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(50, 100, 40); this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 600), new THREE.MeshStandardMaterial({ color: 0x6b8e4e }));
    ground.rotation.x = -Math.PI / 2; this.scene.add(ground);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.clock = new THREE.Clock(); this.wires = [];
    this._ro = new ResizeObserver(() => { const W = container.clientWidth, H = container.clientHeight; if (!W || !H) return; this.renderer.setSize(W, H); this.camera.aspect = W / H; this.camera.updateProjectionMatrix(); });
    this._ro.observe(container);
    this._raf = requestAnimationFrame(() => this.loop());
  }
  /** phases: [[x,y]...] (m), nb, spacing (m), span (m), sag (m) */
  build({ phases, nb = 2, spacing = 0.45, span = 300, sag = 8, towers = 3 }) {
    this.scene.remove(this.root); this.root = new THREE.Group(); this.scene.add(this.root); this.wires = [];
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a939e, metalness: 0.8, roughness: 0.35 });
    const S = span / 10; // scene units: 1 unit = 10 m along the corridor (compressed)
    const topY = Math.max(...phases.map((p) => p[1])) + 6, halfW = Math.max(...phases.map((p) => Math.abs(p[0]))) + 2;
    const beam = (a, b, r = 0.18) => { const len = a.distanceTo(b); const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), steel); m.position.copy(a.clone().add(b).multiplyScalar(0.5)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); return m; };
    for (let k = 0; k < towers; k++) {
      const z = (k - (towers - 1) / 2) * S, g = new THREE.Group();
      const legs = [[-3, -2], [3, -2], [3, 2], [-3, 2]];
      const topLegs = [[-1, -0.8], [1, -0.8], [1, 0.8], [-1, 0.8]];
      for (let l = 0; l < 4; l++) {
        const a = new THREE.Vector3(legs[l][0], 0, z + legs[l][1]), b = new THREE.Vector3(topLegs[l][0], topY, z + topLegs[l][1]);
        g.add(beam(a, b, 0.25));
        const n = (l + 1) % 4;
        for (let s = 0; s < 8; s++) { // lattice bracing
          const u0 = s / 8, u1 = (s + 1) / 8;
          const p0 = a.clone().lerp(b, u0), q1 = new THREE.Vector3(legs[n][0], 0, z + legs[n][1]).lerp(new THREE.Vector3(topLegs[n][0], topY, z + topLegs[n][1]), u1);
          g.add(beam(p0, q1, 0.07));
        }
      }
      // cross-arms at each distinct phase height
      [...new Set(phases.map((p) => p[1]))].forEach((y) => { g.add(beam(new THREE.Vector3(-halfW, y + 1.5, z), new THREE.Vector3(halfW, y + 1.5, z), 0.22)); });
      g.add(beam(new THREE.Vector3(-halfW * 0.7, topY + 3, z), new THREE.Vector3(halfW * 0.7, topY + 3, z), 0.15));
      // insulators
      phases.forEach(([x, y]) => {
        const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.5, 10), new THREE.MeshStandardMaterial({ color: 0x5d8aa8, roughness: 0.2, metalness: 0.1 }));
        ins.position.set(x, y + 0.75, z); g.add(ins);
      });
      this.root.add(g);
    }
    // conductors with catenary sag (parabolic approx), bundles
    const phaseCol = [0xe35d6a, 0xf2c94c, 0x4f9dff];
    phases.forEach(([x, y], p) => {
      for (let b = 0; b < nb; b++) {
        const ang = (2 * Math.PI * b) / nb, R = nb > 1 ? spacing / (2 * Math.sin(Math.PI / nb)) : 0;
        const ox = R * Math.cos(ang) * 2, oy = R * Math.sin(ang) * 2; // exaggerated ×2 for visibility
        for (let k = 0; k < towers - 1; k++) {
          const z0 = (k - (towers - 1) / 2) * S, pts = [];
          for (let s = 0; s <= 40; s++) { const u = s / 40, zz = z0 + u * S, dy = -4 * sag * u * (1 - u); pts.push(new THREE.Vector3(x + ox, y + oy + dy, zz)); }
          const curve = new THREE.CatmullRomCurve3(pts);
          const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.09, 6), new THREE.MeshStandardMaterial({ color: phaseCol[p % 3], emissive: phaseCol[p % 3], emissiveIntensity: 0.4, metalness: 0.7 }));
          this.root.add(mesh); this.wires.push({ mesh, p });
        }
      }
    });
    // shield wires
    for (const sx of [-halfW * 0.7, halfW * 0.7]) for (let k = 0; k < towers - 1; k++) {
      const z0 = (k - (towers - 1) / 2) * S, pts = [];
      for (let s = 0; s <= 30; s++) { const u = s / 30; pts.push(new THREE.Vector3(sx, topY + 3 - 3 * sag * u * (1 - u) * 0.6, z0 + u * S)); }
      this.root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.05, 5), steel));
    }
  }
  loop() {
    this._raf = requestAnimationFrame(() => this.loop());
    const t = this.clock.getElapsedTime();
    // animate instantaneous phase current (50 Hz slowed): brightness ∝ |sin|
    this.wires.forEach(({ mesh, p }) => { mesh.material.emissiveIntensity = 0.15 + 0.85 * Math.abs(Math.sin(2 * Math.PI * 0.5 * t - (p * 2 * Math.PI) / 3)); });
    this.controls.update(); this.renderer.render(this.scene, this.camera);
  }
  dispose() { cancelAnimationFrame(this._raf); this._ro.disconnect(); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
