// Interactive 3D power-network scene (three.js): buses as substations, lines as tubes coloured by
// loading, animated power-flow particles, generators with spinning rotors, loads, a voltage
// "landscape" surface, fault markers, transient playback and electromechanical mode-shape animation.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { layoutCase, heat } from '../ui/layout.js';
import { indexCase } from '../engines/network.js';

const SCALE = 42;
const col = (rgb) => new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);

export class Network3D {
  constructor(container, { onSelect = null } = {}) {
    this.container = container; this.onSelect = onSelect;
    this.opts = { height: 'voltage', particles: true, labels: true, surface: false, rotate: false, colorBy: 'loading' };
    const w = container.clientWidth || 800, h = container.clientHeight || 520;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    container.append(this.renderer.domElement);
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
    container.append(this.labelRenderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070b14);
    this.scene.fog = new THREE.Fog(0x070b14, 120, 320);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.5, 1000);
    this.camera.position.set(0, 50, 64);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.49;
    this.scene.add(new THREE.HemisphereLight(0x9fc3ff, 0x0b1020, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(40, 80, 30); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70 });
    this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.MeshStandardMaterial({ color: 0x0c1322, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    const grid = new THREE.GridHelper(200, 50, 0x1d2a44, 0x131c2e); grid.position.y = 0.02; this.scene.add(grid);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.pickables = [];
    this._onClick = (e) => this.pick(e);
    this.renderer.domElement.addEventListener('click', this._onClick);
    this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(container);
    this.playback = null; this.mode = null; this.fault = null;
    this._raf = requestAnimationFrame(() => this.loop());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h); this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setOptions(o) { Object.assign(this.opts, o); if (this.cs) this.build(this.cs, this.pf, this.extra); }

  clear() {
    this.root.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); if (o.isCSS2DObject) o.element.remove(); });
    this.scene.remove(this.root); this.root = new THREE.Group(); this.scene.add(this.root);
    this.pickables = []; this.gens = []; this.flows = []; this.busObjs = [];
  }

  busHeight(i) {
    const pf = this.pf;
    if (!pf || this.opts.height === 'flat') return 2;
    if (this.opts.height === 'angle') { const a = pf.bus[i].Va, mn = this._amin, mx = this._amax; return 1 + ((a - mn) / (mx - mn || 1)) * 18; }
    return 1 + ((pf.V[i] - this._vlo) / (this._vhi - this._vlo)) * 14;
  }

  /** cs: case, pf: power-flow result (optional), extra: {outages:Set, faultBus, lmp:[], busValues:{values,label,lo,hi}} */
  build(cs, pf = null, extra = {}) {
    this.cs = cs; this.pf = pf; this.extra = extra;
    this.clear();
    const P = layoutCase(cs), idx = indexCase(cs), n = cs.bus.length;
    if (pf) {
      const a = pf.bus.map((b) => b.Va); this._amin = Math.min(...a); this._amax = Math.max(...a);
      this._vlo = Math.min(0.94, pf.Vmin - 0.005); this._vhi = Math.max(1.06, pf.Vmax + 0.005);
    }
    this.pos = P.map(([x, y], i) => new THREE.Vector3(x * SCALE, this.busHeight(i), y * SCALE));
    const bv = extra.busValues;
    const busColor = (i) => {
      if (bv) return col(heat((bv.values[i] - bv.lo) / (bv.hi - bv.lo || 1)));
      if (!pf) return new THREE.Color(0x8fb3ff);
      if (pf.type[i] === 4) return new THREE.Color(0x333844);
      return col(heat((pf.V[i] - this._vlo) / (this._vhi - this._vlo)));
    };
    // ---------- buses ----------
    const busGeo = new THREE.CylinderGeometry(1.3, 1.5, 0.8, 24);
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 1, 6);
    for (let i = 0; i < n; i++) {
      const p = this.pos[i], c = busColor(i);
      const m = new THREE.Mesh(busGeo, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4 }));
      m.position.copy(p); m.castShadow = true; m.userData = { kind: 'bus', i };
      this.root.add(m); this.pickables.push(m); this.busObjs.push(m);
      const pole = new THREE.Mesh(poleGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35 }));
      pole.scale.y = p.y; pole.position.set(p.x, p.y / 2, p.z); this.root.add(pole);
      const shadowDot = new THREE.Mesh(new THREE.CircleGeometry(0.9, 16), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.25 }));
      shadowDot.rotation.x = -Math.PI / 2; shadowDot.position.set(p.x, 0.05, p.z); this.root.add(shadowDot);
      if (this.opts.labels) {
        const d = document.createElement('div'); d.className = 'lbl3d';
        d.textContent = cs.bus[i].id + (pf && pf.type[i] !== 4 ? ` · ${pf.V[i].toFixed(3)}` : '');
        const lo = new CSS2DObject(d); lo.position.set(p.x, p.y + 1.6, p.z); this.root.add(lo);
      }
      // loads
      const Pd = cs.bus[i].Pd;
      if (Pd > 0.01 * cs.baseMVA * 0.1) {
        const s = Math.min(2.4, 0.5 + Math.sqrt(Pd / cs.baseMVA) * 0.9);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55 * s, 1.4 * s, 16), new THREE.MeshStandardMaterial({ color: 0xff8a3d, emissive: 0x552200, roughness: 0.5 }));
        cone.rotation.x = Math.PI; cone.position.set(p.x + 1.9, p.y - 0.2, p.z + 1.2); cone.castShadow = true;
        cone.userData = { kind: 'bus', i }; this.pickables.push(cone); this.root.add(cone);
      }
    }
    // ---------- generators ----------
    cs.gen.forEach((g, k) => {
      const i = idx.get(g.bus), p = this.pos[i], on = g.status > 0 && (!pf || pf.gens[k].on);
      const grp = new THREE.Group(); grp.position.set(p.x - 2.2, p.y + 0.4, p.z - 1.6);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.2, 24), new THREE.MeshStandardMaterial({ color: on ? 0x3ccf91 : 0x555b66, metalness: 0.6, roughness: 0.3, emissive: on ? 0x0b3d2a : 0 }));
      body.rotation.z = Math.PI / 2; body.castShadow = true; grp.add(body);
      const rotor = new THREE.Group();
      for (let b = 0; b < 3; b++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 0.35), new THREE.MeshStandardMaterial({ color: 0xdfe8ff, metalness: 0.5 })); blade.rotation.x = (b * 2 * Math.PI) / 3; rotor.add(blade); }
      rotor.position.x = 1.3; grp.add(rotor);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.08, 8, 40), new THREE.MeshBasicMaterial({ color: 0x3ccf91, transparent: true, opacity: 0.6 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = -0.9; grp.add(ring);
      body.userData = { kind: 'gen', k, i }; this.pickables.push(body);
      this.root.add(grp);
      const Pg = pf ? pf.gens[k].Pg : g.Pg;
      this.gens.push({ k, i, grp, rotor, ring, body, base: grp.position.clone(), speed: on ? 2 + (6 * Math.abs(Pg)) / Math.max(g.Pmax || 100, 1) : 0 });
    });
    // ---------- branches ----------
    const out = extra.outages || new Set();
    cs.branch.forEach((br, k) => {
      const f = idx.get(br.from), t = idx.get(br.to), a = this.pos[f], b = this.pos[t];
      const on = br.status && !out.has(k);
      const res = pf?.branch[k];
      const load = res ? res.loading / 100 : 0.3;
      let c = on ? col(heat(this.opts.colorBy === 'loading' && pf ? load : 0.15)) : new THREE.Color(0xff3355);
      if (extra.branchValues) c = col(heat(extra.branchValues[k]));
      const len = a.distanceTo(b), mid = a.clone().add(b).multiplyScalar(0.5);
      const isXf = br.ratio && br.ratio !== 0;
      const rad = on ? 0.16 + Math.min(0.35, (res ? Math.abs(res.Pf) : 50) / cs.baseMVA / 12) : 0.1;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 10, 1, true), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: on ? 0.55 : 0.2, transparent: !on, opacity: on ? 1 : 0.35 }));
      tube.position.copy(mid); tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      tube.userData = { kind: 'branch', k }; this.pickables.push(tube); this.root.add(tube);
      if (isXf && on) {
        for (const s of [-0.35, 0.35]) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.16, 10, 28), new THREE.MeshStandardMaterial({ color: 0xb18cff, emissive: 0x3a2266, metalness: 0.4 }));
          ring.position.copy(mid.clone().add(b.clone().sub(a).normalize().multiplyScalar(s)));
          ring.lookAt(b); ring.userData = { kind: 'branch', k }; this.pickables.push(ring); this.root.add(ring);
        }
      }
      if (!on || !pf || !this.opts.particles) return;
      const P = res.Pf, cnt = Math.max(1, Math.min(14, Math.round(len / 5 * (0.4 + load))));
      const dir = P >= 0 ? 1 : -1, speed = (0.08 + Math.min(1.6, Math.abs(P) / Math.max(br.rateA || cs.baseMVA * 3, 1))) * 0.6;
      const geo = new THREE.SphereGeometry(0.26, 8, 8), mat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
      const inst = new THREE.InstancedMesh(geo, mat, cnt);
      this.root.add(inst);
      this.flows.push({ inst, a, b, cnt, dir, speed: speed / Math.max(len / 20, 0.3), phase: Math.random() });
    });
    // ---------- voltage surface ----------
    if (this.opts.surface && pf) this.buildSurface();
    // ---------- fault marker ----------
    if (extra.faultBus !== undefined && extra.faultBus !== null) this.setFault(extra.faultBus);
    // frame
    if (!this._framed) { this._framed = true; this.controls.target.set(0, 3, 0); }
  }

  buildSurface() {
    const N = 70, size = SCALE * 2.3, geo = new THREE.PlaneGeometry(size, size, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
    const pts = this.pos.map((p, i) => ({ x: p.x, z: p.z, v: this.pf.V[i], ok: this.pf.type[i] !== 4 })).filter((p) => p.ok);
    for (let q = 0; q < pos.count; q++) {
      const x = pos.getX(q), z = pos.getZ(q);
      let ws = 0, vs = 0, dmin = Infinity;
      for (const p of pts) { const d2 = (p.x - x) ** 2 + (p.z - z) ** 2 + 1; const w = 1 / (d2 * d2); ws += w; vs += w * p.v; dmin = Math.min(dmin, d2); }
      const v = vs / ws, fade = Math.exp(-dmin / 900);
      pos.setY(q, (1 + ((v - this._vlo) / (this._vhi - this._vlo)) * 14) * fade - 0.2);
      const c = heat((v - this._vlo) / (this._vhi - this._vlo)); colors[3 * q] = c[0] / 255; colors[3 * q + 1] = c[1] / 255; colors[3 * q + 2] = c[2] / 255;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.45, side: THREE.DoubleSide, roughness: 0.8 }));
    const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x9fc3ff, wireframe: true, transparent: true, opacity: 0.06 }));
    this.root.add(mesh, wire);
  }

  setFault(i) {
    if (this.fault) { this.root.remove(this.fault.grp); this.fault = null; }
    if (i === null || i === undefined || i < 0) return;
    const p = this.pos[i], grp = new THREE.Group();
    const sph = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.55 }));
    grp.add(sph);
    const pts = []; let y = 14; let x = 0;
    while (y > 0) { pts.push(new THREE.Vector3(x, y, 0)); y -= 2.2; x = (Math.random() - 0.5) * 1.6; }
    pts.push(new THREE.Vector3(0, 0, 0));
    const bolt = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffee55 }));
    grp.add(bolt);
    grp.position.copy(p); this.root.add(grp);
    this.fault = { grp, sph, bolt };
  }

  /** Transient playback: data from simulateTransient, machine list with busIdx. */
  setPlayback(sim) { this.playback = sim ? { sim, idx: 0, playing: true } : null; this.mode = null; }
  setFrame(idx) { if (this.playback) this.playback.idx = idx; }
  setMode(mode, machines) { this.mode = mode ? { mode, machines, t0: this.clock.elapsedTime } : null; this.playback = null; }

  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    if (this.sel) { this.root.remove(this.sel); this.sel = null; }
    if (!hit) { this.onSelect?.(null); return; }
    const u = hit.object.userData;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.12, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(u.kind === 'branch' ? hit.object.position : this.pos[u.i]);
    this.root.add(ring); this.sel = ring;
    this.onSelect?.(u);
  }

  loop() {
    this._raf = requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
    this.controls.autoRotate = this.opts.rotate; this.controls.autoRotateSpeed = 0.6;
    this.controls.update();
    const m4 = new THREE.Matrix4();
    for (const f of this.flows || []) {
      f.phase = (f.phase + dt * f.speed) % 1;
      for (let j = 0; j < f.cnt; j++) {
        let u = (f.phase + j / f.cnt) % 1; if (f.dir < 0) u = 1 - u;
        const p = f.a.clone().lerp(f.b, u); p.y += 0.05;
        m4.makeTranslation(p.x, p.y, p.z); f.inst.setMatrixAt(j, m4);
      }
      f.inst.instanceMatrix.needsUpdate = true;
    }
    for (const g of this.gens || []) { g.rotor.rotation.x += dt * g.speed; g.ring.material.opacity = 0.35 + 0.25 * Math.sin(t * 3 + g.k); }
    if (this.fault) { const s = 1 + 0.25 * Math.sin(t * 12); this.fault.sph.scale.setScalar(s); this.fault.bolt.visible = Math.sin(t * 25) > -0.3; }
    if (this.playback) this.animatePlayback(dt);
    if (this.mode) this.animateMode(t);
    if (this.sel) this.sel.rotation.z += dt;
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  animatePlayback(dt) {
    const pb = this.playback, { sim } = pb;
    if (pb.playing) { pb.acc = (pb.acc || 0) + dt; const step = sim.t[1] - sim.t[0]; while (pb.acc > step * 2.5) { pb.acc -= step * 2.5; pb.idx = (pb.idx + 1) % sim.t.length; } }
    const k = pb.idx;
    this.onFrame?.(k);
    sim.machines.forEach((mc, j) => {
      const g = this.gens.find((x) => x.k === mc.k); if (!g) return;
      const d = sim.delta[j][k], w = sim.omega[j][k];
      g.grp.position.y = g.base.y + Math.max(-1.5, Math.min(8, (w - 1) * 900));
      g.rotor.rotation.x = (d * Math.PI) / 180 * 4;
      const tone = heat(Math.min(1, Math.abs(d) / 180)); g.body.material.color.setRGB(tone[0] / 255, tone[1] / 255, tone[2] / 255);
      g.speed = 0;
    });
  }

  animateMode(t) {
    const { mode, machines, t0 } = this.mode, w = 2 * Math.PI * Math.max(mode.f, 0.2) * 0.6;
    machines.forEach((mc, j) => {
      const g = this.gens.find((x) => x.k === mc.k); if (!g || !mode.shape) return;
      const s = mode.shape[j], y = s.mag * Math.cos(w * (t - t0) + s.ang);
      g.grp.position.y = g.base.y + 3 + 4 * y;
      const tone = heat(0.5 + 0.5 * y); g.body.material.color.setRGB(tone[0] / 255, tone[1] / 255, tone[2] / 255);
    });
  }

  dispose() {
    cancelAnimationFrame(this._raf); this._ro.disconnect();
    this.renderer.domElement.removeEventListener('click', this._onClick);
    this.clear(); this.renderer.dispose();
    this.renderer.domElement.remove(); this.labelRenderer.domElement.remove();
  }
}
