import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { eyeElevation, localPoint, insideFootprint } from './outlook-math.js';
import { buildLandmarks, landmarkSight } from './landmarks.js';
import { buildStreets } from './streets.js';
import { buildFacades } from './facades.js';
import { ModelInspector } from './model-inspector.js';
import { terrainGeometries } from './terrain-mesh.js';
import { bindGroundImagery } from './ground-imagery.js';
import { applyOfficialBuildingFacts } from './official-buildings.js';
import { neighborhoods } from './neighborhood.js';
import officialSites from '../research/linkage/generated/target-sites.json';
import './ground-imagery.css';

export class OutlookScene {
  constructor(host, onChange, options = {}) {
    this.options = options;
    this.host = host;
    this.onChange = onChange;
    this.state = { floors: [5, 10], bearing: 0, pitch: -4, fov: 65, floorHeight: 2.9, eyeHeight: 1.5, offset: 0, east: 0, north: 0 };
    if (options.floors) this.state.floors = [...options.floors];
    this.state.fov = options.fov ?? 65;
    this.state.pitch = options.pitch ?? -4;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    host.prepend(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', options.label ?? '206동 5층과 10층 추정 전망 비교');
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#b9d8e8');
    this.scene.fog = new THREE.Fog('#c6dce5', 1800, 24000);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x708170, 2));
    const sun = new THREE.DirectionalLight(0xfff7e8, 2.4);
    sun.position.set(-400, 600, -200);
    this.scene.add(sun);
    this.cameras = [0, 1].map(() => new THREE.PerspectiveCamera(65, 1, 0.15, 40000));
    this.cameras.forEach(camera=>camera.layers.enable(4));
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(host);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', e => { this.drag = [e.clientX, e.clientY]; this.dragStart = [...this.drag]; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!this.drag) return;
      this.state.bearing = (this.state.bearing - (e.clientX - this.drag[0]) * 0.18 + 360) % 360;
      this.state.pitch = THREE.MathUtils.clamp(this.state.pitch + (e.clientY - this.drag[1]) * 0.15, -65, 65);
      this.drag = [e.clientX, e.clientY];
      this.update();
    });
    canvas.addEventListener('pointerup', e => {
      if (!this.interior?.active && this.dragStart && Math.hypot(e.clientX-this.dragStart[0],e.clientY-this.dragStart[1])<5) this.inspector?.pick(e.clientX,e.clientY);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => { this.drag = null; this.dragStart = null; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.state.fov = THREE.MathUtils.clamp(this.state.fov + e.deltaY * 0.025, 35, this.options.horizontalFov ? 75 : 95);
      this.update();
    }, { passive: false });
  }

  async load() {
    const original = new URLSearchParams(location.search).get('terrain') === 'original';
    const sceneUrl=this.options.sceneUrl??'/research/sinchon-prugio/outlook/scene.json';
    const correctionUrl=original||this.options.correction===false?null:this.options.correctionUrl??(sceneUrl==='/research/sinchon-prugio/outlook/scene.json'?'/research/sinchon-prugio/outlook/mapinfo-correction.json':null);
    this.neighborhood=await neighborhoods.load({sceneUrl,correctionUrl,footprintsUrl:original?null:'/research/sinchon-prugio/outlook/building-footprints.json'});
    this.selection={...this.neighborhood.defaultSelection};
    // Compatibility boundary for legacy facade and window adapters.
    this.data={...this.neighborhood.environment,...this.selection};
    const correction=correctionUrl?{status:this.neighborhood.correctionStatus}:null;
    this.host.dataset.officialBuildings=String(applyOfficialBuildingFacts(this.data,officialSites));
    this.options.prepareData?.(this.data);
    const note = document.querySelector('#terrain-source');
    note.replaceChildren(document.createTextNode(correction ? `수치지도 보정 적용: ${correction.status} ` : '보정 전 OSM·기존 지형 모델 '));
    const comparison = document.createElement('a');
    comparison.href = original ? location.pathname : `${location.pathname}?terrain=original`;
    comparison.textContent = original ? '보정 결과 보기' : '보정 전과 비교';
    note.append(comparison);
    if (this.options.sourceNote) note.textContent = this.options.sourceNote;
    this.host.dataset.terrainSource = correctionUrl ? 'ngii-interpolated' : original ? 'original' : 'mapzen-estimated';
    this.target = this.data.buildings.find(b => b.id === this.data.targetBuildingId);
    this.state.bearing = this.data.window.bearing;
    this.buildLocator();
    const terrainMeshes = terrainGeometries(this.data.terrain).map(geometry => new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#82967d', roughness: 1 })));
    this.scene.add(...terrainMeshes);
    this.terrainMesh = terrainMeshes[0];
    this.terrainMeshes = terrainMeshes;
    this.blockers = [...terrainMeshes];
    this.pickables = [];
    const pickMaterial = new THREE.MeshBasicMaterial();
    const groups = new Map();
    const facadeGroups = new Map();
    this.facadeMeshes = [];
    let facadeCount = 0;
    for (const building of this.data.buildings) {
      if (this.data.landmarks.some(l => l.id === `way/${building.id}`)) continue;
      if (building.points.length < 4) continue;
      for (const volume of building.parts ?? [building]) {
      if(volume.points.length<4||volume.height<=0)continue;
      const shape = new THREE.Shape(volume.points.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: volume.height, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, building.base, 0);
      const pickable = new THREE.Mesh(geometry,pickMaterial);
      pickable.userData.building = building;
      this.pickables.push(pickable);
      const key = building.id === this.target.id ? 'target' : building.heightSource === 'assumed' ? 'estimated' : 'known';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(geometry);
      if (building.points.some(([x, z]) => Math.hypot(x, z) < 450)) {
        if (!facadeGroups.has(key)) facadeGroups.set(key, []);
        facadeGroups.get(key).push(buildFacades(volume));
        facadeCount++;
      }
      }
    }
    this.estimated = null;
    for (const [key, geometries] of groups) {
      const merged = mergeGeometries(geometries);
      const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: { target: '#bbd5d3', estimated: '#c9c9c5', known: '#e7e4dc' }[key], roughness: 0.92 }));
      if(key==='target')this.targetShell=mesh;
      this.scene.add(mesh);
      this.blockers.push(mesh);
      if (key === 'estimated') this.estimated = mesh;
      const details = facadeGroups.get(key) ?? [];
      const materials = new Map();
      for (const detail of details) for (const child of detail.children) {
        const color = child.material.color.getHex();
        if (!materials.has(color)) materials.set(color, []);
        materials.get(color).push(child);
      }
      for (const children of materials.values()) {
        const facade = new THREE.Mesh(mergeGeometries(children.map(c => c.geometry)), children[0].material);
        mesh.add(facade);
        this.facadeMeshes.push(facade);
        for (const child of children) { child.geometry.dispose(); if (child.material !== facade.material) child.material.dispose(); }
      }
      if(key==='target')mesh.traverse(child=>child.layers.set(4));
    }
    this.streets = buildStreets(this.data);
    this.scene.add(this.streets);
    this.host.dataset.roadSurfaces = String(this.streets.userData.roadCount);
    this.host.dataset.facadeBuildings = String(facadeCount);
    this.landmarks = buildLandmarks(this.data.landmarks, this.scene);
    this.selectedLandmark = this.landmarks.find(l => l.kind === 'observation-tower');
    const select = document.querySelector('#landmark-select');
    select.replaceChildren();
    const windowPoint = localPoint(this.data.window.lon, this.data.window.lat, this.data.center);
    for (const landmark of this.landmarks) {
      const distance = Math.hypot(landmark.point[0] - windowPoint[0], landmark.point[1] - windowPoint[1]) / 1000;
      select.add(new Option(`${landmark.name} · ${distance.toFixed(1)}km`, landmark.id));
    }
    select.value = this.selectedLandmark.id;
    this.scene.updateMatrixWorld(true);
    this.update();
    this.inspector = new ModelInspector(this);
    bindGroundImagery(this);
    this.render();
  }

  focusLandmark() {
    if (!this.selectedLandmark) return;
    const camera = this.cameras[0], l = this.selectedLandmark;
    const dx = l.point[0] - camera.position.x, dz = l.point[1] - camera.position.z;
    this.state.bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    this.state.pitch = Math.atan2(l.base + l.height * .65 - camera.position.y, Math.hypot(dx,dz)) * 180 / Math.PI;
    this.update();
  }

  update() {
    if (!this.data) return;
    const s = this.state;
    this.interior?.sync();
    const [x, z] = this.interior?.active ? this.interior.position() : localPoint(this.data.window.lon, this.data.window.lat, this.data.center);
    const yaw = THREE.MathUtils.degToRad(s.bearing), pitch = THREE.MathUtils.degToRad(s.pitch);
    this.cameras.forEach((camera, i) => {
      camera.position.set(x + s.east, eyeElevation(this.target.base, s.floors[i], s.floorHeight, s.offset, s.eyeHeight), z - s.north);
      camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))));
      camera.fov = s.fov;
    });
    this.onChange?.(s, this.cameras.map(c => c.position.y));
    this.updateLocator(x + s.east, z - s.north);
    this.inspector?.updateMap();
    this.render();
  }

  reset() {
    if (!this.data) return;
    Object.assign(this.state, { bearing: this.data.window.bearing, pitch: this.options.pitch ?? -4, fov: this.options.fov ?? 65, floorHeight: 2.9, eyeHeight: 1.5, offset: 0, east: 0, north: 0 });
    this.update();
  }

  buildLocator() {
    const ns = 'http://www.w3.org/2000/svg';
    const group = document.querySelector('#locator-buildings');
    group.replaceChildren();
    const focus=this.options.locatorAtWindow?localPoint(this.data.window.lon,this.data.window.lat,this.data.center):[0,0];
    for (const b of this.data.buildings) {
      if (!b.points.some(([x, z]) => Math.abs(x-focus[0]) < 90 && Math.abs(z-focus[1]) < 65)) continue;
      const polygon = document.createElementNS(ns, 'polygon');
      polygon.setAttribute('points', b.points.map(p => p.join(',')).join(' '));
      polygon.setAttribute('fill', b.id === this.target.id ? '#b8d9ce' : '#e1e3df');
      polygon.setAttribute('stroke', b.id === this.target.id ? '#176957' : '#b9c0ba');
      polygon.setAttribute('stroke-width', '.5');
      const title = document.createElementNS(ns, 'title');
      title.textContent = b.name || '주변 건물'; polygon.append(title); group.append(polygon);
    }
    const old = localPoint(this.data.previousWindow.lon, this.data.previousWindow.lat, this.data.center);
    const yaw = this.data.previousWindow.bearing * Math.PI / 180;
    document.querySelector('#locator-old').setAttribute('d', `M${old} l${Math.sin(yaw) * 32},${-Math.cos(yaw) * 32}`);
  }

  updateLocator(x, z) {
    const yaw = this.state.bearing * Math.PI / 180;
    const point = document.querySelector('#locator-point');
    point.setAttribute('cx', x); point.setAttribute('cy', z);
    document.querySelector('#locator-arrow').setAttribute('d', `M${x},${z} l${Math.sin(yaw) * 38},${-Math.cos(yaw) * 38}`);
    document.querySelector('#locator-cone').setAttribute('d', `M${x},${z} L${x + Math.sin(yaw - .35) * 38},${z - Math.cos(yaw - .35) * 38} L${x + Math.sin(yaw + .35) * 38},${z - Math.cos(yaw + .35) * 38} Z`);
    document.querySelector('#window-warning').hidden = this.interior?.active || !insideFootprint([x, z], this.target.points);
    document.querySelector('#locator-bearing').textContent = `${Math.round(this.state.bearing)}°`;
    this.host.dataset.cameraXZ = `${x.toFixed(3)},${z.toFixed(3)}`;
  }

  render() {
    if (!this.data || !this.host.clientWidth || !this.host.clientHeight) return;
    const width = this.host.clientWidth, height = this.host.clientHeight;
    this.renderer.setSize(width, height, false);
    const stacked = width < 650;
    this.host.classList.toggle('stacked', stacked);
    this.renderer.setScissorTest(true);
    const statuses = [];
    this.cameras.forEach((camera, i) => {
      const w = stacked ? width : Math.floor(width / 2), h = stacked ? Math.floor(height / 2) : height;
      const x = stacked ? 0 : i * w, y = stacked ? (1 - i) * h : 0;
      camera.aspect = w / h;
      camera.fov = this.options.horizontalFov
        ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.state.fov) / 2) / camera.aspect))
        : this.state.fov;
      camera.updateProjectionMatrix();
      this.renderer.setViewport(x, y, w, h);
      this.renderer.setScissor(x, y, w, h);
      this.renderer.render(this.scene, camera);
      const pin = document.querySelector(`#landmark-pin-${i}`);
      if (!this.interior?.active && this.selectedLandmark && this.selectedLandmark.group.visible) {
        const landmark = this.selectedLandmark;
        const otherLandmarks = this.landmarks.filter(l => l !== landmark).map(l => l.group);
        const sight = landmarkSight(camera, landmark, [...this.blockers, ...otherLandmarks]);
        pin.hidden = !sight.inFrame || !sight.clear;
        pin.textContent = landmark.name;
        pin.style.left = `${Math.max(x + 65, Math.min(x + w - 65, x + (sight.projected.x + 1) / 2 * w))}px`;
        pin.style.top = `${Math.max(height - y - h + 80, height - y - (sight.projected.y + 1) / 2 * h - 6)}px`;
        statuses.push(`${this.state.floors[i]}층: ${!sight.inFrame ? '화면 밖' : sight.clear ? '상단 가림 없음' : '상단 가림'}`);
      } else { pin.hidden = true; }
      if(!this.interior?.active)this.inspector?.render(camera,{x,top:height-y-h,w,h},i);
    });
    const selected = this.selectedLandmark;
    if (selected) {
      document.querySelector('#landmark-status').textContent = statuses.length ? `${statuses.join(' · ')} (현재 모델 기준)` : '랜드마크 숨김';
      document.querySelector('#landmark-source').href = selected.heightSource;
      document.querySelector('#landmark-source').textContent = `높이 ${selected.height}m · 출처`;
    }
    this.host.dataset.landmarks = String(this.landmarks?.length ?? 0);
    this.host.dataset.ready = 'true';
    this.host.dataset.cameraHeights = this.cameras.map(c => c.position.y.toFixed(2)).join(',');
    this.host.dataset.bearing = this.state.bearing.toFixed(2);
    this.host.dataset.horizontalFov = (2 * Math.atan(Math.tan(this.cameras[0].fov * Math.PI / 360) * this.cameras[0].aspect) * 180 / Math.PI).toFixed(2);
    this.host.dataset.verticalFov = this.cameras[0].fov.toFixed(2);
    this.host.dataset.pitch = this.state.pitch.toFixed(2);
  }
}
