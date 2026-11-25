// 3D rotating magnetic field of a three-phase stator: three coil axes at 120°,
// pulsating phase field vectors and their rotating resultant (Tesla/Ferraris principle).
// Also visualises unbalance: the resultant traces an ellipse when negative sequence exists.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Field3D {
  constructor(container) {
    this.container = container;
    const w = container.clientWidth || 600, h = container.clientHeight || 400;
    this.renderer = new THREE.WebGLRenderer({ antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.setSize(w, h);
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x0a0f1c);
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200); this.camera.position.set(0, 9, 13);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true;
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6)); const d = new THREE.DirectionalLight(0xffffff, 1); d.position.set(5, 10, 7); this.scene.add(d);
    // stator ring
    const stator = new THREE.Mesh(new THREE.TorusGeometry(5, 0.7, 20, 80), new THREE.MeshStandardMaterial({ color: 0x55606e, metalness: 0.8, roughness: 0.3 }));
    stator.rotation.x = Math.PI / 2; this.scene.add(stator);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.4, 40), new THREE.MeshStandardMaterial({ color: 0x8a6d3b, metalness: 0.7, roughness: 0.35 }));
    this.scene.add(rotor); this.rotor = rotor;
    const cols = [0xe35d6a, 0xf2c94c, 0x4f9dff];
    this.coils = []; this.arrows = [];
    for (let k = 0; k < 3; k++) {
      const a = (k * 2 * Math.PI) / 3;
      for (const s of [1, -1]) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.22, 10, 24), new THREE.MeshStandardMaterial({ color: cols[k], emissive: cols[k], emissiveIntensity: 0.3 }));
        coil.position.set(s * 5 * Math.cos(a), 0, -s * 5 * Math.sin(a)); coil.lookAt(0, 0, 0); this.scene.add(coil); this.coils.push({ coil, k });
      }
      const arr = new THREE.ArrowHelper(new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), new THREE.Vector3(0, 1.0, 0), 3, cols[k], 0.6, 0.35);
      this.scene.add(arr); this.arrows.push({ arr, a });
    }
    this.res = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1.2, 0), 4.5, 0xffffff, 0.9, 0.5); this.scene.add(this.res);
    this.trail = []; this.trailLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x3ccf91 })); this.scene.add(this.trailLine);
    this.amp = [1, 1, 1]; this.ph = [0, -120, 120]; this.speed = 0.5;
    this.clock = new THREE.Clock();
    this._ro = new ResizeObserver(() => { const W = container.clientWidth, H = container.clientHeight; if (!W || !H) return; this.renderer.setSize(W, H); this.camera.aspect = W / H; this.camera.updateProjectionMatrix(); });
    this._ro.observe(container);
    this._raf = requestAnimationFrame(() => this.loop());
  }
  set({ amp, ph, speed }) { if (amp) this.amp = amp; if (ph) this.ph = ph; if (speed) this.speed = speed; this.trail = []; }
  loop() {
    this._raf = requestAnimationFrame(() => this.loop());
    const t = this.clock.getElapsedTime(), w = 2 * Math.PI * this.speed;
    let rx = 0, rz = 0;
    this.arrows.forEach(({ arr, a }, k) => {
      const i = this.amp[k] * Math.cos(w * t + (this.ph[k] * Math.PI) / 180);
      const len = Math.max(0.05, Math.abs(i) * 3);
      const dir = new THREE.Vector3(Math.cos(a) * Math.sign(i || 1), 0, -Math.sin(a) * Math.sign(i || 1));
      arr.setDirection(dir); arr.setLength(len, 0.5, 0.3);
      rx += i * Math.cos(a); rz += -i * Math.sin(a);
    });
    this.coils.forEach(({ coil, k }) => { coil.material.emissiveIntensity = 0.1 + 0.9 * Math.abs(this.amp[k] * Math.cos(w * t + (this.ph[k] * Math.PI) / 180)); });
    const R = Math.hypot(rx, rz) * 2; // ×(2/3)·3 scale
    if (R > 1e-3) { this.res.setDirection(new THREE.Vector3(rx, 0, rz).normalize()); this.res.setLength(R, 0.8, 0.45); }
    this.rotor.rotation.y = -Math.atan2(rz, rx);
    this.trail.push(new THREE.Vector3(rx * 2, 1.25, rz * 2)); if (this.trail.length > 240) this.trail.shift();
    this.trailLine.geometry.dispose(); this.trailLine.geometry = new THREE.BufferGeometry().setFromPoints(this.trail);
    this.controls.update(); this.renderer.render(this.scene, this.camera);
  }
  dispose() { cancelAnimationFrame(this._raf); this._ro.disconnect(); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
