import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { models } from './models.js';

export class ApartmentScene {
  constructor(host) {
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e9eeed');
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 150);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '아파트 3D 구조');
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 55;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa9a0, 2.7));
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(-8, 18, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 });
    sun.shadow.bias = -0.001;
    this.scene.add(sun);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshStandardMaterial({ color: '#e9eeed', roughness: 1 }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.16;
    base.receiveShadow = true;
    this.scene.add(base);
    this.wallMaterial = new THREE.MeshStandardMaterial({ color: '#fcfcf9', roughness: 0.85 });
    this.frameMaterial = new THREE.MeshStandardMaterial({ color: '#596966', roughness: 0.6 });
    this.glassMaterial = new THREE.MeshStandardMaterial({ color: '#78bfc8', transparent: true, opacity: 0.32, roughness: 0.2, side: THREE.DoubleSide });
    this.floorMaterial = new THREE.MeshStandardMaterial({ color: '#d2c6af', roughness: 0.94 });
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.renderer.domElement.addEventListener('pointerdown', e => {
      if (!this.interior) return;
      this.drag = [e.clientX, e.clientY];
      this.renderer.domElement.setPointerCapture(e.pointerId);
    });
    this.renderer.domElement.addEventListener('pointermove', e => {
      if (!this.drag || !this.interior) return;
      this.yaw -= (e.clientX - this.drag[0]) * 0.004;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (e.clientY - this.drag[1]) * 0.004, -1.2, 1.2);
      this.drag = [e.clientX, e.clientY];
      this.look();
    });
    for (const event of ['pointerup', 'pointercancel']) this.renderer.domElement.addEventListener(event, () => { this.drag = null; });
    this.renderer.setAnimationLoop(() => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      if (!this.interior) this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.host;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  point(p) { return [(p[0] - this.model.center[0]) * this.model.scale, (p[1] - this.model.center[1]) * this.model.scale]; }

  beam(a, b, bottom, height, material, thickness = 0.15) {
    if (height <= 0) return;
    const [x1, z1] = this.point(a), [x2, z2] = this.point(b);
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 0.001) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, thickness), material);
    mesh.position.set((x1 + x2) / 2, bottom + height / 2, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    mesh.castShadow = material !== this.glassMaterial;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  build(type, cut = true) {
    this.type = type;
    this.model = models[type];
    while (this.group.children.length) {
      const child = this.group.children[0];
      child.geometry?.dispose();
      this.group.remove(child);
    }
    if (!this.model) return false;
    const height = cut ? 1.05 : this.model.height;
    const shape = new THREE.Shape(this.model.outline.map(p => { const [x, z] = this.point(p); return new THREE.Vector2(x, -z); }));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geometry, this.floorMaterial);
    floor.position.y = -0.12;
    floor.receiveShadow = true;
    this.group.add(floor);
    for (let i = 0; i < this.model.outline.length; i++) {
      const a = this.model.outline[i], b = this.model.outline[(i + 1) % this.model.outline.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
      const t = p => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
      const on = p => Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) < 0.01 && t(p) >= 0 && t(p) <= 1;
      const windows = this.model.windows.filter(w => on(w.a) && on(w.b)).map(w => ({ ...w, t1: Math.min(t(w.a), t(w.b)), t2: Math.max(t(w.a), t(w.b)) })).sort((x, y) => x.t1 - y.t1);
      const at = f => [a[0] + dx * f, a[1] + dy * f];
      let cursor = 0;
      for (const w of windows) {
        this.beam(at(cursor), at(w.t1), 0, height, this.wallMaterial);
        this.beam(at(w.t1), at(w.t2), 0, 0.4, this.wallMaterial);
        this.beam(at(w.t1), at(w.t2), 0.4, Math.min(height, 2.1) - 0.4, this.glassMaterial, 0.035);
        this.beam(at(w.t1), at(w.t2), 0.4, 0.045, this.frameMaterial, 0.09);
        this.beam(at(w.t1), at(w.t2), Math.min(height, 2.1) - 0.04, 0.04, this.frameMaterial, 0.09);
        const mid = at((w.t1 + w.t2) / 2);
        this.beam([mid[0] - 1, mid[1]], [mid[0] + 1, mid[1]], 0.4, Math.min(height, 2.1) - 0.4, this.frameMaterial, 0.06);
        this.beam(at(w.t1), at(w.t2), 2.1, Math.max(height - 2.1, 0), this.wallMaterial);
        cursor = w.t2;
      }
      this.beam(at(cursor), b, 0, height, this.wallMaterial);
    }
    for (const path of this.model.walls) for (let i = 1; i < path.length; i++) this.beam(path[i - 1], path[i], 0, height, this.wallMaterial);
    return true;
  }

  reset() {
    this.interior = false;
    this.controls.enabled = true;
    this.camera.fov = 42;
    this.camera.updateProjectionMatrix();
    const factor = Math.max(1, 1.1 / this.camera.aspect);
    this.camera.position.set(12 * factor, 17 * factor, 20 * factor);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  enterRoom(index) {
    const room = this.model.rooms[index];
    this.build(this.type, false);
    this.interior = true;
    this.controls.enabled = false;
    const [x, z] = this.point(room.point), [lx, lz] = this.point(room.look);
    this.camera.position.set(x, 1.5, z);
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.yaw = Math.atan2(lx - x, lz - z);
    this.pitch = 0;
    this.look();
  }

  look() {
    const p = this.camera.position;
    this.camera.lookAt(p.x + Math.sin(this.yaw) * Math.cos(this.pitch), p.y + Math.sin(this.pitch), p.z + Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  zoom(factor) {
    if (this.interior) {
      this.camera.fov = THREE.MathUtils.clamp(this.camera.fov * factor, 35, 90);
      this.camera.updateProjectionMatrix();
    } else {
      const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
      offset.setLength(THREE.MathUtils.clamp(offset.length(), 5, 55));
      this.camera.position.copy(this.controls.target).add(offset);
      this.controls.update();
    }
  }

  capture() {
    this.renderer.render(this.scene, this.camera);
    const output = document.createElement('canvas');
    output.width = this.renderer.domElement.width;
    output.height = this.renderer.domElement.height;
    const ctx = output.getContext('2d');
    ctx.drawImage(this.renderer.domElement, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, output.height - 46, output.width, 46);
    ctx.fillStyle = '#303b38';
    ctx.font = '20px sans-serif';
    ctx.fillText(`${this.type} | 도면 기반 추정 모델 · 실측 및 실제 전망 아님`, 16, output.height - 16);
    return output.toDataURL('image/png');
  }
}
