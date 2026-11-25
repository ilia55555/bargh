// 3D circuit builder (three.js): breadboard grid, click-to-place components between grid points,
// node-voltage colouring, animated current, glowing lamps and value labels.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { heat } from '../ui/layout.js';
import { Fire, Arc, blackbody } from './fx.js';
import { resistorBands } from '../engines/circuit.js';

const GRID = 12, SP = 2; // grid points per side, spacing (scene units)
const W = (p) => new THREE.Vector3((p[0] - 5) * SP, 0, (p[1] - 5) * SP);
export const si = (v, u) => {
  if (!u) return '';
  if (Math.abs(v) < 1e-9) return `0 ${u}`;
  const a = Math.abs(v), P = [[1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];
  for (const [m, s] of P) if (a >= m * 0.999) return `${+(v / m).toPrecision(4)} ${s}${u}`;
  return `${+(v / 1e-12).toPrecision(4)} p${u}`;
};

export class Circuit3D {
  constructor(container, { onPlace, onSelect } = {}) {
    Object.assign(this, { container, onPlace, onSelect });
    const w = container.clientWidth || 800, h = container.clientHeight || 520;
    this.renderer = new THREE.WebGLRenderer({ antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true; container.append(this.renderer.domElement);
    this.labels = new CSS2DRenderer(); this.labels.setSize(w, h);
    Object.assign(this.labels.domElement.style, { position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }); container.append(this.labels.domElement);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x0a1020);
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 500); this.camera.position.set(0, 17, 15);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.target.set(0, 0, 0); this.controls.enableDamping = true; this.controls.maxPolarAngle = 1.45;
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x10182a, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(8, 20, 10); sun.castShadow = true; this.scene.add(sun);
    // board
    const size = GRID * SP + 2;
    this.board = new THREE.Mesh(new THREE.BoxGeometry(size, 0.4, size), new THREE.MeshStandardMaterial({ color: 0x1f5e3a, roughness: 0.8 }));
    this.board.position.set(W([GRID / 2 - 3, 0]).x - SP / 2 + SP / 2, -0.25, W([0, GRID / 2 - 3]).z); this.board.receiveShadow = true; this.scene.add(this.board);
    this.board.position.set((W([0, 0]).x + W([GRID - 1, 0]).x) / 2, -0.25, (W([0, 0]).z + W([0, GRID - 1]).z) / 2);
    const holeGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.05, 8), holeMat = new THREE.MeshBasicMaterial({ color: 0x9fd9b4 });
    const holes = new THREE.InstancedMesh(holeGeo, holeMat, GRID * GRID); let k = 0; const m4 = new THREE.Matrix4();
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) { const p = W([i, j]); m4.makeTranslation(p.x, -0.03, p.z); holes.setMatrixAt(k++, m4); }
    this.scene.add(holes);
    this.cursor = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.4, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })); this.cursor.rotation.x = -Math.PI / 2; this.cursor.position.y = 0.02; this.scene.add(this.cursor);
    this.anchorMark = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd34d })); this.anchorMark.visible = false; this.scene.add(this.anchorMark);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.fxLayer = new THREE.Group(); this.scene.add(this.fxLayer); this.fires = new Map(); this.arcs = []; this.parts = new Map();
    this.tool = 'R'; this.anchor = null; this.pick = []; this.flows = []; this.lamps = [];
    this.ray = new THREE.Raycaster(); this.ptr = new THREE.Vector2(); this.clock = new THREE.Clock();
    const el = this.renderer.domElement;
    this._down = (e) => { this._dx = e.clientX; this._dy = e.clientY; };
    this._up = (e) => { if (Math.hypot(e.clientX - this._dx, e.clientY - this._dy) < 5) this.click(e); };
    this._move = (e) => { const g = this.gridAt(e); this.cursor.visible = !!g; if (g) { const p = W(g); this.cursor.position.set(p.x, 0.02, p.z); } };
    el.addEventListener('pointerdown', this._down); el.addEventListener('pointerup', this._up); el.addEventListener('pointermove', this._move);
    this._ro = new ResizeObserver(() => { const W2 = container.clientWidth, H2 = container.clientHeight; if (!W2 || !H2) return; this.renderer.setSize(W2, H2); this.labels.setSize(W2, H2); this.camera.aspect = W2 / H2; this.camera.updateProjectionMatrix(); });
    this._ro.observe(container);
    this._raf = requestAnimationFrame(() => this.loop());
  }
  setTool(t) { this.tool = t; this.anchor = null; this.anchorMark.visible = false; }
  setPointer(e) { const r = this.renderer.domElement.getBoundingClientRect(); this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); this.ray.setFromCamera(this.ptr, this.camera); }
  gridAt(e) {
    this.setPointer(e);
    const hit = new THREE.Vector3(); if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    const o = W([0, 0]), i = Math.round((hit.x - o.x) / SP), j = Math.round((hit.z - o.z) / SP);
    return i >= 0 && j >= 0 && i < GRID && j < GRID ? [i, j] : null;
  }
  click(e) {
    this.setPointer(e);
    if (this.tool === 'select' || this.tool === 'delete') { const h = this.ray.intersectObjects(this.pick, true)[0]; let o = h?.object; while (o && !o.userData.id) o = o.parent; this.onSelect?.(o?.userData.id || null, this.tool); return; }
    const g = this.gridAt(e); if (!g) return;
    if (this.tool === 'GND') { this.onPlace?.(g, g); return; }
    if (!this.anchor) { this.anchor = g; const p = W(g); this.anchorMark.position.set(p.x, 0.3, p.z); this.anchorMark.visible = true; return; }
    if (g[0] === this.anchor[0] && g[1] === this.anchor[1]) { this.anchor = null; this.anchorMark.visible = false; return; }
    const a = this.anchor; this.anchor = null; this.anchorMark.visible = false; this.onPlace?.(a, g);
  }

  clear() {
    this.root.traverse((o) => { o.geometry?.dispose?.(); if (o.isCSS2DObject) o.element.remove(); });
    this.scene.remove(this.root); this.root = new THREE.Group(); this.scene.add(this.root); this.pick = []; this.flows = []; this.lamps = []; this.parts = new Map();
  }

  /** comps + solution (from solveCircuit) + selected id */
  build(comps, sol, selected = null, showLabels = true) {
    this.clear();
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.3, roughness: 0.45, ...o });
    // node voltages
    let vmax = 1e-9; if (sol?.ok) sol.nodeV.forEach((v) => { vmax = Math.max(vmax, Math.hypot(...v)); });
    const used = new Map(); comps.forEach((c) => { used.set(c.a.join(), c.a); if (c.type !== 'GND') used.set(c.b.join(), c.b); });
    used.forEach((p, k) => {
      const v = sol?.ok ? sol.nodeV.get(k) : null, col = v ? heat(Math.hypot(...v) / vmax) : [200, 200, 200];
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 16), mat(new THREE.Color(...col.map((x) => x / 255)), { emissive: new THREE.Color(...col.map((x) => x / 255)), emissiveIntensity: 0.4 }));
      const q = W(p); peg.position.set(q.x, 0.2, q.z); this.root.add(peg);
      if (showLabels && v) { const d = document.createElement('div'); d.className = 'lbl3d'; d.textContent = si(Math.hypot(...v), 'V') + (sol.ac ? ` ∠${((Math.atan2(v[1], v[0]) * 180) / Math.PI).toFixed(0)}°` : ''); const l = new CSS2DObject(d); l.position.set(q.x, 0.9, q.z); this.root.add(l); }
    });
    comps.forEach((c) => {
      const g = new THREE.Group(); g.userData.id = c.id;
      const A = W(c.a), B = W(c.b), L = A.distanceTo(B);
      g.position.copy(A); g.position.y = 0.45; g.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x);
      const lead = (x0, x1, col = 0xc8ccd4) => { if (x1 - x0 < 0.01) return; const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, x1 - x0, 8), mat(col, { metalness: 0.9 })); m.rotation.z = Math.PI / 2; m.position.x = (x0 + x1) / 2; g.add(m); };
      const body = 1.1, s0 = (L - body) / 2, s1 = s0 + body, mid = L / 2;
      const r = sol?.ok ? sol.byId.get(c.id) : null, heatMats = [];
      switch (c.type) {
        case 'W': { // PVC-insulated copper conductor
          const ins = mat(0x2b62d9, { roughness: 0.6 }); heatMats.push(ins);
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, L, 10), ins); m.rotation.z = Math.PI / 2; m.position.x = L / 2; g.add(m);
          break;
        }
        case 'R': case 'LAMP': {
          lead(0, s0); lead(s1, L);
          if (c.type === 'R') {
            // body size follows the power rating (¼ W … ≥5 W wire-wound)
            const big = (c.rating ?? 0.5) >= 5, rad = big ? 0.4 : 0.26;
            const bm = mat(big ? 0x3d6e4a : 0xd9c08f); heatMats.push(bm);
            const b = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, body, 24), bm); b.rotation.z = Math.PI / 2; b.position.x = mid; g.add(b);
            resistorBands(c.value).forEach((cc, i) => { const band = new THREE.Mesh(new THREE.CylinderGeometry(rad + 0.02, rad + 0.02, 0.09, 24), mat(new THREE.Color(cc), { metalness: i === 3 ? 0.8 : 0.2 })); band.rotation.z = Math.PI / 2; band.position.x = s0 + 0.2 + i * (i === 3 ? 0.27 : 0.2); g.add(band); });
          } else {
            // tungsten filament: colour temperature ≈ 2700 K·s^0.2, luminous flux ∝ s^1.7 (s = P/Prated)
            const sP = r ? Math.abs(r.P) / (c.rating || 100) : 0, K = 2700 * Math.max(sP, 1e-3) ** 0.2, lum = Math.min(2.2, sP ** 1.7);
            const bb = blackbody(K);
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0xffffff, emissive: c.burnt ? 0x000000 : bb, emissiveIntensity: c.burnt ? 0 : 0.03 + 2.2 * lum, transparent: true, opacity: 0.55, roughness: 0.05, transmission: 0.6 }));
            bulb.position.set(mid, 0.45, 0); g.add(bulb);
            const fil = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 20, Math.PI), new THREE.MeshBasicMaterial({ color: c.burnt ? 0x222222 : lum > 0.01 ? bb : 0x555555 })); fil.position.set(mid, 0.45, 0); g.add(fil);
            const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.35, 16), mat(0x999999, { metalness: 0.8 })); base.position.set(mid, 0, 0); g.add(base);
            if (lum > 0.01 && !c.burnt) { const light = new THREE.PointLight(bb, 8 * lum, 9, 1.8); light.position.set(mid, 1, 0); g.add(light); }
          }
          break;
        }
        case 'C': {
          // radial electrolytic: aluminium can with PVC sleeve, white stripe marks the (−) lead (terminal b)
          lead(0, mid - 0.3); lead(mid + 0.3, L);
          const can = new THREE.Group(); can.position.set(mid, 0.55, 0); g.add(can);
          const cm = mat(0x1f3f8f, { roughness: 0.35 }); heatMats.push(cm);
          const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.2, 28), cm); can.add(sleeve);
          const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.425, 0.425, 1.2, 28, 1, true, -0.35, 0.7), mat(0xe8e8e8)); stripe.rotation.y = Math.PI / 2; can.add(stripe);
          const top = new THREE.Mesh(new THREE.CircleGeometry(0.4, 28), mat(c.burnt ? 0x3a3a3a : 0xc8ccd4, { metalness: 0.9 })); top.rotation.x = -Math.PI / 2; top.position.y = 0.61; can.add(top);
          if (c.burnt) { top.position.y = 0.72; top.scale.setScalar(1.15); } // vent burst
          for (const dx of [-0.3, 0.3]) { const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), mat(0xc8ccd4, { metalness: 0.9 })); lg.position.set(mid + dx, 0.15, 0); g.add(lg); }
          break;
        }
        case 'L': {
          lead(0, s0); lead(s1, L);
          const pts = []; for (let t = 0; t <= 1; t += 0.005) pts.push(new THREE.Vector3(s0 + t * body, 0.3 * Math.cos(t * 2 * Math.PI * 7), 0.3 * Math.sin(t * 2 * Math.PI * 7)));
          const cu = mat(0xb87333, { metalness: 0.9, roughness: 0.3 }); heatMats.push(cu);
          g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 300, 0.06, 6), cu));
          const core = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, body, 12), mat(0x444a55)); core.rotation.z = Math.PI / 2; core.position.x = mid; g.add(core);
          break;
        }
        case 'V': case 'I': {
          lead(0, s0); lead(s1, L);
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, body, 24), mat(c.type === 'I' ? 0x3ccf91 : c.ac ? 0xf2c94c : 0xe35d6a)); b.rotation.z = Math.PI / 2; b.position.x = mid; g.add(b);
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.15, 16), mat(0xeeeeee, { metalness: 0.9 })); cap.rotation.z = Math.PI / 2; cap.position.x = s0 - 0.05; g.add(cap); // + terminal at a
          if (c.type === 'I') { const cone = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 16), mat(0xffffff)); cone.rotation.z = Math.PI / 2; cone.position.set(mid, 0.65, 0); g.add(cone); }
          break;
        }
        case 'S': {
          lead(0, s0); lead(s1, L);
          const pivot = new THREE.Group(); pivot.position.x = s0; const lever = new THREE.Mesh(new THREE.BoxGeometry(body, 0.08, 0.16), mat(0xcccccc, { metalness: 0.9 })); lever.position.x = body / 2; pivot.add(lever);
          pivot.rotation.z = c.closed ? 0 : 0.6; g.add(pivot);
          break;
        }
        case 'GND': {
          g.position.y = 0.2; g.rotation.y = 0;
          [0.8, 0.55, 0.3].forEach((wd, i) => { const bar = new THREE.Mesh(new THREE.BoxGeometry(wd, 0.08, 0.12), mat(0x9aa4b8)); bar.position.set(0, 0.7 - i * 0.18, 0); g.add(bar); });
          const st = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6), mat(0x9aa4b8)); st.position.y = 1; g.add(st);
          break;
        }
      }
      if (c.burnt) heatMats.forEach((m) => { m.color.setHex(0x1a120c); m.roughness = 1; m.metalness = 0; });
      this.parts.set(c.id, { g, heatMats, base: heatMats.map((m) => m.color.clone()), c, A, B });
      if (c.id === selected) { const box = new THREE.BoxHelper(g, 0xffffff); this.root.add(g); g.updateMatrixWorld(true); box.update(); this.root.add(box); } else this.root.add(g);
      this.pick.push(g);
      if (showLabels && c.type !== 'W' && c.type !== 'GND') {
        const d = document.createElement('div'); d.className = 'lbl3d comp';
        const unit = { R: 'Ω', LAMP: 'Ω', L: 'H', C: 'F', V: 'V', I: 'A' }[c.type];
        d.textContent = c.burnt ? '🔥 سوخته (مدار باز)' : c.type === 'S' ? (c.closed ? 'بسته' : 'باز') : si(c.value, unit) + ((c.type === 'V' || c.type === 'I') && c.ac ? '~' : '') + (r && c.type !== 'V' && c.type !== 'I' ? ` · ${si(r.Im, 'A')}` : '');
        const l = new CSS2DObject(d); const m = A.clone().add(B).multiplyScalar(0.5); l.position.set(m.x, 1.6, m.z); this.root.add(l);
      }
      // current particles
      if (r && r.Im > 1e-9 && c.type !== 'GND') {
        const cnt = Math.max(2, Math.round(L / 0.8)), inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7df9ff }), cnt);
        this.root.add(inst);
        this.flows.push({ inst, A: A.clone().setY(0.45), B: B.clone().setY(0.45), cnt, ph: Math.atan2(r.I[1], r.I[0]), mag: r.Im, dir: Math.sign(r.I[0]) || 1, u: 0 });
      }
    });
    const imax = Math.max(1e-9, ...this.flows.map((f) => f.mag)); this.flows.forEach((f) => { f.rel = f.mag / imax; });
    this.ac = !!sol?.ac;
    // fires: keep running across rebuilds, one per burnt component
    const burnt = new Set(comps.filter((c) => c.burnt).map((c) => c.id));
    for (const [id, f] of this.fires) if (!burnt.has(id)) { f.dispose(); this.fires.delete(id); }
    comps.forEach((c) => {
      if (!c.burnt || this.fires.has(c.id)) return;
      const A = W(c.a), B = W(c.b), m = A.clone().add(B).multiplyScalar(0.5); m.y = 0.7;
      const f = new Fire(this.fxLayer, m, { scale: c.type === 'W' ? 1 : 1.5 }); f.born = this.clock.elapsedTime; this.fires.set(c.id, f);
      if (this.clock.elapsedTime > 0.5 && Date.now() - (c.burnAt || 0) < 3000) { const arc = new Arc(this.fxLayer, A.clone().setY(0.5), B.clone().setY(0.5)); arc.until = this.clock.elapsedTime + 0.7; this.arcs.push(arc); }
    });
  }

  /** Update thermal colouring without rebuilding: scorching tint above 120 °C (insulation/lacquer). */
  setThermal(comps) {
    comps.forEach((c) => {
      const p = this.parts.get(c.id); if (!p || c.burnt) return;
      const T = c.temp ?? 25, k = Math.max(0, Math.min(1, (T - 120) / 160));
      p.heatMats.forEach((m, i) => {
        m.color.copy(p.base[i]).lerp(new THREE.Color(0x2a1408), k * 0.85);
        m.emissive = m.emissive || new THREE.Color(); m.emissive.setRGB(0.25 * k, 0.05 * k, 0); m.emissiveIntensity = 0.6 * k;
      });
    });
  }
  loop() {
    this._raf = requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime, m4 = new THREE.Matrix4(), p = new THREE.Vector3();
    for (const f of this.flows) {
      if (this.ac) f.u = 0.35 * f.rel * Math.sin(2 * Math.PI * 1 * t + f.ph); // 50/60 Hz shown in slow motion (1 Hz) else f.u = (f.u + dt * 0.6 * f.rel * f.dir + 10) % 1;
      for (let j = 0; j < f.cnt; j++) { let u = (j + 0.5) / f.cnt + (this.ac ? f.u / f.cnt * 2 : f.u); u = ((u % 1) + 1) % 1; p.copy(f.A).lerp(f.B, u); m4.makeTranslation(p.x, p.y, p.z); f.inst.setMatrixAt(j, m4); }
      f.inst.instanceMatrix.needsUpdate = true;
    }
    for (const f of this.fires.values()) { const age = t - f.born; f.intensity = age < 8 ? Math.min(1, age * 3) : Math.max(0.08, 1 - (age - 8) / 10); f.update(dt); }
    this.arcs = this.arcs.filter((a) => { if (t > a.until) { a.dispose(); return false; } a.update(); return true; });
    this.controls.update(); this.renderer.render(this.scene, this.camera); this.labels.render(this.scene, this.camera);
  }
  dispose() {
    cancelAnimationFrame(this._raf); this._ro.disconnect(); this.clear(); this.fires.forEach((f) => f.dispose()); this.arcs.forEach((a) => a.dispose()); this.renderer.dispose();
    this.renderer.domElement.remove(); this.labels.domElement.remove();
  }
}
